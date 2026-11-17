// Accessibility check of the running app with axe-core (MPL-2.0, the engine behind Lighthouse's
// accessibility audit), in a hidden Electron window so colour contrast is measured on real
// rendering. Covers the main screens and dialogs, light and dark themes, desktop and phone sizes.
//
//   npm run serve -- --port 4318 --workspace .waymark-test     (a throwaway workspace)
//   npm run qa:a11y                                            (or: npx electron scripts/qa-a11y.cjs http://localhost:4318)
//
// Prints each screen's violations (WCAG 2.2 A/AA plus axe best practices) and writes the full
// result to qa-a11y-report.json. Exit code 1 if anything serious or critical is found.

const { app, BrowserWindow } = require('electron');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const BASE = (process.argv.find((a) => /^https?:\/\//.test(a)) || 'http://localhost:4318').replace(/\/$/, '');
const AXE = fs.readFileSync(require.resolve('axe-core/axe.min.js'), 'utf8');
app.setPath('userData', path.join(os.tmpdir(), 'waymark-qa-a11y'));

// Page-side helpers, available to every step as `qa.*`.
const HELPERS = `window.qa = {
  wait: (ms) => new Promise((r) => setTimeout(r, ms)),
  btn: (text) => [...document.querySelectorAll('button, [role=menuitem], [role=option], a')].find((b) => (b.innerText || b.getAttribute('aria-label') || '').trim().startsWith(text)),
  click(text) { const b = qa.btn(text); if (!b) throw new Error('No button: ' + text); b.click(); },
  press(target, opts) { target.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, button: 0, pointerType: 'mouse', ...opts })); },
  key(key, opts = {}) { window.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true, ...opts })); },
  async until(fn, ms = 4000) { const t = Date.now(); while (Date.now() - t < ms) { if (fn()) return true; await qa.wait(100); } throw new Error('Timed out: ' + fn); },
};`;

const ROADMAP = '#/r/rm-example1';
const CP = '#/r/rm-example1/cp-gitundo01';
const SCREENS = [
  { name: 'Home', hash: '' },
  { name: 'Roadmap map', hash: ROADMAP },
  { name: 'Checkpoint page', hash: CP },
  { name: 'Notes editor', hash: CP, steps: [`qa.click('My notes')`, `await qa.until(() => document.querySelector('.ProseMirror'))`] },
  { name: 'New roadmap dialog', hash: '', steps: [`qa.click('New roadmap')`] },
  { name: 'Command palette', hash: ROADMAP, steps: [`qa.key('k', { ctrlKey: true })`] },
  { name: 'Connect your AI', hash: '', steps: [`qa.click('Connect your AI')`] },
  { name: 'Workspace folder', hash: '', steps: [`qa.click('About this folder')`] },
  { name: 'Review', hash: ROADMAP, steps: [`qa.click('Review')`] },
  { name: 'Work with an agent', hash: CP, steps: [`qa.press(document.querySelector('[aria-label=Menu]'))`, `await qa.until(() => qa.btn('Work with an agent'))`, `qa.click('Work with an agent')`] },
  { name: 'Customise toolbar', hash: ROADMAP, steps: [`qa.key('k', { ctrlKey: true })`, `await qa.until(() => qa.btn('Customise the map toolbar'))`, `qa.click('Customise the map toolbar')`] },
  { name: 'Keyboard shortcuts', hash: '', steps: [`qa.press(document.querySelector('[aria-label=Menu]'))`, `await qa.until(() => qa.btn('Keyboard shortcuts'))`, `qa.click('Keyboard shortcuts')`] },
];
const VARIANTS = [
  { label: 'light', theme: 'light', width: 1440, height: 900 },
  { label: 'dark', theme: 'dark', width: 1440, height: 900 },
  { label: 'phone', theme: 'light', width: 390, height: 844, only: ['Home', 'Roadmap map', 'Checkpoint page', 'New roadmap dialog'] },
];

async function run() {
  const win = new BrowserWindow({ show: false, width: 1440, height: 900, webPreferences: { contextIsolation: true, sandbox: true } });
  const results = [];
  for (const v of VARIANTS) {
    win.setContentSize(v.width, v.height);
    for (const s of SCREENS) {
      if (v.only && !v.only.includes(s.name)) continue;
      const label = `${s.name} · ${v.label}`;
      try {
        await win.loadURL(`${BASE}/`);
        await win.webContents.executeJavaScript(`localStorage.setItem('waymark.theme', ${JSON.stringify(v.theme)}); 0`);
        await win.loadURL(`${BASE}/${s.hash}`);
        await win.webContents.executeJavaScript(`${HELPERS}; 0`);
        await win.webContents.executeJavaScript(`(async () => { await qa.until(() => document.querySelector('#root')?.innerText.length > 50); await qa.wait(900); })()`);
        for (const step of s.steps ?? []) {
          await win.webContents.executeJavaScript(`(async () => { ${step}; await qa.wait(500); })()`);
        }
        await win.webContents.executeJavaScript(`${AXE}; 0`);
        const r = await win.webContents.executeJavaScript(`axe.run(document, { runOnly: { type: 'tag', values: ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa', 'best-practice'] }, resultTypes: ['violations'] }).then((r) => r.violations.map((v) => ({ id: v.id, impact: v.impact, help: v.help, nodes: v.nodes.map((n) => ({ target: n.target.join(' '), html: n.html.slice(0, 160), why: (n.any[0] || n.all[0] || n.none[0] || {}).message })) })))`);
        results.push({ screen: label, violations: r });
        const line = r.length ? r.map((x) => `${x.impact}:${x.id}×${x.nodes.length}`).join('  ') : 'no violations';
        console.log(`${label.padEnd(36)} ${line}`);
      } catch (e) {
        results.push({ screen: label, error: String(e.message || e) });
        console.log(`${label.padEnd(36)} ERROR ${String(e.message || e).slice(0, 160)}`);
      }
    }
  }
  fs.writeFileSync('qa-a11y-report.json', JSON.stringify(results, null, 2));
  const serious = results.flatMap((r) => r.violations ?? []).filter((v) => v.impact === 'serious' || v.impact === 'critical');
  console.log(`\n${serious.length} serious or critical violation types across ${results.length} screens. Details: qa-a11y-report.json`);
  return serious.length || results.some((r) => r.error) ? 1 : 0;
}

app.whenReady().then(async () => {
  let code = 1;
  try {
    code = await run();
  } catch (e) {
    console.error(e);
  }
  app.exit(code);
});
