'use client';

import React from 'react';
import { Menu } from 'lucide-react';
import { User } from '@core/types';
import { NotificationBell } from '@/frontend/modules/notifications/NotificationBell';
import { Button } from '@/components/ui/button';
import { BrandMark } from './navigation/NavPanel';
import { UserMenu } from './UserMenu';

interface HeaderProps {
  currentUser: User | null;
  title?: string;
  sourceName?: string;
  showBranding?: boolean;
  onMenuClick?: () => void;
  showMenuButton?: boolean;
  isZmccVariant?: boolean;
  menuButtonRef?: React.RefObject<HTMLButtonElement | null>;
}

export const Header: React.FC<HeaderProps> = ({
  currentUser,
  title = 'Milk Reception System',
  sourceName,
  showBranding = false,
  onMenuClick,
  showMenuButton = false,
  menuButtonRef,
}) => {
  const shouldShowMenu = Boolean(onMenuClick || showMenuButton);

  const resolvedSourceName =
    sourceName ||
    currentUser?.procurement_source?.name ||
    currentUser?.zone ||
    null;

  return (
    <header className="sticky top-0 z-header flex h-16 w-full max-w-full shrink-0 items-center gap-3 border-b bg-card/95 px-3 backdrop-blur-sm supports-backdrop-filter:bg-card/80 sm:px-6">
      {shouldShowMenu && (
        <Button
          ref={menuButtonRef}
          variant="ghost"
          size="icon"
          onClick={onMenuClick}
          className="hide-with-sidebar -ml-1 text-foreground"
          aria-label="Open navigation"
        >
          <Menu className="h-5 w-5" />
        </Button>
      )}

      {showBranding && (
        <div className="hide-with-sidebar hidden items-center gap-3 sm:flex">
          <BrandMark />
          <span className="h-5 w-px bg-border" aria-hidden="true" />
        </div>
      )}

      <div className="flex min-w-0 flex-1 items-center gap-2">
        <h1 className="truncate text-sm font-semibold text-foreground">{title}</h1>
        {resolvedSourceName && resolvedSourceName !== title && (
          <span className="hidden max-w-[220px] truncate rounded-md border bg-subtle px-2 py-0.5 text-xs font-medium text-muted-foreground md:inline-block">
            {resolvedSourceName}
          </span>
        )}
      </div>

      <div className="flex shrink-0 items-center gap-1">
        <NotificationBell currentUser={currentUser} />
        <UserMenu currentUser={currentUser} />
      </div>
    </header>
  );
};
