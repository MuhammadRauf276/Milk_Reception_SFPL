'use client';

import React, { useState } from 'react';
import Link from 'next/link';
import { AnimatePresence, motion } from 'framer-motion';
import { ChevronRight, X } from 'lucide-react';
import { cn } from '@/lib/utils';
import { SheetClose } from '@/components/ui/sheet';
import { ShakarganjLogo, ShakarganjIcon } from '@/components/brand/ShakarganjLogo';
import type { RoleNavSection } from './roleNavConfig';
import { getRoleLabel } from '@core/roles/labels';

export interface NavPanelProps {
  sections: RoleNavSection[];
  isActive: (href: string) => boolean;
  /** Called after a link is followed (used to close the mobile sheet). */
  onNavigate?: () => void;
  /** Small caption rendered above the nav tree, e.g. the user's role. */
  caption?: string;
  footer?: React.ReactNode;
  /** Render a close button (mobile sheet only). */
  showClose?: boolean;
  /** Sections expanded on first render. */
  defaultExpanded?: string[];
}

/** Display name for a role code (uses ROLE_LABELS; unknown codes become readable words). */
export function formatRoleLabel(role?: string | null) {
  return getRoleLabel(role, 'Workspace');
}

export function BrandMark({
  className,
  size = 'default',
}: {
  className?: string;
  size?: 'default' | 'lg';
}) {
  return (
    <div className={cn('flex items-center gap-3 min-w-0', className)}>
      <ShakarganjIcon className={size === 'lg' ? 'h-10 w-10' : 'h-9 w-9'} />
      <div className="min-w-0 flex flex-col items-start justify-center">
        <ShakarganjLogo
          className={cn(
            'w-auto text-primary',
            size === 'lg' ? 'h-8 sm:h-9' : 'h-7'
          )}
        />
        <span className="block truncate text-[10px] font-semibold uppercase tracking-wider text-muted-foreground mt-0.5 leading-none">
          Milk Reception
        </span>
      </div>
    </div>
  );
}

const itemBase =
  'group flex w-full items-center gap-2.5 rounded-md px-2.5 text-sm transition-colors focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-ring';

export function NavPanel({
  sections,
  isActive,
  onNavigate,
  caption,
  footer,
  showClose = false,
  defaultExpanded = [],
}: NavPanelProps) {
  const [expanded, setExpanded] = useState<Record<string, boolean>>(() =>
    Object.fromEntries(defaultExpanded.map((id) => [id, true]))
  );

  return (
    <div className="flex h-full flex-col">
      <div className="flex h-16 shrink-0 items-center justify-between gap-2 border-b px-4">
        <BrandMark />
        {showClose ? (
          <SheetClose
            className="inline-flex h-8 w-8 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-muted hover:text-foreground focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-ring"
            aria-label="Close navigation"
          >
            <X className="h-4 w-4" />
          </SheetClose>
        ) : null}
      </div>

      <nav aria-label="Primary" className="scrollbar-thin flex-1 overflow-y-auto px-3 py-4">
        {caption ? (
          <p className="mb-2 px-2.5 text-[11px] font-medium uppercase tracking-wider text-muted-foreground">
            {caption}
          </p>
        ) : null}

        <ul className="space-y-0.5">
          {sections.map((section) => {
            const Icon = section.icon;
            const children = section.children ?? [];

            if (children.length === 0 && section.href) {
              const active = isActive(section.href);
              return (
                <li key={section.id}>
                  <Link
                    href={section.href}
                    onClick={onNavigate}
                    aria-current={active ? 'page' : undefined}
                    className={cn(
                      itemBase,
                      'min-h-[48px] sm:min-h-[36px] h-9',
                      active
                        ? 'bg-primary/[0.07] font-medium text-primary'
                        : 'text-slate-600 hover:bg-muted hover:text-foreground'
                    )}
                  >
                    {Icon ? (
                      <Icon className={cn('h-4 w-4 shrink-0', active ? 'text-primary' : 'text-muted-foreground group-hover:text-foreground')} />
                    ) : null}
                    <span className="truncate">{section.label}</span>
                  </Link>
                </li>
              );
            }

            const containsActive = children.some((leaf) => isActive(leaf.href));
            const isOpen = expanded[section.id] ?? containsActive;
            const panelId = `nav-section-${section.id}`;

            return (
              <li key={section.id}>
                <button
                  type="button"
                  onClick={() => setExpanded((prev) => ({ ...prev, [section.id]: !isOpen }))}
                  aria-expanded={isOpen}
                  aria-controls={panelId}
                  className={cn(
                    itemBase,
                    'min-h-[48px] sm:min-h-[36px] h-9 text-left cursor-pointer',
                    containsActive ? 'font-medium text-foreground' : 'text-slate-600 hover:bg-muted hover:text-foreground'
                  )}
                >
                  {Icon ? (
                    <Icon className={cn('h-4 w-4 shrink-0', containsActive ? 'text-primary' : 'text-muted-foreground')} />
                  ) : null}
                  <span className="flex-1 truncate">{section.label}</span>
                  <ChevronRight
                    className={cn('h-3.5 w-3.5 shrink-0 text-muted-foreground transition-transform duration-200', isOpen && 'rotate-90')}
                  />
                </button>

                <AnimatePresence initial={false}>
                  {isOpen ? (
                    <motion.ul
                      id={panelId}
                      key="panel"
                      initial={{ height: 0, opacity: 0 }}
                      animate={{ height: 'auto', opacity: 1 }}
                      exit={{ height: 0, opacity: 0 }}
                      transition={{ duration: 0.18, ease: [0.4, 0, 0.2, 1] }}
                      className="ml-[18px] overflow-hidden border-l pl-2 space-y-0.5"
                    >
                      {children.map((leaf, index) => {
                        const active = isActive(leaf.href);
                        const LeafIcon = leaf.icon;
                        const prevLeaf = index > 0 ? children[index - 1] : null;
                        const showGroupHeader = Boolean(leaf.group && leaf.group !== prevLeaf?.group);

                        return (
                          <React.Fragment key={leaf.id}>
                            {showGroupHeader && (
                              <li className="pt-2.5 pb-1 px-2.5 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground/80 list-none">
                                {leaf.group}
                              </li>
                            )}
                            <li className="py-px first:pt-1 last:pb-1">
                              <Link
                                href={leaf.href}
                                onClick={onNavigate}
                                aria-current={active ? 'page' : undefined}
                                className={cn(
                                  itemBase,
                                  'relative min-h-[48px] sm:min-h-[32px] text-[13px] py-2 sm:py-1',
                                  active
                                    ? 'bg-primary/[0.07] font-medium text-primary'
                                    : 'text-slate-600 hover:bg-muted hover:text-foreground'
                                )}
                              >
                                {active ? (
                                  <span className="absolute left-[-9px] top-1.5 bottom-1.5 w-0.5 rounded-full bg-primary" />
                                ) : null}
                                {LeafIcon ? (
                                  <LeafIcon
                                    className={cn(
                                      'h-4 w-4 shrink-0',
                                      active ? 'text-primary' : 'text-muted-foreground group-hover:text-foreground'
                                    )}
                                  />
                                ) : null}
                                <span className="truncate">{leaf.label}</span>
                              </Link>
                            </li>
                          </React.Fragment>
                        );
                      })}
                    </motion.ul>
                  ) : null}
                </AnimatePresence>
              </li>
            );
          })}
        </ul>
      </nav>

      {footer ? <div className="shrink-0 border-t px-4 py-3">{footer}</div> : null}
    </div>
  );
}
