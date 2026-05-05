import { Command } from 'commander';
import { createClient } from '../sdk/client';
import { resolveFolderPath, looksLikePath } from '../sdk/path';
import { defaultConfigPath } from '../config/config';

export const mkdirCommand = new Command('mkdir')
    .description('Create a folder in Proton Drive')
    .argument('<name-or-path>', 'Folder name or path (e.g. "Photos/2024/New Album")')
    .option('-p, --parent <uid|path>', 'Parent folder UID or path; overrides path resolution from the argument')
    .option('-c, --config <path>', 'Path to config file', defaultConfigPath())
    .option('-v, --verbose', 'Enable verbose logging')
    .action(async (nameOrPath: string, options) => {
        try {
            const client = await createClient(options.config, options.verbose);

            let parentUid: string;
            let folderName: string;

            if (options.parent) {
                // Explicit parent: resolve it, use the argument as the folder name
                parentUid = looksLikePath(options.parent)
                    ? await resolveFolderPath(client, options.parent)
                    : options.parent;
                folderName = nameOrPath;
            } else if (nameOrPath.includes('/')) {
                // Path argument: split into parent path + leaf name
                const lastSlash = nameOrPath.lastIndexOf('/');
                const parentPath = nameOrPath.slice(0, lastSlash);
                folderName = nameOrPath.slice(lastSlash + 1);
                parentUid = await resolveFolderPath(client, parentPath);
            } else {
                // Plain name: create at root
                const rootFolder = await client.getMyFilesRootFolder();
                if (!rootFolder.ok) {
                    console.error('Could not get root folder');
                    process.exit(1);
                }
                parentUid = rootFolder.value.uid;
                folderName = nameOrPath;
            }

            if (!folderName) {
                console.error('Folder name cannot be empty');
                process.exit(1);
            }

            const result = await client.createFolder(parentUid, folderName);
            if (!result.ok) {
                const nameResult = result.error.name;
                const name = nameResult.ok ? nameResult.value : folderName;
                console.error(`Failed to create folder: ${name}`);
                process.exit(1);
            }

            console.log(`Created folder: ${folderName}`);
            console.log(`Node UID: ${result.value.uid}`);
        } catch (error) {
            console.error('Error creating folder:', (error as Error).message);
            process.exit(1);
        }
    });
