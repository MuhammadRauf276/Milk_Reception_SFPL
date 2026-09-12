'use client';

import React, { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { User } from '@core/types';
import { MilkTestPolicyWorkspace } from '@/frontend/modules/mpd/policy/MilkTestPolicyWorkspace';

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
          if (role === 'SUPER_ADMIN') {
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
      <div className="flex items-center justify-center p-12 font-mono text-xs font-bold text-slate-600">
        Loading Test Policy Administration...
      </div>
    );
  }

  if (!isAuthorized) {
    return null;
  }

  return <MilkTestPolicyWorkspace currentUser={currentUser} />;
}
