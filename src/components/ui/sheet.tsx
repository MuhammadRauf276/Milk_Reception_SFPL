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

/** Slide-over panel (navigation drawer, detail panels) on the shared `z-modal` layer. */
export function Sheet({ open, onOpenChange, title, side = 'left', className, children }: SheetProps) {
  const reduceMotion = useReducedMotion();
  const offset = side === 'left' ? '-100%' : '100%';

  return (
    <DialogPrimitive.Root open={open} onOpenChange={onOpenChange}>
      <AnimatePresence>
        {open ? (
          <DialogPrimitive.Portal forceMount>
            <DialogPrimitive.Overlay asChild forceMount>
              <motion.div
                className="fixed inset-0 z-modal bg-slate-950/40 backdrop-blur-[2px]"
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
                transition={{ duration: 0.18 }}
              />
            </DialogPrimitive.Overlay>
            <DialogPrimitive.Content asChild forceMount aria-describedby={undefined}>
              <motion.div
                className={cn(
                  'fixed inset-y-0 z-modal flex w-80 max-w-[88vw] flex-col bg-card shadow-xl outline-hidden touch-scroll pt-safe pb-[max(0.75rem,env(safe-area-inset-bottom))]',
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
