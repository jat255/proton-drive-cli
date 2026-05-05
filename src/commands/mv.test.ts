import { NodeType } from '@protontech/drive-sdk';
import { mvCommand } from './mv';

jest.mock('../sdk/client');
jest.mock('../config/config', () => ({ defaultConfigPath: () => '/fake/config' }));

const { createClient } = require('../sdk/client');

async function* gen<T>(...items: T[]): AsyncGenerator<T> {
    for (const item of items) yield item;
}

function makeNode(uid: string, name: string, type = NodeType.File, parentUid = 'parent-uid') {
    return { uid, name, type, parentUid };
}

function makeMockClient(overrides: Record<string, any> = {}) {
    return {
        getMyFilesRootFolder: jest.fn().mockResolvedValue({ ok: true, value: makeNode('root-uid', 'root', NodeType.Folder, '') }),
        iterateFolderChildren: jest.fn(() => gen()),
        getNode: jest.fn(),
        moveNodes: jest.fn(() => gen<any>({ uid: 'src==', ok: true })),
        renameNode: jest.fn().mockResolvedValue({ ok: true, value: makeNode('src==', 'new-name') }),
        ...overrides,
    };
}

describe('mv command', () => {
    let exitSpy: jest.SpyInstance;

    beforeEach(() => {
        jest.clearAllMocks();
        exitSpy = jest.spyOn(process, 'exit').mockImplementation(code => {
            throw Object.assign(new Error(`EXIT:${code}`), { isExit: true });
        });
        jest.spyOn(console, 'error').mockImplementation(() => {});
        jest.spyOn(console, 'log').mockImplementation(() => {});
    });

    afterEach(() => {
        jest.restoreAllMocks();
    });

    it('moves a node into an existing destination folder', async () => {
        const srcNode = makeNode('src-uid', 'file.txt', NodeType.File, 'parent-a==');
        const destFolder = makeNode('dest-uid', 'Archive', NodeType.Folder, 'root-uid');
        const client = makeMockClient({
            getNode: jest.fn().mockResolvedValue({ ok: true, value: srcNode }),
            iterateFolderChildren: jest.fn(() => gen({ ok: true, value: destFolder })),
        });
        createClient.mockResolvedValue(client);

        // 'src==' is a UID (has ==), 'Archive' is a path that resolves to dest-uid
        await mvCommand.parseAsync(['node', 'test', 'src==', 'Archive']);

        // sourceUid stays as 'src==' (the UID string); SDK accepts UIDs directly
        expect(client.moveNodes).toHaveBeenCalledWith(['src=='], 'dest-uid');
        expect(client.renameNode).not.toHaveBeenCalled();
    });

    it('renames within the same parent when destination is a non-existent single segment', async () => {
        const srcNode = makeNode('src-uid', 'old.txt', NodeType.File, 'parent==');
        const client = makeMockClient({
            getNode: jest.fn().mockResolvedValue({ ok: true, value: srcNode }),
            iterateFolderChildren: jest.fn(() => gen()), // 'new.txt' not found → falls to rename
        });
        createClient.mockResolvedValue(client);

        await mvCommand.parseAsync(['node', 'test', 'src==', 'new.txt']);

        expect(client.renameNode).toHaveBeenCalledWith('src==', 'new.txt');
        expect(client.moveNodes).not.toHaveBeenCalled();
    });

    it('moves and renames when destination path ends in a new name', async () => {
        const srcNode = makeNode('src-uid', 'file.txt', NodeType.File, 'parent-a==');
        const destParent = makeNode('dest-parent-uid', 'Archive', NodeType.Folder, 'root-uid');
        const client = makeMockClient({
            getNode: jest.fn().mockResolvedValue({ ok: true, value: srcNode }),
            iterateFolderChildren: jest.fn((uid: string) => {
                if (uid === 'root-uid') return gen({ ok: true, value: destParent });
                return gen(); // 'newfile.txt' does not exist under Archive
            }),
        });
        createClient.mockResolvedValue(client);

        await mvCommand.parseAsync(['node', 'test', 'src==', 'Archive/newfile.txt']);

        expect(client.moveNodes).toHaveBeenCalledWith(['src=='], 'dest-parent-uid');
        expect(client.renameNode).toHaveBeenCalledWith('src==', 'newfile.txt');
    });

    it('does nothing when source name and parent match the destination', async () => {
        // source: 'src==' with name='file.txt', parentUid='parent=='
        // destination: 'file.txt' (single segment, not found → same-parent rename, but name is unchanged)
        const srcNode = makeNode('src-uid', 'file.txt', NodeType.File, 'parent==');
        const client = makeMockClient({
            getNode: jest.fn().mockResolvedValue({ ok: true, value: srcNode }),
            iterateFolderChildren: jest.fn(() => gen()), // nothing found, so resolveNodePath throws
        });
        createClient.mockResolvedValue(client);

        await mvCommand.parseAsync(['node', 'test', 'src==', 'file.txt']);

        expect(client.moveNodes).not.toHaveBeenCalled();
        expect(client.renameNode).not.toHaveBeenCalled();
    });

    it('exits with error when moveNodes fails', async () => {
        const srcNode = makeNode('src-uid', 'file.txt', NodeType.File, 'parent-a==');
        const destFolder = makeNode('dest-uid', 'Archive', NodeType.Folder, 'root-uid');
        const client = makeMockClient({
            getNode: jest.fn().mockResolvedValue({ ok: true, value: srcNode }),
            iterateFolderChildren: jest.fn(() => gen({ ok: true, value: destFolder })),
            moveNodes: jest.fn(() => gen<any>({ uid: 'src==', ok: false, error: new Error('move failed') })),
        });
        createClient.mockResolvedValue(client);

        await expect(
            mvCommand.parseAsync(['node', 'test', 'src==', 'Archive'])
        ).rejects.toMatchObject({ isExit: true });

        expect(exitSpy).toHaveBeenCalledWith(1);
    });
});
