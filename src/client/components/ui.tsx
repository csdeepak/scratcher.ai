// Small, consistent building blocks on top of Radix primitives.

import { forwardRef, type ButtonHTMLAttributes, type ReactNode } from 'react';
import { ContextMenu, Dialog as RDialog, DropdownMenu, Tooltip as RTooltip, Popover as RPopover } from 'radix-ui';
import { X } from 'lucide-react';
import type { StatusCategory } from '../../shared/profiles';

export function cx(...c: (string | false | null | undefined)[]) {
  return c.filter(Boolean).join(' ');
}

type Variant = 'primary' | 'secondary' | 'ghost' | 'danger' | 'subtle';
const variants: Record<Variant, string> = {
  primary: 'bg-accent text-accent-fg hover:bg-accent-hover border border-transparent',
  secondary: 'bg-surface text-fg border border-line-strong hover:border-ink/60 hover:bg-surface-2',
  ghost: 'text-muted hover:text-fg hover:bg-surface-2',
  subtle: 'bg-surface-2 text-fg hover:bg-surface-3',
  danger: 'bg-danger text-white hover:opacity-90 shadow-sm',
};

export const Button = forwardRef<HTMLButtonElement, ButtonHTMLAttributes<HTMLButtonElement> & { variant?: Variant; size?: 'sm' | 'md' }>(
  function Button({ variant = 'secondary', size = 'md', className, ...p }, ref) {
    return (
      <button
        ref={ref}
        {...p}
        className={cx(
          'inline-flex items-center justify-center gap-1.5 rounded-md font-medium whitespace-nowrap transition-colors disabled:opacity-50 disabled:pointer-events-none select-none',
          size === 'sm' ? 'h-7 px-2.5 text-[12.5px]' : 'h-8.5 px-3 text-[13px]',
          variants[variant],
          className,
        )}
      />
    );
  },
);

export const IconButton = forwardRef<HTMLButtonElement, ButtonHTMLAttributes<HTMLButtonElement> & { label: string; active?: boolean; size?: 'sm' | 'md' }>(
  function IconButton({ label, active, size = 'md', className, children, ...p }, ref) {
    return (
      <Tip label={label}>
        <button
          ref={ref}
          aria-label={label}
          {...p}
          className={cx(
            'inline-flex items-center justify-center rounded-lg transition-colors disabled:opacity-40 disabled:pointer-events-none',
            size === 'sm' ? 'size-7' : 'size-8.5',
            active ? 'bg-accent-soft text-accent' : 'text-muted hover:text-fg hover:bg-surface-2',
            className,
          )}
        >
          {children}
        </button>
      </Tip>
    );
  },
);

export function Tip({ label, children, side = 'bottom' }: { label: ReactNode; children: ReactNode; side?: 'top' | 'bottom' | 'left' | 'right' }) {
  return (
    <RTooltip.Root delayDuration={350}>
      <RTooltip.Trigger asChild>{children}</RTooltip.Trigger>
      <RTooltip.Portal>
        <RTooltip.Content side={side} sideOffset={6} className="z-[80] max-w-72 rounded-md bg-fg px-2 py-1 text-[12px] leading-snug text-surface shadow-md">
          {label}
        </RTooltip.Content>
      </RTooltip.Portal>
    </RTooltip.Root>
  );
}

export function Kbd({ children }: { children: ReactNode }) {
  return <kbd className="inline-flex min-w-5 items-center justify-center rounded border border-line bg-surface-2 px-1 font-sans text-[11px] font-medium text-muted">{children}</kbd>;
}

// ---------- menus ----------

export const Menu = {
  Root: DropdownMenu.Root,
  Trigger: DropdownMenu.Trigger,
  Content({ children, align = 'end', className }: { children: ReactNode; align?: 'start' | 'end' | 'center'; className?: string }) {
    return (
      <DropdownMenu.Portal>
        <DropdownMenu.Content
          align={align}
          sideOffset={6}
          collisionPadding={8}
          className={cx('z-[70] min-w-52 rounded-xl border border-line bg-surface p-1 shadow-lg', className)}
        >
          {children}
        </DropdownMenu.Content>
      </DropdownMenu.Portal>
    );
  },
  Item({ children, onSelect, danger, disabled, hint }: { children: ReactNode; onSelect?: () => void; danger?: boolean; disabled?: boolean; hint?: ReactNode }) {
    return (
      <DropdownMenu.Item
        disabled={disabled}
        onSelect={onSelect}
        className={cx(
          'flex cursor-pointer select-none items-center gap-2 rounded-lg px-2.5 py-1.5 text-[13px] outline-none data-[disabled]:opacity-40 data-[highlighted]:bg-surface-2',
          danger ? 'text-danger' : 'text-fg',
        )}
      >
        {children}
        {hint && <span className="ml-auto pl-4 text-[11.5px] text-faint">{hint}</span>}
      </DropdownMenu.Item>
    );
  },
  Separator() {
    return <DropdownMenu.Separator className="my-1 h-px bg-line" />;
  },
  Label({ children }: { children: ReactNode }) {
    return <DropdownMenu.Label className="px-2.5 pb-1 pt-2 text-[11.5px] font-medium text-faint">{children}</DropdownMenu.Label>;
  },
  Sub: DropdownMenu.Sub,
  SubTrigger({ children }: { children: ReactNode }) {
    return (
      <DropdownMenu.SubTrigger className="flex cursor-pointer select-none items-center gap-2 rounded-lg px-2.5 py-1.5 text-[13px] outline-none data-[highlighted]:bg-surface-2 data-[state=open]:bg-surface-2">
        {children}
        <span className="ml-auto text-faint">›</span>
      </DropdownMenu.SubTrigger>
    );
  },
  SubContent({ children }: { children: ReactNode }) {
    return (
      <DropdownMenu.Portal>
        <DropdownMenu.SubContent sideOffset={4} className="z-[71] min-w-48 rounded-xl border border-line bg-surface p-1 shadow-lg">
          {children}
        </DropdownMenu.SubContent>
      </DropdownMenu.Portal>
    );
  },
  RadioGroup: DropdownMenu.RadioGroup,
  RadioItem({ value, children }: { value: string; children: ReactNode }) {
    return (
      <DropdownMenu.RadioItem
        value={value}
        className="flex cursor-pointer select-none items-center gap-2 rounded-lg py-1.5 pl-7 pr-2.5 text-[13px] outline-none relative data-[highlighted]:bg-surface-2"
      >
        <DropdownMenu.ItemIndicator className="absolute left-2.5 size-1.5 rounded-full bg-accent" />
        {children}
      </DropdownMenu.RadioItem>
    );
  },
};

/** Right-click menu (Radix ContextMenu), styled like Menu. */
export const CtxMenu = {
  Root: ContextMenu.Root,
  Trigger: ContextMenu.Trigger,
  Content({ children, className }: { children: ReactNode; className?: string }) {
    return (
      <ContextMenu.Portal>
        <ContextMenu.Content collisionPadding={8} className={cx('z-[70] min-w-56 rounded-xl border border-line bg-surface p-1 shadow-lg', className)}>
          {children}
        </ContextMenu.Content>
      </ContextMenu.Portal>
    );
  },
  Item({ children, onSelect, danger, disabled, hint }: { children: ReactNode; onSelect?: () => void; danger?: boolean; disabled?: boolean; hint?: ReactNode }) {
    return (
      <ContextMenu.Item
        disabled={disabled}
        onSelect={onSelect}
        className={cx(
          'flex cursor-pointer select-none items-center gap-2 rounded-lg px-2.5 py-1.5 text-[13px] outline-none data-[disabled]:opacity-40 data-[highlighted]:bg-surface-2',
          danger ? 'text-danger' : 'text-fg',
        )}
      >
        {children}
        {hint && <span className="ml-auto pl-4 text-[11.5px] text-faint">{hint}</span>}
      </ContextMenu.Item>
    );
  },
  Separator() {
    return <ContextMenu.Separator className="my-1 h-px bg-line" />;
  },
  Label({ children }: { children: ReactNode }) {
    return <ContextMenu.Label className="px-2.5 pb-1 pt-2 text-[11.5px] font-medium text-faint">{children}</ContextMenu.Label>;
  },
  Sub: ContextMenu.Sub,
  SubTrigger({ children }: { children: ReactNode }) {
    return (
      <ContextMenu.SubTrigger className="flex cursor-pointer select-none items-center gap-2 rounded-lg px-2.5 py-1.5 text-[13px] outline-none data-[highlighted]:bg-surface-2 data-[state=open]:bg-surface-2">
        {children}
        <span className="ml-auto text-faint">›</span>
      </ContextMenu.SubTrigger>
    );
  },
  SubContent({ children }: { children: ReactNode }) {
    return (
      <ContextMenu.Portal>
        <ContextMenu.SubContent sideOffset={4} className="z-[71] min-w-48 rounded-xl border border-line bg-surface p-1 shadow-lg">
          {children}
        </ContextMenu.SubContent>
      </ContextMenu.Portal>
    );
  },
};

export const Pop = {
  Root: RPopover.Root,
  Trigger: RPopover.Trigger,
  Anchor: RPopover.Anchor,
  Content({ children, className, align = 'start' }: { children: ReactNode; className?: string; align?: 'start' | 'center' | 'end' }) {
    return (
      <RPopover.Portal>
        <RPopover.Content align={align} sideOffset={6} collisionPadding={8} className={cx('z-[70] rounded-xl border border-line bg-surface shadow-lg', className)}>
          {children}
        </RPopover.Content>
      </RPopover.Portal>
    );
  },
  Close: RPopover.Close,
};

// ---------- dialogs ----------

export function Modal({
  open,
  onOpenChange,
  title,
  description,
  children,
  footer,
  wide,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  title: ReactNode;
  description?: ReactNode;
  children?: ReactNode;
  footer?: ReactNode;
  wide?: boolean;
}) {
  return (
    <RDialog.Root open={open} onOpenChange={onOpenChange}>
      <RDialog.Portal>
        <RDialog.Overlay className="fixed inset-0 z-[60] bg-black/30 backdrop-blur-[2px] data-[state=open]:animate-in" />
        <RDialog.Content
          className={cx(
            'fixed left-1/2 top-[8vh] z-[61] flex max-h-[84vh] w-[calc(100vw-32px)] -translate-x-1/2 flex-col rounded-2xl border border-line bg-surface shadow-lg outline-none',
            wide ? 'max-w-3xl' : 'max-w-lg',
          )}
        >
          <div className="flex items-start gap-3 px-5 pb-2 pt-4">
            <div className="min-w-0 flex-1">
              <RDialog.Title className="text-[16px] font-semibold tracking-[-0.01em]">{title}</RDialog.Title>
              {description ? (
                <RDialog.Description className="mt-0.5 text-[13px] text-muted">{description}</RDialog.Description>
              ) : (
                <RDialog.Description className="sr-only">{typeof title === 'string' ? title : 'Dialog'}</RDialog.Description>
              )}
            </div>
            <RDialog.Close asChild>
              <button aria-label="Close" className="-mr-1 rounded-lg p-1.5 text-muted hover:bg-surface-2 hover:text-fg">
                <X size={16} />
              </button>
            </RDialog.Close>
          </div>
          <div className="wm-scroll min-h-0 flex-1 px-5 pb-4">{children}</div>
          {footer && <div className="flex items-center justify-end gap-2 border-t border-line px-5 py-3">{footer}</div>}
        </RDialog.Content>
      </RDialog.Portal>
    </RDialog.Root>
  );
}

export function Drawer({ open, onOpenChange, title, children, side = 'right', width = 'w-[min(560px,100vw)]' }: { open: boolean; onOpenChange: (o: boolean) => void; title: string; children: ReactNode; side?: 'left' | 'right'; width?: string }) {
  return (
    <RDialog.Root open={open} onOpenChange={onOpenChange}>
      <RDialog.Portal>
        <RDialog.Overlay className="fixed inset-0 z-[55] bg-black/20" />
        <RDialog.Content className={cx('fixed bottom-0 top-0 z-[56] flex flex-col border-line bg-surface shadow-lg outline-none', side === 'right' ? 'right-0 border-l' : 'left-0 border-r', width)}>
          <RDialog.Title className="sr-only">{title}</RDialog.Title>
          <RDialog.Description className="sr-only">{title}</RDialog.Description>
          {children}
        </RDialog.Content>
      </RDialog.Portal>
    </RDialog.Root>
  );
}

// ---------- status & progress ----------

const statusColor: Record<StatusCategory, string> = {
  todo: 'var(--todo)',
  active: 'var(--active)',
  review: 'var(--review)',
  done: 'var(--done)',
};

export function StatusIcon({ category, size = 16, label }: { category: StatusCategory; size?: number; label?: string }) {
  const c = statusColor[category];
  return (
    <svg width={size} height={size} viewBox="0 0 16 16" role="img" aria-label={label} className="flex-none">
      {category === 'todo' && <circle cx="8" cy="8" r="6.25" fill="none" stroke={c} strokeWidth="1.5" strokeDasharray="2.6 2.1" />}
      {category === 'active' && (
        <>
          <circle cx="8" cy="8" r="6.25" fill="none" stroke={c} strokeWidth="1.5" />
          <path d="M8 3.6 A4.4 4.4 0 0 1 8 12.4 Z" fill={c} />
        </>
      )}
      {category === 'review' && (
        <>
          <circle cx="8" cy="8" r="6.25" fill="none" stroke={c} strokeWidth="1.5" />
          <path d="M8 3.6 A4.4 4.4 0 1 1 3.6 8 L8 8 Z" fill={c} />
        </>
      )}
      {category === 'done' && (
        <>
          <circle cx="8" cy="8" r="7" fill={c} />
          <path d="M4.9 8.2 7 10.2 11.1 5.9" fill="none" stroke="var(--surface)" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" />
        </>
      )}
    </svg>
  );
}

export function ProgressBar({ done, review, active, total, className }: { done: number; review: number; active: number; total: number; className?: string }) {
  if (!total) return null;
  const pct = (n: number) => `${(n / total) * 100}%`;
  return (
    <div className={cx('flex h-1.5 w-full overflow-hidden rounded-full bg-surface-3', className)} role="img" aria-label={`${done} of ${total} complete`}>
      <div style={{ width: pct(done), background: 'var(--done)' }} />
      <div style={{ width: pct(review), background: 'var(--review)' }} />
      <div style={{ width: pct(active), background: 'color-mix(in srgb, var(--active) 55%, transparent)' }} />
    </div>
  );
}

export function UnderstandingIcon({ level, size = 14 }: { level: 'not-yet' | 'can-explain' | 'can-apply' | null; size?: number }) {
  const n = level === 'can-apply' ? 2 : level === 'can-explain' ? 1 : 0;
  return (
    <svg width={size} height={size} viewBox="0 0 14 14" aria-hidden className="flex-none">
      <rect x="1" y="7.5" width="5" height="5.5" rx="1.2" fill={n >= 1 ? 'var(--understand)' : 'none'} stroke="var(--understand)" strokeWidth="1.2" opacity={n ? 1 : 0.55} />
      <rect x="8" y="1" width="5" height="12" rx="1.2" fill={n >= 2 ? 'var(--understand)' : 'none'} stroke="var(--understand)" strokeWidth="1.2" opacity={n ? 1 : 0.55} />
    </svg>
  );
}

export function Chip({ children, tone = 'neutral', className }: { children: ReactNode; tone?: 'neutral' | 'accent' | 'warn' | 'done' | 'danger' | 'understand'; className?: string }) {
  const tones = {
    neutral: 'bg-surface-2 text-muted border-line',
    accent: 'bg-accent-soft text-accent border-transparent',
    warn: 'bg-warn-soft text-review border-transparent',
    done: 'bg-done-soft text-done border-transparent',
    danger: 'bg-danger-soft text-danger border-transparent',
    understand: 'bg-surface-2 text-understand border-transparent',
  };
  return <span className={cx('inline-flex items-center gap-1 rounded-md border px-1.5 py-px text-[11.5px] font-medium leading-[18px]', tones[tone], className)}>{children}</span>;
}

export function EmptyHint({ title, children, action }: { title: string; children?: ReactNode; action?: ReactNode }) {
  return (
    <div className="mx-auto flex max-w-sm flex-col items-center gap-2 px-6 py-10 text-center">
      <div className="text-[14px] font-semibold">{title}</div>
      {children && <div className="text-[13px] leading-relaxed text-muted">{children}</div>}
      {action && <div className="mt-2">{action}</div>}
    </div>
  );
}

export function relTime(iso?: string): string {
  if (!iso) return '';
  const t = new Date(iso).getTime();
  if (!Number.isFinite(t)) return '';
  const s = Math.round((Date.now() - t) / 1000);
  if (s < 45) return 'just now';
  if (s < 3600) return `${Math.round(s / 60)} min ago`;
  if (s < 86400) return `${Math.round(s / 3600)} h ago`;
  if (s < 86400 * 7) return `${Math.round(s / 86400)} d ago`;
  return new Date(iso).toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' });
}
