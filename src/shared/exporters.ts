// Export a roadmap (or one branch of it) as Markdown, a print-ready HTML document (→ PDF via the
// browser's "Save as PDF"), or OPML for mind-map and outliner tools. The JSON bundle lives in bundle.ts.

import { micromark } from 'micromark';
import { gfm, gfmHtml } from 'micromark-extension-gfm';
import { ALL_SECTIONS, type Checkpoint, type Roadmap, type SectionKey } from './model';
import { SECTION_DEFS, UNDERSTANDING_LEVELS, getProfile, statusDef } from './profiles';
import { childrenIndex, computeProgress, type Progress } from './tree';

export interface ExportOptions {
  /** Export only this checkpoint and everything below it. */
  branch?: string | null;
  /** Include your own sections (notes, takeaways, own words, evidence, what I know). Default true. */
  personal?: boolean;
  /** Include archived checkpoints. Default false. */
  archived?: boolean;
}

interface Node {
  cp: Checkpoint;
  depth: number;
  number: string;
  children: Node[];
}

function buildTree(rm: Roadmap, opts: ExportOptions): Node[] {
  const idx = childrenIndex(rm.checkpoints);
  const keep = (c: Checkpoint) => opts.archived || !c.archived;
  const walk = (cp: Checkpoint, depth: number, number: string): Node => ({
    cp,
    depth,
    number,
    children: (idx.get(cp.id) ?? []).filter(keep).map((c, i) => walk(c, depth + 1, `${number}.${i + 1}`)),
  });
  if (opts.branch && rm.checkpoints[opts.branch]) return [walk(rm.checkpoints[opts.branch]!, 0, '1')];
  return (idx.get('') ?? []).filter(keep).map((c, i) => walk(c, 0, String(i + 1)));
}

function sectionsFor(rm: Roadmap, cp: Checkpoint, opts: ExportOptions): [SectionKey, string][] {
  const profile = getProfile(rm.meta.profile);
  const keys: SectionKey[] = [...profile.sections];
  for (const k of ALL_SECTIONS) if (!keys.includes(k) && cp.sections[k]?.trim()) keys.push(k);
  return keys
    .filter((k) => cp.sections[k]?.trim())
    .filter((k) => opts.personal !== false || SECTION_DEFS[k].owner !== 'human')
    .map((k) => [k, cp.sections[k]!.trim()]);
}

/** Shift headings inside embedded Markdown so the shallowest one becomes `min` (outside code fences). */
export function shiftHeadings(md: string, min: number): string {
  const lines = md.split('\n');
  let fence: string | null = null;
  let shallowest = 7;
  const isFence = (l: string) => l.match(/^\s{0,3}(`{3,}|~{3,})/)?.[1] ?? null;
  for (const l of lines) {
    const f = isFence(l);
    if (f) fence = fence === null ? f : l.trim() === fence || l.trim().startsWith(fence) ? null : fence;
    else if (fence === null) {
      const m = l.match(/^(#{1,6})\s/);
      if (m) shallowest = Math.min(shallowest, m[1]!.length);
    }
  }
  if (shallowest === 7) return md;
  const by = Math.max(0, min - shallowest);
  fence = null;
  return lines
    .map((l) => {
      const f = isFence(l);
      if (f) {
        fence = fence === null ? f : l.trim() === fence || l.trim().startsWith(fence) ? null : fence;
        return l;
      }
      if (fence !== null) return l;
      return l.replace(/^(#{1,6})(\s)/, (_m, h: string, sp: string) => '#'.repeat(Math.min(6, h.length + by)) + sp);
    })
    .join('\n');
}

function progressLine(p: Progress | undefined): string {
  return p && p.total ? `${p.done} of ${p.total} complete` : '';
}

// ------------------------------------------------------------------ Markdown

export function toMarkdown(rm: Roadmap, opts: ExportOptions = {}): string {
  const profile = getProfile(rm.meta.profile);
  const progress = computeProgress(rm.checkpoints, rm.meta);
  const tree = buildTree(rm, opts);
  const branch = opts.branch ? rm.checkpoints[opts.branch] : null;
  const out: string[] = [];
  out.push(`# ${branch ? `${rm.meta.title}: ${branch.title}` : rm.meta.title}`, '');
  if (rm.meta.description && !branch) out.push(rm.meta.description, '');
  const total = branch ? progress.get(branch.id) : progress.get(null);
  out.push(`_Exported from Waymark on ${new Date().toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' })}${total?.total ? ` · ${progressLine(total)}` : ''}_`, '');
  if (rm.meta.overview.trim() && !branch) out.push('## Goal and context', '', shiftHeadings(rm.meta.overview.trim(), 3), '');

  out.push('## Outline', '');
  const outline = (nodes: Node[], indent: number) => {
    for (const n of nodes) {
      const st = statusDef(profile, n.cp.status);
      const note = st.category === 'done' || st.category === 'todo' ? '' : ` _(${st.label})_`;
      out.push(`${'  '.repeat(indent)}- [${st.category === 'done' ? 'x' : ' '}] ${n.number}. ${n.cp.title}${n.cp.optional ? ' _(optional)_' : ''}${note}`);
      outline(n.children, indent + 1);
    }
  };
  outline(tree, 0);
  out.push('');

  const write = (n: Node) => {
    const cp = n.cp;
    const level = Math.min(6, 2 + n.depth);
    const st = statusDef(profile, cp.status);
    out.push(`${'#'.repeat(level)} ${n.number}. ${cp.title}`, '');
    const meta = [`Status: ${st.label}`];
    if (profile.understanding && cp.understanding && cp.understanding !== 'not-yet') meta.push(`Understanding: ${UNDERSTANDING_LEVELS.find((u) => u.key === cp.understanding)?.short}`);
    if (cp.optional) meta.push('Optional');
    const p = progress.get(cp.id);
    if (p?.total) meta.push(`Sub-checkpoints: ${progressLine(p)}`);
    out.push(`_${meta.join(' · ')}_`, '');
    if (cp.summary) out.push(cp.summary, '');
    if (cp.completion) out.push(`**Done when:** ${cp.completion}`, '');
    const req = cp.prerequisites.map((id) => rm.checkpoints[id]?.title).filter(Boolean);
    if (req.length) out.push(`**Requires:** ${req.join(', ')}`, '');
    for (const [k, text] of sectionsFor(rm, cp, opts)) {
      out.push(`**${SECTION_DEFS[k].label}**`, '', shiftHeadings(text, Math.min(6, level + 1)), '');
    }
    if (cp.resources.length) {
      out.push('**Resources**', '');
      for (const r of cp.resources) {
        const bits = [r.kind, r.start ? `from ${r.start}` : '', r.note ?? ''].filter(Boolean).join(' · ');
        out.push(`- [${r.title}](${r.url})${bits ? ` — ${bits}` : ''}`);
      }
      out.push('');
    }
    for (const c of n.children) write(c);
  };
  for (const n of tree) write(n);
  return out.join('\n').replace(/\n{3,}/g, '\n\n').trimEnd() + '\n';
}

// ------------------------------------------------------------------ HTML (print → PDF)

const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const renderMd = (s: string) => micromark(s, { extensions: [gfm()], htmlExtensions: [gfmHtml()] });

const STATUS_COLORS: Record<string, [string, string]> = {
  todo: ['#f5f2ea', '#57534e'],
  active: ['#dbeafe', '#1d4ed8'],
  review: ['#fdecc8', '#b45309'],
  done: ['#dcfce7', '#15803d'],
};

/** "../attachments/x.png" or "attachments/x.png" (as written in a checkpoint) → path inside the roadmap. */
export function attachmentRel(src: string): string | null {
  const m = src.match(/^(?:\.\.\/)?(attachments\/[^?#]+)/);
  return m ? decodeURI(m[1]!) : null;
}

export function toHtml(rm: Roadmap, opts: ExportOptions & { print?: boolean; asset?: (rel: string) => { src: string; embedded: boolean } | null } = {}): string {
  const resolve = (url: string) => {
    const rel = attachmentRel(url);
    if (!rel || !opts.asset) return url;
    return opts.asset(rel)?.src ?? url;
  };
  const md = (text: string) => renderMd(text).replace(/(<img[^>]*?\ssrc=")([^"]+)(")/g, (_m, a: string, src: string, b: string) => a + resolve(src.replace(/&amp;/g, '&')) + b).replace(/(<a[^>]*?\shref=")([^"]+)(")/g, (_m, a: string, href: string, b: string) => a + resolve(href.replace(/&amp;/g, '&')) + b);
  const profile = getProfile(rm.meta.profile);
  const progress = computeProgress(rm.checkpoints, rm.meta);
  const tree = buildTree(rm, opts);
  const branch = opts.branch ? rm.checkpoints[opts.branch] : null;
  const title = branch ? `${rm.meta.title}: ${branch.title}` : rm.meta.title;
  const total = (branch ? progress.get(branch.id) : progress.get(null)) ?? { total: 0, done: 0, active: 0, review: 0 };
  const pct = total.total ? Math.round((total.done / total.total) * 100) : 0;
  const date = new Date().toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' });
  const chip = (cp: Checkpoint) => {
    const st = statusDef(profile, cp.status);
    const [bg, fg] = STATUS_COLORS[st.category]!;
    return `<span class="chip" style="background:${bg};color:${fg}">${esc(st.label)}</span>`;
  };

  const toc = (nodes: Node[]): string =>
    nodes.length
      ? `<ul>${nodes.map((n) => `<li><a href="#${esc(n.cp.id)}"><span class="num">${n.number}</span> ${esc(n.cp.title)}</a> ${chip(n.cp)}${toc(n.children)}</li>`).join('')}</ul>`
      : '';

  const block = (n: Node): string => {
    const cp = n.cp;
    const h = Math.min(6, 2 + n.depth);
    const p = progress.get(cp.id);
    const meta: string[] = [chip(cp)];
    if (profile.understanding && cp.understanding && cp.understanding !== 'not-yet') meta.push(`<span class="chip und">${esc(UNDERSTANDING_LEVELS.find((u) => u.key === cp.understanding)?.short ?? '')}</span>`);
    if (cp.optional) meta.push('<span class="chip opt">Optional</span>');
    if (p?.total) meta.push(`<span class="muted">${esc(progressLine(p))}</span>`);
    const req = cp.prerequisites.map((id) => rm.checkpoints[id]).filter(Boolean) as Checkpoint[];
    const parts = [
      `<section class="cp depth-${Math.min(n.depth, 3)}" id="${esc(cp.id)}">`,
      `<h${h}><span class="num">${n.number}</span> ${esc(cp.title)}</h${h}>`,
      `<div class="meta">${meta.join(' ')}</div>`,
      cp.summary ? `<p class="summary">${esc(cp.summary)}</p>` : '',
      cp.completion ? `<p class="done-when"><b>Done when:</b> ${esc(cp.completion)}</p>` : '',
      req.length ? `<p class="requires"><b>Requires:</b> ${req.map((r) => `<a href="#${esc(r.id)}">${esc(r.title)}</a>`).join(', ')}</p>` : '',
      ...sectionsFor(rm, cp, opts).map(
        ([k, text]) =>
          `<div class="section ${SECTION_DEFS[k].owner === 'human' ? 'mine' : ''}"><div class="label">${esc(SECTION_DEFS[k].label)}</div><div class="body">${md(shiftHeadings(text, Math.min(6, h + 1)))}</div></div>`,
      ),
      cp.resources.length
        ? `<div class="section"><div class="label">Resources</div><ul class="resources">${cp.resources
            .map(
              (r) =>
                `<li><a href="${esc(r.url)}">${esc(r.title)}</a>${r.kind ? ` <span class="muted">${esc(r.kind)}</span>` : ''}${r.start ? ` <span class="ts">▶ ${esc(r.start)}</span>` : ''}${r.note ? `<div class="muted">${esc(r.note)}</div>` : ''}<div class="url">${esc(r.url)}</div></li>`,
            )
            .join('')}</ul></div>`
        : '',
      '</section>',
      ...n.children.map(block),
    ];
    return parts.filter(Boolean).join('\n');
  };

  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>${esc(title)}</title>
<style>
  :root { --ink:#1c1917; --muted:#57534e; --line:#e6e1d6; --paper:#fbfaf6; --main:#fde68a; --blue:#2563eb; }
  * { box-sizing: border-box; }
  body { margin:0; background:var(--paper); color:var(--ink); font: 15px/1.6 'IBM Plex Sans', 'Segoe UI', system-ui, -apple-system, sans-serif; }
  main { max-width: 820px; margin: 0 auto; padding: 32px 40px 80px; background:#fff; min-height:100vh; }
  .toolbar { position: sticky; top:0; display:flex; gap:12px; align-items:center; justify-content:center; padding:10px; background:#1f2937; color:#fff; font-size:13px; }
  .toolbar button { font: inherit; font-weight:600; background:var(--main); color:var(--ink); border:2px solid #000; border-radius:6px; padding:6px 14px; cursor:pointer; }
  .cover { border-bottom: 3px solid var(--ink); padding-bottom: 20px; margin-bottom: 24px; }
  .cover .kicker { display:inline-block; background:var(--main); border:2px solid var(--ink); border-radius:5px; padding:1px 8px; font-size:12px; font-weight:600; }
  h1 { font-size: 32px; line-height:1.15; margin: 12px 0 6px; letter-spacing:-0.02em; }
  .desc { color: var(--muted); font-size: 16px; margin: 0 0 14px; }
  .bar { height: 10px; border:1.5px solid var(--ink); border-radius: 6px; overflow:hidden; background:#fff; max-width:360px; }
  .bar > div { height:100%; background:#22c55e; }
  .muted { color: var(--muted); font-size: 13px; }
  h2.part { font-size: 20px; margin: 28px 0 10px; }
  .toc ul { list-style:none; padding-left: 18px; margin: 4px 0; }
  .toc > ul { padding-left: 0; }
  .toc li { margin: 3px 0; }
  .toc a { color: var(--ink); text-decoration:none; }
  .num { color: var(--blue); font-weight:600; font-variant-numeric: tabular-nums; margin-right: 4px; }
  .chip { display:inline-block; font-size: 11.5px; font-weight:600; border-radius: 4px; padding: 0 6px; line-height: 18px; vertical-align: 1px; }
  .chip.und { background:#ede9fe; color:#6d28d9; } .chip.opt { background:#f5f5f4; color:#57534e; border:1px dashed #a8a29e; }
  .cp { margin: 0 0 22px; }
  .cp.depth-0 { border-top: 3px solid var(--ink); padding-top: 14px; margin-top: 28px; }
  .cp.depth-0 > h2 { background: var(--main); border: 2px solid var(--ink); border-radius: 6px; padding: 6px 12px; display: inline-block; }
  .cp h2, .cp h3, .cp h4, .cp h5, .cp h6 { margin: 0 0 6px; line-height: 1.25; }
  .cp h3 { font-size: 18px; } .cp h4 { font-size: 16px; } .cp h5, .cp h6 { font-size: 15px; }
  .meta { margin-bottom: 8px; display:flex; gap:6px; flex-wrap:wrap; align-items:center; }
  .summary { font-size: 15.5px; margin: 6px 0; }
  .done-when, .requires { margin: 4px 0; font-size: 14px; }
  .section { margin: 12px 0; }
  .section .label { font-size: 12px; font-weight: 700; color: var(--muted); margin-bottom: 2px; }
  .section.mine .body { border-left: 3px solid var(--main); padding-left: 10px; }
  .body > :first-child { margin-top:0; } .body > :last-child { margin-bottom:0; }
  .body h3, .body h4, .body h5, .body h6 { font-size: 15px; margin: 12px 0 4px; }
  pre { background:#f6f4ee; border:1px solid var(--line); border-radius:6px; padding:10px 12px; overflow-x:auto; font-size: 12.5px; white-space: pre-wrap; }
  code { font-family: 'IBM Plex Mono', Consolas, Menlo, monospace; font-size: 0.9em; }
  table { border-collapse: collapse; margin: 8px 0; font-size: 14px; } th, td { border:1px solid var(--line); padding: 4px 8px; text-align:left; }
  blockquote { margin: 8px 0; padding-left: 12px; border-left: 3px solid var(--line); color: var(--muted); }
  a { color: var(--blue); }
  .resources { padding-left: 18px; } .resources li { margin: 4px 0; }
  .resources .url { display:none; font-size: 11px; color: var(--muted); word-break: break-all; }
  .ts { font-size: 12px; font-weight:600; color: var(--blue); }
  footer { margin-top: 40px; color: var(--muted); font-size: 12px; border-top:1px solid var(--line); padding-top: 10px; }
  @page { size: A4; margin: 16mm 14mm; }
  @media print {
    body { background: #fff; }
    .toolbar { display:none; }
    main { padding: 0; max-width: none; }
    .cp.depth-0 { break-before: page; border-top: none; margin-top: 0; }
    .cp, .section, pre, table, li { break-inside: avoid-page; }
    h2, h3, h4 { break-after: avoid-page; }
    .resources .url { display:block; }
    a { color: var(--ink); }
    .chip, .bar > div, .cp.depth-0 > h2 { -webkit-print-color-adjust: exact; print-color-adjust: exact; }
  }
</style>
</head>
<body>
<div class="toolbar"><span>Choose <b>Save as PDF</b> as the printer to keep a PDF copy.</span><button onclick="window.print()">Save as PDF / Print</button></div>
<main>
  <header class="cover">
    <span class="kicker">${esc(profile.label)} roadmap</span>
    <h1>${esc(title)}</h1>
    ${rm.meta.description && !branch ? `<p class="desc">${esc(rm.meta.description)}</p>` : ''}
    ${total.total ? `<div class="bar"><div style="width:${pct}%"></div></div><div class="muted">${total.done} of ${total.total} complete (${pct}%) · exported ${esc(date)}</div>` : `<div class="muted">Exported ${esc(date)}</div>`}
  </header>
  ${rm.meta.overview.trim() && !branch ? `<h2 class="part">Goal and context</h2><div class="body">${md(shiftHeadings(rm.meta.overview.trim(), 3))}</div>` : ''}
  <h2 class="part">Contents</h2>
  <nav class="toc">${toc(tree)}</nav>
  ${tree.map(block).join('\n')}
  <footer>Made with Waymark · ${esc(rm.meta.id)}${opts.personal === false ? ' · personal notes left out' : ''}</footer>
</main>
${opts.print ? '<script>window.addEventListener("load", () => setTimeout(() => window.print(), 350));</script>' : ''}
</body>
</html>
`;
}

// ------------------------------------------------------------------ OPML (mind maps, outliners)

const xml = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/\n/g, '&#10;');

export function toOpml(rm: Roadmap, opts: ExportOptions = {}): string {
  const profile = getProfile(rm.meta.profile);
  const tree = buildTree(rm, opts);
  const outline = (n: Node, indent: string): string => {
    const cp = n.cp;
    const note = [cp.summary, cp.sections.content ?? ''].filter((x) => x.trim()).join('\n\n');
    const attrs = [
      `text="${xml(cp.title)}"`,
      note ? `_note="${xml(note)}"` : '',
      `_status="${xml(statusDef(profile, cp.status).label)}"`,
      `_id="${xml(cp.id)}"`,
      cp.optional ? '_optional="true"' : '',
    ]
      .filter(Boolean)
      .join(' ');
    if (!n.children.length) return `${indent}<outline ${attrs}/>`;
    return `${indent}<outline ${attrs}>\n${n.children.map((c) => outline(c, indent + '  ')).join('\n')}\n${indent}</outline>`;
  };
  return `<?xml version="1.0" encoding="UTF-8"?>
<opml version="2.0">
  <head>
    <title>${xml(rm.meta.title)}</title>
    <dateCreated>${new Date().toUTCString()}</dateCreated>
  </head>
  <body>
${tree.map((n) => outline(n, '    ')).join('\n')}
  </body>
</opml>
`;
}
