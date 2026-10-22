'use client';

import React from 'react';
import { MotOperationsWorkspace } from '@/frontend/modules/mot/MotOperationsWorkspace';
import { useCurrentUser } from '@/frontend/hooks/useCurrentUser';
import { PageLoader } from '@/components/ui/spinner';

export default function SuperAdminMotOperationsPage() {
  const { currentUser, loadingUser } = useCurrentUser();

  if (loadingUser || !currentUser) {
    return <PageLoader label="Loading MC Operations…" className="min-h-[50vh]" />;
  }

  return (
    <div className="min-h-screen bg-subtle p-4 sm:p-6">
      <MotOperationsWorkspace currentUser={currentUser} />
    </div>
  );
}
