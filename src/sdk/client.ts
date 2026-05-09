import { ProtonDriveClient, MemoryCache } from '@protontech/drive-sdk';
import { Telemetry, LogFilter, LogLevel, ConsoleLogHandler } from '@protontech/drive-sdk/dist/telemetry';
import { NodeHttpClient } from '../http/nodeHttpClient';
import { createOpenPGPCrypto } from '../crypto/openpgpImpl';
import { NodeSRPModule } from '../crypto/srpImpl';
import { SimpleProtonDriveAccount } from '../account/simpleAccount';
import { loadSession, defaultConfigPath } from '../config/config';
import { refreshSession } from '../auth/protonAuth';
import * as openpgp from 'openpgp';
import type { PrivateKey } from '../types/interface';

export async function createClient(configPath?: string, verbose = false): Promise<ProtonDriveClient> {
    const resolvedPath = configPath ?? defaultConfigPath();

    let session = loadSession(resolvedPath);
    if (!session) {
        throw new Error('Not logged in. Run `proton-drive login` first.');
    }

    try {
        session = await refreshSession(resolvedPath);
    } catch (err) {
        process.stderr.write(`Warning: token refresh failed (${(err as Error).message}), using stored session\n`);
    }

    const { accessToken, uid, addresses: storedAddresses, keyPassword } = session;

    const httpClient = new NodeHttpClient({
        getAuthToken: () => ({ accessToken, uid }),
    });

    const openPGPCryptoModule = createOpenPGPCrypto();
    const srpModule = new NodeSRPModule();

    const addresses = await Promise.all(
        storedAddresses.map(async (addr) => {
            const keys = await Promise.all(
                addr.keys.map(async (k) => {
                    const pgpKey = await openpgp.readPrivateKey({ armoredKey: k.armoredPrivateKey });
                    const unlocked = await openpgp.decryptKey({ privateKey: pgpKey, passphrase: keyPassword });
                    return { id: k.keyId, key: unlocked as unknown as PrivateKey };
                }),
            );
            return { email: addr.email, addressId: addr.addressId, primaryKeyIndex: addr.primaryKeyIndex, keys };
        }),
    );

    const account = new SimpleProtonDriveAccount(addresses);

    const telemetry = new Telemetry({
        logFilter: new LogFilter({ globalLevel: verbose ? LogLevel.DEBUG : LogLevel.WARNING }),
        logHandlers: [new ConsoleLogHandler()],
        metricHandlers: verbose ? undefined : [],
    });

    return new ProtonDriveClient({
        httpClient,
        entitiesCache: new MemoryCache(),
        cryptoCache: new MemoryCache(),
        account,
        openPGPCryptoModule,
        srpModule,
        telemetry,
    });
}
