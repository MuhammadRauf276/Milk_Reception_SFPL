import './globals.css';
import type { Metadata, Viewport } from 'next';
import { ToastProvider } from '@/frontend/context/ToastContext';
import { PwaShell } from '@/frontend/modules/pwa/PwaShell';

export const metadata: Metadata = {
  title: 'MilkReception - Physical Plant Kanban & Supply Chain Dashboard',
  description: 'Enterprise 5-stage milk reception pipeline and automated quality tracking platform.',
  manifest: '/manifest.webmanifest',
};

export const viewport: Viewport = {
  themeColor: '#1E3A8A',
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en" suppressHydrationWarning>
      <body className="antialiased bg-[#FDFBF9] text-[#111311] min-h-screen" suppressHydrationWarning>
        <ToastProvider>
          {children}
          <PwaShell />
        </ToastProvider>
      </body>
    </html>
  );
}