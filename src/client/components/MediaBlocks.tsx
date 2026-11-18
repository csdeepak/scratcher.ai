// Media in the reading view of notes (docs/MEDIA.md). The Markdown stays plain: a YouTube, Vimeo or
// Loom link on its own line becomes a "Play" card, and a link to an attached video or audio file on
// its own line becomes a player. Nothing loads from the internet until the user presses play (the
// lite-youtube-embed "facade" pattern).

import { useState, type MouseEvent } from 'react';
import { Expand, ExternalLink, Music, Play } from 'lucide-react';
import { fileUrl, openEmbed, openViewer } from '../attachments';
import { attachmentRel } from '../../shared/exporters';
import { attachmentKind, formatTimestamp, parseEmbed, type Embed } from '../../shared/media';
import { EmbedFrame } from './Viewer';

const stop = (e: MouseEvent) => e.stopPropagation();
const PROVIDER = { youtube: 'YouTube', vimeo: 'Vimeo', loom: 'Loom' } as const;

export function EmbedCard({ embed, title }: { embed: Embed; title: string }) {
  const [playing, setPlaying] = useState(false);
  const name = title && title !== embed.watchUrl && !/^https?:\/\//.test(title) ? title : embed.label;
  if (playing) {
    return (
      <div className="my-2" onClick={stop}>
        <EmbedFrame embed={embed} title={name} className="aspect-video w-full rounded-lg border border-line bg-black" />
        <div className="mt-1 flex items-center gap-3 text-[11.5px] text-muted">
          <button className="inline-flex items-center gap-1 hover:text-fg" onClick={() => openEmbed(embed, name)}>
            <Expand size={12} /> Bigger
          </button>
          <a className="inline-flex items-center gap-1 hover:text-fg" href={embed.watchUrl} target="_blank" rel="noreferrer noopener">
            <ExternalLink size={12} /> Open on {PROVIDER[embed.provider]}
          </a>
        </div>
      </div>
    );
  }
  return (
    <span className="my-2 flex items-center gap-3 rounded-xl border border-line bg-surface-2 p-2.5" onClick={stop}>
      <button
        className="flex size-11 flex-none items-center justify-center rounded-full bg-[#e5372f] text-white shadow-sm hover:brightness-110"
        aria-label={`Play ${name}${embed.start ? ` from ${formatTimestamp(embed.start)}` : ''}`}
        onClick={() => setPlaying(true)}
      >
        <Play size={18} fill="currentColor" />
      </button>
      <span className="min-w-0 flex-1">
        <span dir="auto" className="block truncate text-[13px] font-medium text-fg">
          {name}
        </span>
        <span className="block text-[11.5px] text-faint">
          {PROVIDER[embed.provider]}
          {embed.start ? ` · from ${formatTimestamp(embed.start)}` : ''} · plays here; loads from {PROVIDER[embed.provider]} when you press play
        </span>
      </span>
      <a className="flex-none rounded p-1 text-muted hover:bg-surface-3 hover:text-fg" href={embed.watchUrl} target="_blank" rel="noreferrer noopener" aria-label={`Open on ${PROVIDER[embed.provider]}`} title={`Open on ${PROVIDER[embed.provider]}`}>
        <ExternalLink size={14} />
      </a>
    </span>
  );
}

/** A player for an attached video or audio file, right in the note. */
export function InlinePlayer({ roadmapId, rel, label }: { roadmapId: string; rel: string; label: string }) {
  const kind = attachmentKind(rel);
  const src = fileUrl(roadmapId, rel);
  if (kind === 'video') {
    return (
      <span className="my-2 block" onClick={stop}>
        <video src={src} controls preload="metadata" className="max-h-[60vh] w-full rounded-lg border border-line bg-black" aria-label={label} />
        <button className="mt-1 inline-flex items-center gap-1 text-[11.5px] text-muted hover:text-fg" onClick={() => openViewer(roadmapId, rel, label)}>
          <Expand size={12} /> Bigger
        </button>
      </span>
    );
  }
  return (
    <span className="my-2 flex items-center gap-2.5 rounded-xl border border-line bg-surface-2 p-2" onClick={stop}>
      <Music size={18} className="flex-none text-muted" />
      <span className="min-w-0 flex-1">
        <span dir="auto" className="block truncate text-[12.5px] font-medium">
          {label}
        </span>
        <audio src={src} controls preload="metadata" className="mt-1 h-9 w-full" aria-label={label} />
      </span>
    </span>
  );
}

/**
 * What a link standing alone on its line should become: a video card, an inline player, or nothing
 * (stays a normal link). `text` is the link's visible text.
 */
export function mediaForLink(href: string, text: string, roadmapId?: string) {
  const embed = parseEmbed(href);
  if (embed) return <EmbedCard embed={embed} title={text} />;
  const rel = attachmentRel(href);
  const kind = rel ? attachmentKind(rel) : null;
  if (rel && roadmapId && (kind === 'video' || kind === 'audio')) return <InlinePlayer roadmapId={roadmapId} rel={rel} label={text || rel.split('/').pop() || rel} />;
  return null;
}
