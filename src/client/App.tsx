import { useEffect } from 'react';
import { Tooltip } from 'radix-ui';
import { Toaster } from 'sonner';
import { applyTheme, initApp, setState, useStore } from './store';
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
