# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

```bash
npm run build       # Compile TypeScript to dist/
npm run dev         # Run via ts-node (no build step)
npm run start       # Run compiled CLI from dist/index.js
npm test            # Run unit tests (excludes e2e and dist/)
npm run test:watch  # Watch mode
npm run test:e2e    # Integration tests against real Proton Drive (requires PROTON_TEST_EMAIL / PROTON_TEST_PASSWORD)
```

Single test file: `npx jest --testPathPatterns=src/commands/sync`

### Test suite

Jest + ts-jest. Tests live colocated with source as `*.test.ts`. The jest config has no `roots` exclusion, so **do not run `npm test` immediately after `npm run build`** — compiled `*.test.js` files in `dist/` will be picked up and fail (they hit the real API without mocks). Use `npx jest --testPathIgnorePatterns=e2e --testPathIgnorePatterns=dist` or run individual files instead.

**Unit test conventions** (see `src/commands/rm.test.ts` as the canonical example):
- Mock `../sdk/client` and `../config/config` at the top of every command test file.
- Build a `makeMockClient(overrides)` factory returning a plain object with jest mock functions.
- Use `async function* gen<T>(...items)` to stub async generators returned by `trashNodes`, `iterateFolderChildren`, etc.
- Invoke the command via `command.parseAsync(['node', 'test', ...args])`.
- Mock `process.exit` to throw `Object.assign(new Error('EXIT:N'), { isExit: true })` so tests can assert on it.
- Commander retains option values across `parseAsync` calls on the same instance. In `beforeEach`, delete any boolean flags from `(command as any)._optionValues` to prevent state leakage between tests.

## Architecture

The stack is layered: CLI commands -> SDK client factory -> Drive SDK -> HTTP/crypto.

```
src/
├── index.ts              # Commander.js entry, registers all subcommands
├── commands/             # One file per command: login, upload, download, list, sync, mkdir, mv, rm, version
├── auth/protonAuth.ts    # SRP-6a auth flow; calls Proton API directly (no SDK)
├── sdk/
│   ├── client.ts         # createClient() — loads session, wires up all dependencies
│   ├── upload.ts         # Wraps SDK uploader; bridges Node streams to Web Streams
│   └── path.ts           # Resolves human-readable folder paths to folder UIDs
├── crypto/
│   ├── openpgpImpl.ts    # OpenPGPCryptoProxy impl (required by SDK)
│   └── srpImpl.ts        # SRP-6a math + key password derivation (bcrypt-based)
├── http/nodeHttpClient.ts # HTTP client impl (required by SDK); adds auth headers
├── account/simpleAccount.ts # ProtonDriveAccount impl; holds decrypted address keys
├── config/config.ts      # Session persistence at ~/.config/proton-drive/session.json
└── types/interface.ts    # Re-exports from @protontech/drive-sdk
```

### Key design points

**Authentication (`auth/protonAuth.ts`)**: Does not use the Drive SDK. Makes raw API calls to obtain tokens, fetches encrypted user and address keys, derives the key password via bcrypt SRP, decrypts and re-encrypts address keys under the key password, then saves everything to disk.

**Session and client setup (`config/config.ts`, `sdk/client.ts`)**: `createClient()` loads the stored session, decrypts address keys with the saved key password, and constructs a `ProtonDriveClient` by injecting the HTTP client, OpenPGP module, SRP module, account, and two in-memory caches.

**SDK interfaces**: `@protontech/drive-sdk` is sourced from `../sdk/js/sdk` (a sibling directory). The CLI implements three SDK interfaces: `ProtonDriveHTTPClient`, `OpenPGPCryptoProxy`, and `ProtonDriveAccount`. All Drive operations (list, upload, download) go through the SDK; only auth makes direct API calls.

**Path vs UID**: Commands accept either a human-readable path (`Photos/2024`) or a node UID. `sdk/path.ts:resolveFolderPath()` walks the folder tree to resolve paths.

### API base URL

`https://drive-api.proton.me` — set `DEBUG=1` to log all requests and SRP internals.
