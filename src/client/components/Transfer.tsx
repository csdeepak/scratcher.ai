// Export (PDF, web page, Markdown, map image, OPML, backup) and import (backup, Markdown, OPML).

import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { toast } from 'sonner';
import { Archive, FileCode, FileText, Globe, Image, ListTree, Printer, Upload } from 'lucide-react';
import { fromOutline, type OutlineItem } from '../../shared/outlineImport';
import { http } from '../api';
import { canCaptureMap, downloadMapImage } from '../mapExport';
import { navigate, refreshLibrary, setState, useStore } from '../store';
import { Button, Modal, cx } from './ui';

type Format = 'pdf' | 'html' | 'md' | 'png' | 'opml' | 'zip' | 'json';

const FORMATS: { key: Format; label: string; ext: string; icon: ReactNode; hint: string }[] = [
  { key: 'pdf', label: 'PDF document', ext: '.pdf', icon: <Printer size={16} />, hint: 'A clean, printable document. Opens a print view: choose “Save as PDF”.' },
  { key: 'html', label: 'Web page', ext: '.html', icon: <Globe size={16} />, hint: 'One file that opens in any browser, with links and a table of contents.' },
  { key: 'md', label: 'Markdown', ext: '.md', icon: <FileText size={16} />, hint: 'For Notion, Obsidian, GitHub, or pasting into an AI chat.' },
  { key: 'png', label: 'Map image', ext: '.png', icon: <Image size={16} />, hint: 'A picture of the whole map as it looks now.' },
  { key: 'opml', label: 'Outline (OPML)', ext: '.opml', icon: <ListTree size={16} />, hint: 'For mind-map and outliner apps such as XMind, MindNode or Workflowy.' },
  { key: 'zip', label: 'Full backup', ext: '.waymark.zip', icon: <Archive size={16} />, hint: 'Everything, including attached images and PDFs. Import it here or on another computer.' },
  { key: 'json', label: 'Data only', ext: '.waymark.json', icon: <FileCode size={16} />, hint: 'All checkpoints and notes as JSON, without attachments. Handy for scripts and agents.' },
];

async function downloadFrom(url: string, fallback: string) {
  const res = await fetch(url);
  if (!res.ok) throw new Error((await res.json().catch(() => null))?.error ?? 'Export failed.');
  const name = res.headers.get('content-disposition')?.match(/filename="([^"]+)"/)?.[1] ?? fallback;
  const blob = await res.blob();
  const href = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = href;
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(href), 1500);
}

export function ExportDialog() {
  const open = useStore((s) => s.dialog === 'export');
  const target = useStore((s) => s.exportTarget);
  const openRm = useStore((s) => s.roadmap);
  const selectedId = useStore((s) => s.selectedId);
  const summaries = useStore((s) => s.summaries);
  const id = target ?? openRm?.meta.id ?? null;
  const summary = summaries.find((s) => s.id === id);
  const isOpenOnMap = !!openRm && openRm.meta.id === id;
  const selected = isOpenOnMap && selectedId ? openRm!.checkpoints[selectedId] : null;
  const [format, setFormat] = useState<Format>('pdf');
  const [scope, setScope] = useState<'all' | 'branch'>('all');
  const [personal, setPersonal] = useState(true);
  const [archived, setArchived] = useState(false);
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    if (open) setScope(selected ? scope : 'all');
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  const usesOptions = format === 'pdf' || format === 'html' || format === 'md' || format === 'opml';
  const run = async () => {
    if (!id) return;
    const q = new URLSearchParams({ format });
    if (usesOptions && scope === 'branch' && selected) q.set('branch', selected.id);
    if (!personal) q.set('personal', '0');
    if (archived) q.set('archived', '1');
    const url = `/api/roadmaps/${encodeURIComponent(id)}/export?${q}`;
    setBusy(true);
    try {
      if (format === 'pdf') {
        const w = window.open(url, '_blank');
        if (!w) throw new Error('Your browser blocked the new tab. Allow pop-ups for this page, or export as a web page and print that.');
        toast('Print view opened. Choose “Save as PDF” as the printer.');
      } else if (format === 'png') {
        await downloadMapImage(`${summary?.slug.split('/').pop() ?? 'roadmap'}-map.png`);
      } else {
        if (format === 'html') q.set('download', '1');
        await downloadFrom(format === 'html' ? `/api/roadmaps/${encodeURIComponent(id)}/export?${q}` : url, `roadmap${FORMATS.find((f) => f.key === format)!.ext}`);
      }
      setState({ dialog: null, exportTarget: null });
    } catch (e) {
      toast.error((e as Error).message);
    }
    setBusy(false);
  };

  return (
    <Modal
      open={open}
      onOpenChange={(o) => setState({ dialog: o ? 'export' : null, ...(o ? {} : { exportTarget: null }) })}
      title={`Export “${summary?.title ?? 'roadmap'}”`}
      description="Everything is generated on this computer; nothing is uploaded."
      wide
      footer={
        <>
          <Button variant="ghost" onClick={() => setState({ dialog: null, exportTarget: null })}>
            Cancel
          </Button>
          <Button variant="primary" disabled={busy || !id || (format === 'png' && !(isOpenOnMap && canCaptureMap()))} onClick={() => void run()}>
            {busy ? 'Exporting…' : format === 'pdf' ? 'Open print view' : 'Export'}
          </Button>
        </>
      }
    >
      <div className="grid gap-2 sm:grid-cols-2" role="radiogroup" aria-label="Format">
        {FORMATS.map((f) => {
          const disabled = f.key === 'png' && !(isOpenOnMap && canCaptureMap());
          return (
            <button
              key={f.key}
              role="radio"
              aria-checked={format === f.key}
              disabled={disabled}
              onClick={() => setFormat(f.key)}
              className={cx('flex gap-3 rounded-lg border p-3 text-left disabled:opacity-45', format === f.key ? 'border-accent bg-accent-soft' : 'border-line hover:bg-surface-2')}
            >
              <span className="mt-0.5 text-muted">{f.icon}</span>
              <span>
                <span className="block text-[13px] font-semibold">
                  {f.label} <span className="font-normal text-faint">{f.ext}</span>
                </span>
                <span className="block text-[12px] leading-snug text-muted">{disabled ? 'Open this roadmap on the map to export its picture.' : f.hint}</span>
              </span>
            </button>
          );
        })}
      </div>
      {usesOptions && (
        <div className="mt-4 grid gap-2 rounded-lg bg-surface-2 p-3 text-[13px]">
          <div className="flex flex-wrap gap-2">
            <label className={cx('flex cursor-pointer items-center gap-1.5 rounded-md border px-2.5 py-1', scope === 'all' ? 'border-accent bg-surface' : 'border-line')}>
              <input type="radio" className="accent-[var(--accent)]" checked={scope === 'all'} onChange={() => setScope('all')} /> Whole roadmap
            </label>
            <label className={cx('flex items-center gap-1.5 rounded-md border px-2.5 py-1', selected ? 'cursor-pointer' : 'opacity-50', scope === 'branch' ? 'border-accent bg-surface' : 'border-line')}>
              <input type="radio" className="accent-[var(--accent)]" disabled={!selected} checked={scope === 'branch'} onChange={() => setScope('branch')} />
              {selected ? `Only “${selected.title}” and below` : 'Only the selected branch (select one first)'}
            </label>
          </div>
          <label className="flex items-center gap-2">
            <input type="checkbox" className="accent-[var(--accent)]" checked={personal} onChange={(e) => setPersonal(e.target.checked)} />
            Include my own notes, takeaways and evidence
          </label>
          <label className="flex items-center gap-2">
            <input type="checkbox" className="accent-[var(--accent)]" checked={archived} onChange={(e) => setArchived(e.target.checked)} />
            Include archived checkpoints
          </label>
        </div>
      )}
    </Modal>
  );
}

// ------------------------------------------------------------------ import

function parseOpml(text: string): { title?: string; items: OutlineItem[] } {
  const doc = new DOMParser().parseFromString(text, 'application/xml');
  if (doc.querySelector('parsererror')) throw new Error('This OPML file could not be read.');
  const walk = (el: Element): OutlineItem[] =>
    [...el.children]
      .filter((c) => c.tagName.toLowerCase() === 'outline')
      .map((o) => ({
        title: (o.getAttribute('text') ?? o.getAttribute('title') ?? 'Untitled').trim() || 'Untitled',
        content: o.getAttribute('_note')?.trim() || undefined,
        done: o.getAttribute('_complete') === 'true' || /^complete$/i.test(o.getAttribute('_status') ?? ''),
        children: walk(o),
      }));
  const body = doc.querySelector('body');
  return { title: doc.querySelector('head > title')?.textContent?.trim() || undefined, items: body ? walk(body) : [] };
}

export function ImportDialog() {
  const open = useStore((s) => s.dialog === 'import');
  const folders = useStore((s) => s.folders);
  const currentFolder = useStore((s) => s.currentFolder);
  const [tab, setTab] = useState<'file' | 'paste'>('file');
  const [folder, setFolder] = useState('');
  const [profile, setProfile] = useState<'learning' | 'general'>('learning');
  const [text, setText] = useState('');
  const [title, setTitle] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);
  useEffect(() => {
    if (open) {
      setFolder(currentFolder ?? '');
      setError(null);
    }
  }, [open, currentFolder]);

  const done = async (res: { roadmapId: string; warnings: string[]; count?: number }) => {
    await refreshLibrary();
    setState({ dialog: null, currentFolder: folder || null });
    navigate({ page: 'roadmap', id: res.roadmapId });
    toast.success(res.count ? `Imported ${res.count} checkpoints.` : 'Roadmap imported.');
    if (res.warnings.length) toast.warning(`${res.warnings.length} note(s) while importing`, { description: res.warnings.slice(0, 4).join(' · ') });
    setText('');
    setTitle('');
  };

  const importMarkdown = async (md: string, fallbackTitle?: string) =>
    done(await http.post('/api/import/markdown', { text: md, title: title.trim() || fallbackTitle, profile, folder }));

  const importFile = async (file: File) => {
    setError(null);
    setBusy(true);
    try {
      const content = await file.text();
      const name = file.name.toLowerCase();
      const stem = file.name.replace(/\.(waymark\.json|waymark\.zip|json|zip|md|markdown|txt|opml|xml)$/i, '');
      if (name.endsWith('.json')) {
        let data: unknown;
        try {
          data = JSON.parse(content);
        } catch {
          throw new Error('That file is not valid JSON.');
        }
        await done(await http.post(`/api/import?folder=${encodeURIComponent(folder)}`, data));
      } else if (name.endsWith('.zip')) {
        let res: Response;
        try {
          res = await fetch(`/api/import/zip?folder=${encodeURIComponent(folder)}`, { method: 'POST', body: file, headers: { 'Content-Type': 'application/zip' } });
        } catch {
          throw new Error('The Waymark server is not reachable.');
        }
        const body = await res.json().catch(() => null);
        if (!res.ok) throw new Error(body?.error ?? 'This backup could not be imported.');
        await done({ roadmapId: body.roadmapId, warnings: body.warnings ?? [] });
        if (body.attachments) toast.success(`Restored ${body.attachments} attached file(s).`);
      } else if (name.endsWith('.opml') || name.endsWith('.xml')) {
        const o = parseOpml(content);
        if (!o.items.length) throw new Error('No outline items found in that file.');
        const bundle = fromOutline({ title: title.trim() || o.title || stem, profile, items: o.items });
        await done({ ...(await http.post<{ roadmapId: string; warnings: string[] }>(`/api/import?folder=${encodeURIComponent(folder)}`, bundle)), count: bundle.checkpoints.length });
      } else {
        await importMarkdown(content, stem);
      }
    } catch (e) {
      setError((e as Error).message);
    }
    setBusy(false);
  };

  const sel = 'h-9 w-full rounded-md border border-line bg-surface px-3 text-[13px] outline-none focus:border-accent';
  const folderOptions = useMemo(() => [{ value: '', label: 'Top level' }, ...folders.map((f) => ({ value: f, label: f.split('/').join(' › ') }))], [folders]);
  return (
    <Modal open={open} onOpenChange={(o) => setState({ dialog: o ? 'import' : null })} title="Import a roadmap" description="Imports always create a new roadmap; nothing existing is overwritten." wide>
      <div className="mb-4 flex rounded-lg bg-surface-2 p-0.5 text-[12.5px]">
        {[
          ['file', 'From a file'],
          ['paste', 'Paste an outline'],
        ].map(([k, l]) => (
          <button key={k} onClick={() => setTab(k as 'file' | 'paste')} className={cx('flex-1 rounded-md px-3 py-1.5', tab === k ? 'bg-surface font-medium shadow-sm' : 'text-muted')}>
            {l}
          </button>
        ))}
      </div>
      <div className="grid gap-3 sm:grid-cols-3">
        <label className="text-[12.5px] font-medium sm:col-span-1">
          Put it in
          <select className={cx(sel, 'mt-1')} value={folder} onChange={(e) => setFolder(e.target.value)}>
            {folderOptions.map((o) => (
              <option key={o.value} value={o.value}>
                {o.label}
              </option>
            ))}
          </select>
        </label>
        <label className="text-[12.5px] font-medium">
          Kind (for outlines)
          <select className={cx(sel, 'mt-1')} value={profile} onChange={(e) => setProfile(e.target.value as 'learning' | 'general')}>
            <option value="learning">Learning</option>
            <option value="general">General</option>
          </select>
        </label>
        <label className="text-[12.5px] font-medium">
          Title <span className="font-normal text-faint">(optional)</span>
          <input className={cx(sel, 'mt-1')} value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Taken from the file" />
        </label>
      </div>
      {tab === 'file' ? (
        <div className="mt-4">
          <button
            onClick={() => fileRef.current?.click()}
            disabled={busy}
            className="flex w-full flex-col items-center gap-1 rounded-xl border-2 border-dashed border-line-strong px-4 py-8 text-center hover:border-accent hover:bg-accent-soft/40"
            onDragOver={(e) => e.preventDefault()}
            onDrop={(e) => {
              e.preventDefault();
              const f = e.dataTransfer.files[0];
              if (f) void importFile(f);
            }}
          >
            <Upload size={20} className="text-muted" />
            <span className="text-[13.5px] font-semibold">{busy ? 'Importing…' : 'Choose a file or drop it here'}</span>
            <span className="text-[12px] text-muted">
              <b>.waymark.zip</b> full backup · <b>.waymark.json</b> data · <b>.md</b> outline (headings and lists become checkpoints) · <b>.opml</b> from mind-map apps
            </span>
          </button>
          <input
            ref={fileRef}
            type="file"
            accept=".zip,.json,.md,.markdown,.txt,.opml,.xml,application/zip,application/json,text/markdown,text/plain"
            className="hidden"
            onChange={(e) => {
              const f = e.target.files?.[0];
              if (f) void importFile(f);
              e.target.value = '';
            }}
          />
        </div>
      ) : (
        <div className="mt-4 grid gap-2">
          <textarea
            value={text}
            onChange={(e) => setText(e.target.value)}
            rows={10}
            placeholder={'# My learning plan\n\n## Foundations\n- Topic one\n- Topic two\n\n## Next steps\nSome notes…'}
            className="w-full resize-y rounded-md border border-line bg-surface-2 p-3 font-mono text-[12.5px] outline-none focus:border-accent"
          />
          <p className="text-[12px] text-muted">
            <FileCode size={12} className="mr-1 inline" />
            Headings become checkpoints, nested by level. A list right under a heading becomes its sub-checkpoints, and other text becomes its content. Ticked items (<code>- [x]</code>) import as complete.
          </p>
          <div className="flex justify-end">
            <Button
              variant="primary"
              disabled={!text.trim() || busy}
              onClick={async () => {
                setError(null);
                setBusy(true);
                try {
                  await importMarkdown(text);
                } catch (e) {
                  setError((e as Error).message);
                }
                setBusy(false);
              }}
            >
              Create roadmap
            </Button>
          </div>
        </div>
      )}
      {error && <div className="mt-3 rounded-md bg-danger-soft p-2 text-[12.5px] text-danger">{error}</div>}
    </Modal>
  );
}
