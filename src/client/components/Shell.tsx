import { useEffect, useMemo, useRef, useState } from 'react';
import { ReactFlowProvider } from '@xyflow/react';
import { toast } from 'sonner';
import {
  Folder,
  NotebookTabs,
  Bot,
  Check,
  ChevronDown,
  CloudOff,
  Download,
  Ellipsis,
  FolderOpen,
  House,
  Inbox,
  Keyboard,
  LayoutTemplate,
  ListTree,
  Loader,
  Map as MapIcon,
  Monitor,
  Moon,
  PanelRight,
  Plus,
  Save,
  Search,
  Settings,
  Sun,
  Trash,
  TriangleExclamationPoint,
  Upload,
} from 'lucide-react';
import { getProfile } from '../../shared/profiles';
import { computeProgress } from '../../shared/tree';
import { computeLayout } from '../layout';
import { http } from '../api';
import { roadmapColor } from '../../shared/model';
import { COLOR_HEX, LibrarySidebar } from './Library';
import {
  flushOutbox,
  getState,
  navigate,
  overview,
  selectCheckpoint,
  setFocus,
  setState,
  setTheme,
  toggleExpanded,
  toggleLibrary,
  toggleOutline,
  undoLast,
  useStore,
} from '../store';
import { addCheckpoint, addSibling, deleteCheckpoint, indent, needsDeleteConfirm, outdent, shiftCheckpoint } from '../actions';
import { MapCanvas } from './MapCanvas';
import { Outline } from './Outline';
import { DetailsPanel } from './Details';
import { Button, Chip, Drawer, IconButton, Kbd, Menu, Modal, ProgressBar, Tip, cx, relTime } from './ui';

// ------------------------------------------------------------------ top bar

export function TopBar({ onImport }: { onImport: () => void }) {
  const rm = useStore((s) => s.roadmap);
  const summaries = useStore((s) => s.summaries);
  const reviewItems = useStore((s) => s.review);
  const outlineOpen = useStore((s) => s.outlineOpen);
  const libraryOpen = useStore((s) => s.libraryOpen);
  const detailsOpen = useStore((s) => s.detailsOpen);
  const theme = useStore((s) => s.theme);
  const color = rm ? COLOR_HEX[roadmapColor(rm.meta)] : null;
  const reviewCount = reviewItems.items.length + reviewItems.proposals.length;
  const heldCount = reviewItems.items.filter((i) => i.kind === 'held' || i.kind === 'held-delete').length + reviewItems.proposals.length;

  return (
    <header className="flex h-12 flex-none items-center gap-1.5 border-b-[1.5px] border-ink/15 bg-surface px-2 sm:px-3">
      <IconButton label={libraryOpen ? 'Hide library (all roadmaps)' : 'Show library (all roadmaps)'} active={libraryOpen} onClick={toggleLibrary}>
        <NotebookTabs size={17} />
      </IconButton>
      <button onClick={() => navigate({ page: 'home' })} className="flex items-center gap-2 rounded-lg px-1.5 py-1 hover:bg-surface-2" aria-label="All roadmaps">
        <img src="/favicon.svg" alt="" className="size-6" />
        <span className="hidden text-[15px] font-bold tracking-[-0.01em] sm:inline">Waymark</span>
      </button>
      {rm && (
        <>
          <span className="text-faint">/</span>
          {rm.folder &&
            rm.folder.split('/').map((part, i, all) => (
              <span key={i} className="hidden items-center gap-1.5 lg:flex">
                <button
                  className="max-w-36 truncate rounded px-1 py-1 text-[13px] text-muted hover:bg-surface-2 hover:text-fg"
                  onClick={() => {
                    setState({ currentFolder: all.slice(0, i + 1).join('/') });
                    navigate({ page: 'home' });
                  }}
                >
                  {part}
                </button>
                <span className="text-faint">/</span>
              </span>
            ))}
          <Menu.Root>
            <Menu.Trigger asChild>
              <button className="flex min-w-0 max-w-[40vw] items-center gap-1.5 rounded-lg px-2 py-1 text-[13.5px] font-medium hover:bg-surface-2">
                <span aria-hidden className="h-4 w-1.5 flex-none rounded-sm" style={{ background: color ?? undefined }} />
                <span className="truncate">{rm.meta.title}</span>
                <ChevronDown size={14} className="flex-none text-faint" />
              </button>
            </Menu.Trigger>
            <Menu.Content align="start" className="w-72">
              <Menu.Label>Roadmaps</Menu.Label>
              {summaries.map((s) => (
                <Menu.Item key={s.id} onSelect={() => navigate({ page: 'roadmap', id: s.id })}>
                  <span aria-hidden className="h-3.5 w-1.5 flex-none rounded-sm" style={{ background: COLOR_HEX[s.color] }} />
                  <span className="truncate">{s.title}</span>
                  {s.folder && <span className="ml-1 truncate text-[11px] text-faint">{s.folder.split('/').pop()}</span>}
                  {s.id === rm.meta.id && <Check size={14} className="ml-auto text-accent" />}
                </Menu.Item>
              ))}
              <Menu.Separator />
              <Menu.Item onSelect={() => setState({ dialog: 'new' })}>
                <Plus size={14} /> New roadmap
              </Menu.Item>
              <Menu.Item onSelect={() => navigate({ page: 'home' })}>
                <House size={14} /> All roadmaps
              </Menu.Item>
            </Menu.Content>
          </Menu.Root>
        </>
      )}
      <div className="flex-1" />
      <button
        onClick={() => setState({ dialog: 'palette' })}
        className="hidden h-8 w-64 items-center gap-2 rounded-lg border border-line bg-surface-2 px-2.5 text-[12.5px] text-faint hover:border-line-strong md:flex"
      >
        <Search size={14} /> Search checkpoints and notes <span className="ml-auto flex gap-0.5"><Kbd>Ctrl</Kbd><Kbd>K</Kbd></span>
      </button>
      <IconButton className="md:hidden" label="Search (Ctrl K)" onClick={() => setState({ dialog: 'palette' })}>
        <Search size={16} />
      </IconButton>
      <div className="flex-1" />
      <SaveIndicator />
      <Tip label={reviewCount ? `${reviewCount} item(s) to review` : 'Review agent changes and proposals (R)'}>
        <button
          onClick={() => setState({ reviewOpen: true })}
          className={cx('relative flex h-8 items-center gap-1.5 rounded-lg px-2 text-[12.5px] font-medium', reviewCount ? 'bg-accent-soft text-accent' : 'text-muted hover:bg-surface-2 hover:text-fg')}
        >
          <Inbox size={15} />
          <span className="hidden sm:inline">Review</span>
          {reviewCount > 0 && <span className={cx('min-w-5 rounded-full px-1.5 text-[11px] leading-5 text-white', heldCount ? 'bg-review' : 'bg-accent')}>{reviewCount}</span>}
        </button>
      </Tip>
      {rm && (
        <>
          <IconButton label={outlineOpen ? 'Hide outline' : 'Show outline'} active={outlineOpen} onClick={toggleOutline}>
            <ListTree size={16} />
          </IconButton>
          <IconButton label={detailsOpen ? 'Hide details' : 'Show details'} active={detailsOpen} onClick={() => setState({ detailsOpen: !detailsOpen, pageMode: false })} className="hidden md:inline-flex">
            <PanelRight size={16} />
          </IconButton>
        </>
      )}
      <Menu.Root>
        <Menu.Trigger asChild>
          <button aria-label="Menu" className="inline-flex size-8.5 items-center justify-center rounded-lg text-muted hover:bg-surface-2 hover:text-fg">
            <Ellipsis size={17} />
          </button>
        </Menu.Trigger>
        <Menu.Content className="w-60">
          {rm && (
            <>
              <Menu.Item onSelect={() => setState({ dialog: 'settings' })}>
                <Settings size={14} /> Roadmap settings
              </Menu.Item>
              <Menu.Item onSelect={() => setState({ dialog: 'agent' })}>
                <Bot size={14} /> Work with an agent
              </Menu.Item>
              <Menu.Item onSelect={() => setState({ dialog: 'export', exportTarget: null })}>
                <Download size={14} /> Export (PDF, Markdown, image…)
              </Menu.Item>
              <Menu.Item onSelect={() => setState({ dialog: 'template' })}>
                <LayoutTemplate size={14} /> Save as template
              </Menu.Item>
              <Menu.Separator />
            </>
          )}
          <Menu.Item onSelect={() => setState({ dialog: 'new' })}>
            <Plus size={14} /> New roadmap
          </Menu.Item>
          <Menu.Item onSelect={onImport}>
            <Upload size={14} /> Import (backup, Markdown, OPML)…
          </Menu.Item>
          <Menu.Item
            onSelect={async () => {
              try {
                const r = await http.post<{ dir: string; count: number }>('/api/backup');
                toast.success(`Backed up ${r.count} roadmap(s) to ${r.dir}`);
              } catch (e) {
                toast.error((e as Error).message);
              }
            }}
          >
            <Save size={14} /> Back up now
          </Menu.Item>
          <Menu.Item onSelect={() => setState({ dialog: 'trash' })}>
            <Trash size={14} /> Trash
          </Menu.Item>
          <Menu.Separator />
          <Menu.Sub>
            <Menu.SubTrigger>
              {theme === 'dark' ? <Moon size={14} /> : theme === 'light' ? <Sun size={14} /> : <Monitor size={14} />} Theme
            </Menu.SubTrigger>
            <Menu.SubContent>
              <Menu.RadioGroup value={theme} onValueChange={(v) => setTheme(v as 'system' | 'light' | 'dark')}>
                <Menu.RadioItem value="system">Match system</Menu.RadioItem>
                <Menu.RadioItem value="light">Light</Menu.RadioItem>
                <Menu.RadioItem value="dark">Dark</Menu.RadioItem>
              </Menu.RadioGroup>
            </Menu.SubContent>
          </Menu.Sub>
          <Menu.Item onSelect={() => setState({ dialog: 'shortcuts' })} hint="?">
            <Keyboard size={14} /> Keyboard shortcuts
          </Menu.Item>
        </Menu.Content>
      </Menu.Root>
    </header>
  );
}

function SaveIndicator() {
  const saveState = useStore((s) => s.saveState);
  const saveError = useStore((s) => s.saveError);
  const connected = useStore((s) => s.connected);
  const pending = useStore((s) => s.outbox.length);
  if (!connected || saveState === 'offline') {
    return (
      <Tip label={saveError ?? 'The Waymark server is not reachable. Start it again with "npm start". Unsaved edits are kept in this browser and saved when it is back.'}>
        <span role="status" className="flex h-8 items-center gap-1.5 rounded-lg bg-warn-soft px-2 text-[12px] font-medium text-review">
          <CloudOff size={14} /> <span className="hidden sm:inline">{pending ? `Offline · ${pending} unsaved` : 'Server offline'}</span>
        </span>
      </Tip>
    );
  }
  if (saveState === 'error') {
    return (
      <Tip label={saveError ?? 'Saving failed'}>
        <button role="status" onClick={() => void flushOutbox()} className="flex h-8 items-center gap-1.5 rounded-lg bg-danger-soft px-2 text-[12px] font-medium text-danger">
          <TriangleExclamationPoint size={14} /> Not saved
        </button>
      </Tip>
    );
  }
  return (
    <span role="status" aria-live="polite" className="hidden h-8 items-center gap-1.5 px-1.5 text-[12px] text-faint sm:flex">
      {saveState === 'saving' ? (
        <>
          <Loader size={13} className="animate-spin" /> Saving…
        </>
      ) : (
        <>
          <Check size={13} className="text-done" /> Saved
        </>
      )}
    </span>
  );
}

// ------------------------------------------------------------------ library pane

function LibraryPane() {
  const libraryOpen = useStore((s) => s.libraryOpen);
  const libraryDrawer = useStore((s) => s.libraryDrawer);
  const pageMode = useStore((s) => s.pageMode);
  const wide = useMedia('(min-width: 1024px)');
  if (wide) {
    return libraryOpen && !pageMode ? (
      <aside className="w-[236px] flex-none border-r border-line bg-surface-2/60" aria-label="Library">
        <LibrarySidebar />
      </aside>
    ) : null;
  }
  return (
    <Drawer open={libraryDrawer} onOpenChange={(o) => setState({ libraryDrawer: o })} title="Library" side="left" width="w-[min(300px,88vw)]">
      <LibrarySidebar onPick={() => setState({ libraryDrawer: false })} />
    </Drawer>
  );
}

// ------------------------------------------------------------------ home

export function Home({ onImport }: { onImport: () => void }) {
  const summaries = useStore((s) => s.summaries);
  const folders = useStore((s) => s.folders);
  const currentFolder = useStore((s) => s.currentFolder);
  const workspace = useStore((s) => s.workspace);
  const problems = useStore((s) => s.workspaceProblems);
  const ready = useStore((s) => s.ready);
  const inScope = (f: string) => currentFolder === null || f === currentFolder || f.startsWith(currentFolder + '/');
  const groups = [...new Set(['', ...folders])]
    .filter(inScope)
    .map((f) => ({ folder: f, items: summaries.filter((r) => r.folder === f).sort((a, b) => a.title.localeCompare(b.title)) }))
    .filter((g) => g.items.length || (g.folder && g.folder === currentFolder));
  const heading = currentFolder ? currentFolder.split('/').pop()! : 'Your roadmaps';
  return (
    <div className="flex min-h-0 flex-1">
      <LibraryPane />
      <div className="wm-scroll min-h-0 flex-1">
        <div className="mx-auto max-w-5xl px-4 py-8 sm:px-8">
          <div className="flex flex-wrap items-end gap-3">
            <div className="min-w-0">
              {currentFolder && (
                <button className="mb-1 flex items-center gap-1 text-[12.5px] text-muted hover:text-fg" onClick={() => setState({ currentFolder: currentFolder.includes('/') ? currentFolder.slice(0, currentFolder.lastIndexOf('/')) : null })}>
                  <FolderOpen size={13} /> {currentFolder.includes('/') ? currentFolder.slice(0, currentFolder.lastIndexOf('/')).split('/').join(' / ') : 'Library'}
                </button>
              )}
              <h1 className="truncate text-[26px] font-bold tracking-[-0.02em]">{heading}</h1>
              <p className="mt-0.5 text-[13.5px] text-muted">
                {currentFolder ? 'A folder of roadmaps. New roadmaps and imports go here.' : 'Each roadmap is a folder of Markdown files you own. You and your agents edit the same files.'}
              </p>
            </div>
            <div className="ml-auto flex gap-2">
              <Button onClick={onImport}>
                <Upload size={14} /> Import
              </Button>
              <Button variant="primary" onClick={() => setState({ dialog: 'new' })}>
                <Plus size={14} /> New roadmap
              </Button>
            </div>
          </div>

          {problems.length > 0 && (
            <div className="mt-5 rounded-xl border border-review/40 bg-warn-soft p-3 text-[12.5px]">
              {problems.map((p) => (
                <div key={p.file}>
                  <b>{p.file}</b>: {p.message}
                </div>
              ))}
            </div>
          )}

          {ready && summaries.length === 0 && !currentFolder ? (
            <div className="mt-10 rounded-2xl border border-dashed border-line-strong p-10 text-center">
              <div className="text-[15px] font-semibold">No roadmaps yet</div>
              <p className="mx-auto mt-1 max-w-md text-[13.5px] leading-relaxed text-muted">Create one for a goal or project, import a backup or a Markdown outline, or ask an agent to draft one in your workspace folder.</p>
              <div className="mt-4 flex justify-center gap-2">
                <Button variant="primary" onClick={() => setState({ dialog: 'new' })}>
                  <Plus size={14} /> New roadmap
                </Button>
                <Button onClick={() => setState({ dialog: 'agent' })}>
                  <Bot size={14} /> Use an agent
                </Button>
              </div>
            </div>
          ) : (
            groups.map((g) => (
              <section key={g.folder || '_top'} className="mt-7">
                <h2 className="mb-2.5 flex items-center gap-1.5 text-[13px] font-semibold text-muted">
                  {g.folder ? <Folder size={14} className="text-review" /> : null}
                  {g.folder ? g.folder.split('/').join(' / ') : 'Top level'}
                  <span className="font-normal text-faint">{g.items.length}</span>
                </h2>
                {g.items.length === 0 ? (
                  <div className="rounded-lg border border-dashed border-line-strong p-5 text-[13px] text-muted">This folder is empty. Create a roadmap here, import one, or drag one onto the folder in the library.</div>
                ) : (
                  <ul className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
                    {g.items.map((s) => (
                      <li key={s.id}>
                        <button
                          onClick={() => navigate({ page: 'roadmap', id: s.id })}
                          className="relative flex h-full w-full flex-col overflow-hidden rounded-lg border-[1.5px] border-ink/25 bg-surface p-4 pt-5 text-left transition-[border-color,box-shadow] hover:border-ink hover:shadow-[3px_3px_0_var(--ink)]"
                        >
                          <span aria-hidden className="absolute inset-x-0 top-0 h-1.5" style={{ background: COLOR_HEX[s.color] }} />
                          <div className="flex items-center gap-2 text-[11.5px] text-faint">
                            <span>{getProfile(s.profile).label}</span>
                            {s.updated && <span>· {relTime(s.updated)}</span>}
                            {s.problems > 0 && (
                              <Chip tone="warn" className="ml-auto">
                                {s.problems} file issue{s.problems > 1 ? 's' : ''}
                              </Chip>
                            )}
                          </div>
                          <div className="mt-1 text-[15px] font-semibold leading-snug tracking-[-0.01em]">{s.title}</div>
                          {s.description && <p className="mt-1 line-clamp-2 text-[12.5px] leading-relaxed text-muted">{s.description}</p>}
                          <div className="mt-auto pt-4">
                            <ProgressBar done={s.done} review={0} active={0} total={s.total} />
                            <div className="mt-1.5 flex gap-3 text-[12px] text-muted">
                              <span>
                                {s.done} of {s.total} complete
                              </span>
                              {s.profile === 'learning' && <span>{s.understood} understood</span>}
                              {s.drafts > 0 && <span className="ml-auto text-faint">{s.drafts} draft</span>}
                            </div>
                          </div>
                        </button>
                      </li>
                    ))}
                  </ul>
                )}
              </section>
            ))
          )}

          <footer className="mt-10 grid gap-1 border-t border-line pt-4 text-[12px] text-faint">
            <div className="flex items-center gap-1.5">
              <FolderOpen size={13} /> Workspace: <code className="font-mono">{workspace}</code>
            </div>
            <div>Backups: one export per roadmap each day in <code className="font-mono">backups/</code> (last 30 days). For off-machine safety, put the workspace in a synced folder or a git repository.</div>
          </footer>
        </div>
      </div>
    </div>
  );
}

// ------------------------------------------------------------------ roadmap view

function useMedia(q: string) {
  const [m, setM] = useState(() => matchMedia(q).matches);
  useEffect(() => {
    const mq = matchMedia(q);
    const on = () => setM(mq.matches);
    mq.addEventListener('change', on);
    return () => mq.removeEventListener('change', on);
  }, [q]);
  return m;
}

const isTyping = (t: EventTarget | null) => {
  const el = t as HTMLElement | null;
  if (!el) return false;
  return el.isContentEditable || ['INPUT', 'TEXTAREA', 'SELECT'].includes(el.tagName) || !!el.closest('[contenteditable="true"], .milkdown');
};

export function RoadmapView() {
  const rm = useStore((s) => s.roadmap);
  const loadError = useStore((s) => s.loadError);
  const expanded = useStore((s) => s.expanded);
  const focusId = useStore((s) => s.focusId);
  const outlineOpen = useStore((s) => s.outlineOpen);
  const outlineDrawer = useStore((s) => s.outlineDrawer);
  const detailsOpen = useStore((s) => s.detailsOpen);
  const pageMode = useStore((s) => s.pageMode);
  const selectedId = useStore((s) => s.selectedId);
  const wide = useMedia('(min-width: 1024px)');
  const medium = useMedia('(min-width: 768px)');
  const [pendingDelete, setPendingDelete] = useState<string | null>(null);
  const [detailsWidth, setDetailsWidth] = useState(() => Number(localStorage.getItem('waymark.detailsWidth')) || 460);

  const layout = useMemo(() => (rm ? computeLayout(rm, expanded, focusId) : null), [rm, expanded, focusId]);
  const progress = useMemo(() => (rm ? computeProgress(rm.checkpoints, rm.meta) : new Map()), [rm]);
  const layoutRef = useRef(layout);
  layoutRef.current = layout;

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const s = getState();
      if (!s.roadmap || s.dialog || s.reviewOpen) return;
      if (document.querySelector('[role="dialog"], [role="menu"]')) return;
      if (isTyping(e.target)) return;
      const cps = s.roadmap.checkpoints;
      const sel = s.selectedId && cps[s.selectedId] ? s.selectedId : null;
      const order = layoutRef.current?.order ?? [];
      const key = e.key;
      const mod = e.ctrlKey || e.metaKey;
      const go = (id: string | undefined) => {
        if (id) {
          e.preventDefault();
          selectCheckpoint(id, { center: true });
        }
      };
      if (mod && key.toLowerCase() === 'z' && !e.shiftKey) {
        e.preventDefault();
        void undoLast();
        return;
      }
      if (mod || (e.altKey && !key.startsWith('Arrow'))) return;
      if (key === '?') return setState({ dialog: 'shortcuts' });
      if (key === 'r' || key === 'R') return setState({ reviewOpen: true });
      if (key === 'o' || key === 'O') return overview();
      if (key === 'Escape') {
        if (s.pageMode) return setState({ pageMode: false });
        if (sel) return selectCheckpoint(null);
        if (s.focusId) return overview();
        return;
      }
      if (!sel) {
        if (key.startsWith('Arrow') || key === 'Enter') go(order[0]);
        if (key === 'a' || key === 'A' || key === 'n' || key === 'N') {
          e.preventDefault();
          addCheckpoint(null);
        }
        return;
      }
      const cp = cps[sel]!;
      const kids = Object.values(cps).filter((c) => c.parent === sel && !c.archived);
      const isOpen = s.expanded.has(sel) || (s.focusId !== null && s.focusId === sel);
      if (e.altKey && key === 'ArrowUp') return e.preventDefault(), shiftCheckpoint(sel, -1);
      if (e.altKey && key === 'ArrowDown') return e.preventDefault(), shiftCheckpoint(sel, 1);
      switch (key) {
        case 'ArrowDown':
          return go(order[order.indexOf(sel) + 1]);
        case 'ArrowUp':
          return go(order[order.indexOf(sel) - 1]);
        case 'ArrowLeft':
          e.preventDefault();
          if (kids.length && isOpen) return toggleExpanded(sel, false);
          return go(cp.parent ?? undefined);
        case 'ArrowRight':
          e.preventDefault();
          if (!kids.length) return;
          if (!isOpen) return toggleExpanded(sel, true);
          return go(order[order.indexOf(sel) + 1]);
        case ' ':
          e.preventDefault();
          if (kids.length) toggleExpanded(sel);
          return;
        case 'Enter':
          e.preventDefault();
          setState({ detailsOpen: true, pendingTitleEdit: sel });
          return;
        case 'a':
        case 'A':
          e.preventDefault();
          addCheckpoint(sel);
          return;
        case 'n':
        case 'N':
          e.preventDefault();
          addSibling(sel);
          return;
        case 'f':
        case 'F':
          return setFocus(sel);
        case 'Tab':
          e.preventDefault();
          return e.shiftKey ? outdent(sel) : indent(sel);
        case 'Delete':
        case 'Backspace':
          e.preventDefault();
          if (needsDeleteConfirm(cp)) setPendingDelete(sel);
          else void deleteCheckpoint(sel);
          return;
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  if (loadError) {
    return (
      <div className="flex flex-1 items-center justify-center p-8">
        <div className="max-w-sm text-center">
          <div className="text-[15px] font-semibold">Couldn't open this roadmap</div>
          <p className="mt-1 text-[13px] text-muted">{loadError}</p>
          <Button className="mt-4" onClick={() => navigate({ page: 'home' })}>
            All roadmaps
          </Button>
        </div>
      </div>
    );
  }
  if (!rm || !layout) return <div className="flex flex-1 items-center justify-center text-[13px] text-faint">Loading…</div>;

  const showDetailsSide = detailsOpen && medium && !pageMode;
  const detailsOverlay = !medium && (selectedId !== null || pageMode);

  return (
    <div className="flex min-h-0 flex-1">
      <LibraryPane />
      {outlineOpen && wide && !pageMode && (
        <aside className="w-[268px] flex-none border-r border-line bg-surface" aria-label="Outline">
          <Outline rm={rm} progress={progress} />
        </aside>
      )}
      {!wide && (
        <Drawer open={outlineDrawer} onOpenChange={(o) => setState({ outlineDrawer: o })} title="Outline" side="left" width="w-[min(320px,88vw)]">
          <Outline rm={rm} progress={progress} />
        </Drawer>
      )}
      <main className={cx('relative min-w-0 flex-1', pageMode && medium && 'hidden')} aria-label="Roadmap map">
        <ReactFlowProvider>
          <MapCanvas rm={rm} layout={layout} progress={progress} />
        </ReactFlowProvider>
        {rm.problems.length > 0 && <ProblemsBanner />}
      </main>
      {pageMode && medium && (
        <section className="min-w-0 flex-1 bg-surface" aria-label="Checkpoint page">
          <DetailsPanel rm={rm} progress={progress} />
        </section>
      )}
      {showDetailsSide && (
        <aside className="relative flex-none border-l border-line bg-surface" style={{ width: Math.min(detailsWidth, wide ? 720 : 520) }} aria-label="Details">
          <ResizeHandle
            onResize={(w) => {
              setDetailsWidth(w);
              try {
                localStorage.setItem('waymark.detailsWidth', String(w));
              } catch {
                /* fine */
              }
            }}
          />
          <DetailsPanel rm={rm} progress={progress} />
        </aside>
      )}
      {detailsOverlay && (
        <div className="fixed inset-x-0 bottom-0 top-12 z-40 border-t border-line bg-surface shadow-lg">
          <DetailsPanel rm={rm} progress={progress} />
        </div>
      )}
      <Modal
        open={!!pendingDelete}
        onOpenChange={(o) => !o && setPendingDelete(null)}
        title={`Delete “${pendingDelete ? rm.checkpoints[pendingDelete]?.title : ''}”?`}
        description="It has content, progress or sub-checkpoints. It goes to Trash, and Ctrl+Z brings it back."
        footer={
          <>
            <Button variant="ghost" onClick={() => setPendingDelete(null)}>
              Cancel
            </Button>
            <Button
              variant="danger"
              onClick={() => {
                const id = pendingDelete;
                setPendingDelete(null);
                if (id) void deleteCheckpoint(id);
              }}
            >
              Delete
            </Button>
          </>
        }
      />
    </div>
  );
}

function ResizeHandle({ onResize }: { onResize: (w: number) => void }) {
  return (
    <div
      role="separator"
      aria-orientation="vertical"
      aria-label="Resize details panel"
      className="absolute -left-1 top-0 z-10 h-full w-2 cursor-col-resize hover:bg-accent/20"
      onPointerDown={(e) => {
        const startX = e.clientX;
        const startW = (e.currentTarget.parentElement as HTMLElement).offsetWidth;
        const move = (ev: PointerEvent) => onResize(Math.max(340, Math.min(760, startW + (startX - ev.clientX))));
        const up = () => {
          window.removeEventListener('pointermove', move);
          window.removeEventListener('pointerup', up);
        };
        window.addEventListener('pointermove', move);
        window.addEventListener('pointerup', up);
      }}
    />
  );
}

function ProblemsBanner() {
  const rm = useStore((s) => s.roadmap)!;
  return (
    <div className="absolute bottom-3 left-1/2 z-20 w-[min(560px,calc(100%-24px))] -translate-x-1/2 rounded-xl border border-review/40 bg-surface p-3 shadow-md">
      <div className="flex items-center gap-2 text-[13px] font-semibold text-review">
        <TriangleExclamationPoint size={15} /> {rm.problems.length} file{rm.problems.length > 1 ? 's' : ''} can't be read
      </div>
      <ul className="mt-1.5 grid gap-1.5 text-[12.5px]">
        {rm.problems.map((p) => (
          <li key={p.file} className="flex items-start gap-2">
            <div className="min-w-0 flex-1">
              <code className="font-mono">{p.file}</code>
              <div className="text-muted">{p.message}</div>
            </div>
            <Tip label="Overwrite the file with the last good version Waymark has. The damaged text is saved in .waymark/broken.">
              <Button
                size="sm"
                onClick={async () => {
                  try {
                    await http.post(`/api/roadmaps/${rm.meta.id}/problems/resolve`, { file: p.file });
                    toast.success('Restored the last good version.');
                  } catch (e) {
                    toast.error((e as Error).message);
                  }
                }}
              >
                Restore
              </Button>
            </Tip>
          </li>
        ))}
      </ul>
      <p className="mt-2 text-[12px] text-faint">Waymark keeps showing the last good version and won't overwrite these files. Fix them in an editor (or ask the agent), or restore.</p>
    </div>
  );
}
