// Starts Waymark (workspace + HTTP API + built UI) on 127.0.0.1. Used by the command line
// (src/server/main.ts) and by the desktop app's server process (src/server/desktop.ts).

import path from 'node:path';
import { readFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { serve, type ServerType } from '@hono/node-server';
import { Workspace } from './workspace';
import { createApp } from './app';

export interface StartOptions {
  workspaceDir: string;
  /** Folder that holds dist/ (built UI) and examples/. */
  appRoot: string;
  port: number;
  /** Try the next ports when this one is taken (desktop); otherwise fail (command line). */
  findFreePort?: boolean;
}

const TYPES: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json',
  '.webmanifest': 'application/manifest+json',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.ttf': 'font/ttf',
  '.wasm': 'application/wasm',
  '.map': 'application/json',
};

function listen(app: ReturnType<typeof createApp>, port: number): Promise<{ server: ServerType; port: number }> {
  return new Promise((resolve, reject) => {
    const server = serve({ fetch: app.fetch, port, hostname: '127.0.0.1' }, (info) => resolve({ server, port: info.port }));
    server.once('error', reject);
  });
}

export async function startServer(o: StartOptions) {
  const ws = new Workspace(o.workspaceDir);
  await ws.init({
    watch: true,
    seedExample: path.join(o.appRoot, 'examples', 'learn-git.waymark.json'),
    templatesDir: path.join(o.appRoot, 'examples', 'templates'),
  });
  const app = createApp(ws);

  // The built UI. Read with absolute paths so it also works from inside the desktop app's archive.
  const distDir = path.join(o.appRoot, 'dist');
  if (existsSync(path.join(distDir, 'index.html'))) {
    app.get('*', async (c) => {
      const rel = decodeURIComponent(c.req.path).replace(/^\/+/, '');
      const file = path.join(distDir, ...rel.split('/'));
      if (rel && file.startsWith(distDir + path.sep) && !rel.split('/').includes('..')) {
        try {
          const data = await readFile(file);
          const cache = rel.startsWith('assets/') ? 'public, max-age=31536000, immutable' : 'no-cache';
          return c.body(new Uint8Array(data), 200, { 'Content-Type': TYPES[path.extname(file).toLowerCase()] ?? 'application/octet-stream', 'Cache-Control': cache });
        } catch {
          /* not a file: fall through to the app page */
        }
      }
      return c.html(await readFile(path.join(distDir, 'index.html'), 'utf8'), 200, { 'Cache-Control': 'no-cache' });
    });
  } else {
    app.get('/', (c) => c.text('Waymark API is running. In development open http://localhost:5173 (npm run dev), or run "npm start" to build the UI.'));
  }

  let bound: { server: ServerType; port: number } | null = null;
  const tries = o.findFreePort ? 20 : 1;
  for (let i = 0; i < tries && !bound; i++) {
    try {
      bound = await listen(app, o.port + i);
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code !== 'EADDRINUSE' || i === tries - 1) {
        await ws.close();
        throw e;
      }
    }
  }
  const { server, port } = bound!;

  let closed = false;
  return {
    port,
    workspace: ws,
    async close() {
      if (closed) return;
      closed = true;
      try {
        await ws.close();
      } finally {
        await new Promise<void>((r) => server.close(() => r()));
      }
    },
  };
}
