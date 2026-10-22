'use client';
import { useEffect, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { fetchJson } from '@/lib/query/fetchJson';

type Subscription = { id: string; deviceLabel: string | null; active: boolean; createdAt: string; revokedAt: string | null };
type Preference = { pushEnabled: boolean; deliveryMode: 'IMMEDIATE' | 'DIGEST'; quietHoursStart: string | null; quietHoursEnd: string | null };
const DEFAULT_PREFERENCE: Preference = { pushEnabled: true, deliveryMode: 'IMMEDIATE', quietHoursStart: null, quietHoursEnd: null };
const NO_SUBS: Subscription[] = [];

export function NotificationDeviceSettings() {
  const queryClient = useQueryClient();
  const [message, setMessage] = useState('');
  const settingsQuery = useQuery({
    queryKey: ['notifications', 'settings'],
    queryFn: async ({ signal }) => {
      const [devices, settings] = await Promise.all([
        fetchJson<{ subscriptions?: Subscription[] }>('/api/notifications/subscriptions', { signal }),
        fetchJson<{ preference?: Preference }>('/api/notifications/preferences', { signal }),
      ]);
      return { subscriptions: devices.subscriptions || NO_SUBS, preference: settings.preference ?? null };
    },
  });
  const subscriptions = settingsQuery.data?.subscriptions ?? NO_SUBS;
  const [preference, setPreference] = useState<Preference>(DEFAULT_PREFERENCE);
  const serverPreference = settingsQuery.data?.preference;
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    if (serverPreference) setPreference(serverPreference);
  }, [serverPreference]);
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    if (settingsQuery.isError) setMessage('Unable to load notification settings.');
  }, [settingsQuery.isError]);

  const saveMutation = useMutation({
    mutationFn: () => fetchJson('/api/notifications/preferences', { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(preference) }),
    onSuccess: () => setMessage('Notification preferences saved.'),
    onError: () => setMessage('Unable to save notification preferences.'),
  });
  const revokeMutation = useMutation({
    mutationFn: (id: string) => fetchJson(`/api/notifications/subscriptions?id=${id}`, { method: 'DELETE' }),
    onSuccess: () => setMessage('Device subscription revoked.'),
    onError: () => setMessage('Unable to revoke this device.'),
    onSettled: () => queryClient.invalidateQueries({ queryKey: ['notifications', 'settings'] }),
  });
  const save = () => saveMutation.mutate();
  const revoke = (id: string) => revokeMutation.mutate(id);
  return <section className="space-y-4"><div><h2 className="text-lg font-semibold">Notification settings</h2></div><div className="grid gap-3 rounded-xl border bg-white p-4 sm:grid-cols-3"><label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={preference.pushEnabled} onChange={(event) => setPreference({ ...preference, pushEnabled: event.target.checked })} /> Enable browser push</label><label className="text-sm">Delivery<select value={preference.deliveryMode} onChange={(event) => setPreference({ ...preference, deliveryMode: event.target.value as Preference['deliveryMode'] })} className="ml-2 rounded border p-1"><option value="IMMEDIATE">Immediate</option><option value="DIGEST">Digest</option></select></label><label className="text-sm">Quiet from<input type="time" value={preference.quietHoursStart || ''} onChange={(event) => setPreference({ ...preference, quietHoursStart: event.target.value || null })} className="ml-2 rounded border p-1" /></label><label className="text-sm">Quiet until<input type="time" value={preference.quietHoursEnd || ''} onChange={(event) => setPreference({ ...preference, quietHoursEnd: event.target.value || null })} className="ml-2 rounded border p-1" /></label><button onClick={save} className="min-h-11 rounded bg-slate-900 px-4 py-2 text-xs font-semibold text-white">Save settings</button></div><div className="rounded-xl border bg-white p-4"><p className="font-semibold">Registered devices</p>{subscriptions.length ? subscriptions.map((item) => <div key={item.id} className="mt-2 flex items-center justify-between border-t pt-2 text-sm"><span>{item.deviceLabel || 'Unnamed browser'} · {item.active ? 'Active' : `Revoked ${new Date(item.revokedAt!).toLocaleDateString()}`}</span>{item.active && <button onClick={() => revoke(item.id)} className="min-h-11 px-2 text-xs font-semibold text-rose-700 underline">Revoke</button>}</div>) : <p className="mt-2 text-sm text-slate-500">No browser device is registered.</p>}</div>{message && <p className="text-sm text-slate-600">{message}</p>}</section>;
}
