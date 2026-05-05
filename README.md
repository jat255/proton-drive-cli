# proton-drive-cli

A command-line interface for [Proton Drive](https://proton.me/drive). Authenticate with your Proton account and manage files from the terminal.

> **Warning: This project is almost entirely vibe coded.** It was built experimentally with heavy AI assistance. The crypto and auth code in particular has not been audited. Do not rely on it for anything security-sensitive or production-critical.

## Features

- **Login** -- Authenticates via SRP-6a (Proton's password protocol) and persists your session locally
- **List** -- Browse folder contents by path or node UID
- **Upload** -- Upload a file to a folder (by path or UID), with progress reporting
- **Download** -- Download a file by node UID to a local destination, with progress reporting

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
proton-drive ls /Photos/2024
proton-drive upload ./photo.jpg /Photos/2024
proton-drive download <node-uid> ./destination/
```

Set `DEBUG=1` to log all HTTP requests and SRP internals.

Session is stored at `~/.config/proton-drive/session.json`.

## What's missing

- Token refresh (sessions expire and require re-login)
- Two-factor authentication
- Delete, move, rename
- Folder creation
- Any tests
- Any linting
