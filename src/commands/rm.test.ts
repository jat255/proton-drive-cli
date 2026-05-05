import { NodeType } from '@protontech/drive-sdk';
import { rmCommand } from './rm';

jest.mock('../sdk/client');
jest.mock('../config/config', () => ({ defaultConfigPath: () => '/fake/config' }));

const { createClient } = require('../sdk/client');

// Helper: async generator from a list of already-resolved items
async function* gen<T>(...items: T[]): AsyncGenerator<T> {
    for (const item of items) yield item;
}

function makeNode(uid: string, name: string, type = NodeType.File) {
    return { uid, name, type, parentUid: 'parent-uid' };
}

function makeMockClient(overrides: Record<string, any> = {}) {
    return {
        getMyFilesRootFolder: jest.fn().mockResolvedValue({ ok: true, value: makeNode('root-uid', 'root', NodeType.Folder) }),
        iterateFolderChildren: jest.fn(() => gen()),
        trashNodes: jest.fn(() => gen<any>({ uid: 'node-uid', ok: true })),
        deleteNodes: jest.fn(() => gen<any>({ uid: 'node-uid', ok: true })),
        ...overrides,
    };
}

describe('rm command', () => {
    let exitSpy: jest.SpyInstance;
    let consoleSpy: jest.SpyInstance;

    beforeEach(() => {
        jest.clearAllMocks();
        exitSpy = jest.spyOn(process, 'exit').mockImplementation(code => {
            throw Object.assign(new Error(`EXIT:${code}`), { isExit: true });
        });
        consoleSpy = jest.spyOn(console, 'error').mockImplementation(() => {});
        jest.spyOn(console, 'log').mockImplementation(() => {});
    });

    afterEach(() => {
        exitSpy.mockRestore();
        consoleSpy.mockRestore();
        jest.restoreAllMocks();
    });

    it('trashes a node by UID', async () => {
        const client = makeMockClient();
        createClient.mockResolvedValue(client);

        await rmCommand.parseAsync(['node', 'test', 'abc==']);

        expect(client.trashNodes).toHaveBeenCalledWith(['abc==']);
        expect(client.deleteNodes).not.toHaveBeenCalled();
    });

    it('resolves a path and trashes the node', async () => {
        const client = makeMockClient({
            getMyFilesRootFolder: jest.fn().mockResolvedValue({ ok: true, value: makeNode('root-uid', 'root', NodeType.Folder) }),
            iterateFolderChildren: jest.fn(() => gen({ ok: true, value: makeNode('file-uid', 'file.txt') })),
            trashNodes: jest.fn(() => gen<any>({ uid: 'file-uid', ok: true })),
        });
        createClient.mockResolvedValue(client);

        await rmCommand.parseAsync(['node', 'test', 'file.txt']);

        expect(client.trashNodes).toHaveBeenCalledWith(['file-uid']);
    });

    it('trashes then permanently deletes with --permanent', async () => {
        const client = makeMockClient();
        createClient.mockResolvedValue(client);

        await rmCommand.parseAsync(['node', 'test', 'abc==', '--permanent']);

        expect(client.trashNodes).toHaveBeenCalledWith(['abc==']);
        expect(client.deleteNodes).toHaveBeenCalledWith(['abc==']);
    });

    it('exits with error when trashNodes fails', async () => {
        const client = makeMockClient({
            trashNodes: jest.fn(() => gen<any>({ uid: 'abc==', ok: false, error: 'permission denied' })),
        });
        createClient.mockResolvedValue(client);

        await expect(
            rmCommand.parseAsync(['node', 'test', 'abc=='])
        ).rejects.toMatchObject({ isExit: true });

        expect(exitSpy).toHaveBeenCalledWith(1);
    });

    it('exits with error when deleteNodes fails', async () => {
        const client = makeMockClient({
            deleteNodes: jest.fn(() => gen<any>({ uid: 'abc==', ok: false, error: 'not in trash' })),
        });
        createClient.mockResolvedValue(client);

        await expect(
            rmCommand.parseAsync(['node', 'test', 'abc==', '--permanent'])
        ).rejects.toMatchObject({ isExit: true });

        expect(exitSpy).toHaveBeenCalledWith(1);
    });
});
