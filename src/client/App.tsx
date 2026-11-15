import { useEffect, useRef } from 'react';
import { Tooltip } from 'radix-ui';
import { Toaster, toast } from 'sonner';
import { http } from './api';
import { applyTheme, initApp, navigate, setState, useStore } from './store';
import { Home, RoadmapView, TopBar } from './components/Shell';
import { ReviewDrawer, PasteProposalDialog } from './components/Review';
import { Dialogs } from './components/Dialogs';
import { CommandPalette } from './components/Palette';

export function App() {
  const route = useStore((s) => s.route);
  const theme = useStore((s) => s.theme);
  const fileRef = useRef<HTMLInputElement>(null);

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

  const onImportFile = async (file: File) => {
    try {
      const data = JSON.parse(await file.text());
      const res = await http.post<{ roadmapId: string; warnings: string[] }>('/api/import', data);
      toast.success('Roadmap imported.');
      if (res.warnings.length) toast.warning(`${res.warnings.length} note(s) while importing`, { description: res.warnings.slice(0, 4).join(' · ') });
      navigate({ page: 'roadmap', id: res.roadmapId });
    } catch (e) {
      toast.error(e instanceof SyntaxError ? 'That file is not valid JSON.' : (e as Error).message);
    }
  };
  const openImport = () => fileRef.current?.click();

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
      <input
        ref={fileRef}
        type="file"
        accept=".json,application/json"
        className="hidden"
        onChange={(e) => {
          const f = e.target.files?.[0];
          if (f) void onImportFile(f);
          e.target.value = '';
        }}
      />
      <Toaster position="bottom-center" theme={theme === 'system' ? 'system' : theme} toastOptions={{ className: '!rounded-xl !text-[13px]' }} />
    </Tooltip.Provider>
  );
}
