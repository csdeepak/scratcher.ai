// Attaching images and PDFs to checkpoints, and turning the paths stored in Markdown into URLs.

import type { Attachment } from '../shared/model';
import { attachmentRel } from '../shared/exporters';
import { setState } from './store';

export interface Uploaded {
  name: string;
  path: string;
  markdownPath: string;
  kind: Attachment['kind'];
}

const EXT_FOR_TYPE: Record<string, string> = {
  'image/png': 'png',
  'image/jpeg': 'jpg',
  'image/gif': 'gif',
  'image/webp': 'webp',
  'image/avif': 'avif',
  'image/bmp': 'bmp',
  'image/svg+xml': 'svg',
  'application/pdf': 'pdf',
};

export function isAttachable(file: File): boolean {
  return !!EXT_FOR_TYPE[file.type] || /\.(png|jpe?g|gif|webp|avif|bmp|svg|pdf)$/i.test(file.name);
}

/** URL the app can load an attached file from. `rel` is the path inside the roadmap folder. */
export function fileUrl(roadmapId: string, rel: string, download = false): string {
  return `/api/roadmaps/${encodeURIComponent(roadmapId)}/files/${rel.split('/').map(encodeURIComponent).join('/')}${download ? '?download=1' : ''}`;
}

/** For <img src> and links written in Markdown: attachment paths become URLs, others stay as they are. */
export function resolveSrc(roadmapId: string, src: string): string {
  const rel = attachmentRel(src);
  return rel ? fileUrl(roadmapId, rel) : src;
}

/** A Markdown-safe link target (spaces and brackets encoded). */
export function encodeTarget(p: string): string {
  return encodeURI(p).replace(/\(/g, '%28').replace(/\)/g, '%29');
}

export function markdownFor(a: Pick<Uploaded, 'name' | 'markdownPath' | 'kind'>): string {
  const stem = a.name.replace(/\.[^.]+$/, '');
  return a.kind === 'image' ? `![${stem}](${encodeTarget(a.markdownPath)})` : `[${a.name}](${encodeTarget(a.markdownPath)})`;
}

function stampName(ext: string) {
  const d = new Date();
  const p = (n: number) => String(n).padStart(2, '0');
  return `pasted-${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}.${ext}`;
}

export async function uploadAttachment(roadmapId: string, checkpointId: string, file: File): Promise<Uploaded> {
  const ext = EXT_FOR_TYPE[file.type];
  // Screenshots pasted from the clipboard arrive as "image.png": give them a findable name.
  let name = file.name && !/^image\.(png|jpe?g|gif|webp)$/i.test(file.name) ? file.name : stampName(ext ?? 'png');
  if (ext && !/\.[a-z0-9]+$/i.test(name)) name += `.${ext}`;
  let res: Response;
  try {
    res = await fetch(`/api/roadmaps/${encodeURIComponent(roadmapId)}/attachments?cp=${encodeURIComponent(checkpointId)}&name=${encodeURIComponent(name)}`, {
      method: 'POST',
      body: file,
      headers: { 'Content-Type': file.type || 'application/octet-stream' },
    });
  } catch {
    throw new Error('The Waymark server is not reachable, so the file was not attached.');
  }
  if (!res.ok) throw new Error((await res.json().catch(() => null))?.error ?? 'The file could not be attached.');
  return (await res.json()) as Uploaded;
}

export function openViewer(roadmapId: string, rel: string, name?: string) {
  const file = name ?? rel.split('/').pop() ?? rel;
  const kind: Attachment['kind'] = /\.pdf$/i.test(rel) ? 'pdf' : /\.(png|jpe?g|gif|webp|avif|bmp|svg)$/i.test(rel) ? 'image' : 'other';
  setState({ viewer: { roadmapId, path: rel, name: file, kind } });
}

export function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}
