'use client';

import * as React from 'react';
import { cn } from '@/lib/utils';
import { throttle } from '@/frontend/lib/throttle';

export interface TableWrapperProps extends React.HTMLAttributes<HTMLDivElement> {
  children: React.ReactNode;
  /** Whether to show subtle edge shadows when the table overflows horizontally. Defaults to true. */
  showOverflowHint?: boolean;
}

/**
 * Responsive container for data-heavy tables.
 * Prevents horizontal page blowout by constraining the table to a local,
 * touch-momentum scrollable box with optional overflow indicators.
 */
export const TableWrapper = React.forwardRef<HTMLDivElement, TableWrapperProps>(
  ({ children, className, showOverflowHint = true, ...props }, ref) => {
    const containerRef = React.useRef<HTMLDivElement | null>(null);
    const [canScrollLeft, setCanScrollLeft] = React.useState(false);
    const [canScrollRight, setCanScrollRight] = React.useState(false);

    const checkScroll = React.useCallback(() => {
      const el = containerRef.current;
      if (!el) return;
      const { scrollLeft, scrollWidth, clientWidth } = el;
      setCanScrollLeft(scrollLeft > 2);
      setCanScrollRight(scrollLeft + clientWidth < scrollWidth - 2);
    }, []);

    React.useEffect(() => {
      const el = containerRef.current;
      if (!el) return;

      checkScroll();
      const onChange = throttle(checkScroll, 100);
      el.addEventListener('scroll', onChange, { passive: true });
      window.addEventListener('resize', onChange);

      // Observe both wrapper and first child table plus DOM mutations so dynamic rows/columns update scroll hints.
      const ro = new ResizeObserver(onChange);
      ro.observe(el);
      if (el.firstElementChild) ro.observe(el.firstElementChild);

      const mo = new MutationObserver(() => {
        if (el.firstElementChild) ro.observe(el.firstElementChild);
        onChange();
      });
      mo.observe(el, { childList: true, subtree: true });

      return () => {
        onChange.cancel();
        el.removeEventListener('scroll', onChange);
        window.removeEventListener('resize', onChange);
        ro.disconnect();
        mo.disconnect();
      };
    }, [checkScroll]);

    return (
      <div className="relative w-full max-w-full min-w-0">
        <div
          ref={(node) => {
            containerRef.current = node;
            if (typeof ref === 'function') ref(node);
            else if (ref) ref.current = node;
          }}
          data-table-wrapper="true"
          className={cn(
            'table-responsive overflow-x-auto scrollbar-thin touch-scroll w-full min-w-0 rounded-lg border border-border bg-card',
            className
          )}
          {...props}
        >
          {children}
        </div>

        {/* Subtle horizontal scroll indicators for mobile viewports */}
        {showOverflowHint && canScrollLeft && (
          <div
            className="pointer-events-none absolute inset-y-0 left-0 w-6 bg-gradient-to-r from-neutral-900/10 to-transparent rounded-l-lg"
            aria-hidden="true"
          />
        )}
        {showOverflowHint && canScrollRight && (
          <div
            className="pointer-events-none absolute inset-y-0 right-0 w-6 bg-gradient-to-l from-neutral-900/10 to-transparent rounded-r-lg"
            aria-hidden="true"
          />
        )}
      </div>
    );
  }
);

TableWrapper.displayName = 'TableWrapper';

export const ResponsiveTableWrapper = TableWrapper;
