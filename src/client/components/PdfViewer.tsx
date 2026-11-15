// In-app PDF viewer (pdf.js via react-pdf). Pages render as they scroll into view; text can be
// selected and found with Ctrl+F; links inside the PDF work (web links open a new tab).

import { useCallback, useEffect, useRef, useState } from 'react';
import { Document, Page, pdfjs } from 'react-pdf';
import 'react-pdf/dist/Page/AnnotationLayer.css';
import 'react-pdf/dist/Page/TextLayer.css';
import { Minus, Plus, ScanLine } from 'lucide-react';
import { ViewerToolbar } from './ViewerToolbar';

pdfjs.GlobalWorkerOptions.workerSrc = new URL('pdfjs-dist/build/pdf.worker.min.mjs', import.meta.url).toString();

// Fonts, character maps and decoders come from the local server, so PDFs render offline.
const OPTIONS = { cMapUrl: '/api/pdfjs/cmaps/', standardFontDataUrl: '/api/pdfjs/standard_fonts/', wasmUrl: '/api/pdfjs/wasm/', iccUrl: '/api/pdfjs/iccs/' };

function LazyPage({ n, width, ratio, root, onVisible }: { n: number; width: number; ratio: number; root: HTMLElement | null; onVisible: (n: number) => void }) {
  const ref = useRef<HTMLDivElement>(null);
  const [near, setNear] = useState(n <= 2);
  useEffect(() => {
    const el = ref.current;
    if (!el || !root) return;
    const io = new IntersectionObserver(
      (entries) => {
        for (const e of entries) {
          if (e.isIntersecting) setNear(true);
          if (e.intersectionRatio > 0.45) onVisible(n);
        }
      },
      { root, rootMargin: '1200px 0px', threshold: [0, 0.45] },
    );
    io.observe(el);
    return () => io.disconnect();
  }, [root, n, onVisible]);
  return (
    <div ref={ref} data-page={n} className="mx-auto mb-4 bg-white shadow-lg" style={{ width, minHeight: Math.round(width * ratio) }}>
      {near && <Page pageNumber={n} width={width} renderTextLayer renderAnnotationLayer loading={<div style={{ height: Math.round(width * ratio) }} />} />}
    </div>
  );
}

export default function PdfViewer({ url, name, downloadUrl }: { url: string; name: string; downloadUrl: string }) {
  const scroller = useRef<HTMLDivElement>(null);
  const [root, setRoot] = useState<HTMLDivElement | null>(null);
  const [pages, setPages] = useState(0);
  const [current, setCurrent] = useState(1);
  const [zoom, setZoom] = useState(1);
  const [ratio, setRatio] = useState(1.414);
  const [boxWidth, setBoxWidth] = useState(800);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const el = scroller.current;
    if (!el) return;
    setRoot(el);
    const ro = new ResizeObserver(() => setBoxWidth(el.clientWidth));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const width = Math.max(240, Math.round(Math.min(1000, boxWidth - 48) * zoom));
  const onVisible = useCallback((n: number) => setCurrent(n), []);
  const goTo = (n: number) => scroller.current?.querySelector(`[data-page="${n}"]`)?.scrollIntoView({ block: 'start' });

  const controls = (
    <div className="flex items-center gap-1 text-[12.5px]">
      <span className="mr-2 tabular-nums text-white/80">{pages ? `${current} / ${pages}` : '…'}</span>
      <button aria-label="Zoom out" onClick={() => setZoom((z) => Math.max(0.4, +(z - 0.15).toFixed(2)))} className="rounded p-1.5 hover:bg-white/10">
        <Minus size={15} />
      </button>
      <span className="w-11 text-center tabular-nums">{Math.round(zoom * 100)}%</span>
      <button aria-label="Zoom in" onClick={() => setZoom((z) => Math.min(3, +(z + 0.15).toFixed(2)))} className="rounded p-1.5 hover:bg-white/10">
        <Plus size={15} />
      </button>
      <button aria-label="Fit width" onClick={() => setZoom(1)} className="rounded p-1.5 hover:bg-white/10" title="Fit width">
        <ScanLine size={15} />
      </button>
    </div>
  );

  return (
    <>
      <ViewerToolbar name={name} url={url} downloadUrl={downloadUrl}>
        {controls}
      </ViewerToolbar>
      <div
        ref={scroller}
        className="min-h-0 flex-1 overflow-auto bg-[#3b3a37] py-6"
        tabIndex={0}
        onKeyDown={(e) => {
          if ((e.ctrlKey || e.metaKey) && (e.key === '=' || e.key === '+')) {
            e.preventDefault();
            setZoom((z) => Math.min(3, +(z + 0.15).toFixed(2)));
          }
          if ((e.ctrlKey || e.metaKey) && e.key === '-') {
            e.preventDefault();
            setZoom((z) => Math.max(0.4, +(z - 0.15).toFixed(2)));
          }
        }}
      >
        {error ? (
          <div className="mx-auto max-w-md rounded-lg bg-white p-6 text-center text-[13px] text-stone-700">{error}</div>
        ) : (
          <Document
            file={url}
            options={OPTIONS}
            externalLinkTarget="_blank"
            externalLinkRel="noopener noreferrer"
            onItemClick={({ pageNumber }) => goTo(pageNumber)}
            onLoadSuccess={async (doc) => {
              setPages(doc.numPages);
              try {
                const first = await doc.getPage(1);
                const vp = first.getViewport({ scale: 1 });
                setRatio(vp.height / vp.width);
              } catch {
                /* keep A4 ratio */
              }
            }}
            onLoadError={(e) => setError(`This PDF could not be opened: ${e.message}`)}
            loading={<div className="py-16 text-center text-[13px] text-white/70">Opening PDF…</div>}
          >
            {Array.from({ length: pages }, (_, i) => (
              <LazyPage key={i + 1} n={i + 1} width={width} ratio={ratio} root={root} onVisible={onVisible} />
            ))}
          </Document>
        )}
      </div>
    </>
  );
}
