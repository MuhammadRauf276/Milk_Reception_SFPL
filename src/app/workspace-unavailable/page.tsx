'use client';

import React, { Suspense, useEffect, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import { LogOut, ShieldAlert } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Spinner } from '@/components/ui/spinner';
import { StatusScreen } from '@/components/ui/status-screen';
import { isRetiredRole } from '@/backend/core/roles/hierarchy';
import { getRoleLabel } from '@/backend/core/roles/labels';
import { useCurrentUser } from '@/frontend/hooks/useCurrentUser';

function WorkspaceUnavailableContent() {
  const [signingOut, setSigningOut] = useState(false);
  const searchParams = useSearchParams();
  const { currentUser } = useCurrentUser();
  const userRole = currentUser?.role || null;

  const handleLogout = async () => {
    setSigningOut(true);
    try {
      await fetch('/api/auth/logout', { method: 'POST' });
    } catch (_err) {
      // Ignore network errors on logout
    }
    // Clear cookie client-side as well
    document.cookie = 'auth_token=; path=/; max-age=0; expires=Thu, 01 Jan 1970 00:00:00 GMT';
    // Full reload (not client routing) so no signed-in state survives; replace keeps it out of history.
    window.location.replace('/login');
  };

  const paramRole = searchParams?.get('role');
  const reason = searchParams?.get('reason');
  const effectiveRole = paramRole || userRole;
  const isRetired = reason === 'retired' || (effectiveRole ? isRetiredRole(effectiveRole) : false);

  // Exact required phrasing: "Your role (QA Manager) has been retired. Please contact your administrator."
  const roleDisplay = effectiveRole === 'QA_MANAGER' ? 'QA Manager' : (effectiveRole ? getRoleLabel(effectiveRole) : 'QA Manager');

  return (
    <StatusScreen
      tone="warning"
      icon={<ShieldAlert />}
      title={isRetired ? 'Role Retired' : 'No workspace'}
      description={
        isRetired
          ? `Role retired. Contact admin.`
          : "No workspace. Contact admin."
      }
    >
      <Button onClick={handleLogout} disabled={signingOut}>
        {signingOut ? <Spinner className="text-primary-foreground" /> : <LogOut />}
        Sign out
      </Button>
    </StatusScreen>
  );
}

export default function WorkspaceUnavailablePage() {
  return (
    <Suspense
      fallback={
        <div className="flex min-h-screen items-center justify-center">
          <Spinner />
        </div>
      }
    >
      <WorkspaceUnavailableContent />
    </Suspense>
  );
}
