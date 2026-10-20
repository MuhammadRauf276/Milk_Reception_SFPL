'use client';

import React, { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { User } from '@core/types';
import { UnifiedStagePoliciesRulesWorkspace } from '@/frontend/modules/super-admin/UnifiedStagePoliciesRulesWorkspace';

export default function SuperAdminTestPoliciesPage() {
  const router = useRouter();
  const [currentUser, setCurrentUser] = useState<User | null>(null);
  const [isAuthorized, setIsAuthorized] = useState(false);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    async function checkAuth() {
      try {
        const res = await fetch('/api/auth/me');
        const data = await res.json();
        if (res.ok && data.user) {
          const role = data.user.role;
          if (
            [
              'SUPER_ADMIN',
              'DATA_EXECUTIVE',
              'DATA_ANALYST',
              'HEAD_OF_MPD',
              'QA_HEAD',
            ].includes(role)
          ) {
            setCurrentUser(data.user);
            setIsAuthorized(true);
          } else {
            router.push('/workspace-unavailable');
          }
        } else {
          router.push('/login');
        }
      } catch (_err) {
        router.push('/login');
      } finally {
        setLoading(false);
      }
    }

    checkAuth();
  }, [router]);

  if (loading) {
    return (
      <div className="flex items-center justify-center p-12 tabular-nums text-xs font-semibold text-slate-600">
        Loading Stage Test Policies &amp; Rules…
      </div>
    );
  }

  if (!isAuthorized) {
    return null;
  }

  return <UnifiedStagePoliciesRulesWorkspace currentUser={currentUser} />;
}
