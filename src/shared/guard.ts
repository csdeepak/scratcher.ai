// Guard rules for edits made outside the app (by an agent, a text editor or a sync tool).
// Pure functions so they can be tested without a file system.

import { ALL_FIELDS, type Checkpoint, type FieldChange, type FieldPath, type RoadmapMeta } from './model';
import { clone, fieldEquals, getField, hasHumanContent, isHumanField, setField } from './fields';
import { getProfile } from './profiles';
import { childrenIndex, createsCycle, descendants, effectiveAccess, type CheckpointMap } from './tree';

export type HoldReason = 'yours' | 'approved' | 'locked' | 'conflict' | 'structure';

export interface HeldChange extends FieldChange {
  reason: HoldReason;
}

export interface GuardDecision {
  /** The checkpoint after applying the accepted changes. */
  next: Checkpoint;
  accepted: FieldChange[];
  held: HeldChange[];
  /** The incoming write was based on an older revision. */
  stale: boolean;
}

export const HOLD_REASON_TEXT: Record<HoldReason, string> = {
  yours: 'Yours: only you change this',
  approved: 'You approved this checkpoint',
  locked: 'This section is locked',
  conflict: 'You changed this after the agent read it',
  structure: 'Invalid move',
};

/**
 * Decide what to do with an external edit of an existing checkpoint.
 * `base` is the version the editor started from when its `rev` is older than the current one.
 */
export function guardExternalEdit(args: {
  meta: RoadmapMeta;
  cps: CheckpointMap;
  existing: Checkpoint;
  incoming: Checkpoint;
  base: Checkpoint | null;
}): GuardDecision {
  const { meta, cps, existing, incoming, base } = args;
  const stale = incoming.rev < existing.rev;
  const access = effectiveAccess(cps, meta, existing.id);
  const accepted: FieldChange[] = [];
  const held: HeldChange[] = [];
  let next = existing;

  for (const f of ALL_FIELDS) {
    const cur = getField(existing, f);
    const inc = getField(incoming, f);
    if (fieldEquals(cur, inc)) continue;
    const change: FieldChange = { field: f, before: clone(cur), after: clone(inc) };
    if (stale) {
      if (base) {
        const b = getField(base, f);
        if (fieldEquals(inc, b)) continue; // editor did not touch this field; it is just out of date
        if (!fieldEquals(cur, b)) {
          held.push({ ...change, reason: 'conflict' });
          continue;
        }
      } else {
        held.push({ ...change, reason: 'conflict' });
        continue;
      }
    }
    const reason = holdReason(f, inc, existing, access, cps, meta);
    if (reason) held.push({ ...change, reason });
    else {
      accepted.push(change);
      next = setField(next, f, inc);
    }
  }
  return { next, accepted, held, stale };
}

function holdReason(
  f: FieldPath,
  value: unknown,
  existing: Checkpoint,
  access: string,
  cps: CheckpointMap,
  meta: RoadmapMeta,
): HoldReason | null {
  if (isHumanField(f)) return 'yours';
  if (existing.approved) return 'approved';
  if (access === 'locked') return 'locked';
  if (f === 'parent') {
    const parent = (value as string | null) ?? null;
    if (parent && (!cps[parent] || createsCycle(cps, existing.id, parent))) return 'structure';
    if (parent && effectiveAccess(cps, meta, parent) === 'locked') return 'locked';
  }
  return null;
}

/** Defaults applied to checkpoints created outside the app; human-owned values are held instead. */
export function guardNewCheckpoint(meta: RoadmapMeta, incoming: Checkpoint): { next: Checkpoint; held: HeldChange[] } {
  const profile = getProfile(meta.profile);
  const blank: Checkpoint = {
    ...incoming,
    status: 'not-started',
    understanding: profile.understanding ? 'not-yet' : null,
    approved: false,
    archived: false,
    agentAccess: null,
    sections: { ...incoming.sections },
  };
  let next = blank;
  for (const f of ALL_FIELDS) {
    if (!f.startsWith('sections.')) continue;
    if (isHumanField(f)) next = setField(next, f, '');
  }
  const held: HeldChange[] = [];
  // A missing understanding is the same as "not yet": nothing to hold.
  const inc: Checkpoint = { ...incoming, understanding: incoming.understanding ?? blank.understanding };
  for (const f of ALL_FIELDS) {
    if (!isHumanField(f)) continue;
    const before = getField(next, f);
    const after = getField(inc, f);
    if (!fieldEquals(before, after)) held.push({ field: f, before: clone(before), after: clone(after), reason: 'yours' });
  }
  return { next, held };
}

/** A deletion done outside the app needs review when it would lose your work or orphan sub-checkpoints. */
export function deletionNeedsReview(cps: CheckpointMap, id: string): boolean {
  const cp = cps[id];
  if (!cp) return false;
  const idx = childrenIndex(cps);
  if ((idx.get(id) ?? []).length > 0) return true;
  return [cp, ...descendants(cps, id, idx)].some((c) => hasHumanContent(c));
}
