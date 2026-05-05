import { Command } from 'commander';
import { createClient } from '../sdk/client';
import { looksLikePath, resolveNodePath } from '../sdk/path';
import { defaultConfigPath } from '../config/config';

export const rmCommand = new Command('rm')
    .description('Remove a file or folder from Proton Drive')
    .argument('<uid-or-path>', 'Node UID or path (e.g. "Photos/2024/photo.jpg")')
    .option('--permanent', 'Permanently delete instead of moving to trash')
    .option('-c, --config <path>', 'Path to config file', defaultConfigPath())
    .option('-v, --verbose', 'Enable verbose logging')
    .action(async (uidOrPath: string, options) => {
        try {
            const client = await createClient(options.config, options.verbose);

            const nodeUid = looksLikePath(uidOrPath)
                ? await resolveNodePath(client, uidOrPath)
                : uidOrPath;

            if (options.permanent) {
                // Trash first, then permanently delete
                for await (const result of client.trashNodes([nodeUid])) {
                    if (!result.ok) {
                        console.error(`Failed to trash node: ${result.error}`);
                        process.exit(1);
                    }
                }
                for await (const result of client.deleteNodes([nodeUid])) {
                    if (!result.ok) {
                        console.error(`Failed to permanently delete node: ${result.error}`);
                        process.exit(1);
                    }
                }
                console.log(`Permanently deleted: ${uidOrPath}`);
            } else {
                for await (const result of client.trashNodes([nodeUid])) {
                    if (!result.ok) {
                        console.error(`Failed to trash node: ${result.error}`);
                        process.exit(1);
                    }
                }
                console.log(`Moved to trash: ${uidOrPath}`);
            }
        } catch (error) {
            console.error('Error removing node:', (error as Error).message);
            process.exit(1);
        }
    });
