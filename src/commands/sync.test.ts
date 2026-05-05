import { NodeType } from '@protontech/drive-sdk';
import { syncCommand } from './sync';

jest.mock('../sdk/client');
jest.mock('../sdk/upload');
jest.mock('../config/config', () => ({ defaultConfigPath: () => '/fake/config' }));
jest.mock('fs');

const { createClient } = require('../sdk/client');
const { uploadFile } = require('../sdk/upload');
const mockFs = require('fs') as Record<string, jest.Mock>;

async function* gen<T>(...items: T[]): AsyncGenerator<T> {
    for (const item of items) yield item;
}

function makeFileNode(uid: string, name: string, size: number) {
    return { uid, name, type: NodeType.File, activeRevision: { claimedSize: size } };
}

function makeFolderNode(uid: string, name: string) {
    return { uid, name, type: NodeType.Folder };
}

function makeDirent(name: string, isFile: boolean) {
    return { name, isFile: () => isFile, isDirectory: () => !isFile } as any;
}

function makeMockClient(overrides: Record<string, any> = {}) {
    return {
        getMyFilesRootFolder: jest.fn().mockResolvedValue({ ok: true, value: makeFolderNode('root-uid', 'root') }),
        iterateFolderChildren: jest.fn(() => gen()),
        createFolder: jest.fn().mockResolvedValue({ ok: true, value: makeFolderNode('new-uid', 'NewFolder') }),
        trashNodes: jest.fn(() => gen<any>({ ok: true })),
        ...overrides,
    };
}

describe('sync command', () => {
    let exitSpy: jest.SpyInstance;

    beforeEach(() => {
        jest.clearAllMocks();
        // Commander retains option values across parseAsync calls on the same instance
        const retained = (syncCommand as any)._optionValues;
        delete retained.delete;
        delete retained.dryRun;
        delete retained.verbose;
        exitSpy = jest.spyOn(process, 'exit').mockImplementation(code => {
            throw Object.assign(new Error(`EXIT:${code}`), { isExit: true });
        });
        jest.spyOn(console, 'log').mockImplementation(() => {});
        jest.spyOn(console, 'error').mockImplementation(() => {});
        jest.spyOn(process.stdout, 'write').mockImplementation(() => true);

        mockFs.existsSync.mockReturnValue(true);
        mockFs.statSync.mockImplementation((p: any) => ({
            isDirectory: () => p === '/local/dir',
            size: 100,
        })) as any;
        mockFs.readdirSync.mockReturnValue([]);
        uploadFile.mockResolvedValue({ nodeUid: 'new-node', nodeRevisionUid: 'rev' });
    });

    afterEach(() => {
        jest.restoreAllMocks();
    });

    it('exits with error when local directory does not exist', async () => {
        mockFs.existsSync.mockReturnValue(false);
        const client = makeMockClient();
        createClient.mockResolvedValue(client);

        await expect(
            syncCommand.parseAsync(['node', 'test', '/local/dir', 'remote=='])
        ).rejects.toMatchObject({ isExit: true });

        expect(exitSpy).toHaveBeenCalledWith(1);
    });

    it('exits with error when local path is not a directory', async () => {
        mockFs.statSync.mockReturnValue({ isDirectory: () => false, size: 100 } as any);
        const client = makeMockClient();
        createClient.mockResolvedValue(client);

        await expect(
            syncCommand.parseAsync(['node', 'test', '/local/dir', 'remote=='])
        ).rejects.toMatchObject({ isExit: true });

        expect(exitSpy).toHaveBeenCalledWith(1);
    });

    it('skips a file when remote has the same name and size', async () => {
        mockFs.readdirSync.mockReturnValue([makeDirent('file.txt', true)]);
        mockFs.statSync.mockImplementation((p: any) => ({
            isDirectory: () => p === '/local/dir',
            size: 100,
        })) as any;

        const client = makeMockClient({
            iterateFolderChildren: jest.fn(() =>
                gen({ ok: true, value: makeFileNode('file-uid', 'file.txt', 100) })
            ),
        });
        createClient.mockResolvedValue(client);

        await syncCommand.parseAsync(['node', 'test', '/local/dir', 'remote==']);

        expect(uploadFile).not.toHaveBeenCalled();
        expect(client.trashNodes).not.toHaveBeenCalled();
    });

    it('uploads a new file not present remotely', async () => {
        mockFs.readdirSync.mockReturnValue([makeDirent('file.txt', true)]);
        mockFs.statSync.mockImplementation((p: any) => ({
            isDirectory: () => p === '/local/dir',
            size: 200,
        })) as any;

        const client = makeMockClient({
            iterateFolderChildren: jest.fn(() => gen()),
        });
        createClient.mockResolvedValue(client);

        await syncCommand.parseAsync(['node', 'test', '/local/dir', 'remote==']);

        expect(uploadFile).toHaveBeenCalledWith(
            client, '/local/dir/file.txt', 'remote==', 'file.txt', 200
        );
        expect(client.trashNodes).not.toHaveBeenCalled();
    });

    it('trashes old version and re-uploads when size differs', async () => {
        mockFs.readdirSync.mockReturnValue([makeDirent('file.txt', true)]);
        mockFs.statSync.mockImplementation((p: any) => ({
            isDirectory: () => p === '/local/dir',
            size: 200,
        })) as any;

        const client = makeMockClient({
            iterateFolderChildren: jest.fn(() =>
                gen({ ok: true, value: makeFileNode('old-uid', 'file.txt', 100) })
            ),
        });
        createClient.mockResolvedValue(client);

        await syncCommand.parseAsync(['node', 'test', '/local/dir', 'remote==']);

        expect(client.trashNodes).toHaveBeenCalledWith(['old-uid']);
        expect(uploadFile).toHaveBeenCalledWith(
            client, '/local/dir/file.txt', 'remote==', 'file.txt', 200
        );
    });

    it('creates a remote subfolder and recurses into it', async () => {
        mockFs.readdirSync.mockImplementation((p: any) => {
            if (p === '/local/dir') return [makeDirent('subdir', false)];
            if (p === '/local/dir/subdir') return [];
            return [];
        }) as any;
        mockFs.statSync.mockImplementation((p: any) => ({
            isDirectory: () => true,
            size: 0,
        })) as any;

        const client = makeMockClient({
            iterateFolderChildren: jest.fn(() => gen()),
        });
        createClient.mockResolvedValue(client);

        await syncCommand.parseAsync(['node', 'test', '/local/dir', 'remote==']);

        expect(client.createFolder).toHaveBeenCalledWith('remote==', 'subdir');
        // iterateFolderChildren called for root + the new subfolder
        expect(client.iterateFolderChildren).toHaveBeenCalledTimes(2);
    });

    it('uses existing remote subfolder without creating a new one', async () => {
        mockFs.readdirSync.mockImplementation((p: any) => {
            if (p === '/local/dir') return [makeDirent('subdir', false)];
            if (p === '/local/dir/subdir') return [];
            return [];
        }) as any;

        const client = makeMockClient({
            iterateFolderChildren: jest.fn(() =>
                gen({ ok: true, value: makeFolderNode('existing-subdir-uid', 'subdir') })
            ),
        });
        createClient.mockResolvedValue(client);

        await syncCommand.parseAsync(['node', 'test', '/local/dir', 'remote==']);

        expect(client.createFolder).not.toHaveBeenCalled();
    });

    it('trashes remote-only files when --delete is set', async () => {
        mockFs.readdirSync.mockReturnValue([]);

        const client = makeMockClient({
            iterateFolderChildren: jest.fn(() =>
                gen({ ok: true, value: makeFileNode('orphan-uid', 'orphan.txt', 50) })
            ),
        });
        createClient.mockResolvedValue(client);

        await syncCommand.parseAsync(['node', 'test', '/local/dir', 'remote==', '--delete']);

        expect(client.trashNodes).toHaveBeenCalledWith(['orphan-uid']);
    });

    it('does not trash remote-only files without --delete', async () => {
        mockFs.readdirSync.mockReturnValue([]);

        const client = makeMockClient({
            iterateFolderChildren: jest.fn(() =>
                gen({ ok: true, value: makeFileNode('orphan-uid', 'orphan.txt', 50) })
            ),
        });
        createClient.mockResolvedValue(client);

        await syncCommand.parseAsync(['node', 'test', '/local/dir', 'remote==']);

        expect(client.trashNodes).not.toHaveBeenCalled();
    });

    it('makes no API calls in --dry-run mode', async () => {
        mockFs.readdirSync.mockReturnValue([makeDirent('file.txt', true)]);
        mockFs.statSync.mockImplementation((p: any) => ({
            isDirectory: () => p === '/local/dir',
            size: 999,
        })) as any;

        const client = makeMockClient({
            iterateFolderChildren: jest.fn(() => gen()),
        });
        createClient.mockResolvedValue(client);

        await syncCommand.parseAsync(['node', 'test', '/local/dir', 'remote==', '--dry-run']);

        expect(uploadFile).not.toHaveBeenCalled();
        expect(client.trashNodes).not.toHaveBeenCalled();
        expect(client.createFolder).not.toHaveBeenCalled();
    });

    it('counts errors and exits with code 1 when an upload fails', async () => {
        mockFs.readdirSync.mockReturnValue([makeDirent('file.txt', true)]);
        mockFs.statSync.mockImplementation((p: any) => ({
            isDirectory: () => p === '/local/dir',
            size: 100,
        })) as any;

        uploadFile.mockRejectedValue(new Error('network error'));

        const client = makeMockClient({
            iterateFolderChildren: jest.fn(() => gen()),
        });
        createClient.mockResolvedValue(client);

        await expect(
            syncCommand.parseAsync(['node', 'test', '/local/dir', 'remote=='])
        ).rejects.toMatchObject({ isExit: true });

        expect(exitSpy).toHaveBeenCalledWith(1);
    });
});
