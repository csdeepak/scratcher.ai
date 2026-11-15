// Client state. The server's files are the source of truth; the client applies edits
// optimistically with the same change engine, queues them in a persistent outbox and
// reconciles whenever the server reports a change.

import { create } from 'zustand';
import { toast } from 'sonner';
import type { FieldPath, Problem, Roadmap, RoadmapSummary } from '../shared/model';
import { applyOps, type Op, type OpResult } from '../shared/ops';
import { ancestors } from '../shared/tree';
import type { ReviewItem } from '../server/review';
import type { ProposalView } from '../server/workspace';
import { ApiError, http, subscribe, type ServerEvent } from './api';

export type Route = { page: 'home' } | { page: 'roadmap'; id: string; cp?: string };
export type SaveState = 'saved' | 'saving' | 'offline' | 'error';
export type Dialog = null | 'new' | 'settings' | 'trash' | 'agent' | 'shortcuts' | 'palette' | 'paste' | 'template';

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

interface UndoEntry {
  label: string;
  roadmapId: string;
  ops?: Op[];
  trashId?: string;
}

interface OpsResponse {
  results: OpResult[];
  trashId?: string;
}

interface State {
  ready: boolean;
  workspace: string;
  summaries: RoadmapSummary[];
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
  undoStack: UndoEntry[];
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
  theme: 'system' | 'light' | 'dark';
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
  theme: (localStorage.getItem('waymark.theme') as State['theme']) ?? 'light',
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

export async function refreshSummaries() {
  try {
    const s = await http.get<{ roadmaps: RoadmapSummary[]; problems: Problem[]; workspace: string }>('/api/state');
    set({ summaries: s.roadmaps, workspaceProblems: s.problems, workspace: s.workspace });
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
    set({ roadmap: withOutbox(rm), expanded, selectedId: null, focusId: null, undoStack: [], conflicts: [], fitRequest: get().fitRequest + 1 });
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
 * once saved (or null if it could not be saved).
 */
export function submit(ops: Op[], opts: { undo?: Op[] | null; label?: string } = {}): Promise<OpsResponse | null> {
  const rm = get().roadmap;
  if (!rm || !ops.length) return Promise.resolve(null);
  const res = applyOps(rm.meta, rm.checkpoints, ops, { source: 'app' });
  const failed = res.results.find((r) => !r.ok && !r.conflicts);
  if (failed) {
    toast.error(failed.error ?? 'That change is not possible.');
    return Promise.resolve(null);
  }
  const key = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const outbox = [...get().outbox, { key, roadmapId: rm.meta.id, ops }];
  saveOutbox(outbox);
  const undoStack = opts.undo ? [...get().undoStack.slice(-49), { label: opts.label ?? 'change', roadmapId: rm.meta.id, ops: opts.undo }] : get().undoStack;
  set({ roadmap: { ...rm, checkpoints: res.checkpoints }, outbox, saveState: 'saving', undoStack });
  const p = new Promise<OpsResponse | null>((resolve) => waiters.set(key, { resolve }));
  void flushOutbox();
  return p;
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

export function pushUndo(entry: UndoEntry) {
  set({ undoStack: [...get().undoStack.slice(-49), entry] });
}

export async function undoLast() {
  const stack = get().undoStack;
  const last = stack[stack.length - 1];
  if (!last) {
    toast('Nothing to undo.');
    return;
  }
  set({ undoStack: stack.slice(0, -1) });
  if (last.trashId) {
    try {
      await http.post(`/api/trash/${last.trashId}/restore`);
      toast.success(`Undid: ${last.label}`);
    } catch (e) {
      toast.error((e as Error).message);
    }
    return;
  }
  if (last.ops && get().roadmap?.meta.id === last.roadmapId) {
    await submit(last.ops, { undo: null });
    toast.success(`Undid: ${last.label}`);
  }
}

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
