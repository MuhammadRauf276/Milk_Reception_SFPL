'use client';

import React, { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { MotOperationsWorkspace } from '@/frontend/modules/mot/MotOperationsWorkspace';
import { User } from '@core/types';

export default function SuperAdminMotOperationsPage() {
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

  return (
    <div className="min-h-screen bg-[#FDFBF9] p-4 sm:p-6">
      <MotOperationsWorkspace currentUser={currentUser} />
    </div>
  );
}
