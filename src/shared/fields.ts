// Field-level access, comparison and diffing of checkpoints.

import {
  ALL_FIELDS,
  type Checkpoint,
  type FieldChange,
  type FieldPath,
  type SectionKey,
} from './model';
import { SECTION_DEFS, sectionOwner } from './profiles';

export function getField(cp: Checkpoint, field: FieldPath): unknown {
  if (field.startsWith('sections.')) {
    const k = field.slice(9) as SectionKey;
    return cp.sections[k] ?? '';
  }
  return (cp as unknown as Record<string, unknown>)[field];
}

export function setField(cp: Checkpoint, field: FieldPath, value: unknown): Checkpoint {
  if (field.startsWith('sections.')) {
    const k = field.slice(9) as SectionKey;
    const sections = { ...cp.sections };
    const s = typeof value === 'string' ? value : '';
    if (s.trim()) sections[k] = s;
    else delete sections[k];
    return { ...cp, sections };
  }
  return { ...cp, [field]: clone(value) } as Checkpoint;
}

export function clone<T>(v: T): T {
  return v === undefined ? v : (JSON.parse(JSON.stringify(v)) as T);
}

function canon(v: unknown): unknown {
  if (v === undefined || v === null || v === '') return null;
  if (typeof v === 'string') return v.replace(/\r\n?/g, '\n').trim();
  return v;
}

export function fieldEquals(a: unknown, b: unknown): boolean {
  const x = canon(a);
  const y = canon(b);
  if (x === y) return true;
  if (typeof x !== 'object' || typeof y !== 'object' || x === null || y === null) return false;
  return JSON.stringify(x) === JSON.stringify(y);
}

export function diffCheckpoints(a: Checkpoint, b: Checkpoint): FieldChange[] {
  const out: FieldChange[] = [];
  for (const f of ALL_FIELDS) {
    const x = getField(a, f);
    const y = getField(b, f);
    if (!fieldEquals(x, y)) out.push({ field: f, before: clone(x), after: clone(y) });
  }
  return out;
}

/** Fields only the human may change. Agent edits to them are held for review. */
export const HUMAN_SCALARS: FieldPath[] = ['status', 'understanding', 'approved', 'archived', 'agentAccess'];

export function isHumanField(field: FieldPath): boolean {
  if (field.startsWith('sections.')) return sectionOwner(field.slice(9) as SectionKey) === 'human';
  return HUMAN_SCALARS.includes(field);
}

/** Structural fields: changing them reorganises the roadmap. */
export function isStructuralField(field: FieldPath): boolean {
  return field === 'parent';
}

export function fieldLabel(field: FieldPath): string {
  if (field.startsWith('sections.')) return SECTION_DEFS[field.slice(9) as SectionKey]?.label ?? field;
  const labels: Record<string, string> = {
    title: 'Title',
    parent: 'Position (parent)',
    order: 'Order',
    summary: 'Summary',
    status: 'Status',
    understanding: 'Understanding',
    approved: 'Approval',
    optional: 'Optional',
    archived: 'Archived',
    agentAccess: 'Agent access',
    prerequisites: 'Prerequisites',
    completion: 'Completion criterion',
    resources: 'Resources',
  };
  return labels[field] ?? field;
}

/** True when the checkpoint holds anything the human wrote or decided. */
export function hasHumanContent(cp: Checkpoint): boolean {
  if (cp.approved) return true;
  if (cp.status && cp.status !== 'not-started') return true;
  if (cp.understanding && cp.understanding !== 'not-yet') return true;
  for (const [k, v] of Object.entries(cp.sections)) {
    if (v?.trim() && sectionOwner(k as SectionKey) === 'human') return true;
  }
  return false;
}
