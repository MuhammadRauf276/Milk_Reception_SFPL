'use client';

import React, { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { User } from '@core/types';
import { SuperAdminSidebar } from '@/frontend/modules/super-admin/SuperAdminSidebar';
import { SuperAdminHeader } from '@/frontend/modules/super-admin/SuperAdminHeader';

export default function SuperAdminLayout({ children }: { children: React.ReactNode }) {
  const router = useRouter();
  const [currentUser, setCurrentUser] = useState<User | null>(null);
  const [isAuthorized, setIsAuthorized] = useState(false);
  const [loading, setLoading] = useState(true);
  const [isMobileOpen, setIsMobileOpen] = useState(false);

  useEffect(() => {
    async function checkAuth() {
      try {
        const res = await fetch('/api/auth/me');
        const data = await res.json();
        if (res.ok && data.user) {
          const role = data.user.role;
          if (role === 'SUPER_ADMIN' || role === 'Admin') {
            setCurrentUser(data.user);
            setIsAuthorized(true);
          } else {
            router.push('/login');
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
      <div className="flex items-center justify-center h-screen bg-[#FDFBF9] text-[#111311] font-mono text-xs font-bold">
        Verifying Super Admin Authorization...
      </div>
    );
  }

  if (!isAuthorized) {
    return null;
  }

  return (
    <div className="w-full max-w-full flex h-screen bg-[#FDFBF9] text-[#111311] overflow-hidden">
      <SuperAdminSidebar
        currentUser={currentUser}
        isMobileOpen={isMobileOpen}
        onCloseMobile={() => setIsMobileOpen(false)}
      />
      <div className="flex-1 flex flex-col min-w-0 overflow-hidden w-full max-w-full">
        <SuperAdminHeader
          currentUser={currentUser}
          onMenuClick={() => setIsMobileOpen((prev) => !prev)}
        />
        <main className="flex-1 overflow-y-auto p-4 sm:p-6 w-full max-w-full">{children}</main>
      </div>
    </div>
  );
}
