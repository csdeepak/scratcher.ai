// Which roadmap and checkpoint "Work with an agent" writes its prompts and briefs for. Defaults to the
// open roadmap and the selected checkpoint, but any can be picked here, so every prompt works from
// anywhere (also the home page). Each picker is the shadcn/ui "Combobox" pattern: a Radix Popover with
// a cmdk searchable list.

import { useEffect, useMemo, useState } from 'react';
import { Command } from 'cmdk';
import { toast } from 'sonner';
import { ChevronDown, Map as MapIcon, Search } from 'lucide-react';
import type { Checkpoint, Roadmap } from '../../shared/model';
import { childrenIndex } from '../../shared/tree';
import { getProfile, statusDef } from '../../shared/profiles';
import { http } from '../api';
import { useStore } from '../store';
import { Pop, StatusIcon, cx } from './ui';

export interface AgentTarget {
  rm: Roadmap | null;
  cp: Checkpoint | null;
  loading: boolean;
  setRoadmap: (id: string) => void;
  setCheckpoint: (id: string | null) => void;
}

/** The picked roadmap and checkpoint; reset to what is open and selected each time `open` turns on. */
export function useAgentTarget(open: boolean): AgentTarget {
  const current = useStore((s) => s.roadmap);
  const selectedId = useStore((s) => s.selectedId);
  const summaries = useStore((s) => s.summaries);
  const [rmId, setRmId] = useState<string | null>(null);
  const [cpId, setCpId] = useState<string | null>(null);
  const [fetched, setFetched] = useState<Roadmap | null>(null);

  useEffect(() => {
    if (!open) return;
    setRmId(current?.meta.id ?? (summaries.length === 1 ? summaries[0]!.id : null));
    setCpId(current && selectedId && current.checkpoints[selectedId] ? selectedId : null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  const rm = rmId && current?.meta.id === rmId ? current : fetched?.meta.id === rmId ? fetched : null;
  useEffect(() => {
    if (!open || !rmId || rm) return;
    let live = true;
    http
      .get<Roadmap>(`/api/roadmaps/${encodeURIComponent(rmId)}`)
      .then((r) => live && setFetched(r))
      .catch((e: Error) => toast.error(e.message));
    return () => {
      live = false;
    };
  }, [open, rmId, rm]);

  return {
    rm,
    cp: rm && cpId ? (rm.checkpoints[cpId] ?? null) : null,
    loading: !!rmId && !rm,
    setRoadmap: (id) => {
      setRmId(id);
      setCpId(null);
    },
    setCheckpoint: setCpId,
  };
}

/** Checkpoints in outline order (depth-first), without archived ones. */
function outlineOrder(rm: Roadmap): { cp: Checkpoint; depth: number }[] {
  const idx = childrenIndex(rm.checkpoints);
  const out: { cp: Checkpoint; depth: number }[] = [];
  const walk = (parent: string, depth: number) => {
    for (const cp of idx.get(parent) ?? []) {
      if (cp.archived) continue;
      out.push({ cp, depth });
      walk(cp.id, depth + 1);
    }
  };
  walk('', 0);
  return out;
}

const trigger =
  'flex h-9 w-full min-w-0 items-center gap-2 rounded-lg border border-line bg-surface px-2.5 text-left text-[13px] hover:border-line-strong disabled:opacity-50 data-[state=open]:border-accent';
const item = 'flex cursor-pointer items-center gap-2 rounded-md px-2 py-1.5 text-[13px] data-[selected=true]:bg-surface-2';

function SearchBox({ placeholder }: { placeholder: string }) {
  return (
    <div className="flex items-center gap-2 border-b border-line px-2.5">
      <Search size={14} className="flex-none text-faint" />
      <Command.Input autoFocus placeholder={placeholder} aria-label={placeholder} className="h-9 min-w-0 flex-1 bg-transparent text-[13px] outline-none placeholder:text-faint" />
    </div>
  );
}

export function TargetPicker({ target }: { target: AgentTarget }) {
  const summaries = useStore((s) => s.summaries);
  const [rmOpen, setRmOpen] = useState(false);
  const [cpOpen, setCpOpen] = useState(false);
  const { rm, cp } = target;
  const rows = useMemo(() => (rm ? outlineOrder(rm) : []), [rm]);
  const profile = rm ? getProfile(rm.meta.profile) : null;

  return (
    <div className="grid gap-2 sm:grid-cols-2">
      <div className="min-w-0">
        <div className="mb-1 text-[12px] font-medium text-muted">Roadmap</div>
        <Pop.Root open={rmOpen} onOpenChange={setRmOpen}>
          <Pop.Trigger asChild>
            <button className={trigger} aria-haspopup="listbox" aria-label={`Roadmap: ${rm?.meta.title ?? 'none chosen'}. Change`} disabled={!summaries.length}>
              <MapIcon size={14} className="flex-none text-faint" />
              <span dir="auto" className={cx('min-w-0 flex-1 truncate', !rm && 'text-muted')}>
                {rm ? rm.meta.title : target.loading ? 'Loading…' : summaries.length ? 'Choose a roadmap' : 'No roadmaps yet'}
              </span>
              <ChevronDown size={14} className="flex-none text-faint" />
            </button>
          </Pop.Trigger>
          <Pop.Content className="w-[min(360px,calc(100vw-32px))] overflow-hidden p-0">
            <Command>
              <SearchBox placeholder="Find a roadmap" />
              <Command.List className="max-h-64 overflow-y-auto p-1">
                <Command.Empty className="px-2 py-4 text-center text-[12.5px] text-muted">No roadmap matches.</Command.Empty>
                {summaries.map((s) => (
                  <Command.Item
                    key={s.id}
                    value={`${s.title} ${s.folder} ${s.id}`}
                    onSelect={() => {
                      target.setRoadmap(s.id);
                      setRmOpen(false);
                    }}
                    className={item}
                  >
                    <span dir="auto" className="min-w-0 flex-1 truncate">
                      {s.title}
                    </span>
                    {s.folder && <span className="max-w-32 flex-none truncate text-[11.5px] text-faint">{s.folder}</span>}
                  </Command.Item>
                ))}
              </Command.List>
            </Command>
          </Pop.Content>
        </Pop.Root>
      </div>

      <div className="min-w-0">
        <div className="mb-1 text-[12px] font-medium text-muted">Checkpoint</div>
        <Pop.Root open={cpOpen} onOpenChange={setCpOpen}>
          <Pop.Trigger asChild>
            <button className={trigger} aria-haspopup="listbox" aria-label={`Checkpoint: ${cp?.title ?? 'whole roadmap'}. Change`} disabled={!rm || !rows.length}>
              {cp && profile ? <StatusIcon category={statusDef(profile, cp.status).category} size={14} /> : null}
              <span dir="auto" className={cx('min-w-0 flex-1 truncate', !cp && 'text-muted')}>
                {cp ? cp.title : rm && !rows.length ? 'No checkpoints yet' : 'Whole roadmap (pick one for sessions)'}
              </span>
              <ChevronDown size={14} className="flex-none text-faint" />
            </button>
          </Pop.Trigger>
          <Pop.Content className="w-[min(420px,calc(100vw-32px))] overflow-hidden p-0">
            <Command>
              <SearchBox placeholder="Find a checkpoint" />
              <Command.List className="max-h-72 overflow-y-auto p-1">
                <Command.Empty className="px-2 py-4 text-center text-[12.5px] text-muted">No checkpoint matches.</Command.Empty>
                <Command.Item
                  value="whole roadmap none"
                  onSelect={() => {
                    target.setCheckpoint(null);
                    setCpOpen(false);
                  }}
                  className={cx(item, 'text-muted')}
                >
                  Whole roadmap (no checkpoint)
                </Command.Item>
                {rows.map(({ cp: c, depth }) => (
                  <Command.Item
                    key={c.id}
                    value={`${c.title} ${c.id}`}
                    onSelect={() => {
                      target.setCheckpoint(c.id);
                      setCpOpen(false);
                    }}
                    className={item}
                    style={{ paddingLeft: 8 + depth * 16 }}
                  >
                    {profile && <StatusIcon category={statusDef(profile, c.status).category} size={13} />}
                    <span dir="auto" className={cx('min-w-0 flex-1 truncate', depth === 0 && 'font-medium')}>
                      {c.title}
                    </span>
                  </Command.Item>
                ))}
              </Command.List>
            </Command>
          </Pop.Content>
        </Pop.Root>
      </div>
    </div>
  );
}
