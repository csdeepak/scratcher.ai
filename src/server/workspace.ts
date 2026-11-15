// The workspace engine: loads the folder, watches it, applies guard rules to outside edits,
// writes app edits durably, and keeps history, review items, trash and backups.
// It is the single writer for app edits; all mutations run one at a time.

import { EventEmitter } from 'node:events';
import { existsSync, readdirSync, promises as fs } from 'node:fs';
import path from 'node:path';
import chokidar, { type FSWatcher } from 'chokidar';
import { parse as parseYaml, stringify as stringifyYaml } from 'yaml';
import {
  parseCheckpoint,
  parseRoadmapFile,
  serializeCheckpoint,
  serializeRoadmapFile,
} from '../shared/checkpointFile';
import {
  type Checkpoint,
  type FieldPath,
  type Problem,
  type Roadmap,
  type RoadmapLayout,
  type RoadmapMeta,
  type RoadmapSummary,
} from '../shared/model';
import { getProfile, normaliseStatus } from '../shared/profiles';
import { diffCheckpoints, fieldEquals, getField, hasHumanContent, isHumanField, setField, clone } from '../shared/fields';
import { applyOps, parseChangeset, settableToFields, type AnyOp, type Changeset, type OpResult, type OpSource } from '../shared/ops';
import { deletionNeedsReview, guardExternalEdit, guardNewCheckpoint, type HeldChange } from '../shared/guard';
import { hashText, isValidId, newId, slugify } from '../shared/ids';
import { childrenIndex, compareSiblings, computeProgress, descendants, effectiveAccess, type CheckpointMap } from '../shared/tree';
import { parseBundle, toBundle, toTemplate, type Bundle } from '../shared/bundle';
import { History, type HistoryEntry, type HistorySource } from './history';
import { ReviewStore, reviewFile, type ReviewItem } from './review';
import {
  ensureDir,
  exists,
  listDirs,
  listFiles,
  moveDir,
  readText,
  removeFile,
  stamp,
  today,
  toPosix,
  writeFileAtomic,
} from './fsutil';
import { renderIndex } from './indexFile';
import { AGENTS_MD, AGENTS_VERSION_MARK, CLAUDE_MD } from './agentsDoc';

export type WsEvent =
  | { type: 'roadmap'; roadmapId: string; ids: string[]; source: string }
  | { type: 'roadmaps' }
  | { type: 'review' };

interface Runtime {
  dir: string;
  slug: string;
  meta: RoadmapMeta;
  cps: CheckpointMap;
  files: Record<string, string>;
  fileIds: Map<string, string>;
  hashes: Map<string, string>;
  problems: Map<string, Problem>;
  layout: RoadmapLayout;
}

export interface TrashEntry {
  id: string;
  roadmapId: string;
  roadmapTitle: string;
  deletedAt: string;
  title: string;
  count: number;
  checkpoints: Checkpoint[];
  files: Record<string, string>;
  /** set when the whole roadmap was deleted */
  roadmapDir?: string;
}

export interface ProposalView {
  roadmapId: string;
  file: string;
  name: string;
  error?: string;
  changeset?: Changeset;
  previews: ChangePreview[];
}

export interface ChangePreview {
  index: number;
  op: string;
  title: string;
  detail: string;
  changes?: { field: FieldPath; before: unknown; after: unknown; yours: boolean }[];
  warnings: string[];
  valid: boolean;
  /** Deletes your work or changes something only you normally change: not pre-selected. */
  risky: boolean;
}

const EMPTY_LAYOUT = (): RoadmapLayout => ({ schema: 'waymark-layout/1', offsets: {} });

export class Workspace extends EventEmitter {
  readonly roadmapsDir: string;
  readonly metaDir: string;
  readonly history: History;
  readonly review: ReviewStore;
  private rts = new Map<string, Runtime>();
  private chain: Promise<unknown> = Promise.resolve();
  private watcher?: FSWatcher;
  private pending = new Map<string, 'add' | 'change' | 'unlink'>();
  private batchTimer?: NodeJS.Timeout;
  private indexTimers = new Map<string, NodeJS.Timeout>();
  workspaceProblems: Problem[] = [];

  constructor(readonly root: string) {
    super();
    this.roadmapsDir = path.join(root, 'roadmaps');
    this.metaDir = path.join(root, '.waymark');
    this.history = new History(path.join(this.metaDir, 'history'));
    this.review = new ReviewStore(reviewFile(root));
  }

  // ---------------------------------------------------------------- lifecycle

  async init(opts: { watch?: boolean; seedExample?: string | null; templatesDir?: string | null } = {}) {
    await ensureDir(this.roadmapsDir);
    await ensureDir(path.join(this.root, 'templates'));
    await ensureDir(path.join(this.root, 'backups'));
    await ensureDir(path.join(this.metaDir, 'history'));
    await ensureDir(path.join(this.metaDir, 'trash'));
    await this.writeAgentDocs();
    await this.review.load();
    for (const slug of await listDirs(this.roadmapsDir)) await this.loadRoadmap(slug, { reconcile: true });
    if (this.rts.size === 0 && opts.seedExample && (await exists(opts.seedExample))) {
      const bundle = JSON.parse(await fs.readFile(opts.seedExample, 'utf8'));
      await this.importBundle(bundle, { keepIds: true });
    }
    if (opts.templatesDir && (await listFiles(path.join(this.root, 'templates'), (n) => n.endsWith('.json'))).length === 0) {
      for (const f of await listFiles(opts.templatesDir, (n) => n.endsWith('.json'))) {
        await fs.copyFile(path.join(opts.templatesDir, f), path.join(this.root, 'templates', f));
      }
    }
    await this.review.save();
    for (const rt of this.rts.values()) this.scheduleIndex(rt, 0);
    await this.maybeDailyBackup();
    if (opts.watch !== false) this.startWatching();
  }

  async close() {
    await this.watcher?.close();
    for (const t of this.indexTimers.values()) clearTimeout(t);
    if (this.batchTimer) clearTimeout(this.batchTimer);
    await this.chain.catch(() => {});
    await this.history.flushAll();
    await this.review.save();
  }

  private run<T>(fn: () => Promise<T>): Promise<T> {
    const next = this.chain.then(fn, fn);
    this.chain = next.catch(() => {});
    return next;
  }

  private emitEvent(e: WsEvent) {
    this.emit('event', e);
  }

  private async writeAgentDocs() {
    const agents = path.join(this.root, 'AGENTS.md');
    const current = await readText(agents);
    if (current === null || (current.includes('<!-- waymark:agents') && !current.includes(AGENTS_VERSION_MARK))) {
      await writeFileAtomic(agents, AGENTS_MD);
    }
    const claude = path.join(this.root, 'CLAUDE.md');
    if (!(await exists(claude))) await writeFileAtomic(claude, CLAUDE_MD);
  }

  // ---------------------------------------------------------------- loading

  private async loadRoadmap(slug: string, opts: { reconcile: boolean }): Promise<Runtime | null> {
    const dir = path.join(this.roadmapsDir, slug);
    const text = await readText(path.join(dir, 'roadmap.md'));
    if (text === null) return null;
    const parsed = parseRoadmapFile(text, slug);
    if (!parsed.ok) {
      this.workspaceProblems = this.workspaceProblems.filter((p) => p.file !== `roadmaps/${slug}/roadmap.md`);
      this.workspaceProblems.push({ file: `roadmaps/${slug}/roadmap.md`, message: parsed.error, at: new Date().toISOString() });
      return null;
    }
    const dup = this.rts.get(parsed.value.id);
    if (dup && dup.slug !== slug) {
      this.workspaceProblems.push({
        file: `roadmaps/${slug}/roadmap.md`,
        message: `Same roadmap id as "${dup.slug}". Copying a roadmap folder? Change the id in roadmap.md or use Export/Import.`,
        at: new Date().toISOString(),
      });
      return null;
    }
    const rt: Runtime = {
      dir,
      slug,
      meta: parsed.value,
      cps: {},
      files: {},
      fileIds: new Map(),
      hashes: new Map([['roadmap.md', hashText(text)]]),
      problems: new Map(),
      layout: EMPTY_LAYOUT(),
    };
    await this.readLayout(rt);
    this.rts.set(rt.meta.id, rt);

    const historyEntries = opts.reconcile ? await this.history.read(rt.meta.id) : [];
    const latest = new Map<string, HistoryEntry>();
    for (const e of historyEntries) latest.set(e.cp, e);
    const hasBaseline = historyEntries.length > 0;
    const profile = getProfile(rt.meta.profile);

    if (hasBaseline) {
      // Start from the last state the app knew, then treat differences on disk as outside edits.
      for (const [cpId, e] of latest) {
        if (cpId === '_roadmap' || e.kind === 'delete' || !e.after) continue;
        const p = parseCheckpoint(e.after, profile);
        if (p.ok && p.value.checkpoint.id) rt.cps[cpId] = p.value.checkpoint;
      }
    }
    const baselineIds = new Set(Object.keys(rt.cps));
    const seen = new Set<string>();
    const files = await listFiles(path.join(dir, 'checkpoints'), (n) => n.endsWith('.md') && !n.startsWith('.'));
    for (const name of files) {
      const rel = `checkpoints/${name}`;
      const content = await readText(path.join(dir, rel));
      if (content === null) continue;
      if (!hasBaseline) {
        const id = await this.loadPlain(rt, rel, content);
        if (id) {
          seen.add(id);
          this.history.record({
            roadmapId: rt.meta.id,
            cp: id,
            title: rt.cps[id]!.title,
            source: 'system',
            kind: 'create',
            before: null,
            after: content,
            note: 'First seen by Waymark',
          });
        }
      } else {
        const ids = await this.ingestCheckpointText(rt, rel, content, { review: true });
        for (const id of ids) seen.add(id);
      }
    }
    if (hasBaseline) {
      for (const id of baselineIds) {
        if (!seen.has(id) && rt.cps[id] && !rt.files[id]) {
          // Deleted while the app was closed.
          rt.files[id] = `checkpoints/${slugify(rt.cps[id]!.title)}.md`;
          await this.handleExternalDelete(rt, rt.files[id]!, id);
        }
      }
      const rmEntry = latest.get('_roadmap');
      if (!rmEntry) this.recordMeta(rt, null, text, 'system');
    } else {
      this.recordMeta(rt, null, text, 'system');
    }
    return rt;
  }

  /** Load a checkpoint file with no baseline (first run): accept as-is, fixing only a missing id. */
  private async loadPlain(rt: Runtime, rel: string, content: string): Promise<string | null> {
    const profile = getProfile(rt.meta.profile);
    const parsed = parseCheckpoint(content, profile, titleFromFile(rel));
    if (!parsed.ok) {
      this.setProblem(rt, rel, parsed.error);
      return null;
    }
    const cp = parsed.value.checkpoint;
    if (parsed.value.missingId) cp.id = this.freshId(rt);
    if (rt.cps[cp.id]) {
      this.setProblem(rt, rel, `Duplicate id "${cp.id}" (also in ${rt.files[cp.id]}). Give one of them a new id.`);
      return null;
    }
    if (parsed.value.missingOrder) cp.order = this.nextOrder(rt, cp.parent);
    rt.cps[cp.id] = cp;
    this.mapFile(rt, cp.id, rel);
    rt.hashes.set(rel, hashText(content));
    if (parsed.value.missingId) await this.writeCheckpoint(rt, cp, rel);
    return cp.id;
  }

  private async readLayout(rt: Runtime) {
    const text = await readText(path.join(rt.dir, 'layout.json'));
    if (text === null) {
      rt.layout = EMPTY_LAYOUT();
      return;
    }
    rt.hashes.set('layout.json', hashText(text));
    try {
      const data = JSON.parse(text) as RoadmapLayout;
      const offsets: RoadmapLayout['offsets'] = {};
      for (const [id, o] of Object.entries(data.offsets ?? {})) {
        if (Number.isFinite(o?.dx) && Number.isFinite(o?.dy)) offsets[id] = { dx: o.dx, dy: o.dy };
      }
      rt.layout = { schema: 'waymark-layout/1', offsets };
      rt.problems.delete('layout.json');
    } catch (e) {
      this.setProblem(rt, 'layout.json', `layout.json is not valid JSON: ${(e as Error).message}`);
    }
  }

  // ---------------------------------------------------------------- watching

  private startWatching() {
    this.watcher = chokidar.watch(this.roadmapsDir, {
      ignoreInitial: true,
      ignored: (p: string) => {
        const base = path.basename(p);
        return base.startsWith('.') || base.endsWith('.tmp') || base === 'INDEX.md';
      },
      awaitWriteFinish: { stabilityThreshold: 120, pollInterval: 40 },
    });
    const queue = (kind: 'add' | 'change' | 'unlink') => (p: string) => {
      this.pending.set(p, kind);
      if (this.batchTimer) clearTimeout(this.batchTimer);
      this.batchTimer = setTimeout(() => {
        const batch = new Map(this.pending);
        this.pending.clear();
        void this.run(() => this.processBatch(batch)).catch((e) => console.error('[waymark] watcher batch failed:', e));
      }, 200);
    };
    this.watcher.on('add', queue('add'));
    this.watcher.on('change', queue('change'));
    this.watcher.on('unlink', queue('unlink'));
    this.watcher.on('error', (e) => console.error('[waymark] watcher error:', e));
  }

  /** Process outside changes to the given absolute paths now (tests, CLI). */
  async syncPaths(paths: string[]) {
    const batch = new Map<string, 'add' | 'change' | 'unlink'>();
    for (const p of paths) batch.set(p, existsSync(p) ? 'change' : 'unlink');
    return this.run(() => this.processBatch(batch));
  }

  private async processBatch(batch: Map<string, 'add' | 'change' | 'unlink'>) {
    const bySlug = new Map<string, { rel: string; kind: 'add' | 'change' | 'unlink' }[]>();
    for (const [abs, kind] of batch) {
      const rel = toPosix(path.relative(this.roadmapsDir, abs));
      const [slug, ...rest] = rel.split('/');
      if (!slug || rest.length === 0) continue;
      if (!bySlug.has(slug)) bySlug.set(slug, []);
      bySlug.get(slug)!.push({ rel: rest.join('/'), kind });
    }
    let listChanged = false;
    let reviewChanged = false;
    for (const [slug, events] of bySlug) {
      let rt = [...this.rts.values()].find((r) => r.slug === slug);
      if (!rt) {
        if (events.some((e) => e.rel === 'roadmap.md' && e.kind !== 'unlink')) {
          const loaded = await this.loadRoadmap(slug, { reconcile: false });
          if (loaded) {
            listChanged = true;
            this.scheduleIndex(loaded);
          }
        }
        continue;
      }
      const changedIds = new Set<string>();
      let metaChanged = false;
      const unlinks: string[] = [];
      for (const ev of events) {
        if (ev.kind === 'unlink') {
          unlinks.push(ev.rel);
          continue;
        }
        const text = await readText(path.join(rt.dir, ev.rel));
        if (text === null) {
          unlinks.push(ev.rel);
          continue;
        }
        if (ev.rel === 'roadmap.md') {
          metaChanged = (await this.ingestRoadmapText(rt, text)) || metaChanged;
        } else if (ev.rel === 'layout.json') {
          if (rt.hashes.get('layout.json') !== hashText(text)) {
            await this.readLayout(rt);
            metaChanged = true;
          }
        } else if (/^checkpoints\/[^/]+\.md$/.test(ev.rel)) {
          for (const id of await this.ingestCheckpointText(rt, ev.rel, text, { review: true })) changedIds.add(id);
        } else if (ev.rel.startsWith('proposals/')) {
          reviewChanged = true;
        }
      }
      for (const rel of unlinks) {
        if (rel === 'roadmap.md') {
          // Folder removed or roadmap.md deleted outside the app: forget it (history keeps the content).
          if (!(await exists(path.join(rt.dir, 'roadmap.md')))) {
            this.rts.delete(rt.meta.id);
            listChanged = true;
          }
          break;
        }
        if (rel.startsWith('proposals/')) {
          reviewChanged = true;
          continue;
        }
        rt.problems.delete(rel);
        rt.hashes.delete(rel);
        const id = rt.fileIds.get(rel);
        if (!id) continue;
        if (rt.files[id] !== rel) {
          rt.fileIds.delete(rel); // renamed: the id now lives in another file
          continue;
        }
        await this.handleExternalDelete(rt, rel, id);
        changedIds.add(id);
      }
      if (changedIds.size || metaChanged) {
        reviewChanged = true;
        listChanged = true;
        this.scheduleIndex(rt);
        this.emitEvent({ type: 'roadmap', roadmapId: rt.meta.id, ids: [...changedIds], source: 'external' });
      } else if (rt.problems.size) {
        this.scheduleIndex(rt);
        this.emitEvent({ type: 'roadmap', roadmapId: rt.meta.id, ids: [], source: 'external' });
      }
    }
    if (reviewChanged) {
      await this.review.save();
      this.emitEvent({ type: 'review' });
    }
    if (listChanged) this.emitEvent({ type: 'roadmaps' });
  }

  // ---------------------------------------------------------------- outside edits

  /** Apply guard rules to a checkpoint file written outside the app. Returns affected ids. */
  private async ingestCheckpointText(rt: Runtime, rel: string, text: string, opts: { review: boolean }): Promise<string[]> {
    const hash = hashText(text);
    if (rt.hashes.get(rel) === hash) return [];
    const profile = getProfile(rt.meta.profile);
    const parsed = parseCheckpoint(text, profile, titleFromFile(rel));
    if (!parsed.ok) {
      rt.hashes.set(rel, hash);
      this.setProblem(rt, rel, parsed.error);
      return [];
    }
    rt.problems.delete(rel);
    const incoming = parsed.value.checkpoint;
    let mustRewrite = false;
    const priorId = rt.fileIds.get(rel);
    if (parsed.value.missingId) {
      incoming.id = priorId ?? this.freshId(rt);
      mustRewrite = true;
    }
    if (priorId && priorId !== incoming.id && rt.cps[priorId] && rt.files[priorId] === rel) {
      this.setProblem(
        rt,
        rel,
        `The id changed from "${priorId}" to "${incoming.id}". Ids must never change: put "${priorId}" back (or restore the file from History).`,
      );
      rt.hashes.set(rel, hash);
      return [];
    }
    const otherFile = rt.files[incoming.id];
    if (otherFile && otherFile !== rel && existsSync(path.join(rt.dir, otherFile))) {
      this.setProblem(rt, rel, `Duplicate id "${incoming.id}" (also used by ${otherFile}). New checkpoints need a new id.`);
      rt.hashes.set(rel, hash);
      return [];
    }
    if (otherFile && otherFile !== rel) {
      rt.fileIds.delete(otherFile); // file was renamed
      rt.hashes.delete(otherFile);
    }
    const existing = rt.cps[incoming.id];
    if (parsed.value.missingOrder) incoming.order = existing?.order ?? this.nextOrder(rt, incoming.parent);
    const access = effectiveAccess(rt.cps, rt.meta, existing ? existing.id : incoming.parent);
    const reviewable = opts.review && access !== 'direct';

    if (!existing) {
      const { next, held } = guardNewCheckpoint(rt.meta, incoming);
      next.rev = incoming.rev;
      rt.cps[next.id] = next;
      this.mapFile(rt, next.id, rel);
      rt.hashes.set(rel, hash);
      let after = text;
      if (held.length || mustRewrite) after = await this.writeCheckpoint(rt, { ...next, rev: next.rev + (held.length ? 1 : 0) }, rel);
      if (held.length) rt.cps[next.id] = { ...next, rev: next.rev + 1 };
      this.history.record({ roadmapId: rt.meta.id, cp: next.id, title: next.title, source: 'external', kind: 'create', before: null, after });
      if (reviewable) this.review.add({ roadmapId: rt.meta.id, checkpointId: next.id, title: next.title, kind: 'created', changes: [] });
      if (held.length) this.addHeld(rt, next, held, false);
      return [next.id];
    }

    let base: Checkpoint | null = null;
    if (incoming.rev < existing.rev) base = await this.findVersion(rt, existing.id, incoming.rev);
    const decision = guardExternalEdit({ meta: rt.meta, cps: rt.cps, existing, incoming, base });
    if (!decision.accepted.length && !decision.held.length) {
      rt.hashes.set(rel, hash);
      this.mapFile(rt, existing.id, rel);
      if (mustRewrite || diffCheckpoints(existing, incoming).length) await this.writeCheckpoint(rt, existing, rel);
      return [];
    }
    let next = decision.next;
    if (incoming.rev > existing.rev) next = { ...next, rev: incoming.rev };
    const fileMatches = diffCheckpoints(next, incoming).length === 0;
    rt.hashes.set(rel, hash);
    this.mapFile(rt, next.id, rel);
    let after = text;
    if (!fileMatches || mustRewrite) {
      next = { ...next, rev: Math.max(next.rev, existing.rev) + 1, updated: new Date().toISOString() };
      after = await this.writeCheckpoint(rt, next, rel);
    }
    rt.cps[next.id] = next;
    this.history.record({
      roadmapId: rt.meta.id,
      cp: next.id,
      title: next.title,
      source: 'external',
      kind: 'update',
      before: serializeCheckpoint(existing, profile),
      after,
      note: decision.held.length ? `${decision.held.length} change(s) held for review` : undefined,
    });
    if (decision.accepted.length && reviewable) {
      this.review.add({ roadmapId: rt.meta.id, checkpointId: next.id, title: next.title, kind: 'changed', changes: decision.accepted, stale: decision.stale });
    }
    if (decision.held.length) this.addHeld(rt, next, decision.held, decision.stale);
    return [next.id];
  }

  private addHeld(rt: Runtime, cp: Checkpoint, held: HeldChange[], stale: boolean) {
    this.review.add({ roadmapId: rt.meta.id, checkpointId: cp.id, title: cp.title, kind: 'held', changes: held, stale });
  }

  private async handleExternalDelete(rt: Runtime, rel: string, id: string) {
    const cp = rt.cps[id];
    if (!cp) return;
    const profile = getProfile(rt.meta.profile);
    if (deletionNeedsReview(rt.cps, id)) {
      await this.writeCheckpoint(rt, cp, rel);
      this.review.add({
        roadmapId: rt.meta.id,
        checkpointId: id,
        title: cp.title,
        kind: 'held-delete',
        changes: [],
      });
      return;
    }
    const trash = await this.writeTrash(rt, [cp], cp.title);
    delete rt.cps[id];
    delete rt.files[id];
    rt.fileIds.delete(rel);
    rt.hashes.delete(rel);
    this.history.record({ roadmapId: rt.meta.id, cp: id, title: cp.title, source: 'external', kind: 'delete', before: serializeCheckpoint(cp, profile), after: null });
    if (effectiveAccess(rt.cps, rt.meta, cp.parent) !== 'direct') {
      this.review.add({ roadmapId: rt.meta.id, checkpointId: id, title: cp.title, kind: 'deleted', changes: [], trashId: trash.id });
    }
  }

  private async ingestRoadmapText(rt: Runtime, text: string): Promise<boolean> {
    const hash = hashText(text);
    if (rt.hashes.get('roadmap.md') === hash) return false;
    rt.hashes.set('roadmap.md', hash);
    const parsed = parseRoadmapFile(text, rt.slug);
    if (!parsed.ok) {
      this.setProblem(rt, 'roadmap.md', parsed.error);
      return true;
    }
    rt.problems.delete('roadmap.md');
    const inc = parsed.value;
    const prev = rt.meta;
    if (inc.id !== prev.id) {
      this.setProblem(rt, 'roadmap.md', `The roadmap id changed. Put "${prev.id}" back.`);
      return true;
    }
    const next: RoadmapMeta = { ...prev, title: inc.title, description: inc.description, overview: inc.overview, extra: inc.extra };
    const held: HeldChange[] = [];
    if (inc.profile !== prev.profile) held.push({ field: 'profile' as FieldPath, before: prev.profile, after: inc.profile, reason: 'yours' });
    if (inc.agentAccess !== prev.agentAccess) held.push({ field: 'agentAccess', before: prev.agentAccess, after: inc.agentAccess, reason: 'yours' });
    const changes = (['title', 'description', 'overview'] as const)
      .filter((k) => !fieldEquals(prev[k], inc[k]))
      .map((k) => ({ field: k as FieldPath, before: prev[k], after: inc[k] }));
    rt.meta = next;
    let after = text;
    if (held.length) {
      rt.meta = { ...next, rev: prev.rev + 1 };
      after = await this.writeMeta(rt);
      this.review.add({ roadmapId: prev.id, checkpointId: '_roadmap', title: next.title, kind: 'held', changes: held });
    }
    if (changes.length && rt.meta.agentAccess !== 'direct') {
      this.review.add({ roadmapId: prev.id, checkpointId: '_roadmap', title: next.title, kind: 'changed', changes });
    }
    this.recordMeta(rt, serializeRoadmapFile(prev), after, 'external');
    return true;
  }

  private async findVersion(rt: Runtime, id: string, rev: number): Promise<Checkpoint | null> {
    const entries = await this.history.read(rt.meta.id);
    const profile = getProfile(rt.meta.profile);
    for (let i = entries.length - 1; i >= 0; i--) {
      const e = entries[i]!;
      if (e.cp !== id || !e.after) continue;
      const p = parseCheckpoint(e.after, profile);
      if (p.ok && p.value.checkpoint.rev === rev) return p.value.checkpoint;
      if (p.ok && p.value.checkpoint.rev < rev) break;
    }
    return null;
  }

  // ---------------------------------------------------------------- writing helpers

  private setProblem(rt: Runtime, rel: string, message: string) {
    rt.problems.set(rel, { file: rel, message, at: new Date().toISOString() });
  }

  private freshId(rt: Runtime): string {
    let id: string;
    do id = newId('cp');
    while (rt.cps[id]);
    return id;
  }

  private nextOrder(rt: Runtime, parent: string | null): number {
    const sibs = Object.values(rt.cps).filter((c) => (c.parent ?? null) === (parent ?? null));
    return sibs.length ? Math.floor(Math.max(...sibs.map((s) => s.order))) + 1 : 1;
  }

  private mapFile(rt: Runtime, id: string, rel: string) {
    const old = rt.files[id];
    if (old && old !== rel) rt.fileIds.delete(old);
    rt.files[id] = rel;
    rt.fileIds.set(rel, id);
  }

  private uniqueFile(rt: Runtime, title: string, id: string): string {
    const base = slugify(title, id);
    for (let n = 1; n < 1000; n++) {
      const rel = `checkpoints/${base}${n === 1 ? '' : `-${n}`}.md`;
      const owner = rt.fileIds.get(rel);
      if (owner === id) return rel;
      if (!owner && !rt.problems.has(rel) && !existsSync(path.join(rt.dir, rel))) return rel;
    }
    return `checkpoints/${id}.md`;
  }

  /** Serialise and write a checkpoint. Records the hash first so the watcher ignores our own write. */
  private async writeCheckpoint(rt: Runtime, cp: Checkpoint, rel?: string): Promise<string> {
    const target = rel ?? rt.files[cp.id] ?? this.uniqueFile(rt, cp.title, cp.id);
    const text = serializeCheckpoint(cp, getProfile(rt.meta.profile));
    rt.hashes.set(target, hashText(text));
    this.mapFile(rt, cp.id, target);
    await writeFileAtomic(path.join(rt.dir, target), text);
    return text;
  }

  private async writeMeta(rt: Runtime): Promise<string> {
    const text = serializeRoadmapFile(rt.meta);
    rt.hashes.set('roadmap.md', hashText(text));
    await writeFileAtomic(path.join(rt.dir, 'roadmap.md'), text);
    return text;
  }

  private recordMeta(rt: Runtime, before: string | null, after: string, source: HistorySource) {
    this.history.record({ roadmapId: rt.meta.id, cp: '_roadmap', title: rt.meta.title, source, kind: before ? 'update' : 'create', before, after });
  }

  private async writeTrash(rt: Runtime, cps: Checkpoint[], title: string): Promise<TrashEntry> {
    const entry: TrashEntry = {
      id: newId('tr'),
      roadmapId: rt.meta.id,
      roadmapTitle: rt.meta.title,
      deletedAt: new Date().toISOString(),
      title,
      count: cps.length,
      checkpoints: cps.map((c) => clone(c)),
      files: Object.fromEntries(cps.map((c) => [c.id, rt.files[c.id] ?? ''])),
    };
    await writeFileAtomic(path.join(this.metaDir, 'trash', `${entry.id}.json`), JSON.stringify(entry, null, 2));
    return entry;
  }

  scheduleIndex(rt: Runtime, delay = 400) {
    const prev = this.indexTimers.get(rt.meta.id);
    if (prev) clearTimeout(prev);
    const t = setTimeout(() => {
      this.indexTimers.delete(rt.meta.id);
      const held = this.review.forRoadmap(rt.meta.id).filter((i) => i.kind === 'held' || i.kind === 'held-delete');
      const text = renderIndex(this.toRoadmap(rt), held, this.proposalNamesSync(rt));
      void writeFileAtomic(path.join(rt.dir, 'INDEX.md'), text).catch((e) => console.error('[waymark] INDEX.md write failed:', e));
    }, delay);
    t.unref?.();
    this.indexTimers.set(rt.meta.id, t);
  }

  private proposalNamesSync(rt: Runtime): string[] {
    try {
      return readdirSync(path.join(rt.dir, 'proposals')).filter((n) => /\.(ya?ml|json)$/i.test(n) && !n.startsWith('.'));
    } catch {
      return [];
    }
  }

  // ---------------------------------------------------------------- queries

  private rt(id: string): Runtime {
    const rt = this.rts.get(id);
    if (!rt) throw new HttpError(404, 'Roadmap not found.');
    return rt;
  }

  toRoadmap(rt: Runtime): Roadmap {
    return {
      meta: rt.meta,
      slug: rt.slug,
      checkpoints: rt.cps,
      layout: rt.layout,
      files: rt.files,
      problems: [...rt.problems.values()],
    };
  }

  getRoadmap(id: string): Roadmap {
    return this.toRoadmap(this.rt(id));
  }

  roadmapDir(id: string): string {
    return this.rt(id).dir;
  }

  listRoadmaps(): RoadmapSummary[] {
    return [...this.rts.values()]
      .map((rt) => {
        const p = computeProgress(rt.cps, rt.meta).get(null)!;
        return {
          id: rt.meta.id,
          slug: rt.slug,
          title: rt.meta.title,
          description: rt.meta.description,
          profile: rt.meta.profile,
          updated: rt.meta.updated ?? latestUpdate(rt),
          total: p.total,
          done: p.done,
          understood: p.understood,
          drafts: Object.values(rt.cps).filter((c) => !c.approved && !c.archived).length,
          problems: rt.problems.size,
        };
      })
      .sort((a, b) => (b.updated ?? '').localeCompare(a.updated ?? ''));
  }

  search(q: string, limit = 40) {
    const terms = q.toLowerCase().split(/\s+/).filter(Boolean);
    if (!terms.length) return [];
    const results: { roadmapId: string; roadmapTitle: string; id: string; title: string; field: string; snippet: string; score: number }[] = [];
    for (const rt of this.rts.values()) {
      for (const cp of Object.values(rt.cps)) {
        const fields: [string, string, number][] = [
          ['title', cp.title, 10],
          ['summary', cp.summary, 4],
          ['resources', cp.resources.map((r) => `${r.title} ${r.note ?? ''}`).join(' · '), 3],
          ...Object.entries(cp.sections).map(([k, v]) => [k, v ?? '', 2] as [string, string, number]),
        ];
        let score = 0;
        let best: { field: string; text: string; pos: number } | null = null;
        for (const t of terms) {
          let hit = false;
          for (const [field, text, w] of fields) {
            const pos = text.toLowerCase().indexOf(t);
            if (pos >= 0) {
              score += w;
              hit = true;
              if (!best || w > 2) best = best && best.field === 'title' ? best : { field, text, pos };
            }
          }
          if (!hit) {
            score = 0;
            break;
          }
        }
        if (score > 0 && best) {
          const start = Math.max(0, best.pos - 50);
          const snippet = (start > 0 ? '…' : '') + best.text.slice(start, best.pos + 110).replace(/\s+/g, ' ') + (best.pos + 110 < best.text.length ? '…' : '');
          results.push({ roadmapId: rt.meta.id, roadmapTitle: rt.meta.title, id: cp.id, title: cp.title, field: best.field, snippet, score });
        }
      }
    }
    return results.sort((a, b) => b.score - a.score).slice(0, limit);
  }

  // ---------------------------------------------------------------- app edits

  async applyAppOps(roadmapId: string, ops: AnyOp[], source: OpSource = 'app', historySource?: HistorySource) {
    return this.run(async () => {
      const rt = this.rt(roadmapId);
      const profile = getProfile(rt.meta.profile);
      const res = applyOps(rt.meta, rt.cps, ops, { source });
      for (const id of res.changed) {
        const rel = rt.files[id];
        if (rel && rt.problems.has(rel)) {
          throw new HttpError(409, `${rel} has errors, so Waymark won't overwrite it. Fix the file or restore the last good version first.`);
        }
      }
      const prev = rt.cps;
      rt.cps = res.checkpoints;
      const hs: HistorySource = historySource ?? (source === 'app' ? 'app' : source);
      for (const id of res.changed) {
        const cp = rt.cps[id]!;
        const old = prev[id];
        let rel = rt.files[id];
        if (old && rel && old.title !== cp.title && slugify(old.title) !== slugify(cp.title)) {
          const renamed = this.uniqueFile(rt, cp.title, id);
          if (renamed !== rel) {
            const oldRel = rel;
            rel = renamed;
            const text = await this.writeCheckpoint(rt, cp, rel);
            rt.fileIds.delete(oldRel);
            rt.hashes.delete(oldRel);
            await removeFile(path.join(rt.dir, oldRel));
            this.history.record({ roadmapId, cp: id, title: cp.title, source: hs, kind: 'update', before: serializeCheckpoint(old, profile), after: text }, { coalesce: hs === 'app' });
            continue;
          }
        }
        const text = await this.writeCheckpoint(rt, cp, rel);
        this.history.record(
          { roadmapId, cp: id, title: cp.title, source: hs, kind: old ? 'update' : 'create', before: old ? serializeCheckpoint(old, profile) : null, after: text },
          { coalesce: hs === 'app' && !!old },
        );
      }
      let trashId: string | undefined;
      if (res.deleted.size) {
        const removed = [...res.deleted.values()];
        const roots = removed.filter((c) => !c.parent || !res.deleted.has(c.parent));
        const title = roots.length === 1 ? roots[0]!.title : `${roots.length} checkpoints`;
        const entry = await this.writeTrash(rt, removed, title);
        trashId = entry.id;
        for (const c of removed) {
          const rel = rt.files[c.id];
          if (rel) {
            rt.fileIds.delete(rel);
            rt.hashes.delete(rel);
            await removeFile(path.join(rt.dir, rel));
          }
          delete rt.files[c.id];
          this.history.record({ roadmapId, cp: c.id, title: c.title, source: hs, kind: 'delete', before: serializeCheckpoint(c, profile), after: null });
          delete rt.layout.offsets[c.id];
        }
        const deletedIds = new Set(res.deleted.keys());
        const before = this.review.items.length;
        this.review.items = this.review.items.filter(
          (i) => !(i.roadmapId === roadmapId && deletedIds.has(i.checkpointId) && i.kind !== 'deleted'),
        );
        if (this.review.items.length !== before) {
          await this.review.save();
          this.emitEvent({ type: 'review' });
        }
      }
      if (res.changed.size || res.deleted.size) {
        this.scheduleIndex(rt);
        this.emitEvent({ type: 'roadmap', roadmapId, ids: [...res.changed, ...res.deleted.keys()], source });
        this.emitEvent({ type: 'roadmaps' });
        void this.maybeDailyBackup();
      }
      return {
        results: res.results,
        checkpoints: [...res.changed].map((id) => rt.cps[id]!).filter(Boolean),
        deleted: [...res.deleted.keys()],
        trashId,
      };
    });
  }

  async updateMeta(roadmapId: string, set: Partial<Pick<RoadmapMeta, 'title' | 'description' | 'overview' | 'profile' | 'agentAccess'>>, source: HistorySource = 'app') {
    return this.run(async () => {
      const rt = this.rt(roadmapId);
      const before = serializeRoadmapFile(rt.meta);
      const profileChanged = set.profile && set.profile !== rt.meta.profile;
      rt.meta = { ...rt.meta, ...stripUndefined(set), rev: rt.meta.rev + 1, updated: new Date().toISOString() };
      const after = await this.writeMeta(rt);
      this.recordMeta(rt, before, after, source);
      if (profileChanged) {
        const profile = getProfile(rt.meta.profile);
        for (const cp of Object.values(rt.cps)) {
          const status = normaliseStatus(cp.status, profile);
          const understanding = profile.understanding ? (cp.understanding ?? 'not-yet') : cp.understanding;
          const next = { ...cp, status, understanding, rev: cp.rev + 1 };
          rt.cps[cp.id] = next;
          await this.writeCheckpoint(rt, next);
        }
      }
      this.scheduleIndex(rt);
      this.emitEvent({ type: 'roadmap', roadmapId, ids: [], source: 'app' });
      this.emitEvent({ type: 'roadmaps' });
      return rt.meta;
    });
  }

  async setLayout(roadmapId: string, offsets: RoadmapLayout['offsets']) {
    return this.run(async () => {
      const rt = this.rt(roadmapId);
      const clean: RoadmapLayout['offsets'] = {};
      for (const [id, o] of Object.entries(offsets)) {
        if (rt.cps[id] && Number.isFinite(o.dx) && Number.isFinite(o.dy) && (Math.abs(o.dx) > 0.5 || Math.abs(o.dy) > 0.5)) {
          clean[id] = { dx: Math.round(o.dx), dy: Math.round(o.dy) };
        }
      }
      rt.layout = { schema: 'waymark-layout/1', offsets: clean };
      const text = JSON.stringify(rt.layout, null, 2) + '\n';
      rt.hashes.set('layout.json', hashText(text));
      await writeFileAtomic(path.join(rt.dir, 'layout.json'), text);
      this.emitEvent({ type: 'roadmap', roadmapId, ids: [], source: 'app' });
      return rt.layout;
    });
  }

  async createRoadmap(input: { title: string; profile: 'general' | 'learning'; description?: string; overview?: string; template?: string }) {
    const meta: RoadmapMeta = {
      id: newId('rm'),
      title: input.title.trim() || 'Untitled roadmap',
      profile: input.profile,
      description: input.description?.trim() ?? '',
      agentAccess: 'review',
      created: new Date().toISOString(),
      rev: 0,
      overview: input.overview ?? '',
    };
    let cps: Checkpoint[] = [];
    let layout = EMPTY_LAYOUT();
    if (input.template) {
      const file = path.join(this.root, 'templates', path.basename(input.template));
      const text = await readText(file);
      if (text === null) throw new HttpError(404, 'Template not found.');
      const parsed = parseBundle(JSON.parse(text));
      if (!parsed.ok) throw new HttpError(400, parsed.error);
      cps = parsed.value.checkpoints;
      layout = parsed.value.layout;
      if (!input.overview) meta.overview = parsed.value.meta.overview;
      meta.profile = input.profile ?? parsed.value.meta.profile;
    }
    return this.createFromParts(meta, cps, layout, 'app');
  }

  private async createFromParts(meta: RoadmapMeta, cps: Checkpoint[], layout: RoadmapLayout, source: HistorySource) {
    return this.run(async () => {
      let slug = slugify(meta.title, 'roadmap');
      for (let n = 2; existsSync(path.join(this.roadmapsDir, slug)); n++) slug = `${slugify(meta.title, 'roadmap')}-${n}`;
      while (this.rts.has(meta.id)) meta.id = newId('rm');
      const dir = path.join(this.roadmapsDir, slug);
      await ensureDir(path.join(dir, 'checkpoints'));
      await ensureDir(path.join(dir, 'proposals'));
      const rt: Runtime = { dir, slug, meta, cps: {}, files: {}, fileIds: new Map(), hashes: new Map(), problems: new Map(), layout };
      this.rts.set(meta.id, rt);
      const metaText = await this.writeMeta(rt);
      this.recordMeta(rt, null, metaText, source);
      const profile = getProfile(meta.profile);
      for (const cp of cps) {
        const c = { ...cp, status: normaliseStatus(cp.status, profile), rev: 0 };
        if (profile.understanding && !c.understanding) c.understanding = 'not-yet';
        rt.cps[c.id] = c;
      }
      for (const cp of Object.values(rt.cps)) {
        if (cp.parent && !rt.cps[cp.parent]) cp.parent = null;
        const text = await this.writeCheckpoint(rt, cp);
        this.history.record({ roadmapId: meta.id, cp: cp.id, title: cp.title, source, kind: 'create', before: null, after: text });
      }
      if (Object.keys(layout.offsets).length) {
        const text = JSON.stringify(layout, null, 2) + '\n';
        rt.hashes.set('layout.json', hashText(text));
        await writeFileAtomic(path.join(dir, 'layout.json'), text);
      }
      this.scheduleIndex(rt, 0);
      this.emitEvent({ type: 'roadmaps' });
      return this.toRoadmap(rt);
    });
  }

  async importBundle(data: unknown, opts: { keepIds?: boolean; titleSuffix?: string } = {}) {
    const parsed = parseBundle(data);
    if (!parsed.ok) throw new HttpError(400, parsed.error);
    const v = parsed.value;
    const meta: RoadmapMeta = {
      ...v.meta,
      id: v.meta.id && !this.rts.has(v.meta.id) ? v.meta.id : newId('rm'),
      title: v.meta.title + (opts.titleSuffix ?? ''),
      rev: 0,
    };
    const rm = await this.createFromParts(meta, v.checkpoints, v.layout, 'import');
    return { roadmap: rm, warnings: v.warnings };
  }

  exportRoadmap(id: string): Bundle {
    return toBundle(this.toRoadmap(this.rt(id)));
  }

  async deleteRoadmap(id: string) {
    return this.run(async () => {
      const rt = this.rt(id);
      const entry: TrashEntry = {
        id: newId('tr'),
        roadmapId: id,
        roadmapTitle: rt.meta.title,
        deletedAt: new Date().toISOString(),
        title: rt.meta.title,
        count: Object.keys(rt.cps).length,
        checkpoints: [],
        files: {},
        roadmapDir: `roadmaps/${rt.slug}-${stamp()}`,
      };
      await this.history.flushAll();
      this.rts.delete(id);
      await moveDir(rt.dir, path.join(this.metaDir, 'trash', entry.roadmapDir!));
      await writeFileAtomic(path.join(this.metaDir, 'trash', `${entry.id}.json`), JSON.stringify(entry, null, 2));
      this.review.removeForRoadmap(id);
      await this.review.save();
      this.emitEvent({ type: 'roadmaps' });
      this.emitEvent({ type: 'review' });
    });
  }

  // ---------------------------------------------------------------- history & trash

  async restoreVersion(roadmapId: string, entryId: string, which: 'before' | 'after') {
    const rt = this.rt(roadmapId);
    const entry = await this.history.get(roadmapId, entryId);
    if (!entry) throw new HttpError(404, 'History entry not found.');
    const text = which === 'before' ? entry.before : entry.after;
    if (!text) throw new HttpError(400, 'That version has no content (it was a creation or deletion).');
    if (entry.cp === '_roadmap') {
      const p = parseRoadmapFile(text, rt.slug);
      if (!p.ok) throw new HttpError(400, p.error);
      return this.updateMeta(roadmapId, { title: p.value.title, description: p.value.description, overview: p.value.overview, profile: p.value.profile, agentAccess: p.value.agentAccess }, 'restore');
    }
    const p = parseCheckpoint(text, getProfile(rt.meta.profile));
    if (!p.ok) throw new HttpError(400, p.error);
    return this.applyAppOps(roadmapId, [{ op: 'restore', checkpoint: p.value.checkpoint }], 'restore');
  }

  async listTrash(): Promise<Omit<TrashEntry, 'checkpoints'>[]> {
    const dir = path.join(this.metaDir, 'trash');
    const out: Omit<TrashEntry, 'checkpoints'>[] = [];
    for (const f of await listFiles(dir, (n) => n.endsWith('.json'))) {
      try {
        const e = JSON.parse((await readText(path.join(dir, f))) ?? '') as TrashEntry;
        const { checkpoints: _c, ...rest } = e;
        out.push(rest);
      } catch {
        /* ignore damaged entries */
      }
    }
    return out.sort((a, b) => b.deletedAt.localeCompare(a.deletedAt));
  }

  async restoreTrash(trashId: string) {
    const file = path.join(this.metaDir, 'trash', `${path.basename(trashId)}.json`);
    const text = await readText(file);
    if (!text) throw new HttpError(404, 'Trash item not found.');
    const entry = JSON.parse(text) as TrashEntry;
    if (entry.roadmapDir) {
      await this.run(async () => {
        const from = path.join(this.metaDir, 'trash', entry.roadmapDir!);
        let slug = path.basename(entry.roadmapDir!).replace(/-\d{4}-\d{2}-\d{2}T[\d-]+Z$/, '');
        for (let n = 2; existsSync(path.join(this.roadmapsDir, slug)); n++) slug = `${slug}-${n}`;
        await moveDir(from, path.join(this.roadmapsDir, slug));
        await this.loadRoadmap(slug, { reconcile: true });
        await removeFile(file);
      });
      this.emitEvent({ type: 'roadmaps' });
      return { roadmapId: entry.roadmapId };
    }
    const rt = this.rt(entry.roadmapId);
    const ordered = [...entry.checkpoints].sort((a, b) => depth(entry.checkpoints, a) - depth(entry.checkpoints, b));
    const ops: AnyOp[] = ordered.filter((c) => !rt.cps[c.id]).map((c) => ({ op: 'restore', checkpoint: c }));
    const res = await this.applyAppOps(entry.roadmapId, ops, 'restore');
    await removeFile(file);
    const before = this.review.items.length;
    this.review.items = this.review.items.filter((i) => i.trashId !== trashId);
    if (before !== this.review.items.length) {
      await this.review.save();
      this.emitEvent({ type: 'review' });
    }
    return { roadmapId: entry.roadmapId, restored: res.checkpoints.map((c) => c.id) };
  }

  async purgeTrash(trashId: string) {
    const file = path.join(this.metaDir, 'trash', `${path.basename(trashId)}.json`);
    const text = await readText(file);
    if (text) {
      const entry = JSON.parse(text) as TrashEntry;
      if (entry.roadmapDir) await fs.rm(path.join(this.metaDir, 'trash', entry.roadmapDir), { recursive: true, force: true });
    }
    await removeFile(file);
  }

  /** Overwrite a damaged file with the last good version the app holds (the damaged text is kept aside). */
  async resolveProblem(roadmapId: string, rel: string) {
    return this.run(async () => {
      const rt = this.rt(roadmapId);
      const abs = path.join(rt.dir, rel);
      const broken = await readText(abs);
      if (broken !== null) await writeFileAtomic(path.join(this.metaDir, 'broken', `${rt.slug}-${stamp()}-${path.basename(rel)}`), broken);
      if (rel === 'roadmap.md') await this.writeMeta(rt);
      else if (rel === 'layout.json') await this.setLayoutUnlocked(rt);
      else {
        const id = rt.fileIds.get(rel);
        if (id && rt.cps[id]) await this.writeCheckpoint(rt, rt.cps[id]!, rel);
        else {
          await removeFile(abs);
          rt.hashes.delete(rel);
        }
      }
      rt.problems.delete(rel);
      this.scheduleIndex(rt);
      this.emitEvent({ type: 'roadmap', roadmapId, ids: [], source: 'app' });
    });
  }

  private async setLayoutUnlocked(rt: Runtime) {
    const text = JSON.stringify(rt.layout, null, 2) + '\n';
    rt.hashes.set('layout.json', hashText(text));
    await writeFileAtomic(path.join(rt.dir, 'layout.json'), text);
  }

  // ---------------------------------------------------------------- review

  listReview(): ReviewItem[] {
    return this.review.items.filter((i) => this.rts.has(i.roadmapId));
  }

  async reviewAction(itemId: string, action: 'keep' | 'revert' | 'apply' | 'discard', fields?: FieldPath[]) {
    const item = this.review.get(itemId);
    if (!item) throw new HttpError(404, 'This review item is gone (already handled?).');
    const rt = this.rt(item.roadmapId);
    const selected = item.changes.filter((c) => !fields || fields.includes(c.field));
    const finish = async (handled: FieldPath[] | 'all') => {
      if (handled === 'all') this.review.remove(item.id);
      else {
        item.changes = item.changes.filter((c) => !handled.includes(c.field));
        if (!item.changes.length) this.review.remove(item.id);
      }
      await this.review.save();
      this.scheduleIndex(rt);
      this.emitEvent({ type: 'review' });
    };

    if (action === 'keep' || action === 'discard') return finish(fields ?? 'all');

    if (item.checkpointId === '_roadmap') {
      const set: Record<string, unknown> = {};
      for (const c of selected) set[c.field] = action === 'revert' ? c.before : c.after;
      await this.updateMeta(rt.meta.id, set as never, 'review');
      return finish(selected.map((c) => c.field));
    }

    if (item.kind === 'created' && action === 'revert') {
      await this.applyAppOps(rt.meta.id, [{ op: 'delete', id: item.checkpointId }], 'restore', 'review');
      return finish('all');
    }
    if (item.kind === 'deleted' && action === 'revert') {
      if (item.trashId) await this.restoreTrash(item.trashId);
      return finish('all');
    }
    if (item.kind === 'held-delete' && action === 'apply') {
      await this.applyAppOps(rt.meta.id, [{ op: 'delete', id: item.checkpointId }], 'restore', 'review');
      return finish('all');
    }
    const cur = rt.cps[item.checkpointId];
    if (!cur) {
      await finish('all');
      throw new HttpError(409, 'That checkpoint no longer exists.');
    }
    let next = cur;
    const handled: FieldPath[] = [];
    const skipped: string[] = [];
    for (const c of selected) {
      if (action === 'revert') {
        if (!fieldEquals(getField(cur, c.field), c.after)) {
          skipped.push(c.field);
          continue;
        }
        next = setField(next, c.field, c.before);
      } else {
        next = setField(next, c.field, c.after);
      }
      handled.push(c.field);
    }
    if (next !== cur) await this.applyAppOps(rt.meta.id, [{ op: 'restore', checkpoint: next }], 'restore', 'review');
    await finish(skipped.length ? handled : selected.map((c) => c.field));
    return { skipped };
  }

  // ---------------------------------------------------------------- proposals

  async listProposals(): Promise<ProposalView[]> {
    const out: ProposalView[] = [];
    for (const rt of this.rts.values()) {
      const dir = path.join(rt.dir, 'proposals');
      for (const name of await listFiles(dir, (n) => /\.(ya?ml|json)$/i.test(n) && !n.startsWith('.'))) {
        out.push(await this.readProposal(rt, name));
      }
    }
    return out;
  }

  private async readProposal(rt: Runtime, name: string): Promise<ProposalView> {
    const file = `proposals/${name}`;
    const text = (await readText(path.join(rt.dir, file))) ?? '';
    const view: ProposalView = { roadmapId: rt.meta.id, file, name, previews: [] };
    let data: unknown;
    try {
      data = parseYaml(text);
    } catch (e) {
      view.error = `Not valid YAML/JSON: ${(e as Error).message.split('\n')[0]}`;
      return view;
    }
    const cs = parseChangeset(data);
    if (!cs.ok) {
      view.error = cs.error;
      return view;
    }
    view.changeset = cs.value;
    view.previews = previewChangeset(rt.meta, rt.cps, cs.value);
    return view;
  }

  async applyProposal(roadmapId: string, name: string, indexes: number[]) {
    const rt = this.rt(roadmapId);
    const view = await this.readProposal(rt, path.basename(name));
    if (!view.changeset) throw new HttpError(400, view.error ?? 'Invalid proposal.');
    const chosen = view.changeset.changes.filter((_, i) => indexes.includes(i));
    const res = chosen.length ? await this.applyAppOps(roadmapId, chosen, 'proposal') : { results: [] as OpResult[], checkpoints: [], deleted: [] };
    await this.archiveProposal(rt, view.name, { action: 'applied', indexes, results: res.results });
    return res;
  }

  async rejectProposal(roadmapId: string, name: string) {
    const rt = this.rt(roadmapId);
    await this.archiveProposal(rt, path.basename(name), { action: 'rejected' });
  }

  private async archiveProposal(rt: Runtime, name: string, record: Record<string, unknown>) {
    const src = path.join(rt.dir, 'proposals', name);
    const text = await readText(src);
    if (text === null) return;
    const dest = path.join(this.metaDir, 'archive', 'proposals', rt.slug, `${stamp()}-${name}`);
    await writeFileAtomic(dest, text);
    await writeFileAtomic(dest + '.result.json', JSON.stringify({ ...record, at: new Date().toISOString() }, null, 2));
    await removeFile(src);
    this.scheduleIndex(rt);
    this.emitEvent({ type: 'review' });
  }

  /** Save pasted agent output (YAML or JSON, optionally inside a code fence) as a proposal file. */
  async addPastedProposal(roadmapId: string, text: string) {
    const rt = this.rt(roadmapId);
    const fenced = text.match(/```(?:ya?ml|json)?\s*\n([\s\S]*?)```/i);
    const body = fenced ? fenced[1]! : text;
    let data: unknown;
    try {
      data = parseYaml(body);
    } catch (e) {
      throw new HttpError(400, `Couldn't read that as YAML or JSON: ${(e as Error).message.split('\n')[0]}`);
    }
    const cs = parseChangeset(data);
    if (!cs.ok) throw new HttpError(400, `That isn't a valid changeset: ${cs.error}`);
    const name = `pasted-${stamp()}.yaml`;
    await writeFileAtomic(path.join(rt.dir, 'proposals', name), stringifyYaml(data, { lineWidth: 0 }));
    this.emitEvent({ type: 'review' });
    return { name };
  }

  // ---------------------------------------------------------------- templates & backups

  async listTemplates() {
    const dir = path.join(this.root, 'templates');
    const out: { file: string; title: string; profile: string; count: number; description: string }[] = [];
    for (const f of await listFiles(dir, (n) => n.endsWith('.json'))) {
      try {
        const data = JSON.parse((await readText(path.join(dir, f))) ?? '');
        out.push({
          file: f,
          title: data.roadmap?.title ?? f,
          profile: data.roadmap?.profile ?? 'general',
          description: data.roadmap?.description ?? '',
          count: Array.isArray(data.checkpoints) ? data.checkpoints.length : 0,
        });
      } catch {
        /* skip */
      }
    }
    return out;
  }

  async saveTemplate(roadmapId: string, name: string) {
    const rt = this.rt(roadmapId);
    const tpl = toTemplate(this.toRoadmap(rt), name.trim() || rt.meta.title);
    let file = `${slugify(name || rt.meta.title)}.json`;
    for (let n = 2; existsSync(path.join(this.root, 'templates', file)); n++) file = `${slugify(name || rt.meta.title)}-${n}.json`;
    await writeFileAtomic(path.join(this.root, 'templates', file), JSON.stringify(tpl, null, 2));
    return { file };
  }

  async backupAll(): Promise<{ dir: string; count: number }> {
    const dirRel = `backups/${today()}`;
    const dir = path.join(this.root, dirRel);
    await ensureDir(dir);
    for (const rt of this.rts.values()) {
      await writeFileAtomic(path.join(dir, `${rt.slug}.waymark.json`), JSON.stringify(toBundle(this.toRoadmap(rt)), null, 2));
    }
    const days = (await listDirs(path.join(this.root, 'backups'))).filter((d) => /^\d{4}-\d{2}-\d{2}$/.test(d)).sort();
    for (const old of days.slice(0, Math.max(0, days.length - 30))) {
      await fs.rm(path.join(this.root, 'backups', old), { recursive: true, force: true });
    }
    return { dir: dirRel, count: this.rts.size };
  }

  private backupDayDone?: string;
  private async maybeDailyBackup() {
    const d = today();
    if (this.backupDayDone === d) return;
    this.backupDayDone = d;
    if (this.rts.size && !(await exists(path.join(this.root, 'backups', d)))) {
      await this.backupAll().catch((e) => console.error('[waymark] backup failed:', e));
    }
  }

  // ---------------------------------------------------------------- agent brief

  checkpointFile(roadmapId: string, id: string): string | undefined {
    const rt = this.rt(roadmapId);
    return rt.files[id] ? `roadmaps/${rt.slug}/${rt.files[id]}` : undefined;
  }

  checkpointText(roadmapId: string, id: string): string {
    const rt = this.rt(roadmapId);
    const cp = rt.cps[id];
    if (!cp) throw new HttpError(404, 'Checkpoint not found.');
    return serializeCheckpoint(cp, getProfile(rt.meta.profile));
  }

  subtreeIds(roadmapId: string, id: string): string[] {
    const rt = this.rt(roadmapId);
    return [id, ...descendants(rt.cps, id, childrenIndex(rt.cps)).map((c) => c.id)];
  }
}

// ---------------------------------------------------------------- helpers

export class HttpError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
  }
}

function titleFromFile(rel: string): string {
  const base = path.basename(rel, '.md').replace(/[-_]+/g, ' ').trim();
  return base ? base[0]!.toUpperCase() + base.slice(1) : 'Untitled';
}

function latestUpdate(rt: Runtime): string | undefined {
  let best: string | undefined;
  for (const c of Object.values(rt.cps)) if (c.updated && (!best || c.updated > best)) best = c.updated;
  return best ?? rt.meta.created;
}

function depth(list: Checkpoint[], cp: Checkpoint): number {
  let d = 0;
  let p = cp.parent;
  const seen = new Set<string>();
  while (p && !seen.has(p)) {
    seen.add(p);
    const parent = list.find((c) => c.id === p);
    if (!parent) break;
    d++;
    p = parent.parent;
  }
  return d;
}

function stripUndefined<T extends object>(o: T): Partial<T> {
  return Object.fromEntries(Object.entries(o).filter(([, v]) => v !== undefined)) as Partial<T>;
}

/** Human-readable preview of each change in a proposal, computed against the current roadmap. */
export function previewChangeset(meta: RoadmapMeta, cps: CheckpointMap, cs: Changeset): ChangePreview[] {
  const created = new Map<string, string>();
  for (const op of cs.changes) if (op.op === 'add' && op.id) created.set(op.id, op.title);
  const title = (id: string | null | undefined) => (id ? (cps[id]?.title ?? created.get(id) ?? `(${id})`) : 'top level');
  const previews: ChangePreview[] = cs.changes.map((op, index): ChangePreview => {
    const warnings: string[] = [];
    switch (op.op) {
      case 'add': {
        const parentKnown = !op.parent || cps[op.parent] || created.has(op.parent);
        if (!parentKnown) warnings.push(`Parent ${op.parent} doesn't exist.`);
        if (op.id && cps[op.id]) warnings.push(`Id ${op.id} already exists.`);
        const sections = Object.entries(op.sections ?? {}).filter(([, v]) => v?.trim());
        return {
          index,
          op: 'add',
          title: op.title,
          detail: `New checkpoint under ${op.parent ? (cps[op.parent]?.title ?? created.get(op.parent) ?? op.parent) : 'the top level'}${sections.length ? ` with ${sections.map(([k]) => k).join(', ')}` : ''}${op.resources?.length ? `, ${op.resources.length} resource(s)` : ''}`,
          changes: [
            ...(op.summary ? [{ field: 'summary' as FieldPath, before: '', after: op.summary, yours: false }] : []),
            ...sections.map(([k, v]) => ({ field: `sections.${k}` as FieldPath, before: '', after: v, yours: false })),
          ],
          warnings,
          valid: !!parentKnown && !(op.id && cps[op.id]),
          risky: false,
        };
      }
      case 'update': {
        const cur = cps[op.id];
        if (!cur) return { index, op: 'update', title: op.id, detail: 'Checkpoint not found', warnings: ['This checkpoint does not exist.'], valid: false, risky: false };
        if (op.rev !== undefined && op.rev < cur.rev) warnings.push(`Changed since the agent read it (rev ${op.rev} → ${cur.rev}). Compare carefully.`);
        const changes = settableToFields(op.set, meta)
          .map(([field, v]) => {
            const before = getField(cur, field);
            return { field, before, after: v, yours: isHumanField(field) };
          })
          .filter((c) => !fieldEquals(c.before, c.after));
        if (changes.some((c) => c.yours)) warnings.push('Touches something only you normally change.');
        if (cur.approved) warnings.push('You approved this checkpoint.');
        return { index, op: 'update', title: cur.title, detail: `${changes.length} field(s)`, changes, warnings, valid: true, risky: changes.some((c) => c.yours) || cur.approved };
      }
      case 'move': {
        const cur = cps[op.id];
        if (!cur) return { index, op: 'move', title: op.id, detail: 'Checkpoint not found', warnings: ['This checkpoint does not exist.'], valid: false, risky: false };
        return { index, op: 'move', title: cur.title, detail: `From ${title(cur.parent)} to ${title(op.parent)}${op.after ? `, after "${title(op.after)}"` : ''}`, warnings, valid: true, risky: false };
      }
      case 'delete': {
        const cur = cps[op.id];
        if (!cur) return { index, op: 'delete', title: op.id, detail: 'Already gone', warnings: [], valid: false, risky: false };
        const sub = descendants(cps, op.id);
        const mine = [cur, ...sub].some(hasHumanContent);
        if (mine) warnings.push('Contains your notes, progress or approvals. It will go to Trash.');
        return { index, op: 'delete', title: cur.title, detail: sub.length ? `With ${sub.length} sub-checkpoint(s)` : 'Moves to Trash', warnings, valid: true, risky: mine || sub.length > 0 };
      }
      case 'link':
      case 'unlink':
        return {
          index,
          op: op.op,
          title: title(op.id),
          detail: `${op.op === 'link' ? 'Requires' : 'No longer requires'} "${title(op.prerequisite)}"`,
          warnings,
          valid: !!cps[op.id] || created.has(op.id),
          risky: false,
        };
    }
  });
  return previews;
}

export { compareSiblings, isValidId };
