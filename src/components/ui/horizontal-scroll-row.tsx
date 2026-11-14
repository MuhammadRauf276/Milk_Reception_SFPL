'use client';

import * as React from 'react';
import { cn } from '@/lib/utils';
import { throttle } from '@/frontend/lib/throttle';

export interface HorizontalScrollRowProps extends React.HTMLAttributes<HTMLDivElement> {
  children: React.ReactNode;
  /** Optional classes applied to the inner scrolling viewport element. */
  viewportClassName?: string;
  /** Whether to show subtle left/right edge fade indicators when overflowing. Defaults to true. */
  showOverflowHint?: boolean;
}

export function calculateHorizontalScrollOverflow(
  scrollLeft: number,
  scrollWidth: number,
  clientWidth: number,
): { canScrollLeft: boolean; canScrollRight: boolean } {
  return {
    canScrollLeft: scrollLeft > 2,
    canScrollRight: scrollLeft + clientWidth < scrollWidth - 2,
  };
}

/**
 * Horizontal row container for multi-step timelines, metric strips, and badge/tab rows inside cards.
 * Keeps child widths natural instead of crushing them, and renders a slim row scrollbar + edge
 * overflow indicators whenever content exceeds the card width.
 */
export const HorizontalScrollRow = React.forwardRef<HTMLDivElement, HorizontalScrollRowProps>(
  ({ children, className, viewportClassName, showOverflowHint = true, ...props }, ref) => {
    const containerRef = React.useRef<HTMLDivElement | null>(null);
    const [canScrollLeft, setCanScrollLeft] = React.useState(false);
    const [canScrollRight, setCanScrollRight] = React.useState(false);

    const checkScroll = React.useCallback(() => {
      const el = containerRef.current;
      if (!el) return;
      const { scrollLeft, scrollWidth, clientWidth } = el;
      const next = calculateHorizontalScrollOverflow(scrollLeft, scrollWidth, clientWidth);
      setCanScrollLeft(next.canScrollLeft);
      setCanScrollRight(next.canScrollRight);
    }, []);

    React.useEffect(() => {
      const el = containerRef.current;
      if (!el) return;

      checkScroll();
      const onChange = throttle(checkScroll, 100);
      el.addEventListener('scroll', onChange, { passive: true });
      window.addEventListener('resize', onChange);

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
      <div className={cn('relative w-full max-w-full min-w-0', className)} {...props}>
        <div
          ref={(node) => {
            containerRef.current = node;
            if (typeof ref === 'function') ref(node);
            else if (ref) ref.current = node;
          }}
          className={cn(
            'table-responsive overflow-x-auto scrollbar-thin pb-1.5 w-full min-w-0',
            viewportClassName
          )}
        >
          {children}
        </div>

        {showOverflowHint && canScrollLeft && (
          <div
            className="pointer-events-none absolute inset-y-0 left-0 w-5 bg-gradient-to-r from-card/90 to-transparent"
            aria-hidden="true"
          />
        )}
        {showOverflowHint && canScrollRight && (
          <div
            className="pointer-events-none absolute inset-y-0 right-0 w-5 bg-gradient-to-l from-card/90 to-transparent"
            aria-hidden="true"
          />
        )}
      </div>
    );
  }
);

HorizontalScrollRow.displayName = 'HorizontalScrollRow';
