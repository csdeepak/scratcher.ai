import { useMemo, useState, type ReactNode } from 'react';
import { diffWords } from 'diff';
import { toast } from 'sonner';
import { Bot, Check, ChevronRight, ClipboardPaste, FilePlus, FileX, Inbox, Pause, Undo2, X } from 'lucide-react';
import type { FieldPath, Resource } from '../../shared/model';
import { fieldLabel } from '../../shared/fields';
import { HOLD_REASON_TEXT } from '../../shared/guard';
import type { ReviewItem } from '../../server/review';
import type { ChangePreview, ProposalView } from '../../server/workspace';
import { http } from '../api';
import { getState, navigate, refreshReview, selectCheckpoint, setState, useStore } from '../store';
import { Button, Chip, Drawer, IconButton, Modal, cx, relTime } from './ui';

export function ReviewDrawer() {
  const open = useStore((s) => s.reviewOpen);
  return (
    <Drawer open={open} onOpenChange={(o) => setState({ reviewOpen: o })} title="Review">
      <ReviewContent />
    </Drawer>
  );
}

function ReviewContent() {
  const review = useStore((s) => s.review);
  const summaries = useStore((s) => s.summaries);
  const current = useStore((s) => s.roadmap?.meta.id);
  const [scope, setScope] = useState<'this' | 'all'>(current ? 'this' : 'all');
  const title = (id: string) => summaries.find((s) => s.id === id)?.title ?? id;
  const inScope = <T extends { roadmapId: string }>(x: T) => scope === 'all' || x.roadmapId === current;
  const proposals = review.proposals.filter(inScope);
  const held = review.items.filter(inScope).filter((i) => i.kind === 'held' || i.kind === 'held-delete');
  const changed = review.items.filter(inScope).filter((i) => i.kind === 'changed' || i.kind === 'created' || i.kind === 'deleted');
  const empty = !proposals.length && !held.length && !changed.length;

  const keepAll = async () => {
    for (const i of changed) await http.post(`/api/review/${i.id}`, { action: 'keep' }).catch(() => {});
    void refreshReview();
    toast.success('Marked all as reviewed.');
  };

  return (
    <div className="flex h-full flex-col">
      <div className="flex items-center gap-2 border-b border-line px-4 py-3">
        <Inbox size={16} className="text-muted" />
        <h2 className="text-[15px] font-semibold">Review</h2>
        {current && (
          <div className="ml-2 flex rounded-lg bg-surface-2 p-0.5 text-[12px]">
            {(['this', 'all'] as const).map((s) => (
              <button key={s} onClick={() => setScope(s)} className={cx('rounded-md px-2 py-0.5', scope === s ? 'bg-surface shadow-sm font-medium' : 'text-muted')}>
                {s === 'this' ? 'This roadmap' : 'All roadmaps'}
              </button>
            ))}
          </div>
        )}
        <div className="ml-auto flex items-center gap-1">
          {current && (
            <Button size="sm" onClick={() => setState({ dialog: 'paste' })}>
              <ClipboardPaste size={13} /> Paste proposal
            </Button>
          )}
          <IconButton size="sm" label="Close" onClick={() => setState({ reviewOpen: false })}>
            <X size={15} />
          </IconButton>
        </div>
      </div>
      <div className="wm-scroll min-h-0 flex-1 px-4 py-3">
        {empty && (
          <div className="mx-auto max-w-sm py-12 text-center">
            <div className="text-[14px] font-semibold">Nothing to review</div>
            <p className="mt-1 text-[13px] leading-relaxed text-muted">
              When an agent edits your files, its changes show up here. You can keep or revert them. Changes to your notes, progress or approved content wait here for your decision.
            </p>
          </div>
        )}
        {proposals.length > 0 && (
          <Group title="Proposals" hint="Suggested changes. Nothing is applied until you choose.">
            {proposals.map((p) => (
              <ProposalCard key={p.roadmapId + p.file} p={p} roadmapTitle={scope === 'all' ? title(p.roadmapId) : undefined} />
            ))}
          </Group>
        )}
        {held.length > 0 && (
          <Group title="Held for your decision" hint="These outside edits were NOT applied. The files still show your version.">
            {held.map((i) => (
              <ItemCard key={i.id} item={i} roadmapTitle={scope === 'all' ? title(i.roadmapId) : undefined} />
            ))}
          </Group>
        )}
        {changed.length > 0 && (
          <Group
            title="Applied, not reviewed yet"
            hint="Outside edits already in your files. Keep them or revert."
            action={
              <Button size="sm" variant="ghost" onClick={() => void keepAll()}>
                <Check size={13} /> Keep all
              </Button>
            }
          >
            {changed.map((i) => (
              <ItemCard key={i.id} item={i} roadmapTitle={scope === 'all' ? title(i.roadmapId) : undefined} />
            ))}
          </Group>
        )}
      </div>
    </div>
  );
}

function Group({ title, hint, action, children }: { title: string; hint: string; action?: ReactNode; children: ReactNode }) {
  return (
    <section className="mb-6">
      <div className="mb-2 flex items-end gap-2">
        <div>
          <h3 className="text-[13px] font-semibold">{title}</h3>
          <p className="text-[12px] text-muted">{hint}</p>
        </div>
        <div className="ml-auto">{action}</div>
      </div>
      <div className="grid gap-2">{children}</div>
    </section>
  );
}

function goTo(roadmapId: string, cpId: string) {
  if (getState().roadmap?.meta.id !== roadmapId) navigate({ page: 'roadmap', id: roadmapId, cp: cpId === '_roadmap' ? undefined : cpId });
  else if (cpId !== '_roadmap') selectCheckpoint(cpId, { center: true });
}

async function act(item: ReviewItem, action: 'keep' | 'revert' | 'apply' | 'discard', fields?: FieldPath[]) {
  try {
    const res = await http.post<{ skipped?: string[] }>(`/api/review/${item.id}`, { action, fields });
    if (res?.skipped?.length) toast(`Some fields changed again since then and were left as they are: ${res.skipped.map((f) => fieldLabel(f as FieldPath)).join(', ')}`);
  } catch (e) {
    toast.error((e as Error).message);
  }
  void refreshReview();
}

function ItemCard({ item, roadmapTitle }: { item: ReviewItem; roadmapTitle?: string }) {
  const heldItem = item.kind === 'held' || item.kind === 'held-delete';
  const kindLabel: Record<ReviewItem['kind'], ReactNode> = {
    changed: (
      <>
        <Bot size={12} /> Edited outside
      </>
    ),
    created: (
      <>
        <FilePlus size={12} /> New checkpoint
      </>
    ),
    deleted: (
      <>
        <FileX size={12} /> Deleted (in Trash)
      </>
    ),
    held: (
      <>
        <Pause size={12} /> Held
      </>
    ),
    'held-delete': (
      <>
        <Pause size={12} /> Deletion held
      </>
    ),
  };
  return (
    <article className={cx('rounded-xl border bg-surface p-3', heldItem ? 'border-review/40' : 'border-line')}>
      <div className="flex items-start gap-2">
        <div className="min-w-0 flex-1">
          <button className="max-w-full truncate text-left text-[13.5px] font-semibold hover:text-accent" onClick={() => goTo(item.roadmapId, item.checkpointId)}>
            {item.checkpointId === '_roadmap' ? `Roadmap: ${item.title}` : item.title}
          </button>
          <div className="mt-0.5 flex flex-wrap items-center gap-1.5 text-[11.5px] text-faint">
            <Chip tone={heldItem ? 'warn' : 'accent'}>{kindLabel[item.kind]}</Chip>
            {item.stale && <Chip tone="warn">based on an older version</Chip>}
            {roadmapTitle && <span>{roadmapTitle}</span>}
            <span>{relTime(item.updatedAt)}</span>
          </div>
        </div>
        <div className="flex flex-none gap-1">
          {item.kind === 'held-delete' ? (
            <>
              <Button size="sm" onClick={() => void act(item, 'discard')}>
                Keep it
              </Button>
              <Button size="sm" variant="danger" onClick={() => void act(item, 'apply')}>
                Delete
              </Button>
            </>
          ) : heldItem ? (
            <>
              <Button size="sm" variant="ghost" onClick={() => void act(item, 'discard')}>
                Discard
              </Button>
              <Button size="sm" onClick={() => void act(item, 'apply')}>
                Apply
              </Button>
            </>
          ) : (
            <>
              <Button size="sm" variant="ghost" onClick={() => void act(item, 'revert')}>
                <Undo2 size={13} /> {item.kind === 'created' ? 'Remove' : item.kind === 'deleted' ? 'Restore' : 'Revert'}
              </Button>
              <Button size="sm" onClick={() => void act(item, 'keep')}>
                <Check size={13} /> Keep
              </Button>
            </>
          )}
        </div>
      </div>
      {item.kind === 'held-delete' && <p className="mt-2 text-[12.5px] text-muted">An outside tool deleted this file. It contains your work or sub-checkpoints, so Waymark put it back.</p>}
      {item.changes.length > 0 && (
        <ul className="mt-2 grid gap-2">
          {item.changes.map((c) => (
            <li key={c.field} className="rounded-lg bg-surface-2/60 p-2">
              <div className="mb-1 flex items-center gap-2 text-[12px]">
                <span className="font-medium">{fieldLabel(c.field)}</span>
                {c.reason && <span className="text-review">{HOLD_REASON_TEXT[c.reason]}</span>}
                {item.changes.length > 1 && (
                  <span className="ml-auto flex gap-1">
                    {heldItem ? (
                      <>
                        <button className="rounded px-1.5 text-faint hover:bg-surface-3 hover:text-fg" onClick={() => void act(item, 'discard', [c.field])}>
                          discard
                        </button>
                        <button className="rounded px-1.5 text-accent hover:bg-surface-3" onClick={() => void act(item, 'apply', [c.field])}>
                          apply
                        </button>
                      </>
                    ) : (
                      <>
                        <button className="rounded px-1.5 text-faint hover:bg-surface-3 hover:text-fg" onClick={() => void act(item, 'revert', [c.field])}>
                          revert
                        </button>
                        <button className="rounded px-1.5 text-accent hover:bg-surface-3" onClick={() => void act(item, 'keep', [c.field])}>
                          keep
                        </button>
                      </>
                    )}
                  </span>
                )}
              </div>
              <ValueDiff before={c.before} after={c.after} />
            </li>
          ))}
        </ul>
      )}
    </article>
  );
}

function fmt(v: unknown): string {
  if (v === null || v === undefined || v === '') return '';
  if (typeof v === 'string') return v;
  if (typeof v === 'boolean') return v ? 'yes' : 'no';
  if (Array.isArray(v)) {
    if (v.length && typeof v[0] === 'object') return (v as Resource[]).map((r) => `• ${r.title}${r.start ? ` (${r.start})` : ''} ${r.url}`).join('\n');
    return v.join(', ');
  }
  return JSON.stringify(v);
}

export function ValueDiff({ before, after }: { before: unknown; after: unknown }) {
  const a = fmt(before);
  const b = fmt(after);
  const parts = useMemo(() => (a.length + b.length < 20000 ? diffWords(a, b) : null), [a, b]);
  if (!a) return <div className="whitespace-pre-wrap text-[12.5px] leading-relaxed"><span className="diff-ins">{b || '(empty)'}</span></div>;
  if (!b) return <div className="whitespace-pre-wrap text-[12.5px] leading-relaxed"><span className="diff-del">{a}</span> <span className="text-faint">(removed)</span></div>;
  if (!parts) return <div className="text-[12.5px] text-muted">Large change ({a.length} → {b.length} characters)</div>;
  if (a.length < 48 && b.length < 48 && !a.includes('\n') && !b.includes('\n')) {
    return (
      <div className="text-[12.5px] leading-relaxed">
        <span className="diff-del">{a}</span> <span className="text-faint">→</span> <span className="diff-ins">{b}</span>
      </div>
    );
  }
  return (
    <div className="max-h-56 overflow-y-auto whitespace-pre-wrap text-[12.5px] leading-relaxed">
      {parts.map((p, i) => (
        <span key={i} className={p.added ? 'diff-ins' : p.removed ? 'diff-del' : undefined}>
          {p.value}
        </span>
      ))}
    </div>
  );
}

function ProposalCard({ p, roadmapTitle }: { p: ProposalView; roadmapTitle?: string }) {
  // Risky changes (deleting your work, touching your fields) start unticked: you opt in.
  const [selected, setSelected] = useState<Set<number>>(() => new Set(p.previews.filter((x) => x.valid && !x.risky).map((x) => x.index)));
  const [busy, setBusy] = useState(false);
  const [confirmReject, setConfirmReject] = useState(false);
  const toggle = (i: number) =>
    setSelected((prev) => {
      const s = new Set(prev);
      if (s.has(i)) s.delete(i);
      else s.add(i);
      return s;
    });
  const apply = async () => {
    setBusy(true);
    try {
      const res = await http.post<{ results: { ok: boolean; error?: string }[] }>(`/api/roadmaps/${p.roadmapId}/proposals/${encodeURIComponent(p.name)}/apply`, { indexes: [...selected] });
      const failed = res.results.filter((r) => !r.ok);
      if (failed.length) toast.error(`${failed.length} change(s) could not be applied: ${failed.map((f) => f.error).join('; ')}`);
      else toast.success(`Applied ${selected.size} change(s). You can undo them from History.`);
    } catch (e) {
      toast.error((e as Error).message);
    }
    setBusy(false);
    void refreshReview();
  };
  const reject = async () => {
    await http.post(`/api/roadmaps/${p.roadmapId}/proposals/${encodeURIComponent(p.name)}/reject`).catch((e) => toast.error((e as Error).message));
    void refreshReview();
  };
  const cs = p.changeset;
  return (
    <article className="rounded-xl border border-accent/30 bg-surface p-3">
      <div className="flex items-start gap-2">
        <div className="min-w-0 flex-1">
          <div className="text-[13.5px] font-semibold">{cs?.title ?? p.name}</div>
          <div className="mt-0.5 flex flex-wrap gap-1.5 text-[11.5px] text-faint">
            <Chip tone="accent">
              <Bot size={12} /> {cs?.author ?? 'agent'}
            </Chip>
            <span className="font-mono">{p.file}</span>
            {roadmapTitle && <span>{roadmapTitle}</span>}
          </div>
        </div>
      </div>
      {p.error && <div className="mt-2 rounded-lg bg-danger-soft p-2 text-[12.5px] text-danger">This proposal can't be read: {p.error}. Ask the agent to fix the file, or reject it.</div>}
      {cs?.summary && <p className="mt-2 text-[12.5px] leading-relaxed text-muted">{cs.summary}</p>}
      {p.previews.length > 0 && (
        <ul className="mt-2 grid gap-1.5">
          {p.previews.map((c) => (
            <ChangeRow key={c.index} c={c} checked={selected.has(c.index)} onToggle={() => toggle(c.index)} />
          ))}
        </ul>
      )}
      {cs && cs.invalid.length > 0 && (
        <div className="mt-2 rounded-lg bg-warn-soft p-2 text-[12px] text-review">
          {cs.invalid.length} change(s) were not understood and will be skipped: {cs.invalid.map((i) => `#${i.index + 1} ${i.message}`).join('; ')}
        </div>
      )}
      <div className="mt-3 flex items-center gap-2">
        <span className="text-[12px] text-muted">
          {selected.size} of {p.previews.length} selected
        </span>
        <Button size="sm" variant="ghost" className="ml-auto" onClick={() => setConfirmReject(true)}>
          Reject
        </Button>
        <Button size="sm" variant="primary" disabled={busy || !selected.size} onClick={() => void apply()}>
          Apply selected
        </Button>
      </div>
      <Modal
        open={confirmReject}
        onOpenChange={setConfirmReject}
        title="Reject this proposal?"
        description="Nothing in it will be applied. The file moves to the archive (.waymark/archive)."
        footer={
          <>
            <Button variant="ghost" onClick={() => setConfirmReject(false)}>
              Cancel
            </Button>
            <Button
              variant="danger"
              onClick={() => {
                setConfirmReject(false);
                void reject();
              }}
            >
              Reject
            </Button>
          </>
        }
      />
    </article>
  );
}

const OP_TONE: Record<string, 'accent' | 'done' | 'warn' | 'danger' | 'neutral'> = { add: 'done', update: 'accent', move: 'warn', delete: 'danger', link: 'neutral', unlink: 'neutral' };

function ChangeRow({ c, checked, onToggle }: { c: ChangePreview; checked: boolean; onToggle: () => void }) {
  const [open, setOpen] = useState(false);
  const hasDetails = (c.changes?.length ?? 0) > 0;
  return (
    <li className={cx('rounded-lg border p-2', checked ? 'border-line bg-surface-2/50' : 'border-transparent opacity-70')}>
      <div className="flex items-start gap-2">
        <input type="checkbox" checked={checked} disabled={!c.valid} onChange={onToggle} className="mt-1 size-4 accent-[var(--accent)]" aria-label={`Include change ${c.index + 1}`} />
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-1.5">
            <Chip tone={OP_TONE[c.op] ?? 'neutral'}>{c.op}</Chip>
            <span className="text-[13px] font-medium">{c.title}</span>
          </div>
          <div className="text-[12px] text-muted">{c.detail}</div>
          {c.warnings.map((w, i) => (
            <div key={i} className="text-[12px] text-review">
              {w}
            </div>
          ))}
          {hasDetails && (
            <button className="mt-1 flex items-center gap-1 text-[12px] text-accent" onClick={() => setOpen(!open)}>
              <ChevronRight size={12} className={cx('transition-transform', open && 'rotate-90')} /> {open ? 'Hide' : 'Show'} changes
            </button>
          )}
          {open && (
            <ul className="mt-1.5 grid gap-1.5">
              {c.changes!.map((ch) => (
                <li key={ch.field}>
                  <div className="text-[11.5px] font-medium text-muted">
                    {fieldLabel(ch.field)} {ch.yours && <span className="text-review">(normally yours)</span>}
                  </div>
                  <ValueDiff before={ch.before} after={ch.after} />
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>
    </li>
  );
}

export function PasteProposalDialog() {
  const open = useStore((s) => s.dialog === 'paste');
  const rm = useStore((s) => s.roadmap);
  const [text, setText] = useState('');
  const [error, setError] = useState<string | null>(null);
  const submitPaste = async () => {
    if (!rm) return;
    setError(null);
    try {
      await http.post(`/api/roadmaps/${rm.meta.id}/proposals`, { text });
      setText('');
      setState({ dialog: null, reviewOpen: true });
      void refreshReview();
      toast.success('Proposal added. Review it below.');
    } catch (e) {
      setError((e as Error).message);
    }
  };
  return (
    <Modal
      open={open}
      onOpenChange={(o) => setState({ dialog: o ? 'paste' : null })}
      title="Paste a proposal"
      description="Paste the YAML or JSON changeset from an agent's reply. Code fences are fine. You'll preview every change before anything is applied."
      wide
      footer={
        <>
          <Button variant="ghost" onClick={() => setState({ dialog: null })}>
            Cancel
          </Button>
          <Button variant="primary" disabled={!text.trim()} onClick={() => void submitPaste()}>
            Preview changes
          </Button>
        </>
      }
    >
      <textarea
        autoFocus
        value={text}
        onChange={(e) => setText(e.target.value)}
        placeholder={'```yaml\nschema: waymark-changeset/1\ntitle: …\nchanges:\n  - op: add\n    …\n```'}
        className="h-72 w-full resize-y rounded-lg border border-line bg-surface-2 p-3 font-mono text-[12.5px] outline-none focus:border-accent"
      />
      {error && <div className="mt-2 rounded-lg bg-danger-soft p-2 text-[12.5px] text-danger">{error}</div>}
    </Modal>
  );
}
