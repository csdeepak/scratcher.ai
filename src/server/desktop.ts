// The desktop app's server process (an Electron utility process, as in Actual Budget's desktop app).
// It gets its settings from the environment, tells the window process which port it is on, and
// saves everything before it stops when asked.

import { startServer } from './server';

interface ParentPort {
  postMessage(message: unknown): void;
  on(event: 'message', listener: (e: { data: unknown }) => void): void;
}
const parent = (process as unknown as { parentPort?: ParentPort }).parentPort;
const send = (m: unknown) => (parent ? parent.postMessage(m) : console.log(JSON.stringify(m)));

const workspaceDir = process.env.WAYMARK_WORKSPACE;
const appRoot = process.env.WAYMARK_APP_ROOT;
const port = Number(process.env.WAYMARK_PORT ?? 47317);

try {
  if (!workspaceDir || !appRoot) throw new Error('The desktop app did not say which workspace folder to use.');
  const server = await startServer({ workspaceDir, appRoot, port, findFreePort: true });
  send({ type: 'ready', port: server.port });
  parent?.on('message', (e) => {
    const msg = e.data as { type?: string } | null;
    if (msg?.type === 'shutdown') {
      void server.close().finally(() => {
        send({ type: 'stopped' });
        process.exit(0);
      });
    }
  });
} catch (e) {
  send({ type: 'error', message: (e as Error).message ?? String(e) });
  process.exit(1);
}
