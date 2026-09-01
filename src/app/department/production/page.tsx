'use client';

import React, { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { ProductionUnloadingWorkspace } from '@modules/dashboard/ProductionUnloadingWorkspace';
import { Header } from '@modules/shared/Header';
import { User } from '@core/types';

export default function ProductionDepartmentPage() {
  const router = useRouter();
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);
  const [isAuthorized, setIsAuthorized] = useState(false);

  useEffect(() => {
    async function loadUser() {
      try {
        const res = await fetch('/api/auth/me');
        if (res.ok) {
          const data = await res.json();
          const roleStr = data.user?.role as string;
          const allowedRoles = ['Admin', 'Production_Operator', 'PRODUCTION_OPERATOR', 'Production_Manager', 'Production'];
          if (data.user && allowedRoles.includes(roleStr)) {
            setUser(data.user);
            setIsAuthorized(true);
          } else {
            router.push('/login');
          }
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
        Loading Production Workstation...
      </div>
    );
  }

  if (!isAuthorized || !user) {
    return null;
  }

  return (
    <div className="min-h-screen bg-[#FDFBF9] text-[#111311] flex flex-col font-sans w-full max-w-full overflow-x-hidden">
      <Header
        currentUser={user}
        title="Production"
        showBranding={true}
      />
      <main className="flex-1 p-4 sm:p-6 overflow-y-auto w-full max-w-full">
        <ProductionUnloadingWorkspace currentUser={user} />
      </main>
    </div>
  );
}
