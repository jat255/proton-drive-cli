import fs from 'fs';
import os from 'os';
import path from 'path';

export interface StoredAddressKey {
    keyId: string;
    armoredPrivateKey: string;
}

export interface StoredAddress {
    email: string;
    addressId: string;
    primaryKeyIndex: number;
    keys: StoredAddressKey[];
}

export interface StoredSession {
    addresses: StoredAddress[];
    keyPassword: string;
    accessToken: string;
    refreshToken: string;
    uid: string;
}

export function defaultConfigPath(): string {
    return path.join(os.homedir(), '.config', 'proton-drive', 'session.json');
}

export function loadSession(configPath: string = defaultConfigPath()): StoredSession | null {
    try {
        const content = fs.readFileSync(configPath, 'utf-8');
        return JSON.parse(content) as StoredSession;
    } catch {
        return null;
    }
}

export function saveSession(session: StoredSession, configPath: string = defaultConfigPath()): void {
    const dir = path.dirname(configPath);
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(configPath, JSON.stringify(session, null, 2), { mode: 0o600 });
}

export function clearSession(configPath: string = defaultConfigPath()): void {
    try {
        fs.unlinkSync(configPath);
    } catch {
        // already gone
    }
}
