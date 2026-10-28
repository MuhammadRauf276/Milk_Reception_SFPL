'use client';

import React from 'react';
import Link from 'next/link';
import { Bell, ChevronDown, LogOut, Wifi, WifiOff } from 'lucide-react';
import { useForcedOffline } from '@/frontend/hooks/useOnlineStatus';
import { runSyncOnce } from '@/frontend/modules/pwa/syncEngine';
import { cn } from '@/lib/utils';
import { User } from '@core/types';
import { getLogoutSafety, logoutUser } from '@/frontend/modules/auth/logout';
import { UnsentWorkLogoutDialog } from '@/frontend/modules/auth/UnsentWorkLogoutDialog';
import { Avatar, AvatarFallback } from '@/components/ui/avatar';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { formatRoleLabel } from './navigation/NavPanel';

function initials(name?: string | null) {
  if (!name) return 'U';
  const parts = name.trim().split(/\s+/).filter((p) => /[a-z0-9]/i.test(p[0] ?? ''));
  return ((parts[0]?.[0] ?? 'U') + (parts.length > 1 ? parts[parts.length - 1][0] : '')).toUpperCase();
}

export function UserMenu({ currentUser }: { currentUser: User | null }) {
  const displayName = currentUser?.name || currentUser?.username || 'Operator';
  const [forcedOffline, setForcedOffline] = useForcedOffline();
  const [unsent, setUnsent] = React.useState<{ count: number; sendableCount: number; draftsCount: number; needsAttention: number } | null>(null);

  const handleLogoutClick = async () => {
    const safety = await getLogoutSafety({ isMot: currentUser?.role === 'MOT' }).catch(() => null);
    if (safety && safety.total > 0) {
      setUnsent({ count: safety.total, sendableCount: safety.sendableCount, draftsCount: safety.draftsCount, needsAttention: safety.needsAttention });
      return;
    }
    await logoutUser();
  };

  return (
    <>
    <DropdownMenu>
      <DropdownMenuTrigger
        className="flex min-h-11 min-w-11 items-center gap-2 rounded-md pl-1 pr-1.5 text-left transition-colors hover:bg-muted focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-ring data-[state=open]:bg-muted sm:pr-2"
        aria-label="Account menu"
      >
        <Avatar className="h-7 w-7">
          <AvatarFallback>{initials(displayName)}</AvatarFallback>
        </Avatar>
        <span className="hidden max-w-[160px] truncate text-sm font-medium text-foreground md:block">{displayName}</span>
        <ChevronDown className="hidden h-3.5 w-3.5 text-muted-foreground md:block" />
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-60">
        <DropdownMenuLabel className="font-normal">
          <p className="truncate text-sm font-medium text-foreground">{displayName}</p>
          {currentUser?.username ? (
            <p className="truncate text-xs text-muted-foreground">@{currentUser.username}</p>
          ) : null}
          {currentUser?.role ? (
            <p className="mt-1.5 inline-flex rounded bg-muted px-1.5 py-0.5 text-[11px] font-medium text-slate-600">
              {formatRoleLabel(currentUser.role)}
            </p>
          ) : null}
        </DropdownMenuLabel>
        <DropdownMenuSeparator />
        <DropdownMenuItem asChild>
          <Link href="/notifications/settings">
            <Bell />
            Notification settings
          </Link>
        </DropdownMenuItem>
        <DropdownMenuSeparator />
        <div className="flex items-center justify-between px-2 py-1.5 text-xs select-none">
          <span className="flex items-center gap-2 text-foreground font-medium">
            {forcedOffline ? <WifiOff className="h-3.5 w-3.5 text-amber-600" /> : <Wifi className="h-3.5 w-3.5 text-emerald-600" />}
            Offline Mode
          </span>
          <button
            type="button"
            role="switch"
            aria-checked={forcedOffline}
            onClick={(e) => {
              e.stopPropagation();
              const next = !forcedOffline;
              setForcedOffline(next);
              if (!next) void runSyncOnce();
            }}
            className={cn(
              'relative inline-flex h-5 w-9 shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors duration-200 ease-in-out',
              forcedOffline ? 'bg-amber-600' : 'bg-slate-300'
            )}
          >
            <span
              className={cn(
                'pointer-events-none inline-block h-4 w-4 transform rounded-full bg-white shadow-xs ring-0 transition duration-200 ease-in-out',
                forcedOffline ? 'translate-x-4' : 'translate-x-0'
              )}
            />
          </button>
        </div>
        <DropdownMenuSeparator />
        <DropdownMenuItem destructive onSelect={() => void handleLogoutClick()}>
          <LogOut />
          Sign out
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
    {unsent !== null ? (
      <UnsentWorkLogoutDialog
        count={unsent.count}
        sendableCount={unsent.sendableCount}
        draftsCount={unsent.draftsCount}
        needsAttention={unsent.needsAttention}
        isMot={currentUser?.role === 'MOT'}
        onClose={() => setUnsent(null)}
        onAllSent={() => {
          setUnsent(null);
          void logoutUser();
        }}
        onKeepAndLogout={() => {
          setUnsent(null);
          void logoutUser({ keepUnsentWork: true });
        }}
      />
    ) : null}
    </>
  );
}
