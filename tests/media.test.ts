// Media (docs/MEDIA.md): which links play inside Waymark and from when, page titles for resources,
// attaching video/audio/documents (streamed, type- and size-checked), range requests for seeking,
// and backups that leave large media out.

import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { unzipSync } from 'fflate';
import { Workspace } from '../src/server/workspace';
import { createApp } from '../src/server/app';
import { readPageMeta } from '../src/server/linkInfo';
import { attachmentKind, formatTimestamp, guessResourceKind, maxBytesFor, parseEmbed, parseTimestamp } from '../src/shared/media';

describe('video links', () => {
  it('recognises YouTube links in all their shapes, with start times', () => {
    const id = 'dQw4w9WgXcQ';
    for (const url of [
      `https://www.youtube.com/watch?v=${id}`,
      `https://youtu.be/${id}`,
      `https://m.youtube.com/watch?v=${id}&list=x`,
      `https://www.youtube.com/shorts/${id}`,
      `https://www.youtube.com/embed/${id}`,
      `https://www.youtube.com/live/${id}`,
    ]) {
      expect(parseEmbed(url)).toMatchObject({ provider: 'youtube', id });
    }
    expect(parseEmbed(`https://youtu.be/${id}?t=750`)?.start).toBe(750);
    expect(parseEmbed(`https://www.youtube.com/watch?v=${id}&t=12m30s`)?.start).toBe(750);
    expect(parseEmbed(`https://www.youtube.com/watch?v=${id}#t=1h2m3s`)?.start).toBe(3723);
    // A resource's own start time wins over the link's.
    const e = parseEmbed(`https://youtu.be/${id}?t=10`, '12:30')!;
    expect(e.start).toBe(750);
    expect(e.embedUrl).toBe(`https://www.youtube-nocookie.com/embed/${id}?autoplay=1&rel=0&start=750`);
    expect(e.watchUrl).toBe(`https://www.youtube.com/watch?v=${id}&t=750s`);
  });

  it('recognises Vimeo and Loom, and ignores everything else', () => {
    expect(parseEmbed('https://vimeo.com/76979871')).toMatchObject({ provider: 'vimeo', id: '76979871', embedUrl: 'https://player.vimeo.com/video/76979871?autoplay=1&dnt=1' });
    expect(parseEmbed('https://vimeo.com/76979871/abc123def0#t=90')?.embedUrl).toBe('https://player.vimeo.com/video/76979871?autoplay=1&dnt=1&h=abc123def0#t=90s');
    expect(parseEmbed('https://www.loom.com/share/0123456789abcdef0123456789abcdef')).toMatchObject({ provider: 'loom' });
    for (const url of ['https://www.youtube.com/watch?v=short', 'https://example.com/watch?v=dQw4w9WgXcQ', 'javascript:alert(1)', 'not a url', 'https://www.youtube.com/@channel']) {
      expect(parseEmbed(url)).toBeNull();
    }
  });

  it('reads and writes times the way people type them', () => {
    expect([parseTimestamp('750'), parseTimestamp('750s'), parseTimestamp('12:30'), parseTimestamp('1:02:03'), parseTimestamp('2m'), parseTimestamp('1h')]).toEqual([750, 750, 750, 3723, 120, 3600]);
    expect([parseTimestamp(''), parseTimestamp('soon'), parseTimestamp(null)]).toEqual([null, null, null]);
    expect([formatTimestamp(750), formatTimestamp(3723), formatTimestamp(5)]).toEqual(['12:30', '1:02:03', '0:05']);
  });

  it('guesses a resource type from its address', () => {
    expect(guessResourceKind('https://youtu.be/dQw4w9WgXcQ')).toBe('video');
    expect(guessResourceKind('https://www.coursera.org/learn/machine-learning')).toBe('course');
    expect(guessResourceKind('https://www.kaggle.com/learn/pandas')).toBe('course');
    expect(guessResourceKind('https://docs.python.org/3/tutorial/')).toBe('docs');
    expect(guessResourceKind('https://github.com/ageron/handson-ml3')).toBe('tool');
    expect(guessResourceKind('https://arxiv.org/abs/1706.03762')).toBe('article');
    expect(guessResourceKind('https://example.com/')).toBeNull();
  });
});

describe('page titles for resources', () => {
  it('prefers Open Graph, then Twitter, then <title>, and decodes entities', () => {
    expect(readPageMeta('<html><head><title>Plain &amp; simple</title><meta property="og:site_name" content="Site"></head></html>')).toEqual({ title: 'Plain & simple', site: 'Site' });
    expect(readPageMeta('<title>Fallback</title><meta name="twitter:title" content="From Twitter"><meta property="og:title" content="  From  OG ">')).toEqual({ title: 'From OG' });
    expect(readPageMeta('<p>no head here</p>')).toEqual({});
  });
});

describe('attaching media and documents', () => {
  const EXAMPLE = path.resolve('examples/learn-git.waymark.json');
  const RM = 'rm-example1';
  const CP = 'cp-gitbranch';
  let dir: string;
  let ws: Workspace;
  beforeEach(async () => {
    dir = mkdtempSync(path.join(tmpdir(), 'waymark-media-'));
    ws = new Workspace(dir);
    await ws.init({ watch: false, seedExample: EXAMPLE });
  });
  afterEach(async () => {
    await ws.close();
    rmSync(dir, { recursive: true, force: true });
  });
  const stream = (bytes: Uint8Array) => new Blob([bytes as BlobPart]).stream();
  const bytes = (n: number) => Uint8Array.from({ length: n }, (_, i) => i % 251);

  it('knows each kind and its size limit', () => {
    expect([attachmentKind('a.MP4'), attachmentKind('b.m4a'), attachmentKind('c.ipynb'), attachmentKind('d.pdf'), attachmentKind('e.exe'), attachmentKind('f.html')]).toEqual(['video', 'audio', 'other', 'pdf', null, null]);
    expect(maxBytesFor('lecture.mp4')).toBe(500 * 1024 * 1024);
    expect(maxBytesFor('notes.docx')).toBe(50 * 1024 * 1024);
  });

  it('streams video, audio and documents to disk, and refuses programs, web pages and empty files', async () => {
    const v = await ws.addAttachmentStream(RM, CP, 'Lecture 1.mp4', stream(bytes(70_000)));
    expect(v).toMatchObject({ path: `attachments/${CP}/Lecture 1.mp4`, kind: 'video', size: 70_000 });
    expect((await ws.addAttachmentStream(RM, CP, 'voice memo.m4a', stream(bytes(10)))).kind).toBe('audio');
    expect((await ws.addAttachmentStream(RM, CP, 'model.ipynb', stream(bytes(10)))).kind).toBe('other');
    await expect(ws.addAttachmentStream(RM, CP, 'setup.exe', stream(bytes(10)))).rejects.toThrow(/You can attach/);
    await expect(ws.addAttachmentStream(RM, CP, 'page.html', stream(bytes(10)))).rejects.toThrow(/You can attach/);
    await expect(ws.addAttachmentStream(RM, CP, 'empty.mp3', stream(new Uint8Array(0)))).rejects.toThrow(/empty/);
    const listed = ws.getRoadmap(RM).attachments[CP]!.map((a) => a.name).sort();
    expect(listed).toEqual(['Lecture 1.mp4', 'model.ipynb', 'voice memo.m4a']);
  });

  it('serves byte ranges so players can seek, and documents only as downloads', async () => {
    await ws.addAttachmentStream(RM, CP, 'clip.webm', stream(bytes(1000)));
    await ws.addAttachmentStream(RM, CP, 'data.csv', stream(Uint8Array.from(Buffer.from('a,b\n1,2\n'))));
    const app = createApp(ws);
    const url = `http://127.0.0.1/api/roadmaps/${RM}/files/attachments/${CP}/clip.webm`;
    const whole = await app.request(url);
    expect(whole.status).toBe(200);
    expect(whole.headers.get('accept-ranges')).toBe('bytes');
    expect((await whole.arrayBuffer()).byteLength).toBe(1000);
    const part = await app.request(url, { headers: { Range: 'bytes=100-199' } });
    expect(part.status).toBe(206);
    expect(part.headers.get('content-range')).toBe('bytes 100-199/1000');
    expect(new Uint8Array(await part.arrayBuffer())[0]).toBe(100 % 251);
    const tail = await app.request(url, { headers: { Range: 'bytes=-10' } });
    expect(tail.headers.get('content-range')).toBe('bytes 990-999/1000');
    expect((await app.request(url, { headers: { Range: 'bytes=5000-' } })).status).toBe(416);
    const csv = await app.request(`http://127.0.0.1/api/roadmaps/${RM}/files/attachments/${CP}/data.csv`);
    expect(csv.headers.get('content-disposition')).toMatch(/^attachment;/);
    expect(csv.headers.get('content-security-policy')).toMatch(/sandbox/);
  });

  it('leaves video and audio out of backups, keeps documents', async () => {
    await ws.addAttachmentStream(RM, CP, 'big lecture.mp4', stream(bytes(5000)));
    await ws.addAttachmentStream(RM, CP, 'slides.pptx', stream(bytes(50)));
    const names = Object.keys(unzipSync(await ws.exportZip(RM)));
    expect(names).toContain(`attachments/${CP}/slides.pptx`);
    expect(names.some((n) => n.endsWith('.mp4'))).toBe(false);
  });
});
