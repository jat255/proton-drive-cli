import { Command } from 'commander';
import path from 'path';
import fs from 'fs';
import { NodeType } from '@protontech/drive-sdk';
import type { ProtonDriveClient } from '@protontech/drive-sdk';
import { createClient } from '../sdk/client';
import { uploadFile } from '../sdk/upload';
import { resolveFolderPath, resolveOrCreateFolderPath, looksLikePath } from '../sdk/path';
import { defaultConfigPath } from '../config/config';
import { formatBytes } from '../utils/format';

interface RemoteFile {
    uid: string;
    size: number | undefined;
}

interface SyncStats {
    uploaded: number;
    skipped: number;
    deleted: number;
    errors: number;
}

interface SyncOpts {
    delete: boolean;
    dryRun: boolean;
    verbose: boolean;
}

async function listRemoteChildren(
    client: ProtonDriveClient,
    folderUid: string | undefined,
): Promise<{ files: Map<string, RemoteFile>; folders: Map<string, string> }> {
    const files = new Map<string, RemoteFile>();
    const folders = new Map<string, string>();

    if (!folderUid) return { files, folders };

    for await (const node of client.iterateFolderChildren(folderUid)) {
        if (!node.ok) continue;
        const n = node.value;
        if (n.type === NodeType.Folder) {
            folders.set(n.name, n.uid);
        } else {
            files.set(n.name, { uid: n.uid, size: n.activeRevision?.claimedSize });
        }
    }

    return { files, folders };
}

async function syncDirectory(
    client: ProtonDriveClient,
    localDir: string,
    remoteFolderUid: string | undefined,
    opts: SyncOpts,
    stats: SyncStats,
    prefix: string,
): Promise<void> {
    const { files: remoteFiles, folders: remoteFolders } = await listRemoteChildren(client, remoteFolderUid);

    const localEntries = fs.readdirSync(localDir, { withFileTypes: true });
    const localFileNames = new Set(localEntries.filter(e => e.isFile()).map(e => e.name));
    const localDirNames = new Set(localEntries.filter(e => e.isDirectory()).map(e => e.name));

    for (const entry of localEntries) {
        if (!entry.isFile()) continue;

        const localPath = path.join(localDir, entry.name);
        const localSize = fs.statSync(localPath).size;
        const displayPath = prefix ? `${prefix}/${entry.name}` : entry.name;
        const remote = remoteFiles.get(entry.name);

        if (remote && remote.size === localSize) {
            if (opts.verbose) console.log(`  skip   ${displayPath}`);
            stats.skipped++;
            continue;
        }

        const verb = remote ? 'update' : 'upload';

        if (opts.dryRun) {
            console.log(`  ${verb}  ${displayPath} (${formatBytes(localSize)})`);
            stats.uploaded++;
            continue;
        }

        process.stdout.write(`  ${verb}  ${displayPath} (${formatBytes(localSize)}) ...`);

        if (remote) {
            let trashFailed = false;
            for await (const result of client.trashNodes([remote.uid])) {
                if (!result.ok) {
                    console.log(` error: could not remove old version`);
                    stats.errors++;
                    trashFailed = true;
                }
            }
            if (trashFailed) continue;
        }

        try {
            await uploadFile(client, localPath, remoteFolderUid!, entry.name, localSize);
            console.log(' done');
            stats.uploaded++;
        } catch (err) {
            console.log(` error: ${(err as Error).message}`);
            stats.errors++;
        }
    }

    for (const entry of localEntries) {
        if (!entry.isDirectory()) continue;

        const localSubdir = path.join(localDir, entry.name);
        const displayPath = prefix ? `${prefix}/${entry.name}` : entry.name;
        let subFolderUid = remoteFolders.get(entry.name);

        if (!subFolderUid) {
            if (opts.dryRun) {
                console.log(`  mkdir  ${displayPath}/`);
                continue;
            }
            process.stdout.write(`  mkdir  ${displayPath}/ ...`);
            const result = await client.createFolder(remoteFolderUid!, entry.name);
            if (!result.ok) {
                console.log(` error: ${result.error}`);
                stats.errors++;
                continue;
            }
            subFolderUid = result.value.uid;
            console.log(' done');
        }

        await syncDirectory(client, localSubdir, subFolderUid, opts, stats, displayPath);
    }

    if (!opts.delete) return;

    const toTrash: string[] = [];

    for (const [name, remote] of remoteFiles) {
        if (localFileNames.has(name)) continue;
        const displayPath = prefix ? `${prefix}/${name}` : name;
        if (opts.dryRun) {
            console.log(`  delete ${displayPath}`);
            stats.deleted++;
        } else {
            toTrash.push(remote.uid);
            if (opts.verbose) console.log(`  delete ${displayPath}`);
        }
    }

    for (const [name, uid] of remoteFolders) {
        if (localDirNames.has(name)) continue;
        const displayPath = prefix ? `${prefix}/${name}` : name;
        if (opts.dryRun) {
            console.log(`  delete ${displayPath}/`);
            stats.deleted++;
        } else {
            toTrash.push(uid);
            if (opts.verbose) console.log(`  delete ${displayPath}/`);
        }
    }

    if (toTrash.length > 0) {
        for await (const result of client.trashNodes(toTrash)) {
            if (result.ok) {
                stats.deleted++;
            } else {
                console.error(`  error: trash failed for a remote node`);
                stats.errors++;
            }
        }
    }
}

export const syncCommand = new Command('sync')
    .description('Sync a local directory to Proton Drive')
    .argument('<local-dir>', 'Local directory to sync from')
    .argument('<remote-path>', 'Remote folder path or UID (e.g. "Backups/Photos")')
    .option('--delete', 'Trash remote files not present locally')
    .option('--dry-run', 'Show what would happen without making changes')
    .option('-c, --config <path>', 'Path to config file', defaultConfigPath())
    .option('-v, --verbose', 'Enable verbose logging')
    .action(async (localDir: string, remotePath: string, options) => {
        try {
            if (!fs.existsSync(localDir)) {
                console.error(`Directory not found: ${localDir}`);
                process.exit(1);
            }
            if (!fs.statSync(localDir).isDirectory()) {
                console.error(`Not a directory: ${localDir}`);
                process.exit(1);
            }

            const client = await createClient(options.config, options.verbose);

            const opts: SyncOpts = {
                delete: !!options.delete,
                dryRun: !!options.dryRun,
                verbose: !!options.verbose,
            };

            let remoteFolderUid: string | undefined;
            if (looksLikePath(remotePath)) {
                if (opts.dryRun) {
                    try {
                        remoteFolderUid = await resolveFolderPath(client, remotePath);
                    } catch {
                        console.log(`[dry-run] Remote path does not exist yet, would be created: ${remotePath}\n`);
                    }
                } else {
                    remoteFolderUid = await resolveOrCreateFolderPath(client, remotePath);
                }
            } else {
                remoteFolderUid = remotePath;
            }

            if (opts.dryRun) console.log('[dry-run] No changes will be made\n');
            console.log(`Syncing ${localDir} -> ${remotePath}\n`);

            const stats: SyncStats = { uploaded: 0, skipped: 0, deleted: 0, errors: 0 };
            await syncDirectory(client, localDir, remoteFolderUid, opts, stats, '');

            console.log(
                `\nDone. uploaded=${stats.uploaded} skipped=${stats.skipped} deleted=${stats.deleted} errors=${stats.errors}`,
            );

            if (stats.errors > 0) process.exit(1);
        } catch (error) {
            console.error('Error:', (error as Error).message);
            process.exit(1);
        }
    });
