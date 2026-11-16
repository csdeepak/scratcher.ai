// Renders public/favicon.svg to build/icon.png (1024×1024) for the desktop installers.
// Run with Electron: npx electron scripts/make-icon.cjs
// electron-builder turns this PNG into the Windows .ico and macOS .icns.

const { app, BrowserWindow } = require('electron');
const fs = require('node:fs');
const path = require('node:path');

const SIZE = 1024;
const root = path.resolve(__dirname, '..');

app.whenReady().then(async () => {
  const svg = fs.readFileSync(path.join(root, 'public', 'favicon.svg'), 'utf8');
  const html = `<html><body style="margin:0;background:transparent"><img src="data:image/svg+xml;base64,${Buffer.from(svg).toString('base64')}" width="${SIZE}" height="${SIZE}"></body></html>`;
  const win = new BrowserWindow({ width: SIZE, height: SIZE, show: false, transparent: true, frame: false, useContentSize: true, webPreferences: { offscreen: true } });
  await win.loadURL(`data:text/html;base64,${Buffer.from(html).toString('base64')}`);
  await new Promise((r) => setTimeout(r, 300));
  const image = await win.webContents.capturePage({ x: 0, y: 0, width: SIZE, height: SIZE });
  fs.mkdirSync(path.join(root, 'build'), { recursive: true });
  fs.writeFileSync(path.join(root, 'build', 'icon.png'), image.resize({ width: SIZE, height: SIZE }).toPNG());
  console.log(`build/icon.png ${image.getSize().width}x${image.getSize().height}`);
  app.quit();
});
