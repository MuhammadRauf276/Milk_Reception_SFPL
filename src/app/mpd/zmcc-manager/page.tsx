'use client';

import React, { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { ZMCCManagerWorkspace } from '@modules/dashboard/ZMCCManagerWorkspace';
import { User } from '@core/types';

export default function ZMCCManagerPage() {
  const router = useRouter();
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    async function loadUser() {
      try {
        const res = await fetch('/api/auth/me');
        if (res.ok) {
          const data = await res.json();
          if (!data.user) {
            router.push('/login');
            return;
          }
          if (
            data.user.role !== 'ZMCC_MANAGER' ||
            data.user.is_active === false ||
            !data.user.procurement_source_id ||
            !data.user.procurement_source ||
            data.user.procurement_source.is_active === false ||
            data.user.procurement_source.source_type !== 'ZMCC'
          ) {
            router.push('/workspace-unavailable');
            return;
          }
          setUser(data.user);
        } else {
          router.push('/login');
        }
      } catch (err) {
        console.error('Failed to load user', err);
        router.push('/login');
      } finally {
        setLoading(false);
      }
    }
    loadUser();
  }, [router]);

  if (loading) {
    return (
      <div className="min-h-screen bg-[#FDFBF9] flex items-center justify-center p-8 text-center text-xs font-bold text-slate-500">
        Loading ZMCC Manager Station...
      </div>
    );
  }

  if (!user) {
    return null;
  }

  return <ZMCCManagerWorkspace currentUser={user} />;
}
