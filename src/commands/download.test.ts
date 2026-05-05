import { NodeType } from '@protontech/drive-sdk';
import { downloadCommand } from './download';

jest.mock('../sdk/client');
jest.mock('../config/config', () => ({ defaultConfigPath: () => '/fake/config' }));
jest.mock('fs', () => ({
    ...jest.requireActual('fs'),
    createWriteStream: jest.fn(() => ({ on: jest.fn(), write: jest.fn(), end: jest.fn() })),
    statSync: jest.fn(() => ({ isDirectory: () => false })),
}));
// Writable.toWeb is used to bridge Node streams to Web Streams; stub it out
jest.mock('stream', () => ({
    ...jest.requireActual('stream'),
    Writable: { toWeb: jest.fn(() => ({})) },
}));

const { createClient } = require('../sdk/client');

function makeNode(uid: string, name: string, type = NodeType.File) {
    return { uid, name, type, activeRevision: { claimedSize: 1024 } };
}

function makeDownloader() {
    return {
        downloadToStream: jest.fn(() => ({
            completion: jest.fn().mockResolvedValue(undefined),
            isDownloadCompleteWithSignatureIssues: jest.fn(() => false),
        })),
    };
}

function makeMockClient(overrides: Record<string, any> = {}) {
    return {
        getMyFilesRootFolder: jest.fn().mockResolvedValue({ ok: true, value: makeNode('root-uid', 'root', NodeType.Folder) }),
        iterateFolderChildren: jest.fn(async function* () {}),
        getNode: jest.fn().mockResolvedValue({ ok: true, value: makeNode('file-uid', 'photo.jpg') }),
        getFileDownloader: jest.fn().mockResolvedValue(makeDownloader()),
        ...overrides,
    };
}

describe('download command', () => {
    let exitSpy: jest.SpyInstance;

    beforeEach(() => {
        jest.clearAllMocks();
        exitSpy = jest.spyOn(process, 'exit').mockImplementation(code => {
            throw Object.assign(new Error(`EXIT:${code}`), { isExit: true });
        });
        jest.spyOn(console, 'error').mockImplementation(() => {});
        jest.spyOn(console, 'log').mockImplementation(() => {});
        jest.spyOn(process.stdout, 'write').mockImplementation(() => true);
    });

    afterEach(() => {
        jest.restoreAllMocks();
    });

    it('uses a UID directly without path resolution', async () => {
        const client = makeMockClient();
        createClient.mockResolvedValue(client);

        await downloadCommand.parseAsync(['node', 'test', 'file==']);

        expect(client.getNode).toHaveBeenCalledWith('file==');
        expect(client.getFileDownloader).toHaveBeenCalledWith('file==');
        // iterateFolderChildren should not be called (no path resolution)
        expect(client.iterateFolderChildren).not.toHaveBeenCalled();
    });

    it('resolves a path before downloading', async () => {
        const fileNode = makeNode('resolved-uid', 'photo.jpg');
        const client = makeMockClient({
            iterateFolderChildren: jest.fn(async function* () {
                yield { ok: true, value: fileNode };
            }),
            getNode: jest.fn().mockResolvedValue({ ok: true, value: fileNode }),
            getFileDownloader: jest.fn().mockResolvedValue(makeDownloader()),
        });
        createClient.mockResolvedValue(client);

        await downloadCommand.parseAsync(['node', 'test', 'photo.jpg']);

        // Path resolution hits iterateFolderChildren, then getNode is called with resolved uid
        expect(client.iterateFolderChildren).toHaveBeenCalled();
        expect(client.getNode).toHaveBeenCalledWith('resolved-uid');
        expect(client.getFileDownloader).toHaveBeenCalledWith('resolved-uid');
    });

    it('exits with error when node is not found', async () => {
        const client = makeMockClient({
            getNode: jest.fn().mockResolvedValue({
                ok: false,
                error: { name: { ok: true, value: 'photo.jpg' } },
            }),
        });
        createClient.mockResolvedValue(client);

        await expect(
            downloadCommand.parseAsync(['node', 'test', 'file=='])
        ).rejects.toMatchObject({ isExit: true });

        expect(exitSpy).toHaveBeenCalledWith(1);
    });
});
