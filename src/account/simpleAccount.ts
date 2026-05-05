import type { ProtonDriveAccount, ProtonDriveAccountAddress, PublicKey } from '../types/interface';

export class SimpleProtonDriveAccount implements ProtonDriveAccount {
    private readonly addresses: ProtonDriveAccountAddress[];

    constructor(addresses: ProtonDriveAccountAddress[]) {
        this.addresses = addresses;
    }

    async getOwnPrimaryAddress(): Promise<ProtonDriveAccountAddress> {
        return this.addresses[0];
    }

    async getOwnAddresses(): Promise<ProtonDriveAccountAddress[]> {
        return this.addresses;
    }

    async getOwnAddress(emailOrAddressId: string): Promise<ProtonDriveAccountAddress> {
        const found = this.addresses.find(
            (a) =>
                a.email === emailOrAddressId ||
                a.addressId === emailOrAddressId ||
                a.keys.some((k) => k.id === emailOrAddressId),
        );
        if (!found) throw new Error(`Address not found: ${emailOrAddressId}`);
        return found;
    }

    async hasProtonAccount(_email: string): Promise<boolean> {
        return true;
    }

    async getPublicKeys(email: string, _forceRefresh?: boolean): Promise<PublicKey[]> {
        const address = this.addresses.find((a) => a.email === email);
        if (!address) return [];

        const primaryKey = address.keys[address.primaryKeyIndex];
        const pgpKey = primaryKey?.key as unknown as { toPublic(): PublicKey } | undefined;
        if (pgpKey && typeof pgpKey.toPublic === 'function') {
            return [pgpKey.toPublic()];
        }
        return [];
    }
}
