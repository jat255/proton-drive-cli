/**
 * End-to-end tests against a real Proton Drive account.
 *
 * Required environment variables:
 *   PROTON_TEST_EMAIL     - Proton account email
 *   PROTON_TEST_PASSWORD  - Proton account password
 *
 * Run with:
 *   PROTON_TEST_EMAIL=... PROTON_TEST_PASSWORD=... npm run test:e2e
 *
 * Tests run sequentially and share a single authenticated client.
 * A unique top-level folder is created at the start and trashed at the end.
 */

import fs from 'fs';
import os from 'os';
import path from 'path';
import { Writable } from 'stream';
import type { ProtonDriveClient } from '@protontech/drive-sdk';
import { authenticate } from './auth/protonAuth';
import { saveSession } from './config/config';
import { createClient } from './sdk/client';
import { uploadFile } from './sdk/upload';

jest.setTimeout(120_000);

const E2E =
    typeof process.env.PROTON_TEST_EMAIL === 'string' &&
    typeof process.env.PROTON_TEST_PASSWORD === 'string';

if (!E2E) {
    process.stdout.write(
        '\n  E2E tests skipped -- credentials not set.\n' +
        '  To run:\n' +
        '    PROTON_TEST_EMAIL=you@proton.me PROTON_TEST_PASSWORD=yourpassword npm run test:e2e\n\n',
    );
}

function log(msg: string) {
    process.stdout.write(`  ${msg}\n`);
}

(E2E ? describe : describe.skip)('E2E: Proton Drive CLI', () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'proton-e2e-'));
    const sessionFile = path.join(tmpDir, 'session.json');
    const testFolderName = `e2e-test-${Date.now()}`;

    let client: ProtonDriveClient;
    let rootUid: string;
    let testFolderUid: string;
    let subFolderUid: string;
    let uploadedUid: string;

    const toTrash: string[] = [];

    beforeAll(async () => {
        log(`Authenticating as ${process.env.PROTON_TEST_EMAIL} ...`);
        const session = await authenticate(
            process.env.PROTON_TEST_EMAIL!,
            process.env.PROTON_TEST_PASSWORD!,
        );
        saveSession(session, sessionFile);
        log(`Session saved → ${sessionFile}`);

        client = await createClient(sessionFile);
        log('Drive client created');

        const root = await client.getMyFilesRootFolder();
        if (!root.ok) throw new Error('Could not get root folder');
        rootUid = root.value.uid;
        log(`Root folder uid: ${rootUid}`);

        log(`Creating test folder "${testFolderName}" at root ...`);
        const folder = await client.createFolder(rootUid, testFolderName);
        if (!folder.ok) throw new Error(`Could not create test folder: ${testFolderName}`);
        testFolderUid = folder.value.uid;
        toTrash.push(testFolderUid);
        log(`Test folder created → uid: ${testFolderUid}`);
    });

    afterAll(async () => {
        if (!client) return;
        if (toTrash.length === 0) {
            log('afterAll: nothing left to trash');
            return;
        }
        const reversed = [...toTrash].reverse();
        log(`afterAll: trashing ${reversed.length} remaining node(s): ${reversed.join(', ')}`);
        for await (const result of client.trashNodes(reversed)) {
            if (result.ok) {
                log(`  trashed ${result.uid}`);
            } else {
                console.warn(`  WARNING: failed to trash ${result.uid}: ${result.error}`);
            }
        }
        fs.rmSync(tmpDir, { recursive: true, force: true });
        log(`afterAll: cleaned up temp dir ${tmpDir}`);
    });

    it('lists the root folder without error', async () => {
        log(`Listing root folder (uid: ${rootUid}) ...`);
        let count = 0;
        const names: string[] = [];
        for await (const node of client.iterateFolderChildren(rootUid)) {
            count++;
            if (node.ok) names.push(`${node.value.name} [${node.value.type}]`);
            if (count >= 50) { log('  (capped at 50 items)'); break; }
        }
        log(`  Found ${count} item(s):`);
        for (const n of names) log(`    ${n}`);
        expect(count).toBeGreaterThanOrEqual(0);
    });

    it('finds the newly created test folder in the root listing', async () => {
        log(`Scanning root for "${testFolderName}" (uid: ${testFolderUid}) ...`);
        let found = false;
        for await (const node of client.iterateFolderChildren(rootUid)) {
            if (node.ok && node.value.uid === testFolderUid) {
                log(`  Found: name="${node.value.name}" uid=${node.value.uid}`);
                found = true;
                break;
            }
        }
        expect(found).toBe(true);
    });

    it('creates a subfolder inside the test folder', async () => {
        log(`Creating subfolder "sub" inside "${testFolderName}" ...`);
        const result = await client.createFolder(testFolderUid, 'sub');
        expect(result.ok).toBe(true);
        if (!result.ok) return;
        subFolderUid = result.value.uid;
        toTrash.push(subFolderUid);
        log(`  Created → uid: ${subFolderUid}`);
    });

    it('uploads a text file to the test folder', async () => {
        const content = 'hello proton drive e2e test\n';
        const localFile = path.join(tmpDir, 'upload.txt');
        fs.writeFileSync(localFile, content, 'utf-8');
        const sizeBytes = Buffer.byteLength(content);
        log(`Uploading "${localFile}" (${sizeBytes} bytes) to "${testFolderName}" ...`);

        const { nodeUid } = await uploadFile(
            client,
            localFile,
            testFolderUid,
            'upload.txt',
            sizeBytes,
        );

        expect(nodeUid).toBeTruthy();
        uploadedUid = nodeUid;
        toTrash.push(uploadedUid);
        log(`  Uploaded → uid: ${uploadedUid}`);
    });

    it('lists the test folder and finds the uploaded file', async () => {
        log(`Listing "${testFolderName}" (uid: ${testFolderUid}) ...`);
        let found = false;
        for await (const node of client.iterateFolderChildren(testFolderUid)) {
            if (!node.ok) continue;
            const size = node.value.activeRevision?.claimedSize;
            log(`  ${node.value.name} [${node.value.type}]${size != null ? ` ${size} bytes` : ''} uid=${node.value.uid}`);
            if (node.value.uid === uploadedUid) found = true;
        }
        expect(found).toBe(true);
    });

    it('downloads the uploaded file and verifies its contents', async () => {
        const destFile = path.join(tmpDir, 'downloaded.txt');
        log(`Downloading uid:${uploadedUid} → ${destFile} ...`);

        const downloader = await client.getFileDownloader(uploadedUid);
        const fileStream = fs.createWriteStream(destFile);
        const controller = downloader.downloadToStream(
            Writable.toWeb(fileStream) as WritableStream<Uint8Array>,
        );
        await controller.completion();

        const downloaded = fs.readFileSync(destFile, 'utf-8');
        const sizeBytes = Buffer.byteLength(downloaded);
        log(`  Downloaded ${sizeBytes} bytes`);
        log(`  Content: ${JSON.stringify(downloaded)}`);
        expect(downloaded).toBe('hello proton drive e2e test\n');
    });

    it('renames the uploaded file', async () => {
        log(`Renaming uid:${uploadedUid} → "renamed.txt" ...`);
        const result = await client.renameNode(uploadedUid, 'renamed.txt');
        expect(result.ok).toBe(true);
        if (result.ok) {
            log(`  Renamed → name: "${result.value.name}" uid: ${result.value.uid}`);
            expect(result.value.name).toBe('renamed.txt');
        }
    });

    it('moves the file into the subfolder', async () => {
        log(`Moving uid:${uploadedUid} → subfolder uid:${subFolderUid} ...`);
        let moved = false;
        for await (const result of client.moveNodes([uploadedUid], subFolderUid)) {
            expect(result.ok).toBe(true);
            if (result.ok) log(`  Moved uid:${result.uid}`);
            moved = true;
        }
        expect(moved).toBe(true);

        log(`  Verifying file appears in subfolder ...`);
        let found = false;
        for await (const node of client.iterateFolderChildren(subFolderUid)) {
            if (!node.ok) continue;
            log(`    ${node.value.name} uid=${node.value.uid}`);
            if (node.value.uid === uploadedUid) found = true;
        }
        expect(found).toBe(true);
    });

    it('moves the file back to the test folder', async () => {
        log(`Moving uid:${uploadedUid} back → test folder uid:${testFolderUid} ...`);
        let moved = false;
        for await (const result of client.moveNodes([uploadedUid], testFolderUid)) {
            expect(result.ok).toBe(true);
            if (result.ok) log(`  Moved uid:${result.uid}`);
            moved = true;
        }
        expect(moved).toBe(true);
    });

    it('gets a specific node by UID', async () => {
        log(`Fetching node uid:${uploadedUid} ...`);
        const node = await client.getNode(uploadedUid);
        expect(node.ok).toBe(true);
        if (node.ok) {
            log(`  name: "${node.value.name}"`);
            log(`  type: ${node.value.type}`);
            log(`  uid:  ${node.value.uid}`);
            log(`  size: ${node.value.activeRevision?.claimedSize ?? 'unknown'} bytes`);
            expect(node.value.uid).toBe(uploadedUid);
            expect(node.value.name).toBe('renamed.txt');
        }
    });

    it('trashes the uploaded file', async () => {
        log(`Trashing file uid:${uploadedUid} ...`);
        let ok = false;
        for await (const result of client.trashNodes([uploadedUid])) {
            expect(result.ok).toBe(true);
            if (result.ok) log(`  Trashed uid:${result.uid}`);
            ok = true;
        }
        expect(ok).toBe(true);
        const idx = toTrash.indexOf(uploadedUid);
        if (idx !== -1) toTrash.splice(idx, 1);
    });

    it('trashes the subfolder', async () => {
        log(`Trashing subfolder uid:${subFolderUid} ...`);
        let ok = false;
        for await (const result of client.trashNodes([subFolderUid])) {
            expect(result.ok).toBe(true);
            if (result.ok) log(`  Trashed uid:${result.uid}`);
            ok = true;
        }
        expect(ok).toBe(true);
        const idx = toTrash.indexOf(subFolderUid);
        if (idx !== -1) toTrash.splice(idx, 1);
    });
});
