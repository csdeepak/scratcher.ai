// The change engine. The UI, agent proposals (changesets), imports and restores all
// change a roadmap through these operations, so validation and behaviour are identical.

import { z } from 'zod';
import type { Checkpoint, FieldPath, RoadmapMeta, SectionKey } from './model';
import { ALL_SECTIONS } from './model';
import { clone, fieldEquals, getField, setField } from './fields';
import { isValidId, newId } from './ids';
import { coerceResources, escapeSectionText } from './checkpointFile';
import { getProfile, normaliseStatus, sectionFromHeading } from './profiles';
import { childrenIndex, compareSiblings, createsCycle, descendants, type CheckpointMap } from './tree';

// ---------- schemas ----------

const sectionsSchema = z.record(z.string(), z.string().nullable());

const resourceSchema = z.union([
  z.string(),
  z.object({
    title: z.string().optional(),
    url: z.string().optional(),
    kind: z.string().optional(),
    start: z.union([z.string(), z.number()]).optional(),
    note: z.string().optional(),
  }),
]);

export const settableSchema = z
  .object({
    title: z.string().min(1).optional(),
    summary: z.string().optional(),
    completion: z.string().optional(),
    optional: z.boolean().optional(),
    prerequisites: z.array(z.string()).optional(),
    resources: z.array(resourceSchema).optional(),
    sections: sectionsSchema.optional(),
    status: z.string().optional(),
    understanding: z.enum(['not-yet', 'can-explain', 'can-apply']).nullable().optional(),
    approved: z.boolean().optional(),
    archived: z.boolean().optional(),
    agentAccess: z.enum(['review', 'direct', 'locked']).nullable().optional(),
  })
  .strict();

const posFields = {
  after: z.string().nullable().optional(),
  index: z.number().int().min(0).optional(),
};

export const opSchema = z.discriminatedUnion('op', [
  z
    .object({
      op: z.literal('add'),
      id: z.string().optional(),
      parent: z.string().nullable().optional(),
      ...posFields,
      title: z.string().min(1, 'add needs a title'),
      summary: z.string().optional(),
      completion: z.string().optional(),
      optional: z.boolean().optional(),
      prerequisites: z.array(z.string()).optional(),
      resources: z.array(resourceSchema).optional(),
      sections: sectionsSchema.optional(),
      status: z.string().optional(),
    })
    .strict(),
  z
    .object({
      op: z.literal('update'),
      id: z.string(),
      rev: z.number().int().optional(),
      set: settableSchema.default({}),
      /** Text to add below a section's existing text (e.g. session notes), without retyping it. */
      append: sectionsSchema.optional(),
      expect: z.record(z.string(), z.unknown()).optional(),
    })
    .strict()
    .refine((o) => Object.keys(o.set).length > 0 || Object.keys(o.append ?? {}).length > 0, 'update needs "set" or "append"'),
  z
    .object({ op: z.literal('move'), id: z.string(), parent: z.string().nullable(), ...posFields })
    .strict(),
  z.object({ op: z.literal('delete'), id: z.string() }).strict(),
  z.object({ op: z.literal('link'), id: z.string(), prerequisite: z.string() }).strict(),
  z.object({ op: z.literal('unlink'), id: z.string(), prerequisite: z.string() }).strict(),
]);

export type Op = z.infer<typeof opSchema>;
export type Settable = z.infer<typeof settableSchema>;

/** Internal-only op for history/trash restores (not accepted from agents). */
export interface RestoreOp {
  op: 'restore';
  checkpoint: Checkpoint;
}
export type AnyOp = Op | RestoreOp;

export type OpSource = 'app' | 'proposal' | 'import' | 'restore';

export interface OpResult {
  ok: boolean;
  op: AnyOp['op'];
  id?: string;
  error?: string;
  conflicts?: { field: FieldPath; current: unknown; yours: unknown }[];
}

export interface ApplyResult {
  checkpoints: CheckpointMap;
  results: OpResult[];
  changed: Set<string>;
  created: Set<string>;
  deleted: Map<string, Checkpoint>;
}

// ---------- helpers ----------

export function normaliseSections(input: Record<string, string | null> | undefined): {
  sections: Partial<Record<SectionKey, string>>;
  unknown: string[];
} {
  const sections: Partial<Record<SectionKey, string>> = {};
  const unknown: string[] = [];
  for (const [k, v] of Object.entries(input ?? {})) {
    const key = (ALL_SECTIONS as string[]).includes(k) ? (k as SectionKey) : sectionFromHeading(k);
    if (!key) {
      unknown.push(k);
      continue;
    }
    sections[key] = escapeSectionText(v ?? '');
  }
  return { sections, unknown };
}

/** Convert a `set` object to field path/value pairs. */
export function settableToFields(set: Settable, meta: RoadmapMeta): [FieldPath, unknown][] {
  const out: [FieldPath, unknown][] = [];
  const profile = getProfile(meta.profile);
  for (const [k, v] of Object.entries(set)) {
    if (v === undefined) continue;
    if (k === 'sections') {
      const { sections } = normaliseSections(v as Record<string, string | null>);
      for (const [sk, sv] of Object.entries(sections)) out.push([`sections.${sk}` as FieldPath, sv ?? '']);
    } else if (k === 'resources') {
      out.push(['resources', coerceResources(v)]);
    } else if (k === 'status') {
      out.push(['status', normaliseStatus(v, profile)]);
    } else if (k === 'prerequisites') {
      out.push(['prerequisites', (v as string[]).filter(isValidId)]);
    } else if (k === 'title' || k === 'summary' || k === 'completion') {
      out.push([k, String(v).trim()]);
    } else {
      out.push([k as FieldPath, v]);
    }
  }
  return out;
}

/** Existing section text with `addition` added below it, separated by a blank line. */
export function appendText(existing: unknown, addition: string): string {
  const cur = typeof existing === 'string' ? existing.replace(/\s+$/, '') : '';
  const add = addition.replace(/^\s*\n/, '').replace(/\s+$/, '');
  return cur ? `${cur}\n\n${add}` : add;
}

function expectValue(expect: Record<string, unknown> | undefined, field: FieldPath): unknown {
  if (!expect) return undefined;
  if (field.startsWith('sections.')) {
    const s = expect.sections as Record<string, unknown> | undefined;
    const k = field.slice(9);
    return s && k in s ? (s[k] ?? '') : undefined;
  }
  return field in expect ? expect[field] : undefined;
}

function insertionOrder(
  siblings: Checkpoint[],
  pos: { after?: string | null; index?: number },
): { order: number; renumber: Map<string, number> } {
  let i: number;
  if (pos.index !== undefined) i = Math.max(0, Math.min(pos.index, siblings.length));
  else if (pos.after === undefined) i = siblings.length;
  else if (pos.after === null) i = 0;
  else {
    const j = siblings.findIndex((s) => s.id === pos.after);
    i = j === -1 ? siblings.length : j + 1;
  }
  const prev = siblings[i - 1];
  const next = siblings[i];
  const renumber = new Map<string, number>();
  if (!prev && !next) return { order: 1, renumber };
  if (!prev) return { order: Math.floor(next!.order) - 1, renumber };
  if (!next) return { order: Math.floor(prev.order) + 1, renumber };
  if (next.order - prev.order > 0.0001) {
    return { order: Math.round(((prev.order + next.order) / 2) * 10000) / 10000, renumber };
  }
  // No room between neighbours: renumber the sibling group 1..n.
  let n = 1;
  let order = 0;
  for (let k = 0; k <= siblings.length; k++) {
    if (k === i) order = n++;
    if (k < siblings.length) renumber.set(siblings[k]!.id, n++);
  }
  return { order, renumber };
}

// ---------- engine ----------

export function applyOps(
  meta: RoadmapMeta,
  input: CheckpointMap,
  ops: AnyOp[],
  opts: { source: OpSource; now?: string },
): ApplyResult {
  const now = opts.now ?? new Date().toISOString();
  const profile = getProfile(meta.profile);
  const cps: CheckpointMap = { ...input };
  const results: OpResult[] = [];
  const changed = new Set<string>();
  const created = new Set<string>();
  const deleted = new Map<string, Checkpoint>();
  const touch = (id: string) => changed.add(id);

  const siblingsOf = (parent: string | null, excludeId?: string) =>
    Object.values(cps)
      .filter((c) => (c.parent ?? null) === parent && c.id !== excludeId)
      .sort(compareSiblings);

  const place = (id: string, parent: string | null, pos: { after?: string | null; index?: number }) => {
    const { order, renumber } = insertionOrder(siblingsOf(parent, id), pos);
    for (const [sid, o] of renumber) {
      if (cps[sid]!.order !== o) {
        cps[sid] = { ...cps[sid]!, order: o };
        touch(sid);
      }
    }
    return order;
  };

  for (const op of ops) {
    try {
      switch (op.op) {
        case 'add': {
          let id = op.id?.trim() || '';
          if (id && !isValidId(id)) {
            results.push({ ok: false, op: 'add', error: `Invalid id "${id}".` });
            continue;
          }
          if (id && cps[id]) {
            const same = cps[id]!.title === op.title.trim();
            results.push(same ? { ok: true, op: 'add', id } : { ok: false, op: 'add', id, error: `Id "${id}" already exists.` });
            continue;
          }
          if (!id) do id = newId('cp'); while (cps[id]);
          const parent = op.parent ?? null;
          if (parent && !cps[parent]) {
            results.push({ ok: false, op: 'add', error: `Parent "${parent}" does not exist.` });
            continue;
          }
          const { sections } = normaliseSections(op.sections ?? undefined);
          const cp: Checkpoint = {
            id,
            title: op.title.trim(),
            parent,
            order: 0,
            summary: (op.summary ?? '').trim(),
            status: opts.source === 'app' || opts.source === 'import' ? normaliseStatus(op.status, profile) : 'not-started',
            understanding: profile.understanding ? 'not-yet' : null,
            approved: false,
            optional: !!op.optional,
            archived: false,
            agentAccess: null,
            prerequisites: (op.prerequisites ?? []).filter(isValidId).filter((p) => p !== id),
            completion: (op.completion ?? '').trim(),
            resources: coerceResources(op.resources ?? []),
            sections,
            rev: 0,
            updated: now,
          };
          cp.order = place(id, parent, op);
          cps[id] = cp;
          created.add(id);
          touch(id);
          results.push({ ok: true, op: 'add', id });
          break;
        }
        case 'update': {
          const cur = cps[op.id];
          if (!cur) {
            results.push({ ok: false, op: 'update', id: op.id, error: `Checkpoint "${op.id}" does not exist.` });
            continue;
          }
          let next = cur;
          const conflicts: NonNullable<OpResult['conflicts']> = [];
          for (const [field, value] of settableToFields(op.set, meta)) {
            const current = getField(next, field);
            if (fieldEquals(current, value)) continue;
            const expected = expectValue(op.expect, field);
            if (expected !== undefined && !fieldEquals(current, expected)) {
              conflicts.push({ field, current: clone(current), yours: clone(value) });
              continue;
            }
            if (field === 'prerequisites') {
              const v = (value as string[]).filter((p) => p !== cur.id);
              next = setField(next, field, v);
            } else next = setField(next, field, value);
          }
          for (const [key, text] of Object.entries(normaliseSections(op.append ?? undefined).sections)) {
            if (!text?.trim()) continue;
            const field = `sections.${key}` as FieldPath;
            next = setField(next, field, appendText(getField(next, field), text));
          }
          if (next !== cur) {
            cps[op.id] = next;
            touch(op.id);
          }
          results.push({ ok: conflicts.length === 0, op: 'update', id: op.id, conflicts: conflicts.length ? conflicts : undefined, error: conflicts.length ? 'Changed elsewhere since you started editing.' : undefined });
          break;
        }
        case 'move': {
          const cur = cps[op.id];
          if (!cur) {
            results.push({ ok: false, op: 'move', id: op.id, error: `Checkpoint "${op.id}" does not exist.` });
            continue;
          }
          const parent = op.parent ?? null;
          if (parent && !cps[parent]) {
            results.push({ ok: false, op: 'move', id: op.id, error: `Parent "${parent}" does not exist.` });
            continue;
          }
          if (parent && createsCycle(cps, op.id, parent)) {
            results.push({ ok: false, op: 'move', id: op.id, error: 'A checkpoint cannot move inside itself.' });
            continue;
          }
          const order = place(op.id, parent, op);
          if ((cur.parent ?? null) !== parent || cur.order !== order) {
            cps[op.id] = { ...cps[op.id]!, parent, order };
            touch(op.id);
          }
          results.push({ ok: true, op: 'move', id: op.id });
          break;
        }
        case 'delete': {
          const cur = cps[op.id];
          if (!cur) {
            results.push({ ok: true, op: 'delete', id: op.id });
            continue;
          }
          const subtree = [cur, ...descendants(cps, op.id, childrenIndex(cps))];
          for (const c of subtree) {
            deleted.set(c.id, c);
            delete cps[c.id];
            changed.delete(c.id);
            created.delete(c.id);
          }
          results.push({ ok: true, op: 'delete', id: op.id });
          break;
        }
        case 'link':
        case 'unlink': {
          const cur = cps[op.id];
          if (!cur || !cps[op.prerequisite]) {
            results.push({ ok: false, op: op.op, id: op.id, error: 'Both checkpoints must exist.' });
            continue;
          }
          if (op.op === 'link') {
            if (op.id === op.prerequisite) {
              results.push({ ok: false, op: 'link', id: op.id, error: 'A checkpoint cannot require itself.' });
              continue;
            }
            if (requiresTransitively(cps, op.prerequisite, op.id)) {
              results.push({ ok: false, op: 'link', id: op.id, error: 'That would create a circular prerequisite.' });
              continue;
            }
            if (!cur.prerequisites.includes(op.prerequisite)) {
              cps[op.id] = { ...cur, prerequisites: [...cur.prerequisites, op.prerequisite] };
              touch(op.id);
            }
          } else if (cur.prerequisites.includes(op.prerequisite)) {
            cps[op.id] = { ...cur, prerequisites: cur.prerequisites.filter((p) => p !== op.prerequisite) };
            touch(op.id);
          }
          results.push({ ok: true, op: op.op, id: op.id });
          break;
        }
        case 'restore': {
          const incoming = clone(op.checkpoint);
          const cur = cps[incoming.id];
          if (incoming.parent && (!cps[incoming.parent] || createsCycle(cps, incoming.id, incoming.parent))) incoming.parent = null;
          incoming.rev = cur ? cur.rev : incoming.rev;
          cps[incoming.id] = incoming;
          if (!cur) created.add(incoming.id);
          touch(incoming.id);
          results.push({ ok: true, op: 'restore', id: incoming.id });
          break;
        }
      }
    } catch (e) {
      results.push({ ok: false, op: op.op, error: e instanceof Error ? e.message : String(e) });
    }
  }

  for (const id of changed) {
    const c = cps[id];
    if (!c) continue;
    cps[id] = { ...c, rev: (input[id]?.rev ?? c.rev) + (input[id] ? 1 : 0), updated: now };
  }
  return { checkpoints: cps, results, changed, created, deleted };
}

/** Does `from` (transitively) require `target`? */
export function requiresTransitively(cps: CheckpointMap, from: string, target: string): boolean {
  const stack = [from];
  const seen = new Set<string>();
  while (stack.length) {
    const id = stack.pop()!;
    if (id === target) return true;
    if (seen.has(id)) continue;
    seen.add(id);
    for (const p of cps[id]?.prerequisites ?? []) stack.push(p);
  }
  return false;
}

// ---------- changesets (agent proposals) ----------

export const changesetSchema = z.object({
  schema: z.string().optional(),
  roadmap: z.string().optional(),
  title: z.string().optional(),
  summary: z.string().optional(),
  author: z.string().optional(),
  changes: z.array(z.unknown()).min(1, 'A changeset needs at least one change.'),
});

export interface Changeset {
  schema: string;
  roadmap?: string;
  title: string;
  summary: string;
  author: string;
  changes: Op[];
  /** Per-change validation problems (index -> message). Invalid changes are kept out of `changes`. */
  invalid: { index: number; message: string; raw: unknown }[];
}

export function formatZodError(e: z.ZodError): string {
  return e.issues
    .slice(0, 4)
    .map((i) => `${i.path.length ? i.path.join('.') + ': ' : ''}${i.message}`)
    .join('; ');
}

export function parseChangeset(data: unknown): { ok: true; value: Changeset } | { ok: false; error: string } {
  const base = changesetSchema.safeParse(data);
  if (!base.success) return { ok: false, error: formatZodError(base.error) };
  const changes: Op[] = [];
  const invalid: Changeset['invalid'] = [];
  base.data.changes.forEach((raw, index) => {
    const r = opSchema.safeParse(raw);
    if (r.success) changes.push(r.data);
    else invalid.push({ index, message: formatZodError(r.error), raw });
  });
  return {
    ok: true,
    value: {
      schema: base.data.schema ?? 'waymark-changeset/1',
      roadmap: base.data.roadmap,
      title: base.data.title?.trim() || 'Proposed changes',
      summary: base.data.summary?.trim() ?? '',
      author: base.data.author?.trim() || 'agent',
      changes,
      invalid,
    },
  };
}
