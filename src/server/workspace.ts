// The workspace engine: loads the folder, watches it, applies guard rules to outside edits,
// writes app edits durably, and keeps history, review items, trash and backups.
// It is the single writer for app edits; all mutations run one at a time.

import { EventEmitter } from 'node:events';
import { createWriteStream, existsSync, readFileSync, readdirSync, promises as fs } from 'node:fs';
import { randomBytes } from 'node:crypto';
import { Readable, Transform } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { ATTACHABLE_DESCRIPTION, isPlayable, maxBytesFor } from '../shared/media';
import path from 'node:path';
import chokidar, { type FSWatcher } from 'chokidar';
import { parse as parseYaml, stringify as stringifyYaml } from 'yaml';
import { strFromU8, strToU8, unzipSync, zipSync } from 'fflate';
import {
  parseCheckpoint,
  parseRoadmapFile,
  serializeCheckpoint,
  serializeRoadmapFile,
} from '../shared/checkpointFile';
import {
  roadmapColor,
  cleanMapNotes,
  ATTACHMENT_TYPES,
  MAX_ATTACHMENT_BYTES,
  type Attachment,
  type Checkpoint,
  type FieldPath,
  type Problem,
  type Roadmap,
  type RoadmapLayout,
  type RoadmapMeta,
  type RoadmapSummary,
} from '../shared/model';
import { getProfile, normaliseStatus } from '../shared/profiles';
import { APPENDABLE_FIELDS, diffCheckpoints, fieldEquals, fieldLabel, getField, hasHumanContent, isHumanField, setField, clone } from '../shared/fields';
import { appendText, applyOps, normaliseSections, parseChangeset, settableToFields, type AnyOp, type Changeset, type OpResult, type OpSource } from '../shared/ops';
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
  eachLimit,
  listFiles,
  moveDir,
  moveFile,
  writeBinaryAtomic,
  readText,
  removeFile,
  stamp,
  today,
  toPosix,
  writeFileAtomic,
} from './fsutil';
import { renderIndex } from './indexFile';
import { AGENTS_MD, AGENTS_VERSION_MARK, CLAUDE_MD, GEMINI_MD } from './agentsDoc';

export type WsEvent =
  | { type: 'roadmap'; roadmapId: string; ids: string[]; source: string }
  | { type: 'roadmaps' }
  | { type: 'review' };

interface Runtime {
  dir: string;
  /** Path under roadmaps/ (posix), e.g. "Learning/ai-syllabus". Parent folders are library groups. */
  slug: string;
  meta: RoadmapMeta;
  cps: CheckpointMap;
  files: Record<string, string>;
  fileIds: Map<string, string>;
  hashes: Map<string, string>;
  problems: Map<string, Problem>;
  layout: RoadmapLayout;
  attachments: Record<string, Attachment[]>;
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
  /** set when a single attached file was deleted: where it lived inside the roadmap folder */
  attachment?: { path: string; stored: string };
  /** where the roadmap lived before deletion, for restoring into the same folder */
  originalPath?: string;
}

export interface LibraryView {
  folders: string[];
  roadmaps: RoadmapSummary[];
}

const MAX_FOLDER_DEPTH = 4;
const RESERVED_NAMES = /^(con|prn|aux|nul|com[1-9]|lpt[1-9])(\..*)?$/i;

/** Folder names that work on Windows, macOS and Linux alike. Returns an error message or null. */
export function folderNameProblem(name: string): string | null {
  const n = name.trim();
  if (!n) return 'Give the folder a name.';
  if (n.length > 60) return 'Keep folder names under 60 characters.';
  if (/[<>:"/\\|?*\u0000-\u001f]/.test(n)) return 'Folder names can\'t contain < > : " / \\ | ? *';
  if (n.startsWith('.')) return 'Folder names can\'t start with a dot.';
  if (/[. ]$/.test(n)) return 'Folder names can\'t end with a dot or a space.';
  if (RESERVED_NAMES.test(n)) return 'That name is reserved by Windows.';
  return null;
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
  private pending = new Map<string, 'add' | 'change' | 'unlink' | 'dir'>();
  private batchTimer?: NodeJS.Timeout;
  private indexTimers = new Map<string, NodeJS.Timeout>();
  private libraryTimer?: NodeJS.Timeout;
  /** Library folders (posix paths under roadmaps/) that are not roadmaps themselves. */
  private folders = new Set<string>();
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
    await this.scanTree('', 0, true);
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
    this.scheduleLibrary(0);
    await this.maybeDailyBackup();
    if (opts.watch !== false) this.startWatching();
  }

  async close() {
    await this.watcher?.close();
    for (const t of this.indexTimers.values()) clearTimeout(t);
    if (this.batchTimer) clearTimeout(this.batchTimer);
    if (this.libraryTimer) clearTimeout(this.libraryTimer);
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
    if (e.type === 'roadmaps') this.scheduleLibrary();
    this.emit('event', e);
  }

  // ---------------------------------------------------------------- library (folders)

  /** Walk roadmaps/: a folder with roadmap.md is a roadmap, any other folder is a library group. */
  private async scanTree(rel: string, depth: number, load: boolean) {
    if (!rel) this.folders.clear();
    for (const name of await listDirs(path.join(this.roadmapsDir, rel))) {
      const child = rel ? `${rel}/${name}` : name;
      if (existsSync(path.join(this.roadmapsDir, child, 'roadmap.md'))) {
        if (load) await this.loadRoadmap(child, { reconcile: true });
      } else if (depth < MAX_FOLDER_DEPTH) {
        this.folders.add(child);
        await this.scanTree(child, depth + 1, load);
      }
    }
  }

  private async rescanFolders() {
    await this.scanTree('', 0, false);
  }

  /** The roadmap that contains a path under roadmaps/ (deepest match). */
  private runtimeFor(rel: string): Runtime | undefined {
    let best: Runtime | undefined;
    for (const r of this.rts.values()) {
      if ((rel === r.slug || rel.startsWith(r.slug + '/')) && (!best || r.slug.length > best.slug.length)) best = r;
    }
    return best;
  }

  library(): LibraryView {
    return { folders: [...this.folders].sort((a, b) => a.localeCompare(b, undefined, { sensitivity: 'base' })), roadmaps: this.listRoadmaps() };
  }

  /** Moving folders while the watcher holds them fails on Windows, and floods events elsewhere. */
  private async withWatcherPaused<T>(fn: () => Promise<T>): Promise<T> {
    const was = !!this.watcher;
    if (was) {
      await this.watcher!.close();
      this.watcher = undefined;
    }
    try {
      return await fn();
    } finally {
      if (was) this.startWatching();
    }
  }

  private checkFolder(folder: string): string {
    const f = (folder ?? '').replace(/\\/g, '/').replace(/^\/+|\/+$/g, '');
    if (f && !this.folders.has(f)) throw new HttpError(404, `Folder "${f}" not found.`);
    return f;
  }

  private async nameTaken(parentRel: string, name: string): Promise<boolean> {
    const siblings = await listDirs(path.join(this.roadmapsDir, parentRel));
    return siblings.some((d) => d.toLowerCase() === name.toLowerCase());
  }

  async createFolder(parent: string, name: string) {
    return this.run(async () => {
      const p = this.checkFolder(parent);
      const problem = folderNameProblem(name);
      if (problem) throw new HttpError(400, problem);
      if (p.split('/').filter(Boolean).length >= MAX_FOLDER_DEPTH) throw new HttpError(400, `Folders can be nested ${MAX_FOLDER_DEPTH} levels deep.`);
      if (await this.nameTaken(p, name.trim())) throw new HttpError(409, 'Something with that name already exists here.');
      const rel = p ? `${p}/${name.trim()}` : name.trim();
      await ensureDir(path.join(this.roadmapsDir, rel));
      this.folders.add(rel);
      this.emitEvent({ type: 'roadmaps' });
      return { path: rel };
    });
  }

  async renameFolder(folder: string, newName: string) {
    return this.run(() =>
      this.withWatcherPaused(async () => {
        const from = this.checkFolder(folder);
        if (!from) throw new HttpError(400, 'Choose a folder.');
        const problem = folderNameProblem(newName);
        if (problem) throw new HttpError(400, problem);
        const parent = path.posix.dirname(from) === '.' ? '' : path.posix.dirname(from);
        const to = parent ? `${parent}/${newName.trim()}` : newName.trim();
        if (to === from) return { path: to };
        if (to.toLowerCase() !== from.toLowerCase() && (await this.nameTaken(parent, newName.trim()))) throw new HttpError(409, 'Something with that name already exists here.');
        await moveDir(path.join(this.roadmapsDir, from), path.join(this.roadmapsDir, to));
        for (const rt of this.rts.values()) {
          if (rt.slug.startsWith(from + '/')) {
            rt.slug = to + rt.slug.slice(from.length);
            rt.dir = path.join(this.roadmapsDir, rt.slug);
          }
        }
        await this.rescanFolders();
        this.emitEvent({ type: 'roadmaps' });
        return { path: to };
      }),
    );
  }

  async deleteFolder(folder: string) {
    return this.run(async () => {
      const f = this.checkFolder(folder);
      if (!f) throw new HttpError(400, 'Choose a folder.');
      if ([...this.rts.values()].some((r) => r.slug.startsWith(f + '/'))) throw new HttpError(409, 'Move or delete the roadmaps in this folder first.');
      const hasFiles = async (dir: string): Promise<boolean> => {
        for (const e of await fs.readdir(dir, { withFileTypes: true })) {
          if (e.isFile()) return true;
          if (e.isDirectory() && (await hasFiles(path.join(dir, e.name)))) return true;
        }
        return false;
      };
      if (await hasFiles(path.join(this.roadmapsDir, f))) throw new HttpError(409, 'This folder contains files that are not roadmaps, so Waymark will not delete it. Remove them in your file manager first.');
      await fs.rm(path.join(this.roadmapsDir, f), { recursive: true, force: true, maxRetries: 5, retryDelay: 60 });
      await this.rescanFolders();
      this.emitEvent({ type: 'roadmaps' });
    });
  }

  async moveRoadmap(id: string, folder: string) {
    return this.run(() =>
      this.withWatcherPaused(async () => {
        const rt = this.rt(id);
        const target = this.checkFolder(folder);
        const current = path.posix.dirname(rt.slug) === '.' ? '' : path.posix.dirname(rt.slug);
        if (current === target) return this.toRoadmap(rt);
        const base = path.posix.basename(rt.slug);
        let name = base;
        for (let n = 2; existsSync(path.join(this.roadmapsDir, target, name)); n++) name = `${base}-${n}`;
        const slug = target ? `${target}/${name}` : name;
        await moveDir(rt.dir, path.join(this.roadmapsDir, slug));
        rt.slug = slug;
        rt.dir = path.join(this.roadmapsDir, slug);
        this.scheduleIndex(rt);
        this.emitEvent({ type: 'roadmaps' });
        this.emitEvent({ type: 'roadmap', roadmapId: id, ids: [], source: 'app' });
        return this.toRoadmap(rt);
      }),
    );
  }

  /** LIBRARY.md at the workspace root: every folder and roadmap, for agents and humans. */
  private scheduleLibrary(delay = 400) {
    if (this.libraryTimer) clearTimeout(this.libraryTimer);
    const t = setTimeout(() => {
      this.libraryTimer = undefined;
      const lib = this.library();
      const lines = [
        '<!-- Generated by Waymark. Do not edit: rewritten whenever roadmaps or folders change. -->',
        '# Library',
        '',
        'Every roadmap in this workspace. Folders under `roadmaps/` group roadmaps; a folder that contains',
        '`roadmap.md` is a roadmap. Open a roadmap\'s `INDEX.md` for its checkpoints.',
        '',
      ];
      const byFolder = new Map<string, RoadmapSummary[]>();
      for (const r of lib.roadmaps) {
        if (!byFolder.has(r.folder)) byFolder.set(r.folder, []);
        byFolder.get(r.folder)!.push(r);
      }
      const line = (r: RoadmapSummary, depth: number) =>
        `${'  '.repeat(depth)}- **${r.title}** \`${r.id}\` — roadmaps/${r.slug}/ · ${r.profile} · ${r.done}/${r.total} complete`;
      for (const r of (byFolder.get('') ?? []).sort((a, b) => a.title.localeCompare(b.title))) lines.push(line(r, 0));
      for (const f of lib.folders) {
        const depth = f.split('/').length - 1;
        lines.push(`${'  '.repeat(depth)}- 📁 ${path.posix.basename(f)}/  (roadmaps/${f}/)`);
        for (const r of (byFolder.get(f) ?? []).sort((a, b) => a.title.localeCompare(b.title))) lines.push(line(r, depth + 1));
      }
      if (!lib.roadmaps.length && !lib.folders.length) lines.push('_No roadmaps yet._');
      lines.push('');
      void writeFileAtomic(path.join(this.root, 'LIBRARY.md'), lines.join('\n')).catch((e) => console.error('[waymark] LIBRARY.md write failed:', e));
    }, delay);
    t.unref?.();
    this.libraryTimer = t;
  }

  private async writeAgentDocs() {
    const agents = path.join(this.root, 'AGENTS.md');
    const current = await readText(agents);
    if (current === null || (current.includes('<!-- waymark:agents') && !current.includes(AGENTS_VERSION_MARK))) {
      await writeFileAtomic(agents, AGENTS_MD);
    }
    const claude = path.join(this.root, 'CLAUDE.md');
    if (!(await exists(claude))) await writeFileAtomic(claude, CLAUDE_MD);
    // Pointers for agents that read their own file first; they only send the agent to AGENTS.md.
    const gemini = path.join(this.root, 'GEMINI.md');
    if (!(await exists(gemini))) await writeFileAtomic(gemini, GEMINI_MD);
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
    if (dup && dup.slug !== slug && !existsSync(path.join(dup.dir, 'roadmap.md'))) {
      this.rts.delete(dup.meta.id); // moved outside the app: forget the old location
    } else if (dup && dup.slug !== slug) {
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
      attachments: {},
    };
    await this.readLayout(rt);
    await this.scanAttachments(rt);
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
      const notes = cleanMapNotes(data.notes);
      rt.layout = { schema: 'waymark-layout/1', offsets, ...(notes.length ? { notes } : {}) };
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
    const queue = (kind: 'add' | 'change' | 'unlink' | 'dir') => (p: string) => {
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
    this.watcher.on('addDir', queue('dir'));
    this.watcher.on('unlinkDir', queue('dir'));
    this.watcher.on('error', (e) => console.error('[waymark] watcher error:', e));
  }

  /** Process outside changes to the given absolute paths now (tests, CLI). */
  async syncPaths(paths: string[]) {
    const batch = new Map<string, 'add' | 'change' | 'unlink'>();
    for (const p of paths) batch.set(p, existsSync(p) ? 'change' : 'unlink');
    return this.run(() => this.processBatch(batch));
  }

  private async processBatch(batch: Map<string, 'add' | 'change' | 'unlink' | 'dir'>) {
    const groups = new Map<string, { rt: Runtime; events: { rel: string; kind: 'add' | 'change' | 'unlink' }[] }>();
    const newDirs = new Set<string>();
    let foldersDirty = false;
    let listChanged = false;
    let reviewChanged = false;
    for (const [abs, kind] of batch) {
      const rel = toPosix(path.relative(this.roadmapsDir, abs));
      if (!rel || rel.startsWith('..')) continue;
      if (kind === 'dir') {
        foldersDirty = true;
        continue;
      }
      const rt = this.runtimeFor(rel);
      if (!rt) {
        if (path.posix.basename(rel) === 'roadmap.md' && kind !== 'unlink') newDirs.add(path.posix.dirname(rel));
        continue;
      }
      if (!groups.has(rt.meta.id)) groups.set(rt.meta.id, { rt, events: [] });
      groups.get(rt.meta.id)!.events.push({ rel: rel.slice(rt.slug.length + 1), kind });
    }
    // A roadmap whose roadmap.md is gone was deleted or moved outside the app (for example dragged
    // into another folder in Explorer/Finder). Forget the old location instead of treating every
    // missing file as a deletion; history keeps all content, and a move is picked up below.
    for (const [id, g] of groups) {
      if (!(await exists(path.join(g.rt.dir, 'roadmap.md')))) {
        this.rts.delete(id);
        groups.delete(id);
        listChanged = true;
        foldersDirty = true;
      }
    }
    for (const dir of newDirs) {
      if (dir === '.' || this.runtimeFor(`${dir}/roadmap.md`)) continue;
      const loaded = await this.loadRoadmap(dir, { reconcile: true });
      if (loaded) {
        listChanged = true;
        foldersDirty = true;
        this.scheduleIndex(loaded);
      }
    }
    for (const { rt, events } of groups.values()) {
      const changedIds = new Set<string>();
      let metaChanged = false;
      let attachmentsChanged = false;
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
        } else if (ev.rel.startsWith('attachments/')) {
          attachmentsChanged = true;
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
        if (rel.startsWith('attachments/')) {
          attachmentsChanged = true;
          continue;
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
      if (attachmentsChanged) {
        await this.scanAttachments(rt);
        this.emitEvent({ type: 'roadmap', roadmapId: rt.meta.id, ids: [], source: 'external' });
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
    if (foldersDirty) {
      await this.rescanFolders();
      listChanged = true;
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
      folder: path.posix.dirname(rt.slug) === '.' ? '' : path.posix.dirname(rt.slug),
      checkpoints: rt.cps,
      layout: rt.layout,
      files: rt.files,
      attachments: rt.attachments,
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
          folder: path.posix.dirname(rt.slug) === '.' ? '' : path.posix.dirname(rt.slug),
          color: roadmapColor(rt.meta),
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

  async updateMeta(roadmapId: string, set: Partial<Pick<RoadmapMeta, 'title' | 'description' | 'overview' | 'profile' | 'agentAccess' | 'color'>>, source: HistorySource = 'app') {
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

  /** Save manual positions and/or sticky notes; whatever is left out stays as it is. */
  async setLayout(roadmapId: string, input: { offsets?: RoadmapLayout['offsets']; notes?: unknown[] }) {
    return this.run(async () => {
      const rt = this.rt(roadmapId);
      let clean: RoadmapLayout['offsets'] = rt.layout.offsets;
      if (input.offsets) {
        clean = {};
        for (const [id, o] of Object.entries(input.offsets)) {
          if (rt.cps[id] && Number.isFinite(o.dx) && Number.isFinite(o.dy) && (Math.abs(o.dx) > 0.5 || Math.abs(o.dy) > 0.5)) {
            clean[id] = { dx: Math.round(o.dx), dy: Math.round(o.dy) };
          }
        }
      }
      const notes = input.notes ? cleanMapNotes(input.notes) : (rt.layout.notes ?? []);
      rt.layout = { schema: 'waymark-layout/1', offsets: clean, ...(notes.length ? { notes } : {}) };
      const text = JSON.stringify(rt.layout, null, 2) + '\n';
      rt.hashes.set('layout.json', hashText(text));
      await writeFileAtomic(path.join(rt.dir, 'layout.json'), text);
      this.emitEvent({ type: 'roadmap', roadmapId, ids: [], source: 'app' });
      return rt.layout;
    });
  }

  async createRoadmap(input: { title: string; profile: 'general' | 'learning'; description?: string; overview?: string; template?: string; folder?: string; color?: RoadmapMeta['color'] }) {
    const meta: RoadmapMeta = {
      id: newId('rm'),
      title: input.title.trim() || 'Untitled roadmap',
      profile: input.profile,
      description: input.description?.trim() ?? '',
      agentAccess: 'review',
      created: new Date().toISOString(),
      rev: 0,
      overview: input.overview ?? '',
      ...(input.color ? { color: input.color } : {}),
    };
    const folder = this.checkFolder(input.folder ?? '');
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
    return this.createFromParts(meta, cps, layout, 'app', folder);
  }

  private async createFromParts(meta: RoadmapMeta, cps: Checkpoint[], layout: RoadmapLayout, source: HistorySource, folder = '') {
    return this.run(async () => {
      const base = slugify(meta.title, 'roadmap');
      const at = (name: string) => (folder ? `${folder}/${name}` : name);
      let slug = at(base);
      for (let n = 2; existsSync(path.join(this.roadmapsDir, slug)); n++) slug = at(`${base}-${n}`);
      while (this.rts.has(meta.id)) meta.id = newId('rm');
      const dir = path.join(this.roadmapsDir, slug);
      await ensureDir(path.join(dir, 'checkpoints'));
      await ensureDir(path.join(dir, 'proposals'));
      const rt: Runtime = { dir, slug, meta, cps: {}, files: {}, fileIds: new Map(), hashes: new Map(), problems: new Map(), layout, attachments: {} };
      this.rts.set(meta.id, rt);
      const metaText = await this.writeMeta(rt);
      this.recordMeta(rt, null, metaText, source);
      const profile = getProfile(meta.profile);
      for (const cp of cps) {
        const c = { ...cp, status: normaliseStatus(cp.status, profile), rev: 0 };
        if (profile.understanding && !c.understanding) c.understanding = 'not-yet';
        rt.cps[c.id] = c;
      }
      const all = Object.values(rt.cps);
      for (const cp of all) if (cp.parent && !rt.cps[cp.parent]) cp.parent = null;
      // Several files at a time: each one waits for the disk (fsync), and one by one a 1,000-checkpoint
      // import took ~17 s on Windows. File names are still chosen one at a time (before each write starts).
      await eachLimit(all, 16, async (cp) => {
        const text = await this.writeCheckpoint(rt, cp);
        this.history.record({ roadmapId: meta.id, cp: cp.id, title: cp.title, source, kind: 'create', before: null, after: text });
      });
      if (Object.keys(layout.offsets).length || layout.notes?.length) {
        const text = JSON.stringify(layout, null, 2) + '\n';
        rt.hashes.set('layout.json', hashText(text));
        await writeFileAtomic(path.join(dir, 'layout.json'), text);
      }
      this.scheduleIndex(rt, 0);
      this.emitEvent({ type: 'roadmaps' });
      return this.toRoadmap(rt);
    });
  }

  async importBundle(data: unknown, opts: { keepIds?: boolean; titleSuffix?: string; folder?: string } = {}) {
    const parsed = parseBundle(data);
    if (!parsed.ok) throw new HttpError(400, parsed.error);
    const v = parsed.value;
    const meta: RoadmapMeta = {
      ...v.meta,
      id: v.meta.id && !this.rts.has(v.meta.id) ? v.meta.id : newId('rm'),
      title: v.meta.title + (opts.titleSuffix ?? ''),
      rev: 0,
    };
    const rm = await this.createFromParts(meta, v.checkpoints, v.layout, 'import', this.checkFolder(opts.folder ?? ''));
    return { roadmap: rm, warnings: v.warnings };
  }

  exportRoadmap(id: string): Bundle {
    return toBundle(this.toRoadmap(this.rt(id)));
  }

  /**
   * Full backup: roadmap.waymark.json (all data) plus every attached file under attachments/, except
   * video and audio (they can be hundreds of MB; they stay in the workspace folder). Already-compressed
   * files (images, PDFs) are stored as they are.
   */
  async exportZip(id: string): Promise<Uint8Array> {
    const rt = this.rt(id);
    const files: Record<string, Uint8Array | [Uint8Array, { level: 0 }]> = {
      'roadmap.waymark.json': strToU8(JSON.stringify(toBundle(this.toRoadmap(rt)), null, 2)),
    };
    for (const list of Object.values(rt.attachments)) {
      for (const a of list) {
        if (isPlayable(a.name)) continue;
        try {
          files[a.path] = [new Uint8Array(await fs.readFile(path.join(rt.dir, ...a.path.split('/')))), { level: 0 }];
        } catch {
          /* removed meanwhile */
        }
      }
    }
    return zipSync(files, { level: 6 });
  }

  /** Restore a full backup (.waymark.zip) as a new roadmap, attachments included. */
  async importZip(data: Uint8Array, opts: { folder?: string } = {}) {
    let total = 0;
    let entries: Record<string, Uint8Array>;
    try {
      entries = unzipSync(data, {
        filter: (f) => {
          total += f.originalSize;
          if (total > 2 * 1024 * 1024 * 1024) throw new HttpError(413, 'This backup unpacks to more than 2 GB.');
          return f.name.endsWith('.waymark.json') || f.name.startsWith('attachments/');
        },
      });
    } catch (e) {
      if (e instanceof HttpError) throw e;
      throw new HttpError(400, 'This is not a readable .zip file.');
    }
    const names = Object.keys(entries);
    const bundleName = names.find((n) => n === 'roadmap.waymark.json') ?? names.find((n) => n.endsWith('.waymark.json'));
    if (!bundleName) throw new HttpError(400, 'This .zip has no roadmap.waymark.json, so it is not a Waymark backup.');
    let bundle: unknown;
    try {
      bundle = JSON.parse(strFromU8(entries[bundleName]!));
    } catch {
      throw new HttpError(400, 'The roadmap data inside this backup is not valid JSON.');
    }
    const res = await this.importBundle(bundle, { folder: opts.folder });
    const rt = this.rt(res.roadmap.meta.id);
    const warnings = [...res.warnings];
    let restored = 0;
    await this.run(async () => {
      for (const name of names) {
        // Only attachments/<checkpoint-id>/<file> with an allowed type, for a checkpoint that exists.
        const parts = name.split('/');
        if (parts.length !== 3 || parts[0] !== 'attachments' || !parts[2]) {
          if (name.startsWith('attachments/') && !name.endsWith('/')) warnings.push(`Skipped ${name}`);
          continue;
        }
        const [, cp, file] = parts as [string, string, string];
        const clean = safeFileName(file);
        const ext = clean.split('.').pop()?.toLowerCase() ?? '';
        const bytes = entries[name]!;
        if (!rt.cps[cp] || clean !== file || !ATTACHMENT_TYPES[ext] || bytes.byteLength > maxBytesFor(file)) {
          warnings.push(`Skipped ${name}`);
          continue;
        }
        await writeBinaryAtomic(path.join(rt.dir, 'attachments', cp, clean), bytes);
        restored++;
      }
      await this.scanAttachments(rt);
    });
    this.emitEvent({ type: 'roadmap', roadmapId: rt.meta.id, ids: [], source: 'import' });
    return { roadmap: this.toRoadmap(rt), warnings, attachments: restored };
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
        roadmapDir: `roadmaps/${rt.slug.replace(/\//g, '__')}-${stamp()}`,
        originalPath: rt.slug,
      };
      await this.history.flushAll();
      this.rts.delete(id);
      await this.withWatcherPaused(() => moveDir(rt.dir, path.join(this.metaDir, 'trash', entry.roadmapDir!)));
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
    if (entry.attachment) {
      return this.run(async () => {
        const rt = this.rt(entry.roadmapId);
        const wanted = entry.attachment!.path;
        const dirRel = path.posix.dirname(wanted);
        const name = this.uniqueAttachmentName(rt, dirRel, path.posix.basename(wanted));
        await ensureDir(path.join(rt.dir, dirRel));
        await moveFile(path.join(this.metaDir, 'trash', entry.attachment!.stored), path.join(rt.dir, dirRel, name));
        await removeFile(file);
        await this.scanAttachments(rt);
        this.emitEvent({ type: 'roadmap', roadmapId: rt.meta.id, ids: [], source: 'app' });
        return { roadmapId: rt.meta.id, restored: [`${dirRel}/${name}`] };
      });
    }
    if (entry.roadmapDir) {
      await this.run(async () => {
        const from = path.join(this.metaDir, 'trash', entry.roadmapDir!);
        const original = entry.originalPath ?? path.basename(entry.roadmapDir!).replace(/-\d{4}-\d{2}-\d{2}T[\d-]+Z$/, '');
        const parent = path.posix.dirname(original) !== '.' && this.folders.has(path.posix.dirname(original)) ? path.posix.dirname(original) : '';
        const base = path.posix.basename(original);
        const at = (name: string) => (parent ? `${parent}/${name}` : name);
        let slug = at(base);
        for (let n = 2; existsSync(path.join(this.roadmapsDir, slug)); n++) slug = at(`${base}-${n}`);
        await this.withWatcherPaused(() => moveDir(from, path.join(this.roadmapsDir, slug)));
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

  // ---------------------------------------------------------------- attachments

  private async scanAttachments(rt: Runtime) {
    const out: Record<string, Attachment[]> = {};
    const root = path.join(rt.dir, 'attachments');
    for (const cp of await listDirs(root)) {
      const items: Attachment[] = [];
      for (const name of await listFiles(path.join(root, cp), (n) => !n.startsWith('.') && !n.endsWith('.tmp'))) {
        try {
          const st = await fs.stat(path.join(root, cp, name));
          const ext = name.split('.').pop()?.toLowerCase() ?? '';
          items.push({ name, path: `attachments/${cp}/${name}`, size: st.size, modified: st.mtime.toISOString(), kind: ATTACHMENT_TYPES[ext]?.kind ?? 'other' });
        } catch {
          /* vanished meanwhile */
        }
      }
      if (items.length) out[cp] = items.sort((a, b) => a.modified.localeCompare(b.modified));
    }
    rt.attachments = out;
  }

  private uniqueAttachmentName(rt: Runtime, dirRel: string, name: string): string {
    const dot = name.lastIndexOf('.');
    const stem = dot > 0 ? name.slice(0, dot) : name;
    const ext = dot > 0 ? name.slice(dot) : '';
    let candidate = name;
    for (let n = 2; existsSync(path.join(rt.dir, dirRel, candidate)); n++) candidate = `${stem}-${n}${ext}`;
    return candidate;
  }

  /** Save an image or PDF for a checkpoint. Returns where it was stored. */
  async addAttachment(roadmapId: string, checkpointId: string, fileName: string, data: Uint8Array) {
    return this.run(async () => {
      const rt = this.rt(roadmapId);
      if (!rt.cps[checkpointId]) throw new HttpError(404, 'Checkpoint not found.');
      const clean = safeFileName(fileName);
      const ext = clean.split('.').pop()?.toLowerCase() ?? '';
      if (!ATTACHMENT_TYPES[ext]) throw new HttpError(415, `You can attach ${ATTACHABLE_DESCRIPTION}.`);
      if (data.byteLength > maxBytesFor(clean)) throw new HttpError(413, `Files like this can be up to ${maxBytesFor(clean) / 1024 / 1024} MB.`);
      if (data.byteLength === 0) throw new HttpError(400, 'That file is empty.');
      const dirRel = `attachments/${checkpointId}`;
      await ensureDir(path.join(rt.dir, dirRel));
      const name = this.uniqueAttachmentName(rt, dirRel, clean);
      await writeBinaryAtomic(path.join(rt.dir, dirRel, name), data);
      await this.scanAttachments(rt);
      this.emitEvent({ type: 'roadmap', roadmapId, ids: [checkpointId], source: 'app' });
      const rel = `${dirRel}/${name}`;
      return { name, path: rel, markdownPath: `../${rel}`, kind: ATTACHMENT_TYPES[ext]!.kind };
    });
  }

  /**
   * Save a file sent by the page, streamed straight to disk: videos can be hundreds of MB, so they are
   * never held in memory. Checked against the type list and its size limit while it arrives.
   */
  async addAttachmentStream(roadmapId: string, checkpointId: string, fileName: string, body: ReadableStream<Uint8Array> | null) {
    const rt = this.rt(roadmapId);
    if (!rt.cps[checkpointId]) throw new HttpError(404, 'Checkpoint not found.');
    const clean = safeFileName(fileName);
    const ext = clean.split('.').pop()?.toLowerCase() ?? '';
    if (!ATTACHMENT_TYPES[ext]) throw new HttpError(415, `You can attach ${ATTACHABLE_DESCRIPTION}.`);
    if (!body) throw new HttpError(400, 'That file is empty.');
    const limit = maxBytesFor(clean);
    const dirRel = `attachments/${checkpointId}`;
    await ensureDir(path.join(rt.dir, dirRel));
    const tmp = path.join(rt.dir, dirRel, `.${randomBytes(6).toString('hex')}.upload`);
    let size = 0;
    try {
      const count = new Transform({
        transform(chunk: Buffer, _enc, done) {
          size += chunk.length;
          done(size > limit ? new HttpError(413, `Files like this can be up to ${limit / 1024 / 1024} MB.`) : null, chunk);
        },
      });
      await pipeline(Readable.fromWeb(body as import('node:stream/web').ReadableStream<Uint8Array>), count, createWriteStream(tmp));
      if (size === 0) throw new HttpError(400, 'That file is empty.');
      return await this.run(async () => {
        if (!rt.cps[checkpointId]) throw new HttpError(404, 'Checkpoint not found.');
        const name = this.uniqueAttachmentName(rt, dirRel, clean);
        await moveFile(tmp, path.join(rt.dir, dirRel, name));
        await this.scanAttachments(rt);
        this.emitEvent({ type: 'roadmap', roadmapId, ids: [checkpointId], source: 'app' });
        const rel = `${dirRel}/${name}`;
        return { name, path: rel, markdownPath: `../${rel}`, kind: ATTACHMENT_TYPES[ext]!.kind, size };
      });
    } finally {
      await fs.rm(tmp, { force: true }).catch(() => {});
    }
  }

  /** Absolute path of a file inside a roadmap's attachments folder, or an error for anything else. */
  attachmentFile(roadmapId: string, rel: string): string {
    const rt = this.rt(roadmapId);
    const clean = path.posix.normalize(rel.replace(/\\/g, '/')).replace(/^\/+/, '');
    if (!clean.startsWith('attachments/') || clean.split('/').includes('..')) throw new HttpError(403, 'Only attached files can be opened.');
    const absPath = path.resolve(rt.dir, ...clean.split('/'));
    if (!absPath.startsWith(path.resolve(rt.dir, 'attachments') + path.sep)) throw new HttpError(403, 'Only attached files can be opened.');
    return absPath;
  }

  /**
   * For exports: an attached image as a data URI (so a saved web page or PDF contains it), or a link
   * that opens other attachments through this server. Returns null for anything outside attachments.
   */
  exportAsset(roadmapId: string, rel: string): { src: string; embedded: boolean } | null {
    let absPath: string;
    try {
      absPath = this.attachmentFile(roadmapId, rel);
    } catch {
      return null;
    }
    const ext = absPath.split('.').pop()?.toLowerCase() ?? '';
    const type = ATTACHMENT_TYPES[ext];
    const url = `/api/roadmaps/${encodeURIComponent(roadmapId)}/files/${rel.split('/').map(encodeURIComponent).join('/')}`;
    if (type?.kind === 'image' && ext !== 'svg') {
      try {
        const data = readFileSync(absPath);
        if (data.byteLength <= 8 * 1024 * 1024) return { src: `data:${type.mime};base64,${data.toString('base64')}`, embedded: true };
      } catch {
        return null;
      }
    }
    return existsSync(absPath) ? { src: url, embedded: false } : null;
  }

  /** Move an attached file to Trash (restorable from the Trash dialog). */
  async removeAttachment(roadmapId: string, rel: string) {
    return this.run(async () => {
      const rt = this.rt(roadmapId);
      const absPath = this.attachmentFile(roadmapId, rel);
      if (!existsSync(absPath)) throw new HttpError(404, 'That file is already gone.');
      const id = newId('tr');
      const stored = `attachments/${id}-${path.basename(absPath)}`;
      await moveFile(absPath, path.join(this.metaDir, 'trash', stored));
      const entry: TrashEntry = {
        id,
        roadmapId,
        roadmapTitle: rt.meta.title,
        deletedAt: new Date().toISOString(),
        title: path.basename(absPath),
        count: 1,
        checkpoints: [],
        files: {},
        attachment: { path: toPosix(path.relative(rt.dir, absPath)), stored },
      };
      await writeFileAtomic(path.join(this.metaDir, 'trash', `${id}.json`), JSON.stringify(entry, null, 2));
      await this.scanAttachments(rt);
      this.emitEvent({ type: 'roadmap', roadmapId, ids: [], source: 'app' });
      return { trashId: id };
    });
  }

  async purgeTrash(trashId: string) {
    const file = path.join(this.metaDir, 'trash', `${path.basename(trashId)}.json`);
    const text = await readText(file);
    if (text) {
      const entry = JSON.parse(text) as TrashEntry;
      if (entry.roadmapDir) await fs.rm(path.join(this.metaDir, 'trash', entry.roadmapDir), { recursive: true, force: true });
      if (entry.attachment) await removeFile(path.join(this.metaDir, 'trash', entry.attachment.stored));
    }
    await removeFile(file);
  }

  /** Overwrite a damaged file with the last good version the app holds (the damaged text is kept aside). */
  async resolveProblem(roadmapId: string, rel: string) {
    return this.run(async () => {
      const rt = this.rt(roadmapId);
      const abs = path.join(rt.dir, rel);
      const broken = await readText(abs);
      if (broken !== null) await writeFileAtomic(path.join(this.metaDir, 'broken', `${rt.slug.replace(/\//g, '__')}-${stamp()}-${path.basename(rel)}`), broken);
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
      // Full backups: data and attachments in one file per roadmap (folders kept as sub-folders).
      await writeBinaryAtomic(path.join(dir, ...`${rt.slug}.waymark.zip`.split('/')), await this.exportZip(rt.meta.id));
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

/** A file name that is safe on Windows, macOS and Linux, keeping its extension. */
export function safeFileName(name: string): string {
  const base = (name.split(/[\\/]/).pop() ?? 'file').normalize('NFC');
  let clean = base.replace(/[<>:"|?*\u0000-\u001f]/g, '-').replace(/\s+/g, ' ').trim().replace(/^\.+/, '').replace(/[. ]+$/, '');
  if (!clean || /^(con|prn|aux|nul|com[1-9]|lpt[1-9])(\..*)?$/i.test(clean)) clean = `file-${clean || 'attachment'}`;
  if (clean.length > 100) {
    const dot = clean.lastIndexOf('.');
    const ext = dot > 0 ? clean.slice(dot) : '';
    clean = clean.slice(0, 100 - ext.length) + ext;
  }
  return clean;
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
        // Appends (e.g. session notes) only add text below what is there.
        for (const [key, text] of Object.entries(normaliseSections(op.append ?? undefined).sections)) {
          if (!text?.trim()) continue;
          const field = `sections.${key}` as FieldPath;
          const before = getField(cur, field);
          changes.push({ field, before, after: appendText(before, text), yours: isHumanField(field) && !APPENDABLE_FIELDS.includes(field) });
        }
        if (changes.some((c) => c.yours)) warnings.push('Touches something only you normally change.');
        if (cur.approved && changes.some((c) => !isHumanField(c.field))) warnings.push('You approved this checkpoint.');
        const appendsOnly = Object.keys(op.set).length === 0;
        return {
          index,
          op: 'update',
          title: cur.title,
          detail: appendsOnly ? `Adds to ${changes.map((c) => fieldLabel(c.field)).join(', ')}` : `${changes.length} field(s)`,
          changes,
          warnings,
          valid: true,
          risky: changes.some((c) => c.yours) || (cur.approved && !appendsOnly),
        };
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
