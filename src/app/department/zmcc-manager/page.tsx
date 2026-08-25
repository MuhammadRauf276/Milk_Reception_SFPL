'use client';

import React, { useState, useEffect } from 'react';
import { ZMCCManagerWorkspace } from '@modules/dashboard/ZMCCManagerWorkspace';
import { User } from '@core/types';

export default function ZMCCManagerPage() {
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
      <div className="min-h-screen bg-[#FDFBF9] flex items-center justify-center p-8 text-center text-xs font-bold text-slate-500">
        Loading ZMCC Manager Station...
      </div>
    );
  }

  return <ZMCCManagerWorkspace currentUser={user} />;
}
