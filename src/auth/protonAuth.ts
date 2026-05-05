import { NodeSRPModule } from '../crypto/srpImpl';
import { createOpenPGPCrypto } from '../crypto/openpgpImpl';
import * as openpgp from 'openpgp';
import { APP_VERSION } from '../version';

const BASE_URL = 'https://drive-api.proton.me';

interface AuthInfoResponse {
    Version: number;
    Modulus: string;
    ServerEphemeral: string;
    Salt: string;
    SRPSession: string;
}

interface AuthResponse {
    AccessToken: string;
    RefreshToken: string;
    UID: string;
    UserID: string;
}

interface UserKey {
    ID: string;
    PrivateKey: string;
    Primary: number;
}

interface UsersResponse {
    User: {
        ID: string;
        Email: string;
        Keys: UserKey[];
    };
}

interface AddressKey {
    ID: string;
    PrivateKey: string;
    Token: string;
    Primary: number;
}

interface Address {
    ID: string;
    Email: string;
    Keys: AddressKey[];
    Order: number;
}

interface AddressesResponse {
    Addresses: Address[];
}

interface KeySalt {
    ID: string;
    KeySalt: string | null;
}

interface KeySaltsResponse {
    KeySalts: KeySalt[];
}

import type { StoredSession } from '../config/config';
export type AuthSession = StoredSession;

const cookieJar: Record<string, string> = {};

function collectCookies(response: Response): void {
    // Node.js fetch (undici) exposes Set-Cookie via getSetCookie() or headers iteration
    const raw = response.headers as unknown as { getSetCookie?: () => string[] };
    const cookies: string[] = typeof raw.getSetCookie === 'function'
        ? raw.getSetCookie()
        : [];
    // Fallback: iterate all headers looking for set-cookie
    if (cookies.length === 0) {
        response.headers.forEach((value, key) => {
            if (key.toLowerCase() === 'set-cookie') cookies.push(value);
        });
    }
    for (const cookie of cookies) {
        const [pair] = cookie.split(';');
        const eq = pair.indexOf('=');
        if (eq > 0) {
            const name = pair.slice(0, eq).trim();
            const value = pair.slice(eq + 1).trim();
            cookieJar[name] = value;
        }
    }
}

async function apiRequest<T>(
    endpoint: string,
    options: { method?: string; body?: unknown; accessToken?: string; uid?: string } = {},
): Promise<T> {
    const headers: Record<string, string> = {
        'Content-Type': 'application/json',
        'Accept': 'application/json, text/plain, */*',
        'Accept-Language': 'en-US,en;q=0.9',
        'x-pm-appversion': APP_VERSION,
        'x-pm-locale': 'en_US',
    };

    if (options.accessToken && options.uid) {
        headers['Authorization'] = `Bearer ${options.accessToken}`;
        headers['x-pm-uid'] = options.uid;
    }

    const cookieStr = Object.entries(cookieJar).map(([k, v]) => `${k}=${v}`).join('; ');
    if (cookieStr) headers['Cookie'] = cookieStr;

    const url = `${BASE_URL}${endpoint}`;
    if (process.env.DEBUG) {
        console.error(`[DEBUG] --> ${options.method ?? 'GET'} ${url}`);
        console.error(`[DEBUG]     headers:`, JSON.stringify(headers, null, 2));
        if (options.body) console.error(`[DEBUG]     body:`, JSON.stringify(options.body, null, 2));
    }
    const response = await fetch(url, {
        method: options.method ?? 'GET',
        headers,
        body: options.body ? JSON.stringify(options.body) : undefined,
    });

    collectCookies(response);

    if (process.env.DEBUG) {
        const respHeaders: Record<string, string> = {};
        response.headers.forEach((v, k) => { respHeaders[k] = v; });
        console.error(`[DEBUG] <-- ${endpoint} HTTP ${response.status} headers:`, JSON.stringify(respHeaders, null, 2));
    }

    let data: Record<string, unknown>;
    try {
        data = (await response.json()) as Record<string, unknown>;
    } catch {
        throw new Error(`Proton API error at ${endpoint}: HTTP ${response.status} (non-JSON response)`);
    }

    if (process.env.DEBUG) {
        console.error(`[DEBUG] <-- ${endpoint} body:`, JSON.stringify(data, null, 2));
    }

    if (!response.ok || ((data['Code'] as number | undefined) !== undefined && (data['Code'] as number) !== 1000)) {
        const code = data['Code'] ?? response.status;
        const error = (data['Error'] as string | undefined) ?? `HTTP ${response.status}`;
        throw new Error(`Proton API error at ${endpoint} (code ${code}): ${error}`);
    }

    return data as T;
}

export async function authenticate(username: string, password: string): Promise<AuthSession> {
    const srp = new NodeSRPModule();

    // 1. Get auth info (SRP challenge)
    const authInfo = await apiRequest<AuthInfoResponse>('/auth/v4/info', {
        method: 'POST',
        body: { Username: username },
    });

    // 2. Compute SRP proof
    if (process.env.DEBUG) {
        console.error(`[DEBUG] SRP inputs: Version=${authInfo.Version} Salt=${authInfo.Salt} SRPSession=${authInfo.SRPSession}`);
        console.error(`[DEBUG] ServerEphemeral (first 32 chars): ${authInfo.ServerEphemeral.slice(0, 32)}...`);
        console.error(`[DEBUG] Modulus (first 32 chars): ${authInfo.Modulus.slice(0, 32)}...`);
    }
    const srpResult = await srp.getSrp(authInfo.Version, authInfo.Modulus, authInfo.ServerEphemeral, authInfo.Salt, password);
    if (process.env.DEBUG) {
        console.error(`[DEBUG] SRP outputs: ClientEphemeral (first 32): ${srpResult.clientEphemeral.slice(0, 32)}...`);
        console.error(`[DEBUG] SRP outputs: ClientProof (first 32): ${srpResult.clientProof.slice(0, 32)}...`);
    }

    // 3. Authenticate
    const authResponse = await apiRequest<AuthResponse>('/auth/v4', {
        method: 'POST',
        body: {
            Username: username,
            ClientEphemeral: srpResult.clientEphemeral,
            ClientProof: srpResult.clientProof,
            SRPSession: authInfo.SRPSession,
        },
    });

    const { AccessToken: accessToken, RefreshToken: refreshToken, UID: uid } = authResponse;

    // 4. Fetch user info + encrypted user keys
    const usersResponse = await apiRequest<UsersResponse>('/core/v4/users', { accessToken, uid });
    const user = usersResponse.User;
    const primaryUserKey = user.Keys.find((k) => k.Primary === 1) ?? user.Keys[0];

    // 5. Derive key password from the key salt
    const saltsResponse = await apiRequest<KeySaltsResponse>('/core/v4/keys/salts', { accessToken, uid });
    const keySalt = saltsResponse.KeySalts.find((s) => s.ID === primaryUserKey.ID);

    let keyPassword: string;
    if (keySalt?.KeySalt) {
        keyPassword = await srp.computeKeyPassword(password, keySalt.KeySalt);
    } else {
        keyPassword = password;
    }

    // 6. Decrypt user private key
    const userPgpKey = await openpgp.readPrivateKey({ armoredKey: primaryUserKey.PrivateKey });
    const unlockedUserKey = await openpgp.decryptKey({ privateKey: userPgpKey, passphrase: keyPassword });

    // 7. Fetch addresses
    const addressesResponse = await apiRequest<AddressesResponse>('/core/v4/addresses', { accessToken, uid });
    const addresses = addressesResponse.Addresses.sort((a, b) => a.Order - b.Order);

    if (addresses.length === 0 || addresses.every((a) => a.Keys.length === 0)) {
        throw new Error('No address keys found. Ensure your account has at least one address.');
    }

    // 8. Decrypt all address keys and store them
    const storedAddresses: import('../config/config').StoredAddress[] = [];

    for (const address of addresses) {
        if (address.Keys.length === 0) continue;

        const addressKeys: import('../config/config').StoredAddressKey[] = [];
        let primaryKeyIndex = 0;

        for (let i = 0; i < address.Keys.length; i++) {
            const addressKey = address.Keys[i];
            if (addressKey.Primary === 1) primaryKeyIndex = i;

            let armoredKey: string;
            if (addressKey.Token) {
                const tokenMessage = await openpgp.readMessage({ armoredMessage: addressKey.Token });
                const decrypted = await openpgp.decrypt({
                    message: tokenMessage,
                    decryptionKeys: unlockedUserKey,
                    format: 'utf8',
                });
                const addressPassphrase = decrypted.data as string;
                const addressPgpKey = await openpgp.readPrivateKey({ armoredKey: addressKey.PrivateKey });
                const unlockedAddressKey = await openpgp.decryptKey({ privateKey: addressPgpKey, passphrase: addressPassphrase });
                const reLockedKey = await openpgp.encryptKey({ privateKey: unlockedAddressKey, passphrase: keyPassword });
                armoredKey = reLockedKey.armor();
            } else {
                armoredKey = addressKey.PrivateKey;
            }

            addressKeys.push({ keyId: addressKey.ID, armoredPrivateKey: armoredKey });
        }

        storedAddresses.push({
            email: address.Email,
            addressId: address.ID,
            primaryKeyIndex,
            keys: addressKeys,
        });
    }

    return {
        addresses: storedAddresses,
        keyPassword,
        accessToken,
        refreshToken,
        uid,
    };
}
