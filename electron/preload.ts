// The only bridge from the page to the desktop app: two folder actions. No Node access in the page.

import { contextBridge, ipcRenderer } from 'electron';

contextBridge.exposeInMainWorld('waymarkDesktop', {
  isDesktop: true,
  platform: process.platform,
  showWorkspace: () => ipcRenderer.invoke('waymark:show-workspace'),
  changeWorkspace: () => ipcRenderer.invoke('waymark:change-workspace'),
});
