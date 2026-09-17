'use client';

import React, { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { MPDFieldWorkspace } from '@modules/dashboard/MPDFieldWorkspace';
import { Header } from '@modules/shared/Header';
import { User } from '@core/types';

export default function MPDDepartmentPage() {
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
          const u = data.user;
          if (u.role === 'ZMCC_LAB_ATTENDANT') {
            router.replace('/zmcc/dispatch');
            return;
          }
          if (u.role !== 'SUPER_ADMIN' && u.role !== 'HEAD_OF_MPD') {
            router.push('/workspace-unavailable');
            return;
          }
          setUser(u);
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

  if (loading || !user) {
    return (
      <div className="p-8 text-center text-xs font-bold text-slate-500">
        Loading MPD Dispatch...
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-[#FDFBF9] text-[#111311] flex flex-col font-sans w-full max-w-full overflow-x-hidden">
      <Header
        currentUser={user}
        title="MPD Dispatch"
        showBranding={true}
      />
      <main className="flex-1 p-4 sm:p-6 overflow-y-auto w-full max-w-full">
        <MPDFieldWorkspace currentUser={user} />
      </main>
    </div>
  );
}
