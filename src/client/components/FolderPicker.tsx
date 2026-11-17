// A workspace folder you can type or browse to, with a live check of what Waymark would do with it
// (desktop app only: the check runs in electron/folders.ts). Used on the welcome page and in
// Workspace settings.

import { useEffect, useState, type ReactNode } from 'react';
import { Ban, Cloud, FolderCheck, FolderOpen, FolderPlus, Loader, TriangleExclamationPoint } from 'lucide-react';
import { desktopBridge, type FolderInfo } from '../desktop';
import { Button, cx } from './ui';

/** Checks `dir` (after a short pause in typing). Null while checking. */
export function useFolderCheck(dir: string): FolderInfo | null {
  const [info, setInfo] = useState<FolderInfo | null>(null);
  useEffect(() => {
    const d = desktopBridge();
    if (!d) return;
    let live = true;
    setInfo(null);
    const t = setTimeout(() => {
      void d.inspectFolder(dir).then((r) => live && setInfo(r));
    }, 250);
    return () => {
      live = false;
      clearTimeout(t);
    };
  }, [dir]);
  return info;
}

export function FolderField({ id, value, onChange, disabled }: { id: string; value: string; onChange: (v: string) => void; disabled?: boolean }) {
  const browse = async () => {
    const picked = await desktopBridge()?.chooseFolder(value);
    if (picked) onChange(picked);
  };
  return (
    <div className="flex gap-2">
      <input
        id={id}
        value={value}
        disabled={disabled}
        spellCheck={false}
        onChange={(e) => onChange(e.target.value)}
        className="h-9 min-w-0 flex-1 rounded-md border border-line bg-surface px-3 font-mono text-[12.5px] outline-none focus:border-accent disabled:opacity-60"
      />
      <Button disabled={disabled} onClick={() => void browse()}>
        <FolderOpen size={14} /> Browse…
      </Button>
    </div>
  );
}

const sepOf = (p: string) => (p.includes('\\') ? '\\' : '/');

/** A new folder called Waymark inside `dir`, for when `dir` already has other things in it. */
export const insideFolder = (dir: string) => `${dir.replace(/[\\/]+$/, '')}${sepOf(dir)}Waymark`;

/**
 * What Waymark will do with the folder. `mode` "start": on the welcome page; "settings": in
 * Workspace settings, where the buttons say what happens.
 */
export function FolderStatus({ info, mode, onUseInside }: { info: FolderInfo | null; mode: 'start' | 'settings'; onUseInside: (dir: string) => void }) {
  if (!info) {
    return (
      <Line tone="muted" icon={<Loader size={15} className="animate-spin" />}>
        Checking the folder…
      </Line>
    );
  }
  const n = info.roadmaps ?? 0;
  const msg: Record<FolderInfo['state'], ReactNode> = {
    new: mode === 'start' ? "This folder doesn't exist yet. Waymark will create it and set it up." : "This folder doesn't exist yet. Waymark will create it.",
    empty: mode === 'start' ? 'This folder is empty. Waymark will set it up here.' : 'This folder is empty.',
    workspace: (
      <>
        This folder already has a Waymark workspace with {n} roadmap{n === 1 ? '' : 's'}.{mode === 'start' && ' Waymark will open it as it is.'}
      </>
    ),
    other: (
      <>
        This folder already has {info.count} other item{info.count === 1 ? '' : 's'}
        {info.sample?.length ? (
          <>
            {' '}
            (<span className="font-mono text-[12px]">{info.sample.join(', ')}</span>
            {(info.count ?? 0) > info.sample.length && ', …'})
          </>
        ) : null}
        . Waymark adds its own files next to them and leaves yours alone, but any AI you connect to this folder can read them too.
      </>
    ),
    blocked: info.reason,
  };
  const tone = info.state === 'blocked' ? 'danger' : info.state === 'other' ? 'warn' : info.state === 'workspace' ? 'done' : 'muted';
  const icon =
    info.state === 'blocked' ? <Ban size={15} /> : info.state === 'other' ? <TriangleExclamationPoint size={15} /> : info.state === 'workspace' ? <FolderCheck size={15} /> : <FolderPlus size={15} />;
  const canNest = info.state === 'other' || (info.state === 'blocked' && /whole drive|whole user folder/.test(info.reason ?? ''));
  return (
    <div className="flex min-w-0 flex-col gap-2">
      <Line tone={tone} icon={icon}>
        {msg[info.state]}
        {canNest && (
          <div className="mt-1.5">
            <Button size="sm" onClick={() => onUseInside(insideFolder(info.path))}>
              <FolderPlus size={13} /> Use a new folder inside it: <span className="font-mono">{insideFolder(info.path).split(/[\\/]/).slice(-2).join(sepOf(info.path))}</span>
            </Button>
          </div>
        )}
      </Line>
      {info.synced && info.state !== 'blocked' && (
        <Line tone="muted" icon={<Cloud size={15} />}>
          {info.synced} syncs this folder, which is a good off-computer backup. Set it to <b>Always keep on this device</b> so AI agents never meet online-only placeholder files.
        </Line>
      )}
    </div>
  );
}

function Line({ tone, icon, children }: { tone: 'muted' | 'warn' | 'done' | 'danger'; icon: ReactNode; children: ReactNode }) {
  return (
    <div
      role="status"
      className={cx(
        'flex gap-2 rounded-lg px-3 py-2 text-[12.5px] leading-relaxed',
        tone === 'muted' && 'bg-surface-2 text-muted',
        tone === 'warn' && 'bg-warn-soft text-fg',
        tone === 'done' && 'bg-done-soft text-fg',
        tone === 'danger' && 'bg-danger-soft text-fg',
      )}
    >
      <span className={cx('mt-0.5 flex-none', tone === 'warn' && 'text-review', tone === 'done' && 'text-done', tone === 'danger' && 'text-danger')}>{icon}</span>
      <div className="min-w-0">{children}</div>
    </div>
  );
}
