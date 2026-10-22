'use client';

import React, { useState, useEffect, useRef } from 'react';
import { usePathname, useSearchParams } from 'next/navigation';
import { Menu, WifiOff } from 'lucide-react';
import { User } from '@core/types';
import { NotificationBell } from '@/frontend/modules/notifications/NotificationBell';
import { Button } from '@/components/ui/button';
import { BrandMark } from './navigation/NavPanel';
import { UserMenu } from './UserMenu';
import { DelegationBanner } from './delegation/DelegationBanner';
import { SourceContextSelector } from './delegation/SourceContextSelector';
import { resolveDelegationContext } from './delegation/stations';
import { useDelegationInterceptor } from './delegation/useDelegationInterceptor';

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
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const sourceTriggerRef = useRef<HTMLButtonElement | null>(null);
  const [selectedSourceName, setSelectedSourceName] = useState<string | null>(null);
  const [isOffline, setIsOffline] = useState(false);

  // Monitor online status for offline notification (§5.7)
  useEffect(() => {
    if (typeof window === 'undefined') return;
    const updateStatus = () => setIsOffline(!navigator.onLine);
    updateStatus();
    window.addEventListener('online', updateStatus);
    window.addEventListener('offline', updateStatus);
    return () => {
      window.removeEventListener('online', updateStatus);
      window.removeEventListener('offline', updateStatus);
    };
  }, []);

  const shouldShowMenu = Boolean(onMenuClick || showMenuButton);

  // Determine delegation state (§5.6)
  const delegation = resolveDelegationContext(currentUser, pathname, searchParams);
  const zmccIdParam =
    searchParams?.get('zmccId') || searchParams?.get('zmcc_id') || searchParams?.get('sourceId');

  // Propagate actingAs and acting source headers to outgoing /api/* fetch requests
  useDelegationInterceptor(delegation.isDelegated, delegation.actingAs, zmccIdParam);

  const resolvedSourceName =
    selectedSourceName ||
    sourceName ||
    currentUser?.procurement_source?.name ||
    currentUser?.zone ||
    delegation.defaultFacilityName ||
    null;

  return (
    <div className="sticky top-0 z-header flex flex-col w-full max-w-full shrink-0">
      {/* Offline network interruption banner (§5.7) */}
      {isOffline && (
        <div
          role="status"
          aria-live="polite"
          className="flex w-full items-center justify-center gap-2 bg-amber-600 px-3 py-1 text-xs font-medium text-amber-50 shrink-0"
        >
          <WifiOff className="h-3.5 w-3.5" aria-hidden="true" />
          <span>Offline mode: changes will sync when network is restored</span>
        </div>
      )}

      {/* Main Header Bar */}
      <header className="flex h-16 w-full max-w-full items-center gap-3 border-b bg-card/95 px-3 backdrop-blur-sm supports-backdrop-filter:bg-card/80 sm:px-6">
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

        <div className="flex min-w-0 flex-1 items-center gap-2 sm:gap-3">
          <h1 className="truncate text-sm font-semibold text-foreground">{title}</h1>

          {/* Searchable Multi-Source Selector for System Superiors on Regional Stations (§5.5) */}
          <SourceContextSelector
            currentUser={currentUser}
            onSourceChanged={(src) => setSelectedSourceName(src.name)}
            triggerRef={sourceTriggerRef}
          />

          {/* Bound Scope Tag (for non-regional or already bound stations) */}
          {!delegation.isRegional && resolvedSourceName && resolvedSourceName !== title && (
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

      {/* Compact Delegation Banner (§5.1, §5.3, §5.6) */}
      <DelegationBanner
        currentUser={currentUser}
        sourceName={resolvedSourceName}
        onSwitchSource={() => sourceTriggerRef.current?.click()}
      />
    </div>
  );
};
