// Client state. The server's files are the source of truth; the client applies edits
// optimistically with the same change engine, queues them in a persistent outbox and
// reconciles whenever the server reports a change.

import { create } from 'zustand';
import { toast } from 'sonner';
import type { FieldPath, LayoutOffsets, MapNote, Problem, Roadmap, RoadmapSummary } from '../shared/model';
import { applyOps, type Op, type OpResult } from '../shared/ops';
import { ancestors } from '../shared/tree';
import type { ReviewItem } from '../server/review';
import type { ProposalView } from '../server/workspace';
import { ApiError, http, subscribe, type ServerEvent } from './api';

export type Route = { page: 'home' } | { page: 'roadmap'; id: string; cp?: string };
export type SaveState = 'saved' | 'saving' | 'offline' | 'error';
export type Dialog = null | 'new' | 'settings' | 'trash' | 'agent' | 'shortcuts' | 'palette' | 'paste' | 'template' | 'export' | 'import' | 'toolbar';
/** The two bars you can arrange yourself (see toolbars.ts). */
export type BarId = 'notes' | 'map';

interface OutboxEntry {
  key: string;
  roadmapId: string;
  ops: Op[];
}

export interface Conflict {
  cpId: string;
  field: FieldPath;
  current: unknown;
  yours: unknown;
}

/** One part of an undoable change. Applying it returns its opposite (see "undo / redo" below). */
export type HistoryStep =
  | { kind: 'ops'; ops: Op[]; inverse: Op[] }
  | { kind: 'delete'; ids: string[] }
  | { kind: 'restore'; trashId: string; ids: string[] }
  | { kind: 'layout'; offsets?: LayoutOffsets; notes?: MapNote[] };

export interface HistoryEntry {
  label: string;
  roadmapId: string;
  /** In the order they were recorded; applied last to first. */
  steps: HistoryStep[];
}

interface OpsResponse {
  results: OpResult[];
  trashId?: string;
}

interface State {
  ready: boolean;
  workspace: string;
  summaries: RoadmapSummary[];
  /** Library folders (paths under roadmaps/) */
  folders: string[];
  /** Folder selected in the library: new roadmaps go here; the home page shows it. null = everything. */
  currentFolder: string | null;
  libraryOpen: boolean;
  libraryDrawer: boolean;
  /** Roadmap the Export dialog is for (defaults to the open one). */
  exportTarget: string | null;
  /** Attached image or PDF open in the full-screen viewer. */
  viewer: { roadmapId: string; path: string; name: string; kind: 'image' | 'pdf' | 'other' } | null;
  workspaceProblems: Problem[];
  connected: boolean;
  route: Route;
  roadmap: Roadmap | null;
  loadError: string | null;
  selectedId: string | null;
  focusId: string | null;
  expanded: Set<string>;
  saveState: SaveState;
  saveError: string | null;
  outbox: OutboxEntry[];
  review: { items: ReviewItem[]; proposals: ProposalView[] };
  conflicts: Conflict[];
  undoStack: HistoryEntry[];
  redoStack: HistoryEntry[];
  outlineOpen: boolean;
  outlineDrawer: boolean;
  detailsOpen: boolean;
  pageMode: boolean;
  reviewOpen: boolean;
  dialog: Dialog;
  prereqMode: 'all' | 'selected';
  fitRequest: number;
  centerRequest: { id: string; n: number } | null;
  /** Checkpoint whose title should be focused for typing as soon as it is shown. */
  pendingTitleEdit: string | null;
  /** Checkpoint being renamed directly on the map. */
  mapRename: string | null;
  /** Sticky note whose text is being edited on the map. */
  noteEdit: string | null;
  /** Checkpoints (and sticky notes) waiting for "Delete?" confirmation. */
  pendingDelete: { ids: string[]; notes: string[] } | null;
  theme: 'system' | 'light' | 'dark';
  /** Your own button order per bar; a bar you haven't changed isn't listed (it uses the default). */
  toolbars: Partial<Record<BarId, string[]>>;
  /** Which bar the "Customise toolbar" dialog is for. */
  toolbarTarget: BarId;
}

const OUTBOX_KEY = 'waymark.outbox';
const loadOutbox = (): OutboxEntry[] => {
  try {
    return JSON.parse(localStorage.getItem(OUTBOX_KEY) ?? '[]');
  } catch {
    return [];
  }
};
const saveOutbox = (o: OutboxEntry[]) => {
  try {
    localStorage.setItem(OUTBOX_KEY, JSON.stringify(o));
  } catch {
    /* storage full or blocked: the queue still lives in memory */
  }
};
const expandedKey = (id: string) => `waymark.expanded.${id}`;

export function parseRoute(hash = location.hash): Route {
  const m = hash.match(/^#\/r\/([^/?#]+)(?:\/([^/?#]+))?/);
  if (m) return { page: 'roadmap', id: decodeURIComponent(m[1]!), cp: m[2] ? decodeURIComponent(m[2]) : undefined };
  return { page: 'home' };
}

export function routeHash(r: Route): string {
  return r.page === 'home' ? '#/' : `#/r/${encodeURIComponent(r.id)}${r.cp ? `/${encodeURIComponent(r.cp)}` : ''}`;
}

export const useStore = create<State>(() => ({
  ready: false,
  workspace: '',
  summaries: [],
  folders: [],
  currentFolder: null,
  libraryOpen: (() => {
    try {
      return localStorage.getItem('waymark.libraryOpen') !== '0';
    } catch {
      return true;
    }
  })(),
  libraryDrawer: false,
  exportTarget: null,
  viewer: null,
  workspaceProblems: [],
  connected: true,
  route: parseRoute(),
  roadmap: null,
  loadError: null,
  selectedId: null,
  focusId: null,
  expanded: new Set(),
  saveState: 'saved',
  saveError: null,
  outbox: loadOutbox(),
  review: { items: [], proposals: [] },
  conflicts: [],
  undoStack: [],
  redoStack: [],
  outlineOpen: (() => {
    try {
      const v = localStorage.getItem('waymark.outlineOpen');
      return v === null ? true : v === '1';
    } catch {
      return true;
    }
  })(),
  outlineDrawer: false,
  detailsOpen: true,
  pageMode: false,
  reviewOpen: false,
  dialog: null,
  prereqMode: 'all',
  fitRequest: 0,
  centerRequest: null,
  pendingTitleEdit: null,
  mapRename: null,
  noteEdit: null,
  pendingDelete: null,
  theme: (localStorage.getItem('waymark.theme') as State['theme']) ?? 'light',
  toolbars: (() => {
    try {
      const v = JSON.parse(localStorage.getItem('waymark.toolbars') ?? '{}') as unknown;
      return v && typeof v === 'object' ? (v as State['toolbars']) : {};
    } catch {
      return {};
    }
  })(),
  toolbarTarget: 'notes',
}));

const set = useStore.setState;
const get = useStore.getState;

// ---------------------------------------------------------------- loading

export async function initApp() {
  window.addEventListener('hashchange', () => applyRoute(parseRoute()));
  subscribe(onServerEvent, (connected) => {
    set({ connected });
    if (connected) {
      void refreshSummaries();
      void refreshReview();
      const rm = get().roadmap;
      if (rm) void reloadRoadmap(rm.meta.id);
      void flushOutbox();
    }
  });
  try {
    const state = await http.get<{ workspace: string; roadmaps: RoadmapSummary[]; problems: Problem[] }>('/api/state');
    set({ workspace: state.workspace, summaries: state.roadmaps, workspaceProblems: state.problems });
    await refreshLibrary();
  } catch (e) {
    set({ connected: false });
    toast.error((e as Error).message);
  }
  await refreshReview();
  await applyRoute(get().route);
  set({ ready: true });
  void flushOutbox();
}

let reloadTimer: ReturnType<typeof setTimeout> | null = null;
function onServerEvent(e: ServerEvent) {
  if (e.type === 'roadmaps') void refreshSummaries();
  if (e.type === 'review') void refreshReview();
  if (e.type === 'roadmap' && e.roadmapId === get().roadmap?.meta.id) {
    if (reloadTimer) clearTimeout(reloadTimer);
    reloadTimer = setTimeout(() => void reloadRoadmap(e.roadmapId), 80);
    if (e.source === 'external' && e.ids.length) void refreshReview();
  }
}

export async function refreshLibrary() {
  try {
    const lib = await http.get<{ folders: string[]; roadmaps: RoadmapSummary[] }>('/api/library');
    const cur = get().currentFolder;
    set({ folders: lib.folders, summaries: lib.roadmaps, ...(cur && !lib.folders.includes(cur) ? { currentFolder: null } : {}) });
  } catch {
    /* offline indicator covers this */
  }
}

export function toggleLibrary() {
  if (window.innerWidth < 1024) return set({ libraryDrawer: !get().libraryDrawer });
  const v = !get().libraryOpen;
  set({ libraryOpen: v });
  try {
    localStorage.setItem('waymark.libraryOpen', v ? '1' : '0');
  } catch {
    /* fine */
  }
}

export async function refreshSummaries() {
  try {
    const s = await http.get<{ roadmaps: RoadmapSummary[]; problems: Problem[]; workspace: string }>('/api/state');
    set({ summaries: s.roadmaps, workspaceProblems: s.problems, workspace: s.workspace });
    await refreshLibrary();
  } catch {
    /* offline indicator covers this */
  }
}

export async function refreshReview() {
  try {
    set({ review: await http.get('/api/review') });
  } catch {
    /* ignore */
  }
}

async function applyRoute(route: Route) {
  set({ route });
  if (route.page === 'home') {
    set({ roadmap: null, selectedId: null, focusId: null, loadError: null });
    void refreshSummaries();
    return;
  }
  if (get().roadmap?.meta.id !== route.id) await loadRoadmap(route.id);
  if (route.cp && get().roadmap?.checkpoints[route.cp]) selectCheckpoint(route.cp, { center: true, updateHash: false });
}

export function navigate(route: Route) {
  const hash = routeHash(route);
  if (location.hash !== hash) location.hash = hash;
  else void applyRoute(route);
}

async function loadRoadmap(id: string) {
  set({ loadError: null });
  try {
    const rm = await http.get<Roadmap>(`/api/roadmaps/${encodeURIComponent(id)}`);
    let expanded: Set<string>;
    try {
      const raw = localStorage.getItem(expandedKey(id));
      expanded = raw ? new Set(JSON.parse(raw) as string[]) : defaultExpanded(rm);
    } catch {
      expanded = defaultExpanded(rm);
    }
    set({ roadmap: withOutbox(rm), expanded, selectedId: null, focusId: null, undoStack: [], redoStack: [], conflicts: [], fitRequest: get().fitRequest + 1 });
  } catch (e) {
    set({ roadmap: null, loadError: (e as Error).message });
  }
}

function defaultExpanded(rm: Roadmap): Set<string> {
  const cps = Object.values(rm.checkpoints);
  const top = cps.filter((c) => !c.parent);
  if (cps.length > 160) return new Set();
  return new Set(top.map((c) => c.id));
}

export async function reloadRoadmap(id: string) {
  try {
    const rm = await http.get<Roadmap>(`/api/roadmaps/${encodeURIComponent(id)}`);
    if (get().roadmap?.meta.id !== id) return;
    const next = withOutbox(rm);
    const sel = get().selectedId;
    set({ roadmap: next, selectedId: sel && next.checkpoints[sel] ? sel : null });
  } catch (e) {
    if (e instanceof ApiError && e.status === 404) {
      toast.error('This roadmap no longer exists.');
      navigate({ page: 'home' });
    }
  }
}

/** Server state + edits that haven't been confirmed yet. */
function withOutbox(rm: Roadmap): Roadmap {
  const pending = get().outbox.filter((e) => e.roadmapId === rm.meta.id);
  if (!pending.length) return rm;
  let cps = rm.checkpoints;
  for (const e of pending) cps = applyOps(rm.meta, cps, e.ops, { source: 'app' }).checkpoints;
  return { ...rm, checkpoints: cps };
}

// ---------------------------------------------------------------- selection & view

export function selectCheckpoint(id: string | null, opts: { center?: boolean; updateHash?: boolean } = {}) {
  const rm = get().roadmap;
  if (id && rm?.checkpoints[id]) {
    const path = ancestors(rm.checkpoints, id).map((c) => c.id);
    const expanded = new Set(get().expanded);
    let changed = false;
    for (const p of path) if (!expanded.has(p)) (expanded.add(p), (changed = true));
    const focus = get().focusId;
    const keepFocus = focus && (focus === id || path.includes(focus) || ancestors(rm.checkpoints, focus).some((a) => a.id === id) || rm.checkpoints[id]?.parent === rm.checkpoints[focus]?.parent);
    set({
      selectedId: id,
      detailsOpen: true,
      ...(changed ? { expanded } : {}),
      ...(focus && !keepFocus ? { focusId: null } : {}),
      ...(opts.center ? { centerRequest: { id, n: (get().centerRequest?.n ?? 0) + 1 } } : {}),
    });
    if (changed) persistExpanded();
  } else set({ selectedId: null });
  if (opts.updateHash !== false && rm) {
    const hash = routeHash({ page: 'roadmap', id: rm.meta.id, cp: id ?? undefined });
    if (location.hash !== hash) history.replaceState(null, '', hash);
  }
}

function persistExpanded() {
  const rm = get().roadmap;
  if (!rm) return;
  try {
    localStorage.setItem(expandedKey(rm.meta.id), JSON.stringify([...get().expanded]));
  } catch {
    /* fine */
  }
}

export function toggleExpanded(id: string, open?: boolean) {
  const expanded = new Set(get().expanded);
  const isOpen = expanded.has(id);
  const want = open ?? !isOpen;
  if (want === isOpen) return;
  if (want) expanded.add(id);
  else expanded.delete(id);
  set({ expanded });
  persistExpanded();
}

export function setExpandedAll(open: boolean) {
  const rm = get().roadmap;
  if (!rm) return;
  set({ expanded: open ? new Set(Object.keys(rm.checkpoints)) : new Set(), focusId: null, fitRequest: get().fitRequest + 1 });
  persistExpanded();
}

export function setFocus(id: string | null) {
  if (id) {
    toggleExpanded(id, true);
    set({ focusId: id, selectedId: id, fitRequest: get().fitRequest + 1 });
  } else set({ focusId: null, fitRequest: get().fitRequest + 1 });
}

export function overview() {
  set({ focusId: null, fitRequest: get().fitRequest + 1 });
}

// ---------------------------------------------------------------- saving

let flushing = false;
let retryTimer: ReturnType<typeof setTimeout> | null = null;
const waiters = new Map<string, { resolve: (r: OpsResponse | null) => void }>();

/**
 * Apply ops optimistically and queue them for the server. Resolves with the server's response
 * once saved (or null if it could not be saved). With `undo`, Ctrl+Z applies those ops.
 */
export function submit(ops: Op[], opts: { undo?: Op[] | null; label?: string } = {}): Promise<OpsResponse | null> {
  const r = enqueue(ops);
  if (r.error) toast.error(r.error);
  else if (opts.undo) recordUndo(opts.label ?? 'change', { kind: 'ops', ops: opts.undo, inverse: ops });
  return r.done;
}

function enqueue(ops: Op[]): { error?: string; done: Promise<OpsResponse | null> } {
  const rm = get().roadmap;
  if (!rm || !ops.length) return { done: Promise.resolve(null) };
  const res = applyOps(rm.meta, rm.checkpoints, ops, { source: 'app' });
  const failed = res.results.find((r) => !r.ok && !r.conflicts);
  if (failed) return { error: failed.error ?? 'That change is not possible.', done: Promise.resolve(null) };
  const key = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const outbox = [...get().outbox, { key, roadmapId: rm.meta.id, ops }];
  saveOutbox(outbox);
  set({ roadmap: { ...rm, checkpoints: res.checkpoints }, outbox, saveState: 'saving' });
  const done = new Promise<OpsResponse | null>((resolve) => waiters.set(key, { resolve }));
  void flushOutbox();
  return { done };
}

/** Save manual positions and/or sticky notes (optimistic: the map updates at once). Not recorded for Undo. */
export function writeLayout(patch: { offsets?: LayoutOffsets; notes?: MapNote[] }) {
  const rm = get().roadmap;
  if (!rm) return;
  const layout = { schema: 'waymark-layout/1' as const, offsets: patch.offsets ?? rm.layout?.offsets ?? {}, notes: patch.notes ?? rm.layout?.notes ?? [] };
  set({ roadmap: { ...rm, layout } });
  http.put(`/api/roadmaps/${encodeURIComponent(rm.meta.id)}/layout`, { offsets: layout.offsets, notes: layout.notes }).catch((e: Error) => toast.error(`Couldn't save the map: ${e.message}`));
}

export async function flushOutbox() {
  if (flushing) return;
  flushing = true;
  if (retryTimer) clearTimeout(retryTimer);
  try {
    while (get().outbox.length) {
      const entry = get().outbox[0]!;
      set({ saveState: 'saving' });
      try {
        const res = await http.post<OpsResponse>(`/api/roadmaps/${encodeURIComponent(entry.roadmapId)}/ops`, { ops: entry.ops });
        const conflicts: Conflict[] = [];
        for (const r of res.results) {
          for (const c of r.conflicts ?? []) conflicts.push({ cpId: r.id!, field: c.field, current: c.current, yours: c.yours });
          if (!r.ok && !r.conflicts && r.error) toast.error(r.error);
        }
        if (conflicts.length) {
          const others = get().conflicts.filter((x) => !conflicts.some((c) => c.cpId === x.cpId && c.field === x.field));
          set({ conflicts: [...others, ...conflicts] });
        }
        dequeue(entry.key, res);
        if (conflicts.length || res.results.some((r) => !r.ok)) void reloadRoadmap(entry.roadmapId);
      } catch (e) {
        if (e instanceof ApiError && e.status === 0) {
          set({ saveState: 'offline', saveError: 'Not saved yet: the Waymark server is not reachable. Your edits are kept in this browser and will be saved when it is back.' });
          retryTimer = setTimeout(() => void flushOutbox(), 3000);
          return;
        }
        dequeue(entry.key, null);
        set({ saveState: 'error', saveError: (e as Error).message });
        toast.error(`Not saved: ${(e as Error).message}`);
        void reloadRoadmap(entry.roadmapId);
        return;
      }
    }
    set({ saveState: 'saved', saveError: null });
  } finally {
    flushing = false;
  }
}

function dequeue(key: string, res: OpsResponse | null) {
  const outbox = get().outbox.filter((e) => e.key !== key);
  saveOutbox(outbox);
  set({ outbox });
  waiters.get(key)?.resolve(res);
  waiters.delete(key);
}

export function clearConflict(cpId: string, field: FieldPath) {
  set({ conflicts: get().conflicts.filter((c) => !(c.cpId === cpId && c.field === field)) });
}

// ---------------------------------------------------------------- undo / redo
// Two stacks, as in draw.io's mxUndoManager and Excalidraw's History (both open source): a new change
// clears Redo, and undoing an entry applies its steps and puts their opposites on the Redo stack, so
// Redo is "undo the undo". Edits made inside batch() undo together (mxGraph's beginUpdate/endUpdate).

const HISTORY_LIMIT = 100;
let batchSteps: HistoryStep[] | null = null;

/** Remember how to undo a change that was just made. */
export function recordUndo(label: string, step: HistoryStep) {
  if (batchSteps) batchSteps.push(step);
  else recordEntry(label, [step]);
}

/** Record several steps as one Undo entry (for changes that finish after a server round trip). */
export function recordEntry(label: string, steps: HistoryStep[], roadmapId = get().roadmap?.meta.id) {
  if (!roadmapId || !steps.length) return;
  set({ undoStack: [...get().undoStack.slice(1 - HISTORY_LIMIT), { label, roadmapId, steps }], redoStack: [] });
}

/** Run several edits as one Undo step. */
export function batch<T>(label: string, fn: () => T): T {
  if (batchSteps) return fn();
  batchSteps = [];
  try {
    return fn();
  } finally {
    const steps = batchSteps;
    batchSteps = null;
    recordEntry(label, steps);
  }
}

/** Apply one step; returns its opposite, or an error when it no longer applies. */
async function perform(step: HistoryStep, roadmapId: string): Promise<HistoryStep | { error: string }> {
  const rm = get().roadmap;
  if (!rm || rm.meta.id !== roadmapId) return { error: 'that roadmap is no longer open.' };
  switch (step.kind) {
    case 'ops': {
      const r = enqueue(step.ops);
      return r.error ? { error: r.error } : { kind: 'ops', ops: step.inverse, inverse: step.ops };
    }
    case 'layout': {
      const back: HistoryStep = { kind: 'layout' };
      if (step.offsets) back.offsets = rm.layout?.offsets ?? {};
      if (step.notes) back.notes = rm.layout?.notes ?? [];
      writeLayout({ offsets: step.offsets, notes: step.notes });
      return back;
    }
    case 'delete': {
      const ids = step.ids.filter((id) => rm.checkpoints[id]);
      if (!ids.length) return { error: 'it is already gone.' };
      const r = enqueue(ids.map((id) => ({ op: 'delete' as const, id })));
      if (r.error) return { error: r.error };
      const sel = get().selectedId;
      if (sel && !get().roadmap?.checkpoints[sel]) selectCheckpoint(null);
      const res = await r.done;
      return res?.trashId ? { kind: 'restore', trashId: res.trashId, ids } : { error: 'it could not be saved.' };
    }
    case 'restore': {
      try {
        await http.post(`/api/trash/${encodeURIComponent(step.trashId)}/restore`);
      } catch (e) {
        return { error: (e as Error).message };
      }
      await reloadRoadmap(roadmapId);
      return { kind: 'delete', ids: step.ids };
    }
  }
}

let travelling: Promise<void> = Promise.resolve();

/** Undo or redo the latest entry. One at a time, in order, so quick repeated presses are safe. */
function travel(dir: 'undo' | 'redo'): Promise<void> {
  travelling = travelling.then(async () => {
    const source = dir === 'undo' ? 'undoStack' : 'redoStack';
    const target = dir === 'undo' ? 'redoStack' : 'undoStack';
    const stack = get()[source];
    const entry = stack[stack.length - 1];
    if (!entry) {
      toast(dir === 'undo' ? 'Nothing to undo.' : 'Nothing to redo.');
      return;
    }
    set({ [source]: stack.slice(0, -1) } as Pick<State, typeof source>);
    const opposite: HistoryStep[] = [];
    let error: string | null = null;
    for (const step of [...entry.steps].reverse()) {
      const r = await perform(step, entry.roadmapId);
      if ('error' in r) {
        error = r.error;
        break;
      }
      opposite.push(r);
    }
    // Whatever did happen stays reversible, even if a later step no longer applied.
    if (opposite.length) set({ [target]: [...get()[target].slice(1 - HISTORY_LIMIT), { ...entry, steps: opposite }] } as Pick<State, typeof target>);
    if (error) toast.error(`Couldn't ${dir} “${entry.label}”: ${error}`);
    else toast.success(`${dir === 'undo' ? 'Undid' : 'Redid'}: ${entry.label}`);
  });
  return travelling;
}

export const undoLast = () => travel('undo');
export const redoLast = () => travel('redo');

export function toggleOutline() {
  if (window.innerWidth < 1024) return set({ outlineDrawer: !get().outlineDrawer });
  const v = !get().outlineOpen;
  set({ outlineOpen: v });
  try {
    localStorage.setItem('waymark.outlineOpen', v ? '1' : '0');
  } catch {
    /* fine */
  }
}

// ---------------------------------------------------------------- theme

export function setTheme(theme: State['theme']) {
  try {
    localStorage.setItem('waymark.theme', theme);
  } catch {
    /* fine */
  }
  set({ theme });
  applyTheme();
}

export function applyTheme() {
  const t = get().theme;
  const dark = t === 'dark' || (t === 'system' && matchMedia('(prefers-color-scheme: dark)').matches);
  document.documentElement.dataset.theme = dark ? 'dark' : 'light';
}

export { set as setState, get as getState };
