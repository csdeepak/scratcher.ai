import { useEffect } from 'react';
import { Tooltip } from 'radix-ui';
import { Toaster, toast } from 'sonner';
import { applyTheme, initApp, setState, useStore } from './store';
import { desktopBridge } from './desktop';
import { Home, RoadmapView, TopBar } from './components/Shell';
import { ReviewDrawer, PasteProposalDialog } from './components/Review';
import { Dialogs } from './components/Dialogs';
import { CommandPalette } from './components/Palette';
import { ExportDialog, ImportDialog } from './components/Transfer';
import { Viewer } from './components/Viewer';

export function App() {
  const route = useStore((s) => s.route);
  const theme = useStore((s) => s.theme);

  useEffect(() => {
    void initApp();
    // Messages from the desktop app in the address (electron/main.ts, openWorkspace), shown once.
    const q = new URLSearchParams(location.search);
    if (q.get('welcome') === 'connect') setState({ dialog: 'connect', connectFirstRun: true });
    const moved = q.get('moved');
    if (moved) {
      toast.success(`Moved your workspace here (${moved} files, each checked).`, {
        description: `The old folder is still at ${q.get('from') ?? 'its old place'}. Delete it once you've looked. Point your AI tools at the new folder too.`,
        duration: 20_000,
      });
    }
    if (q.get('switched')) toast.success('Opened the workspace folder.');
    if (q.size) history.replaceState(null, '', location.pathname + location.hash);
    // The desktop app's menu opens these dialogs.
    const offMenu = desktopBridge()?.onOpen((what) => setState({ dialog: what === 'connect' ? 'connect' : 'workspace' }));
    const mq = matchMedia('(prefers-color-scheme: dark)');
    const on = () => applyTheme();
    mq.addEventListener('change', on);
    const onKey = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        setState({ dialog: useStore.getState().dialog === 'palette' ? null : 'palette' });
      }
    };
    window.addEventListener('keydown', onKey);
    return () => {
      offMenu?.();
      mq.removeEventListener('change', on);
      window.removeEventListener('keydown', onKey);
    };
  }, []);

  const openImport = () => setState({ dialog: 'import' });

  return (
    <Tooltip.Provider>
      <div className="flex h-full flex-col">
        <TopBar onImport={openImport} />
        {route.page === 'home' ? <Home onImport={openImport} /> : <RoadmapView />}
      </div>
      <ReviewDrawer />
      <CommandPalette />
      <Dialogs />
      <PasteProposalDialog />
      <ExportDialog />
      <ImportDialog />
      <Viewer />
      <Toaster position="bottom-center" theme={theme === 'system' ? 'system' : theme} toastOptions={{ className: '!rounded-xl !text-[13px]' }} />
    </Tooltip.Provider>
  );
}
