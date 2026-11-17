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

## Stage 2: desktop app with an installer (.exe and .dmg) — built

**Electron**, because the server is already Node and runs inside it unchanged. The shell follows Actual
Budget's open-source desktop app (MIT), adapted to Waymark:

- `electron/main.ts`: the server (`src/server/desktop.ts`) runs in an Electron *utility process* and tells
  the window which port it is on (first free port from 47317, kept between runs so the page's saved view
  settings stay). The window has no Node access (context isolation and sandbox). Links to other sites open
  in your browser, pop-ups from the app itself (the PDF print view) open in an app window, and webviews and
  unexpected permissions are refused. On quit the server saves everything before it stops.
- First start shows a welcome page (`welcome.html`, served from the app's own files as `waymark://app/`
  because there is no server before there is a workspace). It suggests `Documents\Waymark`, takes any
  folder you type or browse to, and checks it first (`electron/folders.ts`): new, empty, an existing
  workspace (opened as it is), or holding other files (allowed, with a warning and a one-click "new folder
  inside it"). Drive roots, your whole user folder, system folders and the app's install folder are
  refused. Then the app opens with **Connect your AI** as step 2. If the welcome page can't load, the old
  plain dialog asks instead.
- **File → Workspace folder…** (also on the home page, in ⋯ and Ctrl+K) shows the folder and, in the
  desktop app, opens another folder or **moves** the workspace: the server stops, every file is copied
  and compared by size and SHA-256, then the copy opens; the old folder is never deleted. A failed move
  removes only its own partial copy and reopens the old folder. **File → Show workspace folder** opens it
  in Explorer/Finder. Settings and the window size live in the app's user-data folder; your data stays in
  the workspace folder.
- `electron/preload.ts` exposes only folder actions (check, browse, use, move, show) and the menu's
  "open this dialog" message to the page; the main process accepts them only from Waymark's own pages.
- Automated check of the first start: `WAYMARK_SMOKE_TEST=1 WAYMARK_USER_DATA=<empty folder>` without
  `WAYMARK_WORKSPACE` prints `WAYMARK_SMOKE {"welcome":true,…}` and quits.
- `scripts/build-desktop.mjs` bundles main, preload and server with esbuild; `scripts/make-icon.cjs`
  renders `public/favicon.svg` to `build/icon.png`. Only the server's runtime packages ship with the app
  (the UI is pre-built), and Electron's “run as Node” and Node-options fuses are off.

| Command | Result |
|---|---|
| `npm run desktop` | build and open the desktop app from the source folder |
| `npm run dist:win` | `release/Waymark-Setup-<version>.exe` (NSIS; choose the install folder, Start menu and desktop shortcuts) and `release/win-unpacked/` |
| `npm run dist:mac` | `.dmg` for Apple Silicon and Intel (must run on a Mac or in GitHub Actions on macOS) |
| `npm run dist:linux` | AppImage |

Tested: the Windows installer builds (≈140 MB, mostly Chromium), and the packaged app starts its
server from the app archive, creates a workspace, serves the UI, KaTeX and pdf.js files, and makes zip
backups (an automated check: `WAYMARK_SMOKE_TEST=1 WAYMARK_WORKSPACE=<folder> WAYMARK_USER_DATA=<folder>
release/win-unpacked/Waymark.exe` prints `WAYMARK_SMOKE {…}` and quits). Not yet tested: macOS.

### Releases and auto-update

Two GitHub Actions workflows (`.github/workflows/`):

- **Checks** runs the typecheck, tests and UI build on Linux and Windows for every push to `main` and
  every pull request.
- **Release** runs when a version tag is pushed. It checks that the tag matches `package.json`, creates
  a **draft** GitHub release, then builds on Windows, macOS and Linux (tests first) and uploads the
  installers plus the `latest*.yml` files that auto-update reads. The layout follows Actual Budget's
  MIT-licensed release workflow, and the actions are pinned to exact commits.

To publish a version:

```bash
npm version 0.2.0
git push --follow-tags
```

`npm version` updates `package.json`, commits, and creates the tag `v0.2.0`. When the workflow finishes,
open the draft on GitHub (Releases), check it, and press **Publish release**. Nothing reaches users until
you publish.

**Auto-update** (`electron/updates.ts`, `electron-updater`, the flow of electron-builder's reference
example): about 15 seconds after start and every 6 hours the installed app asks GitHub for the latest
*published* release. On Windows and Linux it downloads in the background and offers **Restart now /
Later**; with Later it installs when you quit. Your work is saved before the restart. On macOS an
unsigned app can't replace itself, so it only says a new version exists and opens the download page.
**Help → Check for updates…** checks at once; **Help → Check for updates automatically** turns the
background check off. This check is the only network request Waymark makes.

macOS builds use an ad-hoc signature (`mac.identity: "-"`, as electron-builder recommends without an
Apple Developer ID), so Apple Silicon Macs open them. Gatekeeper still asks the first time: right-click
the app → **Open**. Signing for others needs the Apple Developer Program, and the Windows SmartScreen
prompt goes away only with a code-signing certificate.

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

1. Use the desktop app (stage 2) on Windows; publish a first release and try the Mac build on a Mac.
2. Stage 3, option 1 or 2, when you need more than one device.
