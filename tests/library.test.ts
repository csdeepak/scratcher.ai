import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, renameSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { Workspace } from '../src/server/workspace';
import { toHtml, toMarkdown, toOpml } from '../src/shared/exporters';
import { fromOutline, outlineFromMarkdown } from '../src/shared/outlineImport';

const EXAMPLE = path.resolve('examples/learn-git.waymark.json');
const RM = 'rm-example1';
const SLUG = 'example-learn-git-fundamentals';
let dir: string;
let ws: Workspace;
const abs = (rel: string) => path.join(dir, 'roadmaps', rel);

beforeEach(async () => {
  dir = mkdtempSync(path.join(tmpdir(), 'waymark-lib-'));
  ws = new Workspace(dir);
  await ws.init({ watch: false, seedExample: EXAMPLE });
});
afterEach(async () => {
  await ws.close();
  rmSync(dir, { recursive: true, force: true });
});

describe('library folders', () => {
  it('creates, nests, renames and deletes folders and moves roadmaps between them', async () => {
    await ws.createFolder('', 'Learning');
    await ws.createFolder('Learning', 'Semester 5');
    await ws.moveRoadmap(RM, 'Learning/Semester 5');
    expect(ws.getRoadmap(RM)).toMatchObject({ slug: `Learning/Semester 5/${SLUG}`, folder: 'Learning/Semester 5' });
    expect(existsSync(abs(`Learning/Semester 5/${SLUG}/roadmap.md`))).toBe(true);

    // editing still writes to the new place
    await ws.applyAppOps(RM, [{ op: 'update', id: 'cp-gitsetup1', set: { summary: 'Edited after the move' } }]);
    expect(readFileSync(abs(`Learning/Semester 5/${SLUG}/checkpoints/install-and-configure-git.md`), 'utf8')).toContain('Edited after the move');

    await expect(ws.deleteFolder('Learning')).rejects.toThrow(/Move or delete/);
    await ws.renameFolder('Learning', 'Study');
    expect(ws.getRoadmap(RM).slug).toBe(`Study/Semester 5/${SLUG}`);
    await ws.moveRoadmap(RM, '');
    await ws.deleteFolder('Study/Semester 5');
    expect(ws.library().folders).toEqual(['Study']);

    await expect(ws.createFolder('', 'a/b')).rejects.toThrow(/can't contain/);
    await expect(ws.createFolder('', 'CON')).rejects.toThrow(/reserved/);
    await expect(ws.createFolder('', 'study')).rejects.toThrow(/already exists/);
  });

  it('notices a roadmap folder moved in the file manager and keeps everything', async () => {
    mkdirSync(abs('Projects'));
    renameSync(abs(SLUG), abs(`Projects/${SLUG}`));
    await ws.syncPaths([abs(`${SLUG}/roadmap.md`), abs(`${SLUG}/checkpoints/why-version-control.md`), abs(`Projects/${SLUG}/roadmap.md`)]);
    const rm = ws.getRoadmap(RM);
    expect(rm.folder).toBe('Projects');
    expect(rm.checkpoints['cp-gitwhy001']!.sections.notes).toContain('snapshots');
    expect(ws.listReview()).toEqual([]); // not mistaken for deletions
    expect(existsSync(abs(SLUG))).toBe(false); // nothing restored at the old place

    await ws.close();
    ws = new Workspace(dir);
    await ws.init({ watch: false });
    expect(ws.library().folders).toEqual(['Projects']);
    expect(ws.getRoadmap(RM).folder).toBe('Projects');
  });

  it('restores a deleted roadmap into its original folder and writes LIBRARY.md', async () => {
    await ws.createFolder('', 'Archive me');
    await ws.moveRoadmap(RM, 'Archive me');
    await ws.deleteRoadmap(RM);
    expect(ws.library().roadmaps).toEqual([]);
    const [entry] = await ws.listTrash();
    await ws.restoreTrash(entry!.id);
    expect(ws.getRoadmap(RM).folder).toBe('Archive me');
    await new Promise((r) => setTimeout(r, 500));
    const library = readFileSync(path.join(dir, 'LIBRARY.md'), 'utf8');
    expect(library).toContain('📁 Archive me/');
    expect(library).toContain(`roadmaps/Archive me/${SLUG}/`);
  });
});

describe('export formats', () => {
  it('writes Markdown, print-ready HTML and OPML, with options', () => {
    const rm = ws.getRoadmap(RM);
    const md = toMarkdown(rm);
    expect(md).toContain('# Example: Learn Git fundamentals');
    expect(md).toContain('- [x] 1. Why version control');
    expect(md).toContain('**My notes**');
    expect(md).toContain('```bash');
    expect(toMarkdown(rm, { personal: false })).not.toContain('**My notes**');
    const branch = toMarkdown(rm, { branch: 'cp-gitbranch' });
    expect(branch).toContain('1.3. Rebase');
    expect(branch).not.toContain('Why version control');

    const html = toHtml(rm, { print: true });
    expect(html).toContain('<h1>Example: Learn Git fundamentals</h1>');
    expect(html).toContain('window.print()');
    expect(html).toContain('<table>');
    expect(html).not.toMatch(/<script>(?!window\.addEventListener)/);

    const opml = toOpml(rm);
    expect(opml).toContain('<opml version="2.0">');
    expect(opml).toContain('text="Branching and merging"');
  });
});

describe('outline import', () => {
  const syllabus = `# AI Syllabus

Intro text for the whole plan.

## Maths foundations
- Linear algebra
  - Vectors
- [x] Calculus

## Machine learning

Some explanation paragraph.

### Supervised learning
`;

  it('turns headings and lists into checkpoints', () => {
    const o = outlineFromMarkdown(syllabus);
    expect(o.title).toBe('AI Syllabus');
    expect(o.overview).toBe('Intro text for the whole plan.');
    expect(o.items.map((i) => i.title)).toEqual(['Maths foundations', 'Machine learning']);
    expect(o.items[0]!.children.map((c) => c.title)).toEqual(['Linear algebra', 'Calculus']);
    expect(o.items[0]!.children[0]!.children[0]!.title).toBe('Vectors');
    expect(o.items[0]!.children[1]!.done).toBe(true);
    expect(o.items[1]!.content).toBe('Some explanation paragraph.');
    expect(o.items[1]!.children[0]!.title).toBe('Supervised learning');
  });

  it('imports into a folder as a normal roadmap', async () => {
    await ws.createFolder('', 'Learning');
    const o = outlineFromMarkdown(syllabus);
    const { roadmap } = await ws.importBundle(fromOutline({ title: o.title!, overview: o.overview, profile: 'learning', items: o.items }), { folder: 'Learning' });
    expect(roadmap.folder).toBe('Learning');
    expect(Object.keys(roadmap.checkpoints)).toHaveLength(6);
    const calc = Object.values(roadmap.checkpoints).find((c) => c.title === 'Calculus')!;
    expect(calc.status).toBe('complete');
  });
});
