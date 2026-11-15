import { describe, expect, it } from 'vitest';
import { parseCheckpoint, serializeCheckpoint, parseSections } from '../src/shared/checkpointFile';
import { PROFILES } from '../src/shared/profiles';
import { applyOps, parseChangeset } from '../src/shared/ops';
import { computeProgress } from '../src/shared/tree';
import { guardExternalEdit, guardNewCheckpoint } from '../src/shared/guard';
import { parseBundle, toBundle } from '../src/shared/bundle';
import type { Checkpoint, RoadmapMeta } from '../src/shared/model';

const learning = PROFILES.learning;
const meta: RoadmapMeta = { id: 'rm-test0001', title: 'T', profile: 'learning', description: '', agentAccess: 'review', created: '2026-01-01', rev: 0, overview: '' };

const base = (o: Partial<Checkpoint> & { id: string }): Checkpoint => ({
  title: o.id,
  parent: null,
  order: 1,
  summary: '',
  status: 'not-started',
  understanding: 'not-yet',
  approved: false,
  optional: false,
  archived: false,
  agentAccess: null,
  prerequisites: [],
  completion: '',
  resources: [],
  sections: {},
  rev: 0,
  ...o,
});

describe('checkpoint files', () => {
  it('round-trips without loss, including code fences that contain "#" lines', () => {
    const cp = base({
      id: 'cp-aaaa0001',
      title: 'Gradients: a "quoted" title',
      summary: 'Line one: with colon',
      resources: [{ title: 'Video', url: 'https://example.com/v', kind: 'video', start: '4:10' }],
      sections: {
        content: 'Intro\n\n```python\n# Notes\nprint(1)\n```\n\n## Sub heading\n\n| a | b |\n|---|---|\n| 1 | 2 |',
        notes: '- [ ] task\n- [x] done',
      },
      extra: { tags: ['x', 'y'] },
      rev: 3,
    });
    const text = serializeCheckpoint(cp, learning);
    const parsed = parseCheckpoint(text, learning);
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    expect(parsed.value.checkpoint).toEqual(cp);
    expect(serializeCheckpoint(parsed.value.checkpoint, learning)).toBe(text);
  });

  it('keeps text before the first heading as content and demotes colliding headings', () => {
    const s = parseSections('Loose intro\n\n# My notes\nmine\n# Content\nbody');
    expect(s.content).toBe('Loose intro\n\nbody');
    expect(s.notes).toBe('mine');
    const cp = base({ id: 'cp-aaaa0002', sections: { content: 'x\n# My notes\ny' } });
    const back = parseCheckpoint(serializeCheckpoint(cp, learning), learning);
    expect(back.ok && back.value.checkpoint.sections.content).toBe('x\n## My notes\ny');
  });

  it('reports broken files instead of guessing', () => {
    expect(parseCheckpoint('no front matter', learning).ok).toBe(false);
    expect(parseCheckpoint('---\nid: [unclosed\n---\n', learning).ok).toBe(false);
    const r = parseCheckpoint('---\ntitle: No id\nstatus: done\n---\n', learning);
    expect(r.ok && r.value.missingId).toBe(true);
    expect(r.ok && r.value.checkpoint.status).toBe('complete');
  });
});

describe('change engine', () => {
  const cps = () => ({
    a: base({ id: 'a', order: 1 }),
    b: base({ id: 'b', order: 2 }),
    c: base({ id: 'c', parent: 'a', order: 1 }),
  });

  it('adds, moves, links and deletes with validation', () => {
    let r = applyOps(meta, cps(), [{ op: 'add', id: 'cp-new00001', parent: 'a', title: 'New', status: 'complete' }], { source: 'proposal' });
    expect(r.results[0]!.ok).toBe(true);
    expect(r.checkpoints['cp-new00001']!.status).toBe('not-started'); // proposals can't set progress on add
    expect(r.checkpoints['cp-new00001']!.order).toBe(2);
    r = applyOps(meta, r.checkpoints, [{ op: 'move', id: 'a', parent: 'c' }], { source: 'app' });
    expect(r.results[0]!.ok).toBe(false); // cycle
    r = applyOps(meta, r.checkpoints, [{ op: 'move', id: 'b', parent: 'a', after: null }], { source: 'app' });
    expect(r.checkpoints.b!.parent).toBe('a');
    expect(r.checkpoints.b!.order).toBeLessThan(r.checkpoints.c!.order);
    r = applyOps(meta, r.checkpoints, [{ op: 'link', id: 'c', prerequisite: 'b' }, { op: 'link', id: 'b', prerequisite: 'c' }], { source: 'app' });
    expect(r.results[1]!.ok).toBe(false); // circular prerequisite
    r = applyOps(meta, r.checkpoints, [{ op: 'delete', id: 'a' }], { source: 'app' });
    expect(Object.keys(r.checkpoints)).toEqual([]);
    expect(r.deleted.size).toBe(4);
  });

  it('detects field conflicts with compare-and-set and bumps rev', () => {
    const start = { x: base({ id: 'x', sections: { content: 'agent v2' }, rev: 4 }) };
    const r = applyOps(meta, start, [{ op: 'update', id: 'x', set: { sections: { content: 'mine', notes: 'n' } }, expect: { sections: { content: 'agent v1', notes: '' } } }], { source: 'app' });
    expect(r.results[0]!.conflicts?.map((c) => c.field)).toEqual(['sections.content']);
    expect(r.checkpoints.x!.sections.content).toBe('agent v2');
    expect(r.checkpoints.x!.sections.notes).toBe('n');
    expect(r.checkpoints.x!.rev).toBe(5);
  });

  it('parses agent changesets leniently but validates every change', () => {
    const cs = parseChangeset({ title: 'T', changes: [{ op: 'add', title: 'X', sections: { 'My notes': 'hi' } }, { op: 'explode' }] });
    expect(cs.ok).toBe(true);
    if (!cs.ok) return;
    expect(cs.value.changes).toHaveLength(1);
    expect(cs.value.invalid).toHaveLength(1);
  });
});

describe('progress', () => {
  it('counts every level, ignores optional and archived, never derives the parent', () => {
    const m = {
      p: base({ id: 'p', status: 'not-started' }),
      c1: base({ id: 'c1', parent: 'p', status: 'complete', understanding: 'can-explain' }),
      c2: base({ id: 'c2', parent: 'p', status: 'complete' }),
      g: base({ id: 'g', parent: 'c2', status: 'learning' }),
      o: base({ id: 'o', parent: 'p', status: 'not-started', optional: true }),
      z: base({ id: 'z', parent: 'p', status: 'not-started', archived: true }),
    };
    const prog = computeProgress(m, meta).get('p')!;
    expect(prog).toMatchObject({ total: 3, done: 2, active: 1, understood: 1, optionalTotal: 1 });
    expect(m.p.status).toBe('not-started');
  });
});

describe('guard rules', () => {
  it('applies shared edits, holds human-owned fields and approved content', () => {
    const existing = base({ id: 'x', rev: 2, summary: 'old', sections: { content: 'c', notes: 'my notes' } });
    const incoming = { ...existing, summary: 'new', status: 'complete', sections: { content: 'c2', notes: 'rewritten' } };
    const d = guardExternalEdit({ meta, cps: { x: existing }, existing, incoming, base: null });
    expect(d.accepted.map((c) => c.field).sort()).toEqual(['sections.content', 'summary']);
    expect(d.held.map((c) => c.field).sort()).toEqual(['sections.notes', 'status']);
    expect(d.next.sections.notes).toBe('my notes');

    const approved = { ...existing, approved: true };
    const d2 = guardExternalEdit({ meta, cps: { x: approved }, existing: approved, incoming: { ...approved, summary: 'z' }, base: null });
    expect(d2.held[0]).toMatchObject({ field: 'summary', reason: 'approved' });
  });

  it('merges stale writes field by field and holds real conflicts', () => {
    const v1 = base({ id: 'x', rev: 1, summary: 's1', title: 't1', sections: { content: 'c1' } });
    // the human changed the summary after the agent read v1
    const current = { ...v1, rev: 2, summary: 's-human' };
    // the agent writes from v1: changes title and summary
    const incoming = { ...v1, title: 't-agent', summary: 's-agent' };
    const d = guardExternalEdit({ meta, cps: { x: current }, existing: current, incoming, base: v1 });
    expect(d.stale).toBe(true);
    expect(d.accepted.map((c) => c.field)).toEqual(['title']);
    expect(d.held).toMatchObject([{ field: 'summary', reason: 'conflict', after: 's-agent' }]);
    expect(d.next.summary).toBe('s-human');
  });

  it('strips human-owned values from checkpoints created outside the app', () => {
    const { next, held } = guardNewCheckpoint(meta, base({ id: 'n', status: 'complete', approved: true, sections: { content: 'ok', notes: 'x' } }));
    expect(next.status).toBe('not-started');
    expect(next.approved).toBe(false);
    expect(next.sections).toEqual({ content: 'ok' });
    expect(held.map((h) => h.field).sort()).toEqual(['approved', 'sections.notes', 'status']);
    // a plain new file without human fields holds nothing
    expect(guardNewCheckpoint(meta, base({ id: 'm', understanding: null, sections: { content: 'x' } })).held).toEqual([]);
  });
});

describe('bundles', () => {
  it('export → import is lossless and rejects malformed input', () => {
    const rm = {
      meta,
      slug: 't',
      folder: '',
      checkpoints: { a: base({ id: 'cp-a0000001', sections: { content: 'x' } }), b: base({ id: 'cp-b0000001', parent: 'cp-a0000001', status: 'complete' }) },
      layout: { schema: 'waymark-layout/1' as const, offsets: { 'cp-a0000001': { dx: 10, dy: -5 } } },
      files: {},
      problems: [],
    };
    rm.checkpoints = { 'cp-a0000001': rm.checkpoints.a, 'cp-b0000001': rm.checkpoints.b } as never;
    const parsed = parseBundle(JSON.parse(JSON.stringify(toBundle(rm))));
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    expect(parsed.value.checkpoints).toEqual(Object.values(rm.checkpoints));
    expect(parsed.value.layout.offsets).toEqual(rm.layout.offsets);
    expect(parseBundle({ format: 'nope' }).ok).toBe(false);
    expect(parseBundle({ format: 'waymark-bundle', schemaVersion: 99, roadmap: { title: 'x' }, checkpoints: [] }).ok).toBe(false);
  });
});
