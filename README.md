# OSH — Obsidian Self-Hosted

> This is **not an official project** from Obsidian.
> And also, It's not recommended to open external access.
> 
> If you want to use it, **use it on your own lisk** and never open it to the internet.
> Use VPN for external access or use only on the internal network.

Obsidian Self-Hosted(OSH) lets you run [Obsidian](https://obsidian.md) in a browser.

Obsidian is normally a desktop app built on Electron. OSH works by injecting a TypeScript shim into the Obsidian bundle that intercepts all Electron and Node.js API calls — `require('electron')`, `require('fs')`, IPC channels, dialogs, clipboard, and more — and proxies them over WebSocket to a Go server running on your machine or server. From Obsidian's perspective, it is still talking to Electron; it never knows it's running in a browser tab.

The Go server handles all the real work: file system reads and writes, directory browsing, vault detection, secret storage, and serving the Obsidian bundle itself. Two WebSocket channels are maintained: one for IPC messages (UI events, plugin calls) and one for file system operations (streaming reads and writes).

This approach requires no patches or forks of Obsidian — the unmodified app bundle is downloaded at build time and used as-is.

## Deploy (Docker)

Build the image on your machine and push it to your own registry:

```bash
docker build -t your-registry/osh:latest .
docker push your-registry/osh:latest
```

To bake a specific Obsidian version into the image:

```bash
docker build --build-arg OBSIDIAN_VERSION=1.8.10 -t your-registry/osh:latest .
```

On your server, create a `docker-compose.yml` and run `docker compose up -d`:

```yaml
services:
  osh:
    image: your-registry/osh:latest
    ports:
      - "27123:27123"
    volumes:
      - /path/to/your/notes:/vault
    environment:
      OSH_TOKEN: your-password # if this is empty, authentication will be disabled.
    restart: unless-stopped
```

Open `http://your-server:27123` and sign in with the password you set.

## Code Structure

- `client/` — TypeScript shim loaded into the Obsidian bundle in place of Electron
  - `fs/` — `require('fs')` shim: sync/async/stream file operations over WebSocket
  - `lib/` — shared utilities (EventEmitter, modal, file path helpers, service bus)
  - `remote/` — remote API shims (app, dialog, menu, safe-storage, screen, shell)
  - `electron.ts` — main entry: assembles the fake `require('electron')` module
  - `websocket.ts` — WebSocket connection management and reconnect logic
  - `file-browser.ts` — vault picker UI shown on first load
- `server/` — Go HTTP server
  - `handler/` — HTTP handlers (file browse, IPC, fetch proxy, static serving, auth)
  - `middleware/` — structured logger, session auth
  - `ws/` — WebSocket hubs (IPC channel, file system channel)
  - `config/` — config loading, `OSH_HOME` resolution
- `scripts/` — esbuild scripts for dev/prod, `init-obsidian.sh` (downloads and extracts the Obsidian ASAR)
- `static/` — Obsidian bundle extracted here at build time (not in git)

## Requirements

- Node.js 24+ and npm 10+
- Go 1.25+

## Setup & Build

```bash
nvm use         # if using nvm
npm run init    # download and extract the Obsidian bundle (~200 MB, run once)
npm run build   # production build → dist/
```

## Development

```bash
npm run dev         # dev server with HMR
npm run typecheck   # TypeScript type check
npm run lint        # Biome lint
npm run lint:fix    # Biome lint with auto-fix
npm run format      # Biome format
cd server && golangci-lint run ./...   # Go lint
```
