import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { Workspace } from '../src/server/workspace';
import { cleanMapNotes } from '../src/shared/model';

const EXAMPLE = path.resolve('examples/learn-git.waymark.json');
const RM = 'rm-example1';
let dir: string;
let ws: Workspace;

beforeEach(async () => {
  dir = mkdtempSync(path.join(tmpdir(), 'waymark-map-'));
  ws = new Workspace(dir);
  await ws.init({ watch: false, seedExample: EXAMPLE });
});
afterEach(async () => {
  await ws.close();
  rmSync(dir, { recursive: true, force: true });
});

describe('sticky notes on the map', () => {
  it('cleans what it is given: colours, sizes, text length, ids', () => {
    const notes = cleanMapNotes([
      { id: 'note-a', text: 'Hi', color: 'neon', anchor: 'cp-gitbranch', dx: 10.6, dy: -4, w: 5, h: 99999 },
      { id: 'note-a', text: 'x'.repeat(6000), color: 'pink', anchor: 'cp-missing', dx: 'far', dy: null },
      { id: '../evil', text: 3 },
      'not a note',
    ]);
    expect(notes).toHaveLength(3);
    expect(notes[0]).toEqual({ id: 'note-a', text: 'Hi', color: 'yellow', anchor: 'cp-gitbranch', dx: 11, dy: -4, w: 120, h: 1200 });
    expect(notes[1]!.id).not.toBe('note-a'); // duplicate id renamed
    expect(notes[1]!.text).toHaveLength(5000);
    expect(notes[1]).toMatchObject({ color: 'pink', dx: 0, dy: 0 });
    expect(notes[2]!.id).not.toContain('/');
    expect(cleanMapNotes([{ anchor: 'cp-missing' }], (id) => id === 'cp-gitbranch')[0]!.anchor).toBeNull();
  });

  it('saves notes in layout.json next to manual positions, and keeps each when only the other changes', async () => {
    await ws.setLayout(RM, { offsets: { 'cp-gitbranch': { dx: 40, dy: -12 } } });
    await ws.setLayout(RM, { notes: [{ id: 'note-1', text: 'Exam on Friday', color: 'blue', anchor: 'cp-gitbranch', dx: 280, dy: 0, w: 208, h: 120 }] });
    const file = JSON.parse(readFileSync(path.join(dir, 'roadmaps', 'example-learn-git-fundamentals', 'layout.json'), 'utf8'));
    expect(file.offsets).toEqual({ 'cp-gitbranch': { dx: 40, dy: -12 } });
    expect(file.notes[0]).toMatchObject({ id: 'note-1', text: 'Exam on Friday', color: 'blue', anchor: 'cp-gitbranch' });

    await ws.setLayout(RM, { offsets: {} });
    expect(ws.getRoadmap(RM).layout.notes).toHaveLength(1);

    // survives a restart
    await ws.close();
    ws = new Workspace(dir);
    await ws.init({ watch: false });
    expect(ws.getRoadmap(RM).layout.notes![0]!.text).toBe('Exam on Friday');

    await ws.setLayout(RM, { notes: [] });
    expect(ws.getRoadmap(RM).layout.notes).toBeUndefined();
  });

  it('travels with exports and full backups; anchors to checkpoints that are not in the file are dropped', async () => {
    await ws.setLayout(RM, {
      notes: [
        { id: 'note-1', text: 'Kept with its checkpoint', color: 'green', anchor: 'cp-gitbranch', dx: 280, dy: 0, w: 208, h: 120 },
        { id: 'note-2', text: 'Points at nothing', color: 'yellow', anchor: 'cp-gone0000', dx: 5, dy: 5, w: 208, h: 120 },
      ],
    });
    const { roadmap } = await ws.importZip(await ws.exportZip(RM));
    const notes = roadmap.layout.notes!;
    expect(notes.map((n) => n.text)).toEqual(['Kept with its checkpoint', 'Points at nothing']);
    expect(notes[0]!.anchor).toBe('cp-gitbranch');
    expect(notes[1]!.anchor).toBeNull();
  });
});
