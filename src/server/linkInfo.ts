// Title, site, type and start time of a web link, for a checkpoint's Resources (docs/MEDIA.md).
// YouTube and Vimeo answer through their official oEmbed endpoints; other pages are read for
// og:title / twitter:title / <title> with htmlparser2. Runs only when the user adds a link, with a
// 5 s timeout and at most the first 1 MB of the page.

import { Parser } from 'htmlparser2';
import { guessResourceKind, parseEmbed } from '../shared/media';

export interface LinkInfo {
  url: string;
  title?: string;
  site?: string;
  kind?: string;
  /** Seconds, for videos linked at a time. */
  start?: number;
}

const tidy = (s: string) => s.replace(/\s+/g, ' ').trim().slice(0, 300);

/** The page's title and site name from its HTML (Open Graph and Twitter tags first, then <title>). */
export function readPageMeta(html: string): { title?: string; site?: string } {
  let title = '';
  let og = '';
  let tw = '';
  let site = '';
  let inTitle = false;
  const parser = new Parser(
    {
      onopentag(name, attrs) {
        if (name === 'title') inTitle = true;
        if (name !== 'meta') return;
        const key = (attrs.property || attrs.name || '').toLowerCase();
        const value = attrs.content ?? '';
        if (key === 'og:title' && !og) og = value;
        else if (key === 'twitter:title' && !tw) tw = value;
        else if (key === 'og:site_name' && !site) site = value;
      },
      ontext(text) {
        if (inTitle) title += text;
      },
      onclosetag(name) {
        if (name === 'title') inTitle = false;
      },
    },
    { decodeEntities: true },
  );
  parser.write(html);
  parser.end();
  const best = tidy(og) || tidy(tw) || tidy(title);
  return { ...(best ? { title: best } : {}), ...(tidy(site) ? { site: tidy(site) } : {}) };
}

async function fetchStart(url: string, limit: number, accept: string): Promise<{ text: string; type: string }> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 5000);
  try {
    const res = await fetch(url, {
      signal: ctrl.signal,
      redirect: 'follow',
      headers: { 'User-Agent': 'Mozilla/5.0 (compatible; Waymark link titles)', Accept: accept, 'Accept-Language': 'en;q=0.9, *;q=0.5' },
    });
    if (!res.ok || !res.body) throw new Error(`the site answered ${res.status}`);
    const reader = res.body.getReader();
    const chunks: Uint8Array[] = [];
    let size = 0;
    while (size < limit) {
      const { done, value } = await reader.read();
      if (done) break;
      chunks.push(value);
      size += value.length;
    }
    await reader.cancel().catch(() => {});
    const all = new Uint8Array(Math.min(size, limit));
    let at = 0;
    for (const c of chunks) {
      const part = c.subarray(0, Math.min(c.length, all.length - at));
      all.set(part, at);
      at += part.length;
      if (at >= all.length) break;
    }
    return { text: new TextDecoder().decode(all), type: res.headers.get('content-type') ?? '' };
  } catch (e) {
    throw new Error(ctrl.signal.aborted ? 'the site took too long to answer' : (e as Error).message);
  } finally {
    clearTimeout(timer);
  }
}

export async function linkInfo(raw: string): Promise<LinkInfo> {
  const url = new URL(raw.trim());
  if (url.protocol !== 'https:' && url.protocol !== 'http:') throw new Error('only web links (http or https) can be looked up');
  const embed = parseEmbed(url.href);
  const out: LinkInfo = { url: url.href };
  const kind = guessResourceKind(url.href);
  if (kind) out.kind = kind;
  if (embed?.start) out.start = embed.start;

  const oembed =
    embed?.provider === 'youtube'
      ? `https://www.youtube.com/oembed?format=json&url=${encodeURIComponent(`https://www.youtube.com/watch?v=${embed.id}`)}`
      : embed?.provider === 'vimeo'
        ? `https://vimeo.com/api/oembed.json?url=${encodeURIComponent(`https://vimeo.com/${embed.id}`)}`
        : null;
  if (oembed) {
    const { text } = await fetchStart(oembed, 256 * 1024, 'application/json');
    const j = JSON.parse(text) as { title?: string; provider_name?: string; author_name?: string };
    if (j.title) out.title = tidy(j.title);
    const site = [j.provider_name, j.author_name].filter(Boolean).join(' · ');
    if (site) out.site = site;
    return out;
  }

  const { text, type } = await fetchStart(url.href, 1024 * 1024, 'text/html,application/xhtml+xml;q=0.9,*/*;q=0.5');
  if (/html|xml/i.test(type) || /<(html|head|title)\b/i.test(text)) Object.assign(out, readPageMeta(text));
  if (!out.site) out.site = url.hostname.replace(/^www\./, '');
  return out;
}
