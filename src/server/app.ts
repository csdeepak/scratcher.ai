// HTTP API (localhost only). The UI uses it; scripts and agents with a shell can use it too.
// Documented in docs/DATA-FORMAT.md ("Local HTTP API").

import { Hono, type Context } from 'hono';
import { streamSSE } from 'hono/streaming';
import { z } from 'zod';
import { HttpError, type Workspace, type WsEvent } from './workspace';
import { opSchema, formatZodError, type AnyOp } from '../shared/ops';
import { buildBrief } from './brief';
import { parseCheckpoint } from '../shared/checkpointFile';
import { getProfile } from '../shared/profiles';
import { ATTACHMENT_TYPES, MAX_ATTACHMENT_BYTES, MAX_MAP_NOTES, type FieldPath } from '../shared/model';
import { readFile } from 'node:fs/promises';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import { slugify } from '../shared/ids';
import { toHtml, toMarkdown, toOpml } from '../shared/exporters';
import { fromOutline, outlineFromMarkdown } from '../shared/outlineImport';

const katexDist = path.join(path.dirname(createRequire(import.meta.url).resolve('katex/package.json')), 'dist');
let katexInlineCache: string | null = null;
/** KaTeX's stylesheet with its WOFF2 fonts embedded (about 300 KB), for self-contained pages. */
function katexInline(): string {
  if (katexInlineCache) return katexInlineCache;
  const css = readFileSync(path.join(katexDist, 'katex.min.css'), 'utf8').replace(
    /src:url\(fonts\/([^)]+?)\.woff2\) format\("woff2"\)(?:,url\([^)]+\) format\("[^"]+"\))*/g,
    (_m, name: string) => `src:url(data:font/woff2;base64,${readFileSync(path.join(katexDist, 'fonts', `${name}.woff2`)).toString('base64')}) format("woff2")`,
  );
  katexInlineCache = `<style>${css}</style>`;
  return katexInlineCache;
}

export function createApp(ws: Workspace) {
  const app = new Hono();

  app.onError((err, c) => {
    if (err instanceof HttpError) return c.json({ error: err.message }, err.status as 400);
    console.error('[waymark]', err);
    return c.json({ error: err instanceof Error ? err.message : String(err) }, 500);
  });

  // Only local pages and local tools may call the API: block other websites (Origin) and
  // DNS-rebinding tricks (Host).
  const LOCAL = /^(localhost|127\.0\.0\.1|\[::1\])(:\d+)?$/;
  app.use('/api/*', async (c, next) => {
    const host = c.req.header('host') ?? '';
    if (host && !LOCAL.test(host)) return c.json({ error: 'Waymark only answers on localhost.' }, 403);
    const origin = c.req.header('origin');
    if (origin && !/^https?:\/\/(localhost|127\.0\.0\.1|\[::1\])(:\d+)?$/.test(origin)) {
      return c.json({ error: 'Cross-origin requests are not allowed.' }, 403);
    }
    await next();
  });

  const body = async <T>(c: Context, schema: z.ZodType<T>): Promise<T> => {
    let data: unknown;
    try {
      data = await c.req.json();
    } catch {
      throw new HttpError(400, 'Expected a JSON body.');
    }
    const r = schema.safeParse(data);
    if (!r.success) throw new HttpError(400, formatZodError(r.error));
    return r.data;
  };

  app.get('/api/state', (c) =>
    c.json({
      workspace: ws.root,
      roadmaps: ws.listRoadmaps(),
      problems: ws.workspaceProblems,
      reviewCount: ws.listReview().length,
    }),
  );

  app.get('/api/roadmaps', (c) => c.json(ws.listRoadmaps()));

  // Library: folders that group roadmaps (real folders under roadmaps/)
  app.get('/api/library', (c) => c.json(ws.library()));

  app.post('/api/folders', async (c) => {
    const b = await body(c, z.object({ parent: z.string().default(''), name: z.string() }));
    return c.json(await ws.createFolder(b.parent, b.name), 201);
  });

  app.patch('/api/folders', async (c) => {
    const b = await body(c, z.object({ path: z.string().min(1), name: z.string() }));
    return c.json(await ws.renameFolder(b.path, b.name));
  });

  app.delete('/api/folders', async (c) => {
    await ws.deleteFolder(c.req.query('path') ?? '');
    return c.json({ ok: true });
  });

  app.post('/api/roadmaps/:id/move', async (c) => {
    const b = await body(c, z.object({ folder: z.string().default('') }));
    return c.json(await ws.moveRoadmap(c.req.param('id'), b.folder));
  });

  app.post('/api/roadmaps', async (c) => {
    const b = await body(
      c,
      z.object({
        title: z.string().min(1),
        profile: z.enum(['general', 'learning']).default('general'),
        description: z.string().optional(),
        overview: z.string().optional(),
        template: z.string().optional(),
        folder: z.string().optional(),
        color: z.enum(['yellow', 'orange', 'red', 'pink', 'purple', 'blue', 'teal', 'green', 'gray']).optional(),
      }),
    );
    const rm = await ws.createRoadmap(b);
    return c.json(rm, 201);
  });

  app.get('/api/roadmaps/:id', (c) => c.json(ws.getRoadmap(c.req.param('id'))));

  app.patch('/api/roadmaps/:id', async (c) => {
    const b = await body(
      c,
      z.object({
        title: z.string().min(1).optional(),
        description: z.string().optional(),
        overview: z.string().optional(),
        profile: z.enum(['general', 'learning']).optional(),
        agentAccess: z.enum(['review', 'direct']).optional(),
        color: z.enum(['yellow', 'orange', 'red', 'pink', 'purple', 'blue', 'teal', 'green', 'gray']).optional(),
      }),
    );
    return c.json(await ws.updateMeta(c.req.param('id'), b));
  });

  app.delete('/api/roadmaps/:id', async (c) => {
    await ws.deleteRoadmap(c.req.param('id'));
    return c.json({ ok: true });
  });

  app.post('/api/roadmaps/:id/ops', async (c) => {
    const b = await body(c, z.object({ ops: z.array(opSchema).min(1) }));
    return c.json(await ws.applyAppOps(c.req.param('id'), b.ops as AnyOp[], 'app'));
  });

  app.put('/api/roadmaps/:id/layout', async (c) => {
    const b = await body(
      c,
      z.object({
        offsets: z.record(z.string(), z.object({ dx: z.number(), dy: z.number() })).optional(),
        notes: z.array(z.unknown()).max(MAX_MAP_NOTES).optional(),
      }),
    );
    return c.json(await ws.setLayout(c.req.param('id'), b));
  });

  app.get('/api/roadmaps/:id/history', async (c) => {
    const id = c.req.param('id');
    const cp = c.req.query('cp');
    const entries = cp ? await ws.history.forCheckpoint(id, cp) : (await ws.history.read(id)).slice(-300).reverse();
    return c.json(entries);
  });

  app.post('/api/roadmaps/:id/history/restore', async (c) => {
    const b = await body(c, z.object({ entryId: z.string(), which: z.enum(['before', 'after']) }));
    return c.json(await ws.restoreVersion(c.req.param('id'), b.entryId, b.which));
  });

  app.post('/api/roadmaps/:id/problems/resolve', async (c) => {
    const b = await body(c, z.object({ file: z.string() }));
    await ws.resolveProblem(c.req.param('id'), b.file);
    return c.json({ ok: true });
  });

  // Export: format = json (backup) | md | html (print → PDF) | opml
  app.get('/api/roadmaps/:id/export', async (c) => {
    const id = c.req.param('id');
    const rm = ws.getRoadmap(id);
    const format = (c.req.query('format') ?? 'json').toLowerCase();
    const branch = c.req.query('branch') || null;
    const opts = { branch, personal: c.req.query('personal') !== '0', archived: c.req.query('archived') === '1' };
    const base = (branch && rm.checkpoints[branch] ? `${path.posix.basename(rm.slug)}-${slugify(rm.checkpoints[branch]!.title)}` : path.posix.basename(rm.slug)) || 'roadmap';
    // RFC 6266: an ASCII name for old clients, the real (possibly non-Latin) name in filename*.
    const attach = (ext: string) =>
      c.header('Content-Disposition', `attachment; filename="${base.replace(/[^\x20-\x7e]|"/g, '_')}.${ext}"; filename*=UTF-8''${encodeURIComponent(`${base}.${ext}`)}`);
    switch (format) {
      case 'json':
        attach('waymark.json');
        return c.json(ws.exportRoadmap(id));
      case 'zip':
        attach('waymark.zip');
        return c.body(new Uint8Array(await ws.exportZip(id)) as Uint8Array<ArrayBuffer>, 200, { 'Content-Type': 'application/zip' });
      case 'md':
      case 'markdown':
        attach('md');
        return c.body(toMarkdown(rm, opts), 200, { 'Content-Type': 'text/markdown; charset=utf-8' });
      case 'opml':
        attach('opml');
        return c.body(toOpml(rm, opts), 200, { 'Content-Type': 'text/x-opml; charset=utf-8' });
      case 'html':
      case 'pdf':
        if (c.req.query('download') === '1') attach('html');
        return c.html(
          toHtml(rm, {
            ...opts,
            print: format === 'pdf' || c.req.query('print') === '1',
            asset: (rel) => ws.exportAsset(id, rel),
            // A downloaded page carries KaTeX inside it so maths renders anywhere, offline.
            mathCss: () => (c.req.query('download') === '1' ? katexInline() : '<link rel="stylesheet" href="/api/katex/katex.min.css" />'),
          }),
        );
      default:
        throw new HttpError(400, `Unknown export format "${format}". Use zip, json, md, html, pdf or opml.`);
    }
  });

  app.post('/api/import', async (c) => {
    let data: unknown;
    try {
      data = await c.req.json();
    } catch {
      throw new HttpError(400, 'That file is not valid JSON.');
    }
    const res = await ws.importBundle(data, { folder: c.req.query('folder') ?? '' });
    return c.json({ roadmapId: res.roadmap.meta.id, warnings: res.warnings }, 201);
  });

  // Import an outline written in Markdown (headings and lists become checkpoints)
  // Restore a full backup (.waymark.zip: data + attachments) as a new roadmap
  app.post('/api/import/zip', async (c) => {
    const data = new Uint8Array(await c.req.arrayBuffer());
    if (!data.byteLength) throw new HttpError(400, 'That file is empty.');
    const res = await ws.importZip(data, { folder: c.req.query('folder') ?? '' });
    return c.json({ roadmapId: res.roadmap.meta.id, warnings: res.warnings, attachments: res.attachments }, 201);
  });

  app.post('/api/import/markdown', async (c) => {
    const b = await body(c, z.object({ text: z.string().min(1), title: z.string().optional(), profile: z.enum(['general', 'learning']).default('learning'), folder: z.string().default('') }));
    const outline = outlineFromMarkdown(b.text);
    if (!outline.items.length) throw new HttpError(400, 'No headings or lists found. Use # headings or - bullet lists for the checkpoints.');
    const bundle = fromOutline({ title: b.title?.trim() || outline.title || 'Imported roadmap', overview: outline.overview, profile: b.profile, items: outline.items });
    const res = await ws.importBundle(bundle, { folder: b.folder });
    return c.json({ roadmapId: res.roadmap.meta.id, warnings: res.warnings, count: bundle.checkpoints.length }, 201);
  });

  app.post('/api/roadmaps/:id/template', async (c) => {
    const b = await body(c, z.object({ name: z.string().min(1) }));
    return c.json(await ws.saveTemplate(c.req.param('id'), b.name));
  });

  app.get('/api/templates', async (c) => c.json(await ws.listTemplates()));

  app.post('/api/backup', async (c) => c.json(await ws.backupAll()));

  app.get('/api/search', (c) => c.json(ws.search(c.req.query('q') ?? '')));

  // Review: outside edits, held changes and proposals
  app.get('/api/review', async (c) => c.json({ items: ws.listReview(), proposals: await ws.listProposals() }));

  app.post('/api/review/:itemId', async (c) => {
    const b = await body(c, z.object({ action: z.enum(['keep', 'revert', 'apply', 'discard']), fields: z.array(z.string()).optional() }));
    return c.json((await ws.reviewAction(c.req.param('itemId'), b.action, b.fields as FieldPath[] | undefined)) ?? { ok: true });
  });

  app.post('/api/roadmaps/:id/proposals', async (c) => {
    const b = await body(c, z.object({ text: z.string().min(1) }));
    return c.json(await ws.addPastedProposal(c.req.param('id'), b.text), 201);
  });

  app.post('/api/roadmaps/:id/proposals/:name/apply', async (c) => {
    const b = await body(c, z.object({ indexes: z.array(z.number().int().min(0)) }));
    return c.json(await ws.applyProposal(c.req.param('id'), c.req.param('name'), b.indexes));
  });

  app.post('/api/roadmaps/:id/proposals/:name/reject', async (c) => {
    await ws.rejectProposal(c.req.param('id'), c.req.param('name'));
    return c.json({ ok: true });
  });

  app.post('/api/roadmaps/:id/brief', async (c) => {
    const b = await body(c, z.object({ checkpointId: z.string().nullable().optional(), request: z.string().default('') }));
    return c.json({ text: buildBrief(ws, c.req.param('id'), b.checkpointId ?? null, b.request) });
  });

  app.get('/api/roadmaps/:id/checkpoints/:cp/file', (c) => {
    const id = c.req.param('id');
    const cp = c.req.param('cp');
    return c.json({ path: ws.checkpointFile(id, cp), text: ws.checkpointText(id, cp) });
  });

  app.post('/api/roadmaps/:id/parse-check', async (c) => {
    const b = await body(c, z.object({ text: z.string() }));
    const r = parseCheckpoint(b.text, getProfile(ws.getRoadmap(c.req.param('id')).meta.profile));
    return c.json(r.ok ? { ok: true, warnings: r.warnings } : r);
  });

  // Attachments: images and PDFs stored in <roadmap>/attachments/<checkpoint-id>/
  app.post('/api/roadmaps/:id/attachments', async (c) => {
    const cp = c.req.query('cp') ?? '';
    const name = c.req.query('name') ?? 'file';
    const declared = Number(c.req.header('content-length') ?? 0);
    if (declared > MAX_ATTACHMENT_BYTES) throw new HttpError(413, `Files up to ${MAX_ATTACHMENT_BYTES / 1024 / 1024} MB can be attached.`);
    const data = new Uint8Array(await c.req.arrayBuffer());
    return c.json(await ws.addAttachment(c.req.param('id'), cp, name, data), 201);
  });

  app.delete('/api/roadmaps/:id/attachments', async (c) => c.json(await ws.removeAttachment(c.req.param('id'), c.req.query('path') ?? '')));

  app.get('/api/roadmaps/:id/files/*', async (c) => {
    const id = c.req.param('id');
    const rel = decodeURIComponent(c.req.path.split(`/api/roadmaps/${id}/files/`)[1] ?? '');
    const file = ws.attachmentFile(id, rel);
    let data: Buffer;
    try {
      data = await readFile(file);
    } catch {
      throw new HttpError(404, 'File not found.');
    }
    const ext = file.split('.').pop()?.toLowerCase() ?? '';
    const headers: Record<string, string> = {
      'Content-Type': ATTACHMENT_TYPES[ext]?.mime ?? 'application/octet-stream',
      'Cache-Control': 'no-cache',
      'X-Content-Type-Options': 'nosniff',
      'Content-Disposition': `${c.req.query('download') ? 'attachment' : 'inline'}; filename*=UTF-8''${encodeURIComponent(path.basename(file))}`,
    };
    // SVG (and anything unknown) can carry scripts: never let it run in Waymark's origin.
    if (ext === 'svg' || !ATTACHMENT_TYPES[ext]) headers['Content-Security-Policy'] = "default-src 'none'; style-src 'unsafe-inline'; img-src data:; sandbox";
    return c.body(new Uint8Array(data), 200, headers);
  });

  // pdf.js data (fonts, character maps, decoders), served locally so PDFs render offline.
  const pdfjsRoot = path.dirname(createRequire(import.meta.url).resolve('pdfjs-dist/package.json'));
  app.get('/api/pdfjs/:kind/:file', async (c) => {
    const kind = c.req.param('kind');
    const name = path.basename(c.req.param('file'));
    if (!['cmaps', 'standard_fonts', 'wasm', 'iccs'].includes(kind)) throw new HttpError(404, 'Not found.');
    try {
      const data = await readFile(path.join(pdfjsRoot, kind, name));
      return c.body(new Uint8Array(data), 200, { 'Cache-Control': 'public, max-age=604800', 'Content-Type': name.endsWith('.wasm') ? 'application/wasm' : 'application/octet-stream' });
    } catch {
      throw new HttpError(404, 'Not found.');
    }
  });

  // KaTeX stylesheet and fonts for maths in exported pages
  app.get('/api/katex/katex.min.css', async (c) =>
    c.body(await readFile(path.join(katexDist, 'katex.min.css'), 'utf8'), 200, { 'Content-Type': 'text/css; charset=utf-8', 'Cache-Control': 'public, max-age=604800' }),
  );
  app.get('/api/katex/fonts/:file', async (c) => {
    const name = path.basename(c.req.param('file'));
    try {
      const data = await readFile(path.join(katexDist, 'fonts', name));
      const type = name.endsWith('.woff2') ? 'font/woff2' : name.endsWith('.woff') ? 'font/woff' : 'font/ttf';
      return c.body(new Uint8Array(data), 200, { 'Content-Type': type, 'Cache-Control': 'public, max-age=604800' });
    } catch {
      throw new HttpError(404, 'Not found.');
    }
  });

  // Trash
  app.get('/api/trash', async (c) => c.json(await ws.listTrash()));
  app.post('/api/trash/:id/restore', async (c) => c.json(await ws.restoreTrash(c.req.param('id'))));
  app.delete('/api/trash/:id', async (c) => {
    await ws.purgeTrash(c.req.param('id'));
    return c.json({ ok: true });
  });

  // Live updates (Server-Sent Events)
  app.get('/api/events', (c) =>
    streamSSE(c, async (stream) => {
      const queue: WsEvent[] = [];
      let wake: (() => void) | null = null;
      const onEvent = (e: WsEvent) => {
        queue.push(e);
        wake?.();
      };
      ws.on('event', onEvent);
      stream.onAbort(() => {
        ws.off('event', onEvent);
        wake?.();
      });
      await stream.writeSSE({ event: 'hello', data: JSON.stringify({ at: Date.now() }) });
      while (!stream.aborted && !stream.closed) {
        if (!queue.length) {
          await new Promise<void>((r) => {
            wake = r;
            setTimeout(r, 20_000);
          });
          wake = null;
        }
        if (stream.aborted || stream.closed) break;
        if (!queue.length) {
          await stream.writeSSE({ event: 'ping', data: '{}' });
          continue;
        }
        const e = queue.shift()!;
        await stream.writeSSE({ event: e.type, data: JSON.stringify(e) });
      }
      ws.off('event', onEvent);
    }),
  );

  app.all('/api/*', (c) => c.json({ error: 'Unknown API route.' }, 404));

  return app;
}
