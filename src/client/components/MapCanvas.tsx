// The roadmap map. Editing follows draw.io-style conventions, built on React Flow's own pieces
// (patterns from the official MIT examples: EasyConnect, Intersection, NodeToolbar, EdgeToolbar,
// NodeResizer, and the mind-map tutorial's "drag out to create"):
//  - double-click a checkpoint (or F2) to rename it in place
//  - the selected checkpoint gets a small toolbar: add sub-checkpoint / next, status, rename, page, delete
//  - drag the blue dot to another checkpoint to draw a "requires" arrow; drop it on empty space to add a
//    sub-checkpoint there; click an arrow to remove it
//  - drop a checkpoint onto another to move it under that one; drop on empty space to place it by hand
//  - right-click anything for its menu; sticky notes can go anywhere and stay next to their checkpoint
//  - Shift+drag on empty space selects several (box), Ctrl/⌘/Shift+click adds or removes one; the group
//    then moves, changes status or is deleted together, with one toolbar (React Flow's SelectedNodesToolbar
//    example) and one Undo step

import { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Background,
  BackgroundVariant,
  BaseEdge,
  Controls,
  EdgeToolbar,
  Handle,
  MarkerType,
  MiniMap,
  NodeResizer,
  NodeToolbar,
  Position,
  ReactFlow,
  applyNodeChanges,
  getBezierPath,
  getNodesBounds,
  SelectionMode,
  useConnection,
  useInternalNode,
  useReactFlow,
  type Connection,
  type Edge,
  type EdgeProps,
  type FinalConnectionState,
  type Node,
  type NodeChange,
  type NodeProps,
} from '@xyflow/react';
import {
  ChevronRight,
  CornerDownRight,
  FileText,
  Focus,
  Maximize2,
  Minus,
  Pencil,
  Plus,
  Map as MapIcon,
  Pause,
  Redo2,
  StickyNote,
  Trash,
  Undo2,
  Unlink,
  X,
} from 'lucide-react';
import { NOTE_COLORS, type Checkpoint, type MapNote, type NoteColor, type Roadmap } from '../../shared/model';
import { getProfile, statusDef, type Profile } from '../../shared/profiles';
import type { Progress } from '../../shared/tree';
import { NODE_H, NODE_W, autoPosition, type Layout } from '../layout';
import { batch, getState, overview, redoLast, selectCheckpoint, setExpandedAll, setFocus, setState, toggleExpanded, undoLast, useStore } from '../store';
import {
  addCheckpoint,
  addNote,
  addSibling,
  connect,
  deleteNote,
  finishNote,
  mapVisible,
  moveMany,
  requestDelete,
  requestDeleteMany,
  saveLayout,
  setStatus,
  setStatusMany,
  startRename,
  topLevel,
  unlink,
  updateFields,
  updateNote,
} from '../actions';
import { toPng } from 'html-to-image';
import { registerMapCapture } from '../mapExport';
import { Button, Chip, CtxMenu, IconButton, Menu, ProgressBar, StatusIcon, Tip, UnderstandingIcon, cx } from './ui';

interface NodeData extends Record<string, unknown> {
  cp: Checkpoint;
  profile: Profile;
  depth: number;
  childCount: number;
  open: boolean;
  dimmed: boolean;
  progress?: Progress;
  unreviewed: boolean;
  held: boolean;
  renaming: boolean;
  dropTarget: boolean;
  /** Part of a group selection: the group toolbar replaces this node's own. */
  inGroup: boolean;
}

interface NoteData extends Record<string, unknown> {
  note: MapNote;
  editing: boolean;
  dimmed: boolean;
  /** Map position the note's dx/dy are relative to (its checkpoint, or the origin). */
  origin: { x: number; y: number };
  inGroup: boolean;
}

type CPNode = Node<NodeData, 'checkpoint'>;
type NoteNode = Node<NoteData, 'note'>;
type AnyNode = CPNode | NoteNode;

const NOTE_PREFIX = 'note:';
const noteNodeId = (id: string) => NOTE_PREFIX + id;
const isNoteNode = (n: { id: string }) => n.id.startsWith(NOTE_PREFIX);

export const NOTE_FILL: Record<NoteColor, string> = {
  yellow: 'var(--note-yellow)',
  pink: 'var(--note-pink)',
  blue: 'var(--note-blue)',
  green: 'var(--note-green)',
  purple: 'var(--note-purple)',
};

// ------------------------------------------------------------------ checkpoint node

function RenameBox({ cp, main }: { cp: Checkpoint; main: boolean }) {
  const [v, setV] = useState(cp.title);
  const done = useRef(false);
  const finish = (save: boolean) => {
    if (done.current) return;
    done.current = true;
    setState({ mapRename: null });
    const t = v.replace(/\s+/g, ' ').trim();
    if (save && t && t !== cp.title) void updateFields(cp.id, { title: t }, 'rename');
  };
  return (
    <textarea
      autoFocus
      rows={2}
      value={v}
      aria-label="Checkpoint name"
      onFocus={(e) => e.currentTarget.select()}
      onChange={(e) => setV(e.target.value.replace(/\n/g, ' '))}
      onBlur={() => finish(true)}
      onKeyDown={(e) => {
        e.stopPropagation();
        if (e.key === 'Enter') {
          e.preventDefault();
          finish(true);
        } else if (e.key === 'Escape') {
          e.preventDefault();
          finish(false);
        }
      }}
      className={cx(
        'nodrag nowheel nopan -my-0.5 min-w-0 flex-1 resize-none rounded-sm bg-white/70 px-1 py-0.5 leading-[1.28] text-[#1c1917] outline-none ring-2 ring-accent',
        main ? 'text-[14px] font-semibold' : 'text-[13px] font-medium',
      )}
    />
  );
}

function NodeTools({ cp, profile }: { cp: Checkpoint; profile: Profile }) {
  const st = statusDef(profile, cp.status);
  const btn = 'inline-flex size-7 items-center justify-center rounded-md text-muted hover:bg-surface-2 hover:text-fg';
  return (
    <div className="flex items-center gap-0.5 rounded-lg border-[1.5px] border-ink/80 bg-surface p-0.5 shadow-md" onDoubleClick={(e) => e.stopPropagation()}>
      <Tip label="Add a sub-checkpoint (A)">
        <button className={btn} aria-label="Add a sub-checkpoint" onClick={() => addCheckpoint(cp.id)}>
          <CornerDownRight size={15} />
        </button>
      </Tip>
      <Tip label="Add the next checkpoint (N)">
        <button className={btn} aria-label="Add the next checkpoint" onClick={() => addSibling(cp.id)}>
          <Plus size={15} />
        </button>
      </Tip>
      <span className="mx-0.5 h-5 w-px bg-line" />
      <Menu.Root>
        <Tip label={`Status: ${st.label}`}>
          <Menu.Trigger asChild>
            <button className={cx(btn, 'w-auto gap-1 px-1.5 text-[12px] font-medium')} aria-label={`Status: ${st.label}. Change status`}>
              <StatusIcon category={st.category} size={14} /> <span className="hidden sm:inline">{st.label}</span>
            </button>
          </Menu.Trigger>
        </Tip>
        <Menu.Content align="start">
          <Menu.Label>Status: set by you</Menu.Label>
          {profile.statuses.map((s) => (
            <Menu.Item key={s.key} onSelect={() => setStatus(cp.id, s.key)}>
              <StatusIcon category={s.category} size={14} /> {s.label}
            </Menu.Item>
          ))}
        </Menu.Content>
      </Menu.Root>
      <Tip label="Rename (double-click or F2)">
        <button className={btn} aria-label="Rename" onClick={() => startRename(cp.id)}>
          <Pencil size={14} />
        </button>
      </Tip>
      <Tip label="Open its notes as a full page">
        <button className={btn} aria-label="Open as a full page" onClick={() => setState({ detailsOpen: true, pageMode: true })}>
          <FileText size={15} />
        </button>
      </Tip>
      <span className="mx-0.5 h-5 w-px bg-line" />
      <Tip label="Delete (Del)">
        <button className={cx(btn, 'hover:!text-danger')} aria-label="Delete" onClick={() => requestDelete(cp.id)}>
          <Trash size={14} />
        </button>
      </Tip>
    </div>
  );
}

const CheckpointNode = memo(function CheckpointNode({ id, data, selected, dragging }: NodeProps<CPNode>) {
  const { cp, profile, depth, childCount, open, dimmed, progress, unreviewed, held, renaming, dropTarget, inGroup } = data;
  // While someone drags a link from another checkpoint, this whole card accepts the drop (EasyConnect pattern).
  const linkTarget = useConnection((c) => c.inProgress && c.fromNode.id !== id);
  const status = statusDef(profile, cp.status);
  const main = depth === 0;
  // Fill colour carries status: yellow/cream = not started, blue = in progress,
  // amber = needs review, green = complete. Main checkpoints are bolder.
  const fill =
    status.category === 'done'
      ? main
        ? 'var(--node-done)'
        : 'var(--node-done-sub)'
      : status.category === 'active'
        ? main
          ? 'var(--node-main)'
          : 'var(--node-active)'
        : status.category === 'review'
          ? 'var(--node-review)'
          : main
            ? 'var(--node-main)'
            : 'var(--node-sub)';
  // Bright main checkpoints keep dark text in dark mode too.
  const brightFill = main && status.category !== 'review';
  return (
    <>
      <NodeToolbar isVisible={selected && !inGroup && !renaming && !dragging} position={Position.Top} offset={10} align="start">
        <NodeTools cp={cp} profile={profile} />
      </NodeToolbar>
      <div
        className={cx(
          'wm-node group relative flex flex-col justify-between rounded-md px-3 pb-2 pt-2 transition-[box-shadow,opacity] duration-150',
          main ? 'border-2' : 'border-[1.5px]',
          cp.optional && 'border-dashed',
          dropTarget
            ? 'shadow-[0_0_0_4px_var(--accent)]'
            : selected
              ? 'shadow-[0_0_0_3px_var(--accent)]'
              : 'hover:shadow-[0_0_0_2px_color-mix(in_srgb,var(--accent)_45%,transparent)]',
          dimmed && !selected && 'opacity-40',
        )}
        style={{
          width: NODE_W,
          height: NODE_H,
          background: fill,
          borderColor: main ? 'var(--ink)' : 'color-mix(in srgb, var(--ink) 70%, transparent)',
          color: brightFill ? '#1c1917' : 'var(--node-text)',
        }}
        title={renaming ? undefined : cp.summary || cp.title}
      >
        {main && status.category === 'active' && (
          <span aria-hidden className="absolute -top-px left-3 right-3 h-[3px] rounded-b" style={{ background: 'var(--active)' }} />
        )}
        {dropTarget && (
          <span className="pointer-events-none absolute -top-3 left-2 z-10 rounded-md bg-accent px-1.5 py-0.5 text-[11px] font-semibold text-accent-fg shadow">Move under here</span>
        )}
        <Handle type="target" position={Position.Left} id="in" isConnectable={false} />
        <Handle type="source" position={Position.Right} id="out" isConnectable={false} />
        <Handle type="target" position={Position.Top} id="top" isConnectable={false} />
        <Handle type="source" position={Position.Bottom} id="bottom" isConnectable={false} />
        {/* Drag from this dot: onto a checkpoint = "it requires this one"; onto empty space = new sub-checkpoint. */}
        <Handle type="source" position={Position.Right} id="link" className="wm-link-handle" title="Drag to another checkpoint to link them, or to empty space to add a sub-checkpoint" />
        <Handle type="target" position={Position.Left} id="drop" className="wm-drop-handle" isConnectableStart={false} style={{ pointerEvents: linkTarget ? 'all' : 'none' }} />
        <div className="flex items-start gap-2">
          <span className="mt-[2px]">
            <StatusIcon category={status.category} label={status.label} size={15} />
          </span>
          {renaming ? (
            <RenameBox cp={cp} main={main} />
          ) : (
            <div className={cx('line-clamp-2 min-w-0 flex-1 leading-[1.28]', main ? 'text-[14px] font-semibold' : 'text-[13px] font-medium')}>{cp.title}</div>
          )}
          {held && (
            <Tip label="An agent change is waiting for your decision (Review)">
              <span className="mt-0.5 text-review">
                <Pause size={13} strokeWidth={2.5} />
              </span>
            </Tip>
          )}
          {unreviewed && !held && <span className="mt-1.5 size-2 flex-none rounded-full bg-accent" aria-label="Changed by an agent, not reviewed yet" />}
        </div>
        <div className="flex items-center gap-1.5 pl-[23px] text-[11.5px]" style={{ color: brightFill ? '#57534e' : 'var(--fg-muted)' }}>
          {progress && progress.total > 0 ? (
            <>
              <ProgressBar {...progress} className="max-w-[72px]" />
              <span className="tabular-nums">
                {progress.done}/{progress.total}
              </span>
            </>
          ) : (
            <span className="truncate">{status.label}</span>
          )}
          <span className="ml-auto flex items-center gap-1">
            {cp.optional && <span className="text-[11px] italic">optional</span>}
            {!cp.approved && <span className="rounded-sm border border-dashed border-current px-1 text-[10.5px] leading-[14px] opacity-75">draft</span>}
            {profile.understanding && cp.understanding && cp.understanding !== 'not-yet' && <UnderstandingIcon level={cp.understanding} size={12} />}
          </span>
        </div>
        {childCount > 0 && (
          <button
            className={cx(
              'nodrag absolute -right-3 top-1/2 z-10 flex h-6 min-w-6 -translate-y-1/2 items-center justify-center rounded-full border-[1.5px] border-ink bg-surface px-1 text-[11px] font-semibold text-fg hover:border-accent hover:bg-accent hover:text-accent-fg',
            )}
            aria-label={open ? `Collapse ${cp.title}` : `Expand ${cp.title} (${childCount} sub-checkpoints)`}
            onClick={(e) => {
              e.stopPropagation();
              toggleExpanded(cp.id);
            }}
            onDoubleClick={(e) => e.stopPropagation()}
          >
            {open ? <Minus size={12} strokeWidth={2.5} /> : childCount}
          </button>
        )}
      </div>
    </>
  );
});

function GroupTools({ profile, cps, notes, onDelete, onClear }: { profile: Profile; cps: string[]; notes: number; onDelete: () => void; onClear: () => void }) {
  const btn = 'inline-flex h-7 items-center justify-center gap-1 rounded-md px-1.5 text-[12px] font-medium text-muted hover:bg-surface-2 hover:text-fg';
  const parts = [cps.length && `${cps.length} checkpoint${cps.length === 1 ? '' : 's'}`, notes && `${notes} note${notes === 1 ? '' : 's'}`].filter(Boolean);
  return (
    <div className="flex items-center gap-0.5 rounded-lg border-[1.5px] border-ink/80 bg-surface p-0.5 shadow-md">
      <span className="px-2 text-[12px] font-semibold text-fg">{parts.join(', ')}</span>
      <span className="mx-0.5 h-5 w-px bg-line" />
      {cps.length > 0 && (
        <Menu.Root>
          <Menu.Trigger asChild>
            <button className={btn} aria-label="Set the status of the selected checkpoints">
              <StatusIcon category="active" size={14} /> Status
            </button>
          </Menu.Trigger>
          <Menu.Content align="start">
            <Menu.Label>Set for all {cps.length}</Menu.Label>
            {profile.statuses.map((s) => (
              <Menu.Item key={s.key} onSelect={() => setStatusMany(cps, s.key)}>
                <StatusIcon category={s.category} size={14} /> {s.label}
              </Menu.Item>
            ))}
          </Menu.Content>
        </Menu.Root>
      )}
      <Tip label="Delete them (Del)">
        <button className={cx(btn, 'hover:!text-danger')} aria-label="Delete the selection" onClick={onDelete}>
          <Trash size={14} />
        </button>
      </Tip>
      <Tip label="Clear the selection (Esc)">
        <button className={btn} aria-label="Clear the selection" onClick={onClear}>
          <X size={14} />
        </button>
      </Tip>
    </div>
  );
}

// ------------------------------------------------------------------ sticky note node

function NoteEditor({ note }: { note: MapNote }) {
  const [v, setV] = useState(note.text);
  const done = useRef(false);
  const finish = () => {
    if (done.current) return;
    done.current = true;
    setState({ noteEdit: null });
    finishNote(note.id, v);
  };
  return (
    <textarea
      autoFocus
      value={v}
      aria-label="Sticky note text"
      placeholder="Write a note…"
      onChange={(e) => setV(e.target.value)}
      onBlur={finish}
      onKeyDown={(e) => {
        e.stopPropagation();
        if (e.key === 'Escape' || (e.key === 'Enter' && (e.ctrlKey || e.metaKey))) {
          e.preventDefault();
          e.currentTarget.blur();
        }
      }}
      className="nodrag nowheel nopan h-full w-full resize-none bg-transparent text-[13px] leading-[1.45] text-[#1c1917] outline-none placeholder:text-[#78716c]"
    />
  );
}

const NoteNodeView = memo(function NoteNodeView({ data, selected, dragging }: NodeProps<NoteNode>) {
  const { note, editing, dimmed, origin, inGroup } = data;
  return (
    <>
      <NodeResizer
        isVisible={selected && !inGroup && !editing}
        minWidth={140}
        minHeight={70}
        color="var(--accent)"
        onResizeEnd={(_, p) => updateNote(note.id, { w: Math.round(p.width), h: Math.round(p.height), dx: Math.round(p.x - origin.x), dy: Math.round(p.y - origin.y) }, 'resize sticky note')}
      />
      <NodeToolbar isVisible={selected && !inGroup && !editing && !dragging} position={Position.Top} offset={10} align="start">
        <div className="flex items-center gap-1 rounded-lg border-[1.5px] border-ink/80 bg-surface p-1 shadow-md">
          {NOTE_COLORS.map((c) => (
            <button
              key={c}
              aria-label={`${c} note`}
              title={c[0]!.toUpperCase() + c.slice(1)}
              onClick={() => updateNote(note.id, { color: c }, 'note colour')}
              className={cx('size-5 rounded-full border border-ink/40', note.color === c && 'ring-2 ring-accent ring-offset-1 ring-offset-surface')}
              style={{ background: NOTE_FILL[c] }}
            />
          ))}
          <span className="mx-0.5 h-5 w-px bg-line" />
          <Tip label="Edit (double-click)">
            <button className="inline-flex size-6 items-center justify-center rounded-md text-muted hover:bg-surface-2 hover:text-fg" aria-label="Edit note" onClick={() => setState({ noteEdit: note.id })}>
              <Pencil size={13} />
            </button>
          </Tip>
          <Tip label="Delete note (Del)">
            <button className="inline-flex size-6 items-center justify-center rounded-md text-muted hover:bg-surface-2 hover:text-danger" aria-label="Delete note" onClick={() => deleteNote(note.id)}>
              <Trash size={13} />
            </button>
          </Tip>
        </div>
      </NodeToolbar>
      <div
        className={cx(
          'wm-sticky relative h-full w-full rounded-[3px] px-3 py-2.5 shadow-[0_2px_6px_rgba(0,0,0,0.12)]',
          selected && 'shadow-[0_0_0_2px_var(--accent)]',
          dimmed && !selected && 'opacity-40',
        )}
        style={{ background: NOTE_FILL[note.color] }}
      >
        {editing ? (
          <NoteEditor note={note} />
        ) : note.text ? (
          <div className="nowheel h-full overflow-auto whitespace-pre-wrap break-words text-[13px] leading-[1.45] text-[#1c1917]">{note.text}</div>
        ) : (
          <div className="text-[12.5px] italic text-[#78716c]">Double-click to write</div>
        )}
      </div>
    </>
  );
});

// ------------------------------------------------------------------ edges

function edgeParams(s: ReturnType<typeof useInternalNode>, t: ReturnType<typeof useInternalNode>) {
  const sp = s!.internals.positionAbsolute;
  const tp = t!.internals.positionAbsolute;
  const w = s!.measured.width ?? NODE_W;
  const h = s!.measured.height ?? NODE_H;
  const dx = tp.x - sp.x;
  if (Math.abs(dx) < NODE_W * 0.6) {
    // Same column: loop out to the right so the arrow doesn't sit on the main path.
    return { sx: sp.x + w, sy: sp.y + h / 2, tx: tp.x + w, ty: tp.y + h / 2, spos: Position.Right, tpos: Position.Right };
  }
  if (dx > 0) return { sx: sp.x + w, sy: sp.y + h / 2, tx: tp.x, ty: tp.y + h / 2, spos: Position.Right, tpos: Position.Left };
  return { sx: sp.x, sy: sp.y + h / 2, tx: tp.x + w, ty: tp.y + h / 2, spos: Position.Left, tpos: Position.Right };
}

function PrereqEdge({ id, source, target, markerEnd, style, selected, interactionWidth }: EdgeProps) {
  const s = useInternalNode(source);
  const t = useInternalNode(target);
  if (!s || !t) return null;
  const p = edgeParams(s, t);
  const sameCol = p.spos === p.tpos;
  const [path, lx, ly] = getBezierPath({
    sourceX: p.sx,
    sourceY: p.sy,
    sourcePosition: p.spos,
    targetX: p.tx + (sameCol ? 4 : 0),
    targetY: p.ty,
    targetPosition: p.tpos,
    curvature: sameCol ? 0.6 : 0.3,
  });
  return (
    <>
      <BaseEdge id={id} path={path} markerEnd={markerEnd} style={selected ? { ...style, strokeWidth: 3, opacity: 1, strokeDasharray: 'none' } : style} interactionWidth={interactionWidth} />
      {/* Built-in EdgeToolbar (React Flow): a remove button on the selected arrow. */}
      <EdgeToolbar edgeId={id} x={lx} y={ly} isVisible={!!selected}>
        <button
          className="nodrag nopan flex items-center gap-1 rounded-md border-[1.5px] border-ink/80 bg-surface px-2 py-1 text-[12px] font-medium text-fg shadow-md hover:text-danger"
          onClick={() => unlink(target, source)}
        >
          <Unlink size={13} /> Remove link
        </button>
      </EdgeToolbar>
    </>
  );
}

const nodeTypes = { checkpoint: CheckpointNode, note: NoteNodeView };
const FIT_PADDING = { top: '72px', left: '32px', right: '48px', bottom: '40px' } as const;
const edgeTypes = { prereq: PrereqEdge };
const CONNECTION_LINE = { stroke: 'var(--link)', strokeWidth: 2.25, strokeDasharray: '6 5' };

const isTypingTarget = (t: EventTarget | null) => {
  const el = t as HTMLElement | null;
  return !!el && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.isContentEditable);
};

type Point = { id: string; x: number; y: number };
const pointsOf = (layout: Layout): Point[] => layout.nodes.map((n) => ({ id: n.cp.id, x: n.x, y: n.y }));

/** Where to keep a sticky note so it stays next to the nearest visible checkpoint. */
function placeNote(points: Point[], x: number, y: number, w = 208, h = 120): { anchor: string | null; dx: number; dy: number } {
  let best: (Point & { d: number }) | null = null;
  const cx0 = x + w / 2;
  const cy0 = y + h / 2;
  for (const n of points) {
    const d = Math.hypot(n.x + NODE_W / 2 - cx0, n.y + NODE_H / 2 - cy0);
    if (!best || d < best.d) best = { ...n, d };
  }
  return best ? { anchor: best.id, dx: Math.round(x - best.x), dy: Math.round(y - best.y) } : { anchor: null, dx: Math.round(x), dy: Math.round(y) };
}

type MenuTarget =
  | { kind: 'node'; id: string }
  | { kind: 'note'; id: string }
  | { kind: 'edge'; first: string; then: string }
  | { kind: 'pane'; x: number; y: number }
  | { kind: 'group' }
  | null;

export function MapCanvas({ rm, layout, progress }: { rm: Roadmap; layout: Layout; progress: Map<string | null, Progress> }) {
  const selectedId = useStore((s) => s.selectedId);
  const focusId = useStore((s) => s.focusId);
  const prereqMode = useStore((s) => s.prereqMode);
  const fitRequest = useStore((s) => s.fitRequest);
  const centerRequest = useStore((s) => s.centerRequest);
  const reviewItems = useStore((s) => s.review.items);
  const mapRename = useStore((s) => s.mapRename);
  const noteEdit = useStore((s) => s.noteEdit);
  const profile = getProfile(rm.meta.profile);
  const flow = useReactFlow<AnyNode>();
  const [selectedEdge, setSelectedEdge] = useState<string | null>(null);
  const [selectedNote, setSelectedNote] = useState<string | null>(null);
  const [dropTarget, setDropTarget] = useState<string | null>(null);
  const [menu, setMenu] = useState<MenuTarget>(null);
  // Group selection (node ids: checkpoint ids and note:… ids). Used while two or more are selected, and
  // while a selection box is being drawn; otherwise the single selection above (and the store's) applies.
  const [group, setGroup] = useState<string[]>([]);
  const boxing = useRef(false);
  const boxed = useRef(new Set<string>());
  const inGroup = group.length > 1;

  const { unreviewed, held } = useMemo(() => {
    const u = new Set<string>();
    const h = new Set<string>();
    for (const i of reviewItems) {
      if (i.roadmapId !== rm.meta.id) continue;
      if (i.kind === 'held' || i.kind === 'held-delete') h.add(i.checkpointId);
      else if (i.kind === 'changed' || i.kind === 'created') u.add(i.checkpointId);
    }
    return { unreviewed: u, held: h };
  }, [reviewItems, rm.meta.id]);

  const notes = rm.layout?.notes;
  const groupSet = useMemo(() => new Set(group), [group]);
  const derived: AnyNode[] = useMemo(() => {
    const cpNodes: CPNode[] = layout.nodes.map((n) => ({
      id: n.cp.id,
      type: 'checkpoint',
      position: { x: n.x, y: n.y },
      width: NODE_W,
      height: NODE_H,
      selected: group.length ? groupSet.has(n.cp.id) : n.cp.id === selectedId,
      zIndex: 2,
      ariaLabel: `${n.cp.title}, ${statusDef(profile, n.cp.status).label}`,
      data: {
        cp: n.cp,
        profile,
        depth: n.depth,
        childCount: n.childCount,
        open: n.open,
        dimmed: n.dimmed,
        progress: progress.get(n.cp.id),
        unreviewed: unreviewed.has(n.cp.id),
        held: held.has(n.cp.id),
        renaming: mapRename === n.cp.id,
        dropTarget: dropTarget === n.cp.id,
        inGroup,
      },
    }));
    // A note sits next to its checkpoint; while that checkpoint is hidden (collapsed, or deleted to Trash) so is the note.
    const noteNodes: NoteNode[] = (notes ?? []).flatMap((note) => {
      let origin = { x: 0, y: 0 };
      let dimmed = false;
      if (note.anchor) {
        const a = layout.byId.get(note.anchor);
        if (!a) return [];
        origin = { x: a.x, y: a.y };
        dimmed = a.dimmed;
      }
      return [
        {
          id: noteNodeId(note.id),
          type: 'note' as const,
          position: { x: origin.x + note.dx, y: origin.y + note.dy },
          width: note.w,
          height: note.h,
          selected: group.length ? groupSet.has(noteNodeId(note.id)) : selectedNote === note.id,
          zIndex: 1,
          ariaLabel: `Sticky note: ${note.text.slice(0, 60) || 'empty'}`,
          data: { note, editing: noteEdit === note.id, dimmed, origin, inGroup },
        },
      ];
    });
    return [...noteNodes, ...cpNodes];
  }, [layout, selectedId, profile, progress, unreviewed, held, mapRename, dropTarget, notes, selectedNote, noteEdit, group, groupSet, inGroup]);

  const [nodes, setNodes] = useState<AnyNode[]>(derived);
  const [capturing, setCapturing] = useState(false);

  // Let the Export dialog take a picture of the whole map (all nodes, not just the visible ones).
  useEffect(() => {
    registerMapCapture(async () => {
      setCapturing(true);
      await new Promise((r) => setTimeout(r, 160));
      try {
        const all = flow.getNodes();
        const b = getNodesBounds(all);
        const pad = 48;
        const scale = Math.min(2, 6000 / Math.max(b.width + pad * 2, b.height + pad * 2, 1));
        const width = Math.round((b.width + pad * 2) * scale);
        const height = Math.round((b.height + pad * 2) * scale);
        const viewport = document.querySelector<HTMLElement>('.react-flow__viewport');
        if (!viewport) throw new Error('The map is not on screen.');
        return await toPng(viewport, {
          backgroundColor: getComputedStyle(document.body).backgroundColor,
          width,
          height,
          pixelRatio: 1,
          style: { width: `${width}px`, height: `${height}px`, transform: `translate(${(pad - b.x) * scale}px, ${(pad - b.y) * scale}px) scale(${scale})` },
        });
      } finally {
        setCapturing(false);
      }
    });
    return () => registerMapCapture(null);
  }, [flow]);
  useEffect(() => setNodes(derived), [derived]);

  // Forget selections that no longer exist.
  useEffect(() => {
    if (selectedNote && !notes?.some((n) => n.id === selectedNote)) setSelectedNote(null);
  }, [notes, selectedNote]);
  useEffect(() => {
    if (!group.length || boxing.current) return;
    const exists = (id: string) => (isNoteNode({ id }) ? notes?.some((n) => noteNodeId(n.id) === id) : layout.byId.has(id));
    const left = group.filter(exists);
    if (left.length !== group.length) setGroup(left.length > 1 ? left : []);
  }, [group, notes, layout]);
  // Selecting one checkpoint anywhere else (outline, keys, search) ends the group selection.
  useEffect(() => {
    if (selectedId && !boxing.current) setGroup([]);
  }, [selectedId]);

  const onNodesChange = useCallback((changes: NodeChange<AnyNode>[]) => {
    const keep = changes.filter((c) => c.type === 'position' || c.type === 'dimensions');
    if (keep.length) setNodes((nds) => applyNodeChanges(keep, nds));
    // While a selection box is drawn, React Flow reports what it covers (the Figma example's pattern).
    if (boxing.current && changes.some((c) => c.type === 'select')) {
      for (const c of changes) if (c.type === 'select') (c.selected ? boxed.current.add(c.id) : boxed.current.delete(c.id));
      setGroup([...boxed.current]);
    }
  }, []);

  const clearMapSelection = () => {
    setSelectedEdge(null);
    setSelectedNote(null);
  };

  /** Make `ids` the selection: two or more become a group, one becomes the normal selection. */
  const select = useCallback((ids: string[]) => {
    if (ids.length > 1) {
      setSelectedEdge(null);
      setSelectedNote(null);
      if (getState().selectedId) selectCheckpoint(null);
      setGroup(ids);
      return;
    }
    setGroup([]);
    setSelectedEdge(null);
    const one = ids[0];
    if (one && isNoteNode({ id: one })) {
      selectCheckpoint(null);
      setSelectedNote(one.slice(NOTE_PREFIX.length));
    } else {
      setSelectedNote(null);
      selectCheckpoint(one ?? null);
    }
  }, []);

  /** Ctrl/⌘/Shift+click: add a node to the selection, or take it out. */
  const toggleSelected = (id: string) => {
    const current = group.length ? group : [getState().selectedId, selectedNote && noteNodeId(selectedNote)].filter((x): x is string => !!x);
    select(current.includes(id) ? current.filter((x) => x !== id) : [...current, id]);
  };

  const groupCps = group.filter((id) => !isNoteNode({ id }));
  const groupNotes = group.filter((id) => isNoteNode({ id })).map((id) => id.slice(NOTE_PREFIX.length));
  const deleteGroup = () => {
    requestDeleteMany(groupCps, groupNotes);
    setGroup([]);
  };

  // ---------------------------------------------------------------- dragging

  /** Where each dragged node started, and the sub-checkpoints that move along with them. */
  const dragStart = useRef<{ starts: Map<string, { x: number; y: number }>; followers: Map<string, { x: number; y: number }>; sameParent: string | null } | null>(null);
  const dropRef = useRef<string | null>(null);

  const onNodeDragStart = useCallback(
    (_: unknown, node: AnyNode, dragged: AnyNode[]) => {
      const moving = dragged.length ? dragged : [node];
      const starts = new Map(moving.map((n) => [n.id, { x: n.position.x, y: n.position.y }]));
      const followers = new Map<string, { x: number; y: number }>();
      const cps = rm.checkpoints;
      for (const n of layout.nodes) {
        if (starts.has(n.cp.id)) continue;
        for (let p = n.cp.parent; p; p = cps[p]?.parent ?? null) {
          if (starts.has(p)) {
            followers.set(n.cp.id, { x: n.x, y: n.y });
            break;
          }
        }
      }
      const parents = new Set(moving.filter((n) => !isNoteNode(n)).map((n) => cps[n.id]?.parent ?? null));
      dragStart.current = { starts, followers, sameParent: parents.size === 1 ? [...parents][0]! : null };
    },
    [layout, rm.checkpoints],
  );

  const onNodeDrag = useCallback(
    (e: React.MouseEvent | MouseEvent | TouchEvent, node: AnyNode) => {
      const d = dragStart.current;
      const s0 = d?.starts.get(node.id);
      if (!d || !s0) return;
      const dx = node.position.x - s0.x;
      const dy = node.position.y - s0.y;
      if (d.followers.size) {
        setNodes((nds) => nds.map((n) => (d.followers.has(n.id) ? { ...n, position: { x: d.followers.get(n.id)!.x + dx, y: d.followers.get(n.id)!.y + dy } } : n)));
      }
      if (isNoteNode(node)) return;
      // Pointer over another checkpoint → "move under it" (Intersection example, by pointer for precision).
      const pt = 'clientX' in e ? { x: e.clientX, y: e.clientY } : { x: e.touches[0]?.clientX ?? 0, y: e.touches[0]?.clientY ?? 0 };
      const p = flow.screenToFlowPosition(pt);
      const hit = layout.nodes.find(
        (n) => !d.starts.has(n.cp.id) && !d.followers.has(n.cp.id) && n.cp.id !== d.sameParent && p.x >= n.x && p.x <= n.x + NODE_W && p.y >= n.y && p.y <= n.y + NODE_H,
      );
      const target = hit?.cp.id ?? null;
      if (target !== dropRef.current) {
        dropRef.current = target;
        setDropTarget(target);
      }
    },
    [flow, layout],
  );

  const onNodeDragStop = useCallback(
    (_: unknown, node: AnyNode, dragged: AnyNode[]) => {
      const d = dragStart.current;
      dragStart.current = null;
      const target = dropRef.current;
      dropRef.current = null;
      setDropTarget(null);
      const s0 = d?.starts.get(node.id);
      if (!d || !s0 || (Math.abs(node.position.x - s0.x) < 2 && Math.abs(node.position.y - s0.y) < 2)) return;
      const dx = node.position.x - s0.x;
      const dy = node.position.y - s0.y;
      const moving = dragged.length ? dragged : [node];
      const noteNodes = moving.filter(isNoteNode) as NoteNode[];
      // A checkpoint whose parent moves too just goes along (offsets add up down the tree).
      const top = topLevel(moving.filter((n) => !isNoteNode(n)).map((n) => n.id));
      const label =
        moving.length > 1 ? `move ${moving.length} items` : noteNodes.length ? 'move sticky note' : `move “${rm.checkpoints[node.id]?.title ?? 'checkpoint'}”`;
      batch(label, () => {
        if (noteNodes.length) {
          // Place notes against where the checkpoints are now, so a note dragged with its checkpoint stays put.
          const points = layout.nodes.map((n) => (d.starts.has(n.cp.id) || d.followers.has(n.cp.id) ? { id: n.cp.id, x: n.x + dx, y: n.y + dy } : { id: n.cp.id, x: n.x, y: n.y }));
          const placed = new Map(noteNodes.map((n) => [n.data.note.id, placeNote(points, n.position.x, n.position.y, n.data.note.w, n.data.note.h)]));
          saveLayout({ notes: (rm.layout?.notes ?? []).map((n) => (placed.has(n.id) ? { ...n, ...placed.get(n.id)! } : n)) }, label);
        }
        if (!top.length) return;
        const offsets = { ...(rm.layout?.offsets ?? {}) };
        if (target) {
          // Re-parent: they now follow the automatic layout under their new parent.
          for (const id of top) delete offsets[id];
          saveLayout({ offsets }, label);
          moveMany(top, target);
          return;
        }
        for (const id of top) {
          const auto = autoPosition(layout, rm, id);
          const now = moving.find((n) => n.id === id)!.position;
          if (auto) offsets[id] = { dx: now.x - auto.x, dy: now.y - auto.y };
        }
        saveLayout({ offsets }, label);
      });
    },
    [layout, rm],
  );

  // ---------------------------------------------------------------- linking (EasyConnect + mind-map patterns)

  const onConnect = useCallback((c: Connection) => {
    if (c.source && c.target && c.sourceHandle === 'link') connect(c.source, c.target);
  }, []);

  const onConnectEnd = useCallback((event: MouseEvent | TouchEvent, state: FinalConnectionState) => {
    if (state.isValid || !state.fromNode || isNoteNode(state.fromNode)) return;
    // Dropped on empty map: create a sub-checkpoint of the one the drag started from.
    if ((event.target as Element | null)?.classList?.contains('react-flow__pane')) addCheckpoint(state.fromNode.id);
  }, []);

  const edges: Edge[] = useMemo(() => {
    const out: Edge[] = [];
    for (const e of layout.spineEdges) {
      out.push({
        id: `s-${e.source}-${e.target}`,
        source: e.source,
        target: e.target,
        sourceHandle: 'bottom',
        targetHandle: 'top',
        type: 'smoothstep',
        selectable: false,
        focusable: false,
        style: { stroke: 'var(--spine)', strokeWidth: 4, strokeLinecap: 'round' },
      });
    }
    for (const e of layout.hierarchyEdges) {
      const dim = layout.byId.get(e.target)?.dimmed;
      out.push({
        id: `h-${e.source}-${e.target}`,
        source: e.source,
        target: e.target,
        sourceHandle: 'out',
        targetHandle: 'in',
        type: 'smoothstep',
        selectable: false,
        focusable: false,
        className: dim ? 'wm-dim' : undefined,
        pathOptions: { borderRadius: 14 },
        style: { stroke: 'var(--branch)', strokeWidth: 2 },
      } as Edge);
    }
    for (const e of layout.prereqEdges) {
      const id = `p-${e.source}-${e.target}`;
      const involved = selectedId === e.source || selectedId === e.target || selectedEdge === id;
      if (prereqMode === 'selected' && !involved) continue;
      out.push({
        id,
        source: e.source,
        target: e.target,
        sourceHandle: 'link',
        targetHandle: 'drop',
        type: 'prereq',
        selectable: true,
        selected: selectedEdge === id,
        focusable: false,
        interactionWidth: 16,
        zIndex: involved ? 5 : 0,
        markerEnd: { type: MarkerType.ArrowClosed, color: 'var(--link)', width: 16, height: 16 },
        style: {
          stroke: 'var(--link)',
          strokeWidth: involved ? 2.25 : 1.6,
          strokeDasharray: '6 5',
          opacity: involved ? 1 : selectedId ? 0.28 : 0.6,
        },
      });
    }
    return out;
  }, [layout, selectedId, prereqMode, selectedEdge]);

  // Delete / Escape for a group, a selected arrow or a sticky note (runs before the app's checkpoint shortcuts).
  useEffect(() => {
    if (!selectedEdge && !selectedNote && !inGroup) return;
    const onKey = (e: KeyboardEvent) => {
      if (isTypingTarget(e.target) || document.querySelector('[role="dialog"], [role="menu"]')) return;
      if (e.key === 'Escape') {
        clearMapSelection();
        setGroup([]);
        e.stopPropagation();
        return;
      }
      if (e.key !== 'Delete' && e.key !== 'Backspace') return;
      e.preventDefault();
      e.stopPropagation();
      if (inGroup) deleteGroup();
      else if (selectedNote) deleteNote(selectedNote);
      else if (selectedEdge) {
        const edge = edges.find((x) => x.id === selectedEdge);
        if (edge) unlink(edge.target, edge.source);
      }
      clearMapSelection();
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedEdge, selectedNote, inGroup, edges, group]);

  // Ctrl/⌘+A: select everything on the map (when the map is on screen and you aren't typing).
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (!(e.ctrlKey || e.metaKey) || e.key.toLowerCase() !== 'a' || e.shiftKey || e.altKey) return;
      if (isTypingTarget(e.target) || document.querySelector('[role="dialog"], [role="menu"]') || !mapVisible()) return;
      e.preventDefault();
      select([...layout.nodes.filter((n) => !n.dimmed).map((n) => n.cp.id), ...nodes.filter(isNoteNode).map((n) => n.id)]);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [layout, nodes, select]);

  // Refit when the map's area changes size (panels opened or closed, window resized),
  // unless you have panned or zoomed yourself since the last fit.
  const wrapRef = useRef<HTMLDivElement>(null);
  const userMoved = useRef(false);
  useEffect(() => {
    const el = wrapRef.current;
    if (!el) return;
    let last = { w: el.clientWidth, h: el.clientHeight };
    let t: ReturnType<typeof setTimeout> | undefined;
    const ro = new ResizeObserver(() => {
      const w = el.clientWidth;
      const h = el.clientHeight;
      if (Math.abs(w - last.w) < 40 && Math.abs(h - last.h) < 40) return;
      last = { w, h };
      if (t) clearTimeout(t);
      t = setTimeout(() => {
        if (!userMoved.current) void flow.fitView({ padding: FIT_PADDING, duration: 200, maxZoom: 1.05, minZoom: 0.12 });
      }, 120);
    });
    ro.observe(el);
    return () => {
      ro.disconnect();
      if (t) clearTimeout(t);
    };
  }, [flow]);

  // Fit to everything (or the focused branch) on request.
  useEffect(() => {
    if (!fitRequest) return;
    userMoved.current = false;
    const t = setTimeout(() => {
      const focusIds = focusId ? layout.nodes.filter((n) => !n.dimmed).map((n) => ({ id: n.cp.id })) : undefined;
      void flow.fitView({ padding: FIT_PADDING, duration: 320, maxZoom: 1.05, minZoom: 0.12, nodes: focusIds });
    }, 40);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fitRequest]);

  useEffect(() => {
    if (!centerRequest) return;
    const t = setTimeout(() => {
      const n = flow.getNode(centerRequest.id);
      if (!n) return;
      const z = Math.max(flow.getZoom(), 0.75);
      void flow.setCenter(n.position.x + NODE_W / 2, n.position.y + NODE_H / 2, { zoom: z, duration: 320 });
    }, 60);
    return () => clearTimeout(t);
  }, [centerRequest, flow]);

  /** Add a sticky note: next to the selected checkpoint, at a map point, or in the middle of the view. */
  const newNote = useCallback(
    (at?: { x: number; y: number }) => {
      let pos = at;
      const sel = getState().selectedId;
      if (!pos && sel && layout.byId.has(sel)) {
        const n = layout.byId.get(sel)!;
        pos = { x: n.x + NODE_W + 36, y: n.y - 8 };
      }
      if (!pos) {
        const r = wrapRef.current?.getBoundingClientRect();
        const c = flow.screenToFlowPosition({ x: (r?.left ?? 0) + (r?.width ?? 600) / 2, y: (r?.top ?? 0) + (r?.height ?? 400) / 2 });
        pos = { x: c.x - 104, y: c.y - 60 };
      }
      const id = addNote(placeNote(pointsOf(layout), pos.x, pos.y));
      if (id) {
        selectCheckpoint(null);
        setSelectedEdge(null);
        setSelectedNote(id);
      }
    },
    [flow, layout],
  );

  const menuNodeCp = menu?.kind === 'node' ? rm.checkpoints[menu.id] : undefined;
  const menuNote = menu?.kind === 'note' ? notes?.find((n) => n.id === menu.id) : undefined;

  return (
    <div ref={wrapRef} className="relative h-full w-full">
      <CtxMenu.Root onOpenChange={(o) => !o && setMenu(null)}>
        <CtxMenu.Trigger asChild>
          <ReactFlow<AnyNode>
            onMoveStart={(e) => {
              if (e) userMoved.current = true;
            }}
            nodes={nodes}
            edges={edges}
            nodeTypes={nodeTypes}
            edgeTypes={edgeTypes}
            onNodesChange={onNodesChange}
            onNodeClick={(e, n) => {
              if (e.shiftKey || e.ctrlKey || e.metaKey) return toggleSelected(n.id);
              setGroup([]);
              if (isNoteNode(n)) {
                selectCheckpoint(null);
                setSelectedEdge(null);
                setSelectedNote(n.id.slice(NOTE_PREFIX.length));
              } else {
                clearMapSelection();
                selectCheckpoint(n.id);
              }
            }}
            onNodeDoubleClick={(_, n) => {
              if (isNoteNode(n)) setState({ noteEdit: n.id.slice(NOTE_PREFIX.length) });
              else {
                selectCheckpoint(n.id);
                setState({ mapRename: n.id });
              }
            }}
            onEdgeClick={(_, e) => {
              if (e.type !== 'prereq') return;
              setGroup([]);
              selectCheckpoint(null);
              setSelectedNote(null);
              setSelectedEdge(e.id);
            }}
            onPaneClick={() => {
              clearMapSelection();
              setGroup([]);
              selectCheckpoint(null);
            }}
            onSelectionStart={() => {
              boxing.current = true;
              boxed.current = new Set();
              clearMapSelection();
              setGroup([]);
              if (getState().selectedId) selectCheckpoint(null);
            }}
            onSelectionEnd={() => {
              boxing.current = false;
              // Two or more stay a group; one becomes the normal selection.
              select([...boxed.current]);
            }}
            onNodeContextMenu={(_, n) => {
              if (inGroup && groupSet.has(n.id)) return setMenu({ kind: 'group' });
              setGroup([]);
              if (isNoteNode(n)) {
                const id = n.id.slice(NOTE_PREFIX.length);
                setSelectedNote(id);
                setMenu({ kind: 'note', id });
              } else {
                clearMapSelection();
                selectCheckpoint(n.id);
                setMenu({ kind: 'node', id: n.id });
              }
            }}
            onEdgeContextMenu={(_, e) => {
              if (e.type === 'prereq') {
                setSelectedEdge(e.id);
                setMenu({ kind: 'edge', first: e.source, then: e.target });
              } else setMenu(null);
            }}
            onPaneContextMenu={(e) => setMenu({ kind: 'pane', ...flow.screenToFlowPosition({ x: e.clientX, y: e.clientY }) })}
            onNodeDragStart={onNodeDragStart}
            onNodeDrag={onNodeDrag}
            onNodeDragStop={onNodeDragStop}
            onConnect={onConnect}
            onConnectEnd={onConnectEnd}
            isValidConnection={(c) => c.source !== c.target && c.targetHandle === 'drop' && !isNoteNode({ id: c.target })}
            connectionLineStyle={CONNECTION_LINE}
            connectionRadius={0}
            nodesConnectable
            elementsSelectable
            selectNodesOnDrag={false}
            fitView
            fitViewOptions={{ padding: FIT_PADDING, maxZoom: 1.05 }}
            minZoom={0.1}
            maxZoom={2}
            onlyRenderVisibleElements={nodes.length > 150 && !capturing}
            zoomOnDoubleClick={false}
            deleteKeyCode={null}
            selectionKeyCode="Shift"
            selectionMode={SelectionMode.Partial}
            multiSelectionKeyCode={null}
            disableKeyboardA11y
          >
            <NodeToolbar nodeId={group} isVisible={inGroup && !dropTarget} position={Position.Top} offset={12}>
              <GroupTools profile={profile} cps={groupCps} notes={groupNotes.length} onDelete={deleteGroup} onClear={() => setGroup([])} />
            </NodeToolbar>
            <Background variant={BackgroundVariant.Lines} gap={28} lineWidth={1} color="var(--canvas-grid)" />
            <Controls showInteractive={false} position="bottom-left" />
            <MiniMap
              pannable
              zoomable
              position="bottom-right"
              nodeColor={(n) => {
                if (n.type === 'note') return NOTE_FILL[(n.data as NoteData).note.color];
                const d = n.data as NodeData;
                const c = statusDef(d.profile, d.cp.status).category;
                return c === 'done' ? 'var(--done)' : c === 'review' ? 'var(--review)' : c === 'active' ? 'var(--active)' : d.depth === 0 ? 'var(--node-main)' : 'var(--line-strong)';
              }}
              nodeBorderRadius={6}
              className="!hidden sm:!block"
              ariaLabel="Mini map"
            />
          </ReactFlow>
        </CtxMenu.Trigger>
        <CtxMenu.Content>
          {menu?.kind === 'node' && menuNodeCp && (
            <>
              <CtxMenu.Label>{menuNodeCp.title}</CtxMenu.Label>
              <CtxMenu.Item onSelect={() => startRename(menuNodeCp.id)} hint="F2">
                <Pencil size={14} /> Rename
              </CtxMenu.Item>
              <CtxMenu.Item onSelect={() => addCheckpoint(menuNodeCp.id)} hint="A">
                <CornerDownRight size={14} /> Add sub-checkpoint
              </CtxMenu.Item>
              <CtxMenu.Item onSelect={() => addSibling(menuNodeCp.id)} hint="N">
                <Plus size={14} /> Add next checkpoint
              </CtxMenu.Item>
              <CtxMenu.Sub>
                <CtxMenu.SubTrigger>
                  <StatusIcon category={statusDef(profile, menuNodeCp.status).category} size={14} /> Status
                </CtxMenu.SubTrigger>
                <CtxMenu.SubContent>
                  {profile.statuses.map((s) => (
                    <CtxMenu.Item key={s.key} onSelect={() => setStatus(menuNodeCp.id, s.key)}>
                      <StatusIcon category={s.category} size={14} /> {s.label}
                    </CtxMenu.Item>
                  ))}
                </CtxMenu.SubContent>
              </CtxMenu.Sub>
              <CtxMenu.Item onSelect={() => setState({ detailsOpen: true, pageMode: true })}>
                <FileText size={14} /> Open as a full page
              </CtxMenu.Item>
              <CtxMenu.Item onSelect={() => newNote()}>
                <StickyNote size={14} /> Add a sticky note beside it
              </CtxMenu.Item>
              <CtxMenu.Item onSelect={() => setFocus(menuNodeCp.id)} hint="F">
                <Focus size={14} /> Focus on this branch
              </CtxMenu.Item>
              <CtxMenu.Item onSelect={() => void updateFields(menuNodeCp.id, { optional: !menuNodeCp.optional }, menuNodeCp.optional ? 'make required' : 'make optional')}>
                <span className="w-3.5 text-center">{menuNodeCp.optional ? '✓' : ''}</span> Optional path
              </CtxMenu.Item>
              <CtxMenu.Separator />
              <CtxMenu.Item danger onSelect={() => requestDelete(menuNodeCp.id)} hint="Del">
                <Trash size={14} /> Delete…
              </CtxMenu.Item>
            </>
          )}
          {menu?.kind === 'group' && inGroup && (
            <>
              <CtxMenu.Label>{group.length} selected</CtxMenu.Label>
              {groupCps.length > 0 && (
                <CtxMenu.Sub>
                  <CtxMenu.SubTrigger>
                    <StatusIcon category="active" size={14} /> Status
                  </CtxMenu.SubTrigger>
                  <CtxMenu.SubContent>
                    {profile.statuses.map((st) => (
                      <CtxMenu.Item key={st.key} onSelect={() => setStatusMany(groupCps, st.key)}>
                        <StatusIcon category={st.category} size={14} /> {st.label}
                      </CtxMenu.Item>
                    ))}
                  </CtxMenu.SubContent>
                </CtxMenu.Sub>
              )}
              <CtxMenu.Item onSelect={() => setGroup([])} hint="Esc">
                <X size={14} /> Clear the selection
              </CtxMenu.Item>
              <CtxMenu.Separator />
              <CtxMenu.Item danger onSelect={deleteGroup} hint="Del">
                <Trash size={14} /> Delete {group.length} items…
              </CtxMenu.Item>
            </>
          )}
          {menu?.kind === 'note' && menuNote && (
            <>
              <CtxMenu.Item onSelect={() => setState({ noteEdit: menuNote.id })}>
                <Pencil size={14} /> Edit note
              </CtxMenu.Item>
              <CtxMenu.Sub>
                <CtxMenu.SubTrigger>
                  <span className="size-3.5 rounded-full border border-ink/40" style={{ background: NOTE_FILL[menuNote.color] }} /> Colour
                </CtxMenu.SubTrigger>
                <CtxMenu.SubContent>
                  {NOTE_COLORS.map((c) => (
                    <CtxMenu.Item key={c} onSelect={() => updateNote(menuNote.id, { color: c }, 'note colour')}>
                      <span className="size-3.5 rounded-full border border-ink/40" style={{ background: NOTE_FILL[c] }} /> {c[0]!.toUpperCase() + c.slice(1)}
                    </CtxMenu.Item>
                  ))}
                </CtxMenu.SubContent>
              </CtxMenu.Sub>
              <CtxMenu.Separator />
              <CtxMenu.Item danger onSelect={() => deleteNote(menuNote.id)} hint="Del">
                <Trash size={14} /> Delete note
              </CtxMenu.Item>
            </>
          )}
          {menu?.kind === 'edge' && (
            <>
              <CtxMenu.Label>
                “{rm.checkpoints[menu.then]?.title}” requires “{rm.checkpoints[menu.first]?.title}”
              </CtxMenu.Label>
              <CtxMenu.Item danger onSelect={() => (unlink(menu.then, menu.first), setSelectedEdge(null))} hint="Del">
                <Unlink size={14} /> Remove this link
              </CtxMenu.Item>
            </>
          )}
          {(menu?.kind === 'pane' || !menu) && (
            <>
              <CtxMenu.Item onSelect={() => addCheckpoint(null)}>
                <Plus size={14} /> Add main checkpoint
              </CtxMenu.Item>
              <CtxMenu.Item onSelect={() => newNote(menu?.kind === 'pane' ? { x: menu.x, y: menu.y } : undefined)}>
                <StickyNote size={14} /> Add a sticky note here
              </CtxMenu.Item>
              <CtxMenu.Separator />
              <CtxMenu.Item onSelect={() => setExpandedAll(true)}>Expand everything</CtxMenu.Item>
              <CtxMenu.Item onSelect={() => setExpandedAll(false)}>Collapse to main checkpoints</CtxMenu.Item>
              <CtxMenu.Item onSelect={() => overview()} hint="O">
                <Maximize2 size={14} /> Show the whole roadmap
              </CtxMenu.Item>
            </>
          )}
        </CtxMenu.Content>
      </CtxMenu.Root>
      <CanvasToolbar rm={rm} onNote={() => newNote()} />
      {layout.nodes.length === 0 && <EmptyMap rm={rm} />}
    </div>
  );
}

function CanvasToolbar({ rm, onNote }: { rm: Roadmap; onNote: () => void }) {
  const focusId = useStore((s) => s.focusId);
  const selectedId = useStore((s) => s.selectedId);
  const prereqMode = useStore((s) => s.prereqMode);
  const undoLabel = useStore((s) => s.undoStack[s.undoStack.length - 1]?.label);
  const redoLabel = useStore((s) => s.redoStack[s.redoStack.length - 1]?.label);
  const focusTitle = focusId ? rm.checkpoints[focusId]?.title : null;
  return (
    <div className="pointer-events-none absolute left-3 right-3 top-3 z-10 flex flex-wrap items-start gap-2">
      <div className="pointer-events-auto flex items-center gap-0.5 rounded-lg border-[1.5px] border-ink/80 bg-surface p-1 shadow-md">
        <Tip label="Add a main checkpoint">
          <Button size="sm" variant="ghost" aria-label="Add a main checkpoint" onClick={() => addCheckpoint(null)}>
            <Plus size={14} /> <span className="hidden sm:inline">Main checkpoint</span>
          </Button>
        </Tip>
        <Tip label={selectedId ? 'Add a sub-checkpoint to the selection (A)' : 'Select a checkpoint first'}>
          <span>
            <Button size="sm" variant="ghost" aria-label="Add a sub-checkpoint" disabled={!selectedId} onClick={() => selectedId && addCheckpoint(selectedId)}>
              <ChevronRight size={14} /> <span className="hidden sm:inline">Sub-checkpoint</span>
            </Button>
          </span>
        </Tip>
        <Tip label="Add a sticky note (next to the selection, or in the middle)">
          <Button size="sm" variant="ghost" aria-label="Add a sticky note" onClick={onNote}>
            <StickyNote size={14} /> <span className="hidden lg:inline">Note</span>
          </Button>
        </Tip>
        <span className="mx-1 h-5 w-px bg-line" />
        <IconButton size="sm" label={undoLabel ? `Undo ${undoLabel} (Ctrl+Z)` : 'Nothing to undo'} disabled={!undoLabel} onClick={() => void undoLast()}>
          <Undo2 size={15} />
        </IconButton>
        <IconButton size="sm" label={redoLabel ? `Redo ${redoLabel} (Ctrl+Y)` : 'Nothing to redo'} disabled={!redoLabel} onClick={() => void redoLast()}>
          <Redo2 size={15} />
        </IconButton>
        <IconButton size="sm" label={selectedId ? 'Focus on the selection (F)' : 'Select a checkpoint to focus on it'} disabled={!selectedId} onClick={() => selectedId && setFocus(selectedId)}>
          <Focus size={15} />
        </IconButton>
        <IconButton size="sm" label="Overview: show the whole roadmap (O)" onClick={() => overview()}>
          <Maximize2 size={15} />
        </IconButton>
        <Menu.Root>
          <Menu.Trigger asChild>
            <button className="inline-flex size-7 items-center justify-center rounded-lg text-muted hover:bg-surface-2 hover:text-fg" aria-label="View options">
              <MapIcon size={15} />
            </button>
          </Menu.Trigger>
          <Menu.Content align="start">
            <Menu.Label>Branches</Menu.Label>
            <Menu.Item onSelect={() => setExpandedAll(true)}>Expand everything</Menu.Item>
            <Menu.Item onSelect={() => setExpandedAll(false)}>Collapse to main checkpoints</Menu.Item>
            <Menu.Separator />
            <Menu.Label>Prerequisite arrows</Menu.Label>
            <Menu.RadioGroup value={prereqMode} onValueChange={(v) => setState({ prereqMode: v as 'all' | 'selected' })}>
              <Menu.RadioItem value="all">Show all</Menu.RadioItem>
              <Menu.RadioItem value="selected">Only for the selection</Menu.RadioItem>
            </Menu.RadioGroup>
            <Menu.Separator />
            <Menu.Item onSelect={() => saveLayout({ offsets: {} }, 'reset positions')} disabled={!Object.keys(rm.layout?.offsets ?? {}).length}>
              Reset manual positions
            </Menu.Item>
          </Menu.Content>
        </Menu.Root>
        <Legend />
      </div>
      {focusTitle && (
        <div className="pointer-events-auto flex items-center gap-2 rounded-xl border border-accent/30 bg-accent-soft py-1 pl-3 pr-1 text-[12.5px] text-accent shadow-sm">
          <Focus size={13} /> Focused on <span className="max-w-48 truncate font-semibold">{focusTitle}</span>
          <Button size="sm" variant="ghost" className="!text-accent" onClick={() => overview()}>
            Show all
          </Button>
        </div>
      )}
    </div>
  );
}

function Legend() {
  return (
    <Menu.Root>
      <Menu.Trigger asChild>
        <button className="inline-flex h-7 items-center rounded-lg px-2 text-[12px] font-medium text-muted hover:bg-surface-2 hover:text-fg">Legend</button>
      </Menu.Trigger>
      <Menu.Content align="start" className="w-80 p-3">
        <div className="grid gap-2 text-[12.5px]">
          <div className="flex items-center gap-2">
            <svg width="34" height="10"><line x1="2" y1="5" x2="32" y2="5" stroke="var(--spine)" strokeWidth="4" strokeLinecap="round" /></svg>Main path (main checkpoints in order)
          </div>
          <div className="flex items-center gap-2">
            <svg width="34" height="10"><line x1="0" y1="5" x2="34" y2="5" stroke="var(--branch)" strokeWidth="2" /></svg>Parent → sub-checkpoint
          </div>
          <div className="flex items-center gap-2">
            <svg width="34" height="10"><line x1="0" y1="5" x2="28" y2="5" stroke="var(--link)" strokeWidth="1.5" strokeDasharray="5 4" /><path d="M27 1 L34 5 L27 9 Z" fill="var(--link)" /></svg>Requires (prerequisite → checkpoint)
          </div>
          <div className="flex items-center gap-2">
            <span className="h-4 w-8 rounded-sm border-2 border-ink" style={{ background: 'var(--node-main)' }} />Main checkpoint
          </div>
          <div className="flex items-center gap-2">
            <span className="h-4 w-8 rounded-sm border-[1.5px] border-ink/70" style={{ background: 'var(--node-sub)' }} />Sub-checkpoint
          </div>
          <div className="flex items-center gap-2">
            <span className="h-4 w-8 rounded-sm border-[1.5px] border-dashed border-ink/70" style={{ background: 'var(--node-sub)' }} />Optional checkpoint
          </div>
          <div className="flex items-center gap-1.5">
            <span className="h-4 w-5 rounded-sm border border-ink/50" style={{ background: 'var(--node-active)' }} />
            <span className="h-4 w-5 rounded-sm border border-ink/50" style={{ background: 'var(--node-review)' }} />
            <span className="h-4 w-5 rounded-sm border border-ink/50" style={{ background: 'var(--node-done-sub)' }} />
            <span className="ml-1">In progress, needs review, complete</span>
          </div>
          <div className="flex items-center gap-2">
            <span className="rounded border border-dashed border-line-strong px-1 text-[10.5px] text-faint">draft</span>Content not approved by you yet
          </div>
          <div className="flex items-center gap-2">
            <span className="ml-3 mr-3 size-2 rounded-full bg-accent" />Changed by an agent, not reviewed
          </div>
          <div className="mt-1 grid grid-cols-2 gap-1.5 border-t border-line pt-2">
            <span className="flex items-center gap-1.5"><StatusIcon category="todo" /> Not started</span>
            <span className="flex items-center gap-1.5"><StatusIcon category="active" /> In progress</span>
            <span className="flex items-center gap-1.5"><StatusIcon category="review" /> Needs review</span>
            <span className="flex items-center gap-1.5"><StatusIcon category="done" /> Complete</span>
          </div>
          <div className="mt-1 grid gap-1 border-t border-line pt-2 text-muted">
            <div className="font-medium text-fg">Editing the map</div>
            <div>Double-click a checkpoint to rename it. Drag its blue dot to another checkpoint to link them, or to empty space to add a sub-checkpoint.</div>
            <div>Drop a checkpoint onto another to move it under that one. Right-click anything for more.</div>
            <div>Shift+drag on empty space, or Ctrl+click, to select several and move, mark or delete them together.</div>
          </div>
        </div>
      </Menu.Content>
    </Menu.Root>
  );
}

function EmptyMap({ rm }: { rm: Roadmap }) {
  const [title, setTitle] = useState('');
  return (
    <div className="pointer-events-none absolute inset-0 z-[5] flex items-center justify-center p-6">
      <div className="pointer-events-auto w-full max-w-md rounded-2xl border border-line bg-surface p-6 shadow-md">
        <div className="text-[15px] font-semibold">Start with a few main checkpoints</div>
        <p className="mt-1 text-[13px] leading-relaxed text-muted">
          Type the big steps of “{rm.meta.title}”. You don't need the details yet: you'll add sub-checkpoints when you get there. Or ask your agent to draft them.
        </p>
        <form
          className="mt-4 flex gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            if (!title.trim()) return;
            const all = Object.values(getState().roadmap?.checkpoints ?? {}).filter((c) => !c.parent);
            addCheckpoint(null, { title, select: false, after: all.length ? all[all.length - 1]!.id : undefined });
            setTitle('');
          }}
        >
          <input
            autoFocus
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder="e.g. Understand the basics"
            className="h-9 min-w-0 flex-1 rounded-lg border border-line bg-surface px-3 text-[13.5px] outline-none focus:border-accent"
          />
          <Button variant="primary" type="submit">
            Add
          </Button>
        </form>
        <div className="mt-4 flex items-center gap-2 border-t border-line pt-3 text-[12.5px] text-muted">
          <Chip tone="accent">Tip</Chip> Open <span className="font-medium text-fg">⋯ → Work with an agent</span> to have Claude or another agent draft it.
        </div>
      </div>
    </div>
  );
}
