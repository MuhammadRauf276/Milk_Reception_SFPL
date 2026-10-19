'use client';

import React from 'react';
import { UnifiedStagePoliciesRulesWorkspace } from '@/frontend/modules/super-admin/UnifiedStagePoliciesRulesWorkspace';
import type { User } from '@core/types';

interface MpdPolicyScreenProps {
  currentUser?: User | null;
}

export const MpdPolicyScreen: React.FC<MpdPolicyScreenProps> = ({ currentUser }) => {
  const isEditor = ['SUPER_ADMIN', 'DATA_EXECUTIVE', 'DATA_ANALYST'].includes(currentUser?.role || '');

  return (
    <div className="space-y-6">
      <UnifiedStagePoliciesRulesWorkspace
        currentUser={currentUser ?? null}
        defaultTestingPoint="MOT_SHOP"
        forceReadOnly={!isEditor}
      />
    </div>
  );
};
