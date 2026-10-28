'use client';

import React, { Suspense } from 'react';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { ZmccMasterDataWorkspace } from '@/frontend/modules/zmcc/ZmccMasterDataWorkspace';
import type { MasterDataTab } from '@/frontend/modules/zmcc/master/masterTypes';
import { useCurrentUser } from '@/frontend/hooks/useCurrentUser';
import { PageLoader } from '@/components/ui/spinner';

const VIEWS: MasterDataTab[] = [
  'LOCAL_SUPPLIERS', 'ROUTES', 'AREAS', 'MILK_SOURCES', 'SHOPS', 'CHILLER_OWNERSHIP', 'TANKS', 'APPROVALS',
];

function Content() {
  const { currentUser, loadingUser } = useCurrentUser();
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const raw = searchParams?.get('view')?.toUpperCase() as MasterDataTab | undefined;
  const view = raw && VIEWS.includes(raw) ? raw : undefined;

  if (loadingUser || !currentUser) {
    return <PageLoader label="Loading…" className="min-h-[50vh]" />;
  }

  return (
    <ZmccMasterDataWorkspace
      currentUser={currentUser}
      activeTab={view}
      onTabChange={(tab) => router.replace(`${pathname}?view=${tab}`)}
    />
  );
}

export default function SuperAdminZmccMasterDataPage() {
  return (
    <Suspense fallback={<PageLoader label="Loading…" className="min-h-[50vh]" />}>
      <Content />
    </Suspense>
  );
}
