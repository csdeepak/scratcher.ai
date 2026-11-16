// Keep the editor's formatting bar on one row, like Google Docs: buttons that don't fit move into a
// "⋯" menu at the end (least-used first) and come back when there is room. A menu entry presses the
// hidden button itself, so every command is still Crepe's own.

/** Hidden first when space runs out (by the names given in Markdown.tsx). */
const HIDE_ORDER = ['Strikethrough', 'Code', 'Checklist', 'Numbered list', 'Link', 'Bulleted list', 'Italic (Ctrl+I)', 'Bold (Ctrl+B)'];

const DOTS =
  '<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="5" cy="12" r="1.8"/><circle cx="12" cy="12" r="1.8"/><circle cx="19" cy="12" r="1.8"/></svg>';

export function fitTopBar(bar: HTMLElement): () => void {
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
  more.style.display = 'none';
  bar.appendChild(more);

  let menu: HTMLElement | null = null;
  const buttons = () => [...inner.querySelectorAll<HTMLElement>('.top-bar-item')];

  const closeMenu = () => {
    menu?.remove();
    menu = null;
    more.setAttribute('aria-expanded', 'false');
  };

  const openMenu = () => {
    closeMenu();
    menu = document.createElement('div');
    menu.className = 'wm-bar-menu';
    menu.setAttribute('role', 'menu');
    for (const b of buttons().filter((x) => x.dataset.wmHidden)) {
      const item = document.createElement('button');
      item.type = 'button';
      item.className = `wm-bar-menu-item${b.classList.contains('active') ? ' active' : ''}`;
      item.setAttribute('role', 'menuitem');
      item.innerHTML = b.innerHTML;
      const name = document.createElement('span');
      name.textContent = b.getAttribute('aria-label') ?? '';
      item.appendChild(name);
      // Pointer-down like Crepe's own buttons, so the text selection stays put.
      item.addEventListener('pointerdown', (e) => {
        e.preventDefault();
        e.stopPropagation();
        closeMenu();
        b.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, cancelable: true }));
      });
      menu.appendChild(item);
    }
    bar.appendChild(menu);
    more.setAttribute('aria-expanded', 'true');
  };

  const onMore = (e: PointerEvent) => {
    e.preventDefault();
    e.stopPropagation();
    if (menu) closeMenu();
    else openMenu();
  };
  more.addEventListener('pointerdown', onMore);
  const onOutside = (e: PointerEvent) => {
    if (menu && !menu.contains(e.target as Node) && e.target !== more && !more.contains(e.target as Node)) closeMenu();
  };
  window.addEventListener('pointerdown', onOutside, true);

  /** Hide a divider when everything after it, up to the next divider, is hidden. */
  const tidyDividers = () => {
    for (const d of inner.querySelectorAll<HTMLElement>('.top-bar-divider')) {
      let shown = false;
      for (let n = d.nextElementSibling as HTMLElement | null; n && !n.classList.contains('top-bar-divider'); n = n.nextElementSibling as HTMLElement | null) {
        if (n.style.display !== 'none') shown = true;
      }
      d.style.display = shown ? '' : 'none';
    }
  };

  const oneRow = () => {
    const kids = [...inner.children] as HTMLElement[];
    const top = kids[0]?.offsetTop ?? 0;
    return kids.every((k) => k.style.display === 'none' || k.offsetTop - top < 8);
  };

  const fit = () => {
    closeMenu();
    for (const b of buttons()) {
      b.style.display = '';
      delete b.dataset.wmHidden;
    }
    for (const d of inner.querySelectorAll<HTMLElement>('.top-bar-divider')) d.style.display = '';
    more.style.display = 'none';
    if (oneRow()) return;
    more.style.display = '';
    for (const label of HIDE_ORDER) {
      const b = buttons().find((x) => x.getAttribute('aria-label') === label);
      if (!b) continue;
      b.style.display = 'none';
      b.dataset.wmHidden = '1';
      tidyDividers();
      if (oneRow()) break;
    }
  };

  let frame = 0;
  const schedule = () => {
    cancelAnimationFrame(frame);
    frame = requestAnimationFrame(fit);
  };
  const sizes = new ResizeObserver(schedule);
  sizes.observe(bar);
  // Crepe re-renders the bar's buttons now and then; fit again if it replaces them.
  const kids = new MutationObserver(schedule);
  kids.observe(inner, { childList: true });
  fit();

  return () => {
    cancelAnimationFrame(frame);
    sizes.disconnect();
    kids.disconnect();
    window.removeEventListener('pointerdown', onOutside, true);
    closeMenu();
    more.remove();
  };
}
