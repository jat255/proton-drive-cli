import { Command } from 'commander';
import { createClient } from '../sdk/client';
import { looksLikePath, resolveNodePath, resolveFolderPath } from '../sdk/path';
import { defaultConfigPath } from '../config/config';

export const mvCommand = new Command('mv')
    .description('Move or rename a file or folder in Proton Drive')
    .argument('<source>', 'Source node UID or path')
    .argument('<destination>', 'Destination folder UID or path; if the last segment does not exist it becomes the new name')
    .option('-c, --config <path>', 'Path to config file', defaultConfigPath())
    .option('-v, --verbose', 'Enable verbose logging')
    .action(async (source: string, destination: string, options) => {
        try {
            const client = await createClient(options.config, options.verbose);

            // Resolve source to a UID and fetch its current name + parent
            const sourceUid = looksLikePath(source) ? await resolveNodePath(client, source) : source;
            const sourceNode = await client.getNode(sourceUid);
            if (!sourceNode.ok) {
                console.error(`Could not retrieve source node: ${sourceUid}`);
                process.exit(1);
            }
            const sourceName = sourceNode.value.name;
            const sourceParentUid = sourceNode.value.parentUid ?? '';

            // Determine destination: try resolving the full path first
            let destUid: string | undefined;
            try {
                destUid = looksLikePath(destination) ? await resolveNodePath(client, destination) : destination;
            } catch {
                // Destination does not fully exist — last segment is the new name
            }

            let targetParentUid: string;
            let newName: string;

            if (destUid) {
                // Destination exists: move into it using source name
                targetParentUid = destUid;
                newName = sourceName;
            } else if (destination.includes('/')) {
                // Destination path with non-existent final segment: parent exists, leaf is new name
                const lastSlash = destination.lastIndexOf('/');
                const parentPath = destination.slice(0, lastSlash);
                newName = destination.slice(lastSlash + 1);
                targetParentUid = await resolveFolderPath(client, parentPath);
            } else {
                // Single-segment destination that doesn't exist: rename within current parent
                targetParentUid = sourceParentUid;
                newName = destination;
            }

            const needsMove = targetParentUid !== sourceParentUid;
            const needsRename = newName !== sourceName;

            if (!needsMove && !needsRename) {
                console.log('Source and destination are the same; nothing to do.');
                return;
            }

            if (needsMove) {
                for await (const result of client.moveNodes([sourceUid], targetParentUid)) {
                    if (!result.ok) {
                        console.error(`Failed to move node: ${result.error.message}`);
                        process.exit(1);
                    }
                }
            }

            if (needsRename) {
                const renameResult = await client.renameNode(sourceUid, newName);
                if (!renameResult.ok) {
                    if (needsMove) {
                        console.warn(`Node was moved but rename failed. It is now at its destination with its original name "${sourceName}".`);
                    }
                    console.error('Failed to rename node');
                    process.exit(1);
                }
            }

            console.log(`Done: ${source} -> ${destination}`);
        } catch (error) {
            console.error('Error moving node:', (error as Error).message);
            process.exit(1);
        }
    });
