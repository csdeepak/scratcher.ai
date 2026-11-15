// Automatic layout: a tidy tree (Reingold–Tilford via d3-hierarchy) laid out left → right.
// Main checkpoints form the left column ("main path"); sub-checkpoints branch to the right.
// Manual offsets from layout.json are added on top and carry their subtree with them.

import { hierarchy, tree } from 'd3-hierarchy';
import type { Checkpoint, Roadmap } from '../shared/model';
import { childrenIndex } from '../shared/tree';

export const NODE_W = 248;
export const NODE_H = 74;
export const COL_GAP = 64;
export const ROW_GAP = 18;

export interface LaidOutNode {
  cp: Checkpoint;
  x: number;
  y: number;
  depth: number;
  childCount: number;
  open: boolean;
  dimmed: boolean;
}

export interface Layout {
  nodes: LaidOutNode[];
  byId: Map<string, LaidOutNode>;
  hierarchyEdges: { source: string; target: string }[];
  spineEdges: { source: string; target: string }[];
  prereqEdges: { source: string; target: string }[];
  /** visible ids in reading order (for keyboard navigation) */
  order: string[];
}

interface TNode {
  id: string;
  children: TNode[];
}

export function computeLayout(rm: Roadmap, expanded: Set<string>, focusId: string | null): Layout {
  const cps = rm.checkpoints;
  const idx = childrenIndex(cps);
  const visibleKids = (id: string) => (idx.get(id) ?? []).filter((c) => !c.archived);

  const focusPath = new Set<string>();
  if (focusId && cps[focusId]) {
    let p: string | null = focusId;
    while (p && cps[p] && !focusPath.has(p)) {
      focusPath.add(p);
      p = cps[p]!.parent;
    }
  }
  const inFocusSubtree = (id: string): boolean => {
    if (!focusId) return true;
    let p: string | null = id;
    const seen = new Set<string>();
    while (p && !seen.has(p)) {
      if (p === focusId) return true;
      seen.add(p);
      p = cps[p]?.parent ?? null;
    }
    return false;
  };
  const isOpen = (id: string) => {
    if (!focusId) return expanded.has(id);
    if (focusPath.has(id)) return id === focusId ? true : true;
    return inFocusSubtree(id) && expanded.has(id);
  };

  const order: string[] = [];
  const build = (cp: Checkpoint): TNode => {
    order.push(cp.id);
    const kids = isOpen(cp.id) ? visibleKids(cp.id) : [];
    return { id: cp.id, children: kids.map(build) };
  };
  const top = visibleKids('');
  const root: TNode = { id: '__root', children: top.map(build) };

  const h = hierarchy<TNode>(root, (d) => (d.children.length ? d.children : null));
  tree<TNode>()
    .nodeSize([NODE_H + ROW_GAP, NODE_W + COL_GAP])
    .separation((a, b) => (a.parent === b.parent ? 1 : 1.3))(h);

  // Manual offsets accumulate down the tree so a moved branch keeps its shape.
  const offsets = rm.layout?.offsets ?? {};
  const acc = new Map<string, { dx: number; dy: number }>();
  const nodes: LaidOutNode[] = [];
  const byId = new Map<string, LaidOutNode>();
  h.each((n) => {
    if (n.data.id === '__root') return;
    const parentAcc = n.parent && n.parent.data.id !== '__root' ? acc.get(n.parent.data.id)! : { dx: 0, dy: 0 };
    const own = offsets[n.data.id] ?? { dx: 0, dy: 0 };
    const total = { dx: parentAcc.dx + own.dx, dy: parentAcc.dy + own.dy };
    acc.set(n.data.id, total);
    const cp = cps[n.data.id]!;
    const node: LaidOutNode = {
      cp,
      x: (n.depth - 1) * (NODE_W + COL_GAP) + total.dx,
      y: (n.x ?? 0) + total.dy,
      depth: n.depth - 1,
      childCount: visibleKids(cp.id).length,
      open: n.children !== undefined && n.children.length > 0,
      dimmed: !!focusId && !inFocusSubtree(cp.id) && !focusPath.has(cp.id),
    };
    nodes.push(node);
    byId.set(cp.id, node);
  });

  const hierarchyEdges: Layout['hierarchyEdges'] = [];
  for (const n of nodes) if (n.cp.parent && byId.has(n.cp.parent)) hierarchyEdges.push({ source: n.cp.parent, target: n.cp.id });
  const spineEdges: Layout['spineEdges'] = [];
  for (let i = 1; i < top.length; i++) spineEdges.push({ source: top[i - 1]!.id, target: top[i]!.id });
  const prereqEdges: Layout['prereqEdges'] = [];
  for (const n of nodes) {
    for (const p of n.cp.prerequisites) if (byId.has(p)) prereqEdges.push({ source: p, target: n.cp.id });
  }
  return { nodes, byId, hierarchyEdges, spineEdges, prereqEdges, order };
}

/** Auto position (without this node's own offset) — used to turn a drag into an offset. */
export function autoPosition(layout: Layout, rm: Roadmap, id: string): { x: number; y: number } | null {
  const n = layout.byId.get(id);
  if (!n) return null;
  const own = rm.layout?.offsets?.[id] ?? { dx: 0, dy: 0 };
  return { x: n.x - own.dx, y: n.y - own.dy };
}
