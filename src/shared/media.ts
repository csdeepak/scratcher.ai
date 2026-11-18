// Media rules shared by the server, the page and the tests (docs/MEDIA.md): which links play inside
// Waymark and from when, and which kinds of file a checkpoint can keep.

export type EmbedProvider = 'youtube' | 'vimeo' | 'loom';

export interface Embed {
  provider: EmbedProvider;
  id: string;
  /** Seconds to start at, if the link or resource says so. */
  start?: number;
  /** The provider's privacy-friendly embed player, autoplaying (it only loads after a click). */
  embedUrl: string;
  /** The normal page for the video (opens in the browser). */
  watchUrl: string;
  label: string;
}

/** "750", "750s", "12:30", "1:02:03", "1h2m3s", "2m" → seconds; null if it isn't a time. */
export function parseTimestamp(raw: string | number | null | undefined): number | null {
  if (raw === null || raw === undefined) return null;
  if (typeof raw === 'number') return Number.isFinite(raw) && raw >= 0 ? Math.floor(raw) : null;
  const s = raw.trim().toLowerCase();
  if (!s) return null;
  if (/^\d+(\.\d+)?s?$/.test(s)) return Math.floor(parseFloat(s));
  if (/^\d+(:\d{1,2}){1,2}$/.test(s)) return s.split(':').reduce((acc, p) => acc * 60 + Number(p), 0);
  const m = /^(?:(\d+)h)?(?:(\d+)m)?(?:(\d+)s)?$/.exec(s);
  if (m && (m[1] || m[2] || m[3])) return Number(m[1] ?? 0) * 3600 + Number(m[2] ?? 0) * 60 + Number(m[3] ?? 0);
  return null;
}

/** 750 → "12:30", 3723 → "1:02:03". */
export function formatTimestamp(sec: number): string {
  const h = Math.floor(sec / 3600);
  const m = Math.floor((sec % 3600) / 60);
  const s = Math.floor(sec % 60);
  const two = (n: number) => String(n).padStart(2, '0');
  return h ? `${h}:${two(m)}:${two(s)}` : `${m}:${two(s)}`;
}

const YT_ID = /^[A-Za-z0-9_-]{11}$/;

/**
 * A YouTube, Vimeo or Loom link Waymark can play in place, or null. `start` (a resource's
 * timestamp) wins over a time in the link.
 */
export function parseEmbed(href: string, start?: string | number | null): Embed | null {
  let u: URL;
  try {
    u = new URL(href.trim());
  } catch {
    return null;
  }
  if (u.protocol !== 'https:' && u.protocol !== 'http:') return null;
  const host = u.hostname.toLowerCase().replace(/^(www\.|m\.|music\.)/, '');
  const given = parseTimestamp(start ?? null);
  const hashTime = parseTimestamp(new URLSearchParams(u.hash.replace(/^#/, '')).get('t'));

  if (host === 'youtube.com' || host === 'youtu.be' || host === 'youtube-nocookie.com') {
    let id: string | null = null;
    if (host === 'youtu.be') id = u.pathname.slice(1).split('/')[0] ?? null;
    else if (u.pathname === '/watch') id = u.searchParams.get('v');
    else id = /^\/(?:embed|shorts|live|v)\/([^/?#]+)/.exec(u.pathname)?.[1] ?? null;
    if (!id || !YT_ID.test(id)) return null;
    const at = given ?? parseTimestamp(u.searchParams.get('t')) ?? parseTimestamp(u.searchParams.get('start')) ?? hashTime;
    const q = new URLSearchParams({ autoplay: '1', rel: '0' });
    if (at) q.set('start', String(at));
    return {
      provider: 'youtube',
      id,
      start: at ?? undefined,
      embedUrl: `https://www.youtube-nocookie.com/embed/${id}?${q}`,
      watchUrl: `https://www.youtube.com/watch?v=${id}${at ? `&t=${at}s` : ''}`,
      label: 'YouTube video',
    };
  }

  if (host === 'vimeo.com' || host === 'player.vimeo.com') {
    const m = /^\/(?:video\/)?(\d{5,12})(?:\/([0-9a-f]{6,20}))?/.exec(u.pathname);
    if (!m) return null;
    const id = m[1]!;
    const privacyHash = m[2] ?? u.searchParams.get('h') ?? '';
    const at = given ?? hashTime;
    const q = new URLSearchParams({ autoplay: '1', dnt: '1' });
    if (privacyHash) q.set('h', privacyHash);
    return {
      provider: 'vimeo',
      id,
      start: at ?? undefined,
      embedUrl: `https://player.vimeo.com/video/${id}?${q}${at ? `#t=${at}s` : ''}`,
      watchUrl: `https://vimeo.com/${id}${privacyHash ? `/${privacyHash}` : ''}${at ? `#t=${at}s` : ''}`,
      label: 'Vimeo video',
    };
  }

  if (host === 'loom.com') {
    const id = /^\/(?:share|embed)\/([0-9a-f]{16,64})/.exec(u.pathname)?.[1];
    if (!id) return null;
    return { provider: 'loom', id, embedUrl: `https://www.loom.com/embed/${id}?autoplay=1`, watchUrl: `https://www.loom.com/share/${id}`, label: 'Loom video' };
  }
  return null;
}

// ---------------------------------------------------------------- files a checkpoint can keep

export type AttachmentKind = 'image' | 'pdf' | 'video' | 'audio' | 'other';

export const ATTACHMENT_TYPES: Record<string, { mime: string; kind: AttachmentKind }> = {
  png: { mime: 'image/png', kind: 'image' },
  jpg: { mime: 'image/jpeg', kind: 'image' },
  jpeg: { mime: 'image/jpeg', kind: 'image' },
  gif: { mime: 'image/gif', kind: 'image' },
  webp: { mime: 'image/webp', kind: 'image' },
  avif: { mime: 'image/avif', kind: 'image' },
  bmp: { mime: 'image/bmp', kind: 'image' },
  svg: { mime: 'image/svg+xml', kind: 'image' },
  pdf: { mime: 'application/pdf', kind: 'pdf' },
  // Video and audio the browser and the desktop app (Chromium with H.264/AAC) can play.
  mp4: { mime: 'video/mp4', kind: 'video' },
  m4v: { mime: 'video/mp4', kind: 'video' },
  mov: { mime: 'video/quicktime', kind: 'video' },
  webm: { mime: 'video/webm', kind: 'video' },
  ogv: { mime: 'video/ogg', kind: 'video' },
  mp3: { mime: 'audio/mpeg', kind: 'audio' },
  m4a: { mime: 'audio/mp4', kind: 'audio' },
  aac: { mime: 'audio/aac', kind: 'audio' },
  wav: { mime: 'audio/wav', kind: 'audio' },
  ogg: { mime: 'audio/ogg', kind: 'audio' },
  oga: { mime: 'audio/ogg', kind: 'audio' },
  opus: { mime: 'audio/ogg', kind: 'audio' },
  flac: { mime: 'audio/flac', kind: 'audio' },
  // Study documents: always downloaded (or opened in the system's app), never shown in the page.
  txt: { mime: 'text/plain; charset=utf-8', kind: 'other' },
  md: { mime: 'text/markdown; charset=utf-8', kind: 'other' },
  csv: { mime: 'text/csv; charset=utf-8', kind: 'other' },
  json: { mime: 'application/json', kind: 'other' },
  ipynb: { mime: 'application/x-ipynb+json', kind: 'other' },
  doc: { mime: 'application/msword', kind: 'other' },
  docx: { mime: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', kind: 'other' },
  xls: { mime: 'application/vnd.ms-excel', kind: 'other' },
  xlsx: { mime: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', kind: 'other' },
  ppt: { mime: 'application/vnd.ms-powerpoint', kind: 'other' },
  pptx: { mime: 'application/vnd.openxmlformats-officedocument.presentationml.presentation', kind: 'other' },
  odt: { mime: 'application/vnd.oasis.opendocument.text', kind: 'other' },
  ods: { mime: 'application/vnd.oasis.opendocument.spreadsheet', kind: 'other' },
  odp: { mime: 'application/vnd.oasis.opendocument.presentation', kind: 'other' },
  rtf: { mime: 'application/rtf', kind: 'other' },
  epub: { mime: 'application/epub+zip', kind: 'other' },
  zip: { mime: 'application/zip', kind: 'other' },
};

export const MAX_ATTACHMENT_BYTES = 50 * 1024 * 1024;
export const MAX_MEDIA_BYTES = 500 * 1024 * 1024;

export const extOf = (name: string) => (/\.([a-z0-9]+)$/i.exec(name)?.[1] ?? '').toLowerCase();
export const attachmentKind = (name: string): AttachmentKind | null => ATTACHMENT_TYPES[extOf(name)]?.kind ?? null;
export const isPlayable = (name: string) => {
  const k = attachmentKind(name);
  return k === 'video' || k === 'audio';
};
/** Largest size allowed for this file. */
export const maxBytesFor = (name: string) => (isPlayable(name) ? MAX_MEDIA_BYTES : MAX_ATTACHMENT_BYTES);

/** Kinds as a readable list, for messages. */
export const ATTACHABLE_DESCRIPTION = 'images, PDFs, video (MP4, MOV, WebM), audio (MP3, M4A, WAV, OGG, FLAC) and documents (Word, Excel, PowerPoint, OpenDocument, text, Markdown, CSV, JSON, notebooks, EPUB, ZIP)';

// ---------------------------------------------------------------- resources

type ResourceKind = 'article' | 'video' | 'book' | 'course' | 'docs' | 'tool' | 'other';

/** A sensible resource type from a link's address. */
export function guessResourceKind(href: string): ResourceKind | null {
  let host = '';
  let p = '';
  try {
    const u = new URL(href);
    host = u.hostname.toLowerCase().replace(/^www\./, '');
    p = u.pathname.toLowerCase();
  } catch {
    return null;
  }
  if (parseEmbed(href) || /(^|\.)(youtube\.com|youtu\.be|vimeo\.com|loom\.com|ted\.com)$/.test(host) || /\.(mp4|webm|mov)$/.test(p)) return 'video';
  if (/(^|\.)(coursera\.org|udemy\.com|edx\.org|khanacademy\.org|udacity\.com|freecodecamp\.org)$/.test(host) || host.startsWith('course.') || (host === 'kaggle.com' && p.startsWith('/learn'))) return 'course';
  if (host.startsWith('docs.') || host.startsWith('developer.') || host === 'readthedocs.io' || host.endsWith('.readthedocs.io') || /\/(docs?|documentation|reference|api)(\/|$)/.test(p)) return 'docs';
  if (host === 'github.com' || host === 'gitlab.com' || host === 'colab.research.google.com' || host === 'huggingface.co') return 'tool';
  if (/(^|\.)(arxiv\.org|medium\.com|substack\.com|dev\.to)$/.test(host) || p.endsWith('.pdf')) return 'article';
  return null;
}
