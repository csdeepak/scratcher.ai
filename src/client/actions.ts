// High-level edits used by the map, outline, details panel and keyboard shortcuts.
// Each one builds the change ops and their inverse (for Undo).

import { toast } from 'sonner';
import { MAX_MAP_NOTES, type Checkpoint, type FieldPath, type LayoutOffsets, type MapNote, type NoteColor } from '../shared/model';
import { requiresTransitively, type Op, type Settable } from '../shared/ops';
import { newId } from '../shared/ids';
import { getField, clone } from '../shared/fields';
import { childrenIndex, compareSiblings } from '../shared/tree';
import { http } from './api';
import { getState, pushUndo, selectCheckpoint, setState, submit, toggleExpanded, undoLast } from './store';

const cps = () => getState().roadmap?.checkpoints ?? {};

/** True when the map is on screen (not the full-page view, and wide enough to show it next to the page). */
export function mapVisible(): boolean {
  if (getState().pageMode) return false;
  try {
    return window.matchMedia('(min-width: 768px)').matches;
  } catch {
    return true;
  }
}

export function addCheckpoint(parent: string | null, opts: { after?: string | null; title?: string; select?: boolean } = {}) {
  const id = newId('cp');
  const title = opts.title?.trim() || 'New checkpoint';
  if (parent) toggleExpanded(parent, true);
  void submit([{ op: 'add', id, parent, after: opts.after, title }], { undo: [{ op: 'delete', id }], label: `add “${title}”` });
  if (opts.select !== false) {
    selectCheckpoint(id, { center: true });
    // Type the name straight away: on the map when it is visible (like draw.io), otherwise on the page.
    if (!opts.title) setState(mapVisible() ? { mapRename: id } : { pendingTitleEdit: id });
  }
  return id;
}

/** Start renaming a checkpoint: on the map when it is visible, otherwise in the page title. */
export function startRename(id: string) {
  setState(mapVisible() ? { mapRename: id } : { detailsOpen: true, pendingTitleEdit: id });
}

/** Ask before deleting when the checkpoint holds work; otherwise delete straight away (Undo brings it back). */
export function requestDelete(id: string) {
  const cp = cps()[id];
  if (!cp) return;
  if (needsDeleteConfirm(cp)) setState({ pendingDelete: id });
  else void deleteCheckpoint(id);
}

// ---------------------------------------------------------------- layout and sticky notes

/** Save manual positions and sticky notes (optimistic: the map updates at once). */
export function saveLayout(patch: { offsets?: LayoutOffsets; notes?: MapNote[] }) {
  const rm = getState().roadmap;
  if (!rm) return;
  const layout = { schema: 'waymark-layout/1' as const, offsets: patch.offsets ?? rm.layout?.offsets ?? {}, notes: patch.notes ?? rm.layout?.notes ?? [] };
  setState({ roadmap: { ...rm, layout } });
  http.put(`/api/roadmaps/${rm.meta.id}/layout`, { offsets: layout.offsets, notes: layout.notes }).catch((e: Error) => toast.error(`Couldn't save the map: ${e.message}`));
}

const notes = () => getState().roadmap?.layout?.notes ?? [];

export function addNote(place: { anchor: string | null; dx: number; dy: number }, color: NoteColor = 'yellow') {
  if (notes().length >= MAX_MAP_NOTES) {
    toast(`A map can hold up to ${MAX_MAP_NOTES} sticky notes.`);
    return null;
  }
  const id = `note-${newId('cp').slice(3)}`;
  saveLayout({ notes: [...notes(), { id, text: '', color, w: 208, h: 120, ...place }] });
  setState({ noteEdit: id });
  return id;
}

export function updateNote(id: string, patch: Partial<Omit<MapNote, 'id'>>) {
  saveLayout({ notes: notes().map((n) => (n.id === id ? { ...n, ...patch } : n)) });
}

export function deleteNote(id: string) {
  const all = notes();
  const i = all.findIndex((n) => n.id === id);
  if (i < 0) return;
  const removed = all[i]!;
  saveLayout({ notes: all.filter((n) => n.id !== id) });
  if (removed.text.trim()) {
    toast('Sticky note deleted', {
      action: { label: 'Undo', onClick: () => saveLayout({ notes: [...notes().slice(0, i), removed, ...notes().slice(i)] }) },
    });
  }
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

/** Arrow drawn on the map from `first` to `then`: “then” requires “first”. Returns false when not allowed. */
export function connect(first: string, then: string): boolean {
  const all = cps();
  const a = all[first];
  const b = all[then];
  if (!a || !b || first === then) return false;
  if (b.prerequisites.includes(first)) return toast(`“${b.title}” already requires “${a.title}”.`), false;
  if (requiresTransitively(all, first, then)) return toast.error(`That would make a loop: “${a.title}” already needs “${b.title}” first.`), false;
  link(then, first);
  toast.success(`“${b.title}” now requires “${a.title}”.`);
  return true;
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
