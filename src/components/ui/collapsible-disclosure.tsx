'use client';

import * as React from 'react';
import { ChevronDown } from 'lucide-react';
import { cn } from '@/lib/utils';

export interface CollapsibleDisclosureProps {
  title: React.ReactNode;
  children: React.ReactNode;
  badge?: React.ReactNode;
  icon?: React.ReactNode;
  defaultOpen?: boolean;
  forceOpenDesktop?: boolean;
  className?: string;
  headerClassName?: string;
  contentClassName?: string;
}

/**
 * CollapsibleDisclosure: Collapses long instructions, SOP rules, and formula explanations.
 * - Mobile: compact single-line disclosure with minimum 44px touch target.
 * - Desktop: can stay expanded or inline if forceOpenDesktop=true.
 * - Accessible with proper ARIA attributes.
 */
export function CollapsibleDisclosure({
  title,
  children,
  badge,
  icon,
  defaultOpen = false,
  forceOpenDesktop = false,
  className,
  headerClassName,
  contentClassName,
}: CollapsibleDisclosureProps) {
  const [isOpen, setIsOpen] = React.useState(defaultOpen);
  const contentId = React.useId();

  return (
    <div
      className={cn(
        'rounded-lg border border-border bg-card/60 transition-colors',
        className
      )}
    >
      <button
        type="button"
        aria-expanded={isOpen}
        aria-controls={contentId}
        onClick={() => setIsOpen((prev) => !prev)}
        className={cn(
          'flex min-h-11 w-full items-center justify-between gap-3 px-3.5 py-2.5 text-left text-xs font-semibold text-foreground transition-colors select-none',
          'hover:bg-muted/40 focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-ring rounded-lg',
          forceOpenDesktop && 'lg:pointer-events-none lg:cursor-default',
          headerClassName
        )}
      >
        <div className="flex min-w-0 flex-1 items-center gap-2">
          {icon && (
            <span className="shrink-0 text-muted-foreground [&_svg]:h-4 [&_svg]:w-4">
              {icon}
            </span>
          )}
          <span className="truncate">{title}</span>
          {badge && <span className="shrink-0">{badge}</span>}
        </div>

        <ChevronDown
          className={cn(
            'h-4 w-4 shrink-0 text-muted-foreground transition-transform duration-200',
            isOpen ? 'rotate-180' : 'rotate-0',
            forceOpenDesktop && 'lg:hidden'
          )}
          aria-hidden="true"
        />
      </button>

      <div
        id={contentId}
        role="region"
        className={cn(
          'transition-all duration-200 ease-in-out',
          isOpen || forceOpenDesktop ? 'block' : 'hidden',
          forceOpenDesktop && !isOpen && 'hidden lg:block',
          'border-t border-border/50 px-3.5 py-3 text-xs leading-relaxed text-muted-foreground',
          contentClassName
        )}
      >
        {children}
      </div>
    </div>
  );
}
