import { Command } from 'commander';
import { NodeType } from '@protontech/drive-sdk';
import { createClient } from '../sdk/client';
import { resolveFolderPath, looksLikePath } from '../sdk/path';
import { defaultConfigPath } from '../config/config';
import { formatBytes } from '../utils/format';

export const listCommand = new Command('list')
    .description('List files in a Proton Drive folder')
    .argument('[folder]', 'Folder UID or path (e.g. "Photos/2024"), defaults to My Files root')
    .option('-c, --config <path>', 'Path to config file', defaultConfigPath())
    .option('-v, --verbose', 'Enable verbose logging')
    .action(async (folderUid: string | undefined, options) => {
        try {
            const client = await createClient(options.config, options.verbose);

            let targetFolderUid: string;
            if (!folderUid) {
                const rootFolder = await client.getMyFilesRootFolder();
                if (!rootFolder.ok) {
                    console.error('Could not get root folder');
                    process.exit(1);
                }
                targetFolderUid = rootFolder.value.uid;
            } else if (looksLikePath(folderUid)) {
                targetFolderUid = await resolveFolderPath(client, folderUid);
            } else {
                targetFolderUid = folderUid;
            }

            console.log(`Contents of ${targetFolderUid}:\n`);

            let count = 0;
            for await (const node of client.iterateFolderChildren(targetFolderUid)) {
                if (!node.ok) {
                    // DegradedNode: name is a Result<string, Error>
                    const nameResult = node.error.name;
                    const name = nameResult.ok ? nameResult.value : '[encrypted]';
                    console.log(`  ${name.padEnd(45)} [degraded]`);
                    count++;
                    continue;
                }

                // NodeEntity: name and activeRevision are plain values
                const n = node.value;
                const type = n.type === NodeType.Folder ? 'folder' : 'file';
                const size = n.activeRevision?.claimedSize;
                const sizeStr = size != null ? formatBytes(size) : '';

                console.log(`  ${n.name.padEnd(45)} ${type.padEnd(8)} ${sizeStr}`);
                count++;
            }

            console.log(`\nTotal: ${count} items`);
        } catch (error) {
            console.error('Error listing folder:', (error as Error).message);
            process.exit(1);
        }
    });
