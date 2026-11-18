import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { existsSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { Workspace, safeFileName } from '../src/server/workspace';
import { toHtml } from '../src/shared/exporters';

const EXAMPLE = path.resolve('examples/learn-git.waymark.json');
const RM = 'rm-example1';
const CP = 'cp-gitbranch';
// 1×1 transparent PNG
const PNG = Uint8Array.from(Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=', 'base64'));
let dir: string;
let ws: Workspace;

beforeEach(async () => {
  dir = mkdtempSync(path.join(tmpdir(), 'waymark-att-'));
  ws = new Workspace(dir);
  await ws.init({ watch: false, seedExample: EXAMPLE });
});
afterEach(async () => {
  await ws.close();
  rmSync(dir, { recursive: true, force: true });
});

describe('attachments', () => {
  it('stores images and PDFs per checkpoint with safe, unique names', async () => {
    const a = await ws.addAttachment(RM, CP, 'Branch diagram.png', PNG);
    expect(a).toMatchObject({ path: `attachments/${CP}/Branch diagram.png`, markdownPath: `../attachments/${CP}/Branch diagram.png`, kind: 'image' });
    const b = await ws.addAttachment(RM, CP, 'Branch diagram.png', PNG);
    expect(b.name).toBe('Branch diagram-2.png');
    const pdf = await ws.addAttachment(RM, CP, 'notes:week<1>.pdf', new TextEncoder().encode('%PDF-1.4 test'));
    expect(pdf.name).toBe('notes-week-1-.pdf');
    expect(ws.getRoadmap(RM).attachments[CP]!.map((x) => x.kind)).toEqual(['image', 'image', 'pdf']);
    await expect(ws.addAttachment(RM, CP, 'run.exe', PNG)).rejects.toThrow(/You can attach/);
    await expect(ws.addAttachment(RM, 'cp-nope', 'x.png', PNG)).rejects.toThrow(/Checkpoint not found/);
    expect(safeFileName('CON.png')).toBe('file-CON.png');
  });

  it('only ever serves files from the attachments folder', async () => {
    await ws.addAttachment(RM, CP, 'ok.png', PNG);
    expect(existsSync(ws.attachmentFile(RM, `attachments/${CP}/ok.png`))).toBe(true);
    for (const bad of ['roadmap.md', '../roadmap.md', 'attachments/../roadmap.md', `attachments/${CP}/../../roadmap.md`, '/etc/passwd']) {
      expect(() => ws.attachmentFile(RM, bad)).toThrow(/Only attached files/);
    }
  });

  it('deletes to Trash and restores', async () => {
    const a = await ws.addAttachment(RM, CP, 'keep.png', PNG);
    const { trashId } = await ws.removeAttachment(RM, a.path);
    expect(ws.getRoadmap(RM).attachments[CP]).toBeUndefined();
    await ws.restoreTrash(trashId);
    expect(ws.getRoadmap(RM).attachments[CP]![0]!.name).toBe('keep.png');
  });

  it('embeds attached images in the HTML/PDF export', async () => {
    const a = await ws.addAttachment(RM, CP, 'diagram.png', PNG);
    await ws.applyAppOps(RM, [{ op: 'update', id: CP, set: { sections: { content: `See ![diagram](${a.markdownPath}) and [slides](../attachments/${CP}/missing.pdf).` } } }]);
    const html = toHtml(ws.getRoadmap(RM), { asset: (rel) => ws.exportAsset(RM, rel) });
    expect(html).toContain('src="data:image/png;base64,');
    expect(html).toContain(`href="../attachments/${CP}/missing.pdf"`); // missing files keep their link
  });
});

describe('full backups (.waymark.zip)', () => {
  it('round-trips data and attachments, and ignores anything else in the zip', async () => {
    const { unzipSync, zipSync, strToU8 } = await import('fflate');
    await ws.addAttachment(RM, CP, 'diagram.png', PNG);
    const zip = await ws.exportZip(RM);
    expect(Object.keys(unzipSync(zip)).sort()).toEqual(['attachments/cp-gitbranch/diagram.png', 'roadmap.waymark.json']);

    // add hostile or irrelevant entries to the same backup
    const entries = unzipSync(zip);
    entries['attachments/cp-gitbranch/../../evil.png'] = PNG;
    entries['attachments/cp-unknown/x.png'] = PNG;
    entries['attachments/cp-gitbranch/run.exe'] = strToU8('MZ');
    entries['roadmap.md'] = strToU8('not used');
    const res = await ws.importZip(zipSync(entries));
    expect(res.attachments).toBe(1);
    expect(res.warnings.filter((w) => w.startsWith('Skipped'))).toHaveLength(3);
    const copy = ws.getRoadmap(res.roadmap.meta.id);
    expect(copy.meta.id).not.toBe(RM);
    expect(copy.attachments[CP]!.map((a) => a.name)).toEqual(['diagram.png']);
    expect(existsSync(path.join(dir, 'roadmaps', copy.slug, 'attachments', CP, 'diagram.png'))).toBe(true);
    expect(existsSync(path.join(dir, 'roadmaps', 'evil.png'))).toBe(false);

    await expect(ws.importZip(new Uint8Array([1, 2, 3]))).rejects.toThrow(/not a readable/);
  });

  it('writes daily backups as full zips', async () => {
    await ws.addAttachment(RM, CP, 'diagram.png', PNG);
    const { dir: rel } = await ws.backupAll();
    const { unzipSync } = await import('fflate');
    const { readFileSync, readdirSync } = await import('node:fs');
    const [file] = readdirSync(path.join(dir, rel));
    expect(file).toMatch(/\.waymark\.zip$/);
    expect(Object.keys(unzipSync(readFileSync(path.join(dir, rel, file!))))).toContain(`attachments/${CP}/diagram.png`);
  });
});
