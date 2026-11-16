// Updates from GitHub Releases with electron-updater (the flow of electron-builder's reference
// example, iffy/electron-updater-example): check a little after start and every few hours, download
// in the background, then offer to restart. If you choose "Later", the update installs when you quit.
//
// macOS: an unsigned app can't replace itself, so there it only says a new version exists and opens
// the download page. Errors (offline, no release yet) are logged, not shown, unless you asked.

import { app, dialog, shell, type BrowserWindow } from 'electron';
import { autoUpdater, type UpdateInfo } from 'electron-updater';

const RELEASES = 'https://github.com/csdeepak/scratcher.ai/releases/latest';
const EVERY = 6 * 60 * 60 * 1000;
const canInstall = process.platform !== 'darwin';

let started = false;
let manual = false;
let window: () => BrowserWindow | null = () => null;

const box = (o: Electron.MessageBoxOptions) => {
  const w = window();
  return w ? dialog.showMessageBox(w, o) : dialog.showMessageBox(o);
};

export function initUpdates(getWindow: () => BrowserWindow | null, enabled: () => boolean) {
  window = getWindow;
  if (started || !app.isPackaged) return;
  started = true;
  autoUpdater.autoDownload = canInstall;
  autoUpdater.autoInstallOnAppQuit = canInstall;
  autoUpdater.logger = { info: (m: unknown) => console.log('[update]', m), warn: (m: unknown) => console.warn('[update]', m), error: (m: unknown) => console.error('[update]', m), debug: () => {} };

  autoUpdater.on('update-available', (info: UpdateInfo) => {
    if (canInstall) {
      if (manual) void box({ type: 'info', title: 'Waymark', message: `Waymark ${info.version} is downloading.`, detail: 'You can keep working. You will be asked to restart when it is ready.' });
      return;
    }
    void box({
      type: 'info',
      title: 'Waymark',
      message: `Waymark ${info.version} is available.`,
      detail: `You have ${app.getVersion()}. Download it from the releases page and replace the app.`,
      buttons: ['Open download page', 'Later'],
    }).then((r) => r.response === 0 && void shell.openExternal(RELEASES));
  });
  autoUpdater.on('update-not-available', () => {
    if (manual) void box({ type: 'info', title: 'Waymark', message: 'Waymark is up to date.', detail: `Version ${app.getVersion()}.` });
    manual = false;
  });
  autoUpdater.on('update-downloaded', (info) => {
    manual = false;
    void box({
      type: 'info',
      title: 'Waymark',
      message: `Waymark ${info.version} is ready to install.`,
      detail: 'Restart now to update. Your work is saved first. If you choose Later, it installs when you quit.',
      buttons: ['Restart now', 'Later'],
      defaultId: 0,
    }).then((r) => r.response === 0 && autoUpdater.quitAndInstall());
  });
  autoUpdater.on('error', (err) => {
    console.error('[update]', err?.message ?? err);
    if (manual) void box({ type: 'warning', title: 'Waymark', message: "Couldn't check for updates.", detail: String(err?.message ?? err).split('\n')[0] });
    manual = false;
  });

  const auto = () => {
    if (enabled()) void autoUpdater.checkForUpdates().catch(() => {});
  };
  setTimeout(auto, 15_000);
  setInterval(auto, EVERY).unref();
}

/** Help → Check for updates… */
export function checkForUpdatesNow() {
  if (!app.isPackaged) {
    void box({ type: 'info', title: 'Waymark', message: 'Updates work in the installed app.', detail: 'This copy runs from the source folder; update it with git pull.' });
    return;
  }
  manual = true;
  void autoUpdater.checkForUpdates().catch(() => {});
}

/** For the automated check (WAYMARK_SMOKE_TEST): ask GitHub once and report what happened. */
export async function probeUpdates(): Promise<string> {
  if (!app.isPackaged) return 'not packaged';
  try {
    const r = await autoUpdater.checkForUpdates();
    return r ? `latest ${r.updateInfo.version}` : 'disabled';
  } catch (e) {
    return `error: ${(String((e as Error).message ?? e).split('\n')[0] ?? '').slice(0, 120)}`;
  }
}
