// Queue of items waiting for the human: external edits to look over, and held changes to decide on.

import { promises as fs } from 'node:fs';
import path from 'node:path';
import type { FieldChange } from '../shared/model';
import type { HoldReason } from '../shared/guard';
import { fieldEquals } from '../shared/fields';
import { newId } from '../shared/ids';
import { writeFileAtomic } from './fsutil';

export type ReviewKind = 'changed' | 'created' | 'deleted' | 'held' | 'held-delete';

export interface ReviewChange extends FieldChange {
  reason?: HoldReason;
}

export interface ReviewItem {
  id: string;
  roadmapId: string;
  /** checkpoint id or "_roadmap" */
  checkpointId: string;
  title: string;
  kind: ReviewKind;
  createdAt: string;
  updatedAt: string;
  changes: ReviewChange[];
  trashId?: string;
  stale?: boolean;
}

export class ReviewStore {
  items: ReviewItem[] = [];
  constructor(private file: string) {}

  async load() {
    try {
      const data = JSON.parse(await fs.readFile(this.file, 'utf8')) as { items?: ReviewItem[] };
      this.items = Array.isArray(data.items) ? data.items : [];
    } catch {
      this.items = [];
    }
  }

  async save() {
    await writeFileAtomic(this.file, JSON.stringify({ items: this.items }, null, 2));
  }

  forRoadmap(roadmapId: string) {
    return this.items.filter((i) => i.roadmapId === roadmapId);
  }

  get(id: string) {
    return this.items.find((i) => i.id === id);
  }

  remove(id: string) {
    this.items = this.items.filter((i) => i.id !== id);
  }

  removeForRoadmap(roadmapId: string) {
    this.items = this.items.filter((i) => i.roadmapId !== roadmapId);
  }

  /** Add or merge an item. Repeated edits to the same checkpoint collapse into one entry. */
  add(item: Omit<ReviewItem, 'id' | 'createdAt' | 'updatedAt'>): void {
    const now = new Date().toISOString();
    const open = (kinds: ReviewKind[]) =>
      this.items.find((i) => i.roadmapId === item.roadmapId && i.checkpointId === item.checkpointId && kinds.includes(i.kind));

    if (item.kind === 'deleted') {
      const created = open(['created']);
      if (created) {
        // Created and deleted again before you looked: nothing left to review.
        this.remove(created.id);
        this.items = this.items.filter(
          (i) => !(i.roadmapId === item.roadmapId && i.checkpointId === item.checkpointId && i.kind === 'changed'),
        );
        return;
      }
    }
    if (item.kind === 'changed' || item.kind === 'held') {
      const existing = open(item.kind === 'changed' ? ['changed', 'created'] : ['held']);
      if (existing) {
        for (const ch of item.changes) {
          const prev = existing.changes.find((c) => c.field === ch.field);
          if (prev) {
            prev.after = ch.after;
            if (item.kind === 'held') prev.before = ch.before;
            prev.reason = ch.reason ?? prev.reason;
          } else existing.changes.push(ch);
        }
        if (existing.kind === 'changed') existing.changes = existing.changes.filter((c) => !fieldEquals(c.before, c.after));
        existing.title = item.title;
        existing.updatedAt = now;
        existing.stale = existing.stale || item.stale;
        if (existing.changes.length === 0 && existing.kind === 'changed') this.remove(existing.id);
        return;
      }
    }
    this.items.push({ ...item, id: newId('rv'), createdAt: now, updatedAt: now });
  }
}

export function reviewFile(root: string) {
  return path.join(root, '.waymark', 'review.json');
}
