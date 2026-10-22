'use client';

import React from 'react';
import { PageLoader } from '@/components/ui/spinner';
import { SuperAdminDeviceSubscriptions } from '@/frontend/modules/notifications/SuperAdminDeviceSubscriptions';
import { useCurrentUser } from '@/frontend/hooks/useCurrentUser';

export default function NotificationDevicesPage() {
  const { currentUser: user, loadingUser } = useCurrentUser();

  if (loadingUser || !user) return <PageLoader label="Verifying access…" />;

  return (
    <div className="mx-auto max-w-6xl">
      <SuperAdminDeviceSubscriptions />
    </div>
  );
}
