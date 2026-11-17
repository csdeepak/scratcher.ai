// The workspace folder: checks a folder before Waymark uses it (on the welcome screen and in
// Workspace settings), and copies a whole workspace to a new folder, then compares every file.
// No Electron in here, so the tests run it in plain Node.

import { createHash } from 'node:crypto';
import { constants, createReadStream } from 'node:fs';
import { access, cp, mkdir, readdir, stat } from 'node:fs/promises';
import path from 'node:path';

export type FolderState =
  /** doesn't exist yet: Waymark creates it */
  | 'new'
  /** exists and is empty */
  | 'empty'
  /** already a Waymark workspace: Waymark opens it */
  | 'workspace'
  /** has other files: allowed, with a warning */
  | 'other'
  /** can't or shouldn't be used; `reason` says why */
  | 'blocked';

export interface FolderInfo {
  path: string;
  state: FolderState;
  reason?: string;
  /** workspace: how many roadmaps it holds */
  roadmaps?: number;
  /** other: how many entries there are, and a few of their names */
  count?: number;
  sample?: string[];
  /** the service that syncs this folder to the cloud, if any (OneDrive, Dropbox, …) */
  synced?: string;
}

export interface FolderContext {
  home: string;
  /** where the app itself is installed: never a workspace, updates replace it */
  appDir?: string;
  /** folders that belong to the system (Windows, Program Files, /usr, …) */
  systemDirs?: string[];
  platform?: NodeJS.Platform;
}

/** Files the system puts in folders by itself; they don't make a folder "not empty". */
const IGNORED = new Set(['desktop.ini', 'thumbs.db', '.ds_store', '.localized']);

export function isInside(child: string, parent: string): boolean {
  const rel = path.relative(parent, child);
  return rel === '' || (!rel.startsWith('..') && !path.isAbsolute(rel));
}

/** The system folders of this computer, from the environment. */
export function systemDirs(platform: NodeJS.Platform = process.platform, env: NodeJS.ProcessEnv = process.env): string[] {
  if (platform === 'win32') {
    return [env.SystemRoot ?? env.WINDIR ?? 'C:\\Windows', env.ProgramFiles, env['ProgramFiles(x86)'], env.ProgramData].filter((d): d is string => !!d);
  }
  const unix = ['/bin', '/sbin', '/usr', '/etc', '/var', '/opt', '/boot', '/dev', '/proc', '/sys', '/lib', '/lib64'];
  return platform === 'darwin' ? [...unix, '/System', '/Library', '/Applications', '/private'] : unix;
}

/** The cloud service whose folder this is, by the folder names they use. */
export function syncedBy(dir: string): string | undefined {
  for (const part of dir.split(/[\\/]+/)) {
    const p = part.toLowerCase();
    if (/^onedrive( - .+)?$/.test(p)) return 'OneDrive';
    if (p === 'dropbox' || p.startsWith('dropbox (')) return 'Dropbox';
    if (p === 'google drive' || p === 'my drive' || p === 'googledrive') return 'Google Drive';
    if (p === 'icloud drive' || p === 'iclouddrive' || p === 'mobile documents') return 'iCloud Drive';
  }
  return undefined;
}

/** What typed text means as a folder: quotes from "Copy as path" removed, ~ expanded. */
export function normaliseInput(input: string, home: string): string {
  let s = input.trim();
  if (s.length >= 2 && ((s.startsWith('"') && s.endsWith('"')) || (s.startsWith("'") && s.endsWith("'")))) s = s.slice(1, -1).trim();
  if (s === '~' || s.startsWith('~/') || s.startsWith('~\\')) s = path.join(home, s.slice(1));
  return s;
}

const exists = async (p: string) => {
  try {
    return await stat(p);
  } catch {
    return null;
  }
};
const writable = async (p: string) => {
  try {
    await access(p, constants.W_OK);
    return true;
  } catch {
    return false;
  }
};

/** Roadmaps in a workspace: folders under roadmaps/ that contain roadmap.md (groups nest up to 4 deep). */
async function countRoadmaps(dir: string, depth = 0): Promise<number> {
  if (depth > 5) return 0;
  let n = 0;
  let entries;
  try {
    entries = await readdir(dir, { withFileTypes: true });
  } catch {
    return 0;
  }
  if (entries.some((e) => e.isFile() && e.name === 'roadmap.md')) return 1;
  for (const e of entries) if (e.isDirectory() && !e.name.startsWith('.')) n += await countRoadmaps(path.join(dir, e.name), depth + 1);
  return n;
}

export async function inspectFolder(input: string, ctx: FolderContext): Promise<FolderInfo> {
  const platform = ctx.platform ?? process.platform;
  const raw = normaliseInput(input, ctx.home);
  const blocked = (reason: string, p = raw): FolderInfo => ({ path: p, state: 'blocked', reason });
  if (!raw) return blocked('Type a folder path, or choose one with Browse.');
  if (!path.isAbsolute(raw)) {
    return blocked(`Use a full path, for example ${platform === 'win32' ? 'C:\\Users\\you\\Documents\\Waymark' : '/Users/you/Documents/Waymark'}.`);
  }
  const dir = path.resolve(raw);
  const synced = syncedBy(dir);
  const home = path.resolve(ctx.home);

  if (path.parse(dir).root === dir) return blocked('This is a whole drive. Choose or create a folder for Waymark inside it.', dir);
  if (isInside(home, dir)) {
    return blocked(
      dir === home || path.relative(dir, home) === ''
        ? 'This is your whole user folder. Choose or create a folder for Waymark inside it.'
        : 'This folder contains your whole user folder. Choose or create a folder for Waymark instead.',
      dir,
    );
  }
  if (ctx.appDir && isInside(dir, path.resolve(ctx.appDir))) {
    return blocked('This is where the Waymark app is installed, and updates replace it. Keep your notes somewhere else.', dir);
  }
  if ((ctx.systemDirs ?? systemDirs(platform)).some((s) => isInside(dir, path.resolve(s)))) {
    return blocked('This is a system folder. Choose a folder among your own files, for example in Documents.', dir);
  }

  const st = await exists(dir);
  if (!st) {
    // A new folder: the nearest folder that exists must be a folder we can write to.
    let up = path.dirname(dir);
    for (;;) {
      const s = await exists(up);
      if (s) {
        if (!s.isDirectory()) return blocked('Part of this path is a file, not a folder.', dir);
        if (!(await writable(up))) return blocked(`Waymark can't create a folder in ${up}.`, dir);
        return { path: dir, state: 'new', synced };
      }
      const next = path.dirname(up);
      if (next === up) return blocked("This drive or location doesn't exist.", dir);
      up = next;
    }
  }
  if (!st.isDirectory()) return blocked('That is a file, not a folder.', dir);
  if (!(await writable(dir))) return blocked("Waymark can't write to this folder.", dir);

  let names: string[];
  try {
    names = (await readdir(dir)).filter((n) => !IGNORED.has(n.toLowerCase()));
  } catch {
    return blocked("Waymark can't read this folder.", dir);
  }
  const has = (n: string) => names.includes(n);
  if (has('.waymark') || (has('roadmaps') && (has('AGENTS.md') || has('LIBRARY.md')))) {
    return { path: dir, state: 'workspace', roadmaps: await countRoadmaps(path.join(dir, 'roadmaps')), synced };
  }
  if (!names.length) return { path: dir, state: 'empty', synced };
  const visible = names.filter((n) => !n.startsWith('.'));
  return { path: dir, state: 'other', count: names.length, sample: (visible.length ? visible : names).slice(0, 4), synced };
}

// ---------------------------------------------------------------- moving a workspace

interface FileSig {
  size: number;
  hash: string;
}

const hashFile = (p: string) =>
  new Promise<string>((resolve, reject) => {
    const h = createHash('sha256');
    createReadStream(p)
      .on('error', reject)
      .on('data', (c) => h.update(c))
      .on('end', () => resolve(h.digest('hex')));
  });

/** Every file under `root` by its path relative to root (with /), with its size and checksum. */
async function listFiles(root: string): Promise<Map<string, FileSig>> {
  const out = new Map<string, FileSig>();
  const walk = async (dir: string, rel: string) => {
    for (const e of await readdir(dir, { withFileTypes: true })) {
      const abs = path.join(dir, e.name);
      const r = rel ? `${rel}/${e.name}` : e.name;
      if (e.isDirectory()) await walk(abs, r);
      else if (e.isFile()) out.set(r, { size: (await stat(abs)).size, hash: await hashFile(abs) });
    }
  };
  await walk(root, '');
  return out;
}

/**
 * Copies the workspace `src` into `dest` (which must not exist yet, or be empty), then checks that
 * every file arrived intact. The original is left exactly as it was.
 */
export async function copyWorkspace(src: string, dest: string): Promise<{ files: number; bytes: number }> {
  const from = path.resolve(src);
  const to = path.resolve(dest);
  if (isInside(to, from)) throw new Error("The new folder can't be inside the current workspace.");
  if (isInside(from, to)) throw new Error("The new folder can't contain the current workspace.");
  const before = await listFiles(from);
  // Entry by entry, so an existing empty folder works as the target; never overwrites anything.
  await mkdir(to, { recursive: true });
  for (const name of await readdir(from)) {
    await cp(path.join(from, name), path.join(to, name), { recursive: true, errorOnExist: true, force: false, preserveTimestamps: true });
  }
  const after = await listFiles(to);
  let bytes = 0;
  for (const [rel, f] of before) {
    const g = after.get(rel);
    if (!g || g.size !== f.size || g.hash !== f.hash) throw new Error(`The copy of ${rel} doesn't match the original.`);
    bytes += f.size;
  }
  return { files: before.size, bytes };
}
