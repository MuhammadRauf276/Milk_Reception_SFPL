'use client';

import * as React from 'react';
import * as DialogPrimitive from '@radix-ui/react-dialog';
import { VisuallyHidden } from '@radix-ui/react-visually-hidden';
import { motion, useReducedMotion } from 'framer-motion';
import { X } from 'lucide-react';
import { cn } from '@/lib/utils';

const SIZE_CLASSES = {
  sm: 'max-w-sm',
  md: 'max-w-lg',
  lg: 'max-w-2xl',
  xl: 'max-w-4xl',
  '2xl': 'max-w-6xl',
  full: 'max-w-[min(96vw,1400px)]',
} as const;

export type ModalSize = keyof typeof SIZE_CLASSES;

export interface ModalProps {
  /** Called on Escape, the optional close button, or (when enabled) an outside click. */
  onClose: () => void;
  /** Accessible dialog name. Rendered visually hidden unless `showHeader` is set. */
  title: string;
  description?: string;
  /** Render a standard header (title, description, close button). Off by default for legacy bodies that draw their own. */
  showHeader?: boolean;
  size?: ModalSize;
  className?: string;
  /** Data-entry dialogs should not vanish on a stray click; opt in when the dialog is read-only. */
  closeOnOutsideClick?: boolean;
  /** Prevent Escape/outside-click from closing, e.g. while a request is in flight. */
  preventClose?: boolean;
  children: React.ReactNode;
}

/**
 * Accessible, animated modal built on Radix Dialog + framer-motion.
 *
 * Mount it conditionally (`{open && <Modal …/>}`); wrap the condition in
 * `<AnimatePresence>` to also get an exit animation. It provides focus trapping,
 * scroll locking, Escape handling, `role="dialog"` semantics, and sits on the
 * shared `z-modal` layer.
 */
export function Modal({
  onClose,
  title,
  description,
  showHeader = false,
  size = 'md',
  className,
  closeOnOutsideClick = false,
  preventClose = false,
  children,
}: ModalProps) {
  const reduceMotion = useReducedMotion();
  const contentRef = React.useRef<HTMLDivElement | null>(null);

  const handleOpenChange = (next: boolean) => {
    if (!next && !preventClose) onClose();
  };

  // Focus the first form field rather than the close button so forms are ready to type into.
  const handleOpenAutoFocus = (event: Event) => {
    const root = contentRef.current;
    if (!root) return;
    const field = root.querySelector<HTMLElement>(
      'input:not([type="hidden"]):not([disabled]):not([readonly]), textarea:not([disabled]):not([readonly]), select:not([disabled])'
    );
    event.preventDefault();
    (field ?? root).focus({ preventScroll: true });
  };

  return (
    <DialogPrimitive.Root open onOpenChange={handleOpenChange}>
      <DialogPrimitive.Portal forceMount>
        <DialogPrimitive.Overlay asChild forceMount>
          <motion.div
            className="fixed inset-0 z-modal flex items-start justify-center overflow-y-auto touch-scroll bg-slate-950/40 p-3 pt-safe pb-[max(1rem,env(safe-area-inset-bottom))] backdrop-blur-[2px] sm:items-center sm:p-6"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.15, ease: 'easeOut' }}
          >
            <DialogPrimitive.Content
              asChild
              forceMount
              {...(description ? {} : { 'aria-describedby': undefined })}
              onOpenAutoFocus={handleOpenAutoFocus}
              onPointerDownOutside={(event) => {
                if (!closeOnOutsideClick || preventClose) event.preventDefault();
              }}
              onInteractOutside={(event) => {
                if (!closeOnOutsideClick || preventClose) event.preventDefault();
              }}
            >
              <motion.div
                ref={contentRef}
                tabIndex={-1}
                className={cn(
                  'relative my-auto w-full max-w-full rounded-xl border border-border bg-card text-card-foreground shadow-xl outline-hidden',
                  SIZE_CLASSES[size],
                  className
                )}
                initial={reduceMotion ? { opacity: 0 } : { opacity: 0, scale: 0.97, y: 8 }}
                animate={reduceMotion ? { opacity: 1 } : { opacity: 1, scale: 1, y: 0 }}
                exit={reduceMotion ? { opacity: 0 } : { opacity: 0, scale: 0.98, y: 4 }}
                transition={{ type: 'spring', stiffness: 420, damping: 34, mass: 0.8 }}
              >
                {showHeader ? (
                  <div className="flex items-start justify-between gap-4 border-b px-4 py-3 sm:px-5 sm:py-4">
                    <div className="min-w-0 space-y-1">
                      <DialogPrimitive.Title className="text-base font-semibold leading-tight">{title}</DialogPrimitive.Title>
                      {description ? (
                        <DialogPrimitive.Description className="text-sm text-muted-foreground">
                          {description}
                        </DialogPrimitive.Description>
                      ) : null}
                    </div>
                    <DialogPrimitive.Close
                      className="-mr-1 inline-flex min-h-11 min-w-11 shrink-0 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-muted hover:text-foreground focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-ring"
                      aria-label="Close"
                    >
                      <X className="h-4 w-4" />
                    </DialogPrimitive.Close>
                  </div>
                ) : (
                  <VisuallyHidden>
                    <DialogPrimitive.Title>{title}</DialogPrimitive.Title>
                    {description ? <DialogPrimitive.Description>{description}</DialogPrimitive.Description> : null}
                  </VisuallyHidden>
                )}
                {children}
              </motion.div>
            </DialogPrimitive.Content>
          </motion.div>
        </DialogPrimitive.Overlay>
      </DialogPrimitive.Portal>
    </DialogPrimitive.Root>
  );
}
