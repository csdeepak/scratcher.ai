// Parse and serialise checkpoint and roadmap Markdown files.
//
//   ---                      <- YAML front matter: structured fields
//   id: cp-k3x9a2mf
//   title: …
//   ---
//   # Content                <- notebook sections are top-level "#" headings
//   …                           with fixed names; use "##" and below inside.
//   # My notes
//   …

import { parse as parseYaml, stringify as stringifyYaml } from 'yaml';
import {
  ALL_SECTIONS,
  SCHEMA,
  type AgentAccess,
  type Checkpoint,
  type ProfileKey,
  type Resource,
  type ResourceKind,
  type RoadmapMeta,
  type SectionKey,
  type Understanding,
} from './model';
import { SECTION_DEFS, getProfile, normaliseStatus, sectionFromHeading, type Profile } from './profiles';
import { isValidId } from './ids';

export type ParseOk<T> = { ok: true; value: T; warnings: string[] };
export type ParseErr = { ok: false; error: string };
export type ParseResult<T> = ParseOk<T> | ParseErr;

const KNOWN_CP_KEYS = new Set([
  'id',
  'title',
  'parent',
  'order',
  'summary',
  'status',
  'understanding',
  'approved',
  'optional',
  'archived',
  'agentAccess',
  'prerequisites',
  'completion',
  'resources',
  'rev',
  'updated',
]);

const KNOWN_RM_KEYS = new Set([
  'schema',
  'id',
  'title',
  'profile',
  'description',
  'agentAccess',
  'created',
  'updated',
  'rev',
]);

export function normaliseNewlines(text: string): string {
  return text.replace(/^﻿/, '').replace(/\r\n?/g, '\n');
}

export function splitFrontMatter(
  raw: string,
): { ok: true; data: Record<string, unknown>; body: string } | ParseErr {
  const text = normaliseNewlines(raw);
  if (!text.startsWith('---\n') && text.trim() !== '---') {
    return { ok: false, error: 'The file must start with a "---" line (YAML front matter).' };
  }
  const rest = text.slice(4);
  const end = rest.search(/^(---|\.\.\.)[ \t]*$/m);
  if (end === -1) return { ok: false, error: 'The front matter has no closing "---" line.' };
  const yamlText = rest.slice(0, end);
  const afterLine = rest.indexOf('\n', end);
  const body = afterLine === -1 ? '' : rest.slice(afterLine + 1);
  let data: unknown;
  try {
    data = parseYaml(yamlText) ?? {};
  } catch (e) {
    const msg = e instanceof Error ? e.message.split('\n')[0] : String(e);
    return { ok: false, error: `Front matter is not valid YAML: ${msg}` };
  }
  if (typeof data !== 'object' || Array.isArray(data) || data === null) {
    return { ok: false, error: 'Front matter must be a set of "key: value" lines.' };
  }
  return { ok: true, data: data as Record<string, unknown>, body };
}

// ---------- coercion helpers ----------

function str(v: unknown): string {
  if (v === null || v === undefined) return '';
  if (typeof v === 'string') return v;
  if (typeof v === 'number' || typeof v === 'boolean') return String(v);
  if (v instanceof Date) return v.toISOString();
  return '';
}

function bool(v: unknown): boolean {
  if (typeof v === 'boolean') return v;
  if (typeof v === 'string') return ['true', 'yes', 'y', '1', 'on'].includes(v.trim().toLowerCase());
  if (typeof v === 'number') return v !== 0;
  return false;
}

function num(v: unknown): number | null {
  if (typeof v === 'number' && Number.isFinite(v)) return v;
  if (typeof v === 'string' && v.trim() !== '' && Number.isFinite(Number(v))) return Number(v);
  return null;
}

function idList(v: unknown): string[] {
  const arr = Array.isArray(v)
    ? v
    : typeof v === 'string'
      ? v.split(',').map((s) => s.trim())
      : [];
  const out: string[] = [];
  for (const item of arr) {
    const s = str(item).trim();
    if (isValidId(s) && !out.includes(s)) out.push(s);
  }
  return out;
}

const RESOURCE_KINDS: ResourceKind[] = ['article', 'video', 'book', 'course', 'docs', 'tool', 'other'];

export function coerceResources(v: unknown): Resource[] {
  if (!Array.isArray(v)) return [];
  const out: Resource[] = [];
  for (const item of v) {
    if (typeof item === 'string') {
      if (item.trim()) out.push({ title: item.trim(), url: item.trim() });
      continue;
    }
    if (!item || typeof item !== 'object') continue;
    const o = item as Record<string, unknown>;
    const url = str(o.url ?? o.link ?? o.href).trim();
    const title = str(o.title ?? o.name).trim() || url;
    if (!title && !url) continue;
    const r: Resource = { title, url };
    const kind = str(o.kind ?? o.type).trim().toLowerCase();
    if (RESOURCE_KINDS.includes(kind as ResourceKind)) r.kind = kind as ResourceKind;
    const start = str(o.start ?? o.timestamp ?? o.time).trim();
    if (start) r.start = start;
    const note = str(o.note ?? o.description).trim();
    if (note) r.note = note;
    out.push(r);
  }
  return out;
}

function understanding(v: unknown): Understanding | null {
  const s = str(v).trim().toLowerCase();
  if (!s) return null;
  if (['not-yet', 'not yet', 'none', 'no', 'not-assessed'].includes(s)) return 'not-yet';
  if (['can-explain', 'explain', 'can explain'].includes(s)) return 'can-explain';
  if (['can-apply', 'apply', 'can apply', 'can-explain-and-apply'].includes(s)) return 'can-apply';
  return null;
}

function agentAccess(v: unknown): AgentAccess | null {
  const s = str(v).trim().toLowerCase();
  return s === 'review' || s === 'direct' || s === 'locked' ? s : null;
}

// ---------- sections ----------

const FENCE = /^\s{0,3}(`{3,}|~{3,})/;
const H1 = /^#[ \t]+(.+?)[ \t]*#*[ \t]*$/;

function trimBlankLines(lines: string[]): string {
  let a = 0;
  let b = lines.length;
  while (a < b && lines[a]!.trim() === '') a++;
  while (b > a && lines[b - 1]!.trim() === '') b--;
  return lines.slice(a, b).join('\n');
}

/** Split a Markdown body into known sections. Text before the first known heading joins "content". */
export function parseSections(body: string): Partial<Record<SectionKey, string>> {
  const lines = normaliseNewlines(body).split('\n');
  const buckets = new Map<SectionKey | '_pre', string[]>();
  let current: SectionKey | '_pre' = '_pre';
  let fence: string | null = null;
  for (const line of lines) {
    const f = line.match(FENCE);
    if (f) {
      const marker = f[1]!;
      if (fence === null) fence = marker;
      else if (marker[0] === fence[0] && marker.length >= fence.length && line.trim() === marker) fence = null;
    } else if (fence === null) {
      const h = line.match(H1);
      if (h) {
        const key = sectionFromHeading(h[1]!);
        if (key) {
          current = key;
          if (!buckets.has(key)) buckets.set(key, []);
          else buckets.get(key)!.push('');
          continue;
        }
      }
    }
    if (!buckets.has(current)) buckets.set(current, []);
    buckets.get(current)!.push(line);
  }
  const out: Partial<Record<SectionKey, string>> = {};
  for (const [k, ls] of buckets) {
    if (k === '_pre') continue;
    const t = trimBlankLines(ls);
    if (t) out[k] = t;
  }
  const pre = trimBlankLines(buckets.get('_pre') ?? []);
  if (pre) out.content = out.content ? `${pre}\n\n${out.content}` : pre;
  return out;
}

/** Demote any line that would be read as a section heading so it stays inside its section. */
export function escapeSectionText(text: string): string {
  if (!text) return '';
  const lines = normaliseNewlines(text).split('\n');
  let fence: string | null = null;
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]!;
    const f = line.match(FENCE);
    if (f) {
      const marker = f[1]!;
      if (fence === null) fence = marker;
      else if (marker[0] === fence[0] && marker.length >= fence.length && line.trim() === marker) fence = null;
      continue;
    }
    if (fence !== null) continue;
    const h = line.match(H1);
    if (h && sectionFromHeading(h[1]!)) lines[i] = '#' + line;
  }
  return trimBlankLines(lines);
}

// ---------- checkpoint ----------

export interface ParsedCheckpoint {
  checkpoint: Checkpoint;
  missingId: boolean;
  missingOrder: boolean;
}

export function parseCheckpoint(
  raw: string,
  profile: Profile,
  fallbackTitle = 'Untitled',
): ParseResult<ParsedCheckpoint> {
  const fm = splitFrontMatter(raw);
  if (!fm.ok) return fm;
  return checkpointFromData(fm.data, parseSections(fm.body), profile, fallbackTitle);
}

/** Build a checkpoint from loosely-typed data (front matter, bundle entries) with the same coercion rules. */
export function checkpointFromData(
  d: Record<string, unknown>,
  rawSections: Record<string, unknown>,
  profile: Profile,
  fallbackTitle = 'Untitled',
): ParseResult<ParsedCheckpoint> {
  const warnings: string[] = [];
  const idRaw = str(d.id).trim();
  let missingId = false;
  if (!idRaw) missingId = true;
  else if (!isValidId(idRaw)) return { ok: false, error: `"id: ${idRaw}" is not a valid id (letters, digits, "-" or "_").` };
  let title = str(d.title).trim();
  if (!title) {
    title = fallbackTitle;
    warnings.push('Missing title; using the file name.');
  }
  const parentRaw = str(d.parent).trim();
  const order = num(d.order);
  const extra: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(d)) if (!KNOWN_CP_KEYS.has(k) && k !== 'sections') extra[k] = v;
  const sections: Partial<Record<SectionKey, string>> = {};
  for (const [k, v] of Object.entries(rawSections)) {
    const key = (ALL_SECTIONS as string[]).includes(k) ? (k as SectionKey) : sectionFromHeading(k);
    const text = escapeSectionText(str(v));
    if (key && text) sections[key] = text;
    else if (!key && text) warnings.push(`Unknown section "${k}" was ignored.`);
  }
  const cp: Checkpoint = {
    id: idRaw,
    title,
    parent: parentRaw && parentRaw !== 'null' ? parentRaw : null,
    order: order ?? 0,
    summary: str(d.summary ?? d.description).trim(),
    status: normaliseStatus(d.status, profile),
    understanding: understanding(d.understanding),
    approved: bool(d.approved),
    optional: bool(d.optional),
    archived: bool(d.archived),
    agentAccess: agentAccess(d.agentAccess),
    prerequisites: idList(d.prerequisites ?? d.requires),
    completion: str(d.completion).trim(),
    resources: coerceResources(d.resources),
    sections,
    rev: Math.max(0, Math.floor(num(d.rev) ?? 0)),
  };
  const updated = str(d.updated).trim();
  if (updated) cp.updated = updated;
  if (Object.keys(extra).length) cp.extra = extra;
  if (!profile.understanding) cp.understanding = cp.understanding ?? null;
  return { ok: true, value: { checkpoint: cp, missingId, missingOrder: order === null }, warnings };
}

export function serializeCheckpoint(cp: Checkpoint, profile: Profile): string {
  const fm: Record<string, unknown> = { id: cp.id, title: cp.title };
  if (cp.parent) fm.parent = cp.parent;
  fm.order = cp.order;
  fm.summary = cp.summary ?? '';
  fm.status = cp.status;
  if (profile.understanding || cp.understanding) fm.understanding = cp.understanding ?? 'not-yet';
  fm.approved = cp.approved;
  if (cp.optional) fm.optional = true;
  if (cp.archived) fm.archived = true;
  if (cp.agentAccess) fm.agentAccess = cp.agentAccess;
  if (cp.prerequisites.length) fm.prerequisites = cp.prerequisites;
  if (cp.completion) fm.completion = cp.completion;
  if (cp.resources.length) fm.resources = cp.resources.map(cleanResource);
  if (cp.extra) for (const [k, v] of Object.entries(cp.extra)) if (!(k in fm)) fm[k] = v;
  fm.rev = cp.rev;
  if (cp.updated) fm.updated = cp.updated;
  const yaml = stringifyYaml(fm, { lineWidth: 0 }).trimEnd();
  const keys: SectionKey[] = [...profile.sections];
  for (const k of ALL_SECTIONS) if (!keys.includes(k) && cp.sections[k]?.trim()) keys.push(k);
  const parts = keys.map((k) => {
    const body = escapeSectionText(cp.sections[k] ?? '');
    return body ? `# ${SECTION_DEFS[k].label}\n\n${body}\n` : `# ${SECTION_DEFS[k].label}\n`;
  });
  return `---\n${yaml}\n---\n\n${parts.join('\n')}`;
}

function cleanResource(r: Resource): Resource {
  const o: Resource = { title: r.title, url: r.url };
  if (r.kind) o.kind = r.kind;
  if (r.start) o.start = r.start;
  if (r.note) o.note = r.note;
  return o;
}

// ---------- roadmap.md ----------

export function parseRoadmapFile(raw: string, fallbackTitle: string): ParseResult<RoadmapMeta> {
  const fm = splitFrontMatter(raw);
  if (!fm.ok) return fm;
  const d = fm.data;
  const warnings: string[] = [];
  const id = str(d.id).trim();
  if (!isValidId(id)) return { ok: false, error: 'roadmap.md needs a valid "id".' };
  const profileKey = str(d.profile).trim().toLowerCase();
  const profile: ProfileKey = profileKey === 'learning' ? 'learning' : 'general';
  if (profileKey && profileKey !== profile) warnings.push(`Unknown profile "${profileKey}"; using general.`);
  const extra: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(d)) if (!KNOWN_RM_KEYS.has(k)) extra[k] = v;
  const access = str(d.agentAccess).trim().toLowerCase();
  const meta: RoadmapMeta = {
    id,
    title: str(d.title).trim() || fallbackTitle,
    profile,
    description: str(d.description).trim(),
    agentAccess: access === 'direct' ? 'direct' : 'review',
    created: str(d.created).trim() || new Date().toISOString(),
    rev: Math.max(0, Math.floor(num(d.rev) ?? 0)),
    overview: trimBlankLines(normaliseNewlines(fm.body).split('\n')),
  };
  const updated = str(d.updated).trim();
  if (updated) meta.updated = updated;
  if (Object.keys(extra).length) meta.extra = extra;
  return { ok: true, value: meta, warnings };
}

export function serializeRoadmapFile(meta: RoadmapMeta): string {
  const fm: Record<string, unknown> = {
    schema: SCHEMA,
    id: meta.id,
    title: meta.title,
    profile: meta.profile,
    description: meta.description ?? '',
    agentAccess: meta.agentAccess,
    created: meta.created,
  };
  if (meta.extra) for (const [k, v] of Object.entries(meta.extra)) if (!(k in fm)) fm[k] = v;
  fm.rev = meta.rev;
  if (meta.updated) fm.updated = meta.updated;
  const yaml = stringifyYaml(fm, { lineWidth: 0 }).trimEnd();
  const body = meta.overview?.trim() ? `\n${meta.overview.trim()}\n` : '';
  return `---\n${yaml}\n---\n${body}`;
}

export { getProfile };
