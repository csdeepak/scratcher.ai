// Integration tests against a real temporary folder: the same code paths the app uses when an
// agent edits files.

import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { mkdtempSync, readFileSync, writeFileSync, rmSync, existsSync, unlinkSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { Workspace } from '../src/server/workspace';

const EXAMPLE = path.resolve('examples/learn-git.waymark.json');
let dir: string;
let ws: Workspace;
const RM = 'rm-example1';

const file = (rel: string) => path.join(dir, 'roadmaps', 'example-learn-git-fundamentals', rel);
const read = (rel: string) => readFileSync(file(rel), 'utf8');
const edit = async (rel: string, fn: (s: string) => string) => {
  writeFileSync(file(rel), fn(read(rel)));
  await ws.syncPaths([file(rel)]);
};

beforeEach(async () => {
  dir = mkdtempSync(path.join(tmpdir(), 'waymark-test-'));
  ws = new Workspace(dir);
  await ws.init({ watch: false, seedExample: EXAMPLE });
});
afterEach(async () => {
  await ws.close();
  rmSync(dir, { recursive: true, force: true });
});

describe('workspace', () => {
  it('seeds the example, writes AGENTS.md, CLAUDE.md, GEMINI.md and an INDEX', async () => {
    expect(existsSync(path.join(dir, 'AGENTS.md'))).toBe(true);
    expect(readFileSync(path.join(dir, 'CLAUDE.md'), 'utf8')).toContain('@AGENTS.md');
    expect(readFileSync(path.join(dir, 'GEMINI.md'), 'utf8')).toContain('@./AGENTS.md');
    const rm = ws.getRoadmap(RM);
    expect(Object.keys(rm.checkpoints)).toHaveLength(14);
    expect(rm.files['cp-gitbranch']).toBe('checkpoints/branching-and-merging.md');
    await new Promise((r) => setTimeout(r, 50));
  });

  it('renaming and moving keep notes and the id', async () => {
    await ws.applyAppOps(RM, [{ op: 'update', id: 'cp-gitcommit', set: { title: 'Commits & history (renamed)' } }]);
    await ws.applyAppOps(RM, [{ op: 'move', id: 'cp-gitcommit', parent: 'cp-gitwhy001' }]);
    const rm = ws.getRoadmap(RM);
    const cp = rm.checkpoints['cp-gitcommit']!;
    expect(cp.parent).toBe('cp-gitwhy001');
    expect(cp.sections.notes).toContain('git restore');
    expect(rm.files['cp-gitcommit']).toBe('checkpoints/commits-history-renamed.md');
    expect(existsSync(file('checkpoints/commits-and-history.md'))).toBe(false);
    expect(read('checkpoints/commits-history-renamed.md')).toContain('id: cp-gitcommit');
  });

  it('applies an outside edit live and lists it for review; revert restores it', async () => {
    await edit('checkpoints/branching-and-merging.md', (s) => s.replace('A branch is just a movable pointer', 'AGENT EDIT. A branch is a pointer'));
    expect(ws.getRoadmap(RM).checkpoints['cp-gitbranch']!.sections.content).toContain('AGENT EDIT');
    const item = ws.listReview().find((i) => i.checkpointId === 'cp-gitbranch')!;
    expect(item.kind).toBe('changed');
    await ws.reviewAction(item.id, 'revert');
    expect(ws.getRoadmap(RM).checkpoints['cp-gitbranch']!.sections.content).not.toContain('AGENT EDIT');
    expect(read('checkpoints/branching-and-merging.md')).not.toContain('AGENT EDIT');
  });

  it('holds edits to your notes and status, and keeps your version in the file', async () => {
    await edit('checkpoints/commits-and-history.md', (s) => s.replace('status: learning', 'status: complete').replace('Still confusing', 'AGENT REWROTE'));
    const cp = ws.getRoadmap(RM).checkpoints['cp-gitcommit']!;
    expect(cp.status).toBe('learning');
    expect(cp.sections.notes).toContain('Still confusing');
    const text = read('checkpoints/commits-and-history.md');
    expect(text).toContain('status: learning');
    expect(text).not.toContain('AGENT REWROTE');
    const held = ws.listReview().find((i) => i.kind === 'held')!;
    expect(held.changes.map((c) => c.field).sort()).toEqual(['sections.notes', 'status']);
    await ws.reviewAction(held.id, 'apply', ['status']);
    expect(ws.getRoadmap(RM).checkpoints['cp-gitcommit']!.status).toBe('complete');
  });

  it('never silently overwrites a newer human change (stale rev)', async () => {
    const stale = read('checkpoints/branching-and-merging.md');
    await ws.applyAppOps(RM, [{ op: 'update', id: 'cp-gitbranch', set: { summary: 'HUMAN SUMMARY' } }]);
    await ws.history.flushAll();
    // the agent writes its old copy with its own summary + title change
    writeFileSync(
      file('checkpoints/branching-and-merging.md'),
      stale.replace('Work on parallel lines of development and combine them.', 'AGENT SUMMARY').replace('title: Branching and merging', 'title: Branching & merging'),
    );
    await ws.syncPaths([file('checkpoints/branching-and-merging.md')]);
    const cp = ws.getRoadmap(RM).checkpoints['cp-gitbranch']!;
    expect(cp.summary).toBe('HUMAN SUMMARY');
    expect(cp.title).toBe('Branching & merging');
    const conflict = ws.listReview().find((i) => i.kind === 'held' && i.checkpointId === 'cp-gitbranch')!;
    expect(conflict.changes[0]).toMatchObject({ field: 'summary', reason: 'conflict', after: 'AGENT SUMMARY' });
    expect(read('checkpoints/branching-and-merging.md')).toContain('HUMAN SUMMARY');
  });

  it('new files from an agent become drafts; deleting a file with your notes is held', async () => {
    writeFileSync(file('checkpoints/stash.md'), '---\nid: cp-stash001\ntitle: Stash work in progress\nparent: cp-gitcommit\nstatus: complete\n---\n# Content\nUse `git stash`.\n');
    await ws.syncPaths([file('checkpoints/stash.md')]);
    const cp = ws.getRoadmap(RM).checkpoints['cp-stash001']!;
    expect(cp).toMatchObject({ status: 'not-started', approved: false, parent: 'cp-gitcommit' });
    expect(cp.order).toBeGreaterThan(3);

    unlinkSync(file('checkpoints/why-version-control.md'));
    await ws.syncPaths([file('checkpoints/why-version-control.md')]);
    expect(existsSync(file('checkpoints/why-version-control.md'))).toBe(true);
    expect(ws.listReview().some((i) => i.kind === 'held-delete')).toBe(true);

    unlinkSync(file('checkpoints/stash.md'));
    await ws.syncPaths([file('checkpoints/stash.md')]);
    expect(ws.getRoadmap(RM).checkpoints['cp-stash001']).toBeUndefined();
  });

  it('reports broken files and refuses to overwrite them', async () => {
    writeFileSync(file('checkpoints/rebase.md'), '---\nid: cp-gitrebas1\ntitle: [broken\n---\n');
    await ws.syncPaths([file('checkpoints/rebase.md')]);
    const rm = ws.getRoadmap(RM);
    expect(rm.problems[0]!.file).toBe('checkpoints/rebase.md');
    expect(rm.checkpoints['cp-gitrebas1']!.title).toBe('Rebase');
    await expect(ws.applyAppOps(RM, [{ op: 'update', id: 'cp-gitrebas1', set: { summary: 'x' } }])).rejects.toThrow(/errors/);
    await ws.resolveProblem(RM, 'checkpoints/rebase.md');
    expect(read('checkpoints/rebase.md')).toContain('title: Rebase');
  });

  it('previews and partially applies a proposal', async () => {
    mkdirSync(file('proposals'), { recursive: true });
    writeFileSync(
      file('proposals/split.yaml'),
      'title: Reorganise\nchanges:\n  - op: add\n    id: cp-tags0001\n    parent: cp-gitcommit\n    title: Tags\n  - op: delete\n    id: cp-gitwhy001\n  - op: move\n    id: cp-gitrebas1\n    parent: null\n',
    );
    const [p] = await ws.listProposals();
    expect(p!.previews.map((x) => x.op)).toEqual(['add', 'delete', 'move']);
    expect(p!.previews[1]!.warnings.join(' ')).toMatch(/your notes/);
    await ws.applyProposal(RM, 'split.yaml', [0, 2]);
    const rm = ws.getRoadmap(RM);
    expect(rm.checkpoints['cp-tags0001']).toBeDefined();
    expect(rm.checkpoints['cp-gitwhy001']).toBeDefined();
    expect(rm.checkpoints['cp-gitrebas1']!.parent).toBeNull();
    expect(existsSync(file('proposals/split.yaml'))).toBe(false);
  });

  it('restores deleted checkpoints from trash and old versions from history', async () => {
    const res = await ws.applyAppOps(RM, [{ op: 'delete', id: 'cp-gitbranch' }]);
    expect(ws.getRoadmap(RM).checkpoints['cp-gitmerge1']).toBeUndefined();
    await ws.restoreTrash(res.trashId!);
    expect(ws.getRoadmap(RM).checkpoints['cp-gitmerge1']!.parent).toBe('cp-gitbranch');

    await ws.applyAppOps(RM, [{ op: 'update', id: 'cp-gitsetup1', set: { summary: 'oops' } }]);
    await ws.history.flushAll();
    const [latest] = await ws.history.forCheckpoint(RM, 'cp-gitsetup1');
    await ws.restoreVersion(RM, latest!.id, 'before');
    expect(ws.getRoadmap(RM).checkpoints['cp-gitsetup1']!.summary).toBe('Install Git and set your identity and editor.');
  });

  it('notices edits made while the app was closed', async () => {
    await ws.close();
    writeFileSync(
      file('checkpoints/reading-history-log-and-diff.md'),
      read('checkpoints/reading-history-log-and-diff.md').replace('status: learning', 'status: complete').replace('Find when', 'OFFLINE EDIT. Find when'),
    );
    ws = new Workspace(dir);
    await ws.init({ watch: false });
    const cp = ws.getRoadmap(RM).checkpoints['cp-gitlog001']!;
    expect(cp.summary).toContain('OFFLINE EDIT');
    expect(cp.status).toBe('learning');
    expect(ws.listReview().map((i) => i.kind).sort()).toEqual(['changed', 'held']);
  });

  it('exports and re-imports an identical roadmap', async () => {
    const bundle = ws.exportRoadmap(RM);
    const { roadmap } = await ws.importBundle(JSON.parse(JSON.stringify(bundle)));
    expect(roadmap.meta.id).not.toBe(RM);
    const a = Object.values(ws.getRoadmap(RM).checkpoints).map(({ rev: _r, updated: _u, ...c }) => c);
    const b = Object.values(roadmap.checkpoints).map(({ rev: _r, updated: _u, ...c }) => c);
    expect(b.sort((x, y) => x.id.localeCompare(y.id))).toEqual(a.sort((x, y) => x.id.localeCompare(y.id)));
  });
});
