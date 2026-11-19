'use client';

import React from 'react';
import { OutageWindowsPanel } from '@/frontend/modules/super-admin/outage/OutageWindowsPanel';
import { useCurrentUser } from '@/frontend/hooks/useCurrentUser';

export default function SuperAdminOutageWindowsPage() {
  const { currentUser } = useCurrentUser();
  return (
    <div className="w-full max-w-full overflow-x-hidden">
      <OutageWindowsPanel canEdit={currentUser?.role === 'SUPER_ADMIN'} />
    </div>
  );
}
