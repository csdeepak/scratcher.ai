// Full-screen viewer for attached images and PDFs.

import { lazy, Suspense, useState } from 'react';
import { Dialog } from 'radix-ui';
import { fileUrl } from '../attachments';
import { setState, useStore } from '../store';
import { ViewerToolbar } from './ViewerToolbar';

const PdfViewer = lazy(() => import('./PdfViewer'));

function ImageView({ url }: { url: string }) {
  const [actual, setActual] = useState(false);
  return (
    <div className={`min-h-0 flex-1 overflow-auto bg-[#3b3a37] p-6 ${actual ? '' : 'flex items-center justify-center'}`}>
      <img
        src={url}
        alt=""
        onClick={() => setActual((a) => !a)}
        className={actual ? 'max-w-none cursor-zoom-out' : 'max-h-full max-w-full cursor-zoom-in object-contain shadow-lg'}
        title={actual ? 'Click to fit the screen' : 'Click for actual size'}
      />
    </div>
  );
}

export function Viewer() {
  const viewer = useStore((s) => s.viewer);
  if (!viewer) return null;
  const url = fileUrl(viewer.roadmapId, viewer.path);
  const downloadUrl = fileUrl(viewer.roadmapId, viewer.path, true);
  return (
    <Dialog.Root open onOpenChange={(o) => !o && setState({ viewer: null })}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-[90] bg-black/60" />
        <Dialog.Content className="fixed inset-0 z-[91] flex flex-col outline-none sm:inset-4 sm:overflow-hidden sm:rounded-xl" aria-label={viewer.name}>
          {viewer.kind === 'pdf' ? (
            <Suspense
              fallback={
                <>
                  <ViewerToolbar name={viewer.name} url={url} downloadUrl={downloadUrl} />
                  <div className="flex-1 bg-[#3b3a37] py-16 text-center text-[13px] text-white/70">Loading the PDF viewer…</div>
                </>
              }
            >
              <PdfViewer key={viewer.path} url={url} name={viewer.name} downloadUrl={downloadUrl} />
            </Suspense>
          ) : (
            <>
              <ViewerToolbar name={viewer.name} url={url} downloadUrl={downloadUrl} />
              {viewer.kind === 'image' ? (
                <ImageView url={url} />
              ) : (
                <div className="flex flex-1 items-center justify-center bg-[#3b3a37] text-[13px] text-white/80">This file type can't be previewed. Download it or open it in a browser tab.</div>
              )}
            </>
          )}
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
