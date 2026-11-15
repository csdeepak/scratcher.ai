// Keep the original Markdown of blocks the user didn't change.
//
// A visual editor re-serialises the whole section on every edit, which would rewrite an agent's
// formatting ("-" bullets → "*", line wrapping, escapes) even in paragraphs nobody touched and make
// Review diffs, history and git noisy. After an edit we compare top-level blocks by meaning (their
// Markdown syntax tree, ignoring style-only details) and put back the original text of every block
// that is unchanged. Only blocks the user actually edited take the editor's formatting.

import { fromMarkdown } from 'mdast-util-from-markdown';
import { gfmFromMarkdown } from 'mdast-util-gfm';
import { gfm } from 'micromark-extension-gfm';
import { math } from 'micromark-extension-math';
import { mathFromMarkdown } from 'mdast-util-math';

interface Block {
  text: string;
  sig: string;
}

const STYLE_ONLY = new Set(['position', 'spread', 'data']);
const VERBATIM = new Set(['code', 'inlineCode', 'html', 'math', 'inlineMath']);

/** Meaning of a node: its syntax tree without positions or presentation details. */
function signature(node: unknown): string {
  return JSON.stringify(node, function (this: Record<string, unknown>, key, value) {
    if (STYLE_ONLY.has(key)) return undefined;
    // Soft line breaks and runs of spaces don't change meaning outside code.
    if (key === 'value' && typeof value === 'string' && !VERBATIM.has(String(this.type))) return value.replace(/\s+/g, ' ').trim();
    return value;
  });
}

/** "$$E=mc^2$$" on one line (a paragraph holding only a formula) means the same as a $$ block. */
function asMathBlock(node: unknown): unknown {
  const n = node as { type?: string; value?: string; children?: { type?: string; value?: string }[] };
  if (n.type === 'paragraph' && n.children?.length === 1 && n.children[0]!.type === 'inlineMath') return { type: 'math', value: n.children[0]!.value?.trim() };
  if (n.type === 'math') return { type: 'math', value: n.value?.trim() };
  return node;
}

function blocks(md: string): Block[] | null {
  try {
    const tree = fromMarkdown(md, { extensions: [gfm(), math()], mdastExtensions: [gfmFromMarkdown(), mathFromMarkdown()] });
    return tree.children.map((node) => {
      const start = node.position?.start.offset ?? 0;
      const end = node.position?.end.offset ?? start;
      return { text: md.slice(start, end), sig: signature(asMathBlock(node)) };
    });
  } catch {
    return null;
  }
}

/**
 * Return `edited`, but with every top-level block that means the same as a block in `original`
 * replaced by the original's exact text. Blocks are matched in document order where possible.
 */
export function preserveFormatting(original: string, edited: string): string {
  if (!original.trim() || !edited.trim() || original === edited) return edited;
  const a = blocks(original);
  const b = blocks(edited);
  if (!a || !b || !b.length) return edited;
  const used = new Set<number>();
  let cursor = 0;
  const out: string[] = [];
  for (const nb of b) {
    let idx = -1;
    for (let i = cursor; i < a.length && idx === -1; i++) if (!used.has(i) && a[i]!.sig === nb.sig) idx = i;
    for (let i = 0; i < cursor && idx === -1; i++) if (!used.has(i) && a[i]!.sig === nb.sig) idx = i;
    if (idx >= 0) {
      used.add(idx);
      cursor = idx + 1;
      out.push(a[idx]!.text);
    } else out.push(nb.text);
  }
  return out.join('\n\n');
}

/**
 * Crepe's image block writes its resize ratio where the description belongs ("![1.00](…)").
 * Put back the description the file had for that image, or the file name, so Markdown stays readable.
 */
export function fixImageAlts(original: string, md: string): string {
  const altFor = new Map<string, string>();
  for (const m of original.matchAll(/!\[([^\]]*)\]\(\s*<?([^)\s>]+)>?/g)) altFor.set(m[2]!, m[1]!);
  return md.replace(/!\[(\d+(?:\.\d+)?)\]\(\s*(<?[^)\s>]+>?)/g, (_all, _ratio: string, src: string) => {
    const clean = src.replace(/^<|>$/g, '');
    let alt = altFor.get(clean);
    if (alt === undefined) {
      try {
        alt = decodeURIComponent(clean.split('/').pop() ?? '').replace(/\.[^.]+$/, '');
      } catch {
        alt = '';
      }
    }
    return `![${alt}](${src}`;
  });
}
