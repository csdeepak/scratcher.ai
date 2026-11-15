# Waymark on Windows, macOS and the web

Waymark is one codebase: a small Node.js server (your files, the watcher, the rules) plus a web UI.
That split is what makes it portable. Each stage below is usable on its own.

## Stage 1: local app in the browser (works today)

| | Windows | macOS |
|---|---|---|
| Install | Node.js 20+ from nodejs.org, then `npm install` | Node.js 20+ from nodejs.org or `brew install node`, then `npm install` |
| Run | `npm start` → http://localhost:4317 | same |
| App window | Chrome or Edge → ⋮ → *Install Waymark* (own window, Start menu) | Chrome → *Install Waymark*, or Safari → File → *Add to Dock* |
| Workspace | `npm start -- --workspace "D:\Roadmaps"` | `npm start -- --workspace ~/Documents/Roadmaps` |

Already handled in the code for both systems: path handling, atomic saves (with retries for Windows file
locks), pausing the watcher while folders move (Windows refuses to rename watched folders), folder names
that are valid on both (no `< > : " / \ | ? *`, no `CON`/`PRN`/…, case-insensitive clash checks), LF line
endings, and only pure-JavaScript dependencies, so `npm install` never needs a compiler.

Tested on Windows 11. Not yet tested on a Mac (nothing Windows-specific is used, but it hasn't been run there).

## Stage 2: desktop app with an installer (.exe and .dmg)

**Recommended: Electron.** The server is already Node, so it runs inside Electron unchanged:

1. Add `electron/main.ts`: pick a free port, start the existing `Workspace` and HTTP app, and open a window
   on it. Add a native *Choose workspace folder* dialog and *Show in Explorer/Finder*.
2. Add `electron-builder` config. It produces an NSIS installer for Windows and a DMG for macOS (Apple
   Silicon and Intel), built on each OS or in GitHub Actions.
3. Optional: auto-update from GitHub Releases (`electron-updater`), free.

Size is about 100 MB because it ships Chromium. Estimated effort: a few days.

**Signing:** unsigned apps work for personal use. Windows shows a SmartScreen warning ("More info → Run
anyway"), and macOS needs right-click → Open the first time. Distributing to others without warnings needs
a Windows code-signing certificate and the Apple Developer Program ($99/year).

**Alternative: Tauri 2** (about 10–15 MB; uses the system WebView2 on Windows and WebKit on macOS). The Node
server would have to ship as a bundled sidecar executable or be rewritten in Rust. Choose it later if
installer size matters more than effort.

## Stage 3: the web (other devices)

From least to most effort:

1. **Sync the folder (works today).** Put the workspace in OneDrive, Dropbox or a git repo and run Waymark
   on each computer. Don't edit the same checkpoint on two machines at once: Waymark's `rev` check catches
   stale writes, but a sync tool may still create "conflicted copy" files.
2. **Reach your own computer remotely.** Run Waymark at home and open it from a laptop or phone over
   Tailscale (free personal plan). This needs a login token added first: the server only answers on
   localhost today, on purpose.
3. **Host it.** Run the same server on a small VPS or container with HTTPS and a login (password or
   passkey). The data then lives on that server: still plain files you can back up, but no longer offline.
   Agents reach it through git sync or the HTTP API.
4. **Browser-only (no server)** using the File System Access API: Chrome and Edge only, and it can't watch
   the folder for agent edits. Not recommended.

Phones: the UI already adapts to small screens (drawers for the library, outline and notebook). Native
mobile apps (e.g. Capacitor) would come after stage 3.

## Suggested order

1. Keep using stage 1 and try it on a Mac.
2. Stage 2 (Electron) when you want a double-click app.
3. Stage 3, option 1 or 2, when you need more than one device.
