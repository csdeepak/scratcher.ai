// Full-screen viewer: attached images, PDFs, video and audio, documents (open or download), and
// YouTube / Vimeo / Loom videos played with the provider's own embed player (docs/MEDIA.md).

import { lazy, Suspense, useState } from 'react';
import { Dialog } from 'radix-ui';
import { toast } from 'sonner';
import { FileText, FolderOpen, Music } from 'lucide-react';
import { fileUrl } from '../attachments';
import { getState, setState, useStore } from '../store';
import { desktopBridge } from '../desktop';
import { formatTimestamp, type Embed } from '../../shared/media';
import { workspacePath } from './Connect';
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

/** The provider's player (privacy-enhanced domain). Third-party: sandboxed so it can't navigate Waymark. */
export function EmbedFrame({ embed, title, className }: { embed: Embed; title: string; className?: string }) {
  return (
    <iframe
      src={embed.embedUrl}
      title={title}
      className={className}
      allow="autoplay; encrypted-media; picture-in-picture; fullscreen"
      allowFullScreen
      // YouTube refuses to play without the page's origin as referrer ("Error 153").
      referrerPolicy="strict-origin-when-cross-origin"
      sandbox="allow-scripts allow-same-origin allow-popups allow-popups-to-escape-sandbox allow-presentation"
    />
  );
}

/** Absolute path of an attachment, for opening it in the system's app (desktop only). */
function absolutePath(roadmapId: string, rel: string): string | null {
  const s = getState();
  const slug = s.roadmap?.meta.id === roadmapId ? s.roadmap.slug : s.summaries.find((r) => r.id === roadmapId)?.slug;
  return slug && s.workspace ? workspacePath(s.workspace, 'roadmaps', slug, rel) : null;
}

export async function openWithSystem(roadmapId: string, rel: string) {
  const desktop = desktopBridge();
  const abs = absolutePath(roadmapId, rel);
  if (!desktop || !abs) return;
  const r = await desktop.openFile(abs);
  if (r && !r.ok) toast.error(r.error ?? "Couldn't open that file.");
}

function DocumentView({ roadmapId, path, name, downloadUrl }: { roadmapId: string; path: string; name: string; downloadUrl: string }) {
  const desktop = desktopBridge();
  return (
    <div className="flex flex-1 flex-col items-center justify-center gap-4 bg-[#3b3a37] p-6 text-center text-white">
      <FileText size={56} strokeWidth={1.25} className="text-white/70" />
      <div className="max-w-md text-[14px] font-medium">{name}</div>
      <p className="max-w-md text-[12.5px] text-white/70">Documents open in the app your computer uses for them, so nothing in them runs inside Waymark.</p>
      <div className="flex gap-2">
        {desktop && (
          <button className="inline-flex h-9 items-center gap-1.5 rounded-lg bg-white px-3 text-[13px] font-medium text-[#1f2937] hover:bg-white/90" onClick={() => void openWithSystem(roadmapId, path)}>
            <FolderOpen size={15} /> Open
          </button>
        )}
        <a className="inline-flex h-9 items-center gap-1.5 rounded-lg border border-white/40 px-3 text-[13px] font-medium hover:bg-white/10" href={downloadUrl}>
          Download
        </a>
      </div>
    </div>
  );
}

export function Viewer() {
  const viewer = useStore((s) => s.viewer);
  if (!viewer) return null;
  const close = () => setState({ viewer: null });
  const shell = (body: React.ReactNode) => (
    <Dialog.Root open onOpenChange={(o) => !o && close()}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-[90] bg-black/60" />
        <Dialog.Content className="fixed inset-0 z-[91] flex flex-col outline-none sm:inset-4 sm:overflow-hidden sm:rounded-xl" aria-label={viewer.name}>
          {body}
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );

  if (viewer.kind === 'embed' && viewer.embed) {
    const e = viewer.embed;
    return shell(
      <>
        <ViewerToolbar name={viewer.name} url={e.watchUrl} openLabel={`Open on ${e.provider === 'youtube' ? 'YouTube' : e.provider === 'vimeo' ? 'Vimeo' : 'Loom'}`}>
          {e.start ? <span className="rounded bg-white/15 px-1.5 text-[11.5px]">from {formatTimestamp(e.start)}</span> : null}
        </ViewerToolbar>
        <div className="flex min-h-0 flex-1 items-center justify-center bg-black p-2 sm:p-6">
          <EmbedFrame embed={e} title={viewer.name} className="aspect-video max-h-full w-full max-w-[min(100%,calc((100vh-8rem)*16/9))] rounded-lg bg-black" />
        </div>
      </>,
    );
  }

  const url = fileUrl(viewer.roadmapId, viewer.path);
  const downloadUrl = fileUrl(viewer.roadmapId, viewer.path, true);
  if (viewer.kind === 'pdf') {
    return shell(
      <Suspense
        fallback={
          <>
            <ViewerToolbar name={viewer.name} url={url} downloadUrl={downloadUrl} />
            <div className="flex-1 bg-[#3b3a37] py-16 text-center text-[13px] text-white/70">Loading the PDF viewer…</div>
          </>
        }
      >
        <PdfViewer key={viewer.path} url={url} name={viewer.name} downloadUrl={downloadUrl} />
      </Suspense>,
    );
  }
  return shell(
    <>
      <ViewerToolbar name={viewer.name} url={viewer.kind === 'other' ? undefined : url} downloadUrl={downloadUrl} />
      {viewer.kind === 'image' && <ImageView url={url} />}
      {viewer.kind === 'video' && (
        <div className="flex min-h-0 flex-1 items-center justify-center bg-black p-2 sm:p-6">
          {/* Range requests on the server let the player seek without loading the whole file. */}
          <video src={url} controls autoPlay preload="metadata" className="max-h-full max-w-full rounded-lg" aria-label={viewer.name} />
        </div>
      )}
      {viewer.kind === 'audio' && (
        <div className="flex flex-1 flex-col items-center justify-center gap-5 bg-[#3b3a37] p-6 text-white">
          <Music size={52} strokeWidth={1.25} className="text-white/70" />
          <audio src={url} controls autoPlay preload="metadata" className="w-full max-w-xl" aria-label={viewer.name} />
        </div>
      )}
      {viewer.kind === 'other' && <DocumentView roadmapId={viewer.roadmapId} path={viewer.path} name={viewer.name} downloadUrl={downloadUrl} />}
    </>,
  );
}
