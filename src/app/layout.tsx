import './globals.css';
import type { Metadata } from 'next';
import { ToastProvider } from '@/frontend/context/ToastContext';

export const metadata: Metadata = {
  title: 'MilkReception - Physical Plant Kanban & Supply Chain Dashboard',
  description: 'Enterprise 5-stage milk reception pipeline and automated quality tracking platform.',
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en">
      <body className="antialiased bg-[#F8FAFC] text-[#0F172A] min-h-screen">
        <ToastProvider>{children}</ToastProvider>
      </body>
    </html>
  );
}
