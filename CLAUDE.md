# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

```bash
npm run build    # Compile TypeScript to dist/
npm run dev      # Run via ts-node (no build step)
npm run start    # Run compiled CLI from dist/index.js
```

No test suite or linter is configured yet.

## Architecture

The stack is layered: CLI commands -> SDK client factory -> Drive SDK -> HTTP/crypto.

```
src/
├── index.ts              # Commander.js entry, registers all subcommands
├── commands/             # One file per command: login, upload, download, list, version
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
