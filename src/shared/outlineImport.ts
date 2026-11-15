// Turn an outline from elsewhere into a roadmap bundle:
//  - Markdown: headings (and lists directly under them) become checkpoints; text under a heading
//    becomes its Content. Works for syllabi and plans pasted from a chat, Notion, Obsidian, etc.
//  - OPML (mind-map and outliner exports) is parsed in the browser and passed to fromOutline().

import { fromMarkdown } from 'mdast-util-from-markdown';
import { gfmFromMarkdown } from 'mdast-util-gfm';
import { gfm } from 'micromark-extension-gfm';
import { toString } from 'mdast-util-to-string';
import type { Bundle } from './bundle';
import type { Checkpoint, ProfileKey } from './model';
import { newId } from './ids';

export interface OutlineItem {
  title: string;
  content?: string;
  done?: boolean;
  children: OutlineItem[];
}

const MAX_ITEMS = 2000;
const clip = (s: string) => {
  const t = s.replace(/\s+/g, ' ').trim();
  return t.length > 140 ? t.slice(0, 137).trimEnd() + '…' : t;
};

type MdNode = ReturnType<typeof fromMarkdown>['children'][number];

export function outlineFromMarkdown(markdown: string): { title?: string; overview: string; items: OutlineItem[] } {
  const text = markdown.replace(/\r\n?/g, '\n');
  const tree = fromMarkdown(text, { extensions: [gfm()], mdastExtensions: [gfmFromMarkdown()] });
  const slice = (nodes: MdNode[]) =>
    nodes
      .map((n) => text.slice(n.position?.start.offset ?? 0, n.position?.end.offset ?? 0))
      .join('\n\n')
      .trim();
  let nodes = [...tree.children];
  let title: string | undefined;
  const h1s = nodes.filter((n) => n.type === 'heading' && n.depth === 1);
  if (nodes[0]?.type === 'heading' && nodes[0].depth === 1 && h1s.length === 1) {
    title = clip(toString(nodes[0]));
    nodes = nodes.slice(1);
  }

  const listItems = (list: MdNode): OutlineItem[] => {
    if (list.type !== 'list') return [];
    return list.children.map((li) => {
      const [first, ...rest] = li.children;
      const nested = rest.filter((n) => n.type === 'list');
      const other = rest.filter((n) => n.type !== 'list');
      return {
        title: clip(first ? toString(first) : 'Untitled'),
        content: other.length ? slice(other) : undefined,
        done: li.checked === true,
        children: nested.flatMap(listItems),
      };
    });
  };

  const firstHeading = nodes.findIndex((n) => n.type === 'heading');
  if (firstHeading === -1) {
    // No headings: top-level lists are the main checkpoints; anything else is the overview.
    const lists = nodes.filter((n) => n.type === 'list');
    return { title, overview: slice(nodes.filter((n) => n.type !== 'list')), items: lists.flatMap(listItems) };
  }

  const overview = slice(nodes.slice(0, firstHeading));
  const rest = nodes.slice(firstHeading);
  const minDepth = Math.min(...rest.filter((n) => n.type === 'heading').map((n) => (n.type === 'heading' ? n.depth : 6)));
  const roots: OutlineItem[] = [];
  const stack: { depth: number; item: OutlineItem }[] = [];
  let i = 0;
  while (i < rest.length) {
    const h = rest[i]!;
    if (h.type !== 'heading') {
      i++;
      continue;
    }
    const body: MdNode[] = [];
    i++;
    while (i < rest.length && rest[i]!.type !== 'heading') body.push(rest[i++]!);
    const item: OutlineItem = { title: clip(toString(h)) || 'Untitled', children: [] };
    // A heading followed only by lists: the list items are its sub-checkpoints (typical syllabus).
    if (body.length && body.every((n) => n.type === 'list')) item.children.push(...body.flatMap(listItems));
    else if (body.length) item.content = slice(body);
    const depth = h.depth - minDepth;
    while (stack.length && stack[stack.length - 1]!.depth >= depth) stack.pop();
    if (stack.length) stack[stack.length - 1]!.item.children.push(item);
    else roots.push(item);
    stack.push({ depth, item });
  }
  return { title, overview, items: roots };
}

/** Build an importable bundle from outline items. */
export function fromOutline(input: { title: string; overview?: string; profile: ProfileKey; items: OutlineItem[] }): Bundle {
  const checkpoints: Checkpoint[] = [];
  const walk = (items: OutlineItem[], parent: string | null) => {
    items.forEach((it, i) => {
      if (checkpoints.length >= MAX_ITEMS) return;
      const id = newId('cp');
      checkpoints.push({
        id,
        title: it.title || 'Untitled',
        parent,
        order: i + 1,
        summary: '',
        status: it.done ? 'complete' : 'not-started',
        understanding: input.profile === 'learning' ? 'not-yet' : null,
        approved: false,
        optional: false,
        archived: false,
        agentAccess: null,
        prerequisites: [],
        completion: '',
        resources: [],
        sections: it.content ? { content: it.content } : {},
        rev: 0,
      });
      walk(it.children, id);
    });
  };
  walk(input.items, null);
  return {
    format: 'waymark-bundle',
    schemaVersion: 1,
    exportedAt: new Date().toISOString(),
    generator: 'waymark-outline-import',
    roadmap: {
      id: newId('rm'),
      title: input.title.trim() || 'Imported roadmap',
      profile: input.profile,
      description: '',
      agentAccess: 'review',
      created: new Date().toISOString(),
      overview: input.overview ?? '',
    },
    checkpoints,
    layout: { schema: 'waymark-layout/1', offsets: {} },
  };
}
