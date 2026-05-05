import fs from 'fs';
import path from 'path';
import { Readable } from 'stream';
import type { ProtonDriveClient } from '@protontech/drive-sdk';

export async function uploadFile(
    client: ProtonDriveClient,
    filePath: string,
    parentFolderUid: string,
    fileName: string,
    fileSize: number,
    onProgress?: (uploadedBytes: number) => void,
): Promise<{ nodeUid: string; nodeRevisionUid: string }> {
    const mediaType = guessMimeType(path.extname(fileName));

    const availableName = await client.getAvailableName(parentFolderUid, fileName);

    const uploader = await client.getFileUploader(parentFolderUid, availableName, {
        mediaType,
        expectedSize: fileSize,
        modificationTime: new Date(fs.statSync(filePath).mtime),
    });

    const nodeReadable = fs.createReadStream(filePath);
    const webStream = Readable.toWeb(nodeReadable) as ReadableStream<Uint8Array>;

    const controller = await uploader.uploadFromStream(webStream, [], onProgress);
    return await controller.completion();
}

function guessMimeType(ext: string): string {
    const map: Record<string, string> = {
        '.txt': 'text/plain',
        '.pdf': 'application/pdf',
        '.png': 'image/png',
        '.jpg': 'image/jpeg',
        '.jpeg': 'image/jpeg',
        '.gif': 'image/gif',
        '.mp4': 'video/mp4',
        '.mp3': 'audio/mpeg',
        '.zip': 'application/zip',
        '.json': 'application/json',
    };
    return map[ext.toLowerCase()] ?? 'application/octet-stream';
}
