# proton-drive-cli

A command-line interface for [Proton Drive](https://proton.me/drive). Authenticate with your Proton account and manage files from the terminal.

> **Warning: This project is almost entirely vibe coded.** It was built experimentally with heavy AI assistance. The crypto and auth code in particular has not been audited. Do not rely on it for anything security-sensitive or production-critical.

## Features

- **Login** -- Authenticates via SRP-6a (Proton's password protocol) and persists your session locally
- **List** -- Browse folder contents by path or node UID
- **Upload** -- Upload a file to a folder (by path or UID), with progress reporting
- **Download** -- Download a file by path or node UID to a local destination, with progress reporting
- **rm** -- Move a file or folder to trash (`--permanent` to hard-delete)
- **mkdir** -- Create a folder by name, path, or under a given parent
- **mv** -- Move or rename a file or folder

## Installation

Requires Node.js 20+ and the `@protontech/drive-sdk` available at `../sdk/js/sdk` relative to this directory.

```bash
npm install
npm run build
npm link        # makes `proton-drive` available globally
```

## Usage

```bash
proton-drive login
proton-drive list                          # list My Files root
proton-drive list Photos/2024              # list by path
proton-drive upload ./photo.jpg Photos/2024
proton-drive download Photos/2024/photo.jpg ./dest/
proton-drive download <node-uid> ./dest/
proton-drive mkdir Photos/NewAlbum
proton-drive mv Photos/old.jpg Photos/new.jpg
proton-drive mv Photos/file.jpg Archive/
proton-drive rm Photos/old.jpg             # moves to trash
proton-drive rm Photos/old.jpg --permanent # permanent delete
```

Set `DEBUG=1` to log all HTTP requests and SRP internals.

Session is stored at `~/.config/proton-drive/session.json`.

## Testing

### Unit tests

Mock-based tests that run without a Proton account:

```bash
npm test
```

These cover `formatBytes`, path resolution (`resolveFolderPath`, `resolveNodePath`, `looksLikePath`), and all five commands (`download`, `rm`, `mkdir`, `mv`, and path-resolution logic). They verify that each command calls the right SDK methods with the right arguments and exits correctly on errors.

### End-to-end tests

Integration tests that authenticate against a real Proton account and exercise every operation live:

```bash
PROTON_TEST_EMAIL=you@example.com \
PROTON_TEST_PASSWORD=yourpassword \
npm run test:e2e
```

The E2E suite:
- Authenticates and creates a uniquely-named test folder
- Creates a subfolder
- Uploads a text file
- Lists and finds the file
- Downloads and verifies the file contents
- Renames the file
- Moves the file to the subfolder and back
- Fetches the node by UID
- Trashes the file, subfolder, and test folder

Everything created during the run is trashed in `afterAll`, even if earlier tests fail. Each run is isolated by a timestamp-suffixed folder name so parallel runs do not collide.

The suite is skipped entirely when the env vars are not set, so `npm test` is always safe to run without credentials.

## What's missing

- Token refresh (sessions expire and require re-login)
- Two-factor authentication
- Linting / type checking as a separate script (`tsc --noEmit`)
