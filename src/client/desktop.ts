// What the desktop app offers the page (electron/preload.ts). Undefined in a normal browser.

import type { FolderInfo } from '../../electron/folders';

export type { FolderInfo };

export interface DesktopBridge {
  isDesktop: true;
  platform: string;
  showWorkspace: () => Promise<unknown>;
  setupInfo: () => Promise<{ suggested: string; current: string | null; platform: string } | null>;
  inspectFolder: (dir: string) => Promise<FolderInfo | null>;
  chooseFolder: (start?: string) => Promise<string | null>;
  /** Open (or set up) this folder as the workspace; the page reloads on success. */
  useFolder: (dir: string) => Promise<{ ok: boolean; error?: string }>;
  /** Copy the workspace into this folder, check it, and open it there; the page reloads on success. */
  moveWorkspace: (dir: string) => Promise<{ ok: boolean; error?: string }>;
  /** The menu asks the page to open a dialog. Returns an unsubscribe function. */
  onOpen: (cb: (what: string) => void) => () => void;
}

export function desktopBridge(): DesktopBridge | undefined {
  return (window as unknown as { waymarkDesktop?: DesktopBridge }).waymarkDesktop;
}
