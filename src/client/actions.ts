// High-level edits used by the map, outline, details panel and keyboard shortcuts.
// Each one builds the change ops and their inverse (for Undo).

import { toast } from 'sonner';
import type { Checkpoint, FieldPath } from '../shared/model';
import type { Op, Settable } from '../shared/ops';
import { newId } from '../shared/ids';
import { getField, clone } from '../shared/fields';
import { childrenIndex, compareSiblings } from '../shared/tree';
import { getState, pushUndo, selectCheckpoint, setState, submit, toggleExpanded, undoLast } from './store';

const cps = () => getState().roadmap?.checkpoints ?? {};

export function addCheckpoint(parent: string | null, opts: { after?: string | null; title?: string; select?: boolean } = {}) {
  const id = newId('cp');
  const title = opts.title?.trim() || 'New checkpoint';
  if (parent) toggleExpanded(parent, true);
  void submit([{ op: 'add', id, parent, after: opts.after, title }], { undo: [{ op: 'delete', id }], label: `add “${title}”` });
  if (opts.select !== false) {
    selectCheckpoint(id, { center: true });
    if (!opts.title) setState({ pendingTitleEdit: id });
  }
  return id;
}

export function addSibling(id: string) {
  const cp = cps()[id];
  if (!cp) return;
  return addCheckpoint(cp.parent, { after: id });
}

/** Update fields; the inverse restores the previous values. */
export function updateFields(id: string, set: Settable, label = 'edit', opts: { expect?: boolean; undo?: boolean } = {}) {
  const cp = cps()[id];
  if (!cp) return Promise.resolve(null);
  const prev: Record<string, unknown> = {};
  const expect: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(set)) {
    if (k === 'sections') {
      const s: Record<string, string> = {};
      for (const sk of Object.keys(v as object)) s[sk] = cp.sections[sk as keyof typeof cp.sections] ?? '';
      prev.sections = s;
      expect.sections = s;
    } else {
      prev[k] = clone(getField(cp, k as FieldPath));
      expect[k] = prev[k];
    }
  }
  const op: Op = { op: 'update', id, set, ...(opts.expect ? { expect } : {}) };
  return submit([op], { undo: opts.undo === false ? null : [{ op: 'update', id, set: prev as Settable }], label });
}

export function moveCheckpoint(id: string, parent: string | null, pos: { index?: number; after?: string | null } = {}) {
  const all = cps();
  const cp = all[id];
  if (!cp) return;
  const oldSiblings = Object.values(all).filter((c) => (c.parent ?? null) === (cp.parent ?? null)).sort(compareSiblings);
  const oldIndex = oldSiblings.findIndex((c) => c.id === id);
  const prevAfter = oldIndex > 0 ? oldSiblings[oldIndex - 1]!.id : null;
  if (parent) toggleExpanded(parent, true);
  void submit([{ op: 'move', id, parent, ...pos }], { undo: [{ op: 'move', id, parent: cp.parent, after: prevAfter }], label: `move “${cp.title}”` });
}

export function shiftCheckpoint(id: string, dir: -1 | 1) {
  const all = cps();
  const cp = all[id];
  if (!cp) return;
  const sibs = Object.values(all).filter((c) => (c.parent ?? null) === (cp.parent ?? null)).sort(compareSiblings);
  const i = sibs.findIndex((c) => c.id === id);
  const j = i + dir;
  if (j < 0 || j >= sibs.length) return;
  moveCheckpoint(id, cp.parent, { after: dir === -1 ? (j > 0 ? sibs[j - 1]!.id : null) : sibs[j]!.id });
}

export function indent(id: string) {
  const all = cps();
  const cp = all[id];
  if (!cp) return;
  const sibs = Object.values(all).filter((c) => (c.parent ?? null) === (cp.parent ?? null)).sort(compareSiblings);
  const i = sibs.findIndex((c) => c.id === id);
  if (i <= 0) return toast('Indent needs a checkpoint above this one at the same level.');
  moveCheckpoint(id, sibs[i - 1]!.id);
}

export function outdent(id: string) {
  const all = cps();
  const cp = all[id];
  if (!cp?.parent) return;
  const parent = all[cp.parent];
  moveCheckpoint(id, parent?.parent ?? null, { after: cp.parent });
}

export async function deleteCheckpoint(id: string) {
  const cp = cps()[id];
  if (!cp) return;
  const parent = cp.parent;
  const res = await submit([{ op: 'delete', id }], { undo: null });
  if (getState().selectedId === id || !cps()[getState().selectedId ?? '']) selectCheckpoint(parent && cps()[parent] ? parent : null);
  if (res?.trashId) {
    const rid = getState().roadmap!.meta.id;
    pushUndo({ label: `delete “${cp.title}”`, roadmapId: rid, trashId: res.trashId });
    toast(`Deleted “${cp.title}”`, {
      description: 'It is in Trash.',
      action: {
        label: 'Undo',
        onClick: () => void undoLast(),
      },
    });
  }
}

export function setStatus(id: string, status: string) {
  const cp = cps()[id];
  if (!cp || cp.status === status) return;
  void updateFields(id, { status }, 'status change');
}

export function link(id: string, prerequisite: string) {
  void submit([{ op: 'link', id, prerequisite }], { undo: [{ op: 'unlink', id, prerequisite }], label: 'add prerequisite' });
}

export function unlink(id: string, prerequisite: string) {
  void submit([{ op: 'unlink', id, prerequisite }], { undo: [{ op: 'link', id, prerequisite }], label: 'remove prerequisite' });
}

export function subtreeCount(id: string): number {
  const idx = childrenIndex(cps());
  let n = 0;
  const stack = [...(idx.get(id) ?? [])];
  while (stack.length) {
    const c = stack.pop()!;
    n++;
    stack.push(...(idx.get(c.id) ?? []));
  }
  return n;
}

export function needsDeleteConfirm(cp: Checkpoint): boolean {
  if (subtreeCount(cp.id) > 0) return true;
  if (cp.status !== 'not-started' || cp.approved) return true;
  return Object.values(cp.sections).some((v) => v && v.trim().length > 0);
}
