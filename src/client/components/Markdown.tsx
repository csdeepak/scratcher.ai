import { memo, useEffect, useRef } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import remarkMath from 'remark-math';
import rehypeKatex from 'rehype-katex';
import { toast } from 'sonner';
import { Crepe } from '@milkdown/crepe';
import type { TopBarFeatureConfig } from '@milkdown/crepe/feature/top-bar';
import { editorViewCtx, remarkStringifyOptionsCtx } from '@milkdown/kit/core';
import { Selection, TextSelection } from '@milkdown/kit/prose/state';
import { insert } from '@milkdown/kit/utils';
import { fixImageAlts, preserveFormatting } from '../../shared/preserveFormatting';
import { attachmentRel } from '../../shared/exporters';
import { encodeTarget, isAttachable, markdownFor, openViewer, resolveSrc, type Uploaded } from '../attachments';
import { getState, navigate, selectCheckpoint } from '../store';
import { manageFormatBar, type BarCommand } from '../formatBar';
import { barItem, rememberNoteIcon } from '../toolbars';

/** Where pasted or dropped files are attached, and how stored paths become URLs. */
export interface AttachTarget {
  roadmapId: string;
  upload: (file: File) => Promise<Uploaded>;
}

/** Flip the first task checkbox at or after `offset` in the Markdown source. */
export function toggleTaskAt(text: string, offset: number): string {
  const m = /\[( |x|X)\]/.exec(text.slice(offset));
  if (!m) return text;
  const i = offset + m.index + 1;
  return text.slice(0, i) + (m[1] === ' ' ? 'x' : ' ') + text.slice(i + 1);
}

/**
 * Follow a link written in a note: attached files open in the viewer, `cp-…` ids open that
 * checkpoint, everything else opens in a new browser tab. Returns true when handled here.
 */
export function followLink(roadmapId: string | undefined, href: string): boolean {
  if (!href) return false;
  const rel = attachmentRel(href);
  if (rel && roadmapId) {
    openViewer(roadmapId, rel);
    return true;
  }
  const cp = href.match(/^#?(cp-[A-Za-z0-9_-]+)$/)?.[1];
  if (cp) {
    const rm = getState().roadmap;
    if (rm?.checkpoints[cp]) selectCheckpoint(cp, { center: true });
    else if (roadmapId) navigate({ page: 'roadmap', id: roadmapId, cp });
    return true;
  }
  return false;
}

// Maths: $…$ inline and $$…$$ blocks, rendered with KaTeX. Mistakes show in red instead of breaking the page.
const REMARK_PLUGINS = [remarkGfm, remarkMath];
const REHYPE_PLUGINS: [typeof rehypeKatex, { throwOnError: boolean; strict: 'ignore' }][] = [[rehypeKatex, { throwOnError: false, strict: 'ignore' }]];

export const MarkdownView = memo(function MarkdownView({ text, onToggleTask, roadmapId }: { text: string; onToggleTask?: (offset: number) => void; roadmapId?: string }) {
  return (
    <div className="prose-wm">
      <ReactMarkdown
        remarkPlugins={REMARK_PLUGINS}
        rehypePlugins={REHYPE_PLUGINS}
        components={{
          a: ({ node: _n, href, ...p }) => (
            <a
              {...p}
              href={href && roadmapId ? resolveSrc(roadmapId, href) : href}
              target="_blank"
              rel="noreferrer noopener"
              onClick={(e) => {
                e.stopPropagation();
                if (href && followLink(roadmapId, href)) e.preventDefault();
              }}
            />
          ),
          img: ({ node: _n, src, alt, ...p }) => {
            const s = typeof src === 'string' ? src : '';
            const rel = attachmentRel(s);
            return (
              <img
                {...p}
                alt={alt ?? ''}
                src={roadmapId ? resolveSrc(roadmapId, s) : s}
                loading="lazy"
                className={rel ? 'cursor-zoom-in' : undefined}
                onClick={(e) => {
                  if (rel && roadmapId) {
                    e.stopPropagation();
                    openViewer(roadmapId, rel, alt || undefined);
                  }
                }}
              />
            );
          },
          li: ({ node, className, children, ...p }) => {
            if (className?.includes('task-list-item') && onToggleTask && node?.position?.start.offset !== undefined) {
              const offset = node.position.start.offset;
              return (
                <li
                  className={className}
                  {...p}
                  onClickCapture={(e) => {
                    if ((e.target as HTMLElement).tagName === 'INPUT') {
                      e.preventDefault();
                      e.stopPropagation();
                      onToggleTask(offset);
                    }
                  }}
                >
                  {children}
                </li>
              );
            }
            return (
              <li className={className} {...p}>
                {children}
              </li>
            );
          },
          input: ({ node: _n, ...p }) => (p.type === 'checkbox' ? <input {...p} disabled={!onToggleTask} readOnly aria-label="Task" /> : <input {...p} />),
        }}
      >
        {text}
      </ReactMarkdown>
    </div>
  );
});

const words = (s: string) => (s.match(/[\p{L}\p{N}]+/gu) ?? []).join(' ');
const WORD_CHAR = /[\p{L}\p{N}]/u;

/**
 * Where a click landed in rendered Markdown, as the number of letters and digits before it.
 * Rendered maths is skipped (the editor keeps LaTeX source there), so the count matches the
 * editor's text and the caret can be put back at the same spot when the editor opens.
 */
export function wordCharsBeforePoint(container: HTMLElement, x: number, y: number): number | null {
  const doc = container.ownerDocument as Document & {
    caretPositionFromPoint?: (x: number, y: number) => { offsetNode: Node; offset: number } | null;
    caretRangeFromPoint?: (x: number, y: number) => Range | null;
  };
  let node: Node | null = null;
  let offset = 0;
  const pos = doc.caretPositionFromPoint?.(x, y);
  if (pos) ({ offsetNode: node, offset } = pos);
  else {
    const r = doc.caretRangeFromPoint?.(x, y);
    if (r) ((node = r.startContainer), (offset = r.startOffset));
  }
  if (!node || !container.contains(node)) return null;
  const range = doc.createRange();
  range.setStart(container, 0);
  range.setEnd(node, offset);
  const walker = doc.createTreeWalker(container, NodeFilter.SHOW_TEXT);
  let count = 0;
  for (let t = walker.nextNode(); t; t = walker.nextNode()) {
    if (t.parentElement?.closest('.katex, .katex-display') || !range.intersectsNode(t)) continue;
    const text = t === range.endContainer ? (t.textContent ?? '').slice(0, range.endOffset) : (t.textContent ?? '');
    for (const ch of text) if (WORD_CHAR.test(ch)) count++;
  }
  return count;
}

/** ProseMirror position after the n-th letter or digit (LaTeX blocks skipped), or null. */
function posAfterWordChars(doc: import('@milkdown/kit/prose/model').Node, n: number): number | null {
  let count = 0;
  let found: number | null = null;
  doc.descendants((node, pos) => {
    if (found !== null) return false;
    if (node.type.name === 'code_block' && String(node.attrs.language ?? '').toLowerCase() === 'latex') return false;
    if (!node.isText) return true;
    if (n === 0) {
      found = pos;
      return false;
    }
    const text = node.text ?? '';
    for (let i = 0; i < text.length; i++) {
      if (WORD_CHAR.test(text[i]!) && ++count === n) {
        found = pos + i + 1;
        return false;
      }
    }
    return false;
  });
  return found;
}


/** Files from a paste or drop that can be attached. */
function attachableFiles(dt: DataTransfer | null): File[] {
  if (!dt) return [];
  return [...dt.files].filter(isAttachable);
}

async function uploadAll(target: AttachTarget, files: File[]): Promise<string[]> {
  const out: string[] = [];
  for (const f of files) {
    try {
      out.push(markdownFor(await target.upload(f)));
    } catch (e) {
      toast.error((e as Error).message);
    }
  }
  if (out.length) toast.success(out.length === 1 ? 'Attached and inserted.' : `Attached and inserted ${out.length} files.`);
  return out;
}

// ------------------------------------------------------------------ formatting bar
// Crepe's fixed top bar, built once with every item in a fixed order and in one group (so Crepe
// draws no dividers of its own). formatBar.ts then shows the ones on your bar, in your order
// (see toolbars.ts). The rarer inserts are in an "Insert" list, Crepe's own dropdown item type;
// "/" in the text has them all too.

/** Our item id → Crepe's key ('' = the Insert list, which is ours). */
const CREPE_KEYS: [id: string, key: string][] = [
  ['heading', 'heading-selector'],
  ['bold', 'bold'],
  ['italic', 'italic'],
  ['strikethrough', 'strikethrough'],
  ['code', 'code'],
  ['link', 'link'],
  ['bullet-list', 'bullet-list'],
  ['ordered-list', 'ordered-list'],
  ['task-list', 'task-list'],
  ['insert', ''],
  ['image', 'image'],
  ['table', 'table'],
  ['code-block', 'code-block'],
  ['math', 'math'],
  ['quote', 'quote'],
  ['hr', 'hr'],
];
const INSERT_IDS = ['image', 'table', 'code-block', 'math', 'quote', 'hr'];

/** Ids of the items in the order Crepe renders them, and what each one does (for the ⋯ menu). */
let BUILT: string[] = [];
const COMMANDS = new Map<string, BarCommand>();

type TopBarBuilder = Parameters<NonNullable<TopBarFeatureConfig['buildTopBar']>>[0];

function buildFormatBar(b: TopBarBuilder) {
  const items = new Map(b.build().flatMap((g) => g.items.map((i) => [i.key, i] as const)));
  b.clear();
  const group = b.addGroup('bar', 'Formatting');
  const built: string[] = [];
  const insertOptions = INSERT_IDS.flatMap((id) => {
    const run = items.get(id)?.onRun;
    return run ? [{ label: barItem('notes', id)?.label ?? id, onSelect: run }] : [];
  });
  for (const [id, key] of CREPE_KEYS) {
    if (!key) {
      if (!insertOptions.length) continue;
      group.addItem('insert', {
        icon: '',
        active: () => false,
        selector: { activeLabel: () => 'Insert', chevronIcon: items.get('heading-selector')?.selector?.chevronIcon, options: insertOptions },
      });
      COMMANDS.set(id, { options: insertOptions.map((o) => ({ label: o.label, run: o.onSelect })) });
      built.push(id);
      continue;
    }
    const it = items.get(key);
    // Crepe skips items with neither an action nor a list, so they must not be counted.
    if (!it || (!it.onRun && !it.selector)) continue;
    const { key: _key, ...rest } = it;
    group.addItem(key, rest);
    built.push(id);
    rememberNoteIcon(id, it.icon);
    COMMANDS.set(id, it.selector ? { options: it.selector.options.map((o) => ({ label: o.label, run: o.onSelect })) } : { run: it.onRun });
  }
  BUILT = built;
}


/**
 * WYSIWYG Markdown editor (Milkdown Crepe). The value is read once at mount; parent re-keys
 * to load other content. Calls `onLossy` if the editor can't represent the text faithfully
 * (e.g. raw HTML), so the parent can switch to the raw Markdown editor instead.
 */
export function RichEditor({
  value,
  onChange,
  placeholder,
  autoFocus,
  onLossy,
  attach,
  caretAt,
}: {
  value: string;
  onChange: (md: string) => void;
  placeholder?: string;
  autoFocus?: boolean;
  onLossy?: () => void;
  attach?: AttachTarget;
  /** Put the caret after this many letters/digits (where the reading view was clicked); default: the end. */
  caretAt?: number | null;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const onChangeRef = useRef(onChange);
  onChangeRef.current = onChange;
  const lossyRef = useRef(onLossy);
  lossyRef.current = onLossy;
  const attachRef = useRef(attach);
  attachRef.current = attach;

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    let interacted = false;
    const mark = () => {
      interacted = true;
    };
    // Any real edit (typing, IME, dictation, paste, clicks on checkboxes) counts; the editor's own
    // normalisation on load does not, so opening a section never rewrites the file. The formatting
    // bar and its ⋯ menu act on pointer-down and cancel it, so no mousedown follows: count that too.
    const events = ['keydown', 'beforeinput', 'input', 'paste', 'drop', 'mousedown', 'pointerdown', 'cut'];
    for (const ev of events) el.addEventListener(ev, mark, true);

    const upload = async (file: File) => {
      const t = attachRef.current;
      if (!t) throw new Error('Open a checkpoint to attach files.');
      return encodeTarget((await t.upload(file)).markdownPath);
    };
    const crepe = new Crepe({
      root: el,
      defaultValue: value,
      // Crepe's built-in fixed formatting bar (like Google Docs) instead of the floating selection
      // toolbar, so there is one set of formatting buttons, always in the same place.
      features: {
        [Crepe.Feature.AI]: false,
        [Crepe.Feature.TopBar]: true,
        [Crepe.Feature.Toolbar]: false,
      },
      featureConfigs: {
        // Sections live under "# Section" headings in the file, so text uses ## and smaller.
        [Crepe.Feature.TopBar]: {
          headingOptions: [
            { label: 'Normal text', level: null },
            { label: 'Heading', level: 2 },
            { label: 'Subheading', level: 3 },
            { label: 'Small heading', level: 4 },
          ],
          buildTopBar: buildFormatBar,
        },
        [Crepe.Feature.Placeholder]: { text: placeholder ?? 'Write here… type / for blocks', mode: 'doc' },
        [Crepe.Feature.Latex]: { katexOptions: { throwOnError: false, strict: 'ignore' } },
        // Images: uploads become attachments; stored paths like ../attachments/… are shown via the server.
        [Crepe.Feature.ImageBlock]: {
          onUpload: upload,
          inlineOnUpload: upload,
          blockOnUpload: upload,
          proxyDomURL: (url: string) => (attachRef.current ? resolveSrc(attachRef.current.roadmapId, url) : url),
        },
      },
    });
    // Write edited blocks in the most common Markdown style ("-" bullets and rules).
    crepe.editor.config((ctx) => ctx.update(remarkStringifyOptionsCtx, (prev) => ({ ...prev, bullet: '-' as const, rule: '-' as const })));
    const original = value;
    crepe.on((l) =>
      l.markdownUpdated((_ctx, md) => {
        if (!interacted) return;
        // Crepe writes empty paragraphs as "<br />"; keep the files clean Markdown. Blocks the user
        // didn't touch keep their original text, so an agent's formatting isn't rewritten.
        onChangeRef.current(preserveFormatting(original, fixImageAlts(original, md.replace(/^<br \/>\n?/gm, ''))));
      }),
    );

    // Pasted or dropped images and PDFs: attach them, then insert an image or a link at the cursor.
    const onFiles = (e: ClipboardEvent | DragEvent) => {
      const t = attachRef.current;
      const files = attachableFiles('clipboardData' in e ? e.clipboardData : e.dataTransfer);
      if (!t || !files.length) return;
      e.preventDefault();
      e.stopPropagation();
      void uploadAll(t, files).then((mds) => {
        if (mds.length) crepe.editor.action(insert(mds.join('\n\n')));
      });
    };
    el.addEventListener('paste', onFiles as EventListener, true);
    el.addEventListener('drop', onFiles as EventListener, true);

    // Ctrl/Cmd+click follows links while editing.
    const onClick = (e: MouseEvent) => {
      const a = (e.target as HTMLElement).closest('a');
      if (!a || !(e.ctrlKey || e.metaKey)) return;
      const href = a.getAttribute('href') ?? '';
      e.preventDefault();
      if (!followLink(attachRef.current?.roadmapId, href)) window.open(href, '_blank', 'noopener');
    };
    el.addEventListener('click', onClick, true);

    // Your arrangement of the formatting bar, on one row, with a ⋯ menu (formatBar.ts).
    let unbar = () => {};

    let alive = true;
    void crepe.create().then(() => {
      if (!alive) return;
      const bar = el.querySelector<HTMLElement>('.milkdown-top-bar');
      // Commands from the ⋯ menu act on this editor and leave the caret in it, so typing and Ctrl+Z
      // carry on there rather than going to the map.
      if (bar)
        unbar = manageFormatBar(bar, BUILT, COMMANDS, (fn) =>
          crepe.editor.action((ctx) => {
            fn(ctx);
            ctx.get(editorViewCtx).focus();
          }),
        );
      try {
        if (value.trim() && words(crepe.getMarkdown()) !== words(value)) lossyRef.current?.();
      } catch {
        lossyRef.current?.();
      }
      if (autoFocus) {
        // Put the caret at the end so clicking a section lets you keep writing. Code blocks and
        // tables finish mounting a moment later and can reset the selection, so place it again
        // then, unless the user has already started typing somewhere.
        const caretToEnd = () => {
          if (!alive) return;
          try {
            crepe.editor.action((ctx) => {
              const view = ctx.get(editorViewCtx);
              const at = caretAt != null ? posAfterWordChars(view.state.doc, caretAt) : null;
              const sel = at !== null ? TextSelection.near(view.state.doc.resolve(at)) : Selection.atEnd(view.state.doc);
              view.dispatch(view.state.tr.setSelection(sel).scrollIntoView());
              view.focus();
            });
          } catch {
            el.querySelector<HTMLElement>('.ProseMirror')?.focus();
          }
        };
        caretToEnd();
        setTimeout(() => {
          if (!interacted) caretToEnd();
        }, 120);
      }
    });
    return () => {
      alive = false;
      unbar();
      for (const ev of events) el.removeEventListener(ev, mark, true);
      el.removeEventListener('paste', onFiles as EventListener, true);
      el.removeEventListener('drop', onFiles as EventListener, true);
      el.removeEventListener('click', onClick, true);
      void crepe.destroy();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return <div ref={ref} className="wm-editor -ml-1" />;
}

export function SourceEditor({
  value,
  onChange,
  autoFocus,
  placeholder,
  attach,
}: {
  value: string;
  onChange: (v: string) => void;
  autoFocus?: boolean;
  placeholder?: string;
  attach?: AttachTarget;
}) {
  const ref = useRef<HTMLTextAreaElement>(null);
  useEffect(() => {
    const t = ref.current;
    if (!t) return;
    t.style.height = 'auto';
    t.style.height = `${Math.max(96, t.scrollHeight + 2)}px`;
  }, [value]);

  const insertAtCursor = (text: string) => {
    const t = ref.current;
    if (!t) return onChange(value ? `${value}\n\n${text}` : text);
    const s = t.selectionStart;
    const before = t.value.slice(0, s);
    const pad = before && !before.endsWith('\n') ? '\n\n' : '';
    onChange(before + pad + text + t.value.slice(t.selectionEnd));
  };
  const onFiles = (e: React.ClipboardEvent | React.DragEvent, dt: DataTransfer) => {
    const files = attachableFiles(dt);
    if (!attach || !files.length) return;
    e.preventDefault();
    void uploadAll(attach, files).then((mds) => mds.length && insertAtCursor(mds.join('\n\n')));
  };

  return (
    <textarea
      ref={ref}
      autoFocus={autoFocus}
      value={value}
      placeholder={placeholder}
      spellCheck
      onChange={(e) => onChange(e.target.value)}
      onPaste={(e) => onFiles(e, e.clipboardData)}
      onDrop={(e) => onFiles(e, e.dataTransfer)}
      onKeyDown={(e) => {
        if (e.key === 'Tab' && !e.shiftKey) {
          e.preventDefault();
          const t = e.currentTarget;
          const s = t.selectionStart;
          const v = t.value.slice(0, s) + '  ' + t.value.slice(t.selectionEnd);
          onChange(v);
          requestAnimationFrame(() => t.setSelectionRange(s + 2, s + 2));
        }
      }}
      className="block w-full resize-none rounded-lg border border-line bg-surface-2 px-3 py-2 font-mono text-[12.5px] leading-[1.6] text-fg outline-none focus:border-accent"
    />
  );
}
