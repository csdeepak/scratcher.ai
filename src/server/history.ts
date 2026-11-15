// Append-only change history: one JSON line per change with the full file text before and after.
// Rapid edits made in the app are coalesced per checkpoint so typing doesn't flood the log.

import { promises as fs } from 'node:fs';
import path from 'node:path';
import { ensureDir } from './fsutil';
import { newId } from '../shared/ids';

export type HistorySource = 'app' | 'external' | 'proposal' | 'import' | 'restore' | 'review' | 'system';

export interface HistoryEntry {
  id: string;
  t: string;
  roadmapId: string;
  /** checkpoint id, or "_roadmap" for roadmap.md */
  cp: string;
  title: string;
  source: HistorySource;
  kind: 'create' | 'update' | 'delete';
  before: string | null;
  after: string | null;
  note?: string;
}

const COALESCE_MS = 15_000;

export class History {
  private pending = new Map<string, { entry: HistoryEntry; first: number; timer: NodeJS.Timeout }>();
  private writing: Promise<void> = Promise.resolve();

  constructor(private dir: string) {}

  private file(roadmapId: string) {
    return path.join(this.dir, `${roadmapId}.jsonl`);
  }

  record(e: Omit<HistoryEntry, 'id' | 't'>, opts: { coalesce?: boolean } = {}): void {
    const key = `${e.roadmapId}:${e.cp}`;
    const now = Date.now();
    const open = this.pending.get(key);
    if (opts.coalesce && e.kind === 'update' && open && open.entry.source === e.source && now - open.first < COALESCE_MS) {
      open.entry.after = e.after;
      open.entry.title = e.title;
      open.entry.t = new Date(now).toISOString();
      return;
    }
    if (open) this.flushKey(key);
    const entry: HistoryEntry = { id: newId('hx'), t: new Date(now).toISOString(), ...e };
    if (opts.coalesce && e.kind === 'update') {
      const timer = setTimeout(() => this.flushKey(key), COALESCE_MS);
      timer.unref?.();
      this.pending.set(key, { entry, first: now, timer });
    } else {
      this.append(entry);
    }
  }

  private flushKey(key: string) {
    const open = this.pending.get(key);
    if (!open) return;
    clearTimeout(open.timer);
    this.pending.delete(key);
    if (open.entry.before !== open.entry.after) this.append(open.entry);
  }

  flushAll(): Promise<void> {
    for (const key of [...this.pending.keys()]) this.flushKey(key);
    return this.writing;
  }

  private append(entry: HistoryEntry) {
    const line = JSON.stringify(entry) + '\n';
    this.writing = this.writing
      .then(async () => {
        await ensureDir(this.dir);
        await fs.appendFile(this.file(entry.roadmapId), line, 'utf8');
      })
      .catch((err) => console.error('[waymark] history write failed:', err));
  }

  async read(roadmapId: string): Promise<HistoryEntry[]> {
    await this.flushAll();
    let text: string;
    try {
      text = await fs.readFile(this.file(roadmapId), 'utf8');
    } catch {
      return [];
    }
    const out: HistoryEntry[] = [];
    for (const line of text.split('\n')) {
      if (!line.trim()) continue;
      try {
        out.push(JSON.parse(line) as HistoryEntry);
      } catch {
        /* skip a damaged line rather than fail */
      }
    }
    return out;
  }

  async forCheckpoint(roadmapId: string, cp: string, limit = 200): Promise<HistoryEntry[]> {
    const all = await this.read(roadmapId);
    return all.filter((e) => e.cp === cp).slice(-limit).reverse();
  }

  async get(roadmapId: string, entryId: string): Promise<HistoryEntry | null> {
    const all = await this.read(roadmapId);
    return all.find((e) => e.id === entryId) ?? null;
  }
}
