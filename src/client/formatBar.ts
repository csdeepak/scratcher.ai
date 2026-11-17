// The notes formatting bar (Crepe's top bar), arranged the way you set it in "Customise toolbar"
// (toolbars.ts) and kept on one row like Google Docs. Crepe renders every item once, in a fixed
// order; this shows the ones on your bar in your order with CSS `order` (so Crepe's own rendering
// is never disturbed), draws a divider between groups, and moves what doesn't fit, or isn't on your
// bar, into a "⋯" menu at the end. Right-clicking the bar opens the same menu.

import type { Ctx } from '@milkdown/kit/ctx';
import { useStore } from './store';
import { barItem, barLayout, customiseToolbar, groupStarts, itemTitle, offBar } from './toolbars';

/** What an item does, so the ⋯ menu can run it: a button, or a list of options. */
export interface BarCommand {
  run?: (ctx: Ctx) => void;
  options?: { label: string; run: (ctx: Ctx) => void }[];
}

/** With the default layout, what gives way first when the panel is narrow (least-used first). */
const DEFAULT_DROP = ['strikethrough', 'code', 'task-list', 'ordered-list', 'link', 'bullet-list', 'italic', 'bold', 'insert', 'heading'];

const DOTS =
  '<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="5" cy="12" r="1.8"/><circle cx="12" cy="12" r="1.8"/><circle cx="19" cy="12" r="1.8"/></svg>';
const SLIDERS =
  '<svg class="wm-stroke" viewBox="0 0 24 24" aria-hidden="true"><path d="M4 6h9M17 6h3M4 12h3M11 12h9M4 18h11M19 18h1"/><circle cx="15" cy="6" r="2"/><circle cx="9" cy="12" r="2"/><circle cx="17" cy="18" r="2"/></svg>';

/**
 * @param built ids of the items Crepe rendered, in the order it rendered them
 * @param commands what each item does
 * @param exec runs a command in this editor
 */
export function manageFormatBar(
  bar: HTMLElement,
  built: string[],
  commands: Map<string, BarCommand>,
  exec: (fn: (ctx: Ctx) => void) => void,
): () => void {
  const inner = bar.querySelector<HTMLElement>('.top-bar-inner');
  if (!inner) return () => {};

  const more = document.createElement('button');
  more.type = 'button';
  more.className = 'top-bar-item wm-bar-more';
  more.title = 'More formatting';
  more.setAttribute('aria-label', 'More formatting');
  more.setAttribute('aria-haspopup', 'menu');
  more.setAttribute('aria-expanded', 'false');
  more.innerHTML = DOTS;
  bar.appendChild(more);

  /** The bar's items, each tagged with its id and named for tooltips and screen readers. */
  const items = (): HTMLElement[] => {
    const els = ([...inner.children] as HTMLElement[]).filter((c) => !c.classList.contains('top-bar-divider'));
    els.forEach((el, i) => {
      const id = built[i];
      if (!id || el.dataset.wmItem === id) return;
      el.dataset.wmItem = id;
      const item = barItem('notes', id);
      const target = el.matches('button') ? el : el.querySelector<HTMLElement>('button');
      if (!item || !target) return;
      target.setAttribute('aria-label', itemTitle(item));
      target.title = itemTitle(item);
    });
    return els;
  };
  const shown = (el: HTMLElement) => el.style.display !== 'none';

  // ---------------------------------------------------------------- the ⋯ menu
  let menu: HTMLElement | null = null;
  const closeMenu = () => {
    menu?.remove();
    menu = null;
    more.setAttribute('aria-expanded', 'false');
  };
  const entry = (icon: string, label: string, opts: { active?: boolean; sub?: boolean; onRun: () => void; onClick?: boolean }) => {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = ['wm-bar-menu-item', opts.active && 'active', opts.sub && 'wm-bar-menu-sub'].filter(Boolean).join(' ');
    b.setAttribute('role', 'menuitem');
    if (icon) b.innerHTML = icon; // Crepe's own icon, or ours above
    const name = document.createElement('span');
    name.textContent = label;
    b.appendChild(name);
    if (opts.onClick) {
      b.addEventListener('click', () => {
        closeMenu();
        opts.onRun();
      });
    } else {
      // Pointer-down like Crepe's own buttons, so the text selection stays put.
      b.addEventListener('pointerdown', (e) => {
        e.preventDefault();
        e.stopPropagation();
        closeMenu();
        opts.onRun();
      });
    }
    return b;
  };

  const openMenu = () => {
    closeMenu();
    const m = document.createElement('div');
    m.className = 'wm-bar-menu';
    m.setAttribute('role', 'menu');
    const els = items();
    const el = (id: string) => els.find((e) => e.dataset.wmItem === id);
    const layout = barLayout('notes');
    // What didn't fit (in bar order), then what isn't on the bar (in the usual order).
    const ids = [...layout.filter((id) => el(id) && !shown(el(id)!)), ...offBar('notes', layout)];
    for (const id of ids) {
      const item = barItem('notes', id);
      const cmd = commands.get(id);
      if (!item || !cmd) continue;
      // Image, table and the rest are always in the Insert list, on the bar or here.
      if (item.group === 'blocks') continue;
      if (cmd.options) {
        const head = document.createElement('div');
        head.className = 'wm-bar-menu-label';
        head.textContent = item.label;
        m.appendChild(head);
        const current = el(id)?.querySelector('.top-bar-heading-label')?.textContent ?? '';
        for (const o of cmd.options) m.appendChild(entry('', o.label, { sub: true, active: id === 'heading' && o.label === current, onRun: () => exec(o.run) }));
      } else if (cmd.run) {
        const button = el(id);
        m.appendChild(entry(button?.innerHTML ?? '', item.label, { active: !!button?.classList.contains('active'), onRun: () => exec(cmd.run!) }));
      }
    }
    if (m.childElementCount) {
      const sep = document.createElement('div');
      sep.className = 'wm-bar-menu-sep';
      m.appendChild(sep);
    }
    m.appendChild(entry(SLIDERS, 'Customise toolbar…', { onClick: true, onRun: () => customiseToolbar('notes') }));
    bar.appendChild(m);
    menu = m;
    more.setAttribute('aria-expanded', 'true');
  };

  const onMore = (e: PointerEvent) => {
    e.preventDefault();
    e.stopPropagation();
    if (menu) closeMenu();
    else openMenu();
  };
  more.addEventListener('pointerdown', onMore);
  const onContext = (e: MouseEvent) => {
    if (menu?.contains(e.target as Node)) return;
    e.preventDefault();
    openMenu();
  };
  bar.addEventListener('contextmenu', onContext);
  const onOutside = (e: PointerEvent) => {
    if (menu && !menu.contains(e.target as Node) && !more.contains(e.target as Node)) closeMenu();
  };
  window.addEventListener('pointerdown', onOutside, true);

  // ---------------------------------------------------------------- layout
  const oneRow = (els: HTMLElement[]) => {
    const vis = els.filter(shown);
    if (!vis.length) return true;
    const top = Math.min(...vis.map((v) => v.offsetTop));
    return vis.every((v) => v.offsetTop - top < 8);
  };

  const apply = () => {
    closeMenu();
    const els = items();
    const layout = barLayout('notes');
    const pos = new Map(layout.map((id, i) => [id, i]));
    const starts = groupStarts('notes', layout);
    for (const el of els) {
      const id = el.dataset.wmItem ?? '';
      const i = pos.get(id);
      el.style.order = String(i ?? layout.length);
      el.style.display = i === undefined ? 'none' : '';
      el.toggleAttribute('data-wm-gap', i !== undefined && starts.has(id));
      el.removeAttribute('data-wm-right');
    }
    // Keep one row. Your own layout gives way from the end of your list; the default one hides the
    // least-used buttons first.
    const custom = !!useStore.getState().toolbars.notes;
    const dropOrder = custom ? [...layout].reverse() : [...DEFAULT_DROP.filter((id) => pos.has(id)), ...[...layout].reverse()];
    for (const id of dropOrder) {
      if (oneRow(els)) break;
      const el = els.find((e) => e.dataset.wmItem === id);
      if (el) el.style.display = 'none';
    }
    const vis = els.filter(shown).sort((a, b) => Number(a.style.order) - Number(b.style.order));
    vis[0]?.removeAttribute('data-wm-gap');
    // Lists in the right half open leftwards, so they stay inside the panel.
    const mid = bar.clientWidth / 2;
    for (const el of vis) if (el.classList.contains('top-bar-heading-selector') && el.offsetLeft > mid) el.setAttribute('data-wm-right', '');
  };

  let frame = 0;
  const schedule = () => {
    cancelAnimationFrame(frame);
    frame = requestAnimationFrame(apply);
  };
  const sizes = new ResizeObserver(schedule);
  sizes.observe(bar);
  // Crepe re-renders the bar's items now and then; arrange them again if it replaces them.
  const kids = new MutationObserver(schedule);
  kids.observe(inner, { childList: true });
  // Changes made in "Customise toolbar" show at once.
  const unsubscribe = useStore.subscribe((s, prev) => {
    if (s.toolbars !== prev.toolbars) schedule();
  });
  apply();

  return () => {
    cancelAnimationFrame(frame);
    sizes.disconnect();
    kids.disconnect();
    unsubscribe();
    window.removeEventListener('pointerdown', onOutside, true);
    bar.removeEventListener('contextmenu', onContext);
    closeMenu();
    more.remove();
  };
}
