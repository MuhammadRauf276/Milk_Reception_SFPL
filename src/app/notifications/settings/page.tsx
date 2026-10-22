'use client';

import { useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { StationShell } from '@/frontend/modules/shared/StationShell';
import { PageLoader } from '@/components/ui/spinner';
import { NotificationDeviceSettings } from '@/frontend/modules/notifications/NotificationDeviceSettings';
import { useCurrentUser } from '@/frontend/hooks/useCurrentUser';

export default function NotificationSettingsPage() {
  const router = useRouter();
  const { currentUser: user, loadingUser: loading } = useCurrentUser();

  useEffect(() => {
    if (loading) return;
    if (!user) {
      router.replace('/login');
    }
  }, [loading, user, router]);

  if (loading || !user) return <PageLoader label="Verifying access…" className="min-h-screen" />;

  return (
    <StationShell currentUser={user} title="Notification Settings" mainClassName="max-w-3xl">
      <NotificationDeviceSettings />
    </StationShell>
  );
}
