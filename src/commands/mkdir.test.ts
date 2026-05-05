import { NodeType } from '@protontech/drive-sdk';
import { mkdirCommand } from './mkdir';

jest.mock('../sdk/client');
jest.mock('../config/config', () => ({ defaultConfigPath: () => '/fake/config' }));

const { createClient } = require('../sdk/client');

async function* gen<T>(...items: T[]): AsyncGenerator<T> {
    for (const item of items) yield item;
}

function makeNode(uid: string, name: string, type = NodeType.Folder) {
    return { uid, name, type };
}

function makeMockClient(overrides: Record<string, any> = {}) {
    return {
        getMyFilesRootFolder: jest.fn().mockResolvedValue({ ok: true, value: makeNode('root-uid', 'root') }),
        iterateFolderChildren: jest.fn(() => gen()),
        createFolder: jest.fn().mockResolvedValue({ ok: true, value: makeNode('new-uid', 'NewFolder') }),
        ...overrides,
    };
}

describe('mkdir command', () => {
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

    it('creates a folder at root when given a plain name', async () => {
        const client = makeMockClient();
        createClient.mockResolvedValue(client);

        await mkdirCommand.parseAsync(['node', 'test', 'NewFolder']);

        expect(client.createFolder).toHaveBeenCalledWith('root-uid', 'NewFolder');
    });

    it('resolves parent from path and creates the leaf folder', async () => {
        const client = makeMockClient({
            iterateFolderChildren: jest.fn(() =>
                gen({ ok: true, value: makeNode('photos-uid', 'Photos') })
            ),
        });
        createClient.mockResolvedValue(client);

        await mkdirCommand.parseAsync(['node', 'test', 'Photos/NewAlbum']);

        expect(client.createFolder).toHaveBeenCalledWith('photos-uid', 'NewAlbum');
    });

    it('uses --parent UID directly', async () => {
        const client = makeMockClient();
        createClient.mockResolvedValue(client);

        await mkdirCommand.parseAsync(['node', 'test', 'NewFolder', '--parent', 'parent==']);

        expect(client.createFolder).toHaveBeenCalledWith('parent==', 'NewFolder');
    });

    it('resolves --parent path', async () => {
        const client = makeMockClient({
            iterateFolderChildren: jest.fn(() =>
                gen({ ok: true, value: makeNode('photos-uid', 'Photos') })
            ),
        });
        createClient.mockResolvedValue(client);

        await mkdirCommand.parseAsync(['node', 'test', 'NewAlbum', '--parent', 'Photos']);

        expect(client.createFolder).toHaveBeenCalledWith('photos-uid', 'NewAlbum');
    });

    it('exits with error when createFolder fails', async () => {
        const client = makeMockClient({
            createFolder: jest.fn().mockResolvedValue({
                ok: false,
                error: { name: { ok: true, value: 'NewFolder' } },
            }),
        });
        createClient.mockResolvedValue(client);

        await expect(
            mkdirCommand.parseAsync(['node', 'test', 'NewFolder'])
        ).rejects.toMatchObject({ isExit: true });

        expect(exitSpy).toHaveBeenCalledWith(1);
    });
});
