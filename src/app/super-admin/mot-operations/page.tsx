'use client';

import React, { Suspense } from 'react';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { MotOperationsWorkspace, type MotWorkspaceTab } from '@/frontend/modules/mot/MotOperationsWorkspace';
import { useCurrentUser } from '@/frontend/hooks/useCurrentUser';
import { Skeleton } from '@/components/ui/skeleton';

function PageSkeleton() {
  return (
    <div className="min-h-[50vh] space-y-3 p-4 sm:p-6" aria-busy="true" aria-label="Loading">
      <Skeleton className="h-8 w-48" />
      <Skeleton className="h-24 w-full rounded-xl" />
      <Skeleton className="h-24 w-full rounded-xl" />
    </div>
  );
}

const VIEWS: MotWorkspaceTab[] = [
  'DISPATCH', 'ACTIVE_JOURNEYS', 'JOURNEY_HISTORY', 'JOURNEY_MAP', 'SMS_OUTBOX', 'PROFILES', 'APPROVALS',
];

function Content() {
  const { currentUser, loadingUser } = useCurrentUser();
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const raw = searchParams?.get('view')?.toUpperCase() as MotWorkspaceTab | undefined;
  const view = raw && VIEWS.includes(raw) ? raw : undefined;

  if (loadingUser || !currentUser) {
    return <PageSkeleton />;
  }

  return (
    <div className="min-h-screen bg-subtle p-4 sm:p-6">
      <MotOperationsWorkspace
        currentUser={currentUser}
        activeTab={view}
        onTabChange={(tab) => router.replace(`${pathname}?view=${tab}`)}
      />
    </div>
  );
}

export default function SuperAdminMotOperationsPage() {
  return (
    <Suspense fallback={<PageSkeleton />}>
      <Content />
    </Suspense>
  );
}
