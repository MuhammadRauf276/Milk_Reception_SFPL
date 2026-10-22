'use client';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { fetchJson } from '@/lib/query/fetchJson';
type Device = { id: string; user: string; role: string; deviceLabel: string | null; active: boolean; createdAt: string; revokedAt: string | null };
const NO_ITEMS: Device[] = [];
export function SuperAdminDeviceSubscriptions() {
  const queryClient = useQueryClient();
  const query = useQuery({
    queryKey: ['notifications', 'admin-devices'],
    queryFn: ({ signal }) => fetchJson<{ subscriptions?: Device[] }>('/api/super-admin/push-subscriptions', { signal }),
  });
  const revokeMutation = useMutation({
    mutationFn: (id: string) => fetchJson(`/api/super-admin/push-subscriptions?id=${id}`, { method: 'DELETE' }),
    onSettled: () => queryClient.invalidateQueries({ queryKey: ['notifications', 'admin-devices'] }),
  });
  const items = query.data?.subscriptions ?? NO_ITEMS;
  const error = revokeMutation.isError ? 'Unable to revoke device.' : query.isError ? query.error.message || 'Unable to load devices.' : '';
  const revoke = (id: string) => revokeMutation.mutate(id);
  return <section className="rounded-xl border bg-white p-4"><h1 className="text-xl font-semibold">Notification devices</h1>{error && <p className="mt-3 text-sm text-rose-700">{error}</p>}<div className="mt-4 overflow-x-auto"><table className="w-full text-left text-sm"><thead className="text-slate-500"><tr><th className="pb-2">User</th><th className="pb-2">Role</th><th className="pb-2">Device</th><th className="pb-2">State</th><th /></tr></thead><tbody>{items.map((item) => <tr key={item.id} className="border-t"><td className="py-2">{item.user}</td><td className="py-2">{item.role}</td><td className="py-2">{item.deviceLabel || 'Unnamed browser'}</td><td className="py-2">{item.active ? 'Active' : 'Revoked'}</td><td className="py-2">{item.active && <button onClick={() => revoke(item.id)} className="min-h-11 px-2 text-xs font-semibold text-rose-700 underline">Revoke</button>}</td></tr>)}</tbody></table></div></section>;
}
