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
import type { FieldPath } from '../shared/model';

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

  app.post('/api/roadmaps', async (c) => {
    const b = await body(
      c,
      z.object({
        title: z.string().min(1),
        profile: z.enum(['general', 'learning']).default('general'),
        description: z.string().optional(),
        overview: z.string().optional(),
        template: z.string().optional(),
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
    const b = await body(c, z.object({ offsets: z.record(z.string(), z.object({ dx: z.number(), dy: z.number() })) }));
    return c.json(await ws.setLayout(c.req.param('id'), b.offsets));
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

  app.get('/api/roadmaps/:id/export', (c) => {
    const bundle = ws.exportRoadmap(c.req.param('id'));
    const name = `${ws.getRoadmap(c.req.param('id')).slug}.waymark.json`;
    c.header('Content-Disposition', `attachment; filename="${name}"`);
    return c.json(bundle);
  });

  app.post('/api/import', async (c) => {
    let data: unknown;
    try {
      data = await c.req.json();
    } catch {
      throw new HttpError(400, 'That file is not valid JSON.');
    }
    const res = await ws.importBundle(data);
    return c.json({ roadmapId: res.roadmap.meta.id, warnings: res.warnings }, 201);
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
