'use client';

import React, { useState, useEffect } from 'react';
import { QALaboratoryWorkspace } from '@modules/dashboard/QALaboratoryWorkspace';
import { Header } from '@modules/shared/Header';
import { User } from '@core/types';

export default function QADepartmentPage() {
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    async function loadUser() {
      try {
        const res = await fetch('/api/auth/me');
        if (res.ok) {
          const data = await res.json();
          setUser(data.user);
        }
      } catch (err) {
        console.error('Failed to load user', err);
      } finally {
        setLoading(false);
      }
    }
    loadUser();
  }, []);

  if (loading) {
    return (
      <div className="p-8 text-center text-xs font-bold text-slate-500">
        Loading QA Laboratory...
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-[#FDFBF9] text-[#111311] flex flex-col font-sans w-full max-w-full overflow-x-hidden">
      <Header
        currentUser={user}
        title="QA Laboratory"
        showBranding={true}
      />
      <main className="flex-1 p-4 sm:p-6 overflow-y-auto w-full max-w-full">
        <QALaboratoryWorkspace currentUser={user} />
      </main>
    </div>
  );
}
