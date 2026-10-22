'use client';

import React, { useState, useCallback, useMemo } from 'react';
import { useQueries, useQueryClient } from '@tanstack/react-query';
import { fetchJson } from '@/lib/query/fetchJson';
import {
  CheckCircle2,
  XCircle,
  Clock,
  Route as RouteIcon,
  Store,
  Milk,
  MapPin,
  AlertCircle,
  Loader2,
  ChevronLeft,
  ChevronRight,
  X,
} from 'lucide-react';
import { Modal } from '@/components/ui/modal';
import { User } from '@core/types';
import { getErrorMessage } from '@/lib/errors';
import { canApproveRoute, canApproveShop, canCreateRoute } from '@/frontend/modules/zmcc/stage1Capabilities';
import { DecisionStatusBadge } from '@/frontend/modules/shared/decision/DecisionStatusBadge';

export interface PendingRouteItem {
  id: string;
  route_code: string;
  name: string;
  origin: string;
  destination: string;
  zmcc_id: string;
  zmcc: { id: string; code: string; name: string };
  is_active: boolean;
  approval_status: string;
  rejection_reason: string | null;
  created_by: string;
  creator_name: string;
  created_at: string;
  areas: Array<{ id: string; name: string; area_code: string }>;
}

export interface PendingShopItem {
  id: string;
  shop_code: string;
  shop_name: string;
  owner_name: string;
  phone_number: string;
  cnic: string;
  area_id: string;
  route_id: string;
  zmcc_id: string;
  latitude: number | null;
  longitude: number | null;
  is_active: boolean;
  approval_status: string;
  rejection_reason: string | null;
  geotag_status: string;
  area_name: string;
  area_code: string;
  route_name: string;
  route_code: string;
  creator_name: string;
  created_at: string;
}

export interface PendingHcItem {
  id: string;
  local_supplier_code: string;
  name: string;
  phone: string | null;
  cnic: string | null;
  created_at: string;
  created_as_role: string | null;
  zmcc?: { id: string; code: string; name: string };
}

interface PendingApprovalsPanelProps {
  currentUser: User | null;
  showRoutes?: boolean;
  showShops?: boolean;
  showHcs?: boolean;
  onRefreshParent?: () => void;
}

export const PendingApprovalsPanel: React.FC<PendingApprovalsPanelProps> = ({
  currentUser,
  showRoutes = true,
  showShops = true,
  showHcs = true,
  onRefreshParent,
}) => {
  const role = currentUser?.role ?? '';

  // Zonal Manager and above approve routes; MDO and above approve shops (server decides again).
  const canApproveRoutes = canApproveRoute(role);
  const canApproveShops = canApproveShop(role);
  // An MDO can see their own routes waiting for the Zonal Manager, but cannot decide them.
  const canSeeRoutes = canCreateRoute(role);
  // New HCs (direct suppliers) need the Zonal Manager (or above), like routes.
  const canDecideHcs = canApproveRoute(role);

  const queryClient = useQueryClient();
  const [localError, setError] = useState<string | null>(null);
  const [actionSuccess, setActionSuccess] = useState<string | null>(null);

  const [routesPage, setRoutesPage] = useState(1);
  const [shopsPage, setShopsPage] = useState(1);
  const [hcsPage, setHcsPage] = useState(1);
  const PAGE_SIZE = 6;

  // Rejection modal state
  const [rejectingItem, setRejectingItem] = useState<{
    type: 'ROUTE' | 'SHOP' | 'HC';
    id: string;
    name: string;
  } | null>(null);
  const [rejectReason, setRejectReason] = useState('');
  const [submittingAction, setSubmittingAction] = useState(false);

  const [routesQ, shopsQ, hcsQ] = useQueries({
    queries: [
      {
        queryKey: ['zmcc', 'approvals', 'routes'],
        enabled: showRoutes && canSeeRoutes,
        queryFn: ({ signal }) => fetchJson<{ routes?: PendingRouteItem[] }>('/api/zmcc/routes/pending', { signal }),
      },
      {
        queryKey: ['zmcc', 'approvals', 'shops'],
        enabled: showShops && canApproveShops,
        queryFn: ({ signal }) =>
          fetchJson<{ shops?: PendingShopItem[]; requests?: PendingShopItem[] }>('/api/zmcc/shops/requests', { signal }),
      },
      {
        queryKey: ['zmcc', 'approvals', 'hcs'],
        enabled: showHcs && canDecideHcs,
        queryFn: ({ signal }) =>
          fetchJson<{ suppliers?: PendingHcItem[] }>('/api/zmcc/hc-suppliers/pending', { signal }),
      },
    ],
  });
  const routes = useMemo(() => routesQ.data?.routes ?? [], [routesQ.data]);
  const shops = useMemo(() => shopsQ.data?.shops ?? shopsQ.data?.requests ?? [], [shopsQ.data]);
  const hcs = useMemo(() => hcsQ.data?.suppliers ?? [], [hcsQ.data]);
  const loading = routesQ.isLoading || shopsQ.isLoading || hcsQ.isLoading;
  const queryErr = routesQ.error || shopsQ.error || hcsQ.error;
  const error = localError ?? (queryErr ? getErrorMessage(queryErr) || 'Failed to load pending requests.' : null);
  const loadData = useCallback(async () => {
    setError(null);
    await queryClient.invalidateQueries({ queryKey: ['zmcc', 'approvals'] });
  }, [queryClient]);

  const typeLabel = (type: 'ROUTE' | 'SHOP' | 'HC') => (type === 'ROUTE' ? 'Route' : type === 'SHOP' ? 'Shop' : 'HC');
  const typeUrl = (type: 'ROUTE' | 'SHOP' | 'HC') =>
    type === 'ROUTE' ? '/api/zmcc/routes' : type === 'SHOP' ? '/api/zmcc/shops' : '/api/zmcc/hc-suppliers';

  const handleApprove = async (type: 'ROUTE' | 'SHOP' | 'HC', id: string) => {
    setSubmittingAction(true);
    setActionSuccess(null);
    setError(null);
    try {
      const url = `${typeUrl(type)}/${id}/approve`;
      const res = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
      });
      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.error || `Failed to approve ${type.toLowerCase()}.`);
      }
      setActionSuccess(`${typeLabel(type)} approved.`);
      await loadData();
      if (onRefreshParent) onRefreshParent();
    } catch (err) {
      setError(getErrorMessage(err) || 'Approval failed.');
    } finally {
      setSubmittingAction(false);
    }
  };

  const handleRejectConfirm = async () => {
    if (!rejectingItem) return;
    if (!rejectReason.trim()) {
      setError('Rejection reason is required.');
      return;
    }
    setSubmittingAction(true);
    setActionSuccess(null);
    setError(null);
    try {
      const url = `${typeUrl(rejectingItem.type)}/${rejectingItem.id}/reject`;
      const res = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ reason: rejectReason.trim() }),
      });
      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.error || 'Failed to reject request.');
      }
      setActionSuccess(`${typeLabel(rejectingItem.type)} request rejected.`);
      setRejectingItem(null);
      setRejectReason('');
      await loadData();
      if (onRefreshParent) onRefreshParent();
    } catch (err) {
      setError(getErrorMessage(err) || 'Rejection failed.');
    } finally {
      setSubmittingAction(false);
    }
  };

  const paginatedRoutes = useMemo(() => {
    const start = (routesPage - 1) * PAGE_SIZE;
    return routes.slice(start, start + PAGE_SIZE);
  }, [routes, routesPage]);

  const totalRoutePages = Math.max(1, Math.ceil(routes.length / PAGE_SIZE));

  const paginatedShops = useMemo(() => {
    const start = (shopsPage - 1) * PAGE_SIZE;
    return shops.slice(start, start + PAGE_SIZE);
  }, [shops, shopsPage]);

  const totalShopPages = Math.max(1, Math.ceil(shops.length / PAGE_SIZE));

  const paginatedHcs = useMemo(() => {
    const start = (hcsPage - 1) * PAGE_SIZE;
    return hcs.slice(start, start + PAGE_SIZE);
  }, [hcs, hcsPage]);

  const totalHcPages = Math.max(1, Math.ceil(hcs.length / PAGE_SIZE));

  if (!canSeeRoutes && !canApproveShops && !canDecideHcs) {
    return null;
  }

  return (
    <div className="space-y-6">
      {actionSuccess && (
        <div className="p-3 bg-emerald-50 border border-emerald-200 text-emerald-800 text-xs font-semibold rounded-xl flex items-center justify-between">
          <div className="flex items-center space-x-2">
            <CheckCircle2 className="w-4 h-4 text-emerald-600 shrink-0" />
            <span>{actionSuccess}</span>
          </div>
          <button
            type="button"
            onClick={() => setActionSuccess(null)}
            aria-label="Dismiss"
            className="ml-2 text-emerald-700 hover:text-emerald-900"
          >
            <X className="h-4 w-4" />
          </button>
        </div>
      )}

      {error && (
        <div className="p-3 bg-rose-50 border border-rose-200 text-rose-800 text-xs font-semibold rounded-xl flex items-center justify-between">
          <div className="flex items-center space-x-2">
            <AlertCircle className="w-4 h-4 text-rose-600 shrink-0" />
            <span>{error}</span>
          </div>
          <button
            type="button"
            onClick={() => setError(null)}
            aria-label="Dismiss"
            className="ml-2 text-rose-700 hover:text-rose-900"
          >
            <X className="h-4 w-4" />
          </button>
        </div>
      )}

      {showRoutes && canSeeRoutes && (
        <div className="bg-card border border-border rounded-xl shadow-2xs overflow-hidden">
          <div className="p-4 border-b border-border flex items-center justify-between bg-muted/30">
            <div className="flex items-center space-x-2">
              <RouteIcon className="w-4 h-4 text-primary shrink-0" />
              <h3 className="text-sm font-semibold text-foreground">Routes waiting for approval</h3>
              <span className="px-2 py-0.5 rounded-full text-[10px] font-bold bg-amber-100 text-amber-800 border border-amber-200">
                {routes.length} waiting
              </span>
            </div>
            {loading && <Loader2 className="w-4 h-4 animate-spin text-slate-400" />}
          </div>

          {routes.length === 0 && !loading ? (
            <div className="p-6 text-center text-xs font-medium text-slate-500">
              No routes are waiting.
            </div>
          ) : (
            <div className="divide-y divide-border">
              {paginatedRoutes.map((r) => (
                <div
                  key={r.id}
                  className="p-4 flex flex-col md:flex-row md:items-center justify-between gap-3 hover:bg-muted/20 transition-colors"
                >
                  <div className="space-y-1">
                    <div className="flex items-center space-x-2">
                      <span className="text-xs font-bold text-foreground">{r.name}</span>
                      <span className="px-1.5 py-0.5 rounded text-[10px] font-mono bg-subtle border border-border text-slate-700">
                        {r.route_code}
                      </span>
                      <DecisionStatusBadge
                        status={canApproveRoutes ? 'EXCEPTION' : 'PENDING'}
                        label={canApproveRoutes ? 'Needs your decision' : 'Waiting for Zonal Manager'}
                      />
                    </div>
                    <div className="text-xs text-slate-600 flex flex-wrap items-center gap-x-3 gap-y-1">
                      <span>Origin: <strong className="text-foreground">{r.origin}</strong></span>
                      <span>Destination: <strong className="text-foreground">{r.destination}</strong></span>
                      {r.areas.length > 0 && (
                        <span>
                          Initial Area:{' '}
                          <strong className="text-foreground">{r.areas[0].name}</strong>
                        </span>
                      )}
                    </div>
                    <div className="text-[11px] text-slate-400 flex items-center space-x-2">
                      <span>Requested by {r.creator_name}</span>
                      <span>·</span>
                      <span>{new Date(r.created_at).toLocaleDateString()}</span>
                    </div>
                  </div>

                  {canApproveRoutes && (
                  <div className="flex items-center space-x-2 shrink-0">
                    <button
                      type="button"
                      disabled={submittingAction}
                      onClick={() => handleApprove('ROUTE', r.id)}
                      className="px-4 min-h-[44px] rounded-lg text-sm font-semibold bg-emerald-600 hover:bg-emerald-700 text-white transition-colors disabled:opacity-50 inline-flex items-center space-x-1"
                    >
                      <CheckCircle2 className="w-3.5 h-3.5" />
                      <span>Approve route</span>
                    </button>
                    <button
                      type="button"
                      disabled={submittingAction}
                      onClick={() =>
                        setRejectingItem({ type: 'ROUTE', id: r.id, name: r.name })
                      }
                      className="px-4 min-h-[44px] rounded-lg text-sm font-semibold bg-rose-600 hover:bg-rose-700 text-white transition-colors disabled:opacity-50 inline-flex items-center space-x-1"
                    >
                      <XCircle className="w-3.5 h-3.5" />
                      <span>Reject route</span>
                    </button>
                  </div>
                  )}
                </div>
              ))}
            </div>
          )}

          {totalRoutePages > 1 && (
            <div className="p-3 border-t border-border flex items-center justify-between text-xs text-slate-600 bg-muted/10">
              <span>
                Page {routesPage} of {totalRoutePages}
              </span>
              <div className="flex items-center space-x-1">
                <button
                  type="button"
                  disabled={routesPage <= 1}
                  onClick={() => setRoutesPage((p) => p - 1)}
                  className="p-1 rounded border border-border disabled:opacity-30 hover:bg-muted"
                >
                  <ChevronLeft className="w-4 h-4" />
                </button>
                <button
                  type="button"
                  disabled={routesPage >= totalRoutePages}
                  onClick={() => setRoutesPage((p) => p + 1)}
                  className="p-1 rounded border border-border disabled:opacity-30 hover:bg-muted"
                >
                  <ChevronRight className="w-4 h-4" />
                </button>
              </div>
            </div>
          )}
        </div>
      )}

      {showShops && canApproveShops && (
        <div className="bg-card border border-border rounded-xl shadow-2xs overflow-hidden">
          <div className="p-4 border-b border-border flex items-center justify-between bg-muted/30">
            <div className="flex items-center space-x-2">
              <Store className="w-4 h-4 text-primary shrink-0" />
              <h3 className="text-sm font-semibold text-foreground">New shop requests</h3>
              <span className="px-2 py-0.5 rounded-full text-[10px] font-bold bg-amber-100 text-amber-800 border border-amber-200">
                {shops.length} waiting
              </span>
            </div>
            {loading && <Loader2 className="w-4 h-4 animate-spin text-slate-400" />}
          </div>

          {shops.length === 0 && !loading ? (
            <div className="p-6 text-center text-xs font-medium text-slate-500">
              No new shop requests are waiting.
            </div>
          ) : (
            <div className="divide-y divide-border">
              {paginatedShops.map((s) => (
                <div
                  key={s.id}
                  className="p-4 flex flex-col md:flex-row md:items-center justify-between gap-3 hover:bg-muted/20 transition-colors"
                >
                  <div className="space-y-1">
                    <div className="flex items-center space-x-2">
                      <span className="text-xs font-bold text-foreground">{s.shop_name}</span>
                      <span className="px-1.5 py-0.5 rounded text-[10px] font-mono bg-subtle border border-border text-slate-700">
                        {s.shop_code}
                      </span>
                      {s.geotag_status === 'VERIFIED' ? (
                        <span className="px-2 py-0.5 rounded-full text-[10px] font-semibold bg-emerald-50 text-emerald-700 border border-emerald-200 inline-flex items-center space-x-1">
                          <MapPin className="w-3 h-3 text-emerald-600" />
                          <span>Geotagged</span>
                        </span>
                      ) : (
                        <span className="px-2 py-0.5 rounded-full text-[10px] font-semibold bg-amber-50 text-amber-700 border border-amber-200 inline-flex items-center space-x-1">
                          <Clock className="w-3 h-3 text-amber-600" />
                          <span>Pending First Visit</span>
                        </span>
                      )}
                    </div>
                    <div className="text-xs text-slate-600 flex flex-wrap items-center gap-x-3 gap-y-1">
                      <span>Owner: <strong className="text-foreground">{s.owner_name}</strong></span>
                      <span>Phone: <strong className="text-foreground">{s.phone_number}</strong></span>
                      <span>CNIC: <strong className="text-foreground font-mono">{s.cnic}</strong></span>
                      <span>Route: <strong className="text-foreground">{s.route_name}</strong></span>
                      <span>Area: <strong className="text-foreground">{s.area_name}</strong></span>
                    </div>
                    <div className="text-[11px] text-slate-400 flex items-center space-x-2">
                      <span>Requested by {s.creator_name}</span>
                      <span>·</span>
                      <span>{new Date(s.created_at).toLocaleDateString()}</span>
                    </div>
                  </div>

                  <div className="flex items-center space-x-2 shrink-0">
                    <button
                      type="button"
                      disabled={submittingAction}
                      onClick={() => handleApprove('SHOP', s.id)}
                      className="px-4 min-h-[44px] rounded-lg text-sm font-semibold bg-emerald-600 hover:bg-emerald-700 text-white transition-colors disabled:opacity-50 inline-flex items-center space-x-1"
                    >
                      <CheckCircle2 className="w-3.5 h-3.5" />
                      <span>Approve shop</span>
                    </button>
                    <button
                      type="button"
                      disabled={submittingAction}
                      onClick={() =>
                        setRejectingItem({ type: 'SHOP', id: s.id, name: s.shop_name })
                      }
                      className="px-4 min-h-[44px] rounded-lg text-sm font-semibold bg-rose-600 hover:bg-rose-700 text-white transition-colors disabled:opacity-50 inline-flex items-center space-x-1"
                    >
                      <XCircle className="w-3.5 h-3.5" />
                      <span>Reject shop</span>
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}

          {totalShopPages > 1 && (
            <div className="p-3 border-t border-border flex items-center justify-between text-xs text-slate-600 bg-muted/10">
              <span>
                Page {shopsPage} of {totalShopPages}
              </span>
              <div className="flex items-center space-x-1">
                <button
                  type="button"
                  disabled={shopsPage <= 1}
                  onClick={() => setShopsPage((p) => p - 1)}
                  className="p-1 rounded border border-border disabled:opacity-30 hover:bg-muted"
                >
                  <ChevronLeft className="w-4 h-4" />
                </button>
                <button
                  type="button"
                  disabled={shopsPage >= totalShopPages}
                  onClick={() => setShopsPage((p) => p + 1)}
                  className="p-1 rounded border border-border disabled:opacity-30 hover:bg-muted"
                >
                  <ChevronRight className="w-4 h-4" />
                </button>
              </div>
            </div>
          )}
        </div>
      )}

      {showHcs && canDecideHcs && (
        <div className="bg-card border border-border rounded-xl shadow-2xs overflow-hidden">
          <div className="p-4 border-b border-border flex items-center justify-between bg-muted/30">
            <div className="flex items-center space-x-2">
              <Milk className="w-4 h-4 text-primary shrink-0" />
              <h3 className="text-sm font-semibold text-foreground">New HCs waiting for approval</h3>
              <span className="px-2 py-0.5 rounded-full text-[10px] font-bold bg-amber-100 text-amber-800 border border-amber-200">
                {hcs.length} waiting
              </span>
            </div>
            {loading && <Loader2 className="w-4 h-4 animate-spin text-slate-400" />}
          </div>

          {hcs.length === 0 && !loading ? (
            <div className="p-6 text-center text-xs font-medium text-slate-500">No new HCs are waiting.</div>
          ) : (
            <div className="divide-y divide-border">
              {paginatedHcs.map((h) => (
                <div
                  key={h.id}
                  className="p-4 flex flex-col md:flex-row md:items-center justify-between gap-3 hover:bg-muted/20 transition-colors"
                >
                  <div className="space-y-1">
                    <div className="flex items-center space-x-2">
                      <span className="text-xs font-bold text-foreground">{h.name}</span>
                      <span className="px-1.5 py-0.5 rounded text-[10px] font-mono bg-subtle border border-border text-slate-700">
                        {h.local_supplier_code}
                      </span>
                      <DecisionStatusBadge status="EXCEPTION" label="Needs your decision" />
                    </div>
                    <div className="text-xs text-slate-600 flex flex-wrap items-center gap-x-3 gap-y-1">
                      <span>Phone: <strong className="text-foreground">{h.phone ?? '-'}</strong></span>
                      <span>CNIC: <strong className="text-foreground font-mono">{h.cnic ?? '-'}</strong></span>
                      {h.zmcc && <span>ZMCC: <strong className="text-foreground">{h.zmcc.name}</strong></span>}
                    </div>
                    <div className="text-[11px] text-slate-400">
                      Added {new Date(h.created_at).toLocaleDateString()}
                    </div>
                  </div>

                  <div className="flex items-center space-x-2 shrink-0">
                    <button
                      type="button"
                      disabled={submittingAction}
                      onClick={() => handleApprove('HC', h.id)}
                      className="px-4 min-h-[44px] rounded-lg text-sm font-semibold bg-emerald-600 hover:bg-emerald-700 text-white transition-colors disabled:opacity-50 inline-flex items-center space-x-1"
                    >
                      <CheckCircle2 className="w-3.5 h-3.5" />
                      <span>Approve HC</span>
                    </button>
                    <button
                      type="button"
                      disabled={submittingAction}
                      onClick={() => setRejectingItem({ type: 'HC', id: h.id, name: h.name })}
                      className="px-4 min-h-[44px] rounded-lg text-sm font-semibold bg-rose-600 hover:bg-rose-700 text-white transition-colors disabled:opacity-50 inline-flex items-center space-x-1"
                    >
                      <XCircle className="w-3.5 h-3.5" />
                      <span>Reject HC</span>
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}

          {totalHcPages > 1 && (
            <div className="p-3 border-t border-border flex items-center justify-between text-xs text-slate-600 bg-muted/10">
              <span>
                Page {hcsPage} of {totalHcPages}
              </span>
              <div className="flex items-center space-x-1">
                <button
                  type="button"
                  disabled={hcsPage <= 1}
                  onClick={() => setHcsPage((p) => p - 1)}
                  className="p-1 rounded border border-border disabled:opacity-30 hover:bg-muted"
                >
                  <ChevronLeft className="w-4 h-4" />
                </button>
                <button
                  type="button"
                  disabled={hcsPage >= totalHcPages}
                  onClick={() => setHcsPage((p) => p + 1)}
                  className="p-1 rounded border border-border disabled:opacity-30 hover:bg-muted"
                >
                  <ChevronRight className="w-4 h-4" />
                </button>
              </div>
            </div>
          )}
        </div>
      )}

      {rejectingItem && (
        <Modal
          onClose={() => {
            setRejectingItem(null);
            setRejectReason('');
          }}
          title={`Reject ${typeLabel(rejectingItem.type)} Request`}
        >
          <div className="space-y-4">
            <div className="text-xs font-medium text-foreground">
              Rejecting request for <strong>{rejectingItem.name}</strong>. Please provide a reason.
            </div>
            <div>
              <label className="block text-xs font-semibold text-foreground mb-1">
                Rejection Reason <span className="text-rose-600">*</span>
              </label>
              <textarea
                value={rejectReason}
                onChange={(e) => setRejectReason(e.target.value)}
                placeholder="Enter rejection reason…"
                className="w-full text-xs font-medium border border-border rounded-xl p-2.5 bg-subtle text-foreground focus:ring-2 focus:ring-primary min-h-[90px]"
                required
              />
            </div>
            <div className="flex items-center justify-end space-x-2 pt-2">
              <button
                type="button"
                disabled={submittingAction}
                onClick={() => {
                  setRejectingItem(null);
                  setRejectReason('');
                }}
                className="px-3.5 py-1.5 rounded-xl text-xs font-semibold border border-border bg-card text-foreground hover:bg-muted"
              >
                Cancel
              </button>
              <button
                type="button"
                disabled={submittingAction || !rejectReason.trim()}
                onClick={handleRejectConfirm}
                className="px-3.5 py-1.5 rounded-xl text-xs font-semibold bg-rose-600 hover:bg-rose-700 text-white disabled:opacity-50 inline-flex items-center space-x-1"
              >
                {submittingAction && <Loader2 className="w-3.5 h-3.5 animate-spin" />}
                <span>Confirm Rejection</span>
              </button>
            </div>
          </div>
        </Modal>
      )}
    </div>
  );
};
