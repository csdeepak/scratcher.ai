import type { ReactNode } from 'react';
import { Dialog } from 'radix-ui';
import { Download, ExternalLink, X } from 'lucide-react';

export function ViewerToolbar({
  name,
  url,
  downloadUrl,
  openLabel = 'Open in a browser tab',
  children,
}: {
  name: string;
  /** Where "open elsewhere" goes; none for documents (they only download). */
  url?: string;
  downloadUrl?: string;
  openLabel?: string;
  children?: ReactNode;
}) {
  return (
    <div className="flex h-12 flex-none items-center gap-3 bg-[#1f2937] px-3 text-white">
      <Dialog.Title className="min-w-0 flex-1 truncate text-[13.5px] font-semibold">{name}</Dialog.Title>
      <Dialog.Description className="sr-only">Viewer for {name}</Dialog.Description>
      {children}
      {downloadUrl && (
        <a href={downloadUrl} className="rounded p-1.5 hover:bg-white/10" aria-label="Download" title="Download">
          <Download size={16} />
        </a>
      )}
      {url && (
        <a href={url} target="_blank" rel="noreferrer" className="rounded p-1.5 hover:bg-white/10" aria-label={openLabel} title={openLabel}>
          <ExternalLink size={16} />
        </a>
      )}
      <Dialog.Close asChild>
        <button className="rounded p-1.5 hover:bg-white/10" aria-label="Close (Esc)" title="Close (Esc)">
          <X size={18} />
        </button>
      </Dialog.Close>
    </div>
  );
}
