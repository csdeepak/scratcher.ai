// Portable single-file format for export, import, backups and templates.
// See docs/DATA-FORMAT.md. Migrations upgrade older bundles step by step.

import { z } from 'zod';
import { SCHEMA_VERSION, type Checkpoint, type Roadmap, type RoadmapLayout, type RoadmapMeta } from './model';
import { checkpointFromData } from './checkpointFile';
import { clone, isHumanField } from './fields';
import { isValidId } from './ids';
import { formatZodError } from './ops';
import { getProfile } from './profiles';
import { compareSiblings } from './tree';

export const BUNDLE_FORMAT = 'waymark-bundle';
export const TEMPLATE_FORMAT = 'waymark-template';

export interface Bundle {
  format: typeof BUNDLE_FORMAT | typeof TEMPLATE_FORMAT;
  schemaVersion: number;
  exportedAt: string;
  generator: string;
  roadmap: Omit<RoadmapMeta, 'rev'>;
  checkpoints: (Omit<Checkpoint, 'rev'> & { rev?: number })[];
  layout: RoadmapLayout;
}

const bundleShape = z.object({
  format: z.enum([BUNDLE_FORMAT, TEMPLATE_FORMAT]),
  schemaVersion: z.number().int().min(1),
  roadmap: z.object({ title: z.string().min(1) }).passthrough(),
  checkpoints: z.array(z.record(z.string(), z.unknown())),
  layout: z.unknown().optional(),
});

export function toBundle(rm: Roadmap, format: Bundle['format'] = BUNDLE_FORMAT): Bundle {
  const ordered = Object.values(rm.checkpoints).sort((a, b) => depthKey(rm, a).localeCompare(depthKey(rm, b)));
  const { rev: _rev, ...meta } = rm.meta;
  return {
    format,
    schemaVersion: SCHEMA_VERSION,
    exportedAt: new Date().toISOString(),
    generator: 'waymark',
    roadmap: clone(meta),
    checkpoints: ordered.map((c) => clone(c)),
    layout: clone(rm.layout),
  };
}

function depthKey(rm: Roadmap, cp: Checkpoint): string {
  // Sort parents before children, siblings by order, for readable exports.
  const chain: string[] = [];
  let cur: Checkpoint | undefined = cp;
  const seen = new Set<string>();
  while (cur && !seen.has(cur.id)) {
    seen.add(cur.id);
    const siblings = Object.values(rm.checkpoints).filter((c) => c.parent === cur!.parent).sort(compareSiblings);
    chain.unshift(String(siblings.indexOf(cur)).padStart(5, '0'));
    cur = cur.parent ? rm.checkpoints[cur.parent] : undefined;
  }
  return chain.join('.');
}

/** Upgrade any older bundle to the current schema. Add a step here for each new schema version. */
export function migrateBundle(data: Record<string, unknown>): Record<string, unknown> {
  const out = { ...data };
  let v = typeof out.schemaVersion === 'number' ? out.schemaVersion : 1;
  // Example for the future:  if (v === 1) { …transform…; v = 2; }
  if (v > SCHEMA_VERSION) throw new Error(`This file was made by a newer version of Waymark (schema ${v}). Update the app to import it.`);
  out.schemaVersion = v;
  return out;
}

export interface ImportedRoadmap {
  meta: Omit<RoadmapMeta, 'id' | 'rev'> & { id?: string };
  checkpoints: Checkpoint[];
  layout: RoadmapLayout;
  warnings: string[];
}

export function parseBundle(raw: unknown): { ok: true; value: ImportedRoadmap } | { ok: false; error: string } {
  if (!raw || typeof raw !== 'object') return { ok: false, error: 'This is not a Waymark export (expected a JSON object).' };
  let data: Record<string, unknown>;
  try {
    data = migrateBundle(raw as Record<string, unknown>);
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
  const shape = bundleShape.safeParse(data);
  if (!shape.success) return { ok: false, error: `Not a valid Waymark export: ${formatZodError(shape.error)}` };
  const r = shape.data.roadmap as Record<string, unknown>;
  const profileKey = r.profile === 'learning' ? 'learning' : 'general';
  const profile = getProfile(profileKey);
  const warnings: string[] = [];
  const checkpoints: Checkpoint[] = [];
  const seen = new Set<string>();
  shape.data.checkpoints.forEach((c, i) => {
    const parsed = checkpointFromData(c, (c.sections as Record<string, unknown>) ?? {}, profile, `Checkpoint ${i + 1}`);
    if (!parsed.ok) {
      warnings.push(`Checkpoint ${i + 1} skipped: ${parsed.error}`);
      return;
    }
    const cp = parsed.value.checkpoint;
    if (!cp.id || seen.has(cp.id)) {
      warnings.push(`Checkpoint "${cp.title}" had a missing or duplicate id and was skipped.`);
      return;
    }
    seen.add(cp.id);
    cp.rev = 0;
    warnings.push(...parsed.warnings.map((w) => `${cp.title}: ${w}`));
    checkpoints.push(cp);
  });
  for (const cp of checkpoints) {
    if (cp.parent && !seen.has(cp.parent)) {
      warnings.push(`"${cp.title}" referred to a missing parent and was moved to the top level.`);
      cp.parent = null;
    }
  }
  const layoutRaw = shape.data.layout as RoadmapLayout | undefined;
  const offsets: RoadmapLayout['offsets'] = {};
  if (layoutRaw && typeof layoutRaw === 'object' && layoutRaw.offsets && typeof layoutRaw.offsets === 'object') {
    for (const [id, o] of Object.entries(layoutRaw.offsets)) {
      if (seen.has(id) && Number.isFinite(o?.dx) && Number.isFinite(o?.dy)) offsets[id] = { dx: o.dx, dy: o.dy };
    }
  }
  return {
    ok: true,
    value: {
      meta: {
        id: typeof r.id === 'string' && isValidId(r.id) ? r.id : undefined,
        title: String(r.title).trim(),
        profile: profileKey,
        description: typeof r.description === 'string' ? r.description : '',
        agentAccess: r.agentAccess === 'direct' ? 'direct' : 'review',
        created: new Date().toISOString(),
        overview: typeof r.overview === 'string' ? r.overview : '',
      },
      checkpoints,
      layout: { schema: 'waymark-layout/1', offsets },
      warnings,
    },
  };
}

/** Structure-only copy for reuse: keeps titles, hierarchy, shared content and resources; drops your notes and progress. */
export function toTemplate(rm: Roadmap, name: string): Bundle {
  const b = toBundle(rm, TEMPLATE_FORMAT);
  b.roadmap = { ...b.roadmap, title: name, created: new Date().toISOString() };
  b.checkpoints = b.checkpoints
    .filter((c) => !c.archived)
    .map((c) => {
      const sections: Checkpoint['sections'] = {};
      for (const [k, v] of Object.entries(c.sections)) {
        if (!isHumanField(`sections.${k}` as never) && k !== 'questions') sections[k as keyof typeof sections] = v;
      }
      return {
        ...c,
        status: 'not-started',
        understanding: c.understanding ? 'not-yet' : null,
        approved: false,
        agentAccess: null,
        sections,
        updated: undefined,
      };
    });
  return b;
}
