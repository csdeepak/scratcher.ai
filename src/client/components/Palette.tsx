import { useEffect, useMemo, useState } from 'react';
import { Command } from 'cmdk';
import { Dialog } from 'radix-ui';
import { ArrowRight, Bot, Cable, Download, FolderOpen, Upload, Focus, House, Inbox, Keyboard, Map as MapIcon, Moon, Plus, Search, SlidersHorizontal, Sun } from 'lucide-react';
import { http } from '../api';
import { getState, navigate, overview, selectCheckpoint, setFocus, setState, setTheme, useStore } from '../store';
import { addCheckpoint } from '../actions';
import { customiseToolbar } from '../toolbars';
import { Kbd } from './ui';

interface Hit {
  roadmapId: string;
  roadmapTitle: string;
  id: string;
  title: string;
  field: string;
  snippet: string;
}

const FIELD_LABEL: Record<string, string> = {
  title: 'Title',
  summary: 'Summary',
  resources: 'Resources',
  content: 'Content',
  notes: 'My notes',
  takeaways: 'Takeaways',
  questions: 'Questions',
  objectives: 'Objectives',
  known: 'Already know',
  toLearn: 'Need to learn',
  practice: 'Practice',
  evidence: 'Evidence',
  ownWords: 'Own words',
};

export function CommandPalette() {
  const open = useStore((s) => s.dialog === 'palette');
  const rm = useStore((s) => s.roadmap);
  const summaries = useStore((s) => s.summaries);
  const selectedId = useStore((s) => s.selectedId);
  const [q, setQ] = useState('');
  const [hits, setHits] = useState<Hit[]>([]);

  useEffect(() => {
    if (!open) setQ('');
  }, [open]);
  useEffect(() => {
    if (!q.trim()) {
      setHits([]);
      return;
    }
    const t = setTimeout(() => void http.get<Hit[]>(`/api/search?q=${encodeURIComponent(q)}`).then(setHits).catch(() => {}), 110);
    return () => clearTimeout(t);
  }, [q]);

  const close = () => setState({ dialog: null });
  const run = (fn: () => void) => {
    close();
    setTimeout(fn, 0);
  };

  const sortedHits = useMemo(() => {
    const cur = rm?.meta.id;
    return [...hits].sort((a, b) => Number(b.roadmapId === cur) - Number(a.roadmapId === cur));
  }, [hits, rm]);

  const item = 'flex cursor-pointer items-center gap-2.5 rounded-lg px-2.5 py-2 text-[13px] data-[selected=true]:bg-surface-2';
  return (
    <Dialog.Root open={open} onOpenChange={(o) => setState({ dialog: o ? 'palette' : null })}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-[60] bg-black/25" />
        <Dialog.Content className="fixed left-1/2 top-[12vh] z-[61] w-[calc(100vw-32px)] max-w-xl -translate-x-1/2 overflow-hidden rounded-2xl border border-line bg-surface shadow-lg outline-none">
          <Dialog.Title className="sr-only">Search and commands</Dialog.Title>
          <Dialog.Description className="sr-only">Search checkpoints and notes across all roadmaps, or run a command.</Dialog.Description>
          <Command label="Search and commands" shouldFilter={false} loop>
            <div className="flex items-center gap-2 border-b border-line px-3.5">
              <Search size={16} className="text-faint" />
              <Command.Input value={q} onValueChange={setQ} autoFocus placeholder="Search titles and notes, or type a command…" className="h-12 min-w-0 flex-1 bg-transparent text-[14px] outline-none placeholder:text-faint" />
              <Kbd>Esc</Kbd>
            </div>
            <Command.List className="max-h-[60vh] overflow-y-auto p-1.5">
              {q.trim() && hits.length === 0 && <Command.Empty className="px-3 py-6 text-center text-[13px] text-muted">No checkpoints match “{q}”.</Command.Empty>}
              {sortedHits.length > 0 && (
                <Command.Group heading="Checkpoints" className="[&_[cmdk-group-heading]]:px-2.5 [&_[cmdk-group-heading]]:py-1.5 [&_[cmdk-group-heading]]:text-[11.5px] [&_[cmdk-group-heading]]:font-medium [&_[cmdk-group-heading]]:text-faint">
                  {sortedHits.map((h) => (
                    <Command.Item
                      key={h.roadmapId + h.id}
                      value={h.roadmapId + h.id}
                      className={item}
                      onSelect={() =>
                        run(() => {
                          if (getState().roadmap?.meta.id === h.roadmapId) selectCheckpoint(h.id, { center: true });
                          else navigate({ page: 'roadmap', id: h.roadmapId, cp: h.id });
                        })
                      }
                    >
                      <ArrowRight size={14} className="flex-none text-faint" />
                      <div className="min-w-0 flex-1">
                        <div className="truncate font-medium">{h.title}</div>
                        {h.field !== 'title' && (
                          <div className="truncate text-[12px] text-muted">
                            <span className="text-faint">{FIELD_LABEL[h.field] ?? h.field}:</span> {h.snippet}
                          </div>
                        )}
                      </div>
                      {h.roadmapId !== rm?.meta.id && <span className="max-w-36 flex-none truncate text-[11.5px] text-faint">{h.roadmapTitle}</span>}
                    </Command.Item>
                  ))}
                </Command.Group>
              )}
              {!q.trim() && (
                <>
                  <Command.Group heading="Actions" className="[&_[cmdk-group-heading]]:px-2.5 [&_[cmdk-group-heading]]:py-1.5 [&_[cmdk-group-heading]]:text-[11.5px] [&_[cmdk-group-heading]]:font-medium [&_[cmdk-group-heading]]:text-faint">
                    {rm && (
                      <Command.Item className={item} onSelect={() => run(() => addCheckpoint(null))}>
                        <Plus size={14} /> Add main checkpoint
                      </Command.Item>
                    )}
                    {rm && selectedId && (
                      <Command.Item className={item} onSelect={() => run(() => addCheckpoint(selectedId))}>
                        <Plus size={14} /> Add sub-checkpoint to the selection
                      </Command.Item>
                    )}
                    {rm && selectedId && (
                      <Command.Item className={item} onSelect={() => run(() => setFocus(selectedId))}>
                        <Focus size={14} /> Focus on the selection
                      </Command.Item>
                    )}
                    {rm && (
                      <Command.Item className={item} onSelect={() => run(() => overview())}>
                        <MapIcon size={14} /> Overview
                      </Command.Item>
                    )}
                    <Command.Item className={item} onSelect={() => run(() => setState({ reviewOpen: true }))}>
                      <Inbox size={14} /> Open Review
                    </Command.Item>
                    <Command.Item className={item} onSelect={() => run(() => setState({ dialog: 'agent' }))}>
                      <Bot size={14} /> Work with an agent
                    </Command.Item>
                    <Command.Item className={item} onSelect={() => run(() => setState({ dialog: 'connect' }))}>
                      <Cable size={14} /> Connect your AI (Claude, ChatGPT, …)
                    </Command.Item>
                    <Command.Item className={item} onSelect={() => run(() => setState({ dialog: 'workspace' }))}>
                      <FolderOpen size={14} /> Workspace folder: change or move
                    </Command.Item>
                    {rm && (
                      <Command.Item className={item} onSelect={() => run(() => setState({ dialog: 'export', exportTarget: null }))}>
                        <Download size={14} /> Export this roadmap (PDF, Markdown, image…)
                      </Command.Item>
                    )}
                    <Command.Item className={item} onSelect={() => run(() => setState({ dialog: 'import' }))}>
                      <Upload size={14} /> Import (backup, Markdown outline, OPML)
                    </Command.Item>
                    <Command.Item className={item} onSelect={() => run(() => setState({ dialog: 'new' }))}>
                      <Plus size={14} /> New roadmap
                    </Command.Item>
                    <Command.Item className={item} onSelect={() => run(() => navigate({ page: 'home' }))}>
                      <House size={14} /> All roadmaps
                    </Command.Item>
                    <Command.Item className={item} onSelect={() => run(() => setTheme(document.documentElement.dataset.theme === 'dark' ? 'light' : 'dark'))}>
                      {document.documentElement.dataset.theme === 'dark' ? <Sun size={14} /> : <Moon size={14} />} Switch theme
                    </Command.Item>
                    <Command.Item className={item} onSelect={() => run(() => setState({ dialog: 'shortcuts' }))}>
                      <Keyboard size={14} /> Keyboard shortcuts
                    </Command.Item>
                    <Command.Item className={item} onSelect={() => run(() => customiseToolbar('map'))}>
                      <SlidersHorizontal size={14} /> Customise the map toolbar
                    </Command.Item>
                    <Command.Item className={item} onSelect={() => run(() => customiseToolbar('notes'))}>
                      <SlidersHorizontal size={14} /> Customise the notes formatting bar
                    </Command.Item>
                  </Command.Group>
                  {summaries.length > 0 && (
                    <Command.Group heading="Roadmaps" className="[&_[cmdk-group-heading]]:px-2.5 [&_[cmdk-group-heading]]:py-1.5 [&_[cmdk-group-heading]]:text-[11.5px] [&_[cmdk-group-heading]]:font-medium [&_[cmdk-group-heading]]:text-faint">
                      {summaries.map((s) => (
                        <Command.Item key={s.id} className={item} onSelect={() => run(() => navigate({ page: 'roadmap', id: s.id }))}>
                          <MapIcon size={14} className="text-faint" /> {s.title}
                          <span className="ml-auto text-[11.5px] text-faint">
                            {s.done}/{s.total}
                          </span>
                        </Command.Item>
                      ))}
                    </Command.Group>
                  )}
                </>
              )}
            </Command.List>
          </Command>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
