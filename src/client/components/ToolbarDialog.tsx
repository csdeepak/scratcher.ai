// "Customise toolbar": tick what goes on the bar and put it in order (pattern from Joplin's
// "Manage toolbar options": the bar's buttons first with up/down, then "Available"). Changes
// apply at once, so the bar behind the dialog shows the result as you go.

import type { ReactNode } from 'react';
import { ArrowDown, ArrowUp, Download, FileImage, Focus, FoldVertical, ImageDown, Map as MapIcon, Maximize2, Plus, Redo2, RotateCcw, StickyNote, ChevronRight, Undo2, UnfoldVertical, Info } from 'lucide-react';
import { setState, useStore } from '../store';
import { BARS, barItem, isDefaultLayout, noteIcon, offBar, restoreDefaultBar, setBarLayout, useBarLayout, type BarId, type BarItem } from '../toolbars';
import { Button, Modal, cx } from './ui';

/** Icons for the map items (the map toolbar draws the same ones). */
export const MAP_ICONS: Record<string, ReactNode> = {
  main: <Plus size={15} />,
  sub: <ChevronRight size={15} />,
  note: <StickyNote size={15} />,
  undo: <Undo2 size={15} />,
  redo: <Redo2 size={15} />,
  focus: <Focus size={15} />,
  overview: <Maximize2 size={15} />,
  view: <MapIcon size={15} />,
  legend: <Info size={15} />,
  expand: <UnfoldVertical size={15} />,
  collapse: <FoldVertical size={15} />,
  reset: <RotateCcw size={15} />,
  image: <ImageDown size={15} />,
  export: <Download size={15} />,
};

function ItemIcon({ bar, id }: { bar: BarId; id: string }) {
  if (bar === 'map') return <span className="flex size-5 items-center justify-center text-muted">{MAP_ICONS[id] ?? <FileImage size={15} />}</span>;
  const svg = noteIcon(id);
  // Crepe's own icon (a fixed SVG from the package); the two lists have none, so show their name's first letter.
  return svg ? (
    <span className="wm-note-icon flex size-5 items-center justify-center" dangerouslySetInnerHTML={{ __html: svg }} />
  ) : (
    <span className="flex size-5 items-center justify-center rounded border border-line text-[10px] font-semibold text-muted">{id === 'heading' ? 'Aa' : '▾'}</span>
  );
}

function Row({ bar, item, on, children, onToggle }: { bar: BarId; item: BarItem; on: boolean; children?: ReactNode; onToggle: () => void }) {
  const id = `tb-${bar}-${item.id}`;
  return (
    <li className="flex min-h-10 items-center gap-2.5 rounded-lg px-2 hover:bg-surface-2">
      <input id={id} type="checkbox" className="size-4 shrink-0 accent-[var(--accent)]" checked={on} onChange={onToggle} />
      <ItemIcon bar={bar} id={item.id} />
      <label htmlFor={id} className={cx('min-w-0 flex-1 cursor-pointer py-1.5', !on && 'text-muted')}>
        <span className="block text-[13.5px] leading-tight">
          {item.label}
          {item.hint && <span className="ml-1.5 text-[11.5px] text-faint"> {item.hint}</span>}
        </span>
        {item.detail && <span className="block truncate text-[11.5px] text-faint">{item.detail}</span>}
      </label>
      {children}
    </li>
  );
}

export function ToolbarDialog() {
  const open = useStore((s) => s.dialog === 'toolbar');
  const bar = useStore((s) => s.toolbarTarget);
  const layout = useBarLayout(bar);
  const spec = BARS[bar];
  const available = offBar(bar, layout);

  const move = (i: number, by: -1 | 1) => {
    const next = [...layout];
    const [it] = next.splice(i, 1);
    next.splice(i + by, 0, it!);
    setBarLayout(bar, next);
  };
  const toggle = (id: string) => setBarLayout(bar, layout.includes(id) ? layout.filter((x) => x !== id) : [...layout, id]);
  const arrow = 'inline-flex size-7 items-center justify-center rounded-lg text-muted hover:bg-surface hover:text-fg disabled:pointer-events-none disabled:opacity-30';

  return (
    <Modal
      open={open}
      onOpenChange={(o) => setState({ dialog: o ? 'toolbar' : null })}
      title={`Customise the ${spec.title.toLowerCase()}`}
      description="Tick what goes on the bar and use the arrows to order it. Everything else stays one click away in the bar's ⋯ menu."
      footer={
        <>
          <Button variant="ghost" className="mr-auto" disabled={isDefaultLayout(bar, layout)} onClick={() => restoreDefaultBar(bar)}>
            Restore defaults
          </Button>
          <Button variant="primary" onClick={() => setState({ dialog: null })}>
            Done
          </Button>
        </>
      }
    >
      <h3 className="mb-1 mt-1 text-[12px] font-semibold uppercase tracking-wide text-faint">On the bar</h3>
      {layout.length ? (
        <ul className="flex flex-col gap-0.5">
          {layout.map((id, i) => {
            const item = barItem(bar, id)!;
            return (
              <Row key={id} bar={bar} item={item} on onToggle={() => toggle(id)}>
                <button type="button" className={arrow} aria-label={`Move ${item.label} up`} title="Move up" disabled={i === 0} onClick={() => move(i, -1)}>
                  <ArrowUp size={15} />
                </button>
                <button type="button" className={arrow} aria-label={`Move ${item.label} down`} title="Move down" disabled={i === layout.length - 1} onClick={() => move(i, 1)}>
                  <ArrowDown size={15} />
                </button>
              </Row>
            );
          })}
        </ul>
      ) : (
        <p className="rounded-lg bg-surface-2 px-3 py-2 text-[12.5px] text-muted">Nothing on the bar: everything is in its ⋯ menu.</p>
      )}
      {available.length > 0 && (
        <>
          <h3 className="mb-1 mt-4 text-[12px] font-semibold uppercase tracking-wide text-faint">Available</h3>
          <ul className="flex flex-col gap-0.5">
            {available.map((id) => (
              <Row key={id} bar={bar} item={barItem(bar, id)!} on={false} onToggle={() => toggle(id)} />
            ))}
          </ul>
        </>
      )}
      <p className="mt-4 text-[12px] text-muted">
        {bar === 'notes'
          ? 'When the panel is too narrow, buttons at the end of your list move into ⋯ first. While typing, / also lists every kind of block. Saved on this computer for every roadmap.'
          : 'Saved on this computer for every roadmap. Right-click the toolbar to come back here.'}
      </p>
    </Modal>
  );
}
