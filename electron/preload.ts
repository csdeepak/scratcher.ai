// The only bridge from the page to the desktop app: folder actions for the welcome page and
// Workspace settings, and the menu asking the page to open a dialog. No Node access in the page.
// The main process checks every request comes from Waymark's own pages (main.ts, fromApp).

import { contextBridge, ipcRenderer, type IpcRendererEvent } from 'electron';

contextBridge.exposeInMainWorld('waymarkDesktop', {
  isDesktop: true,
  platform: process.platform,
  showWorkspace: () => ipcRenderer.invoke('waymark:show-workspace'),
  setupInfo: () => ipcRenderer.invoke('waymark:setup-info'),
  inspectFolder: (dir: string) => ipcRenderer.invoke('waymark:inspect-folder', dir),
  chooseFolder: (start?: string) => ipcRenderer.invoke('waymark:choose-folder', start),
  useFolder: (dir: string) => ipcRenderer.invoke('waymark:use-folder', dir),
  moveWorkspace: (dir: string) => ipcRenderer.invoke('waymark:move-workspace', dir),
  openFile: (absPath: string) => ipcRenderer.invoke('waymark:open-file', absPath),
  onOpen: (cb: (what: string) => void) => {
    const h = (_e: IpcRendererEvent, what: unknown) => cb(String(what));
    ipcRenderer.on('waymark:open', h);
    return () => void ipcRenderer.off('waymark:open', h);
  },
});
