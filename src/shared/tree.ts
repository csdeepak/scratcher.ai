// Hierarchy helpers and progress calculation.

import type { AgentAccess, Checkpoint, RoadmapMeta } from './model';
import { getProfile, statusDef } from './profiles';

export type CheckpointMap = Record<string, Checkpoint>;

export function compareSiblings(a: Checkpoint, b: Checkpoint): number {
  return a.order - b.order || a.title.localeCompare(b.title) || a.id.localeCompare(b.id);
}

/** parent id ("" for top level) -> ordered children. Orphans (unknown parent) go to the top level. */
export function childrenIndex(cps: CheckpointMap): Map<string, Checkpoint[]> {
  const idx = new Map<string, Checkpoint[]>();
  for (const cp of Object.values(cps)) {
    const p = cp.parent && cps[cp.parent] && !createsCycle(cps, cp.id, cp.parent) ? cp.parent : '';
    if (!idx.has(p)) idx.set(p, []);
    idx.get(p)!.push(cp);
  }
  for (const list of idx.values()) list.sort(compareSiblings);
  return idx;
}

/** Would making `parent` the parent of `id` create a cycle? */
export function createsCycle(cps: CheckpointMap, id: string, parent: string | null): boolean {
  let p = parent;
  const seen = new Set<string>();
  while (p) {
    if (p === id) return true;
    if (seen.has(p)) return true;
    seen.add(p);
    p = cps[p]?.parent ?? null;
  }
  return false;
}

export function ancestors(cps: CheckpointMap, id: string): Checkpoint[] {
  const out: Checkpoint[] = [];
  const seen = new Set<string>([id]);
  let p = cps[id]?.parent ?? null;
  while (p && cps[p] && !seen.has(p)) {
    out.unshift(cps[p]!);
    seen.add(p);
    p = cps[p]!.parent;
  }
  return out;
}

export function descendants(cps: CheckpointMap, id: string, idx = childrenIndex(cps)): Checkpoint[] {
  const out: Checkpoint[] = [];
  const stack = [...(idx.get(id) ?? [])];
  while (stack.length) {
    const c = stack.shift()!;
    out.push(c);
    stack.unshift(...(idx.get(c.id) ?? []));
  }
  return out;
}

/** The agent access that applies to a checkpoint: nearest override up the tree, else the roadmap default. */
export function effectiveAccess(cps: CheckpointMap, meta: RoadmapMeta, id: string | null): AgentAccess {
  const seen = new Set<string>();
  let cur = id;
  while (cur && cps[cur] && !seen.has(cur)) {
    seen.add(cur);
    const a = cps[cur]!.agentAccess;
    if (a) return a;
    cur = cps[cur]!.parent;
  }
  return meta.agentAccess;
}

export interface Progress {
  /** counted sub-checkpoints (all levels, excluding optional and archived) */
  total: number;
  done: number;
  review: number;
  active: number;
  understood: number;
  optionalDone: number;
  optionalTotal: number;
}

export function emptyProgress(): Progress {
  return { total: 0, done: 0, review: 0, active: 0, understood: 0, optionalDone: 0, optionalTotal: 0 };
}

/**
 * Progress of a checkpoint = completed sub-checkpoints / all sub-checkpoints, counted at every
 * level below it, excluding optional and archived ones. A checkpoint's own status is never derived.
 * Pass id = null for the whole roadmap (every non-archived checkpoint counts).
 */
export function computeProgress(cps: CheckpointMap, meta: RoadmapMeta): Map<string | null, Progress> {
  const profile = getProfile(meta.profile);
  const idx = childrenIndex(cps);
  const result = new Map<string | null, Progress>();

  const visit = (id: string, inheritedOptional: boolean): Progress => {
    const p = emptyProgress();
    for (const child of idx.get(id) ?? []) {
      if (child.archived) continue;
      const optional = inheritedOptional || child.optional;
      const cat = statusDef(profile, child.status).category;
      if (optional) {
        p.optionalTotal++;
        if (cat === 'done') p.optionalDone++;
      } else {
        p.total++;
        if (cat === 'done') p.done++;
        else if (cat === 'review') p.review++;
        else if (cat === 'active') p.active++;
        if (child.understanding === 'can-explain' || child.understanding === 'can-apply') p.understood++;
      }
      const sub = visit(child.id, optional);
      p.total += sub.total;
      p.done += sub.done;
      p.review += sub.review;
      p.active += sub.active;
      p.understood += sub.understood;
      p.optionalDone += sub.optionalDone;
      p.optionalTotal += sub.optionalTotal;
    }
    result.set(id, p);
    return p;
  };
  const root = visit('', false);
  result.set(null, root);
  return result;
}
