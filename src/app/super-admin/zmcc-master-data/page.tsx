'use client';

import React from 'react';
import { ZmccMasterDataWorkspace } from '@/frontend/modules/zmcc/ZmccMasterDataWorkspace';
import { useCurrentUser } from '@/frontend/hooks/useCurrentUser';
import { PageLoader } from '@/components/ui/spinner';

export default function SuperAdminZmccMasterDataPage() {
  const { currentUser, loadingUser } = useCurrentUser();

  if (loadingUser || !currentUser) {
    return <PageLoader label="Loading ZMCC Master Data…" className="min-h-[50vh]" />;
  }

  return <ZmccMasterDataWorkspace currentUser={currentUser} />;
}
