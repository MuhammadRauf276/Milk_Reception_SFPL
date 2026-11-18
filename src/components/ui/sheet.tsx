'use client';

import * as React from 'react';
import * as DialogPrimitive from '@radix-ui/react-dialog';
import { VisuallyHidden } from '@radix-ui/react-visually-hidden';
import { AnimatePresence, motion, useReducedMotion } from 'framer-motion';
import { cn } from '@/lib/utils';

export interface SheetProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  side?: 'left' | 'right';
  className?: string;
  children: React.ReactNode;
}

/**
 * Slide-over panel (navigation drawer, detail panels) on the shared `z-modal` layer.
 *
 * Non-modal on purpose: a modal Radix dialog locks page scrolling and blocks touches on the page until its closing
 * animation reports it has finished. On a busy phone, closing the drawer as a menu link changes the page could
 * leave the whole screen frozen with only the drawer responding. Our own backdrop closes the drawer on a tap and
 * stops touches reaching the page while it is open; Escape still closes it.
 */
export function Sheet({ open, onOpenChange, title, side = 'left', className, children }: SheetProps) {
  const reduceMotion = useReducedMotion();
  const offset = side === 'left' ? '-100%' : '100%';

  return (
    <DialogPrimitive.Root open={open} onOpenChange={onOpenChange} modal={false}>
      <AnimatePresence>
        {open ? (
          <DialogPrimitive.Portal forceMount>
            <motion.div
              aria-hidden="true"
              className="fixed inset-0 z-modal touch-none bg-neutral-950/40 backdrop-blur-[2px]"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0, pointerEvents: 'none' }}
              transition={{ duration: 0.18 }}
              onClick={() => onOpenChange(false)}
            />
            <DialogPrimitive.Content
              asChild
              forceMount
              aria-describedby={undefined}
              // The backdrop above handles taps outside; Radix must not also close on the same tap.
              onInteractOutside={(e) => e.preventDefault()}
            >
              <motion.div
                className={cn(
                  'scrollbar-thin overscroll-contain fixed inset-y-0 z-modal flex w-80 max-w-[88vw] flex-col overflow-y-auto overflow-x-hidden bg-card shadow-xl outline-hidden touch-scroll pt-safe pb-[max(0.75rem,env(safe-area-inset-bottom))]',
                  side === 'left' ? 'left-0 border-r' : 'right-0 border-l',
                  className
                )}
                initial={reduceMotion ? { opacity: 0 } : { x: offset }}
                animate={reduceMotion ? { opacity: 1 } : { x: 0 }}
                exit={reduceMotion ? { opacity: 0 } : { x: offset }}
                transition={{ type: 'spring', stiffness: 380, damping: 38 }}
              >
                <VisuallyHidden>
                  <DialogPrimitive.Title>{title}</DialogPrimitive.Title>
                </VisuallyHidden>
                {children}
              </motion.div>
            </DialogPrimitive.Content>
          </DialogPrimitive.Portal>
        ) : null}
      </AnimatePresence>
    </DialogPrimitive.Root>
  );
}

export const SheetClose = DialogPrimitive.Close;
