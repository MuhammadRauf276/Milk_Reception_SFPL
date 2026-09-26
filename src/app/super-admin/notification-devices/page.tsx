'use client';
import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import type { User } from '@/backend/core/types';
import { Header } from '@/frontend/modules/shared/Header';
import { SuperAdminDeviceSubscriptions } from '@/frontend/modules/notifications/SuperAdminDeviceSubscriptions';
export default function NotificationDevicesPage() { const router = useRouter(); const [user, setUser] = useState<User | null>(null); useEffect(() => { fetch('/api/auth/me').then(async (r) => { const body = await r.json(); if (!r.ok || !body.user) return router.replace('/login'); if (body.user.role !== 'SUPER_ADMIN') return router.replace('/workspace-unavailable'); setUser(body.user); }).catch(() => router.replace('/login')); }, [router]); return user ? <div className="min-h-screen bg-[#FDFBF9]"><Header currentUser={user} title="Notification Devices" showBranding /><main className="mx-auto max-w-6xl p-4 sm:p-6"><SuperAdminDeviceSubscriptions /></main></div> : <div className="p-8 text-center text-sm text-slate-500">Verifying access…</div>; }
