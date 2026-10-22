'use client';

import React, { useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { ZMCCManagerWorkspace } from '@modules/dashboard/ZMCCManagerWorkspace';
import { canActAs } from '@/backend/core/roles/hierarchy';
import { useCurrentUser } from '@/frontend/hooks/useCurrentUser';
import { PageLoader } from '@/components/ui/spinner';

export default function ZMCCManagerPage() {
  const router = useRouter();
  const { currentUser: user, loadingUser: loading } = useCurrentUser();

  useEffect(() => {
    if (loading) return;
    if (!user) {
      router.push('/login');
      return;
    }
    const isAuthorized = canActAs(user.role, 'ZMCC_MANAGER');
    const isSystemScope =
      user.role === 'SUPER_ADMIN' ||
      user.role === 'DATA_EXECUTIVE' ||
      user.role === 'HEAD_OF_MPD' ||
      user.role === 'EXECUTIVE_MANAGEMENT';

    if (
      !isAuthorized ||
      (!isSystemScope &&
        (!user.procurement_source_id ||
          !user.procurement_source ||
          user.procurement_source.is_active === false ||
          user.procurement_source.source_type !== 'ZMCC'))
    ) {
      router.push('/workspace-unavailable');
    }
  }, [loading, user, router]);

  if (loading) {
    return (
      <PageLoader label="Loading ZMCC Manager Station…" className="min-h-screen" />
    );
  }

  if (!user) {
    return null;
  }

  return (
    <React.Suspense fallback={<PageLoader label="Loading ZMCC Manager Station…" className="min-h-screen" />}>
      <ZMCCManagerWorkspace currentUser={user} />
    </React.Suspense>
  );
}
