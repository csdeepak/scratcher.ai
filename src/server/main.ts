// Entry point: `npm start` (build UI + serve) or `npm run serve` (serve an existing build).
// Options: --workspace <folder> (or WAYMARK_WORKSPACE; default ./workspace), --port <n> (or WAYMARK_PORT; default 4317).

import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { startServer } from './server';

const here = path.dirname(fileURLToPath(import.meta.url));
const appRoot = path.resolve(here, '..', '..');
const arg = (name: string) => {
  const i = process.argv.indexOf(`--${name}`);
  return i > -1 ? process.argv[i + 1] : undefined;
};
const workspaceDir = path.resolve(arg('workspace') ?? process.env.WAYMARK_WORKSPACE ?? path.join(appRoot, 'workspace'));
const port = Number(arg('port') ?? process.env.WAYMARK_PORT ?? 4317);

const server = await startServer({ workspaceDir, appRoot, port });
console.log(`\n  Waymark is running:   http://localhost:${server.port}`);
console.log(`  Workspace folder:     ${workspaceDir}`);
console.log('  Stop with Ctrl+C. Your data is the folder above; the app holds nothing else.\n');

let closing = false;
const shutdown = async () => {
  if (closing) return;
  closing = true;
  console.log('\n  Saving and stopping…');
  try {
    await server.close();
  } finally {
    process.exit(0);
  }
};
for (const sig of ['SIGINT', 'SIGTERM', 'SIGHUP', 'SIGBREAK'] as const) process.on(sig, shutdown);
