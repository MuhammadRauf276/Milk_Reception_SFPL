import '@fontsource-variable/inter';
import '@fontsource-variable/jetbrains-mono';
import './globals.css';
import type { Metadata, Viewport } from 'next';
import { ToastProvider } from '@/frontend/context/ToastContext';
import { PwaShell } from '@/frontend/modules/pwa/PwaShell';
import { QueryProvider } from '@/lib/query/QueryProvider';
import { TooltipProvider } from '@/components/ui/tooltip';
import { MotionProvider } from '@/components/motion/motion-provider';

export const metadata: Metadata = {
  title: {
    default: 'Milk Reception · SFPL',
    template: '%s · SFPL Milk Reception',
  },
  description: 'Milk reception, quality and supply-chain operations for Shakarganj Food Products Ltd.',
  manifest: '/manifest.webmanifest',
  icons: {
    icon: [
      { url: '/images/shakarganj-favicon.png?v=red', type: 'image/png' },
      { url: '/favicon.ico?v=red' },
    ],
    shortcut: '/images/shakarganj-favicon.png?v=red',
    apple: '/images/shakarganj-favicon.png?v=red',
  },
};

export const viewport: Viewport = {
  themeColor: '#ED1C24',
  width: 'device-width',
  initialScale: 1,
  maximumScale: 5,
  userScalable: true,
  interactiveWidget: 'resizes-content',
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en" suppressHydrationWarning>
      <body className="min-h-[100dvh] bg-background font-sans text-foreground antialiased" suppressHydrationWarning>
        <MotionProvider>
          <TooltipProvider delayDuration={250}>
            <ToastProvider>
              <QueryProvider>{children}</QueryProvider>
              <PwaShell />
            </ToastProvider>
          </TooltipProvider>
        </MotionProvider>
      </body>
    </html>
  );
}
