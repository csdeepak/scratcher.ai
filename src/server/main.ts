// Entry point: `npm start` (build UI + serve) or `npm run serve` (serve an existing build).
// Options: --workspace <folder> (or WAYMARK_WORKSPACE; default ./workspace), --port <n> (or WAYMARK_PORT; default 4317).

import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { existsSync, readFileSync } from 'node:fs';
import { serve } from '@hono/node-server';
import { serveStatic } from '@hono/node-server/serve-static';
import { Workspace } from './workspace';
import { createApp } from './app';

const here = path.dirname(fileURLToPath(import.meta.url));
const appRoot = path.resolve(here, '..', '..');
const arg = (name: string) => {
  const i = process.argv.indexOf(`--${name}`);
  return i > -1 ? process.argv[i + 1] : undefined;
};
const workspaceDir = path.resolve(arg('workspace') ?? process.env.WAYMARK_WORKSPACE ?? path.join(appRoot, 'workspace'));
const port = Number(arg('port') ?? process.env.WAYMARK_PORT ?? 4317);
const distDir = path.join(appRoot, 'dist');

const ws = new Workspace(workspaceDir);
await ws.init({
  watch: true,
  seedExample: path.join(appRoot, 'examples', 'learn-git.waymark.json'),
  templatesDir: path.join(appRoot, 'examples', 'templates'),
});

const app = createApp(ws);

if (existsSync(path.join(distDir, 'index.html'))) {
  const root = path.relative(process.cwd(), distDir) || '.';
  app.use('/*', serveStatic({ root }));
  app.get('*', (c) => c.html(readFileSync(path.join(distDir, 'index.html'), 'utf8')));
} else {
  app.get('/', (c) => c.text('Waymark API is running. In development open http://localhost:5173 (npm run dev), or run "npm start" to build the UI.'));
}

const server = serve({ fetch: app.fetch, port, hostname: '127.0.0.1' }, (info) => {
  console.log(`\n  Waymark is running:   http://localhost:${info.port}`);
  console.log(`  Workspace folder:     ${workspaceDir}`);
  console.log('  Stop with Ctrl+C. Your data is the folder above; the app holds nothing else.\n');
});

let closing = false;
const shutdown = async () => {
  if (closing) return;
  closing = true;
  console.log('\n  Saving and stopping…');
  try {
    await ws.close();
  } finally {
    server.close();
    process.exit(0);
  }
};
for (const sig of ['SIGINT', 'SIGTERM', 'SIGHUP', 'SIGBREAK'] as const) process.on(sig, shutdown);
