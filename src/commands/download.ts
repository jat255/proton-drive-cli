import { Command } from 'commander';
import fs from 'fs';
import path from 'path';
import { Writable } from 'stream';
import { createClient } from '../sdk/client';
import { defaultConfigPath } from '../config/config';

export const downloadCommand = new Command('download')
    .description('Download a file from Proton Drive')
    .argument('<node-uid>', 'Node UID of the file to download')
    .argument('[destination]', 'Local destination path (defaults to current directory)')
    .option('-c, --config <path>', 'Path to config file', defaultConfigPath())
    .option('-v, --verbose', 'Enable verbose logging')
    .action(async (nodeUid: string, destination: string | undefined, options) => {
        try {
            const client = await createClient(options.config, options.verbose);

            const node = await client.getNode(nodeUid);
            if (!node.ok) {
                // DegradedNode: name is a Result
                const nameResult = node.error.name;
                const name = nameResult.ok ? nameResult.value : nodeUid;
                console.error(`Could not retrieve node: ${name}`);
                process.exit(1);
            }

            const n = node.value;
            const fileName = n.name;
            const claimedSize = n.activeRevision?.claimedSize;

            const destPath = destination
                ? (() => {
                      try {
                          return fs.statSync(destination).isDirectory() ? path.join(destination, fileName) : destination;
                      } catch {
                          return destination;
                      }
                  })()
                : path.join(process.cwd(), fileName);

            console.log(`Downloading ${fileName}${claimedSize ? ` (${formatBytes(claimedSize)})` : ''}`);

            const downloader = await client.getFileDownloader(nodeUid);
            const fileStream = fs.createWriteStream(destPath);
            const writableStream = Writable.toWeb(fileStream) as WritableStream<Uint8Array>;

            const controller = downloader.downloadToStream(writableStream, (downloadedBytes: number) => {
                if (claimedSize) {
                    const percent = Math.round((downloadedBytes / claimedSize) * 100);
                    process.stdout.write(`\rDownloading: ${percent}% (${formatBytes(downloadedBytes)}/${formatBytes(claimedSize)})`);
                } else {
                    process.stdout.write(`\rDownloaded: ${formatBytes(downloadedBytes)}`);
                }
            });

            await controller.completion();

            if (controller.isDownloadCompleteWithSignatureIssues()) {
                console.warn('\nWarning: download completed but signature verification had issues');
            } else {
                console.log(`\nDownloaded to ${destPath}`);
            }
        } catch (error) {
            console.error('Error downloading file:', (error as Error).message);
            process.exit(1);
        }
    });

function formatBytes(bytes: number): string {
    if (bytes === 0) return '0 B';
    const k = 1024;
    const sizes = ['B', 'KB', 'MB', 'GB', 'TB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return `${parseFloat((bytes / Math.pow(k, i)).toFixed(2))} ${sizes[i]}`;
}
