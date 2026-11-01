'use client';

import * as React from 'react';
import { Drawer as DrawerPrimitive } from 'vaul';
import * as DialogPrimitive from '@radix-ui/react-dialog';
import { cn } from '@/lib/utils';
import { useVisualViewport } from '@/frontend/hooks/useVisualViewport';

const DESKTOP_QUERY = '(min-width: 768px)';

function subscribe(onChange: () => void) {
  const mq = window.matchMedia(DESKTOP_QUERY);
  mq.addEventListener('change', onChange);
  return () => mq.removeEventListener('change', onChange);
}

/** True from the `md` breakpoint up. Phones get a bottom sheet, bigger screens a centred modal. */
export function useIsDesktop(): boolean {
  return React.useSyncExternalStore(
    subscribe,
    () => window.matchMedia(DESKTOP_QUERY).matches,
    () => false
  );
}

const DesktopContext = React.createContext(false);

type DrawerRootProps = React.ComponentProps<typeof DrawerPrimitive.Root>;

/**
 * Responsive overlay: bottom sheet (vaul) on phones, centred modal (Radix Dialog) on md+.
 * Same API either way, so every form that uses it adapts without changes.
 */
const Drawer = ({ shouldScaleBackground = false, dismissible = true, open, onOpenChange, children, ...props }: DrawerRootProps) => {
  const desktop = useIsDesktop();
  if (desktop) {
    return (
      <DesktopContext.Provider value>
        <DialogPrimitive.Root
          open={open}
          onOpenChange={(o) => {
            if (dismissible || o) onOpenChange?.(o);
          }}
        >
          {children}
        </DialogPrimitive.Root>
      </DesktopContext.Provider>
    );
  }
  return (
    <DesktopContext.Provider value={false}>
      <DrawerPrimitive.Root
        shouldScaleBackground={shouldScaleBackground}
        dismissible={dismissible}
        open={open}
        onOpenChange={onOpenChange}
        {...props}
      >
        {children}
      </DrawerPrimitive.Root>
    </DesktopContext.Provider>
  );
};

const DrawerOverlay = React.forwardRef<
  React.ElementRef<typeof DrawerPrimitive.Overlay>,
  React.ComponentPropsWithoutRef<typeof DrawerPrimitive.Overlay>
>(({ className, ...props }, ref) => (
  <DrawerPrimitive.Overlay
    ref={ref}
    className={cn('fixed inset-0 z-modal bg-slate-950/40 backdrop-blur-[2px]', className)}
    {...props}
  />
));
DrawerOverlay.displayName = 'DrawerOverlay';

const DrawerContent = React.forwardRef<
  React.ElementRef<typeof DrawerPrimitive.Content>,
  React.ComponentPropsWithoutRef<typeof DrawerPrimitive.Content>
>(({ className, children, style, ...props }, ref) => {
  const desktop = React.useContext(DesktopContext);
  const { height: vvh, isKeyboardOpen } = useVisualViewport();

  const keepCameraOpen = (e: { target: EventTarget | null; preventDefault: () => void }) => {
    if ((e.target as HTMLElement | null)?.closest?.('[data-live-camera]')) e.preventDefault();
  };

  if (desktop) {
    return (
      <DialogPrimitive.Portal>
        <DialogPrimitive.Overlay className="fixed inset-0 z-modal bg-slate-950/40 backdrop-blur-[2px] data-[state=open]:animate-in data-[state=open]:fade-in-0 data-[state=closed]:animate-out data-[state=closed]:fade-out-0 duration-150" />
        <DialogPrimitive.Content
          aria-describedby={undefined}
          onInteractOutside={keepCameraOpen}
          className={cn(
            'fixed left-1/2 top-1/2 z-modal flex max-h-[88dvh] w-[calc(100vw-3rem)] max-w-2xl -translate-x-1/2 -translate-y-1/2 flex-col overflow-hidden rounded-2xl border border-border bg-card shadow-xl outline-hidden data-[state=open]:animate-in data-[state=open]:fade-in-0 data-[state=open]:zoom-in-95 data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=closed]:zoom-out-95 duration-150',
            className
          )}
          style={style}
        >
          {children}
        </DialogPrimitive.Content>
      </DialogPrimitive.Portal>
    );
  }

  // On mobile Android/iOS: adjust max-height dynamically when software keyboard opens
  const mobileMaxHeight =
    isKeyboardOpen && vvh
      ? `${Math.max(260, Math.floor(vvh - 12))}px`
      : '92dvh';

  return (
    <DrawerPrimitive.Portal>
      <DrawerOverlay />
      <DrawerPrimitive.Content
        ref={ref}
        role="dialog"
        aria-describedby={undefined}
        onInteractOutside={keepCameraOpen}
        className={cn(
          'fixed inset-x-0 bottom-0 z-modal mx-auto flex w-full max-w-2xl flex-col rounded-t-3xl border border-border bg-card outline-hidden overflow-hidden touch-scroll transition-[max-height] duration-150 ease-out',
          className
        )}
        style={{
          maxHeight: mobileMaxHeight,
          ...style,
        }}
        {...props}
      >
        <div className="mx-auto mt-2.5 h-1.5 w-11 shrink-0 rounded-full bg-slate-300" aria-hidden="true" />
        {children}
      </DrawerPrimitive.Content>
    </DrawerPrimitive.Portal>
  );
});
DrawerContent.displayName = 'DrawerContent';

const DrawerTitle = React.forwardRef<
  React.ElementRef<typeof DrawerPrimitive.Title>,
  React.ComponentPropsWithoutRef<typeof DrawerPrimitive.Title>
>(({ className, ...props }, ref) => {
  const desktop = React.useContext(DesktopContext);
  const cls = cn('text-lg font-semibold text-foreground', className);
  return desktop ? (
    <DialogPrimitive.Title className={cls} {...(props as React.ComponentPropsWithoutRef<typeof DialogPrimitive.Title>)} />
  ) : (
    <DrawerPrimitive.Title ref={ref} className={cls} {...props} />
  );
});
DrawerTitle.displayName = 'DrawerTitle';

const DrawerDescription = React.forwardRef<
  React.ElementRef<typeof DrawerPrimitive.Description>,
  React.ComponentPropsWithoutRef<typeof DrawerPrimitive.Description>
>(({ className, ...props }, ref) => {
  const desktop = React.useContext(DesktopContext);
  const cls = cn('text-sm text-muted-foreground', className);
  return desktop ? (
    <DialogPrimitive.Description className={cls} {...(props as React.ComponentPropsWithoutRef<typeof DialogPrimitive.Description>)} />
  ) : (
    <DrawerPrimitive.Description ref={ref} className={cls} {...props} />
  );
});
DrawerDescription.displayName = 'DrawerDescription';

const DrawerHeader = ({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) => (
  <div className={cn('flex shrink-0 flex-col gap-1.5 px-4 pt-3 pb-2 text-left sm:px-6', className)} {...props} />
);
DrawerHeader.displayName = 'DrawerHeader';

const DrawerBody = ({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) => (
  <div className={cn('flex-1 min-h-0 overflow-y-auto px-4 py-2 touch-scroll sm:px-6', className)} {...props} />
);
DrawerBody.displayName = 'DrawerBody';

const DrawerFooter = ({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) => (
  <div
    className={cn(
      'mt-auto flex shrink-0 flex-col-reverse gap-2 border-t border-border bg-card p-4 pb-[max(1rem,env(safe-area-inset-bottom))] sm:flex-row sm:justify-end sm:px-6',
      className
    )}
    {...props}
  />
);
DrawerFooter.displayName = 'DrawerFooter';

export {
  Drawer,
  DrawerContent,
  DrawerTitle,
  DrawerDescription,
  DrawerOverlay,
  DrawerHeader,
  DrawerBody,
  DrawerFooter,
};
