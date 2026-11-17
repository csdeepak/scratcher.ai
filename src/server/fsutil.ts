import { promises as fs } from 'node:fs';
import path from 'node:path';
import { randomBytes } from 'node:crypto';

export async function exists(p: string): Promise<boolean> {
  try {
    await fs.access(p);
    return true;
  } catch {
    return false;
  }
}

export async function ensureDir(p: string): Promise<void> {
  await fs.mkdir(p, { recursive: true });
}

export async function readText(p: string): Promise<string | null> {
  try {
    return await fs.readFile(p, 'utf8');
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code === 'ENOENT') return null;
    throw e;
  }
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/**
 * Durable write: write a temp file in the same folder, fsync it, then rename over the target.
 * Readers (agents, editors, the watcher) never see a half-written file. On Windows a rename can
 * fail briefly while another program has the file open, so it retries and finally falls back
 * to an in-place write.
 */
export async function writeFileAtomic(target: string, text: string): Promise<void> {
  await ensureDir(path.dirname(target));
  const tmp = path.join(path.dirname(target), `.${path.basename(target)}.${randomBytes(4).toString('hex')}.tmp`);
  const fh = await fs.open(tmp, 'w');
  try {
    await fh.writeFile(text, 'utf8');
    await fh.sync();
  } finally {
    await fh.close();
  }
  let lastErr: unknown;
  for (let attempt = 0; attempt < 6; attempt++) {
    try {
      await fs.rename(tmp, target);
      return;
    } catch (e) {
      lastErr = e;
      const code = (e as NodeJS.ErrnoException).code;
      if (code !== 'EPERM' && code !== 'EACCES' && code !== 'EBUSY') break;
      await sleep(40 * (attempt + 1));
    }
  }
  try {
    await fs.writeFile(target, text, 'utf8');
  } catch (e) {
    await fs.rm(tmp, { force: true });
    throw lastErr ?? e;
  }
  await fs.rm(tmp, { force: true });
}

/** Atomic write for binary data (attachments). */
export async function writeBinaryAtomic(target: string, data: Uint8Array): Promise<void> {
  await ensureDir(path.dirname(target));
  const tmp = path.join(path.dirname(target), `.${path.basename(target)}.${randomBytes(4).toString('hex')}.tmp`);
  const fh = await fs.open(tmp, 'w');
  try {
    await fh.writeFile(data);
    await fh.sync();
  } finally {
    await fh.close();
  }
  await fs.rename(tmp, target).catch(async (e) => {
    await fs.rm(tmp, { force: true });
    throw e;
  });
}

/** Move a single file, falling back to copy + delete across drives. */
export async function moveFile(from: string, to: string): Promise<void> {
  await ensureDir(path.dirname(to));
  try {
    await fs.rename(from, to);
  } catch {
    await fs.copyFile(from, to);
    await fs.rm(from, { force: true, maxRetries: 5, retryDelay: 50 });
  }
}

export async function removeFile(p: string): Promise<void> {
  await fs.rm(p, { force: true, maxRetries: 5, retryDelay: 50 });
}

export async function listFiles(dir: string, filter: (name: string) => boolean): Promise<string[]> {
  try {
    const entries = await fs.readdir(dir, { withFileTypes: true });
    return entries.filter((e) => e.isFile() && filter(e.name)).map((e) => e.name);
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code === 'ENOENT') return [];
    throw e;
  }
}

export async function listDirs(dir: string): Promise<string[]> {
  try {
    const entries = await fs.readdir(dir, { withFileTypes: true });
    return entries.filter((e) => e.isDirectory() && !e.name.startsWith('.')).map((e) => e.name);
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code === 'ENOENT') return [];
    throw e;
  }
}

/** Move a directory robustly (copy + remove works even when a watcher holds handles on Windows). */
export async function moveDir(from: string, to: string): Promise<void> {
  await ensureDir(path.dirname(to));
  try {
    await fs.rename(from, to);
    return;
  } catch {
    await fs.cp(from, to, { recursive: true });
    await fs.rm(from, { recursive: true, force: true, maxRetries: 8, retryDelay: 100 });
  }
}

export function toPosix(p: string): string {
  return p.split(path.sep).join('/');
}

export function today(): string {
  const d = new Date();
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

export function stamp(): string {
  return new Date().toISOString().replace(/[:.]/g, '-');
}

/** Runs `fn` for every item, at most `limit` at a time. Each call starts in item order. */
export async function eachLimit<T>(items: T[], limit: number, fn: (item: T) => Promise<void>): Promise<void> {
  let next = 0;
  const worker = async () => {
    while (next < items.length) {
      const item = items[next++]!;
      await fn(item);
    }
  };
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
}
