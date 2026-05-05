/* eslint-disable @typescript-eslint/no-explicit-any */
import * as openpgp from 'openpgp';
import { OpenPGPCryptoWithCryptoProxy, type OpenPGPCryptoProxy } from '@protontech/drive-sdk';
import { VERIFICATION_STATUS } from '@protontech/drive-sdk/dist/crypto/interface';

// Helpers to convert between openpgp SessionKey and SDK SessionKey
// The SDK SessionKey uses `string | null`; openpgp uses enum string literals.
function toOpenpgpSessionKey(sk: { data: Uint8Array; algorithm: string | null; aeadAlgorithm: string | null }): openpgp.SessionKey {
    return {
        data: sk.data,
        algorithm: (sk.algorithm ?? 'aes256') as openpgp.enums.symmetricNames,
        aeadAlgorithm: sk.aeadAlgorithm as openpgp.enums.aeadNames | undefined,
    };
}

function fromOpenpgpDecryptedSessionKey(sk: openpgp.DecryptedSessionKey): { data: Uint8Array; algorithm: string | null; aeadAlgorithm: string | null } {
    return { data: sk.data, algorithm: sk.algorithm, aeadAlgorithm: null };
}

function fromOpenpgpSessionKey(sk: openpgp.SessionKey): { data: Uint8Array; algorithm: string | null; aeadAlgorithm: string | null } {
    return { data: sk.data, algorithm: sk.algorithm, aeadAlgorithm: sk.aeadAlgorithm ?? null };
}

class NodeOpenPGPCryptoProxy implements OpenPGPCryptoProxy {
    async generateKey(options: {
        userIDs: { name: string }[];
        type: 'ecc';
        curve: 'ed25519Legacy';
        config?: { aeadProtect: boolean };
    }): Promise<any> {
        const { privateKey } = await openpgp.generateKey({
            userIDs: options.userIDs,
            type: options.type,
            curve: options.curve as any,
            format: 'object',
        });
        return privateKey;
    }

    async exportPrivateKey(options: { privateKey: any; passphrase: string | null }): Promise<string> {
        const key = options.privateKey as openpgp.PrivateKey;
        if (options.passphrase) {
            const locked = await openpgp.encryptKey({ privateKey: key, passphrase: options.passphrase });
            return locked.armor();
        }
        return key.armor();
    }

    async importPrivateKey(options: { armoredKey: string; passphrase: string | null }): Promise<any> {
        const privateKey = await openpgp.readPrivateKey({ armoredKey: options.armoredKey });
        if (options.passphrase) {
            return openpgp.decryptKey({ privateKey, passphrase: options.passphrase });
        }
        return privateKey;
    }

    async generateSessionKey(options: { recipientKeys: any[]; config?: { ignoreSEIPDv2FeatureFlag: boolean } }): Promise<any> {
        const encryptionKeys = options.recipientKeys as openpgp.PublicKey[];
        const sk = await openpgp.generateSessionKey({ encryptionKeys });
        return fromOpenpgpSessionKey(sk);
    }

    async encryptSessionKey(options: any & { format: 'binary'; encryptionKeys?: any; passwords?: string[] }): Promise<Uint8Array<ArrayBuffer>> {
        const encryptionKeys = options.encryptionKeys
            ? (Array.isArray(options.encryptionKeys) ? options.encryptionKeys : [options.encryptionKeys]) as openpgp.PublicKey[]
            : undefined;
        const result = await openpgp.encryptSessionKey({
            data: options.data,
            algorithm: options.algorithm,
            aeadAlgorithm: options.aeadAlgorithm ?? undefined,
            encryptionKeys,
            passwords: options.passwords,
            format: 'binary',
        });
        return result.buffer instanceof ArrayBuffer ? result as Uint8Array<ArrayBuffer> : new Uint8Array(result).buffer as unknown as Uint8Array<ArrayBuffer>;
    }

    async decryptSessionKey(options: {
        armoredMessage?: string;
        binaryMessage?: Uint8Array;
        decryptionKeys: any | any[];
    }): Promise<any | undefined> {
        const decryptionKeys = (Array.isArray(options.decryptionKeys) ? options.decryptionKeys : [options.decryptionKeys]) as openpgp.PrivateKey[];
        let message: openpgp.Message<openpgp.MaybeStream<Uint8Array>>;
        if (options.armoredMessage) {
            message = await openpgp.readMessage({ armoredMessage: options.armoredMessage });
        } else if (options.binaryMessage) {
            message = await openpgp.readMessage({ binaryMessage: options.binaryMessage });
        } else {
            throw new Error('Either armoredMessage or binaryMessage must be provided');
        }
        const keys = await openpgp.decryptSessionKeys({ message, decryptionKeys });
        if (!keys || keys.length === 0) return undefined;
        return fromOpenpgpDecryptedSessionKey(keys[0]);
    }

    async encryptMessage(options: {
        format?: 'armored' | 'binary';
        binaryData: Uint8Array;
        sessionKey?: any;
        encryptionKeys: any[];
        signingKeys?: any;
        detached?: boolean;
        compress?: boolean;
        config?: { ignoreSEIPDv2FeatureFlag: boolean };
    }): Promise<any> {
        const encryptionKeys = options.encryptionKeys as openpgp.PublicKey[];
        const signingKeysArr = options.signingKeys
            ? (Array.isArray(options.signingKeys) ? options.signingKeys : [options.signingKeys]) as openpgp.PrivateKey[]
            : [];
        const sessionKey = options.sessionKey ? toOpenpgpSessionKey(options.sessionKey) : undefined;
        const isBinary = options.format === 'binary';
        const fmt = isBinary ? 'binary' : 'armored';
        const message = await openpgp.createMessage({ binary: options.binaryData });
        const compress = options.compress ? openpgp.enums.compression.zlib : openpgp.enums.compression.uncompressed;
        const config = { preferredCompressionAlgorithm: compress };

        if (options.detached) {
            // Sign plaintext separately (detached) and encrypt data without embedding the signature.
            // The SDK expects `signature` to be the raw PGP signature (NOT encrypted); the caller
            // is responsible for encrypting it if needed (e.g. driveCrypto.encryptSignature for blocks).
            let rawSig: any = undefined;
            if (signingKeysArr.length > 0) {
                rawSig = await (openpgp.sign as any)({
                    message,
                    signingKeys: signingKeysArr,
                    detached: true,
                    format: isBinary ? 'binary' : 'armored',
                });
            }
            const encryptedData = await (openpgp.encrypt as any)({
                message,
                encryptionKeys,
                sessionKey,
                format: fmt,
                config,
            });
            return { message: encryptedData, signature: rawSig };
        }

        const encrypted = await (openpgp.encrypt as any)({
            message,
            encryptionKeys,
            signingKeys: signingKeysArr,
            sessionKey,
            format: fmt,
            config,
        });
        return { message: encrypted };
    }

    async decryptMessage(options: {
        format: 'utf8' | 'binary';
        armoredMessage?: string;
        binaryMessage?: Uint8Array;
        armoredSignature?: string;
        binarySignature?: Uint8Array;
        sessionKeys?: any;
        passwords?: string[];
        decryptionKeys?: any | any[];
        verificationKeys?: any | any[];
    }): Promise<{ data: any; verificationStatus: VERIFICATION_STATUS; verificationErrors?: Error[] }> {
        const decryptionKeys = options.decryptionKeys
            ? (Array.isArray(options.decryptionKeys) ? options.decryptionKeys : [options.decryptionKeys]) as openpgp.PrivateKey[]
            : undefined;
        const verificationKeys = options.verificationKeys
            ? (Array.isArray(options.verificationKeys) ? options.verificationKeys : [options.verificationKeys]) as openpgp.PublicKey[]
            : undefined;

        let message: openpgp.Message<openpgp.MaybeStream<Uint8Array | string>>;
        if (options.armoredMessage) {
            message = await openpgp.readMessage({ armoredMessage: options.armoredMessage });
        } else if (options.binaryMessage) {
            message = await openpgp.readMessage({ binaryMessage: options.binaryMessage });
        } else {
            throw new Error('Either armoredMessage or binaryMessage must be provided');
        }

        let signature: openpgp.Signature | undefined;
        if (options.armoredSignature) {
            signature = await openpgp.readSignature({ armoredSignature: options.armoredSignature });
        } else if (options.binarySignature) {
            signature = await openpgp.readSignature({ binarySignature: options.binarySignature });
        }

        const sessionKeys = options.sessionKeys ? [toOpenpgpSessionKey(options.sessionKeys)] : undefined;

        let result: any;
        if (options.format === 'binary') {
            result = await openpgp.decrypt({
                message: message as any,
                decryptionKeys,
                verificationKeys,
                sessionKeys,
                passwords: options.passwords,
                signature,
                format: 'binary',
            });
        } else {
            result = await openpgp.decrypt({
                message: message as any,
                decryptionKeys,
                verificationKeys,
                sessionKeys,
                passwords: options.passwords,
                signature,
                format: 'utf8',
            });
        }

        let verificationStatus = VERIFICATION_STATUS.NOT_SIGNED;
        const verificationErrors: Error[] = [];

        if (verificationKeys && verificationKeys.length > 0 && result.signatures && result.signatures.length > 0) {
            try {
                await result.signatures[0].verified;
                verificationStatus = VERIFICATION_STATUS.SIGNED_AND_VALID;
            } catch (e) {
                verificationStatus = VERIFICATION_STATUS.SIGNED_AND_INVALID;
                verificationErrors.push(e as Error);
            }
        }

        return {
            data: result.data,
            verificationStatus,
            verificationErrors: verificationErrors.length > 0 ? verificationErrors : undefined,
        };
    }

    async signMessage(options: {
        format: 'binary' | 'armored';
        binaryData: Uint8Array;
        signingKeys: any | any[];
        detached: boolean;
        signatureContext?: { critical: boolean; value: string };
    }): Promise<any> {
        const signingKeys = (Array.isArray(options.signingKeys) ? options.signingKeys : [options.signingKeys]) as openpgp.PrivateKey[];
        const message = await openpgp.createMessage({ binary: options.binaryData });

        if (options.format === 'binary') {
            return openpgp.sign({ message, signingKeys, detached: options.detached, format: 'binary' });
        }
        return openpgp.sign({ message, signingKeys, detached: options.detached });
    }

    async verifyMessage(options: {
        binaryData: Uint8Array;
        armoredSignature?: string;
        binarySignature?: Uint8Array;
        verificationKeys: any | any[];
        signatureContext?: { required: boolean; value: string };
    }): Promise<{ verificationStatus: VERIFICATION_STATUS; errors?: Error[] }> {
        const verificationKeys = (Array.isArray(options.verificationKeys) ? options.verificationKeys : [options.verificationKeys]) as openpgp.PublicKey[];

        let signature: openpgp.Signature;
        if (options.armoredSignature) {
            signature = await openpgp.readSignature({ armoredSignature: options.armoredSignature });
        } else if (options.binarySignature) {
            signature = await openpgp.readSignature({ binarySignature: options.binarySignature });
        } else {
            throw new Error('Either armoredSignature or binarySignature must be provided');
        }

        const message = await openpgp.createMessage({ binary: options.binaryData });
        const result = await openpgp.verify({ message, signature, verificationKeys });

        if (!result.signatures || result.signatures.length === 0) {
            return { verificationStatus: VERIFICATION_STATUS.NOT_SIGNED };
        }

        try {
            await result.signatures[0].verified;
            return { verificationStatus: VERIFICATION_STATUS.SIGNED_AND_VALID };
        } catch (e) {
            return { verificationStatus: VERIFICATION_STATUS.SIGNED_AND_INVALID, errors: [e as Error] };
        }
    }
}

export function createOpenPGPCrypto(): OpenPGPCryptoWithCryptoProxy {
    return new OpenPGPCryptoWithCryptoProxy(new NodeOpenPGPCryptoProxy());
}
