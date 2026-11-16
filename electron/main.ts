// Waymark desktop app (Electron main process).
//
// Patterns adapted from Actual Budget's desktop app (MIT, github.com/actualbudget/actual,
// packages/desktop-electron): the Node server runs in an Electron utility process and reports
// when it is ready; the window has no Node access (contextIsolation + sandbox); links to other
// sites open in the normal browser; webviews and unexpected permissions are refused.
//
// Everything else is the same app as `npm start`: the window simply shows the local server.

import { app, BrowserWindow, dialog, ipcMain, Menu, session, shell, utilityProcess, type MenuItemConstructorOptions, type UtilityProcess } from 'electron';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';

const isMac = process.platform === 'darwin';
const REPO = 'https://github.com/csdeepak/scratcher.ai';
const DEFAULT_PORT = 47317;
const SMOKE = process.env.WAYMARK_SMOKE_TEST === '1';

// Tests and second copies can keep their settings elsewhere.
if (process.env.WAYMARK_USER_DATA) app.setPath('userData', process.env.WAYMARK_USER_DATA);

// ---------------------------------------------------------------- settings

interface Config {
  workspace?: string;
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

async function chooseFolder(title: string): Promise<string | null> {
  const r = await dialog.showOpenDialog(win ?? undefined!, {
    title,
    defaultPath: workspace || defaultWorkspace(),
    properties: ['openDirectory', 'createDirectory', 'promptToCreate'],
    buttonLabel: 'Use this folder',
  });
  return r.canceled || !r.filePaths[0] ? null : r.filePaths[0];
}

/** First start: ask where to keep the roadmaps (plain Markdown files that agents can edit too). */
async function firstWorkspace(): Promise<string | null> {
  if (process.env.WAYMARK_WORKSPACE) return path.resolve(process.env.WAYMARK_WORKSPACE);
  const saved = readConfig().workspace;
  if (saved) return saved;
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
  if (r.response === 2) return null;
  if (r.response === 1) return chooseFolder('Choose a folder for your roadmaps');
  return def;
}

async function openWorkspace(dir: string): Promise<boolean> {
  try {
    mkdirSync(dir, { recursive: true });
    await stopServer();
    const port = await startServer(dir);
    if (!SMOKE) writeConfig({ workspace: dir });
    const url = `http://127.0.0.1:${port}/`;
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
    if (next) return openWorkspace(next);
    app.quit();
    return false;
  }
}

async function changeWorkspace() {
  const dir = await chooseFolder('Open or create a Waymark workspace folder');
  if (dir && dir !== workspace) await openWorkspace(dir);
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

  if (SMOKE) {
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
        console.log(`WAYMARK_SMOKE ${JSON.stringify({ ...result, port: serverPort, workspace })}`);
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
        { label: 'Show workspace folder', accelerator: 'CmdOrCtrl+Shift+O', click: () => void shell.openPath(workspace) },
        { label: 'Open another workspace folder…', click: () => void changeWorkspace() },
        { type: 'separator' },
        { label: 'Instructions for AI agents (AGENTS.md)', click: () => void shell.openPath(path.join(workspace, 'AGENTS.md')) },
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

  ipcMain.handle('waymark:show-workspace', () => shell.openPath(workspace));
  ipcMain.handle('waymark:change-workspace', () => changeWorkspace());

  void app.whenReady().then(async () => {
    session.defaultSession.setPermissionRequestHandler((wc, permission, cb) => {
      cb(isInternal(wc.getURL()) && ['clipboard-sanitized-write', 'fullscreen'].includes(permission));
    });
    buildMenu();
    const dir = await firstWorkspace();
    if (!dir) return app.quit();
    await openWorkspace(dir);
  });

  app.on('activate', () => {
    if (!win && serverPort) createWindow(`http://127.0.0.1:${serverPort}/`);
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

