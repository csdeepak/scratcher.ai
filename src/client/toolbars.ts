// Toolbars you arrange yourself: the notes formatting bar and the map toolbar.
//
// The pattern is Joplin's "Manage toolbar options" (its mobile editor toolbar): the buttons on the
// bar in order, each with up/down, the rest under "Available", and "Restore defaults". Like the
// overflow menus in Office and Firefox, anything that isn't on a bar stays in that bar's "⋯" menu,
// so nothing becomes unreachable. Layouts are saved on this computer and apply to every roadmap.

import { useMemo } from 'react';
import { toast } from 'sonner';
import { getState, setState, useStore, type BarId } from './store';

export type { BarId };

export interface BarItem {
  id: string;
  label: string;
  /** Keyboard shortcut, shown in tooltips. */
  hint?: string;
  /** What the item contains, for items that open a list. */
  detail?: string;
  /** Neighbours in the same group sit together; a thin divider separates groups. */
  group: string;
}

export interface BarSpec {
  title: string;
  items: BarItem[];
  defaults: string[];
}

export const BARS: Record<BarId, BarSpec> = {
  notes: {
    title: 'Notes formatting bar',
    items: [
      { id: 'heading', label: 'Text style', detail: 'Normal text, Heading, Subheading, Small heading', group: 'text' },
      { id: 'bold', label: 'Bold', hint: 'Ctrl+B', group: 'marks' },
      { id: 'italic', label: 'Italic', hint: 'Ctrl+I', group: 'marks' },
      { id: 'strikethrough', label: 'Strikethrough', group: 'marks' },
      { id: 'code', label: 'Code', group: 'marks' },
      { id: 'link', label: 'Link', group: 'marks' },
      { id: 'bullet-list', label: 'Bulleted list', group: 'lists' },
      { id: 'ordered-list', label: 'Numbered list', group: 'lists' },
      { id: 'task-list', label: 'Checklist', group: 'lists' },
      { id: 'insert', label: 'Insert', detail: 'Image, Table, Code block, Maths, Quote, Divider', group: 'insert' },
      { id: 'image', label: 'Image', group: 'blocks' },
      { id: 'table', label: 'Table', group: 'blocks' },
      { id: 'code-block', label: 'Code block', group: 'blocks' },
      { id: 'math', label: 'Maths (LaTeX)', group: 'blocks' },
      { id: 'quote', label: 'Quote', group: 'blocks' },
      { id: 'hr', label: 'Divider', group: 'blocks' },
    ],
    defaults: ['heading', 'bold', 'italic', 'strikethrough', 'code', 'link', 'bullet-list', 'ordered-list', 'task-list', 'insert'],
  },
  map: {
    title: 'Map toolbar',
    items: [
      { id: 'main', label: 'Add a main checkpoint', group: 'add' },
      { id: 'sub', label: 'Add a sub-checkpoint', hint: 'A', group: 'add' },
      { id: 'note', label: 'Add a sticky note', group: 'add' },
      { id: 'undo', label: 'Undo', hint: 'Ctrl+Z', group: 'tools' },
      { id: 'redo', label: 'Redo', hint: 'Ctrl+Y', group: 'tools' },
      { id: 'focus', label: 'Focus on the selection', hint: 'F', group: 'tools' },
      { id: 'overview', label: 'Overview: show the whole roadmap', hint: 'O', group: 'tools' },
      { id: 'view', label: 'View options', detail: 'Expand or collapse branches, prerequisite arrows, reset positions', group: 'tools' },
      { id: 'legend', label: 'Legend', group: 'tools' },
      { id: 'expand', label: 'Expand everything', group: 'tools' },
      { id: 'collapse', label: 'Collapse to main checkpoints', group: 'tools' },
      { id: 'reset', label: 'Reset manual positions', group: 'tools' },
      { id: 'image', label: 'Save the map as an image', group: 'files' },
      { id: 'export', label: 'Export…', group: 'files' },
    ],
    defaults: ['main', 'sub', 'note', 'undo', 'redo', 'focus', 'overview', 'view', 'legend'],
  },
};

const KEY = 'waymark.toolbars';

export function barItem(bar: BarId, id: string): BarItem | undefined {
  return BARS[bar].items.find((i) => i.id === id);
}

/** Name for a tooltip or screen reader, with the shortcut when there is one. */
export function itemTitle(item: BarItem): string {
  return item.hint ? `${item.label} (${item.hint})` : item.label;
}

/** The ids on a bar, in order: your layout if you made one, otherwise the default. */
export function barLayout(bar: BarId, saved: string[] | undefined = getState().toolbars[bar]): string[] {
  const known = new Set(BARS[bar].items.map((i) => i.id));
  return (saved ?? BARS[bar].defaults).filter((id, i, all) => known.has(id) && all.indexOf(id) === i);
}

export function useBarLayout(bar: BarId): string[] {
  const saved = useStore((s) => s.toolbars[bar]);
  return useMemo(() => barLayout(bar, saved), [bar, saved]);
}

/** Items that aren't on the bar, in their usual order. */
export function offBar(bar: BarId, layout: string[]): string[] {
  const on = new Set(layout);
  return BARS[bar].items.filter((i) => !on.has(i.id)).map((i) => i.id);
}

/** Shown items that start a new group, so a divider goes before them. */
export function groupStarts(bar: BarId, layout: string[]): Set<string> {
  const out = new Set<string>();
  let prev: string | undefined;
  for (const id of layout) {
    const g = barItem(bar, id)?.group;
    if (prev !== undefined && g !== prev) out.add(id);
    prev = g;
  }
  return out;
}

export function isDefaultLayout(bar: BarId, layout: string[]): boolean {
  const d = BARS[bar].defaults;
  return layout.length === d.length && layout.every((id, i) => id === d[i]);
}

/** Save a bar's layout (null or the default: forget it, so future default changes apply). */
export function setBarLayout(bar: BarId, ids: string[] | null) {
  const next = { ...getState().toolbars };
  if (!ids || isDefaultLayout(bar, ids)) delete next[bar];
  else next[bar] = ids;
  try {
    localStorage.setItem(KEY, JSON.stringify(next));
  } catch {
    /* still applies for this session */
  }
  setState({ toolbars: next });
}

export function restoreDefaultBar(bar: BarId) {
  const before = getState().toolbars[bar];
  if (!before) return;
  setBarLayout(bar, null);
  toast(`${BARS[bar].title} restored to the default`, { action: { label: 'Undo', onClick: () => setBarLayout(bar, before) } });
}

/** Open "Customise toolbar" for a bar. */
export function customiseToolbar(bar: BarId) {
  setState({ dialog: 'toolbar', toolbarTarget: bar });
}

// Crepe draws the notes bar's icons; they are kept here when an editor builds its bar so the
// customise list can show the same icons (Crepe's own SVG strings, not user content).
const noteIcons = new Map<string, string>();
export function rememberNoteIcon(id: string, svg: string) {
  if (svg) noteIcons.set(id, svg);
}
export function noteIcon(id: string): string | undefined {
  return noteIcons.get(id);
}
