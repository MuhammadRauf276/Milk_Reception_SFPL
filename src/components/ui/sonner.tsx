'use client';

import { Toaster as Sonner } from 'sonner';

type ToasterProps = React.ComponentProps<typeof Sonner>;

const Toaster = ({ ...props }: ToasterProps) => (
  <Sonner
    position="top-right"
    closeButton
    visibleToasts={4}
    // Clear the 56px app header so toasts never cover the bell or account menu.
    offset={{ top: 68, right: 16 }}
    mobileOffset={{ top: 64, right: 12, left: 12 }}
    toastOptions={{
      classNames: {
        toast: 'group font-sans rounded-xl! border! border-border! bg-card! text-card-foreground! shadow-lg! text-sm!',
        title: 'font-semibold!',
        description: 'text-[13px]! opacity-90!',
        closeButton: 'bg-card! border-border!',
      },
    }}
    {...props}
  />
);

export { Toaster };
