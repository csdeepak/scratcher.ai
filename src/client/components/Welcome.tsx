// First start of the desktop app (welcome.html): choose the workspace folder. The pattern of
// Obsidian's first screen ("open a folder as a vault") and VS Code's walkthroughs: one decision per
// step, with what will happen spelled out. Step 2, "Connect your AI", is shown in the app itself.

import { useEffect, useState } from 'react';
import { ArrowRight, Loader } from 'lucide-react';
import { desktopBridge } from '../desktop';
import { FolderField, FolderStatus, useFolderCheck } from './FolderPicker';
import { Button } from './ui';

const TREE: [string, string][] = [
  ['roadmaps\\', 'your roadmaps, one folder each; group them in folders of your own'],
  ['AGENTS.md', 'the rules every AI agent follows in this folder'],
  ['CLAUDE.md, GEMINI.md', 'point Claude and Gemini to those rules'],
  ['LIBRARY.md', 'a list of all your roadmaps, kept up to date for agents'],
  ['backups\\', 'a zip of each roadmap every day (the last 30 days)'],
];

export function Welcome() {
  const desktop = desktopBridge();
  const [dir, setDir] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const info = useFolderCheck(dir);
  const win = desktop?.platform === 'win32';

  useEffect(() => {
    void desktop?.setupInfo().then((s) => s && setDir((d) => d || s.suggested));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  if (!desktop) {
    return (
      <main className="mx-auto max-w-lg px-4 py-16 text-[14px] text-muted">
        This page is the first step of the Waymark desktop app. Open Waymark itself to choose your workspace folder.
      </main>
    );
  }

  const go = async () => {
    setBusy(true);
    setError(null);
    const r = await desktop.useFolder(dir);
    // On success the window moves on to the app; we only get here if it didn't.
    if (!r.ok) {
      setError(r.error ?? "Waymark couldn't use that folder.");
      setBusy(false);
    }
  };
  const ready = !!info && info.state !== 'blocked' && !busy;
  const tree = win ? TREE : TREE.map(([a, b]) => [a.replace(/\\/g, '/'), b] as [string, string]);

  return (
    <main data-welcome className="min-h-full bg-bg px-4 py-10 sm:py-14">
      <div className="mx-auto max-w-xl">
        <div className="mb-8 flex items-center gap-2.5">
          <img src="/favicon.svg" alt="" className="size-8" />
          <span className="text-[15px] font-semibold">Waymark</span>
        </div>
        <h1 className="text-[26px] font-semibold tracking-[-0.02em]">Welcome to Waymark</h1>
        <p className="mt-2 text-[14px] leading-relaxed text-muted">
          Waymark keeps your roadmaps and notes as plain Markdown files in one folder on this computer. You and your AI agents (Claude, ChatGPT and
          others) work in that same folder: Waymark shows their changes as they happen and lets you review them.
        </p>

        <ol className="mt-6 flex gap-4 text-[12.5px]" aria-label="Steps">
          <li className="flex items-center gap-1.5 font-semibold text-fg">
            <span className="flex size-5 items-center justify-center rounded-full bg-accent text-[11px] text-accent-fg">1</span> Your workspace folder
          </li>
          <li className="flex items-center gap-1.5 text-faint">
            <span className="flex size-5 items-center justify-center rounded-full border border-line-strong text-[11px]">2</span> Connect your AI
          </li>
        </ol>

        <section className="mt-3 rounded-2xl border border-line bg-surface p-5 shadow-sm">
          <label htmlFor="wm-folder" className="block text-[14px] font-semibold">
            Where should your notes live?
          </label>
          <p className="mb-3 mt-0.5 text-[12.5px] text-muted">Pick a folder just for Waymark. Everything you create goes here, and it's the folder you give your AI agents.</p>
          <FolderField id="wm-folder" value={dir} onChange={setDir} disabled={busy} />
          <div className="mt-3">
            <FolderStatus info={info} mode="start" onUseInside={setDir} />
          </div>

          <details className="mt-4 text-[12.5px]">
            <summary className="cursor-pointer select-none text-muted hover:text-fg">What goes in this folder?</summary>
            <dl className="mt-2 grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 rounded-lg bg-surface-2 p-3">
              {tree.map(([name, what]) => (
                <div key={name} className="contents">
                  <dt className="font-mono text-[12px]">{name}</dt>
                  <dd className="text-muted">{what}</dd>
                </div>
              ))}
            </dl>
            <p className="mt-2 text-faint">All plain text you own: it opens in any editor, and you can put the folder in OneDrive or a git repository for backups.</p>
          </details>

          {error && (
            <p role="alert" className="mt-3 rounded-lg bg-danger-soft px-3 py-2 text-[12.5px]">
              {error}
            </p>
          )}

          <div className="mt-5 flex items-center justify-between gap-3">
            <p className="text-[12px] text-faint">You can change or move it later: File → Workspace folder.</p>
            <Button variant="primary" disabled={!ready} onClick={() => void go()}>
              {busy ? (
                <>
                  <Loader size={14} className="animate-spin" /> Setting up…
                </>
              ) : (
                <>
                  Continue <ArrowRight size={14} />
                </>
              )}
            </Button>
          </div>
        </section>
      </div>
    </main>
  );
}
