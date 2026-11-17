// The desktop app's workspace-folder checks (welcome page, Workspace settings) and the verified copy
// behind "Move my workspace here".

import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { copyWorkspace, inspectFolder, normaliseInput, syncedBy } from '../electron/folders';

let root: string;
let home: string;
let ctx: { home: string; appDir: string; systemDirs: string[] };

beforeEach(() => {
  root = mkdtempSync(path.join(tmpdir(), 'wm-folders-'));
  home = path.join(root, 'home');
  mkdirSync(path.join(home, 'Documents'), { recursive: true });
  mkdirSync(path.join(root, 'app'), { recursive: true });
  mkdirSync(path.join(root, 'system'), { recursive: true });
  ctx = { home, appDir: path.join(root, 'app'), systemDirs: [path.join(root, 'system')] };
});
afterEach(() => rmSync(root, { recursive: true, force: true }));

describe('inspectFolder', () => {
  it('offers to create a folder that does not exist yet', async () => {
    const info = await inspectFolder(path.join(home, 'Documents', 'Waymark'), ctx);
    expect(info.state).toBe('new');
  });

  it('accepts a path pasted with quotes ("Copy as path")', async () => {
    const dir = path.join(home, 'Documents', 'My notes');
    expect((await inspectFolder(`"${dir}"`, ctx)).path).toBe(dir);
    expect(normaliseInput('  "C:\\x y"  ', home)).toBe('C:\\x y');
  });

  it('tells an empty folder (system files ignored) from one with other files', async () => {
    const dir = path.join(home, 'Documents', 'w');
    mkdirSync(dir);
    writeFileSync(path.join(dir, 'desktop.ini'), '');
    expect((await inspectFolder(dir, ctx)).state).toBe('empty');
    writeFileSync(path.join(dir, 'essay.docx'), 'x');
    const info = await inspectFolder(dir, ctx);
    expect(info.state).toBe('other');
    expect(info.count).toBe(1);
    expect(info.sample).toEqual(['essay.docx']);
  });

  it('recognises an existing workspace and counts its roadmaps, nested folders included', async () => {
    const dir = path.join(home, 'Documents', 'Waymark');
    mkdirSync(path.join(dir, 'roadmaps', 'Learning', 'ml'), { recursive: true });
    mkdirSync(path.join(dir, 'roadmaps', 'git'), { recursive: true });
    writeFileSync(path.join(dir, 'roadmaps', 'Learning', 'ml', 'roadmap.md'), '---\n---\n');
    writeFileSync(path.join(dir, 'roadmaps', 'git', 'roadmap.md'), '---\n---\n');
    writeFileSync(path.join(dir, 'AGENTS.md'), '# rules');
    const info = await inspectFolder(dir, ctx);
    expect(info.state).toBe('workspace');
    expect(info.roadmaps).toBe(2);
  });

  it('refuses folders that are too broad, the app folder, system folders, files and relative paths', async () => {
    const reason = async (p: string) => {
      const i = await inspectFolder(p, ctx);
      expect(i.state).toBe('blocked');
      return i.reason ?? '';
    };
    expect(await reason(home)).toMatch(/whole user folder/);
    expect(await reason(root)).toMatch(/contains your whole user folder/);
    expect(await reason(path.parse(root).root)).toMatch(/whole drive/);
    expect(await reason(path.join(root, 'app', 'notes'))).toMatch(/installed/);
    expect(await reason(path.join(root, 'system', 'x'))).toMatch(/system folder/);
    writeFileSync(path.join(home, 'file.txt'), 'x');
    expect(await reason(path.join(home, 'file.txt'))).toMatch(/file, not a folder/);
    expect(await reason(path.join(home, 'file.txt', 'sub'))).toMatch(/Part of this path is a file/);
    expect(await reason('notes')).toMatch(/full path/);
    expect(await reason('   ')).toMatch(/Type a folder path/);
  });

  it('names the cloud service that syncs a folder', () => {
    expect(syncedBy('C:\\Users\\a\\OneDrive\\Documents\\Waymark')).toBe('OneDrive');
    expect(syncedBy('C:\\Users\\a\\OneDrive - PES University\\Waymark')).toBe('OneDrive');
    expect(syncedBy('/Users/a/Dropbox/Waymark')).toBe('Dropbox');
    expect(syncedBy('/Users/a/Library/Mobile Documents/com~apple~CloudDocs/Waymark')).toBe('iCloud Drive');
    expect(syncedBy('C:\\Users\\a\\PESU\\waymark workspace')).toBeUndefined();
  });
});

describe('copyWorkspace', () => {
  const makeWorkspace = () => {
    const src = path.join(home, 'Documents', 'Waymark');
    mkdirSync(path.join(src, 'roadmaps', 'git', 'checkpoints'), { recursive: true });
    mkdirSync(path.join(src, 'roadmaps', 'git', 'attachments', 'cp-1'), { recursive: true });
    mkdirSync(path.join(src, '.waymark'), { recursive: true });
    writeFileSync(path.join(src, 'AGENTS.md'), '# rules');
    writeFileSync(path.join(src, 'roadmaps', 'git', 'roadmap.md'), '---\ntitle: Git\n---\n');
    writeFileSync(path.join(src, 'roadmaps', 'git', 'checkpoints', 'a.md'), '# My notes\n\nhello');
    writeFileSync(path.join(src, 'roadmaps', 'git', 'attachments', 'cp-1', 'slide.pdf'), Buffer.alloc(200_000, 7));
    writeFileSync(path.join(src, '.waymark', 'review.json'), '[]');
    return src;
  };

  it('copies every file, checks it, and leaves the original untouched', async () => {
    const src = makeWorkspace();
    const dest = path.join(home, 'Documents', 'Moved');
    const r = await copyWorkspace(src, dest);
    expect(r.files).toBe(5);
    expect(r.bytes).toBeGreaterThan(200_000);
    expect(readFileSync(path.join(dest, 'roadmaps', 'git', 'checkpoints', 'a.md'), 'utf8')).toContain('hello');
    expect(readFileSync(path.join(src, 'roadmaps', 'git', 'checkpoints', 'a.md'), 'utf8')).toContain('hello');
    expect((await inspectFolder(dest, ctx)).state).toBe('workspace');
  });

  it('copies into an empty folder that already exists', async () => {
    const src = makeWorkspace();
    const dest = path.join(home, 'Empty');
    mkdirSync(dest);
    expect((await copyWorkspace(src, dest)).files).toBe(5);
  });

  it('refuses to copy into or around itself, or over existing files', async () => {
    const src = makeWorkspace();
    await expect(copyWorkspace(src, path.join(src, 'inside'))).rejects.toThrow(/inside the current workspace/);
    await expect(copyWorkspace(src, path.join(home, 'Documents'))).rejects.toThrow(/contain the current workspace/);
    const busy = path.join(home, 'Busy');
    mkdirSync(busy);
    writeFileSync(path.join(busy, 'AGENTS.md'), 'someone else');
    await expect(copyWorkspace(src, busy)).rejects.toThrow();
    expect(readFileSync(path.join(busy, 'AGENTS.md'), 'utf8')).toBe('someone else');
  });
});
