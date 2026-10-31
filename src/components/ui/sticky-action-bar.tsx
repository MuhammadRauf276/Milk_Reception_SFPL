'use client';

import * as React from 'react';
import { cn } from '@/lib/utils';
import { useVisualViewport } from '@/frontend/hooks/useVisualViewport';

export interface StickyActionBarProps {
  children: React.ReactNode;
  className?: string;
  innerClassName?: string;
  avoidKeyboard?: boolean;
}

/**
 * StickyActionBar: Pinned bottom action bar for primary actions on mobile.
 * - Mobile: Fixed bottom bar with backdrop-blur, border, and safe-area padding.
 * - Adjusts when the virtual keyboard opens via useVisualViewport.
 * - Desktop (lg:): Reverts completely to inline relative positioning without borders or backgrounds.
 */
export function StickyActionBar({
  children,
  className,
  innerClassName,
  avoidKeyboard = true,
}: StickyActionBarProps) {
  const { isKeyboardOpen, keyboardHeight } = useVisualViewport();

  return (
    <div
      style={
        avoidKeyboard && isKeyboardOpen && keyboardHeight > 0
          ? { bottom: `${keyboardHeight}px` }
          : undefined
      }
      className={cn(
        'fixed inset-x-0 bottom-0 z-30 border-t border-border bg-background/95 p-3 pb-[max(0.75rem,env(safe-area-inset-bottom))] backdrop-blur-md shadow-lg transition-all duration-150',
        'lg:relative lg:inset-auto lg:bottom-auto lg:z-auto lg:border-t-0 lg:bg-transparent lg:p-0 lg:pb-0 lg:backdrop-blur-none lg:shadow-none',
        className
      )}
    >
      <div
        className={cn(
          'mx-auto flex max-w-7xl items-center justify-end gap-2.5',
          innerClassName
        )}
      >
        {children}
      </div>
    </div>
  );
}
