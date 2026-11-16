// High-level edits used by the map, outline, details panel and keyboard shortcuts.
// Each one builds the change ops and their inverse (for Undo and Redo).

import { toast } from 'sonner';
import { MAX_MAP_NOTES, type Checkpoint, type FieldPath, type LayoutOffsets, type MapNote, type NoteColor } from '../shared/model';
import { requiresTransitively, type Op, type Settable } from '../shared/ops';
import { newId } from '../shared/ids';
import { getField, clone } from '../shared/fields';
import { ancestors, childrenIndex, compareSiblings } from '../shared/tree';
import { getState, recordEntry, recordUndo, selectCheckpoint, setState, submit, toggleExpanded, undoLast, writeLayout, type HistoryStep } from './store';

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
  requestDeleteMany([id]);
}

/** The same for several checkpoints and sticky notes selected together on the map. */
export function requestDeleteMany(ids: string[], noteIds: string[] = []) {
  const all = cps();
  const found = ids.filter((id) => all[id]);
  if (!found.length && !noteIds.length) return;
  if (found.some((id) => needsDeleteConfirm(all[id]!))) setState({ pendingDelete: { ids: found, notes: noteIds } });
  else void deleteMany(found, noteIds);
}

// ---------------------------------------------------------------- layout and sticky notes

/**
 * Save manual positions and sticky notes (optimistic: the map updates at once).
 * With a label, Undo puts back what was there before.
 */
export function saveLayout(patch: { offsets?: LayoutOffsets; notes?: MapNote[] }, label: string | null) {
  const rm = getState().roadmap;
  if (!rm) return;
  if (label) {
    const before: HistoryStep = { kind: 'layout' };
    if (patch.offsets) before.offsets = rm.layout?.offsets ?? {};
    if (patch.notes) before.notes = rm.layout?.notes ?? [];
    recordUndo(label, before);
  }
  writeLayout(patch);
}

const notes = () => getState().roadmap?.layout?.notes ?? [];

export function addNote(place: { anchor: string | null; dx: number; dy: number }, color: NoteColor = 'yellow') {
  if (notes().length >= MAX_MAP_NOTES) {
    toast(`A map can hold up to ${MAX_MAP_NOTES} sticky notes.`);
    return null;
  }
  const id = `note-${newId('cp').slice(3)}`;
  // Not an Undo step yet: an empty note disappears when you stop editing it (see finishNote).
  saveLayout({ notes: [...notes(), { id, text: '', color, w: 208, h: 120, ...place }] }, null);
  setState({ noteEdit: id });
  return id;
}

export function updateNote(id: string, patch: Partial<Omit<MapNote, 'id'>>, label = 'edit sticky note') {
  saveLayout({ notes: notes().map((n) => (n.id === id ? { ...n, ...patch } : n)) }, label);
}

/** Done typing in a sticky note: keep the text, or remove the note if it is empty. */
export function finishNote(id: string, text: string) {
  const note = notes().find((n) => n.id === id);
  if (!note) return;
  if (!text.trim()) {
    if (note.text.trim()) deleteNote(id);
    else saveLayout({ notes: notes().filter((n) => n.id !== id) }, null);
    return;
  }
  if (text === note.text) return;
  // A new note: one Undo step removes it again.
  if (!note.text.trim()) recordUndo('add sticky note', { kind: 'layout', notes: notes().filter((n) => n.id !== id) });
  saveLayout({ notes: notes().map((n) => (n.id === id ? { ...n, text } : n)) }, note.text.trim() ? 'edit sticky note' : null);
}

export function deleteNote(id: string) {
  if (!notes().some((n) => n.id === id)) return;
  saveLayout({ notes: notes().filter((n) => n.id !== id) }, 'delete sticky note');
  toast('Sticky note deleted', { action: { label: 'Undo', onClick: () => void undoLast() } });
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

export function deleteCheckpoint(id: string) {
  return deleteMany([id]);
}

/** Only the top ones of a selection: deleting or moving a checkpoint takes its sub-checkpoints along. */
export function topLevel(ids: string[]): string[] {
  const all = cps();
  const set = new Set(ids);
  return ids.filter((id) => all[id] && !ancestors(all, id).some((a) => set.has(a.id)));
}

/** Delete checkpoints (to Trash) and sticky notes as one Undo step. */
export async function deleteMany(ids: string[], noteIds: string[] = []) {
  const rm = getState().roadmap;
  if (!rm) return;
  const all = rm.checkpoints;
  const roots = topLevel(ids);
  const steps: HistoryStep[] = [];
  const gone = new Set(noteIds);
  const removedNotes = notes().filter((n) => gone.has(n.id));
  if (removedNotes.length) {
    steps.push({ kind: 'layout', notes: notes() });
    writeLayout({ notes: notes().filter((n) => !gone.has(n.id)) });
  }
  const sel = getState().selectedId;
  const parent = roots.length === 1 ? all[roots[0]!]!.parent : null;
  const res = roots.length ? await submit(roots.map((id) => ({ op: 'delete' as const, id })), { undo: null }) : null;
  if (sel && !cps()[sel]) selectCheckpoint(parent && cps()[parent] ? parent : null);
  if (res?.trashId) steps.push({ kind: 'restore', trashId: res.trashId, ids: roots });
  if (!steps.length) return;
  const what = deletedLabel(roots.map((id) => all[id]!.title), removedNotes.length);
  recordEntry(`delete ${what}`, steps, rm.meta.id);
  toast(`Deleted ${what}`, {
    description: roots.length ? 'Checkpoints go to Trash.' : undefined,
    action: { label: 'Undo', onClick: () => void undoLast() },
  });
}

function deletedLabel(titles: string[], noteCount: number): string {
  const parts: string[] = [];
  if (titles.length === 1) parts.push(`“${titles[0]}”`);
  else if (titles.length > 1) parts.push(`${titles.length} checkpoints`);
  if (noteCount) parts.push(noteCount === 1 ? '1 sticky note' : `${noteCount} sticky notes`);
  return parts.join(' and ');
}

export function setStatus(id: string, status: string) {
  setStatusMany([id], status);
}

/** One status for several checkpoints, as one Undo step. */
export function setStatusMany(ids: string[], status: string) {
  const all = cps();
  const changing = ids.filter((id) => all[id] && all[id]!.status !== status);
  if (!changing.length) return;
  void submit(
    changing.map((id) => ({ op: 'update' as const, id, set: { status } })),
    {
      undo: changing.map((id) => ({ op: 'update' as const, id, set: { status: all[id]!.status } })),
      label: changing.length === 1 ? 'status change' : `status of ${changing.length} checkpoints`,
    },
  );
}

/** Move several checkpoints under `parent` (keeping their order), as one Undo step. */
export function moveMany(ids: string[], parent: string) {
  const all = cps();
  if (!all[parent]) return;
  const above = new Set(ancestors(all, parent).map((a) => a.id));
  const order = (id: string) => {
    const cp = all[id]!;
    const sibs = Object.values(all).filter((c) => (c.parent ?? null) === (cp.parent ?? null)).sort(compareSiblings);
    return { cp, sibs, index: sibs.findIndex((c) => c.id === id) };
  };
  // In their original order, so Undo can put each one back after the sibling that was before it.
  const moving = topLevel(ids)
    .filter((id) => id !== parent && !above.has(id) && all[id]!.parent !== parent)
    .map(order)
    .sort((a, b) => (a.cp.parent ?? '').localeCompare(b.cp.parent ?? '') || a.index - b.index);
  if (!moving.length) return;
  toggleExpanded(parent, true);
  void submit(
    moving.map((m) => ({ op: 'move' as const, id: m.cp.id, parent })),
    {
      undo: moving.map((m) => ({ op: 'move' as const, id: m.cp.id, parent: m.cp.parent, after: m.index > 0 ? m.sibs[m.index - 1]!.id : null })),
      label: moving.length === 1 ? `move “${moving[0]!.cp.title}”` : `move ${moving.length} checkpoints`,
    },
  );
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
