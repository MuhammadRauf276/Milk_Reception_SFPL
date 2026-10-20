'use client';

import React from 'react';
import Link from 'next/link';
import { Bell, ChevronDown, LogOut } from 'lucide-react';
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
  const [unsent, setUnsent] = React.useState<{ count: number; needsAttention: number } | null>(null);

  const handleLogoutClick = async () => {
    const safety = await getLogoutSafety({ isMot: currentUser?.role === 'MOT' }).catch(() => null);
    if (safety && safety.total > 0) {
      setUnsent({ count: safety.total, needsAttention: safety.needsAttention });
      return;
    }
    await logoutUser();
  };

  return (
    <>
    <DropdownMenu>
      <DropdownMenuTrigger
        className="flex h-9 items-center gap-2 rounded-md pl-1 pr-1.5 text-left transition-colors hover:bg-muted focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-ring data-[state=open]:bg-muted sm:pr-2"
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
        <DropdownMenuItem destructive onSelect={() => void handleLogoutClick()}>
          <LogOut />
          Sign out
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
    {unsent !== null ? (
      <UnsentWorkLogoutDialog
        count={unsent.count}
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
