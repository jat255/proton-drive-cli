import { encodeBase64 as bcryptEncodeBase64, hash as bcryptHash } from 'bcryptjs';
import type { SRPModule, SRPVerifier } from '../types/interface';

function base64ToBytes(b64: string): Uint8Array {
    const bin = atob(b64);
    const bytes = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
    return bytes;
}

function bytesToBase64(bytes: Uint8Array): string {
    let bin = '';
    for (const b of bytes) bin += String.fromCharCode(b);
    return btoa(bin);
}

function concat(...arrays: Uint8Array[]): Uint8Array {
    const total = arrays.reduce((s, a) => s + a.length, 0);
    const out = new Uint8Array(total);
    let offset = 0;
    for (const a of arrays) { out.set(a, offset); offset += a.length; }
    return out;
}

// Proton SRP uses little-endian byte ordering throughout
function leToBI(bytes: Uint8Array): bigint {
    return bytes.slice().reverse().reduce((acc, v) => (acc << 8n) | BigInt(v), 0n);
}

function biToLE(n: bigint, length: number): Uint8Array<ArrayBuffer> {
    const bytes = new Uint8Array(length);
    for (let i = 0; i < length; i++) {
        bytes[i] = Number(n & 0xffn);
        n >>= 8n;
    }
    return bytes;
}

// expandHash: SHA512(input||0) || SHA512(input||1) || SHA512(input||2) || SHA512(input||3) = 256 bytes
async function expandHash(input: Uint8Array): Promise<Uint8Array> {
    const parts = await Promise.all(
        [0, 1, 2, 3].map(async (i) => {
            const data = concat(input, new Uint8Array([i]));
            return new Uint8Array(await crypto.subtle.digest('SHA-512', data.buffer as ArrayBuffer));
        })
    );
    return concat(...parts);
}

function mod(a: bigint, m: bigint): bigint {
    return ((a % m) + m) % m;
}

function modPow(base: bigint, exp: bigint, m: bigint): bigint {
    let result = 1n;
    base = base % m;
    while (exp > 0n) {
        if (exp % 2n === 1n) result = (result * base) % m;
        exp >>= 1n;
        base = (base * base) % m;
    }
    return result;
}

function extractModulusFromArmored(armored: string): Uint8Array {
    const lines = armored.split('\n');
    const bodyLines: string[] = [];
    let inBody = false;
    let inHeaders = false;

    for (const line of lines) {
        if (line.startsWith('-----BEGIN PGP')) {
            if (inBody) break; // second PGP block is the signature -- stop
            inHeaders = true;
            continue;
        }
        if (line.startsWith('-----END PGP')) break;
        if (inHeaders) {
            if (line.trim() === '') { inHeaders = false; inBody = true; }
            continue;
        }
        if (inBody && line.trim() !== '' && !line.startsWith('=')) {
            bodyLines.push(line.trim());
        }
    }

    return bodyLines.length > 0 ? base64ToBytes(bodyLines.join('')) : base64ToBytes(armored.trim());
}

// Proton version 4 password hashing:
//   saltWithProton = saltBytes || "proton" (take first 16 bytes)
//   bcryptOut = bcrypt(password, "$2y$10$" + bcryptBase64(saltWithProton))
//   hashedPassword = expandHash(ASCII_bytes(bcryptOut) || modulusBytes)
async function hashPasswordV4(password: string, salt: string, modulusArray: Uint8Array): Promise<Uint8Array> {
    const saltBytes = base64ToBytes(salt);
    const saltWithProton = concat(saltBytes, new TextEncoder().encode('proton')).slice(0, 16);
    const encoded = bcryptEncodeBase64(saltWithProton, saltWithProton.length);
    const unexpandedHash = await bcryptHash(password, '$2y$10$' + encoded);
    const unexpandedBytes = Uint8Array.from(unexpandedHash, (c) => c.charCodeAt(0));
    return expandHash(concat(unexpandedBytes, modulusArray));
}

export class NodeSRPModule implements SRPModule {
    async computeKeyPassword(password: string, salt: string): Promise<string> {
        const raw = base64ToBytes(salt);
        // Pad to 16 bytes for bcrypt salt
        const saltBytes = new Uint8Array(16);
        saltBytes.set(raw.slice(0, 16));
        const encoded = bcryptEncodeBase64(saltBytes, 16);
        const hashed = await bcryptHash(password, '$2y$10$' + encoded);
        return hashed.slice(29);
    }

    async getSrp(
        _version: number,
        modulus: string,
        serverEphemeral: string,
        salt: string,
        password: string,
    ): Promise<{ expectedServerProof: string; clientProof: string; clientEphemeral: string }> {
        const byteLength = 256; // 2048-bit

        const modulusArray = extractModulusFromArmored(modulus);
        const serverEphemeralArray = base64ToBytes(serverEphemeral);

        // x = hashedPassword (256 bytes, little-endian bigint)
        const hashedPasswordArray = await hashPasswordV4(password, salt, modulusArray);

        const N = leToBI(modulusArray);
        const g = 2n;

        // k = littleEndian(expandHash(littleEndian(g, 256 bytes) || modulusBytes))
        const kHash = await expandHash(concat(biToLE(g, byteLength), modulusArray));
        const k = leToBI(kHash);

        const B = leToBI(serverEphemeralArray);
        if (B === 0n) throw new Error('Server ephemeral is zero');

        const x = leToBI(hashedPasswordArray);
        const N_minus_1 = N - 1n;

        // Generate safe client ephemeral
        let a = 0n, ABytes = new Uint8Array(byteLength), u = 0n;
        for (let i = 0; i < 1000; i++) {
            a = leToBI(crypto.getRandomValues(new Uint8Array(byteLength)) as Uint8Array<ArrayBuffer>);
            const A = modPow(g, a, N);
            ABytes = biToLE(A, byteLength);
            // u = littleEndian(expandHash(ABytes || serverEphemeralArray))
            u = leToBI(await expandHash(concat(ABytes, serverEphemeralArray)));
            if (A !== 0n && u !== 0n) break;
        }

        // S = (B - k*g^x mod N) ^ (u*x + a mod N-1) mod N
        const kgx = mod(modPow(g, x, N) * k, N);
        const exponent = mod(u * x + a, N_minus_1);
        const S = modPow(mod(B - kgx, N), exponent, N);
        const SBytes = biToLE(S, byteLength);

        // Proton proof formula: expandHash(A || B || S) and expandHash(A || proof || S)
        const clientProof = await expandHash(concat(ABytes, serverEphemeralArray, SBytes));
        const expectedServerProof = await expandHash(concat(ABytes, clientProof, SBytes));

        return {
            clientEphemeral: bytesToBase64(ABytes),
            clientProof: bytesToBase64(clientProof),
            expectedServerProof: bytesToBase64(expectedServerProof),
        };
    }

    async getSrpVerifier(_password: string): Promise<SRPVerifier> {
        throw new Error('getSrpVerifier not implemented');
    }
}
