// Bundles the desktop app's three entry points with esbuild:
//   electron/main.ts    → dist-electron/main.cjs     (Electron main process)
//   electron/preload.ts → dist-electron/preload.cjs  (sandboxed preload)
//   src/server/desktop.ts → dist-electron/server.mjs (server, run as an Electron utility process)
// npm packages stay external: the server finds them (and KaTeX's and pdf.js's files) in node_modules.

import { build } from 'esbuild';

const common = { bundle: true, platform: 'node', target: 'node22', sourcemap: false, logLevel: 'info' };

await Promise.all([
  build({ ...common, entryPoints: ['electron/main.ts'], outfile: 'dist-electron/main.cjs', format: 'cjs', external: ['electron', 'electron-updater'] }),
  build({ ...common, entryPoints: ['electron/preload.ts'], outfile: 'dist-electron/preload.cjs', format: 'cjs', external: ['electron'] }),
  build({ ...common, entryPoints: ['src/server/desktop.ts'], outfile: 'dist-electron/server.mjs', format: 'esm', packages: 'external' }),
]);
