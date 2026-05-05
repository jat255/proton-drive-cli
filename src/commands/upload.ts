import { Command } from 'commander';
import path from 'path';
import fs from 'fs';
import { createClient } from '../sdk/client';
import { uploadFile } from '../sdk/upload';
import { formatBytes } from '../utils/format';
import { resolveFolderPath, looksLikePath } from '../sdk/path';
import { defaultConfigPath } from '../config/config';

export const uploadCommand = new Command('upload')
    .description('Upload a file to Proton Drive')
    .argument('<file>', 'Path to the file to upload')
    .option('-p, --parent <uid|path>', 'Parent folder UID or path (e.g. "Photos/2024"), defaults to My Files root')
    .option('-n, --name <name>', 'Name for the uploaded file (defaults to filename)')
    .option('-c, --config <path>', 'Path to config file', defaultConfigPath())
    .option('-v, --verbose', 'Enable verbose logging')
    .action(async (filePath: string, options) => {
        try {
            if (!fs.existsSync(filePath)) {
                console.error(`File not found: ${filePath}`);
                process.exit(1);
            }

            const client = await createClient(options.config, options.verbose);
            const fileStats = fs.statSync(filePath);
            const fileName = options.name || path.basename(filePath);

            let parentFolderUid: string;
            if (!options.parent) {
                const rootFolder = await client.getMyFilesRootFolder();
                if (!rootFolder.ok) {
                    console.error('Could not get root folder:', rootFolder.error);
                    process.exit(1);
                }
                parentFolderUid = rootFolder.value.uid;
            } else if (looksLikePath(options.parent)) {
                parentFolderUid = await resolveFolderPath(client, options.parent);
            } else {
                parentFolderUid = options.parent;
            }

            console.log(`Uploading ${fileName} (${formatBytes(fileStats.size)})...`);

            const result = await uploadFile(client, filePath, parentFolderUid, fileName, fileStats.size, (uploadedBytes) => {
                const percent = Math.round((uploadedBytes / fileStats.size) * 100);
                process.stdout.write(`\rUploading: ${percent}% (${formatBytes(uploadedBytes)}/${formatBytes(fileStats.size)})`);
            });

            console.log(`\nUploaded successfully`);
            console.log(`Node UID: ${result.nodeUid}`);
        } catch (error) {
            console.error('\nError uploading file:', (error as Error).message);
            process.exit(1);
        }
    });
