// Waymark desktop app (Electron main process).
//
// Patterns adapted from Actual Budget's desktop app (MIT, github.com/actualbudget/actual,
// packages/desktop-electron): the Node server runs in an Electron utility process and reports
// when it is ready; the window has no Node access (contextIsolation + sandbox); links to other
// sites open in the normal browser; webviews and unexpected permissions are refused.
//
// Everything else is the same app as `npm start`: the window simply shows the local server. The
// one exception is the welcome page on first start (before there is a workspace, so before there is
// a server): it is one of the app's own files, served from waymark://app/ (Electron's custom
// protocol pattern, protocol.handle + net.fetch).

import {
  app,
  BrowserWindow,
  dialog,
  ipcMain,
  Menu,
  net,
  protocol,
  session,
  shell,
  utilityProcess,
  type IpcMainInvokeEvent,
  type MenuItemConstructorOptions,
  type UtilityProcess,
} from 'electron';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { readdir, rm } from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { copyWorkspace, inspectFolder, isInside, type FolderInfo } from './folders';
import { checkForUpdatesNow, initUpdates, probeUpdates } from './updates';

const isMac = process.platform === 'darwin';
const REPO = 'https://github.com/csdeepak/scratcher.ai';
const DEFAULT_PORT = 47317;
const SMOKE = process.env.WAYMARK_SMOKE_TEST === '1';
const SCHEME = 'waymark';
const WELCOME_URL = `${SCHEME}://app/welcome.html`;

// Tests and second copies can keep their settings elsewhere.
if (process.env.WAYMARK_USER_DATA) app.setPath('userData', process.env.WAYMARK_USER_DATA);

protocol.registerSchemesAsPrivileged([{ scheme: SCHEME, privileges: { standard: true, secure: true, supportFetchAPI: true } }]);

// ---------------------------------------------------------------- settings

interface Config {
  workspace?: string;
  /** Check GitHub Releases for new versions (default on). */
  autoUpdate?: boolean;
  port?: number;
  bounds?: { x?: number; y?: number; width: number; height: number; maximized?: boolean };
}
const configPath = () => path.join(app.getPath('userData'), 'config.json');
function readConfig(): Config {
  try {
    return JSON.parse(readFileSync(configPath(), 'utf8')) as Config;
  } catch {
    return {};
  }
}
function writeConfig(patch: Partial<Config>) {
  const next = { ...readConfig(), ...patch };
  try {
    mkdirSync(path.dirname(configPath()), { recursive: true });
    writeFileSync(configPath(), JSON.stringify(next, null, 2));
  } catch {
    /* settings are a convenience; the app works without them */
  }
}

// ---------------------------------------------------------------- server process

let server: UtilityProcess | null = null;
let serverPort = 0;
let workspace = '';
let win: BrowserWindow | null = null;
let quitting = false;

function startServer(dir: string): Promise<number> {
  return new Promise((resolve, reject) => {
    const proc = utilityProcess.fork(path.join(__dirname, 'server.mjs'), [], {
      serviceName: 'Waymark server',
      stdio: 'pipe',
      env: {
        ...process.env,
        WAYMARK_WORKSPACE: dir,
        WAYMARK_APP_ROOT: app.getAppPath(),
        WAYMARK_PORT: String(readConfig().port ?? DEFAULT_PORT),
      },
    });
    let errText = '';
    proc.stdout?.on('data', (c: Buffer) => process.stdout.write(`[server] ${c}`));
    proc.stderr?.on('data', (c: Buffer) => {
      errText = (errText + c.toString('utf8')).slice(-2000);
      process.stderr.write(`[server] ${c}`);
    });
    const timer = setTimeout(() => reject(new Error('The Waymark server did not start within 30 seconds.')), 30_000);
    proc.on('message', (msg: { type?: string; port?: number; message?: string }) => {
      if (msg?.type === 'ready' && msg.port) {
        clearTimeout(timer);
        server = proc;
        serverPort = msg.port;
        workspace = dir;
        writeConfig({ port: msg.port });
        resolve(msg.port);
      } else if (msg?.type === 'error') {
        clearTimeout(timer);
        reject(new Error(msg.message ?? 'The Waymark server could not start.'));
      }
    });
    proc.on('exit', (code) => {
      clearTimeout(timer);
      if (server === proc) {
        server = null;
        if (!quitting) void serverCrashed(code);
      } else reject(new Error(errText.trim() || `The Waymark server stopped (code ${code}).`));
    });
  });
}

/** Ask the server to save and stop; force it after a few seconds. */
function stopServer(): Promise<void> {
  const proc = server;
  server = null;
  if (!proc) return Promise.resolve();
  return new Promise((resolve) => {
    const force = setTimeout(() => {
      proc.kill();
      resolve();
    }, 5000);
    proc.once('exit', () => {
      clearTimeout(force);
      resolve();
    });
    proc.postMessage({ type: 'shutdown' });
  });
}

async function serverCrashed(code: number | null) {
  const r = await dialog.showMessageBox({
    type: 'error',
    title: 'Waymark',
    message: 'The Waymark server stopped unexpectedly.',
    detail: `Your files are safe in ${workspace}. (exit code ${code})`,
    buttons: ['Restart', 'Quit'],
  });
  if (r.response === 0) await openWorkspace(workspace);
  else app.quit();
}

// ---------------------------------------------------------------- workspace folder

function defaultWorkspace() {
  return path.join(app.getPath('documents'), 'Waymark');
}

/** Facts for checking folders: where home is, where the app is installed, the system folders. */
const folderContext = () => ({ home: app.getPath('home'), appDir: app.isPackaged ? path.dirname(process.execPath) : undefined });
const inspect = (dir: string) => inspectFolder(dir, folderContext());

async function chooseFolder(title: string, start?: string): Promise<string | null> {
  const r = await dialog.showOpenDialog(win ?? undefined!, {
    title,
    defaultPath: start || workspace || defaultWorkspace(),
    properties: ['openDirectory', 'createDirectory', 'promptToCreate'],
    buttonLabel: 'Use this folder',
  });
  return r.canceled || !r.filePaths[0] ? null : r.filePaths[0];
}

/** The folder to open at start: the one you chose before (or one set for tests). Null on first start. */
function savedWorkspace(): string | null {
  if (process.env.WAYMARK_WORKSPACE) return path.resolve(process.env.WAYMARK_WORKSPACE);
  return readConfig().workspace ?? null;
}

/** If the welcome page can't load, ask the old way, with a plain dialog. */
async function askWithDialog(): Promise<void> {
  const def = defaultWorkspace();
  const r = await dialog.showMessageBox({
    type: 'question',
    title: 'Welcome to Waymark',
    message: 'Where should Waymark keep your roadmaps?',
    detail: `They are ordinary Markdown files in one folder. AI agents (Claude, ChatGPT, …) edit the same folder, and Waymark shows their changes.\n\nSuggested: ${def}`,
    buttons: ['Use the suggested folder', 'Choose a folder…', 'Quit'],
    defaultId: 0,
    cancelId: 2,
  });
  const dir = r.response === 0 ? def : r.response === 1 ? await chooseFolder('Choose a folder for your roadmaps') : null;
  if (!dir) return void app.quit();
  await openWorkspace(dir, 'welcome=connect');
}

/**
 * Starts the server on `dir` and shows the app. `query` is passed to the page: welcome=connect
 * (first start: show "Connect your AI" next) or moved=… (after Move workspace).
 */
async function openWorkspace(dir: string, query = ''): Promise<boolean> {
  try {
    mkdirSync(dir, { recursive: true });
    await stopServer();
    const port = await startServer(dir);
    if (!SMOKE) writeConfig({ workspace: dir });
    const url = `http://127.0.0.1:${port}/${query ? `?${query}` : ''}`;
    if (win) await win.loadURL(url);
    else createWindow(url);
    buildMenu();
    return true;
  } catch (e) {
    const r = await dialog.showMessageBox({
      type: 'error',
      title: 'Waymark',
      message: `Waymark couldn't open ${dir}.`,
      detail: (e as Error).message,
      buttons: ['Choose another folder…', 'Quit'],
    });
    const next = r.response === 0 ? await chooseFolder('Choose a folder for your roadmaps') : null;
    if (next) return openWorkspace(next, query);
    app.quit();
    return false;
  }
}

/** Open (or set up) another folder, from the welcome page or Workspace settings. */
async function useFolder(dir: string): Promise<{ ok: boolean; error?: string }> {
  const info = await inspect(dir);
  if (info.state === 'blocked') return { ok: false, error: info.reason };
  const firstStart = !workspace;
  if (info.path === workspace) return { ok: true };
  const ok = await openWorkspace(info.path, firstStart ? 'welcome=connect' : 'switched=1');
  return ok ? { ok } : { ok, error: `Waymark couldn't open ${info.path}.` };
}

/**
 * Move the workspace: stop the server so nothing changes mid-copy, copy every file to the new
 * folder, check each one, then open the copy. The old folder stays as it was; you delete it later.
 */
async function moveWorkspace(dest: string): Promise<{ ok: boolean; error?: string }> {
  const info: FolderInfo = await inspect(dest);
  if (info.state === 'blocked') return { ok: false, error: info.reason };
  if (info.state !== 'new' && info.state !== 'empty') return { ok: false, error: 'Choose a new or empty folder: Waymark copies your whole workspace into it.' };
  const from = workspace;
  if (!from) return { ok: false, error: 'No workspace is open.' };
  const existed = info.state === 'empty';
  await stopServer();
  try {
    const r = await copyWorkspace(from, info.path);
    const ok = await openWorkspace(info.path, `moved=${r.files}&from=${encodeURIComponent(from)}`);
    return ok ? { ok } : { ok, error: `Waymark couldn't open ${info.path}.` };
  } catch (e) {
    // Remove the incomplete copy (only what this move created), then carry on in the old folder.
    try {
      if (existed) for (const n of await readdir(info.path)) await rm(path.join(info.path, n), { recursive: true, force: true });
      else await rm(info.path, { recursive: true, force: true });
    } catch {
      /* leave it; the message below says what happened */
    }
    await openWorkspace(from);
    return { ok: false, error: `The move didn't finish, so Waymark kept using ${from}. ${(e as Error).message}` };
  }
}

/** Ask the app page to open one of its dialogs (menu items). */
function openInApp(what: 'connect' | 'workspace') {
  if (win && isInternal(win.webContents.getURL())) win.webContents.send('waymark:open', what);
}

// ---------------------------------------------------------------- window

const isInternal = (url: string) => {
  try {
    const u = new URL(url);
    return u.protocol === 'http:' && u.hostname === '127.0.0.1' && Number(u.port) === serverPort;
  } catch {
    return false;
  }
};
function openExternal(url: string) {
  try {
    const u = new URL(url);
    if (u.protocol === 'http:' || u.protocol === 'https:' || u.protocol === 'mailto:') void shell.openExternal(u.href);
  } catch {
    /* not a URL */
  }
}

const SAFE_PREFS = { contextIsolation: true, sandbox: true, nodeIntegration: false, webviewTag: false, spellcheck: true } as const;

function createWindow(url: string) {
  const b = readConfig().bounds;
  win = new BrowserWindow({
    x: b?.x,
    y: b?.y,
    width: b?.width ?? 1440,
    height: b?.height ?? 900,
    minWidth: 760,
    minHeight: 520,
    title: 'Waymark',
    backgroundColor: '#fbfaf6',
    show: false,
    autoHideMenuBar: !isMac,
    webPreferences: { ...SAFE_PREFS, preload: path.join(__dirname, 'preload.cjs') },
  });
  if (b?.maximized) win.maximize();
  win.once('ready-to-show', () => {
    if (!SMOKE) win?.show();
  });

  // Pages of the app itself (e.g. the PDF print view) open in an app window; everything else in the browser.
  win.webContents.setWindowOpenHandler(({ url: target }) => {
    if (isInternal(target)) {
      return { action: 'allow', overrideBrowserWindowOptions: { autoHideMenuBar: true, backgroundColor: '#ffffff', webPreferences: { ...SAFE_PREFS } } };
    }
    openExternal(target);
    return { action: 'deny' };
  });
  win.webContents.on('will-navigate', (e, target) => {
    if (isInternal(target)) return;
    e.preventDefault();
    openExternal(target);
  });

  const saveBounds = () => {
    if (!win || win.isMinimized()) return;
    writeConfig({ bounds: { ...win.getNormalBounds(), maximized: win.isMaximized() } });
  };
  win.on('close', saveBounds);
  win.on('closed', () => (win = null));
  void win.loadURL(url);

  if (url === WELCOME_URL) {
    win.webContents.once('did-fail-load', (_e, code, description) => {
      console.error(`[welcome] ${code} ${description}`);
      win?.hide();
      void askWithDialog();
    });
  }

  if (SMOKE && url === WELCOME_URL) {
    // Automated check of the first start: the page renders and can reach the app (folder check).
    win.webContents.once('did-finish-load', () => {
      setTimeout(async () => {
        const result = await win!.webContents.executeJavaScript(
          `(async () => {
            const d = window.waymarkDesktop;
            const setup = await d.setupInfo();
            const folder = await d.inspectFolder(setup.suggested);
            return {
              title: document.title,
              welcome: !!document.querySelector('[data-welcome]'),
              heading: document.querySelector('h1')?.textContent,
              suggested: setup.suggested,
              folderState: folder.state,
            };
          })()`,
        );
        console.log(`WAYMARK_SMOKE ${JSON.stringify({ ...result, version: app.getVersion() })}`);
        app.quit();
      }, 2500);
    });
  } else if (SMOKE) {
    win.webContents.once('did-finish-load', () => {
      setTimeout(async () => {
        const result = await win!.webContents.executeJavaScript(
          `(async () => {
            const status = async (u) => (await fetch(u)).status;
            return {
              title: document.title,
              rendered: document.querySelector('#root')?.children.length ?? 0,
              desktop: !!window.waymarkDesktop?.isDesktop,
              katexCss: await status('/api/katex/katex.min.css'),
              pdfFont: await status('/api/pdfjs/standard_fonts/FoxitFixed.pfb'),
              zipBackup: await status('/api/roadmaps/rm-example1/export?format=zip'),
            };
          })()`,
        );
        const updates = process.env.WAYMARK_SMOKE_UPDATES === '1' ? await probeUpdates() : undefined;
        console.log(`WAYMARK_SMOKE ${JSON.stringify({ ...result, updates, version: app.getVersion(), port: serverPort, workspace })}`);
        app.quit();
      }, 2500);
    });
  }
}

// ---------------------------------------------------------------- menu

function buildMenu() {
  const template: MenuItemConstructorOptions[] = [
    ...(isMac ? [{ role: 'appMenu' as const }] : []),
    {
      label: 'File',
      submenu: [
        { label: 'Workspace folder…', enabled: !!workspace, click: () => openInApp('workspace') },
        { label: 'Show workspace folder', accelerator: 'CmdOrCtrl+Shift+O', enabled: !!workspace, click: () => void shell.openPath(workspace) },
        { type: 'separator' },
        { label: 'Connect your AI…', enabled: !!workspace, click: () => openInApp('connect') },
        { label: 'Instructions for AI agents (AGENTS.md)', enabled: !!workspace, click: () => void shell.openPath(path.join(workspace, 'AGENTS.md')) },
        { type: 'separator' },
        isMac ? { role: 'close' } : { role: 'quit', label: 'Exit' },
      ],
    },
    { role: 'editMenu' },
    {
      label: 'View',
      submenu: [
        { role: 'reload' },
        { role: 'toggleDevTools' },
        { type: 'separator' },
        { role: 'resetZoom' },
        { role: 'zoomIn' },
        { role: 'zoomOut' },
        { type: 'separator' },
        { role: 'togglefullscreen' },
      ],
    },
    { role: 'windowMenu' },
    {
      role: 'help',
      submenu: [
        { label: 'Connect your AI (Claude, ChatGPT, …)', enabled: !!workspace, click: () => openInApp('connect') },
        { type: 'separator' },
        { label: 'Check for updates…', click: () => checkForUpdatesNow() },
        {
          label: 'Check for updates automatically',
          type: 'checkbox',
          checked: readConfig().autoUpdate !== false,
          click: (item) => writeConfig({ autoUpdate: item.checked }),
        },
        { type: 'separator' },
        { label: 'Waymark on GitHub', click: () => void shell.openExternal(REPO) },
        {
          label: 'About Waymark',
          click: () =>
            void dialog.showMessageBox(win ?? undefined!, {
              title: 'About Waymark',
              message: `Waymark ${app.getVersion()}`,
              detail: `A local roadmap notebook. Your data is the folder:\n${workspace}\n\nElectron ${process.versions.electron} · Node ${process.versions.node}`,
            }),
        },
      ],
    },
  ];
  Menu.setApplicationMenu(Menu.buildFromTemplate(template));
}

// ---------------------------------------------------------------- app lifecycle

if (!app.requestSingleInstanceLock()) app.quit();
else {
  app.on('second-instance', () => {
    if (!win) return;
    if (win.isMinimized()) win.restore();
    win.show();
    win.focus();
  });

  // Security hardening (as in Actual's security.ts): no webviews, no surprise permissions.
  app.on('web-contents-created', (_e, contents) => {
    contents.on('will-attach-webview', (e) => e.preventDefault());
  });

  // The page's only ways into the desktop app (see preload.ts). Each checks that the request comes
  // from Waymark's own pages: the welcome page or the app on its local server.
  const fromApp = (e: IpcMainInvokeEvent) => {
    const u = e.senderFrame?.url ?? '';
    return u.startsWith(`${SCHEME}://app/`) || isInternal(u);
  };
  const str = (v: unknown) => (typeof v === 'string' ? v : '');
  ipcMain.handle('waymark:show-workspace', (e) => (fromApp(e) && workspace ? shell.openPath(workspace) : null));
  ipcMain.handle('waymark:setup-info', (e) => (fromApp(e) ? { suggested: defaultWorkspace(), current: workspace || null, platform: process.platform } : null));
  ipcMain.handle('waymark:inspect-folder', (e, dir: unknown) => (fromApp(e) ? inspect(str(dir)) : null));
  ipcMain.handle('waymark:choose-folder', (e, start: unknown) => (fromApp(e) ? chooseFolder('Choose a folder for your roadmaps', str(start)) : null));
  ipcMain.handle('waymark:use-folder', (e, dir: unknown) => (fromApp(e) ? useFolder(str(dir)) : { ok: false, error: 'Not allowed.' }));
  ipcMain.handle('waymark:move-workspace', (e, dir: unknown) => (fromApp(e) ? moveWorkspace(str(dir)) : { ok: false, error: 'Not allowed.' }));

  void app.whenReady().then(async () => {
    session.defaultSession.setPermissionRequestHandler((wc, permission, cb) => {
      cb(isInternal(wc.getURL()) && ['clipboard-sanitized-write', 'fullscreen'].includes(permission));
    });
    // waymark://app/<file> serves the app's own built pages (dist/), nothing else.
    const distDir = path.join(app.getAppPath(), 'dist');
    protocol.handle(SCHEME, (req) => {
      const u = new URL(req.url);
      const file = path.join(distDir, decodeURIComponent(u.pathname));
      if (u.host !== 'app' || !isInside(file, distDir) || file === distDir) return new Response('Not found', { status: 404 });
      return net.fetch(pathToFileURL(file).toString());
    });
    buildMenu();
    const dir = savedWorkspace();
    // First start: the welcome page asks where to keep the roadmaps, then calls waymark:use-folder.
    if (dir) await openWorkspace(dir);
    else createWindow(WELCOME_URL);
    if (!SMOKE) initUpdates(() => win, () => readConfig().autoUpdate !== false);
  });

  app.on('activate', () => {
    if (!win) createWindow(serverPort ? `http://127.0.0.1:${serverPort}/` : WELCOME_URL);
  });
  app.on('window-all-closed', () => {
    if (!isMac) app.quit();
  });
  // Let the server save (history, pending writes) before the app exits.
  app.on('before-quit', (e) => {
    if (quitting || !server) return;
    e.preventDefault();
    quitting = true;
    void stopServer().finally(() => app.quit());
  });
}

