// The Library: every roadmap in the workspace, grouped in folders, always one click away
// (like the notebook and section list in OneNote). Folders are real folders on disk.

import { useEffect, useMemo, useState, type DragEvent, type ReactNode } from 'react';
import { toast } from 'sonner';
import {
  ChevronRight,
  Download,
  Ellipsis,
  Folder,
  FolderInput,
  FolderOpen,
  FolderPlus,
  Pencil,
  Plus,
  Search,
  Settings,
  Trash,
  Upload,
  X,
} from 'lucide-react';
import { ROADMAP_COLORS, type RoadmapColor, type RoadmapSummary } from '../../shared/model';
import { http } from '../api';
import { getState, navigate, refreshLibrary, setState, useStore } from '../store';
import { Button, IconButton, Menu, Modal, Tip, cx } from './ui';

export const COLOR_HEX: Record<RoadmapColor, string> = {
  yellow: '#facc15',
  orange: '#fb923c',
  red: '#f87171',
  pink: '#f472b6',
  purple: '#a78bfa',
  blue: '#60a5fa',
  teal: '#2dd4bf',
  green: '#4ade80',
  gray: '#a8a29e',
};

const DRAG_TYPE = 'application/x-waymark-roadmap';
const COLLAPSE_KEY = 'waymark.collapsedFolders';
const base = (p: string) => p.split('/').pop() ?? p;
const parentOf = (p: string) => (p.includes('/') ? p.slice(0, p.lastIndexOf('/')) : '');

export async function moveRoadmapTo(id: string, folder: string) {
  try {
    await http.post(`/api/roadmaps/${id}/move`, { folder });
    await refreshLibrary();
    toast.success(folder ? `Moved to ${base(folder)}` : 'Moved to the top level');
  } catch (e) {
    toast.error((e as Error).message);
  }
}

export async function setRoadmapColor(id: string, color: RoadmapColor) {
  try {
    await http.patch(`/api/roadmaps/${id}`, { color });
    await refreshLibrary();
  } catch (e) {
    toast.error((e as Error).message);
  }
}

type Prompt = { kind: 'new-folder'; parent: string } | { kind: 'rename-folder'; path: string } | null;

export function LibrarySidebar({ onPick }: { onPick?: () => void }) {
  const summaries = useStore((s) => s.summaries);
  const folders = useStore((s) => s.folders);
  const currentId = useStore((s) => s.roadmap?.meta.id ?? null);
  const currentFolder = useStore((s) => s.currentFolder);
  const route = useStore((s) => s.route);
  const [filter, setFilter] = useState('');
  const [collapsed, setCollapsed] = useState<Set<string>>(() => {
    try {
      return new Set(JSON.parse(localStorage.getItem(COLLAPSE_KEY) ?? '[]') as string[]);
    } catch {
      return new Set();
    }
  });
  const [prompt, setPrompt] = useState<Prompt>(null);
  const [dropTarget, setDropTarget] = useState<string | null>(null);
  const [confirmFolder, setConfirmFolder] = useState<string | null>(null);

  const toggle = (f: string) => {
    const next = new Set(collapsed);
    if (next.has(f)) next.delete(f);
    else next.add(f);
    setCollapsed(next);
    try {
      localStorage.setItem(COLLAPSE_KEY, JSON.stringify([...next]));
    } catch {
      /* fine */
    }
  };

  // Keep the folder of the open roadmap expanded.
  useEffect(() => {
    const rm = summaries.find((r) => r.id === currentId);
    if (!rm?.folder) return;
    const chain = rm.folder.split('/').map((_, i, a) => a.slice(0, i + 1).join('/'));
    if (chain.some((f) => collapsed.has(f))) setCollapsed(new Set([...collapsed].filter((f) => !chain.includes(f))));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentId]);

  const q = filter.trim().toLowerCase();
  const matches = (r: RoadmapSummary) => !q || r.title.toLowerCase().includes(q) || r.folder.toLowerCase().includes(q);
  const byFolder = useMemo(() => {
    const m = new Map<string, RoadmapSummary[]>();
    for (const r of summaries.filter(matches)) {
      if (!m.has(r.folder)) m.set(r.folder, []);
      m.get(r.folder)!.push(r);
    }
    for (const list of m.values()) list.sort((a, b) => a.title.localeCompare(b.title));
    return m;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [summaries, q]);
  const childFolders = (p: string) => folders.filter((f) => parentOf(f) === p);
  const folderHasMatch = (f: string): boolean => !q || (byFolder.get(f)?.length ?? 0) > 0 || base(f).toLowerCase().includes(q) || childFolders(f).some(folderHasMatch);

  const onDrop = (e: DragEvent, folder: string) => {
    e.preventDefault();
    e.stopPropagation(); // a folder inside the library list must not also count as a drop on the top level
    setDropTarget(null);
    const id = e.dataTransfer.getData(DRAG_TYPE);
    const r = summaries.find((s) => s.id === id);
    if (r && r.folder !== folder) void moveRoadmapTo(id, folder);
  };
  const dropProps = (folder: string) => ({
    onDragOver: (e: DragEvent) => {
      if (e.dataTransfer.types.includes(DRAG_TYPE)) {
        e.preventDefault();
        e.stopPropagation();
        e.dataTransfer.dropEffect = 'move';
        setDropTarget(folder);
      }
    },
    onDragLeave: () => setDropTarget((t) => (t === folder ? null : t)),
    onDrop: (e: DragEvent) => onDrop(e, folder),
  });

  const open = (r: RoadmapSummary) => {
    setState({ currentFolder: r.folder || null });
    navigate({ page: 'roadmap', id: r.id });
    onPick?.();
  };

  const renderFolder = (f: string, depth: number): ReactNode => {
    if (!folderHasMatch(f)) return null;
    const isOpen = !collapsed.has(f) || !!q;
    const items = byFolder.get(f) ?? [];
    const count = summaries.filter((r) => r.folder === f || r.folder.startsWith(f + '/')).length;
    const selected = route.page === 'home' && currentFolder === f;
    return (
      <li key={`f:${f}`}>
        <div
          {...dropProps(f)}
          className={cx(
            'group flex h-8 items-center gap-1 rounded-md pr-1 text-[13px]',
            dropTarget === f ? 'bg-accent-soft ring-1 ring-accent' : selected ? 'bg-surface-3' : 'hover:bg-surface-2',
          )}
          style={{ paddingLeft: 4 + depth * 14 }}
        >
          <button className="flex size-5 flex-none items-center justify-center rounded text-faint hover:text-fg" aria-label={isOpen ? `Collapse ${base(f)}` : `Expand ${base(f)}`} onClick={() => toggle(f)}>
            <ChevronRight size={13} className={cx('transition-transform', isOpen && 'rotate-90')} />
          </button>
          <button
            className="flex min-w-0 flex-1 items-center gap-1.5 text-left"
            onClick={() => {
              setState({ currentFolder: f });
              navigate({ page: 'home' });
              onPick?.();
            }}
            onDoubleClick={() => setPrompt({ kind: 'rename-folder', path: f })}
          >
            {isOpen ? <FolderOpen size={15} className="flex-none text-review" /> : <Folder size={15} className="flex-none text-review" />}
            <span className="truncate font-medium">{base(f)}</span>
            <span className="ml-auto pl-1 text-[11px] tabular-nums text-faint">{count || ''}</span>
          </button>
          <FolderMenu folder={f} depth={depth} onPrompt={setPrompt} onDelete={() => setConfirmFolder(f)} />
        </div>
        {isOpen && (
          <ul>
            {childFolders(f).map((c) => renderFolder(c, depth + 1))}
            {items.map((r) => (
              <RoadmapRow key={r.id} r={r} depth={depth + 1} active={r.id === currentId} onOpen={() => open(r)} />
            ))}
            {!items.length && !childFolders(f).length && !q && (
              <li className="py-1 text-[12px] italic text-faint" style={{ paddingLeft: 30 + (depth + 1) * 14 }}>
                Empty. Drag a roadmap here
              </li>
            )}
          </ul>
        )}
      </li>
    );
  };

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex items-center gap-1 px-3 pb-2 pt-3">
        <button
          className={cx('rounded px-1 text-[12px] font-semibold hover:text-fg', route.page === 'home' && currentFolder === null ? 'text-fg' : 'text-muted')}
          onClick={() => {
            setState({ currentFolder: null });
            navigate({ page: 'home' });
            onPick?.();
          }}
        >
          Library
        </button>
        <div className="ml-auto flex items-center">
          <IconButton size="sm" label="New folder" onClick={() => setPrompt({ kind: 'new-folder', parent: getState().currentFolder ?? '' })}>
            <FolderPlus size={15} />
          </IconButton>
          <IconButton size="sm" label="New roadmap" onClick={() => setState({ dialog: 'new' })}>
            <Plus size={15} />
          </IconButton>
        </div>
      </div>
      <div className="px-3 pb-2">
        <label className="flex h-8 items-center gap-2 rounded-md border border-line bg-surface-2 px-2.5 text-muted focus-within:border-accent">
          <Search size={13} />
          <input value={filter} onChange={(e) => setFilter(e.target.value)} placeholder="Find a roadmap" aria-label="Find a roadmap" className="min-w-0 flex-1 bg-transparent text-[12.5px] text-fg outline-none placeholder:text-faint" />
          {filter && (
            <button aria-label="Clear" onClick={() => setFilter('')}>
              <X size={13} />
            </button>
          )}
        </label>
      </div>
      <nav className="wm-scroll min-h-0 flex-1 px-2 pb-3" aria-label="Library" {...dropProps('')}>
        <ul className={cx('min-h-full rounded-md', dropTarget === '' && 'bg-accent-soft/50')}>
          {childFolders('').map((f) => renderFolder(f, 0))}
          {(byFolder.get('') ?? []).map((r) => (
            <RoadmapRow key={r.id} r={r} depth={0} active={r.id === currentId} onOpen={() => open(r)} />
          ))}
          {!summaries.length && !folders.length && <li className="px-2 py-4 text-[12.5px] leading-relaxed text-muted">No roadmaps yet. Use + to create one, or a folder to organise them.</li>}
          {q && !summaries.some(matches) && <li className="px-2 py-3 text-[12.5px] text-muted">Nothing matches “{filter}”.</li>}
        </ul>
      </nav>
      <div className="flex gap-1 border-t border-line px-2 py-2">
        <Button size="sm" variant="ghost" className="flex-1" onClick={() => setState({ dialog: 'import' })}>
          <Upload size={13} /> Import
        </Button>
        <Button size="sm" variant="ghost" className="flex-1" disabled={!currentId} onClick={() => setState({ dialog: 'export', exportTarget: null })}>
          <Download size={13} /> Export
        </Button>
      </div>
      <NamePrompt prompt={prompt} onClose={() => setPrompt(null)} />
      <Modal
        open={!!confirmFolder}
        onOpenChange={(o) => !o && setConfirmFolder(null)}
        title={`Delete the folder “${confirmFolder ? base(confirmFolder) : ''}”?`}
        description="Only empty folders can be deleted. Move its roadmaps somewhere else first."
        footer={
          <>
            <Button variant="ghost" onClick={() => setConfirmFolder(null)}>
              Cancel
            </Button>
            <Button
              variant="danger"
              onClick={async () => {
                const f = confirmFolder;
                setConfirmFolder(null);
                try {
                  await http.del(`/api/folders?path=${encodeURIComponent(f ?? '')}`);
                  await refreshLibrary();
                } catch (e) {
                  toast.error((e as Error).message);
                }
              }}
            >
              Delete folder
            </Button>
          </>
        }
      />
    </div>
  );
}

function RoadmapRow({ r, depth, active, onOpen }: { r: RoadmapSummary; depth: number; active: boolean; onOpen: () => void }) {
  const pct = r.total ? Math.round((r.done / r.total) * 100) : null;
  const color = COLOR_HEX[r.color];
  return (
    <li>
      <div
        draggable
        onDragStart={(e) => {
          e.dataTransfer.setData(DRAG_TYPE, r.id);
          e.dataTransfer.effectAllowed = 'move';
        }}
        onContextMenu={(e) => {
          e.preventDefault();
          (e.currentTarget.querySelector('[data-menu-trigger]') as HTMLButtonElement | null)?.click();
        }}
        className={cx('group relative my-px flex h-8 items-center gap-2 rounded-md pr-1 text-[13px]', active ? 'font-semibold' : 'hover:bg-surface-2')}
        style={{
          paddingLeft: 10 + depth * 14,
          background: active ? `color-mix(in srgb, ${color} 22%, transparent)` : undefined,
        }}
      >
        <span aria-hidden className="absolute bottom-1 top-1 w-[5px] rounded-sm" style={{ left: 2 + depth * 14, background: color }} />
        <button dir="auto" className="min-w-0 flex-1 truncate pl-2 text-start" onClick={onOpen} title={r.description || r.title}>
          {r.title}
        </button>
        {pct !== null && <span className={cx('flex-none text-[11px] tabular-nums', active ? 'text-muted' : 'text-faint')}>{pct}%</span>}
        <RoadmapMenu r={r} />
      </div>
    </li>
  );
}

export function ColorSwatches({ value, onPick }: { value?: RoadmapColor; onPick: (c: RoadmapColor) => void }) {
  return (
    <div className="flex flex-wrap gap-1.5" role="radiogroup" aria-label="Colour">
      {ROADMAP_COLORS.map((c) => (
        <button
          key={c}
          role="radio"
          aria-checked={value === c}
          aria-label={c}
          onClick={() => onPick(c)}
          className={cx('size-6 rounded-md border-2', value === c ? 'border-ink' : 'border-transparent hover:border-line-strong')}
          style={{ background: COLOR_HEX[c] }}
        />
      ))}
    </div>
  );
}

function RoadmapMenu({ r }: { r: RoadmapSummary }) {
  const folders = useStore((s) => s.folders);
  return (
    <Menu.Root>
      <Menu.Trigger asChild>
        <button data-menu-trigger aria-label={`Actions for ${r.title}`} className="flex size-6 flex-none items-center justify-center rounded text-faint opacity-0 hover:bg-surface-3 hover:text-fg focus:opacity-100 group-hover:opacity-100 data-[state=open]:opacity-100">
          <Ellipsis size={14} />
        </button>
      </Menu.Trigger>
      <Menu.Content align="start" className="w-60">
        <Menu.Label>Colour</Menu.Label>
        <div className="px-2.5 pb-2">
          <ColorSwatches value={r.color} onPick={(c) => void setRoadmapColor(r.id, c)} />
        </div>
        <Menu.Separator />
        <Menu.Sub>
          <Menu.SubTrigger>
            <FolderInput size={14} /> Move to
          </Menu.SubTrigger>
          <Menu.SubContent>
            <Menu.Item disabled={r.folder === ''} onSelect={() => void moveRoadmapTo(r.id, '')}>
              Top level
            </Menu.Item>
            {folders.map((f) => (
              <Menu.Item key={f} disabled={r.folder === f} onSelect={() => void moveRoadmapTo(r.id, f)}>
                <span style={{ paddingLeft: (f.split('/').length - 1) * 12 }}>{base(f)}</span>
              </Menu.Item>
            ))}
          </Menu.SubContent>
        </Menu.Sub>
        <Menu.Item onSelect={() => setState({ dialog: 'export', exportTarget: r.id })}>
          <Download size={14} /> Export…
        </Menu.Item>
        <Menu.Item
          onSelect={() => {
            navigate({ page: 'roadmap', id: r.id });
            setTimeout(() => setState({ dialog: 'settings' }), 150);
          }}
        >
          <Settings size={14} /> Settings, rename, delete…
        </Menu.Item>
      </Menu.Content>
    </Menu.Root>
  );
}

function FolderMenu({ folder, depth, onPrompt, onDelete }: { folder: string; depth: number; onPrompt: (p: Prompt) => void; onDelete: () => void }) {
  return (
    <Menu.Root>
      <Menu.Trigger asChild>
        <button aria-label={`Actions for folder ${base(folder)}`} className="flex size-6 flex-none items-center justify-center rounded text-faint opacity-0 hover:bg-surface-3 hover:text-fg focus:opacity-100 group-hover:opacity-100 data-[state=open]:opacity-100">
          <Ellipsis size={14} />
        </button>
      </Menu.Trigger>
      <Menu.Content align="start">
        <Menu.Item
          onSelect={() => {
            setState({ currentFolder: folder, dialog: 'new' });
          }}
        >
          <Plus size={14} /> New roadmap here
        </Menu.Item>
        <Menu.Item disabled={depth >= 3} onSelect={() => onPrompt({ kind: 'new-folder', parent: folder })}>
          <FolderPlus size={14} /> New folder inside
        </Menu.Item>
        <Menu.Item onSelect={() => setState({ currentFolder: folder, dialog: 'import' })}>
          <Upload size={14} /> Import into this folder…
        </Menu.Item>
        <Menu.Separator />
        <Menu.Item onSelect={() => onPrompt({ kind: 'rename-folder', path: folder })}>
          <Pencil size={14} /> Rename
        </Menu.Item>
        <Menu.Item danger onSelect={onDelete}>
          <Trash size={14} /> Delete folder…
        </Menu.Item>
      </Menu.Content>
    </Menu.Root>
  );
}

function NamePrompt({ prompt, onClose }: { prompt: Prompt; onClose: () => void }) {
  const [name, setName] = useState('');
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    setError(null);
    setName(prompt?.kind === 'rename-folder' ? base(prompt.path) : '');
  }, [prompt]);
  const submit = async () => {
    if (!prompt) return;
    try {
      if (prompt.kind === 'new-folder') {
        const res = await http.post<{ path: string }>('/api/folders', { parent: prompt.parent, name });
        setState({ currentFolder: res.path });
      } else {
        const res = await http.patch<{ path: string }>('/api/folders', { path: prompt.path, name });
        if (getState().currentFolder === prompt.path) setState({ currentFolder: res.path });
      }
      await refreshLibrary();
      onClose();
    } catch (e) {
      setError((e as Error).message);
    }
  };
  const title = prompt?.kind === 'rename-folder' ? 'Rename folder' : prompt?.parent ? `New folder in “${base(prompt.parent)}”` : 'New folder';
  return (
    <Modal
      open={!!prompt}
      onOpenChange={(o) => !o && onClose()}
      title={title}
      description={prompt?.kind === 'new-folder' ? 'Folders group roadmaps, for example by subject, semester or project. They are real folders on disk.' : undefined}
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button variant="primary" disabled={!name.trim()} onClick={() => void submit()}>
            {prompt?.kind === 'rename-folder' ? 'Rename' : 'Create folder'}
          </Button>
        </>
      }
    >
      <form
        onSubmit={(e) => {
          e.preventDefault();
          void submit();
        }}
      >
        <input
          autoFocus
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="e.g. Semester 5, Projects, AI"
          aria-label="Folder name"
          className="h-9 w-full rounded-md border border-line bg-surface px-3 text-[13.5px] outline-none focus:border-accent"
        />
        {error && <div className="mt-2 text-[12.5px] text-danger">{error}</div>}
      </form>
    </Modal>
  );
}
