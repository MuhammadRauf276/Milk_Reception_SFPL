'use client';

import React, { Suspense, useMemo } from 'react';
import { useSearchParams } from 'next/navigation';
import { ManagementShell } from '@/frontend/modules/shared/ManagementShell';
import { MyWorkWorkspace } from '@/frontend/modules/governance/MyWorkWorkspace';
import { REQUESTING_ROLES } from '@/lib/recordEditor';
import { useCurrentUser } from '@/frontend/hooks/useCurrentUser';
import { canActAs } from '@/backend/core/roles/hierarchy';
import { PageLoader } from '@/components/ui/spinner';

/** Own roles that enter records, plus a superior opening it while covering one of them (?as=ROLE). */
function useAllowedRoles(): readonly string[] {
  const { currentUser } = useCurrentUser();
  const as = useSearchParams().get('as');
  return useMemo(() => {
    const role = currentUser?.role;
    if (role && as && REQUESTING_ROLES.includes(as) && canActAs(role, as)) return [...REQUESTING_ROLES, role];
    return REQUESTING_ROLES;
  }, [currentUser?.role, as]);
}

function MyWorkPage() {
  const allowedRoles = useAllowedRoles();
  return (
    <ManagementShell title="My work" allowedRoles={allowedRoles}>
      {() => <MyWorkWorkspace />}
    </ManagementShell>
  );
}

export default function RequestCorrectionPage() {
  return (
    <Suspense fallback={<PageLoader label="Loading…" className="min-h-dvh" />}>
      <MyWorkPage />
    </Suspense>
  );
}
