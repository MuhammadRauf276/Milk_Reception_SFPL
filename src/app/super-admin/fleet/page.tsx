'use client';

import React from 'react';
import { FleetWorkspace } from '@/frontend/modules/mot/FleetWorkspace';
import { useCurrentUser } from '@/frontend/hooks/useCurrentUser';
import { SkeletonList } from '@/components/ui/loaders';

export default function FleetPage() {
  const { currentUser, loadingUser } = useCurrentUser();

  if (loadingUser || !currentUser) {
    return <div className="p-4 sm:p-6"><SkeletonList count={4} /></div>;
  }

  return (
    <div className="min-h-screen bg-subtle p-4 sm:p-6">
      <FleetWorkspace currentUser={currentUser} />
    </div>
  );
}
