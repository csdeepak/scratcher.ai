import { memo, useEffect, useRef } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { Crepe } from '@milkdown/crepe';
import { editorViewCtx, remarkStringifyOptionsCtx } from '@milkdown/kit/core';
import { Selection } from '@milkdown/kit/prose/state';
import { preserveFormatting } from '../../shared/preserveFormatting';

/** Flip the first task checkbox at or after `offset` in the Markdown source. */
export function toggleTaskAt(text: string, offset: number): string {
  const m = /\[( |x|X)\]/.exec(text.slice(offset));
  if (!m) return text;
  const i = offset + m.index + 1;
  return text.slice(0, i) + (m[1] === ' ' ? 'x' : ' ') + text.slice(i + 1);
}

export const MarkdownView = memo(function MarkdownView({ text, onToggleTask }: { text: string; onToggleTask?: (offset: number) => void }) {
  return (
    <div className="prose-wm">
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        components={{
          a: ({ node: _n, ...p }) => <a {...p} target="_blank" rel="noreferrer noopener" onClick={(e) => e.stopPropagation()} />,
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
}: {
  value: string;
  onChange: (md: string) => void;
  placeholder?: string;
  autoFocus?: boolean;
  onLossy?: () => void;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const onChangeRef = useRef(onChange);
  onChangeRef.current = onChange;
  const lossyRef = useRef(onLossy);
  lossyRef.current = onLossy;

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    let interacted = false;
    const mark = () => {
      interacted = true;
    };
    // Any real edit (typing, IME, dictation, paste, clicks on checkboxes) counts; the editor's own
    // normalisation on load does not, so opening a section never rewrites the file.
    const events = ['keydown', 'beforeinput', 'input', 'paste', 'drop', 'mousedown', 'cut'];
    for (const ev of events) el.addEventListener(ev, mark, true);
    const crepe = new Crepe({
      root: el,
      defaultValue: value,
      features: {
        [Crepe.Feature.AI]: false,
        [Crepe.Feature.TopBar]: false,
        [Crepe.Feature.ImageBlock]: false,
        [Crepe.Feature.Latex]: false,
      },
      featureConfigs: {
        [Crepe.Feature.Placeholder]: { text: placeholder ?? 'Write here… type / for blocks', mode: 'doc' },
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
        onChangeRef.current(preserveFormatting(original, md.replace(/^<br \/>\n?/gm, '')));
      }),
    );
    let alive = true;
    void crepe.create().then(() => {
      if (!alive) return;
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
              view.dispatch(view.state.tr.setSelection(Selection.atEnd(view.state.doc)).scrollIntoView());
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
      for (const ev of events) el.removeEventListener(ev, mark, true);
      void crepe.destroy();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return <div ref={ref} className="wm-editor -ml-1" />;
}

export function SourceEditor({ value, onChange, autoFocus, placeholder }: { value: string; onChange: (v: string) => void; autoFocus?: boolean; placeholder?: string }) {
  const ref = useRef<HTMLTextAreaElement>(null);
  useEffect(() => {
    const t = ref.current;
    if (!t) return;
    t.style.height = 'auto';
    t.style.height = `${Math.max(96, t.scrollHeight + 2)}px`;
  }, [value]);
  return (
    <textarea
      ref={ref}
      autoFocus={autoFocus}
      value={value}
      placeholder={placeholder}
      spellCheck
      onChange={(e) => onChange(e.target.value)}
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
