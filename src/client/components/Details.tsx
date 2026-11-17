import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { Command } from 'cmdk';
import { toast } from 'sonner';
import {
  Archive,
  ArrowRight,
  BookOpen,
  Bot,
  Check,
  ChevronRight,
  ClockFading,
  Code,
  Copy,
  Ellipsis,
  ExternalLink,
  FileText,
  Focus,
  GraduationCap,
  Info,
  Link2,
  Lock,
  Maximize2,
  Minimize2,
  Pencil,
  Play,
  Plus,
  ShieldCheck,
  Trash,
  User,
  Video,
  Wrench,
  X,
} from 'lucide-react';
import type { Attachment, Checkpoint, FieldPath, Resource, ResourceKind, Roadmap, SectionKey } from '../../shared/model';
import { fileUrl, formatSize, isAttachable, markdownFor, openViewer, uploadAttachment } from '../attachments';
import { SECTION_DEFS, UNDERSTANDING_LEVELS, getProfile, statusDef, type Profile } from '../../shared/profiles';
import { ancestors, childrenIndex, compareSiblings, effectiveAccess, type Progress } from '../../shared/tree';
import { requiresTransitively } from '../../shared/ops';
import { parseCheckpoint } from '../../shared/checkpointFile';
import { diffCheckpoints, fieldLabel } from '../../shared/fields';
import type { HistoryEntry } from '../../server/history';
import { clearConflict, getState, selectCheckpoint, setFocus, setState, submit, useStore } from '../store';
import { addCheckpoint, deleteCheckpoint, link, needsDeleteConfirm, setStatus, subtreeCount, unlink, updateFields } from '../actions';
import { http } from '../api';
import { MarkdownView, RichEditor, SourceEditor, toggleTaskAt, wordCharsBeforePoint, type AttachTarget } from './Markdown';
import { Button, Chip, IconButton, Menu, Modal, Pop, ProgressBar, StatusIcon, Tip, UnderstandingIcon, cx, relTime } from './ui';

export function DetailsPanel({ rm, progress }: { rm: Roadmap; progress: Map<string | null, Progress> }) {
  const selectedId = useStore((s) => s.selectedId);
  const cp = selectedId ? rm.checkpoints[selectedId] : null;
  return (
    <div className="wm-scroll h-full" id="details-panel">
      {cp ? <CheckpointDetails key={cp.id} rm={rm} cp={cp} progress={progress} /> : <RoadmapOverview rm={rm} progress={progress} />}
    </div>
  );
}

// ------------------------------------------------------------------ checkpoint

function CheckpointDetails({ rm, cp, progress }: { rm: Roadmap; cp: Checkpoint; progress: Map<string | null, Progress> }) {
  const profile = getProfile(rm.meta.profile);
  const pageMode = useStore((s) => s.pageMode);
  const path = useMemo(() => ancestors(rm.checkpoints, cp.id), [rm.checkpoints, cp.id]);
  const access = effectiveAccess(rm.checkpoints, rm.meta, cp.id);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [dragging, setDragging] = useState(false);
  const p = progress.get(cp.id);
  const attach = useMemo<AttachTarget>(() => ({ roadmapId: rm.meta.id, upload: (f: File) => uploadAttachment(rm.meta.id, cp.id, f) }), [rm.meta.id, cp.id]);

  // Paste a screenshot or file anywhere on the page (outside an editor) to attach it.
  useEffect(() => {
    const onPaste = (e: ClipboardEvent) => {
      if (document.querySelector('[role="dialog"]')) return;
      const t = e.target as HTMLElement | null;
      if (t?.closest('.milkdown, textarea, input, [contenteditable="true"]')) return;
      const files = [...(e.clipboardData?.files ?? [])].filter(isAttachable);
      if (!files.length) return;
      e.preventDefault();
      void attachFiles(attach, files);
    };
    window.addEventListener('paste', onPaste);
    return () => window.removeEventListener('paste', onPaste);
  }, [attach]);

  return (
    <article
      className={cx('relative mx-auto px-5 pb-16 pt-4', pageMode ? 'max-w-3xl' : 'max-w-none')}
      aria-label={`Checkpoint ${cp.title}`}
      onDragOver={(e) => {
        if (e.dataTransfer.types.includes('Files')) {
          e.preventDefault();
          setDragging(true);
        }
      }}
      onDragLeave={(e) => {
        if (!e.currentTarget.contains(e.relatedTarget as Node)) setDragging(false);
      }}
      onDrop={(e) => {
        setDragging(false);
        const files = [...e.dataTransfer.files].filter(isAttachable);
        if (!files.length) return;
        e.preventDefault();
        void attachFiles(attach, files);
      }}
    >
      {dragging && (
        <div className="pointer-events-none absolute inset-2 z-20 flex items-center justify-center rounded-xl border-2 border-dashed border-accent bg-accent-soft/80 text-[14px] font-semibold text-accent">
          Drop images or PDFs to attach them to “{cp.title}”
        </div>
      )}
      <div className="mb-2 flex items-center gap-1">
        <nav aria-label="Breadcrumb" className="flex min-w-0 flex-1 flex-wrap items-center gap-0.5 text-[12px] text-faint">
          <button className="min-h-6 truncate rounded px-1 hover:bg-surface-2 hover:text-fg" onClick={() => selectCheckpoint(null)}>
            {rm.meta.title}
          </button>
          {path.map((a) => (
            <span key={a.id} className="flex min-w-0 items-center gap-0.5">
              <ChevronRight size={12} className="flex-none" />
              <button className="min-h-6 max-w-40 truncate rounded px-1 hover:bg-surface-2 hover:text-fg" onClick={() => selectCheckpoint(a.id, { center: true })}>
                {a.title}
              </button>
            </span>
          ))}
        </nav>
        <IconButton size="sm" label={pageMode ? 'Back to the map' : 'Open as a full page'} onClick={() => setState({ pageMode: !pageMode })}>
          {pageMode ? <Minimize2 size={15} /> : <Maximize2 size={15} />}
        </IconButton>
        <MoreMenu rm={rm} cp={cp} access={access} onDelete={() => (needsDeleteConfirm(cp) ? setConfirmDelete(true) : void deleteCheckpoint(cp.id))} />
        <IconButton size="sm" label="Close (Esc)" onClick={() => selectCheckpoint(null)}>
          <X size={15} />
        </IconButton>
      </div>

      <h2 className="sr-only">{cp.title}</h2>
      <TitleField cp={cp} />

      <div className="mt-2 flex flex-wrap items-center gap-1.5">
        <StatusPicker cp={cp} profile={profile} />
        {profile.understanding && <UnderstandingPicker cp={cp} />}
        <ApprovalToggle cp={cp} />
        {cp.optional && <Chip>Optional</Chip>}
        {access !== 'review' && (
          <Tip label={access === 'direct' ? 'Agents may edit this branch directly, without review.' : 'Locked: agent edits here are always held for you.'}>
            <span>
              <Chip tone={access === 'locked' ? 'warn' : 'accent'}>
                {access === 'locked' ? <Lock size={11} /> : <Bot size={11} />} {access === 'locked' ? 'Locked' : 'Direct agent edits'}
              </Chip>
            </span>
          </Tip>
        )}
      </div>

      <SummaryField cp={cp} />

      {p && (p.total > 0 || p.optionalTotal > 0) && <ChildrenBlock rm={rm} cp={cp} profile={profile} progress={p} />}
      {(!p || (p.total === 0 && p.optionalTotal === 0)) && (
        <button className="mt-3 flex min-h-6 items-center gap-1.5 rounded-lg px-1 text-[12.5px] text-muted hover:text-accent" onClick={() => addCheckpoint(cp.id)}>
          <Plus size={13} /> Add sub-checkpoint
        </button>
      )}

      <div className="mt-5 grid gap-1">
        {profile.sections.map((k) => (
          <SectionBlock key={`${cp.id}-${k}`} cp={cp} sectionKey={k} attach={attach} />
        ))}
        {(Object.keys(cp.sections) as SectionKey[])
          .filter((k) => !profile.sections.includes(k))
          .map((k) => (
            <SectionBlock key={`${cp.id}-${k}`} cp={cp} sectionKey={k} extra attach={attach} />
          ))}
      </div>

      <ResourcesBlock cp={cp} />
      <AttachmentsBlock rm={rm} cp={cp} attach={attach} />
      <CompletionField cp={cp} />
      <PrereqBlock rm={rm} cp={cp} profile={profile} />
      <HistoryBlock rm={rm} cp={cp} />

      <footer className="mt-8 flex flex-wrap items-center gap-x-3 gap-y-1 border-t border-line pt-3 text-[11.5px] text-faint">
        <span>
          id <code className="font-mono">{cp.id}</code>
        </span>
        {rm.files[cp.id] && (
          <button className="font-mono hover:text-fg" title="Copy file path" onClick={() => copy(`roadmaps/${rm.slug}/${rm.files[cp.id]}`, 'File path copied')}>
            {rm.files[cp.id]}
          </button>
        )}
        <span>rev {cp.rev}</span>
        {cp.updated && <span>edited {relTime(cp.updated)}</span>}
      </footer>

      <Modal
        open={confirmDelete}
        onOpenChange={setConfirmDelete}
        title={`Delete “${cp.title}”?`}
        description={subtreeCount(cp.id) ? `Its ${subtreeCount(cp.id)} sub-checkpoint(s) go with it.` : 'Its notes and progress go with it.'}
        footer={
          <>
            <Button variant="ghost" onClick={() => setConfirmDelete(false)}>
              Cancel
            </Button>
            <Button
              variant="secondary"
              onClick={() => {
                setConfirmDelete(false);
                void updateFields(cp.id, { archived: true }, 'archive');
                toast('Archived. Find it in Roadmap settings → Archived.');
              }}
            >
              <Archive size={14} /> Archive instead
            </Button>
            <Button
              variant="danger"
              onClick={() => {
                setConfirmDelete(false);
                void deleteCheckpoint(cp.id);
              }}
            >
              <Trash size={14} /> Delete
            </Button>
          </>
        }
      >
        <p className="text-[13px] text-muted">Deleted checkpoints go to Trash, and you can restore them from there or with Undo (Ctrl+Z). Archiving hides it from the map but keeps it in place.</p>
      </Modal>
    </article>
  );
}

function copy(text: string, msg = 'Copied') {
  void navigator.clipboard.writeText(text).then(
    () => toast.success(msg),
    () => toast.error('Copy failed. Your browser blocked clipboard access.'),
  );
}

function MoreMenu({ rm, cp, access, onDelete }: { rm: Roadmap; cp: Checkpoint; access: string; onDelete: () => void }) {
  return (
    <Menu.Root>
      <Menu.Trigger asChild>
        <button aria-label="More actions" className="inline-flex size-7 items-center justify-center rounded-lg text-muted hover:bg-surface-2 hover:text-fg">
          <Ellipsis size={16} />
        </button>
      </Menu.Trigger>
      <Menu.Content>
        <Menu.Item onSelect={() => setFocus(cp.id)} hint="F">
          <Focus size={14} /> Focus on this branch
        </Menu.Item>
        <Menu.Item onSelect={() => addCheckpoint(cp.id)} hint="A">
          <Plus size={14} /> Add sub-checkpoint
        </Menu.Item>
        <Menu.Item onSelect={() => setState({ dialog: 'agent' })}>
          <Bot size={14} /> Work on this with an agent…
        </Menu.Item>
        <Menu.Separator />
        <Menu.Item onSelect={() => void updateFields(cp.id, { optional: !cp.optional }, cp.optional ? 'make required' : 'make optional')}>
          <Check size={14} className={cp.optional ? '' : 'opacity-0'} /> Optional path
        </Menu.Item>
        <Menu.Sub>
          <Menu.SubTrigger>
            <Bot size={14} /> Agent access
          </Menu.SubTrigger>
          <Menu.SubContent>
            <Menu.RadioGroup value={cp.agentAccess ?? 'inherit'} onValueChange={(v) => void updateFields(cp.id, { agentAccess: v === 'inherit' ? null : (v as 'review' | 'direct' | 'locked') }, 'agent access')}>
              <Menu.RadioItem value="inherit">Same as parent ({cp.agentAccess ? '…' : access})</Menu.RadioItem>
              <Menu.RadioItem value="review">Review: edits apply, you review them</Menu.RadioItem>
              <Menu.RadioItem value="direct">Direct: no review needed here</Menu.RadioItem>
              <Menu.RadioItem value="locked">Locked: hold all agent edits</Menu.RadioItem>
            </Menu.RadioGroup>
          </Menu.SubContent>
        </Menu.Sub>
        <Menu.Separator />
        <Menu.Item onSelect={() => copy(cp.id, 'Id copied')}>
          <Copy size={14} /> Copy id
        </Menu.Item>
        {rm.files[cp.id] && (
          <Menu.Item onSelect={() => copy(`roadmaps/${rm.slug}/${rm.files[cp.id]}`, 'File path copied')}>
            <FileText size={14} /> Copy file path
          </Menu.Item>
        )}
        <Menu.Separator />
        <Menu.Item onSelect={() => void updateFields(cp.id, { archived: true }, 'archive')}>
          <Archive size={14} /> Archive
        </Menu.Item>
        <Menu.Item danger onSelect={onDelete} hint="Del">
          <Trash size={14} /> Delete…
        </Menu.Item>
      </Menu.Content>
    </Menu.Root>
  );
}

function TitleField({ cp }: { cp: Checkpoint }) {
  const [v, setV] = useState(cp.title);
  const ref = useRef<HTMLTextAreaElement>(null);
  const pendingTitleEdit = useStore((s) => s.pendingTitleEdit);
  useEffect(() => setV(cp.title), [cp.title]);
  useEffect(() => {
    if (pendingTitleEdit !== cp.id) return;
    const t = ref.current;
    if (!t) return;
    t.focus();
    t.select();
    setState({ pendingTitleEdit: null });
  }, [pendingTitleEdit, cp.id]);
  useEffect(() => {
    const t = ref.current;
    if (t) {
      t.style.height = 'auto';
      t.style.height = `${t.scrollHeight}px`;
    }
  }, [v]);
  const commit = () => {
    const t = v.trim();
    if (!t) setV(cp.title);
    else if (t !== cp.title) void updateFields(cp.id, { title: t }, 'rename');
  };
  return (
    <textarea
      dir="auto"
      ref={ref}
      id="details-title"
      rows={1}
      value={v}
      aria-label="Title"
      onChange={(e) => setV(e.target.value.replace(/\n/g, ' '))}
      onBlur={commit}
      onKeyDown={(e) => {
        if (e.key === 'Enter') {
          e.preventDefault();
          e.currentTarget.blur();
        }
        if (e.key === 'Escape') {
          setV(cp.title);
          requestAnimationFrame(() => e.currentTarget?.blur());
        }
      }}
      className="-mx-1.5 block w-[calc(100%+12px)] resize-none overflow-hidden rounded-md bg-transparent px-1.5 py-0.5 text-[23px] font-bold leading-tight tracking-[-0.015em] outline-none hover:bg-surface-2 focus:bg-surface-2"
    />
  );
}

function SummaryField({ cp }: { cp: Checkpoint }) {
  const [v, setV] = useState(cp.summary);
  const ref = useRef<HTMLTextAreaElement>(null);
  useEffect(() => setV(cp.summary), [cp.summary]);
  useEffect(() => {
    const t = ref.current;
    if (t) {
      t.style.height = 'auto';
      t.style.height = `${t.scrollHeight}px`;
    }
  }, [v]);
  return (
    <textarea
      dir="auto"
      ref={ref}
      rows={1}
      value={v}
      aria-label="Summary"
      placeholder="Add a short description or purpose…"
      onChange={(e) => setV(e.target.value)}
      onBlur={() => v.trim() !== cp.summary && void updateFields(cp.id, { summary: v.trim() }, 'summary', { expect: true })}
      className="-mx-1.5 mt-3 block w-[calc(100%+12px)] resize-none overflow-hidden rounded-lg bg-transparent px-1.5 py-1 text-[14px] leading-relaxed text-muted outline-none placeholder:text-faint hover:bg-surface-2 focus:bg-surface-2 focus:text-fg"
    />
  );
}

function StatusPicker({ cp, profile }: { cp: Checkpoint; profile: Profile }) {
  const st = statusDef(profile, cp.status);
  return (
    <Menu.Root>
      <Menu.Trigger asChild>
        <button className="inline-flex h-7 items-center gap-1.5 rounded-lg border border-line bg-surface px-2 text-[12.5px] font-medium hover:bg-surface-2" aria-label={`Status: ${st.label}. Change status`}>
          <StatusIcon category={st.category} size={14} /> {st.label}
        </button>
      </Menu.Trigger>
      <Menu.Content align="start">
        <Menu.Label>Status: set by you</Menu.Label>
        {profile.statuses.map((s) => (
          <Menu.Item key={s.key} onSelect={() => setStatus(cp.id, s.key)}>
            <StatusIcon category={s.category} size={14} /> {s.label}
            {s.key === cp.status && <Check size={14} className="ml-auto text-accent" />}
          </Menu.Item>
        ))}
      </Menu.Content>
    </Menu.Root>
  );
}

function UnderstandingPicker({ cp }: { cp: Checkpoint }) {
  const cur = cp.understanding ?? 'not-yet';
  return (
    <Menu.Root>
      <Tip label="Your own judgement of whether you understand this. Separate from status, and never set by an agent.">
        <Menu.Trigger asChild>
          <button className="inline-flex h-7 items-center gap-1.5 rounded-lg border border-line bg-surface px-2 text-[12.5px] font-medium hover:bg-surface-2">
            <UnderstandingIcon level={cur} /> {UNDERSTANDING_LEVELS.find((l) => l.key === cur)?.short}
          </button>
        </Menu.Trigger>
      </Tip>
      <Menu.Content align="start">
        <Menu.Label>Can I explain and apply it on my own?</Menu.Label>
        {UNDERSTANDING_LEVELS.map((l) => (
          <Menu.Item key={l.key} onSelect={() => void updateFields(cp.id, { understanding: l.key }, 'understanding')}>
            <UnderstandingIcon level={l.key} /> {l.label}
            {l.key === cur && <Check size={14} className="ml-auto text-accent" />}
          </Menu.Item>
        ))}
      </Menu.Content>
    </Menu.Root>
  );
}

function ApprovalToggle({ cp }: { cp: Checkpoint }) {
  return (
    <Tip label={cp.approved ? 'You approved this content, so agent edits to it are held for your review. Click to mark it as a draft again.' : 'Draft: written or changed by an agent, or not reviewed yet. Approve it once you are happy with it.'}>
      <button
        onClick={() => void updateFields(cp.id, { approved: !cp.approved }, cp.approved ? 'unapprove' : 'approve')}
        className={cx(
          'inline-flex h-7 items-center gap-1.5 rounded-lg border px-2 text-[12.5px] font-medium',
          cp.approved ? 'border-transparent bg-done-soft text-done' : 'border-dashed border-line-strong text-muted hover:bg-surface-2 hover:text-fg',
        )}
      >
        {cp.approved ? <ShieldCheck size={14} /> : <Pencil size={13} />} {cp.approved ? 'Approved' : 'Draft · Approve'}
      </button>
    </Tip>
  );
}

function ChildrenBlock({ rm, cp, profile, progress }: { rm: Roadmap; cp: Checkpoint; profile: Profile; progress: Progress }) {
  const kids = useMemo(() => (childrenIndex(rm.checkpoints).get(cp.id) ?? []).filter((c) => !c.archived), [rm.checkpoints, cp.id]);
  const allDone = progress.total > 0 && progress.done === progress.total && statusDef(profile, cp.status).category !== 'done';
  return (
    <section className="mt-5 rounded-xl border border-line bg-surface-2/50 p-3" aria-label="Sub-checkpoints">
      <div className="flex items-center gap-2 text-[12.5px]">
        <span className="font-semibold">Sub-checkpoints</span>
        <span className="text-muted">
          {progress.done} of {progress.total} complete
          {progress.active ? ` · ${progress.active} in progress` : ''}
          {progress.optionalTotal ? ` · ${progress.optionalDone}/${progress.optionalTotal} optional` : ''}
        </span>
        <ProgressHelp />
      </div>
      <ProgressBar {...progress} className="mt-2" />
      {allDone && (
        <div className="mt-2.5 flex items-center gap-2 rounded-lg bg-done-soft px-2.5 py-1.5 text-[12.5px] text-done">
          Everything below is complete. Is this checkpoint complete too?
          <Button size="sm" variant="ghost" className="ml-auto !text-done" onClick={() => setStatus(cp.id, 'complete')}>
            Mark complete
          </Button>
        </div>
      )}
      <ul className="mt-2 grid gap-0.5">
        {kids.map((k) => {
          const st = statusDef(profile, k.status);
          return (
            <li key={k.id}>
              <button className="flex w-full items-center gap-2 rounded-lg px-1.5 py-1 text-left text-[13px] hover:bg-surface" onClick={() => selectCheckpoint(k.id, { center: true })}>
                <StatusIcon category={st.category} size={14} label={st.label} />
                <span className={cx('min-w-0 flex-1 truncate', k.optional && 'italic text-muted')}>{k.title}</span>
                {!k.approved && <span className="text-[11px] text-faint">draft</span>}
                <ArrowRight size={13} className="text-faint" />
              </button>
            </li>
          );
        })}
      </ul>
      <button className="mt-1 flex items-center gap-1.5 rounded-lg px-1.5 py-1 text-[12.5px] text-muted hover:text-accent" onClick={() => addCheckpoint(cp.id, { after: kids[kids.length - 1]?.id })}>
        <Plus size={13} /> Add sub-checkpoint
      </button>
    </section>
  );
}

export function ProgressHelp() {
  return (
    <Pop.Root>
      <Pop.Trigger asChild>
        <button className="text-faint hover:text-fg" aria-label="How progress is calculated">
          <Info size={13} />
        </button>
      </Pop.Trigger>
      <Pop.Content className="w-80 p-3 text-[12.5px] leading-relaxed">
        <div className="mb-1 font-semibold">How progress is calculated</div>
        <p className="text-muted">
          Completed sub-checkpoints ÷ all sub-checkpoints, counted at every level below this one. Optional and archived checkpoints are left out.
        </p>
        <p className="mt-2 text-muted">A checkpoint's own status is set only by you. Completing every child never marks the parent complete automatically.</p>
        <p className="mt-2 text-muted">Understanding (learning roadmaps) is tracked separately: ticking tasks off isn't the same as being able to explain or apply something.</p>
      </Pop.Content>
    </Pop.Root>
  );
}

// ------------------------------------------------------------------ sections

const PREF_KEY = 'waymark.editorMode';

/** Call `onClose` when the pointer goes down outside `ref` (menus, dialogs and editor popups don't count). */
function useCloseOnOutsideClick(ref: React.RefObject<HTMLElement | null>, active: boolean, onClose: () => void) {
  useEffect(() => {
    if (!active) return;
    const onDown = (e: PointerEvent) => {
      const t = e.target as Element | null;
      if (!t || !t.isConnected || ref.current?.contains(t)) return;
      if (t.closest('[data-radix-popper-content-wrapper], [role="dialog"], [role="menu"], [data-sonner-toaster], [class*="milkdown-"]')) return;
      onClose();
    };
    document.addEventListener('pointerdown', onDown, true);
    return () => document.removeEventListener('pointerdown', onDown, true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [active]);
}
/** Compare section text the way the server stores it (trimmed, LF newlines). */
const norm = (s: string) => s.replace(/\r\n?/g, '\n').trim();

function SectionBlock({ cp, sectionKey, extra, attach }: { cp: Checkpoint; sectionKey: SectionKey; extra?: boolean; attach: AttachTarget }) {
  const def = SECTION_DEFS[sectionKey];
  const server = cp.sections[sectionKey] ?? '';
  const field = `sections.${sectionKey}` as FieldPath;
  const [editing, setEditing] = useState(false);
  const [mode, setMode] = useState<'rich' | 'source'>(() => (localStorage.getItem(PREF_KEY) as 'rich' | 'source') ?? 'rich');
  const [lossy, setLossy] = useState(false);
  const [draft, setDraft] = useState(server);
  const base = useRef(server);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const conflict = useStore((s) => s.conflicts.find((c) => c.cpId === cp.id && c.field === field));
  const [outsideChange, setOutsideChange] = useState(false);
  const [editorKey, setEditorKey] = useState(0);
  const [caretAt, setCaretAt] = useState<number | null>(null);
  const sectionRef = useRef<HTMLElement>(null);

  useEffect(() => {
    if (!editing) {
      setDraft(server);
      base.current = norm(server);
    } else if (norm(server) !== base.current && norm(server) !== norm(draftRef.current)) {
      setOutsideChange(true);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [server]);

  const save = useCallback(
    (text: string, force = false) => {
      if (timer.current) clearTimeout(timer.current);
      timer.current = null;
      if (norm(text) === base.current && !force) return;
      const expect = force ? undefined : { sections: { [sectionKey]: base.current } };
      void submit([{ op: 'update', id: cp.id, set: { sections: { [sectionKey]: text } }, ...(expect ? { expect } : {}) }], { undo: null });
      base.current = norm(text);
    },
    [cp.id, sectionKey],
  );

  const onChange = (text: string) => {
    setDraft(text);
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => save(text), 650);
  };

  useEffect(
    () => () => {
      if (timer.current) {
        clearTimeout(timer.current);
        timer.current = null;
        save(draftRef.current);
      }
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [],
  );
  const draftRef = useRef(draft);
  draftRef.current = draft;

  const finish = () => {
    save(draft);
    setEditing(false);
    setOutsideChange(false);
  };
  const finishRef = useRef(finish);
  finishRef.current = finish;
  // No Edit/Done mode to manage: clicking anywhere outside the section saves and closes it.
  useCloseOnOutsideClick(sectionRef, editing, () => finishRef.current());

  const human = def.owner === 'human';
  const empty = !server.trim() && !editing;

  if (empty) {
    return (
      <button
        onClick={() => (setCaretAt(null), setEditing(true))}
        className="group flex items-center gap-2 rounded-lg px-2 py-1.5 text-left text-[13px] text-faint hover:bg-surface-2 hover:text-muted"
      >
        <Plus size={13} className="flex-none" />
        <span className="font-medium">{def.label}</span>
        <span className="hidden truncate text-[12px] group-hover:inline">{def.hint}</span>
      </button>
    );
  }

  const useSource = mode === 'source' || lossy;
  return (
    <section ref={sectionRef} className={cx('group rounded-xl px-2 py-2', editing ? 'bg-surface-2/60 ring-1 ring-line' : 'hover:bg-surface-2/50')} aria-label={def.label}>
      <header className="mb-1.5 flex items-center gap-2">
        <h3 className="text-[12.5px] font-semibold tracking-[-0.005em]">{def.label}</h3>
        <Tip label={human ? 'Yours. Agents can read it, but their edits are held for your approval.' : `${def.hint} Agents may edit this.`}>
          <span className="inline-flex items-center gap-1 text-[11px] text-faint">
            {human ? <User size={11} /> : <Bot size={11} />}
            {human ? 'yours' : 'you & agent'}
          </span>
        </Tip>
        {extra && <Chip tone="warn">not in this profile</Chip>}
        <div className={cx('ml-auto flex items-center gap-0.5', !editing && 'opacity-0 group-hover:opacity-100 group-focus-within:opacity-100')}>
          {editing && (
            <Tip label={useSource ? 'Use the visual editor' : 'Edit the Markdown source'}>
              <button
                className={cx('rounded-md p-1 text-faint hover:bg-surface-3 hover:text-fg', useSource && 'text-accent')}
                aria-label="Toggle Markdown source"
                onClick={() => {
                  const next = useSource ? 'rich' : 'source';
                  if (lossy && next === 'rich') return toast('This text contains Markdown the visual editor would change, so it stays in source mode.');
                  setMode(next);
                  try {
                    localStorage.setItem(PREF_KEY, next);
                  } catch {
                    /* fine */
                  }
                }}
              >
                <Code size={14} />
              </button>
            </Tip>
          )}
          {editing ? (
            <Button size="sm" variant="ghost" onClick={finish}>
              Done
            </Button>
          ) : (
            <Button size="sm" variant="ghost" onClick={() => (setCaretAt(null), setEditing(true))}>
              <Pencil size={12} /> Edit
            </Button>
          )}
        </div>
      </header>

      {(conflict || outsideChange) && (
        <div className="mb-2 rounded-lg border border-review/40 bg-warn-soft px-3 py-2 text-[12.5px]">
          <div className="font-medium text-review">This section changed outside the app while you were editing.</div>
          <div className="mt-1.5 flex flex-wrap gap-1.5">
            <Button
              size="sm"
              onClick={() => {
                save(draft, true);
                setOutsideChange(false);
                clearConflict(cp.id, field);
              }}
            >
              Keep mine
            </Button>
            <Button
              size="sm"
              onClick={() => {
                const theirs = getState().roadmap?.checkpoints[cp.id]?.sections[sectionKey] ?? '';
                setDraft(theirs);
                base.current = norm(theirs);
                setOutsideChange(false);
                clearConflict(cp.id, field);
                setEditorKey((k) => k + 1);
              }}
            >
              Use theirs
            </Button>
            <CompareButton mine={draft} theirs={server} />
          </div>
        </div>
      )}
      {lossy && editing && <div className="mb-2 text-[12px] text-muted">Showing Markdown source: this text has formatting the visual editor can't keep exactly (for example HTML).</div>}

      {editing ? (
        useSource ? (
          <SourceEditor key={editorKey} value={draft} onChange={onChange} autoFocus placeholder={def.hint} attach={attach} />
        ) : (
          <div
            onKeyDown={(e) => {
              if (e.key === 'Escape') {
                e.stopPropagation();
                finish();
              }
            }}
          >
            <RichEditor key={editorKey} label={def.label} value={draft} onChange={onChange} autoFocus placeholder={def.hint} onLossy={() => setLossy(true)} attach={attach} caretAt={caretAt} />
          </div>
        )
      ) : (
        <div
          className="cursor-text"
          onClick={(e) => {
            if ((e.target as HTMLElement).closest('a, input, button')) return;
            if (window.getSelection()?.toString()) return;
            // Open the editor with the caret where you clicked, like a document.
            setCaretAt(wordCharsBeforePoint(e.currentTarget, e.clientX, e.clientY));
            setEditing(true);
          }}
        >
          <MarkdownView text={server} roadmapId={attach.roadmapId} onToggleTask={(offset) => onChangeImmediate(toggleTaskAt(server, offset))} />
        </div>
      )}
    </section>
  );

  function onChangeImmediate(text: string) {
    setDraft(text);
    save(text);
  }
}

function CompareButton({ mine, theirs }: { mine: string; theirs: string }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <Button size="sm" variant="ghost" onClick={() => setOpen(true)}>
        Compare
      </Button>
      <Modal open={open} onOpenChange={setOpen} title="Your text and the other version" wide>
        <div className="grid gap-3 md:grid-cols-2">
          <div>
            <div className="mb-1 text-[12px] font-semibold text-muted">Yours (in the editor)</div>
            <pre className="whitespace-pre-wrap rounded-lg border border-line bg-surface-2 p-3 font-mono text-[12px]">{mine}</pre>
          </div>
          <div>
            <div className="mb-1 text-[12px] font-semibold text-muted">Theirs (saved in the file)</div>
            <pre className="whitespace-pre-wrap rounded-lg border border-line bg-surface-2 p-3 font-mono text-[12px]">{theirs}</pre>
          </div>
        </div>
      </Modal>
    </>
  );
}

// ------------------------------------------------------------------ resources

const KIND_ICON: Record<ResourceKind, ReactNode> = {
  article: <FileText size={14} />,
  video: <Video size={14} />,
  book: <BookOpen size={14} />,
  course: <GraduationCap size={14} />,
  docs: <FileText size={14} />,
  tool: <Wrench size={14} />,
  other: <Link2 size={14} />,
};

function toSeconds(ts: string): number | null {
  const parts = ts.trim().split(':').map(Number);
  if (!parts.length || parts.some((n) => !Number.isFinite(n))) return null;
  return parts.reduce((acc, n) => acc * 60 + n, 0);
}

export function resourceHref(r: Resource): string {
  if (!r.start) return r.url;
  const s = toSeconds(r.start);
  if (s === null) return r.url;
  try {
    const u = new URL(r.url);
    if (/(^|\.)youtube\.com$/.test(u.hostname) || u.hostname === 'youtu.be') {
      u.searchParams.set('t', `${s}s`);
      return u.toString();
    }
    if (/(^|\.)vimeo\.com$/.test(u.hostname)) return `${r.url.split('#')[0]}#t=${s}s`;
  } catch {
    /* not a URL */
  }
  return r.url;
}

function hostOf(url: string) {
  try {
    return new URL(url).hostname.replace(/^www\./, '');
  } catch {
    return url;
  }
}

// ------------------------------------------------------------------ attachments

async function attachFiles(target: AttachTarget, files: File[]) {
  let ok = 0;
  for (const f of files) {
    try {
      await target.upload(f);
      ok++;
    } catch (e) {
      toast.error(`${f.name || 'File'}: ${(e as Error).message}`);
    }
  }
  if (ok) toast.success(ok === 1 ? 'Attached. Find it under Attachments.' : `Attached ${ok} files.`);
}

function AttachmentsBlock({ rm, cp, attach }: { rm: Roadmap; cp: Checkpoint; attach: AttachTarget }) {
  const items = rm.attachments?.[cp.id] ?? [];
  const input = useRef<HTMLInputElement>(null);
  const insertIntoNotes = (a: Attachment) => {
    const md = markdownFor({ name: a.name, markdownPath: `../${a.path}`, kind: a.kind });
    void submit([{ op: 'update', id: cp.id, set: {}, append: { notes: md } }], { undo: null }).then(() => toast.success('Added to My notes.'));
  };
  const remove = async (a: Attachment) => {
    try {
      const res = await http.del<{ trashId: string }>(`/api/roadmaps/${encodeURIComponent(rm.meta.id)}/attachments?path=${encodeURIComponent(a.path)}`);
      toast(`Moved “${a.name}” to Trash`, { action: { label: 'Undo', onClick: () => void http.post(`/api/trash/${res.trashId}/restore`).catch((e) => toast.error((e as Error).message)) } });
    } catch (e) {
      toast.error((e as Error).message);
    }
  };
  return (
    <section className="mt-5" aria-label="Attachments">
      <div className="mb-1.5 flex items-center gap-2 px-2">
        <h3 className="text-[12.5px] font-semibold">Attachments</h3>
        <span className="text-[11px] text-faint">{items.length || ''}</span>
        <button className="ml-auto flex min-h-6 items-center gap-1 rounded-md px-1.5 py-0.5 text-[12px] text-muted hover:bg-surface-2 hover:text-accent" onClick={() => input.current?.click()}>
          <Plus size={13} /> Add
        </button>
        <input
          ref={input}
          type="file"
          multiple
          accept="image/*,.pdf,application/pdf"
          className="hidden"
          onChange={(e) => {
            const files = [...(e.target.files ?? [])];
            e.target.value = '';
            if (files.length) void attachFiles(attach, files);
          }}
        />
      </div>
      {items.length === 0 ? (
        <div className="px-2 text-[12.5px] text-faint">Images and PDFs: drop them on this page, paste a screenshot (Ctrl+V), or use Add.</div>
      ) : (
        <ul className="grid grid-cols-2 gap-2 px-1 sm:grid-cols-3">
          {items.map((a) => (
            <li key={a.path} className="group relative overflow-hidden rounded-lg border border-line bg-surface">
              <button className="block w-full text-left" onClick={() => openViewer(rm.meta.id, a.path, a.name)} title={`Open ${a.name}`}>
                {a.kind === 'image' ? (
                  <img src={fileUrl(rm.meta.id, a.path)} alt={a.name} loading="lazy" className="h-24 w-full bg-surface-2 object-cover" />
                ) : (
                  <div className="flex h-24 w-full items-center justify-center bg-surface-2 text-danger">
                    <FileText size={30} strokeWidth={1.5} />
                    <span className="ml-1 text-[11px] font-bold uppercase">{a.kind === 'pdf' ? 'PDF' : 'File'}</span>
                  </div>
                )}
                <div className="px-2 py-1.5">
                  <div className="truncate text-[12px] font-medium">{a.name}</div>
                  <div className="text-[11px] text-faint">{formatSize(a.size)}</div>
                </div>
              </button>
              <div className="absolute right-1 top-1 flex gap-0.5 rounded-md bg-surface/90 p-0.5 opacity-0 shadow-sm group-hover:opacity-100 group-focus-within:opacity-100">
                <IconButton size="sm" label="Add a link to My notes" onClick={() => insertIntoNotes(a)}>
                  <Link2 size={13} />
                </IconButton>
                <IconButton size="sm" label="Copy Markdown" onClick={() => copy(markdownFor({ name: a.name, markdownPath: `../${a.path}`, kind: a.kind }), 'Markdown copied')}>
                  <Copy size={13} />
                </IconButton>
                <IconButton size="sm" label="Move to Trash" onClick={() => void remove(a)}>
                  <Trash size={13} />
                </IconButton>
              </div>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

function ResourcesBlock({ cp }: { cp: Checkpoint }) {
  const [editing, setEditing] = useState<number | 'new' | null>(null);
  const save = (list: Resource[]) => void updateFields(cp.id, { resources: list }, 'resources');
  return (
    <section className="mt-5" aria-label="Resources">
      <div className="mb-1.5 flex items-center gap-2 px-2">
        <h3 className="text-[12.5px] font-semibold">Resources</h3>
        <span className="text-[11px] text-faint">{cp.resources.length || ''}</span>
        <button className="ml-auto flex min-h-6 items-center gap-1 rounded-md px-1.5 py-0.5 text-[12px] text-muted hover:bg-surface-2 hover:text-accent" onClick={() => setEditing('new')}>
          <Plus size={13} /> Add
        </button>
      </div>
      <ul className="grid gap-0.5">
        {cp.resources.map((r, i) =>
          editing === i ? (
            <li key={i}>
              <ResourceForm
                initial={r}
                onCancel={() => setEditing(null)}
                onSave={(nr) => {
                  save(cp.resources.map((x, j) => (j === i ? nr : x)));
                  setEditing(null);
                }}
              />
            </li>
          ) : (
            <li key={i} className="group flex items-start gap-2.5 rounded-lg px-2 py-1.5 hover:bg-surface-2">
              <span className="mt-0.5 text-faint">{KIND_ICON[r.kind ?? 'other']}</span>
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-x-2">
                  <a href={resourceHref(r)} target="_blank" rel="noreferrer noopener" className="min-w-0 truncate text-[13px] font-medium text-fg hover:text-accent hover:underline">
                    {r.title || r.url}
                  </a>
                  {r.start && (
                    <a href={resourceHref(r)} target="_blank" rel="noreferrer noopener" className="inline-flex items-center gap-0.5 rounded bg-accent-soft px-1 text-[11px] font-medium text-accent">
                      <Play size={9} fill="currentColor" /> {r.start}
                    </a>
                  )}
                  <span className="text-[11.5px] text-faint">{hostOf(r.url)}</span>
                </div>
                {r.note && <div className="text-[12.5px] text-muted">{r.note}</div>}
              </div>
              <div className="flex opacity-0 group-hover:opacity-100 group-focus-within:opacity-100">
                <IconButton size="sm" label="Edit resource" onClick={() => setEditing(i)}>
                  <Pencil size={13} />
                </IconButton>
                <IconButton size="sm" label="Remove resource" onClick={() => save(cp.resources.filter((_, j) => j !== i))}>
                  <X size={14} />
                </IconButton>
              </div>
            </li>
          ),
        )}
      </ul>
      {editing === 'new' && (
        <ResourceForm
          onCancel={() => setEditing(null)}
          onSave={(r) => {
            save([...cp.resources, r]);
            setEditing(null);
          }}
        />
      )}
      {!cp.resources.length && editing !== 'new' && <div className="px-2 text-[12.5px] text-faint">Links to articles, videos, books or docs. Videos can include a start time.</div>}
    </section>
  );
}

function ResourceForm({ initial, onSave, onCancel }: { initial?: Resource; onSave: (r: Resource) => void; onCancel: () => void }) {
  const [r, setR] = useState<Resource>(initial ?? { title: '', url: '', kind: 'article' });
  const field = 'h-8 rounded-lg border border-line bg-surface px-2.5 text-[13px] outline-none focus:border-accent';
  const isVideo = r.kind === 'video';
  return (
    <form
      className="mt-1 grid gap-2 rounded-xl border border-line bg-surface-2 p-3"
      onSubmit={(e) => {
        e.preventDefault();
        if (!r.url.trim() && !r.title.trim()) return;
        const out: Resource = { title: r.title.trim() || hostOf(r.url.trim()), url: r.url.trim() };
        if (r.kind) out.kind = r.kind;
        if (r.start?.trim()) out.start = r.start.trim();
        if (r.note?.trim()) out.note = r.note.trim();
        onSave(out);
      }}
      onKeyDown={(e) => e.key === 'Escape' && onCancel()}
    >
      <input
        autoFocus
        className={field}
        placeholder="https://…"
        value={r.url}
        aria-label="URL"
        onChange={(e) => {
          const url = e.target.value;
          const video = /youtube\.com|youtu\.be|vimeo\.com/.test(url);
          setR({ ...r, url, kind: video && (!r.kind || r.kind === 'article') ? 'video' : r.kind });
        }}
      />
      <input className={field} placeholder="Title" value={r.title} aria-label="Title" onChange={(e) => setR({ ...r, title: e.target.value })} />
      <div className="flex gap-2">
        <select className={cx(field, 'flex-1')} value={r.kind ?? 'other'} aria-label="Kind" onChange={(e) => setR({ ...r, kind: e.target.value as ResourceKind })}>
          {(['article', 'video', 'book', 'course', 'docs', 'tool', 'other'] as ResourceKind[]).map((k) => (
            <option key={k} value={k}>
              {k[0]!.toUpperCase() + k.slice(1)}
            </option>
          ))}
        </select>
        {isVideo && <input className={cx(field, 'w-28')} placeholder="Start 12:30" value={r.start ?? ''} aria-label="Start time" onChange={(e) => setR({ ...r, start: e.target.value })} />}
      </div>
      <input className={field} placeholder="Note (optional)" value={r.note ?? ''} aria-label="Note" onChange={(e) => setR({ ...r, note: e.target.value })} />
      <div className="flex justify-end gap-2">
        <Button size="sm" variant="ghost" type="button" onClick={onCancel}>
          Cancel
        </Button>
        <Button size="sm" variant="primary" type="submit">
          Save
        </Button>
      </div>
    </form>
  );
}

// ------------------------------------------------------------------ completion & prerequisites

function CompletionField({ cp }: { cp: Checkpoint }) {
  const [v, setV] = useState(cp.completion);
  useEffect(() => setV(cp.completion), [cp.completion]);
  return (
    <section className="mt-5 px-2" aria-label="Completion criterion">
      <h3 className="mb-1 text-[12.5px] font-semibold">Done when…</h3>
      <textarea
      dir="auto"
        rows={1}
        value={v}
        onChange={(e) => setV(e.target.value)}
        onBlur={() => v.trim() !== cp.completion && void updateFields(cp.id, { completion: v.trim() }, 'completion criterion')}
        placeholder="Optional: how you'll know this checkpoint is complete"
        className="-mx-1.5 block w-[calc(100%+12px)] resize-none rounded-lg bg-transparent px-1.5 py-1 text-[13.5px] leading-relaxed outline-none placeholder:text-faint field-sizing-content hover:bg-surface-2 focus:bg-surface-2"
      />
    </section>
  );
}

function PrereqBlock({ rm, cp, profile }: { rm: Roadmap; cp: Checkpoint; profile: Profile }) {
  const requiredBy = useMemo(() => Object.values(rm.checkpoints).filter((c) => c.prerequisites.includes(cp.id)).sort(compareSiblings), [rm.checkpoints, cp.id]);
  const chip = (c: Checkpoint, onRemove?: () => void) => {
    const st = statusDef(profile, c.status);
    return (
      <span key={c.id} className="group inline-flex max-w-full items-center gap-1 rounded-lg border border-line bg-surface py-0.5 pl-1.5 pr-1 text-[12.5px]">
        <StatusIcon category={st.category} size={12} />
        <button className="truncate hover:text-accent" onClick={() => selectCheckpoint(c.id, { center: true })}>
          {c.title}
        </button>
        {onRemove && (
          <button aria-label={`Remove prerequisite ${c.title}`} className="rounded p-0.5 text-faint hover:bg-surface-2 hover:text-danger" onClick={onRemove}>
            <X size={12} />
          </button>
        )}
      </span>
    );
  };
  const missing = cp.prerequisites.filter((p) => !rm.checkpoints[p]);
  return (
    <section className="mt-5 px-2" aria-label="Prerequisites">
      <div className="mb-1.5 flex items-center gap-2">
        <h3 className="text-[12.5px] font-semibold">Requires</h3>
        <PrereqPicker rm={rm} cp={cp} />
      </div>
      <div className="flex flex-wrap gap-1.5">
        {cp.prerequisites.map((p) => rm.checkpoints[p]).filter(Boolean).map((c) => chip(c!, () => unlink(cp.id, c!.id)))}
        {missing.map((m) => (
          <Chip key={m} tone="warn">
            missing {m}
          </Chip>
        ))}
        {!cp.prerequisites.length && <span className="text-[12.5px] text-faint">Nothing. Add checkpoints that should come first.</span>}
      </div>
      {requiredBy.length > 0 && (
        <>
          <h3 className="mb-1.5 mt-3 text-[12.5px] font-semibold">Required by</h3>
          <div className="flex flex-wrap gap-1.5">{requiredBy.map((c) => chip(c))}</div>
        </>
      )}
    </section>
  );
}

function PrereqPicker({ rm, cp }: { rm: Roadmap; cp: Checkpoint }) {
  const [open, setOpen] = useState(false);
  const options = useMemo(
    () =>
      Object.values(rm.checkpoints)
        .filter((c) => c.id !== cp.id && !c.archived && !cp.prerequisites.includes(c.id) && !requiresTransitively(rm.checkpoints, c.id, cp.id))
        .sort((a, b) => a.title.localeCompare(b.title)),
    [rm.checkpoints, cp],
  );
  return (
    <Pop.Root open={open} onOpenChange={setOpen}>
      <Pop.Trigger asChild>
        <button className="flex min-h-6 items-center gap-1 rounded-md px-1.5 py-0.5 text-[12px] text-muted hover:bg-surface-2 hover:text-accent">
          <Plus size={13} /> Add
        </button>
      </Pop.Trigger>
      <Pop.Content className="w-80 p-0">
        <Command label="Choose a prerequisite" className="flex flex-col">
          <Command.Input autoFocus placeholder="Search checkpoints…" className="h-10 border-b border-line bg-transparent px-3 text-[13px] outline-none" />
          <Command.List className="max-h-64 overflow-y-auto p-1">
            <Command.Empty className="px-3 py-4 text-[12.5px] text-muted">No matching checkpoint.</Command.Empty>
            {options.map((c) => (
              <Command.Item
                key={c.id}
                value={`${c.title} ${c.id}`}
                onSelect={() => {
                  link(cp.id, c.id);
                  setOpen(false);
                }}
                className="flex cursor-pointer items-center gap-2 rounded-lg px-2 py-1.5 text-[13px] data-[selected=true]:bg-surface-2"
              >
                <span className="truncate">{c.title}</span>
                {c.parent && <span className="ml-auto truncate text-[11px] text-faint">{rm.checkpoints[c.parent]?.title}</span>}
              </Command.Item>
            ))}
          </Command.List>
        </Command>
      </Pop.Content>
    </Pop.Root>
  );
}

// ------------------------------------------------------------------ history

const SOURCE_LABEL: Record<string, string> = {
  app: 'You',
  external: 'Outside edit',
  proposal: 'Proposal',
  restore: 'Restored',
  review: 'Review decision',
  import: 'Imported',
  system: 'First seen',
};

function HistoryBlock({ rm, cp }: { rm: Roadmap; cp: Checkpoint }) {
  const [open, setOpen] = useState(false);
  const [entries, setEntries] = useState<HistoryEntry[] | null>(null);
  const profile = getProfile(rm.meta.profile);
  const load = useCallback(async () => {
    try {
      setEntries(await http.get<HistoryEntry[]>(`/api/roadmaps/${rm.meta.id}/history?cp=${encodeURIComponent(cp.id)}`));
    } catch (e) {
      toast.error((e as Error).message);
    }
  }, [rm.meta.id, cp.id]);
  useEffect(() => {
    if (open) void load();
  }, [open, load, cp.rev]);

  const summarize = (e: HistoryEntry) => {
    if (!e.before || !e.after) return e.kind === 'create' ? 'Created' : 'Deleted';
    const a = parseCheckpoint(e.before, profile);
    const b = parseCheckpoint(e.after, profile);
    if (!a.ok || !b.ok) return 'Changed';
    const d = diffCheckpoints(a.value.checkpoint, b.value.checkpoint).map((c) => fieldLabel(c.field));
    return d.length ? d.join(', ') : 'Formatting only';
  };

  const restore = async (e: HistoryEntry, which: 'before' | 'after') => {
    try {
      await http.post(`/api/roadmaps/${rm.meta.id}/history/restore`, { entryId: e.id, which });
      toast.success('Version restored. The current one is still in History.');
      void load();
    } catch (err) {
      toast.error((err as Error).message);
    }
  };

  return (
    <section className="mt-6 px-2" aria-label="History">
      <button className="flex items-center gap-1.5 text-[12.5px] font-semibold" onClick={() => setOpen(!open)} aria-expanded={open}>
        <ChevronRight size={13} className={cx('transition-transform', open && 'rotate-90')} />
        <ClockFading size={13} /> History
      </button>
      {open && (
        <ol className="mt-2 grid gap-1 border-l border-line pl-3">
          {entries === null && <li className="text-[12.5px] text-faint">Loading…</li>}
          {entries?.length === 0 && <li className="text-[12.5px] text-faint">No history yet.</li>}
          {entries?.map((e) => (
            <li key={e.id} className="group rounded-lg px-2 py-1.5 text-[12.5px] hover:bg-surface-2">
              <div className="flex items-center gap-2">
                <span className={cx('font-medium', e.source === 'external' && 'text-accent')}>{SOURCE_LABEL[e.source] ?? e.source}</span>
                <span className="text-faint" title={new Date(e.t).toLocaleString()}>
                  {relTime(e.t)}
                </span>
              </div>
              <div className="text-muted">{summarize(e)}</div>
              {e.note && <div className="text-[11.5px] text-review">{e.note}</div>}
              <div className="mt-1 hidden gap-1 group-hover:flex group-focus-within:flex">
                {e.before && (
                  <Button size="sm" variant="ghost" onClick={() => void restore(e, 'before')}>
                    Restore before this
                  </Button>
                )}
                {e.after && (
                  <Button size="sm" variant="ghost" onClick={() => void restore(e, 'after')}>
                    Restore this version
                  </Button>
                )}
              </div>
            </li>
          ))}
        </ol>
      )}
    </section>
  );
}

// ------------------------------------------------------------------ roadmap overview (nothing selected)

function RoadmapOverview({ rm, progress }: { rm: Roadmap; progress: Map<string | null, Progress> }) {
  const profile = getProfile(rm.meta.profile);
  const total = progress.get(null)!;
  const top = useMemo(() => (childrenIndex(rm.checkpoints).get('') ?? []).filter((c) => !c.archived), [rm.checkpoints]);
  const drafts = Object.values(rm.checkpoints).filter((c) => !c.approved && !c.archived).length;
  const archived = Object.values(rm.checkpoints).filter((c) => c.archived);

  return (
    <div className="px-5 pb-16 pt-5">
      <h2 className="sr-only">Roadmap overview</h2>
      <div className="text-[12px] font-medium text-faint">{profile.label} roadmap</div>
      <MetaField
        rm={rm}
        field="title"
        label="Roadmap title"
        className="mt-0.5 text-[21px] font-semibold leading-tight tracking-[-0.015em]"
      />
      <MetaField rm={rm} field="description" label="Description" placeholder="Add a one-line description…" className="mt-1.5 text-[14px] leading-relaxed text-muted focus:text-fg" />

      <section className="mt-5 rounded-xl border border-line p-3">
        <div className="flex items-center gap-2 text-[12.5px]">
          <span className="font-semibold">Progress</span>
          <span className="text-muted">
            {total.done} of {total.total} complete{total.active ? ` · ${total.active} in progress` : ''}
          </span>
          <ProgressHelp />
        </div>
        <ProgressBar {...total} className="mt-2" />
        <div className="mt-2.5 flex flex-wrap gap-1.5 text-[12px]">
          {profile.understanding && (
            <Chip tone="understand">
              <UnderstandingIcon level="can-explain" size={11} /> {total.understood} understood
            </Chip>
          )}
          <Chip>{drafts} draft</Chip>
          {total.optionalTotal > 0 && (
            <Chip>
              {total.optionalDone}/{total.optionalTotal} optional
            </Chip>
          )}
        </div>
      </section>

      <OverviewEditor rm={rm} />

      <section className="mt-5">
        <h3 className="mb-1 text-[12.5px] font-semibold">Main checkpoints</h3>
        <ul className="grid gap-0.5">
          {top.map((c, i) => {
            const st = statusDef(profile, c.status);
            const p = progress.get(c.id);
            return (
              <li key={c.id}>
                <button className="flex w-full items-center gap-2.5 rounded-lg px-1.5 py-1.5 text-left text-[13px] hover:bg-surface-2" onClick={() => selectCheckpoint(c.id, { center: true })}>
                  <span className="w-4 text-right text-[11px] tabular-nums text-faint">{i + 1}</span>
                  <StatusIcon category={st.category} size={14} />
                  <span className="min-w-0 flex-1 truncate font-medium">{c.title}</span>
                  {p && p.total > 0 && (
                    <span className="text-[11.5px] tabular-nums text-faint">
                      {p.done}/{p.total}
                    </span>
                  )}
                </button>
              </li>
            );
          })}
        </ul>
        <button className="mt-1 flex items-center gap-1.5 px-1.5 py-1 text-[12.5px] text-muted hover:text-accent" onClick={() => addCheckpoint(null, { after: top[top.length - 1]?.id })}>
          <Plus size={13} /> Add main checkpoint
        </button>
      </section>

      {archived.length > 0 && (
        <section className="mt-5">
          <h3 className="mb-1 text-[12.5px] font-semibold">Archived</h3>
          <ul className="grid gap-0.5">
            {archived.map((c) => (
              <li key={c.id} className="flex items-center gap-2 px-1.5 py-1 text-[13px] text-muted">
                <span className="min-w-0 flex-1 truncate">{c.title}</span>
                <Button size="sm" variant="ghost" onClick={() => void updateFields(c.id, { archived: false }, 'unarchive')}>
                  Restore
                </Button>
              </li>
            ))}
          </ul>
        </section>
      )}

      <section className="mt-6 rounded-xl border border-line bg-surface-2/50 p-3 text-[12.5px] leading-relaxed text-muted">
        <div className="mb-1 flex items-center gap-1.5 font-semibold text-fg">
          <Bot size={14} /> Working with an agent
        </div>
        Point Claude Code (or any agent that edits files) at your workspace folder and ask, for example: “Read AGENTS.md, then expand <i>{top[0]?.title ?? 'the first checkpoint'}</i> into sub-checkpoints.” Its edits appear here live and are listed in <b>Review</b>.
        <div className="mt-2">
          <Button size="sm" onClick={() => setState({ dialog: 'agent' })}>
            Agent setup and Copy for AI <ExternalLink size={12} />
          </Button>
        </div>
      </section>
    </div>
  );
}

/** Roadmap title or description, edited in place; saved when you leave the field. */
function MetaField({ rm, field, label, placeholder, className }: { rm: Roadmap; field: 'title' | 'description'; label: string; placeholder?: string; className?: string }) {
  const value = rm.meta[field];
  const [v, setV] = useState(value);
  const ref = useRef<HTMLTextAreaElement>(null);
  useEffect(() => setV(value), [value]);
  useEffect(() => {
    const t = ref.current;
    if (t) {
      t.style.height = 'auto';
      t.style.height = `${t.scrollHeight}px`;
    }
  }, [v]);
  const commit = () => {
    const t = v.replace(/\s+/g, ' ').trim();
    if (field === 'title' && !t) return setV(value);
    if (t === value) return;
    http.patch(`/api/roadmaps/${rm.meta.id}`, { [field]: t }).catch((e: Error) => {
      toast.error(e.message);
      setV(value);
    });
  };
  return (
    <textarea
      dir="auto"
      ref={ref}
      rows={1}
      value={v}
      aria-label={label}
      placeholder={placeholder}
      onChange={(e) => setV(e.target.value.replace(/\n/g, ' '))}
      onBlur={commit}
      onKeyDown={(e) => {
        if (e.key === 'Enter') {
          e.preventDefault();
          e.currentTarget.blur();
        } else if (e.key === 'Escape') {
          setV(value);
          requestAnimationFrame(() => e.currentTarget?.blur());
        }
      }}
      className={cx('-mx-1.5 block w-[calc(100%+12px)] resize-none overflow-hidden rounded-md bg-transparent px-1.5 py-0.5 outline-none placeholder:text-faint hover:bg-surface-2 focus:bg-surface-2', className)}
    />
  );
}

/** The roadmap's goal and context: click to write (caret where you click), saves as you type, closes when you click away. */
function OverviewEditor({ rm }: { rm: Roadmap }) {
  const [editing, setEditing] = useState(false);
  const [caretAt, setCaretAt] = useState<number | null>(null);
  const [draft, setDraft] = useState(rm.meta.overview);
  const saved = useRef(rm.meta.overview);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const ref = useRef<HTMLElement>(null);
  const draftRef = useRef(draft);
  draftRef.current = draft;
  useEffect(() => {
    if (!editing) {
      setDraft(rm.meta.overview);
      saved.current = rm.meta.overview;
    }
  }, [rm.meta.overview, editing]);
  const save = (text: string) => {
    if (timer.current) clearTimeout(timer.current);
    timer.current = null;
    if (text.trim() === saved.current.trim()) return;
    saved.current = text;
    http.patch(`/api/roadmaps/${rm.meta.id}`, { overview: text }).catch((e: Error) => toast.error(e.message));
  };
  const onChange = (text: string) => {
    setDraft(text);
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => save(text), 650);
  };
  const finish = () => {
    save(draftRef.current);
    setEditing(false);
  };
  const finishRef = useRef(finish);
  finishRef.current = finish;
  useCloseOnOutsideClick(ref, editing, () => finishRef.current());
  useEffect(
    () => () => {
      if (timer.current) save(draftRef.current);
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [],
  );
  const open = (at: number | null) => {
    setCaretAt(at);
    setEditing(true);
  };
  return (
    <section ref={ref} className={cx('mt-5 rounded-xl px-2 py-2', editing ? 'bg-surface-2/60 ring-1 ring-line' : 'hover:bg-surface-2/50')} aria-label="Goal and context">
      <div className="mb-1 flex items-center gap-2">
        <h3 className="text-[12.5px] font-semibold">Goal and context</h3>
        <span className="text-[11px] text-faint">agents read this first</span>
        {editing ? (
          <Button size="sm" variant="ghost" className="ml-auto" onClick={finish}>
            Done
          </Button>
        ) : (
          <Button size="sm" variant="ghost" className="ml-auto" onClick={() => open(null)}>
            <Pencil size={12} /> Edit
          </Button>
        )}
      </div>
      {editing ? (
        <div
          onKeyDown={(e) => {
            if (e.key === 'Escape') {
              e.stopPropagation();
              finish();
            }
          }}
        >
          <RichEditor label="Goal and context" value={draft} onChange={onChange} autoFocus caretAt={caretAt} placeholder="What do you want to achieve? What do you know already? Constraints?" />
        </div>
      ) : rm.meta.overview ? (
        <div
          className="cursor-text"
          onClick={(e) => {
            if ((e.target as HTMLElement).closest('a, input, button') || window.getSelection()?.toString()) return;
            open(wordCharsBeforePoint(e.currentTarget, e.clientX, e.clientY));
          }}
        >
          <MarkdownView text={rm.meta.overview} roadmapId={rm.meta.id} />
        </div>
      ) : (
        <button className="text-left text-[13px] text-faint hover:text-muted" onClick={() => open(null)}>
          + Describe the goal, your starting point and constraints. This helps you and any agent.
        </button>
      )}
    </section>
  );
}
