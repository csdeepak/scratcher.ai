import { useEffect, useState } from 'react';
import { toast } from 'sonner';
import { Bot, Copy, FolderOpen, Terminal, Trash } from 'lucide-react';
import { PROFILES } from '../../shared/profiles';
import { http } from '../api';
import { getState, navigate, refreshSummaries, setState, useStore } from '../store';
import { Button, Chip, Kbd, Modal, cx, relTime } from './ui';

const input = 'h-9 w-full rounded-lg border border-line bg-surface px-3 text-[13.5px] outline-none focus:border-accent';
const label = 'mb-1 block text-[12.5px] font-medium';

export function Dialogs() {
  return (
    <>
      <NewRoadmapDialog />
      <SettingsDialog />
      <TrashDialog />
      <AgentDialog />
      <ShortcutsDialog />
      <TemplateDialog />
    </>
  );
}

const close = () => setState({ dialog: null });

function NewRoadmapDialog() {
  const open = useStore((s) => s.dialog === 'new');
  const [title, setTitle] = useState('');
  const [profile, setProfile] = useState<'general' | 'learning'>('learning');
  const [description, setDescription] = useState('');
  const [template, setTemplate] = useState('');
  const [templates, setTemplates] = useState<{ file: string; title: string; profile: string; count: number; description: string }[]>([]);
  useEffect(() => {
    if (open) void http.get<typeof templates>('/api/templates').then(setTemplates).catch(() => {});
  }, [open]);
  const create = async () => {
    if (!title.trim()) return;
    try {
      const rm = await http.post<{ meta: { id: string } }>('/api/roadmaps', { title, profile, description, template: template || undefined });
      close();
      setTitle('');
      setDescription('');
      setTemplate('');
      navigate({ page: 'roadmap', id: rm.meta.id });
    } catch (e) {
      toast.error((e as Error).message);
    }
  };
  return (
    <Modal
      open={open}
      onOpenChange={(o) => setState({ dialog: o ? 'new' : null })}
      title="New roadmap"
      description="Name the goal. You can add checkpoints yourself or let an agent draft them."
      footer={
        <>
          <Button variant="ghost" onClick={close}>
            Cancel
          </Button>
          <Button variant="primary" disabled={!title.trim()} onClick={() => void create()}>
            Create roadmap
          </Button>
        </>
      }
    >
      <form
        className="grid gap-4"
        onSubmit={(e) => {
          e.preventDefault();
          void create();
        }}
      >
        <div>
          <label className={label} htmlFor="nr-title">
            Goal or project
          </label>
          <input id="nr-title" autoFocus className={input} value={title} onChange={(e) => setTitle(e.target.value)} placeholder="e.g. Learn linear algebra, Build my portfolio site" />
        </div>
        <div>
          <label className={label} htmlFor="nr-desc">
            One-line description <span className="font-normal text-faint">(optional)</span>
          </label>
          <input id="nr-desc" className={input} value={description} onChange={(e) => setDescription(e.target.value)} />
        </div>
        <fieldset>
          <legend className={label}>Kind</legend>
          <div className="grid gap-2 sm:grid-cols-2">
            {(['learning', 'general'] as const).map((k) => (
              <label key={k} className={cx('cursor-pointer rounded-xl border p-3 text-[12.5px]', profile === k ? 'border-accent bg-accent-soft' : 'border-line hover:bg-surface-2')}>
                <input type="radio" name="profile" className="sr-only" checked={profile === k} onChange={() => setProfile(k)} />
                <div className="text-[13px] font-semibold">{PROFILES[k].label}</div>
                <div className="mt-0.5 leading-relaxed text-muted">{PROFILES[k].description}</div>
              </label>
            ))}
          </div>
        </fieldset>
        {templates.length > 0 && (
          <div>
            <label className={label} htmlFor="nr-tpl">
              Start from a template <span className="font-normal text-faint">(optional)</span>
            </label>
            <select id="nr-tpl" className={input} value={template} onChange={(e) => setTemplate(e.target.value)}>
              <option value="">Blank</option>
              {templates.map((t) => (
                <option key={t.file} value={t.file}>
                  {t.title} · {t.count} checkpoints
                </option>
              ))}
            </select>
          </div>
        )}
        <button type="submit" className="hidden" />
      </form>
    </Modal>
  );
}

function SettingsDialog() {
  const open = useStore((s) => s.dialog === 'settings');
  const rm = useStore((s) => s.roadmap);
  const [form, setForm] = useState({ title: '', description: '', profile: 'general', agentAccess: 'review' });
  const [confirm, setConfirm] = useState(false);
  useEffect(() => {
    if (open && rm) setForm({ title: rm.meta.title, description: rm.meta.description, profile: rm.meta.profile, agentAccess: rm.meta.agentAccess });
  }, [open, rm]);
  if (!rm) return null;
  const save = async () => {
    try {
      await http.patch(`/api/roadmaps/${rm.meta.id}`, form);
      close();
    } catch (e) {
      toast.error((e as Error).message);
    }
  };
  const del = async () => {
    try {
      await http.del(`/api/roadmaps/${rm.meta.id}`);
      setConfirm(false);
      close();
      navigate({ page: 'home' });
      toast('Roadmap moved to Trash. Restore it from the menu → Trash.');
    } catch (e) {
      toast.error((e as Error).message);
    }
  };
  return (
    <Modal
      open={open}
      onOpenChange={(o) => setState({ dialog: o ? 'settings' : null })}
      title="Roadmap settings"
      footer={
        <>
          <Button variant="ghost" className="mr-auto !text-danger" onClick={() => setConfirm(true)}>
            <Trash size={14} /> Delete roadmap
          </Button>
          <Button variant="ghost" onClick={close}>
            Cancel
          </Button>
          <Button variant="primary" onClick={() => void save()}>
            Save
          </Button>
        </>
      }
    >
      <div className="grid gap-4">
        <div>
          <label className={label} htmlFor="st-title">
            Title
          </label>
          <input id="st-title" className={input} value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} />
        </div>
        <div>
          <label className={label} htmlFor="st-desc">
            Description
          </label>
          <input id="st-desc" className={input} value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} />
        </div>
        <div>
          <label className={label} htmlFor="st-profile">
            Profile
          </label>
          <select id="st-profile" className={input} value={form.profile} onChange={(e) => setForm({ ...form, profile: e.target.value })}>
            <option value="general">General: content, notes, takeaways, questions</option>
            <option value="learning">Learning: adds objectives, practice, evidence, understanding</option>
          </select>
          <p className="mt-1 text-[12px] text-muted">Switching keeps all existing text. Sections that the new profile doesn't use stay visible where they have content.</p>
        </div>
        <div>
          <label className={label} htmlFor="st-access">
            Agent edits by default
          </label>
          <select id="st-access" className={input} value={form.agentAccess} onChange={(e) => setForm({ ...form, agentAccess: e.target.value })}>
            <option value="review">Review: edits apply and are listed in Review (recommended)</option>
            <option value="direct">Direct: edits apply without review</option>
          </select>
          <p className="mt-1 text-[12px] text-muted">Your notes, progress and approved content are always protected. You can override this per branch from a checkpoint's ⋯ menu.</p>
        </div>
        <div className="rounded-lg bg-surface-2 p-3 text-[12px] text-muted">
          Folder: <code className="font-mono">roadmaps/{rm.slug}</code> · id <code className="font-mono">{rm.meta.id}</code>
        </div>
      </div>
      <Modal
        open={confirm}
        onOpenChange={setConfirm}
        title={`Delete “${rm.meta.title}”?`}
        description="The whole roadmap folder moves to Trash. You can restore it from the menu → Trash."
        footer={
          <>
            <Button variant="ghost" onClick={() => setConfirm(false)}>
              Cancel
            </Button>
            <Button variant="danger" onClick={() => void del()}>
              Delete roadmap
            </Button>
          </>
        }
      />
    </Modal>
  );
}

interface TrashRow {
  id: string;
  roadmapId: string;
  roadmapTitle: string;
  deletedAt: string;
  title: string;
  count: number;
  roadmapDir?: string;
}

function TrashDialog() {
  const open = useStore((s) => s.dialog === 'trash');
  const [rows, setRows] = useState<TrashRow[] | null>(null);
  const [purge, setPurge] = useState<TrashRow | null>(null);
  const load = () => void http.get<TrashRow[]>('/api/trash').then(setRows).catch((e) => toast.error(e.message));
  useEffect(() => {
    if (open) load();
  }, [open]);
  const restore = async (r: TrashRow) => {
    try {
      const res = await http.post<{ roadmapId: string }>(`/api/trash/${r.id}/restore`);
      toast.success(`Restored “${r.title}”`);
      load();
      void refreshSummaries();
      if (r.roadmapDir) navigate({ page: 'roadmap', id: res.roadmapId });
    } catch (e) {
      toast.error((e as Error).message);
    }
  };
  return (
    <Modal open={open} onOpenChange={(o) => setState({ dialog: o ? 'trash' : null })} title="Trash" description="Deleted checkpoints and roadmaps. Restoring puts them back where they were (or at the top level if the parent is gone)." wide>
      {rows === null ? (
        <div className="py-6 text-[13px] text-muted">Loading…</div>
      ) : rows.length === 0 ? (
        <div className="py-6 text-[13px] text-muted">Trash is empty.</div>
      ) : (
        <ul className="grid gap-1">
          {rows.map((r) => (
            <li key={r.id} className="flex items-center gap-3 rounded-lg px-2 py-2 hover:bg-surface-2">
              <div className="min-w-0 flex-1">
                <div className="truncate text-[13px] font-medium">
                  {r.title} {r.roadmapDir ? <Chip>roadmap</Chip> : r.count > 1 ? <Chip>{r.count} checkpoints</Chip> : null}
                </div>
                <div className="text-[12px] text-faint">
                  {r.roadmapDir ? 'Whole roadmap' : r.roadmapTitle} · deleted {relTime(r.deletedAt)}
                </div>
              </div>
              <Button size="sm" onClick={() => void restore(r)}>
                Restore
              </Button>
              <Button size="sm" variant="ghost" onClick={() => setPurge(r)}>
                Delete forever
              </Button>
            </li>
          ))}
        </ul>
      )}
      <Modal
        open={!!purge}
        onOpenChange={(o) => !o && setPurge(null)}
        title="Delete forever?"
        description={`“${purge?.title}” will be permanently removed from Trash. Its earlier versions remain in the history log, but it can't be restored from Trash.`}
        footer={
          <>
            <Button variant="ghost" onClick={() => setPurge(null)}>
              Cancel
            </Button>
            <Button
              variant="danger"
              onClick={async () => {
                if (!purge) return;
                await http.del(`/api/trash/${purge.id}`).catch((e) => toast.error(e.message));
                setPurge(null);
                load();
              }}
            >
              Delete forever
            </Button>
          </>
        }
      />
    </Modal>
  );
}

function AgentDialog() {
  const open = useStore((s) => s.dialog === 'agent');
  const rm = useStore((s) => s.roadmap);
  const selectedId = useStore((s) => s.selectedId);
  const workspace = useStore((s) => s.workspace);
  const [tab, setTab] = useState<'files' | 'chat'>('files');
  const [request, setRequest] = useState('');
  const [scope, setScope] = useState<'section' | 'roadmap'>('section');
  const sel = selectedId && rm ? rm.checkpoints[selectedId] : null;
  useEffect(() => {
    if (open) setScope(sel ? 'section' : 'roadmap');
  }, [open, sel]);

  const example = sel
    ? `Read AGENTS.md. In the roadmap "${rm?.meta.title}", expand the checkpoint "${sel.title}" (${sel.id}) into 3-6 sub-checkpoints with short explanations and a few good resources. Don't change anything else.`
    : rm
      ? `Read AGENTS.md. Draft the main checkpoints for the roadmap "${rm.meta.title}" (roadmaps/${rm.slug}). Keep it to 5-8 main checkpoints with a summary each; no sub-checkpoints yet.`
      : 'Read AGENTS.md, then create a new roadmap for my goal: …';

  const copyBrief = async () => {
    if (!rm) return;
    try {
      const res = await http.post<{ text: string }>(`/api/roadmaps/${rm.meta.id}/brief`, { checkpointId: scope === 'section' ? selectedId : null, request });
      await navigator.clipboard.writeText(res.text);
      toast.success('Brief copied. Paste it into your chat, then paste the reply in Review → Paste proposal.');
    } catch (e) {
      toast.error((e as Error).message);
    }
  };

  return (
    <Modal open={open} onOpenChange={(o) => setState({ dialog: o ? 'agent' : null })} title="Work with an agent" description="Waymark has no built-in AI. Any agent you already use can draft and edit your roadmap. Pick how it can reach your files." wide>
      <div className="mb-4 flex rounded-lg bg-surface-2 p-0.5 text-[12.5px]">
        {[
          ['files', 'Agent with file access (recommended)'],
          ['chat', 'Chat without file access'],
        ].map(([k, l]) => (
          <button key={k} onClick={() => setTab(k as 'files' | 'chat')} className={cx('flex-1 rounded-md px-3 py-1.5', tab === k ? 'bg-surface font-medium shadow-sm' : 'text-muted')}>
            {l}
          </button>
        ))}
      </div>
      {tab === 'files' ? (
        <div className="grid gap-4 text-[13px] leading-relaxed">
          <p className="text-muted">The agent edits the Markdown files in your workspace. Waymark shows each change within a second and lists it in Review. It never lets an agent change your notes, progress or approved content without your OK.</p>
          <div className="rounded-xl border border-line p-3">
            <div className="mb-1.5 flex items-center gap-2 text-[12.5px] font-semibold">
              <FolderOpen size={14} /> Your workspace folder
            </div>
            <div className="flex items-center gap-2">
              <code className="min-w-0 flex-1 truncate rounded-md bg-surface-2 px-2 py-1 font-mono text-[12px]">{workspace}</code>
              <Button size="sm" onClick={() => void navigator.clipboard.writeText(workspace).then(() => toast.success('Path copied'))}>
                <Copy size={13} /> Copy
              </Button>
            </div>
          </div>
          <ul className="grid gap-2.5">
            <li>
              <b>Claude Code</b> (terminal, or the Claude desktop app's Code tab): open the workspace folder. It reads <code className="font-mono text-[12px]">CLAUDE.md</code>, which loads <code className="font-mono text-[12px]">AGENTS.md</code>, automatically.
            </li>
            <li>
              <b>Claude desktop app (chat)</b>: turn on a filesystem connector or extension and allow the workspace folder. A subscription on its own doesn't give Claude access to your files.
            </li>
            <li>
              <b>Codex CLI, Cursor, VS Code agents, Gemini CLI</b>: open the workspace folder and tell the agent to read <code className="font-mono text-[12px]">AGENTS.md</code> first.
            </li>
          </ul>
          <div>
            <div className="mb-1 flex items-center gap-1.5 text-[12.5px] font-semibold">
              <Terminal size={14} /> Something to ask
            </div>
            <div className="flex items-start gap-2">
              <p className="min-w-0 flex-1 rounded-lg bg-surface-2 p-2.5 text-[12.5px]">{example}</p>
              <Button size="sm" onClick={() => void navigator.clipboard.writeText(example).then(() => toast.success('Copied'))}>
                <Copy size={13} />
              </Button>
            </div>
          </div>
        </div>
      ) : (
        <div className="grid gap-3 text-[13px] leading-relaxed">
          <p className="text-muted">
            For ChatGPT or Claude on the web (no file access): copy a brief with the context and format, paste it into the chat, then paste the reply into <b>Review → Paste proposal</b>. You preview every change before anything is applied.
          </p>
          {rm ? (
            <>
              {sel && (
                <div className="flex gap-2 text-[12.5px]">
                  {(['section', 'roadmap'] as const).map((s) => (
                    <label key={s} className={cx('flex cursor-pointer items-center gap-1.5 rounded-lg border px-2.5 py-1.5', scope === s ? 'border-accent bg-accent-soft' : 'border-line')}>
                      <input type="radio" className="accent-[var(--accent)]" checked={scope === s} onChange={() => setScope(s)} />
                      {s === 'section' ? `“${sel.title}” and below` : 'Whole roadmap outline'}
                    </label>
                  ))}
                </div>
              )}
              <div>
                <label className={label} htmlFor="ag-req">
                  What should the agent do?
                </label>
                <textarea id="ag-req" rows={3} className="w-full rounded-lg border border-line bg-surface px-3 py-2 text-[13px] outline-none focus:border-accent" value={request} onChange={(e) => setRequest(e.target.value)} placeholder={sel ? `Expand “${sel.title}” into sub-checkpoints with explanations and resources.` : 'Draft the main checkpoints.'} />
              </div>
              <div className="flex gap-2">
                <Button variant="primary" onClick={() => void copyBrief()}>
                  <Copy size={14} /> Copy brief for AI
                </Button>
                <Button onClick={() => setState({ dialog: 'paste' })}>Paste the reply…</Button>
              </div>
            </>
          ) : (
            <p className="text-muted">Open a roadmap first.</p>
          )}
        </div>
      )}
      <div className="mt-4 flex items-center gap-2 border-t border-line pt-3 text-[12px] text-muted">
        <Bot size={13} /> Generated content stays a <Chip>draft</Chip> until you approve it, and never changes your status or understanding.
      </div>
    </Modal>
  );
}

function ShortcutsDialog() {
  const open = useStore((s) => s.dialog === 'shortcuts');
  const rows: [string, string][] = [
    ['Ctrl K', 'Search and commands'],
    ['↑ ↓', 'Previous / next checkpoint'],
    ['← →', 'Collapse or go to parent / expand or go to first child'],
    ['Enter', 'Edit the title'],
    ['Space', 'Expand or collapse'],
    ['A', 'Add sub-checkpoint'],
    ['N', 'Add checkpoint after this one'],
    ['Tab / Shift Tab', 'Indent / outdent'],
    ['Alt ↑ / Alt ↓', 'Move up / down'],
    ['F', 'Focus on this branch'],
    ['O', 'Overview (show everything)'],
    ['R', 'Open Review'],
    ['Delete', 'Delete (with Undo)'],
    ['Ctrl Z', 'Undo'],
    ['Esc', 'Close panel / clear selection'],
    ['?', 'This list'],
  ];
  return (
    <Modal open={open} onOpenChange={(o) => setState({ dialog: o ? 'shortcuts' : null })} title="Keyboard shortcuts" description="These work on the map and outline when you aren't typing in a field.">
      <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-2 text-[13px]">
        {rows.map(([k, v]) => (
          <div key={k} className="contents">
            <dt className="flex gap-1">
              {k.split(' / ').map((part, i) => (
                <span key={i} className="flex gap-1">
                  {i > 0 && <span className="text-faint">/</span>}
                  {part.split(' ').map((p) => (
                    <Kbd key={p}>{p}</Kbd>
                  ))}
                </span>
              ))}
            </dt>
            <dd className="text-muted">{v}</dd>
          </div>
        ))}
      </dl>
    </Modal>
  );
}

function TemplateDialog() {
  const open = useStore((s) => s.dialog === 'template');
  const rm = useStore((s) => s.roadmap);
  const [name, setName] = useState('');
  useEffect(() => {
    if (open && rm) setName(`${rm.meta.title} (template)`);
  }, [open, rm]);
  const save = async () => {
    const r = getState().roadmap;
    if (!r) return;
    try {
      const res = await http.post<{ file: string }>(`/api/roadmaps/${r.meta.id}/template`, { name });
      toast.success(`Saved as templates/${res.file}`);
      close();
    } catch (e) {
      toast.error((e as Error).message);
    }
  };
  return (
    <Modal
      open={open}
      onOpenChange={(o) => setState({ dialog: o ? 'template' : null })}
      title="Save as template"
      description="Keeps the structure: titles, hierarchy, prerequisites, resources and agent-written content. Leaves out your notes, takeaways, evidence, progress and approvals."
      footer={
        <>
          <Button variant="ghost" onClick={close}>
            Cancel
          </Button>
          <Button variant="primary" disabled={!name.trim()} onClick={() => void save()}>
            Save template
          </Button>
        </>
      }
    >
      <label className={label} htmlFor="tp-name">
        Template name
      </label>
      <input id="tp-name" autoFocus className={input} value={name} onChange={(e) => setName(e.target.value)} />
    </Modal>
  );
}
