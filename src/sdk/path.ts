import type { ProtonDriveClient } from '@protontech/drive-sdk';
import { NodeType } from '@protontech/drive-sdk';

export async function resolveFolderPath(client: ProtonDriveClient, folderPath: string): Promise<string> {
    const rootFolder = await client.getMyFilesRootFolder();
    if (!rootFolder.ok) {
        throw new Error('Could not get root folder');
    }

    const segments = folderPath.replace(/^\//, '').split('/').filter(Boolean);
    if (segments.length === 0) {
        return rootFolder.value.uid;
    }

    let currentUid = rootFolder.value.uid;

    for (const segment of segments) {
        let found: string | undefined;

        for await (const node of client.iterateFolderChildren(currentUid)) {
            if (!node.ok) continue;
            const n = node.value;
            if (n.type === NodeType.Folder && n.name === segment) {
                found = n.uid;
                break;
            }
        }

        if (!found) {
            throw new Error(`Folder not found: "${segment}" in path "${folderPath}"`);
        }
        currentUid = found;
    }

    return currentUid;
}

export async function resolveNodePath(client: ProtonDriveClient, nodePath: string): Promise<string> {
    const rootFolder = await client.getMyFilesRootFolder();
    if (!rootFolder.ok) {
        throw new Error('Could not get root folder');
    }

    const segments = nodePath.replace(/^\//, '').split('/').filter(Boolean);
    if (segments.length === 0) {
        return rootFolder.value.uid;
    }

    let currentUid = rootFolder.value.uid;

    for (let i = 0; i < segments.length; i++) {
        const segment = segments[i];
        const isLast = i === segments.length - 1;
        let found: string | undefined;

        for await (const node of client.iterateFolderChildren(currentUid)) {
            if (!node.ok) continue;
            const n = node.value;
            // All intermediate segments must be folders; the final segment can be any type
            if ((isLast || n.type === NodeType.Folder) && n.name === segment) {
                found = n.uid;
                break;
            }
        }

        if (!found) {
            throw new Error(`Not found: "${segment}" in path "${nodePath}"`);
        }
        currentUid = found;
    }

    return currentUid;
}

export function looksLikePath(value: string): boolean {
    return value.includes('/') || !value.includes('==');
}
