import { NodeType } from '@protontech/drive-sdk';
import { resolveFolderPath, resolveNodePath, looksLikePath } from './path';

// Minimal node factory - only the fields path.ts actually reads
function makeNode(uid: string, name: string, type: NodeType) {
    return { uid, name, type };
}

async function* nodes(...items: ReturnType<typeof makeNode>[]): AsyncGenerator<any> {
    for (const item of items) yield { ok: true, value: item };
}

function makeClient(root: string, childrenByUid: Record<string, ReturnType<typeof makeNode>[]>) {
    return {
        getMyFilesRootFolder: jest.fn().mockResolvedValue({ ok: true, value: makeNode(root, 'root', NodeType.Folder) }),
        iterateFolderChildren: jest.fn((uid: string) => nodes(...(childrenByUid[uid] ?? []))),
    } as any;
}

describe('looksLikePath', () => {
    it('recognizes slash-separated paths', () => {
        expect(looksLikePath('Photos/2024')).toBe(true);
    });

    it('treats plain words without == as paths', () => {
        expect(looksLikePath('Photos')).toBe(true);
    });

    it('treats strings with == as UIDs', () => {
        expect(looksLikePath('abc123==')).toBe(false);
        expect(looksLikePath('xyz==')).toBe(false);
    });
});

describe('resolveFolderPath', () => {
    it('returns root uid for empty path', async () => {
        const client = makeClient('root-uid', {});
        expect(await resolveFolderPath(client, '')).toBe('root-uid');
    });

    it('resolves a single folder', async () => {
        const client = makeClient('root-uid', {
            'root-uid': [makeNode('photos-uid', 'Photos', NodeType.Folder)],
        });
        expect(await resolveFolderPath(client, 'Photos')).toBe('photos-uid');
    });

    it('resolves a nested path', async () => {
        const client = makeClient('root-uid', {
            'root-uid': [makeNode('photos-uid', 'Photos', NodeType.Folder)],
            'photos-uid': [makeNode('album-uid', '2024', NodeType.Folder)],
        });
        expect(await resolveFolderPath(client, 'Photos/2024')).toBe('album-uid');
    });

    it('throws when a folder segment is not found', async () => {
        const client = makeClient('root-uid', { 'root-uid': [] });
        await expect(resolveFolderPath(client, 'Missing')).rejects.toThrow('Missing');
    });

    it('does not match files on intermediate segments', async () => {
        const client = makeClient('root-uid', {
            'root-uid': [makeNode('file-uid', 'Photos', NodeType.File)],
        });
        await expect(resolveFolderPath(client, 'Photos')).rejects.toThrow('Photos');
    });
});

describe('resolveNodePath', () => {
    it('resolves a file on the final segment', async () => {
        const client = makeClient('root-uid', {
            'root-uid': [
                makeNode('photos-uid', 'Photos', NodeType.Folder),
            ],
            'photos-uid': [
                makeNode('file-uid', 'photo.jpg', NodeType.File),
            ],
        });
        expect(await resolveNodePath(client, 'Photos/photo.jpg')).toBe('file-uid');
    });

    it('also resolves folders on the final segment', async () => {
        const client = makeClient('root-uid', {
            'root-uid': [makeNode('photos-uid', 'Photos', NodeType.Folder)],
        });
        expect(await resolveNodePath(client, 'Photos')).toBe('photos-uid');
    });

    it('throws when path does not exist', async () => {
        const client = makeClient('root-uid', { 'root-uid': [] });
        await expect(resolveNodePath(client, 'Missing/file.txt')).rejects.toThrow('Missing');
    });

    it('does not allow files on intermediate segments', async () => {
        const client = makeClient('root-uid', {
            'root-uid': [makeNode('file-uid', 'Photos', NodeType.File)],
        });
        await expect(resolveNodePath(client, 'Photos/something.txt')).rejects.toThrow('Photos');
    });
});
