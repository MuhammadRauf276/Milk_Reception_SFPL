'use client';

import React from 'react';
import { FleetWorkspace } from '@/frontend/modules/mot/FleetWorkspace';
import { useCurrentUser } from '@/frontend/hooks/useCurrentUser';
import { PageLoader } from '@/components/ui/spinner';

export default function FleetPage() {
  const { currentUser, loadingUser } = useCurrentUser();

  if (loadingUser || !currentUser) {
    return <PageLoader label="Loading Fleet…" className="min-h-[50vh]" />;
  }

  return (
    <div className="min-h-screen bg-subtle p-4 sm:p-6">
      <FleetWorkspace currentUser={currentUser} />
    </div>
  );
}
