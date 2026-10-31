'use client';

import React, { Suspense, useCallback, useRef, useState } from 'react';
import { User } from '@core/types';
import { cn } from '@/lib/utils';
import { PageTransition } from '@/components/motion/page-transition';
import { Header } from './Header';
import { HierarchicalNavDrawer } from './navigation/HierarchicalNavDrawer';

interface StationShellProps {
  currentUser: User | null;
  title: string;
  sourceName?: string;
  /** Classes for the <main> element, e.g. a max width. */
  mainClassName?: string;
  children: React.ReactNode;
}

/** Standard authenticated page frame: sticky header, role navigation and animated content. */
export function StationShell({ currentUser, title, sourceName, mainClassName, children }: StationShellProps) {
  const [isDrawerOpen, setIsDrawerOpen] = useState(false);
  const menuButtonRef = useRef<HTMLButtonElement | null>(null);
  const openDrawer = useCallback(() => setIsDrawerOpen(true), []);
  const closeDrawer = useCallback(() => setIsDrawerOpen(false), []);

  return (
    <div className="flex min-h-[100dvh] w-full max-w-full flex-col bg-background text-foreground overflow-x-hidden">
      <Header
        currentUser={currentUser}
        title={title}
        sourceName={sourceName}
        showBranding
        onMenuClick={openDrawer}
        menuButtonRef={menuButtonRef}
      />
      <Suspense fallback={null}>
        <HierarchicalNavDrawer
          currentUser={currentUser}
          isOpen={isDrawerOpen}
          onClose={closeDrawer}
          triggerButtonRef={menuButtonRef}
        />
      </Suspense>
      <main className={cn('mx-auto w-full min-w-0 max-w-full flex-1 p-3 sm:p-6 lg:p-8 pb-[max(1.5rem,env(safe-area-inset-bottom))]', mainClassName)}>
        <PageTransition>{children}</PageTransition>
      </main>
    </div>
  );
}
