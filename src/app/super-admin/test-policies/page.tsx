'use client';

import React from 'react';
import { UnifiedStagePoliciesRulesWorkspace } from '@/frontend/modules/super-admin/UnifiedStagePoliciesRulesWorkspace';
import { useCurrentUser } from '@/frontend/hooks/useCurrentUser';
import { PageLoader } from '@/components/ui/spinner';

export default function SuperAdminTestPoliciesPage() {
  const { currentUser, loadingUser } = useCurrentUser();

  if (loadingUser || !currentUser) {
    return <PageLoader label="Loading Test Policies…" className="min-h-[50vh]" />;
  }

  return (
    <div className="space-y-6">
      <UnifiedStagePoliciesRulesWorkspace currentUser={currentUser} />
    </div>
  );
}
