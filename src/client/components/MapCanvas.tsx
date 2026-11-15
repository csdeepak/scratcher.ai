import { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Background,
  BackgroundVariant,
  BaseEdge,
  Controls,
  Handle,
  MarkerType,
  MiniMap,
  Position,
  ReactFlow,
  applyNodeChanges,
  getBezierPath,
  getNodesBounds,
  useInternalNode,
  useReactFlow,
  type Edge,
  type EdgeProps,
  type Node,
  type NodeChange,
  type NodeProps,
} from '@xyflow/react';
import { ChevronRight, Focus, Maximize2, Minus, Plus, Map as MapIcon, Pause } from 'lucide-react';
import type { Checkpoint, Roadmap } from '../../shared/model';
import { getProfile, statusDef, type Profile } from '../../shared/profiles';
import type { Progress } from '../../shared/tree';
import { NODE_H, NODE_W, autoPosition, type Layout } from '../layout';
import { getState, overview, selectCheckpoint, setExpandedAll, setFocus, setState, toggleExpanded, useStore } from '../store';
import { addCheckpoint } from '../actions';
import { http } from '../api';
import { toPng } from 'html-to-image';
import { registerMapCapture } from '../mapExport';
import { Button, Chip, IconButton, Menu, ProgressBar, StatusIcon, Tip, UnderstandingIcon, cx } from './ui';

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
}

type CPNode = Node<NodeData, 'checkpoint'>;

const CheckpointNode = memo(function CheckpointNode({ data, selected }: NodeProps<CPNode>) {
  const { cp, profile, depth, childCount, open, dimmed, progress, unreviewed, held } = data;
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
    <div
      className={cx(
        'wm-node group relative flex flex-col justify-between rounded-md px-3 pb-2 pt-2 transition-[box-shadow,opacity] duration-150',
        main ? 'border-2' : 'border-[1.5px]',
        cp.optional && 'border-dashed',
        selected ? 'shadow-[0_0_0_3px_var(--accent)]' : 'hover:shadow-[0_0_0_2px_color-mix(in_srgb,var(--accent)_45%,transparent)]',
        dimmed && !selected && 'opacity-40',
      )}
      style={{
        width: NODE_W,
        height: NODE_H,
        background: fill,
        borderColor: main ? 'var(--ink)' : 'color-mix(in srgb, var(--ink) 70%, transparent)',
        color: brightFill ? '#1c1917' : 'var(--node-text)',
      }}
      title={cp.summary || cp.title}
    >
      {main && status.category === 'active' && (
        <span aria-hidden className="absolute -top-px left-3 right-3 h-[3px] rounded-b" style={{ background: 'var(--active)' }} />
      )}
      <Handle type="target" position={Position.Left} id="in" isConnectable={false} />
      <Handle type="source" position={Position.Right} id="out" isConnectable={false} />
      <Handle type="target" position={Position.Top} id="top" isConnectable={false} />
      <Handle type="source" position={Position.Bottom} id="bottom" isConnectable={false} />
      <div className="flex items-start gap-2">
        <span className="mt-[2px]">
          <StatusIcon category={status.category} label={status.label} size={15} />
        </span>
        <div className={cx('line-clamp-2 min-w-0 flex-1 leading-[1.28]', main ? 'text-[14px] font-semibold' : 'text-[13px] font-medium')}>{cp.title}</div>
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
        >
          {open ? <Minus size={12} strokeWidth={2.5} /> : childCount}
        </button>
      )}
    </div>
  );
});

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

function PrereqEdge({ id, source, target, markerEnd, style }: EdgeProps) {
  const s = useInternalNode(source);
  const t = useInternalNode(target);
  if (!s || !t) return null;
  const p = edgeParams(s, t);
  const sameCol = p.spos === p.tpos;
  const [path] = getBezierPath({
    sourceX: p.sx,
    sourceY: p.sy,
    sourcePosition: p.spos,
    targetX: p.tx + (sameCol ? 4 : 0),
    targetY: p.ty,
    targetPosition: p.tpos,
    curvature: sameCol ? 0.6 : 0.3,
  });
  return <BaseEdge id={id} path={path} markerEnd={markerEnd} style={style} />;
}

const nodeTypes = { checkpoint: CheckpointNode };
const FIT_PADDING = { top: '72px', left: '32px', right: '48px', bottom: '40px' } as const;
const edgeTypes = { prereq: PrereqEdge };

export function MapCanvas({ rm, layout, progress }: { rm: Roadmap; layout: Layout; progress: Map<string | null, Progress> }) {
  const selectedId = useStore((s) => s.selectedId);
  const focusId = useStore((s) => s.focusId);
  const prereqMode = useStore((s) => s.prereqMode);
  const fitRequest = useStore((s) => s.fitRequest);
  const centerRequest = useStore((s) => s.centerRequest);
  const reviewItems = useStore((s) => s.review.items);
  const profile = getProfile(rm.meta.profile);
  const flow = useReactFlow();

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

  const derived: CPNode[] = useMemo(
    () =>
      layout.nodes.map((n) => ({
        id: n.cp.id,
        type: 'checkpoint',
        position: { x: n.x, y: n.y },
        width: NODE_W,
        height: NODE_H,
        selected: n.cp.id === selectedId,
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
        },
      })),
    [layout, selectedId, profile, progress, unreviewed, held],
  );

  const [nodes, setNodes] = useState<CPNode[]>(derived);
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

  const onNodesChange = useCallback((changes: NodeChange<CPNode>[]) => {
    const keep = changes.filter((c) => c.type === 'position' || c.type === 'dimensions');
    if (keep.length) setNodes((nds) => applyNodeChanges(keep, nds));
  }, []);

  const dragStart = useRef<{ id: string; x: number; y: number; descendants: Map<string, { x: number; y: number }> } | null>(null);

  const onNodeDragStart = useCallback(
    (_: unknown, node: CPNode) => {
      const descendants = new Map<string, { x: number; y: number }>();
      const cps = rm.checkpoints;
      for (const n of layout.nodes) {
        let p = n.cp.parent;
        while (p) {
          if (p === node.id) {
            descendants.set(n.cp.id, { x: n.x, y: n.y });
            break;
          }
          p = cps[p]?.parent ?? null;
        }
      }
      dragStart.current = { id: node.id, x: node.position.x, y: node.position.y, descendants };
    },
    [layout, rm.checkpoints],
  );

  const onNodeDrag = useCallback((_: unknown, node: CPNode) => {
    const d = dragStart.current;
    if (!d || d.id !== node.id || !d.descendants.size) return;
    const dx = node.position.x - d.x;
    const dy = node.position.y - d.y;
    setNodes((nds) => nds.map((n) => (d.descendants.has(n.id) ? { ...n, position: { x: d.descendants.get(n.id)!.x + dx, y: d.descendants.get(n.id)!.y + dy } } : n)));
  }, []);

  const onNodeDragStop = useCallback(
    (_: unknown, node: CPNode) => {
      const d = dragStart.current;
      dragStart.current = null;
      if (!d || (Math.abs(node.position.x - d.x) < 2 && Math.abs(node.position.y - d.y) < 2)) return;
      const auto = autoPosition(layout, rm, node.id);
      if (!auto) return;
      const offsets = { ...(rm.layout?.offsets ?? {}) };
      offsets[node.id] = { dx: node.position.x - auto.x, dy: node.position.y - auto.y };
      const cur = getState().roadmap;
      if (cur) setState({ roadmap: { ...cur, layout: { schema: 'waymark-layout/1', offsets } } });
      void http.put(`/api/roadmaps/${rm.meta.id}/layout`, { offsets });
    },
    [layout, rm],
  );

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
      const involved = selectedId === e.source || selectedId === e.target;
      if (prereqMode === 'selected' && !involved) continue;
      out.push({
        id: `p-${e.source}-${e.target}`,
        source: e.source,
        target: e.target,
        type: 'prereq',
        selectable: false,
        focusable: false,
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
  }, [layout, selectedId, prereqMode]);

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

  return (
    <div ref={wrapRef} className="relative h-full w-full">
      <ReactFlow<CPNode>
        onMoveStart={(e) => {
          if (e) userMoved.current = true;
        }}
        nodes={nodes}
        edges={edges}
        nodeTypes={nodeTypes}
        edgeTypes={edgeTypes}
        onNodesChange={onNodesChange}
        onNodeClick={(_, n) => selectCheckpoint(n.id)}
        onNodeDoubleClick={(_, n) => {
          selectCheckpoint(n.id);
          if (n.data.childCount) toggleExpanded(n.id);
        }}
        onPaneClick={() => selectCheckpoint(null)}
        onNodeDragStart={onNodeDragStart}
        onNodeDrag={onNodeDrag}
        onNodeDragStop={onNodeDragStop}
        nodesConnectable={false}
        elementsSelectable
        selectNodesOnDrag={false}
        fitView
        fitViewOptions={{ padding: FIT_PADDING, maxZoom: 1.05 }}
        minZoom={0.1}
        maxZoom={2}
        onlyRenderVisibleElements={nodes.length > 150 && !capturing}
        zoomOnDoubleClick={false}
        deleteKeyCode={null}
        selectionKeyCode={null}
        multiSelectionKeyCode={null}
        disableKeyboardA11y
      >
        <Background variant={BackgroundVariant.Lines} gap={28} lineWidth={1} color="var(--canvas-grid)" />
        <Controls showInteractive={false} position="bottom-left" />
        <MiniMap
          pannable
          zoomable
          position="bottom-right"
          nodeColor={(n) => {
            const d = n.data as NodeData;
            const c = statusDef(d.profile, d.cp.status).category;
            return c === 'done' ? 'var(--done)' : c === 'review' ? 'var(--review)' : c === 'active' ? 'var(--active)' : d.depth === 0 ? 'var(--node-main)' : 'var(--line-strong)';
          }}
          nodeBorderRadius={6}
          className="!hidden sm:!block"
          ariaLabel="Mini map"
        />
      </ReactFlow>
      <CanvasToolbar rm={rm} />
      {layout.nodes.length === 0 && <EmptyMap rm={rm} />}
    </div>
  );
}

function CanvasToolbar({ rm }: { rm: Roadmap }) {
  const focusId = useStore((s) => s.focusId);
  const selectedId = useStore((s) => s.selectedId);
  const prereqMode = useStore((s) => s.prereqMode);
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
        <span className="mx-1 h-5 w-px bg-line" />
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
            <Menu.Item
              onSelect={() => {
                const cur = getState().roadmap;
                if (!cur) return;
                setState({ roadmap: { ...cur, layout: { schema: 'waymark-layout/1', offsets: {} } } });
                void http.put(`/api/roadmaps/${cur.meta.id}/layout`, { offsets: {} });
              }}
              disabled={!Object.keys(rm.layout?.offsets ?? {}).length}
            >
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
      <Menu.Content align="start" className="w-72 p-3">
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

