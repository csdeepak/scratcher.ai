import { useEffect, useState } from 'react';
import { toast } from 'sonner';
import { Bot, Copy, FolderOpen, Terminal, Trash } from 'lucide-react';
import { PROFILES } from '../../shared/profiles';
import { http } from '../api';
import { getState, navigate, refreshLibrary, refreshSummaries, setState, useStore } from '../store';
import { roadmapColor, type RoadmapColor } from '../../shared/model';
import { ColorSwatches } from './Library';
import { AgentDialog } from './AgentDialog';
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
  const folders = useStore((s) => s.folders);
  const currentFolder = useStore((s) => s.currentFolder);
  const [folder, setFolder] = useState('');
  const [color, setColor] = useState<RoadmapColor | undefined>(undefined);
  const [templates, setTemplates] = useState<{ file: string; title: string; profile: string; count: number; description: string }[]>([]);
  useEffect(() => {
    if (open) {
      void http.get<typeof templates>('/api/templates').then(setTemplates).catch(() => {});
      setFolder(currentFolder ?? '');
    }
  }, [open, currentFolder]);
  const create = async () => {
    if (!title.trim()) return;
    try {
      const rm = await http.post<{ meta: { id: string } }>('/api/roadmaps', { title, profile, description, template: template || undefined, folder, color });
      await refreshLibrary();
      setColor(undefined);
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
        <div className="grid gap-4 sm:grid-cols-2">
          <div>
            <label className={label} htmlFor="nr-folder">
              Folder
            </label>
            <select id="nr-folder" className={input} value={folder} onChange={(e) => setFolder(e.target.value)}>
              <option value="">Top level</option>
              {folders.map((f) => (
                <option key={f} value={f}>
                  {f.split('/').join(' › ')}
                </option>
              ))}
            </select>
          </div>
          <div>
            <span className={label}>Colour</span>
            <ColorSwatches value={color} onPick={setColor} />
          </div>
        </div>
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
  const [color, setColor] = useState<RoadmapColor | undefined>(undefined);
  const [folder, setFolder] = useState('');
  const folders = useStore((s) => s.folders);
  const [confirm, setConfirm] = useState(false);
  useEffect(() => {
    if (open && rm) {
      setForm({ title: rm.meta.title, description: rm.meta.description, profile: rm.meta.profile, agentAccess: rm.meta.agentAccess });
      setColor(roadmapColor(rm.meta));
      setFolder(rm.folder);
    }
  }, [open, rm]);
  if (!rm) return null;
  const save = async () => {
    try {
      await http.patch(`/api/roadmaps/${rm.meta.id}`, { ...form, color });
      if (folder !== rm.folder) await http.post(`/api/roadmaps/${rm.meta.id}/move`, { folder });
      await refreshLibrary();
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
        <div className="grid gap-4 sm:grid-cols-2">
          <div>
            <label className={label} htmlFor="st-folder">
              Folder
            </label>
            <select id="st-folder" className={input} value={folder} onChange={(e) => setFolder(e.target.value)}>
              <option value="">Top level</option>
              {folders.map((f) => (
                <option key={f} value={f}>
                  {f.split('/').join(' › ')}
                </option>
              ))}
            </select>
          </div>
          <div>
            <span className={label}>Colour</span>
            <ColorSwatches value={color} onPick={setColor} />
          </div>
        </div>
        <div className="rounded-lg bg-surface-2 p-3 text-[12px] text-muted">
          Files: <code className="font-mono">roadmaps/{rm.slug}</code> · id <code className="font-mono">{rm.meta.id}</code>
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
  attachment?: { path: string };
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
                  {r.title} {r.roadmapDir ? <Chip>roadmap</Chip> : r.attachment ? <Chip>attached file</Chip> : r.count > 1 ? <Chip>{r.count} checkpoints</Chip> : null}
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

function ShortcutsDialog() {
  const open = useStore((s) => s.dialog === 'shortcuts');
  const rows: [string, string][] = [
    ['Ctrl K', 'Search and commands'],
    ['↑ ↓', 'Previous / next checkpoint'],
    ['← →', 'Collapse or go to parent / expand or go to first child'],
    ['Enter / F2', 'Rename on the map (or double-click it)'],
    ['Space', 'Expand or collapse'],
    ['A', 'Add sub-checkpoint'],
    ['N', 'Add checkpoint after this one'],
    ['Tab / Shift Tab', 'Indent / outdent'],
    ['Alt ↑ / Alt ↓', 'Move up / down'],
    ['F', 'Focus on this branch'],
    ['O', 'Overview (show everything)'],
    ['R', 'Open Review'],
    ['Delete', 'Delete what is selected: checkpoints, an arrow or sticky notes (with Undo)'],
    ['Ctrl Z', 'Undo'],
    ['Ctrl Y / Ctrl Shift Z', 'Redo'],
    ['Ctrl A', 'Select everything on the map'],
    ['Shift-drag / Ctrl-click', 'Select several on the map (box, or one at a time)'],
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
