'use client';
import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import type { User } from '@/backend/core/types';
import { Header } from '@/frontend/modules/shared/Header';
import { NotificationDeviceSettings } from '@/frontend/modules/notifications/NotificationDeviceSettings';
export default function NotificationSettingsPage() { const router = useRouter(); const [user, setUser] = useState<User | null>(null); useEffect(() => { fetch('/api/auth/me').then(async (r) => { const body = await r.json(); if (!r.ok || !body.user) return router.replace('/login'); setUser(body.user); }).catch(() => router.replace('/login')); }, [router]); return user ? <div className="min-h-screen bg-[#FDFBF9]"><Header currentUser={user} title="Notification Settings" showBranding /><main className="mx-auto max-w-3xl p-4 sm:p-6"><NotificationDeviceSettings /></main></div> : <div className="p-8 text-center text-sm text-slate-500">Verifying access…</div>; }
