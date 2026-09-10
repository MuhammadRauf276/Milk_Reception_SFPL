'use client';

import React, { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { ZmccMasterDataWorkspace } from '@/frontend/modules/zmcc/ZmccMasterDataWorkspace';
import { User } from '@core/types';

export default function SuperAdminZmccMasterDataPage() {
  const router = useRouter();
  const [currentUser, setCurrentUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    async function loadUser() {
      try {
        const res = await fetch('/api/auth/me');
        if (res.ok) {
          const data = await res.json();
          if (!data.user || data.user.role !== 'SUPER_ADMIN') {
            router.push('/login');
            return;
          }
          setCurrentUser(data.user);
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
      <div className="flex items-center justify-center h-screen bg-[#FDFBF9] text-[#111311] font-mono text-xs font-bold">
        Verifying Super Admin Authorization...
      </div>
    );
  }

  if (!currentUser) {
    return null;
  }

  return <ZmccMasterDataWorkspace currentUser={currentUser} />;
}
