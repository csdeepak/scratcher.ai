import { useEffect, useMemo, useRef, useState } from 'react';
import { Tree, type NodeApi, type NodeRendererProps, type TreeApi } from 'react-arborist';
import { ChevronRight, Plus, Search, X } from 'lucide-react';
import type { Checkpoint, Roadmap } from '../../shared/model';
import { getProfile, statusDef, type Profile } from '../../shared/profiles';
import type { Progress } from '../../shared/tree';
import { childrenIndex } from '../../shared/tree';
import { selectCheckpoint, toggleExpanded, useStore } from '../store';
import { addCheckpoint, moveCheckpoint, updateFields } from '../actions';
import { IconButton, StatusIcon, cx } from './ui';

interface Row {
  id: string;
  name: string;
  cp: Checkpoint;
  children?: Row[];
}

function useSize<T extends HTMLElement>() {
  const ref = useRef<T>(null);
  const [size, setSize] = useState({ w: 280, h: 400 });
  useEffect(() => {
    if (!ref.current) return;
    const ro = new ResizeObserver(([e]) => setSize({ w: e!.contentRect.width, h: e!.contentRect.height }));
    ro.observe(ref.current);
    return () => ro.disconnect();
  }, []);
  return [ref, size] as const;
}

export function Outline({ rm, progress }: { rm: Roadmap; progress: Map<string | null, Progress> }) {
  const selectedId = useStore((s) => s.selectedId);
  const expanded = useStore((s) => s.expanded);
  const [filter, setFilter] = useState('');
  const [ref, size] = useSize<HTMLDivElement>();
  const treeRef = useRef<TreeApi<Row> | null>(null);
  const profile = getProfile(rm.meta.profile);

  const data = useMemo(() => {
    const idx = childrenIndex(rm.checkpoints);
    const build = (parent: string): Row[] =>
      (idx.get(parent) ?? [])
        .filter((c) => !c.archived)
        .map((cp) => {
          const kids = build(cp.id);
          return { id: cp.id, name: cp.title, cp, children: kids.length ? kids : undefined };
        });
    return build('');
  }, [rm.checkpoints]);

  const initialOpen = useMemo(() => Object.fromEntries([...expanded].map((id) => [id, true])), [rm.meta.id]); // eslint-disable-line react-hooks/exhaustive-deps

  // Keep the outline's open state in step with the map's.
  useEffect(() => {
    const t = treeRef.current;
    if (!t) return;
    for (const id of Object.keys(rm.checkpoints)) {
      const n = t.get(id);
      if (!n || !n.isInternal) continue;
      const want = expanded.has(id);
      if (want && !n.isOpen) t.open(id);
      if (!want && n.isOpen) t.close(id);
    }
  }, [expanded, rm.checkpoints, data]);

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex items-center gap-1 px-3 pb-2 pt-3">
        <div className="text-[12px] font-semibold text-muted">Outline</div>
        <div className="ml-auto flex items-center">
          <IconButton size="sm" label="Add a main checkpoint" onClick={() => addCheckpoint(null)}>
            <Plus size={15} />
          </IconButton>
        </div>
      </div>
      <div className="px-3 pb-2">
        <label className="flex h-8 items-center gap-2 rounded-lg border border-line bg-surface-2 px-2.5 text-muted focus-within:border-accent">
          <Search size={13} />
          <input
            value={filter}
            onChange={(e) => setFilter(e.target.value)}
            placeholder="Filter titles"
            aria-label="Filter the outline"
            className="min-w-0 flex-1 bg-transparent text-[12.5px] text-fg outline-none placeholder:text-faint"
          />
          {filter && (
            <button aria-label="Clear filter" onClick={() => setFilter('')}>
              <X size={13} />
            </button>
          )}
        </label>
      </div>
      <div ref={ref} className="min-h-0 flex-1">
        {data.length === 0 ? (
          <div className="px-4 py-6 text-[12.5px] leading-relaxed text-muted">No checkpoints yet. Add one with + above, or type one on the map.</div>
        ) : (
          <Tree<Row>
            ref={treeRef}
            data={data}
            width={size.w}
            height={size.h}
            rowHeight={30}
            indent={16}
            paddingBottom={24}
            initialOpenState={initialOpen}
            selection={selectedId ?? undefined}
            disableMultiSelection
            searchTerm={filter}
            searchMatch={(n, term) => n.data.name.toLowerCase().includes(term.toLowerCase())}
            onActivate={(n) => selectCheckpoint(n.id, { center: true })}
            onSelect={(ns) => {
              const n = ns[0];
              if (n && n.id !== useStore.getState().selectedId) selectCheckpoint(n.id, { center: true });
            }}
            onToggle={(id) => {
              const open = treeRef.current?.get(id)?.isOpen ?? false;
              if (open !== useStore.getState().expanded.has(id)) toggleExpanded(id, open);
            }}
            onRename={({ id, name }) => {
              if (name.trim() && name.trim() !== rm.checkpoints[id]?.title) void updateFields(id, { title: name.trim() }, 'rename');
            }}
            onMove={({ dragIds, parentId, index }) => {
              const id = dragIds[0];
              if (!id) return;
              const cp = rm.checkpoints[id];
              if (!cp) return;
              const siblings = data && parentId ? (treeRef.current?.get(parentId)?.children ?? []).map((c) => c.id) : data.map((r) => r.id);
              const oldIndex = siblings.indexOf(id);
              const adj = oldIndex !== -1 && oldIndex < index ? index - 1 : index;
              moveCheckpoint(id, parentId ?? null, { index: adj });
            }}
            aria-label="Roadmap outline"
          >
            {(props) => <OutlineRow {...props} profile={profile} progress={progress} />}
          </Tree>
        )}
      </div>
    </div>
  );
}

function OutlineRow({ node, style, dragHandle, profile, progress }: NodeRendererProps<Row> & { profile: Profile; progress: Map<string | null, Progress> }) {
  const cp = node.data.cp;
  const st = statusDef(profile, cp.status);
  const p = progress.get(cp.id);
  return (
    <div
      ref={dragHandle}
      style={style}
      className={cx(
        'group mx-2 flex h-[28px] items-center gap-1.5 rounded-lg pr-2 text-[13px]',
        node.isSelected ? 'bg-accent-soft text-fg' : 'hover:bg-surface-2',
        node.willReceiveDrop && 'ring-1 ring-accent',
      )}
      onDoubleClick={(e) => {
        e.stopPropagation();
        node.edit();
      }}
    >
      <button
        tabIndex={-1}
        aria-hidden={!node.isInternal}
        aria-label={node.isOpen ? 'Collapse' : 'Expand'}
        className={cx('flex size-5 flex-none items-center justify-center rounded text-faint hover:text-fg', !node.isInternal && 'invisible')}
        onClick={(e) => {
          e.stopPropagation();
          node.toggle();
        }}
      >
        <ChevronRight size={13} className={cx('transition-transform', node.isOpen && 'rotate-90')} />
      </button>
      <StatusIcon category={st.category} size={13} label={st.label} />
      {node.isEditing ? <RenameInput node={node} /> : <span dir="auto" className={cx('min-w-0 flex-1 truncate text-start', node.level === 0 && 'font-medium', cp.optional && 'italic text-muted')}>{cp.title}</span>}
      {!node.isEditing && p && p.total > 0 && (
        <span className="flex-none text-[11px] tabular-nums text-faint">
          {p.done}/{p.total}
        </span>
      )}
    </div>
  );
}

function RenameInput({ node }: { node: NodeApi<Row> }) {
  return (
    <input
      autoFocus
      defaultValue={node.data.name}
      onFocus={(e) => e.currentTarget.select()}
      onBlur={(e) => node.submit(e.currentTarget.value)}
      onKeyDown={(e) => {
        if (e.key === 'Escape') node.reset();
        if (e.key === 'Enter') node.submit(e.currentTarget.value);
        e.stopPropagation();
      }}
      className="h-6 min-w-0 flex-1 rounded border border-accent bg-surface px-1.5 text-[13px] outline-none"
    />
  );
}
