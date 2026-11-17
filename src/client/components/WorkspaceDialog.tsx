// Workspace settings: the one folder that holds everything, and (in the desktop app) switching to
// another folder or moving the whole workspace there. Moving copies, checks every file, then
// opens the copy; the old folder is never deleted (electron/main.ts, moveWorkspace).

import { useEffect, useState } from 'react';
import { toast } from 'sonner';
import { Copy, FolderInput, FolderOpen, FolderSync, Loader } from 'lucide-react';
import { setState, useStore } from '../store';
import { desktopBridge } from '../desktop';
import { FolderField, FolderStatus, useFolderCheck } from './FolderPicker';
import { Button, Modal } from './ui';

export function WorkspaceDialog() {
  const open = useStore((s) => s.dialog === 'workspace');
  const workspace = useStore((s) => s.workspace);
  const count = useStore((s) => s.summaries.length);
  const desktop = desktopBridge();
  const [dir, setDir] = useState('');
  const [busy, setBusy] = useState<null | 'open' | 'move'>(null);
  const [error, setError] = useState<string | null>(null);
  const info = useFolderCheck(dir);

  useEffect(() => {
    if (!open) return;
    setDir('');
    setError(null);
    setBusy(null);
  }, [open]);

  const fold = (p: string) => (desktop?.platform === 'linux' ? p : p.toLowerCase());
  const same = !!info && fold(info.path) === fold(workspace);
  const usable = !!info && !!dir.trim() && info.state !== 'blocked' && !same && !busy;
  const movable = usable && (info.state === 'new' || info.state === 'empty');

  const run = async (kind: 'open' | 'move') => {
    if (!desktop) return;
    setBusy(kind);
    setError(null);
    const r = kind === 'open' ? await desktop.useFolder(dir) : await desktop.moveWorkspace(dir);
    // On success the window reloads into the new folder; we only get here if it didn't.
    if (!r.ok) {
      setError(r.error ?? 'That didn’t work.');
      setBusy(null);
    }
  };

  return (
    <Modal
      open={open}
      onOpenChange={(o) => !busy && setState({ dialog: o ? 'workspace' : null })}
      title="Workspace folder"
      description="Everything Waymark keeps is in this one folder: roadmaps, notes, attachments, history and daily backups. Your AI agents work in the same folder."
    >
      <div className="flex min-w-0 flex-col gap-4 text-[13px]">
        <div>
          <div className="mb-1 text-[12.5px] font-semibold">Current folder</div>
          <div className="flex flex-wrap items-center gap-2">
            <code className="min-w-0 flex-1 truncate rounded-md bg-surface-2 px-2 py-1.5 font-mono text-[12px]" title={workspace}>
              {workspace}
            </code>
            <Button
              size="sm"
              onClick={() =>
                void navigator.clipboard.writeText(workspace).then(
                  () => toast.success('Folder path copied'),
                  () => toast.error("Couldn't copy: clipboard access was blocked."),
                )
              }
            >
              <Copy size={13} /> Copy
            </Button>
            {desktop && (
              <Button size="sm" onClick={() => void desktop.showWorkspace()}>
                <FolderOpen size={13} /> Show
              </Button>
            )}
          </div>
          <p className="mt-1 text-[12px] text-faint">
            {count} roadmap{count === 1 ? '' : 's'}.{' '}
            <button className="text-accent hover:underline" onClick={() => setState({ dialog: 'connect' })}>
              Connect your AI
            </button>{' '}
            to this folder.
          </p>
        </div>

        {desktop ? (
          <div className="min-w-0 border-t border-line pt-4">
            <label htmlFor="wm-other-folder" className="mb-1 block text-[12.5px] font-semibold">
              Another folder
            </label>
            <FolderField id="wm-other-folder" value={dir} onChange={setDir} disabled={!!busy} />
            {dir.trim() && (
              <div className="mt-2.5">
                {same ? <p className="rounded-lg bg-surface-2 px-3 py-2 text-[12.5px] text-muted">That's the folder you're using now.</p> : <FolderStatus info={info} mode="settings" onUseInside={setDir} />}
              </div>
            )}
            <div className="mt-3 flex flex-col gap-2.5">
              <div className="flex items-start gap-3">
                <Button className="w-44 flex-none" disabled={!usable} onClick={() => void run('open')}>
                  {busy === 'open' ? <Loader size={14} className="animate-spin" /> : <FolderInput size={14} />} Open this folder
                </Button>
                <p className="text-[12px] leading-snug text-muted">Use that folder from now on. Your current one stays as it is, and you can come back to it here.</p>
              </div>
              <div className="flex items-start gap-3">
                <Button className="w-44 flex-none" disabled={!movable} onClick={() => void run('move')}>
                  {busy === 'move' ? <Loader size={14} className="animate-spin" /> : <FolderSync size={14} />} {busy === 'move' ? 'Moving…' : 'Move my workspace here'}
                </Button>
                <p className="text-[12px] leading-snug text-muted">
                  Copy everything into that folder (it must be new or empty), check every file, then use it. The old folder isn't deleted: remove it yourself once
                  you've looked.
                </p>
              </div>
            </div>
            {error && (
              <p role="alert" className="mt-3 rounded-lg bg-danger-soft px-3 py-2 text-[12.5px]">
                {error}
              </p>
            )}
            <p className="mt-3 text-[12px] text-faint">After a switch or a move, point your AI tools at the new folder too.</p>
          </div>
        ) : (
          <p className="border-t border-line pt-4 text-[12.5px] text-muted">
            To use another folder, start Waymark with it: <code className="font-mono text-[12px]">npm run serve -- --workspace "&lt;folder&gt;"</code>. The desktop app can switch and move
            folders from here.
          </p>
        )}
      </div>
    </Modal>
  );
}
