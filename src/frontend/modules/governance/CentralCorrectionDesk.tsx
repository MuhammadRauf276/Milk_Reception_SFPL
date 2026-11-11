'use client';

import React, { useState, useCallback, useMemo, useEffect } from 'react';
import { useSearchParams, useRouter } from 'next/navigation';
import { keepPreviousData, useQuery, useQueryClient } from '@tanstack/react-query';
import { fetchJson } from '@/lib/query/fetchJson';
import {
  ShieldCheck,
  Clock,
  CheckCircle2,
  AlertTriangle,
  Search,
  Filter,
  FileCheck2,
  Loader2,
  Info,
  ChevronRight,
  Lock,
} from 'lucide-react';
import { getErrorMessage } from '@/lib/errors';
import { SerializedCorrectionRequest } from '@/backend/services/correctionGovernanceService';
import { useCurrentUser } from '@/frontend/hooks/useCurrentUser';
import { Drawer, DrawerContent, DrawerTitle } from '@/components/ui/drawer';
import { Button } from '@/components/ui/button';
import { RecordEditor } from './RecordEditor';
import { InfoTip } from '@/components/ui/info-tip';
import { formatDate, formatDateTime } from '@/lib/format';

export const CentralCorrectionDesk: React.FC = () => {
  const router = useRouter();
  const searchParams = useSearchParams();
  const queryClient = useQueryClient();
  const { currentUser } = useCurrentUser();

  // Tab synchronization via URL (?tab=requests | direct_edit | audit)
  const tabParam = searchParams?.get('tab');
  const activeTab = useMemo<'REQUESTS' | 'DIRECT_EDIT' | 'AUDIT'>(() => {
    if (tabParam === 'direct_edit' || tabParam === 'SEARCH_OVERRIDE') return 'DIRECT_EDIT';
    if (tabParam === 'audit' || tabParam === 'AUDIT_LEDGER') return 'AUDIT';
    return 'REQUESTS';
  }, [tabParam]);

  const setTab = useCallback(
    (tab: 'REQUESTS' | 'DIRECT_EDIT' | 'AUDIT') => {
      const p = new URLSearchParams(searchParams?.toString() || '');
      if (tab === 'REQUESTS') p.set('tab', 'requests');
      else if (tab === 'DIRECT_EDIT') p.set('tab', 'direct_edit');
      else p.set('tab', 'audit');
      router.push(`?${p.toString()}`);
    },
    [router, searchParams]
  );

  // Filters for Tab 1 (Correction Requests Queue)
  const [statusFilter, setStatusFilter] = useState<string>('REQUESTED');
  const [moduleFilter, setModuleFilter] = useState<string>('ALL');
  const [reqSearchQuery, setReqSearchQuery] = useState<string>('');

  // Selected request for the Review Drawer
  const [selectedRequest, setSelectedRequest] = useState<SerializedCorrectionRequest | null>(null);
  const [isReviewDrawerOpen, setIsReviewDrawerOpen] = useState(false);
  const [rejectionModalId, setRejectionModalId] = useState<string | null>(null);
  const [rejectionReason, setRejectionReason] = useState<string>('');
  const [processingId, setProcessingId] = useState<string | null>(null);

  // Notifications
  const [actionSuccessMsg, setActionSuccessMsg] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);

  // Query Tab 1: Requests
  const requestsQuery = useQuery({
    queryKey: ['corrections', { statusFilter, moduleFilter }],
    queryFn: ({ signal }) => {
      const params = new URLSearchParams();
      if (statusFilter !== 'ALL') params.set('status', statusFilter);
      if (moduleFilter !== 'ALL') params.set('module', moduleFilter);
      return fetchJson<{ items?: SerializedCorrectionRequest[] }>(`/api/corrections?${params.toString()}`, { signal });
    },
    placeholderData: keepPreviousData,
  });
  const requests = useMemo(() => requestsQuery.data?.items ?? [], [requestsQuery.data]);

  // Refresh
  const handleRefresh = useCallback(() => {
    queryClient.invalidateQueries({ queryKey: ['corrections'] });
  }, [queryClient]);

  // Tab 1: Handle 1-Click Apply
  const handleApplyRequest = async (id: string) => {
    setProcessingId(id);
    setActionError(null);
    try {
      await fetchJson(`/api/corrections/${id}/apply`, { method: 'POST' });
      setActionSuccessMsg(`Ticket #${id} done. The record now shows the corrected values.`);
      setIsReviewDrawerOpen(false);
      setSelectedRequest(null);
      handleRefresh();
      setTimeout(() => setActionSuccessMsg(null), 5000);
    } catch (err) {
      setActionError(getErrorMessage(err));
    } finally {
      setProcessingId(null);
    }
  };

  // Tab 1: Handle Reject Request
  const handleRejectRequest = async (id: string) => {
    if (rejectionReason.trim().length < 3) {
      setActionError('Please provide a substantive rejection reason of at least 3 characters.');
      return;
    }
    setProcessingId(id);
    setActionError(null);
    try {
      await fetchJson(`/api/corrections/${id}/reject`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ reason: rejectionReason.trim() }),
      });
      setActionSuccessMsg(`Correction request #${id} was rejected.`);
      setRejectionModalId(null);
      setIsReviewDrawerOpen(false);
      setSelectedRequest(null);
      setRejectionReason('');
      handleRefresh();
      setTimeout(() => setActionSuccessMsg(null), 5000);
    } catch (err) {
      setActionError(getErrorMessage(err));
    } finally {
      setProcessingId(null);
    }
  };

  // Filter Tab 1 requests
  const filteredRequests = useMemo(() => {
    return requests.filter((r) => {
      if (reqSearchQuery.trim()) {
        const q = reqSearchQuery.toLowerCase();
        const corr = r.correlationId.toLowerCase();
        const mod = r.module.toLowerCase();
        const rec = r.recordId.toLowerCase();
        const reqBy = r.requestedBy.name.toLowerCase();
        const reas = r.reason.toLowerCase();
        if (!corr.includes(q) && !mod.includes(q) && !rec.includes(q) && !reqBy.includes(q) && !reas.includes(q)) {
          return false;
        }
      }
      return true;
    });
  }, [requests, reqSearchQuery]);

  const counts = useMemo(() => {
    const pending = requests.filter((r) => r.status === 'REQUESTED').length;
    const applied = requests.filter((r) => r.status === 'APPLIED').length;
    const highImpact = requests.filter((r) => r.impact === 'HIGH').length;
    return { pending, applied, highImpact };
  }, [requests]);

  const userRole = currentUser?.role || 'DATA_EXECUTIVE';
  const isSuperAdmin = userRole === 'SUPER_ADMIN';

  return (
    <div className="space-y-6">
      {/* 1. Header & Authority Banner */}
      <div className="p-5 rounded-2xl bg-card border border-border/80 shadow-xs space-y-4">
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 pb-4 border-b border-border/80">
          <div className="flex items-center space-x-3.5">
            <div className="p-3 rounded-2xl bg-primary/10 text-primary">
              <ShieldCheck className="w-7 h-7" />
            </div>
            <div>
              <div className="flex items-center space-x-2">
                <h1 className="text-lg font-semibold text-foreground tracking-tight">
                  Corrections
                </h1>
              </div>
            </div>
          </div>

          <div className="flex items-center gap-2">
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={handleRefresh}
              disabled={requestsQuery.isPending}
              className="min-h-11 px-3 text-xs font-semibold gap-2"
            >
              <Loader2 className={`w-3.5 h-3.5 ${requestsQuery.isPending ? 'animate-spin' : ''}`} />
              <span>Refresh</span>
            </Button>
          </div>
        </div>

        {/* 3 Metric Summary Cards */}
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
          <div className="bg-card border-border p-4 rounded-2xl border flex items-center justify-between">
            <div>
              <p className="text-xs font-semibold text-muted-foreground">Pending</p>
              <p className="text-2xl font-semibold text-foreground tabular-nums">{counts.pending}</p>
            </div>
            <div className="p-3 rounded-xl bg-amber-100/80 text-amber-700">
              <Clock className="w-5 h-5" />
            </div>
          </div>

          <div className="bg-card border-border p-4 rounded-2xl border flex items-center justify-between">
            <div>
              <p className="text-xs font-semibold text-muted-foreground">Applied</p>
              <p className="text-2xl font-semibold text-foreground tabular-nums">{counts.applied}</p>
            </div>
            <div className="p-3 rounded-xl bg-emerald-100/80 text-emerald-700">
              <CheckCircle2 className="w-5 h-5" />
            </div>
          </div>

          <div className="bg-card border-border p-4 rounded-2xl border flex items-center justify-between">
            <div>
              <p className="text-xs font-semibold text-muted-foreground">High impact</p>
              <p className="text-2xl font-semibold text-foreground tabular-nums">{counts.highImpact}</p>
            </div>
            <div className="p-3 rounded-xl bg-rose-100/80 text-rose-700">
              <AlertTriangle className="w-5 h-5" />
            </div>
          </div>
        </div>
      </div>


      {/* Action Success / Error Feedback */}
      {actionSuccessMsg && (
        <div className="bg-card border-border p-4 border rounded-2xl text-emerald-800 text-xs font-semibold flex items-center space-x-2 animate-in fade-in">
          <CheckCircle2 className="w-4 h-4 text-emerald-600 shrink-0" />
          <span>{actionSuccessMsg}</span>
        </div>
      )}

      {actionError && (
        <div className="bg-card border-border p-4 border rounded-2xl text-rose-800 text-xs font-semibold flex items-center space-x-2 animate-in fade-in">
          <AlertTriangle className="w-4 h-4 text-rose-600 shrink-0" />
          <span>{actionError}</span>
        </div>
      )}

      {/* TAB 1: CORRECTION REQUESTS QUEUE */}
      {activeTab === 'REQUESTS' && (
        <div className="space-y-4">
          {/* Filter Bar */}
          <div className="bg-card border-border flex flex-col sm:flex-row items-stretch sm:items-center justify-between gap-3 p-3 border rounded-xl text-xs">
            <div className="flex items-center space-x-2 flex-1">
              <Search className="w-4 h-4 text-muted-foreground shrink-0" />
              <input
                type="text"
                placeholder="Search"
                value={reqSearchQuery}
                onChange={(e) => setReqSearchQuery(e.target.value)}
                className="w-full bg-transparent font-medium text-foreground focus:outline-hidden min-h-11"
              />
            </div>

            <div className="flex flex-wrap items-center gap-2 shrink-0">
              <div className="flex items-center space-x-1.5">
                <span className="font-semibold text-secondary-foreground">Status:</span>
                <select
                  value={statusFilter}
                  onChange={(e) => setStatusFilter(e.target.value)}
                  className="px-2 rounded-lg border border-border-strong bg-card font-medium text-foreground focus:outline-hidden min-h-11"
                >
                  <option value="REQUESTED">Open</option>
                  <option value="APPROVED">Approved</option>
                  <option value="REJECTED">Rejected</option>
                  <option value="APPLIED">Done</option>
                  <option value="ALL">All Statuses</option>
                </select>
              </div>

              <div className="flex items-center space-x-1.5">
                <Filter className="w-3.5 h-3.5 text-muted-foreground" />
                <span className="font-semibold text-secondary-foreground">Module:</span>
                <select
                  value={moduleFilter}
                  onChange={(e) => setModuleFilter(e.target.value)}
                  className="px-2 rounded-lg border border-border-strong bg-card font-medium text-foreground focus:outline-hidden min-h-11"
                >
                  <option value="ALL">All Modules</option>
                  <option value="MOT_SHOP_COLLECTION">Stage 1: Shop Collections</option>
                  <option value="ZMCC_LAB_SESSION">Stage 2: ZMCC Lab Sessions</option>
                  <option value="VEHICLE_VISIT">Stage 3 & 4: Vehicle Visits</option>
                  <option value="ZMCC_MC_ARRIVAL">Mobile Tester arrivals</option>
                  <option value="ZMCC_HC_ARRIVAL">HC arrivals</option>
                  <option value="ZMCC_WEIGHING">Weighing</option>
                  <option value="PLANT_QA_MEASUREMENT">Plant QA</option>
                  <option value="ZMCC_EXIT">Exit records</option>
                </select>
              </div>
            </div>
          </div>

          {/* Requests List */}
          {requestsQuery.isPending ? (
            <div className="p-12 text-center text-xs text-muted-foreground font-semibold tabular-nums">
              Loading correction requests…
            </div>
          ) : filteredRequests.length === 0 ? (
            <div className="bg-card border-border p-12 text-center border rounded-2xl space-y-2">
              <FileCheck2 className="w-10 h-10 text-neutral-300 mx-auto" />
              <h3 className="font-semibold text-foreground text-sm">No Correction Requests Found</h3>
              <p className="text-muted-foreground text-xs">
                {statusFilter === 'REQUESTED'
                  ? 'Nothing pending.'
                  : 'No tickets match your active search filters.'}
              </p>
            </div>
          ) : (
            <div className="grid grid-cols-1 gap-3">
              {filteredRequests.map((req) => {
                const isPending = req.status === 'REQUESTED';
                const isApproved = req.status === 'APPROVED';
                const isApplied = req.status === 'APPLIED';

                return (
                  <div
                    key={req.id}
                    className="bg-card border border-border rounded-2xl shadow-xs p-4 space-y-3 hover:border-primary/40 transition-[color,background-color,border-color,box-shadow,opacity,transform] text-xs"
                  >
                    <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 pb-3 border-b border-border">
                      <div className="flex items-center space-x-2.5">
                        <span
                          className={`px-3 py-0.5 rounded-md font-semibold text-xs ${
                            req.impact === 'HIGH'
                              ? 'bg-rose-100 text-rose-800'
                              : req.impact === 'MEDIUM'
                              ? 'bg-amber-100 text-amber-800'
                              : 'bg-blue-100 text-blue-800'
                          }`}
                        >
                          {req.impact} Impact
                        </span>
                        <span className="font-semibold text-foreground tabular-nums">
                          {req.correlationId}
                        </span>
                        <span className="text-muted-foreground">·</span>
                        <span className="font-semibold text-secondary-foreground">
                          {req.module} #{req.recordId}
                        </span>
                      </div>

                      <div className="flex items-center space-x-2 text-muted-foreground text-xs">
                        <span>
                          From <strong className="text-foreground">{req.requestedBy.name}</strong> (@{req.requestedBy.username})
                        </span>
                        <span>·</span>
                        <span className="tabular-nums">
                          {formatDateTime(req.requestedAt)}
                        </span>
                      </div>
                    </div>

                    <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                      <div className="bg-card border-border p-3 rounded-xl border space-y-1.5">
                        <p className="font-semibold text-secondary-foreground text-xs">
                          Recorded now / Proposed
                        </p>
                        <div className="space-y-1">
                          {Object.entries(req.requestedChanges).map(([k, v]) => (
                            <div key={k} className="flex items-center justify-between gap-2 p-2 rounded-lg bg-card border border-border">
                              <span className="font-semibold text-secondary-foreground">{req.fieldLabels?.[k] ?? k}:</span>
                              <span className="tabular-nums">
                                <span className="text-rose-700">{String(req.currentValues?.[k] ?? '—')}</span>
                                {' → '}
                                <span className="font-semibold text-blue-700">{String(v)}</span>
                              </span>
                            </div>
                          ))}
                        </div>
                      </div>

                      <div className="bg-card border-border p-3 rounded-xl border space-y-1.5">
                        <p className="font-semibold text-secondary-foreground text-xs">
                          Requester Rationale
                        </p>
                        <p className="bg-card border-border p-2 rounded-lg border text-foreground leading-relaxed font-medium">
                          &ldquo;{req.reason}&rdquo;
                        </p>
                        {req.reviewedBy && (
                          <p className="text-xs text-muted-foreground pt-1">
                            Reviewed by <strong className="text-foreground">{req.reviewedBy.name}</strong> on {req.reviewedAt && formatDate(req.reviewedAt)}
                          </p>
                        )}
                      </div>
                    </div>

                    <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 pt-2 border-t border-border">
                      <div className="flex items-center space-x-2">
                        <span className="font-semibold text-secondary-foreground">Current Status:</span>
                        <span
                          className={`px-3 py-0.5 rounded-md font-semibold text-xs ${
                            isPending
                              ? 'bg-amber-100 text-amber-800'
                              : isApproved
                              ? 'bg-blue-100 text-blue-800'
                              : isApplied
                              ? 'bg-emerald-100 text-emerald-800'
                              : 'bg-rose-100 text-rose-800'
                          }`}
                        >
                          {req.statusLabel}
                        </span>
                      </div>

                      <div className="flex items-center space-x-2">
                        <Button
                          type="button"
                          variant="outline"
                          size="sm"
                          onClick={() => {
                            setSelectedRequest(req);
                            setIsReviewDrawerOpen(true);
                          }}
                          className="h-8 text-xs font-semibold gap-2"
                        >
                          <Info className="w-3.5 h-3.5 text-muted-foreground" />
                          <span>Inspect & Decide</span>
                        </Button>

                        {(isPending || isApproved) && (
                          <>
                            {isPending && (
                              <Button
                                type="button"
                                variant="outline"
                                size="sm"
                                onClick={() => {
                                  setRejectionModalId(req.id);
                                  setRejectionReason('');
                                }}
                                className="h-8 text-xs font-semibold text-rose-700 border-rose-200 hover:bg-rose-50"
                              >
                                Reject
                              </Button>
                            )}
                            <Button
                              type="button"
                              size="sm"
                              disabled={processingId === req.id}
                              onClick={() => handleApplyRequest(req.id)}
                              className="h-8 text-xs font-semibold bg-emerald-600 hover:bg-emerald-700 text-white gap-2"
                            >
                              
                              <span>{processingId === req.id ? 'Saving…' : req.autoApply ? 'Approve and apply' : 'Mark done'}</span>
                            </Button>
                          </>
                        )}
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      )}

      {/* TAB 2: RECORD EDITOR (Super Admin only; a Data Executive works from tickets) */}
      {activeTab === 'DIRECT_EDIT' &&
        currentUser &&
        (isSuperAdmin ? (
          <RecordEditor />
        ) : (
          <p className="rounded-2xl border border-border bg-card p-4 text-sm text-secondary-foreground">
            Direct edit is for the Super Admin. Corrections you make come from the tickets under Requests.
          </p>
        ))}

      {/* TAB 3: IMMUTABLE AUDIT LEDGER */}
      {activeTab === 'AUDIT' && (
        <div className="bg-card border-border p-6 border rounded-2xl space-y-3 text-xs">
          <div className="flex items-center justify-between pb-3 border-b border-border">
            <div>
              <h3 className="inline-flex items-center font-semibold text-sm text-foreground">Audit trail<InfoTip text="Every correction by Data Executive and Super Admin is listed here." /></h3>
            </div>
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => router.push('/super-admin/audit')}
              className="text-xs font-semibold gap-2"
            >
              <span>View Audit Trail</span>
              <ChevronRight className="w-3.5 h-3.5" />
            </Button>
          </div>
        </div>
      )}

      {/* DRAWER 1: TICKET REVIEW & DECISION DRAWER */}
      <Drawer open={isReviewDrawerOpen} onOpenChange={setIsReviewDrawerOpen}>
        <DrawerContent className="max-w-2xl">
          <div className="p-5 border-b border-border space-y-1">
            <div className="flex items-center space-x-2">
              <span className="px-2 py-0.5 rounded text-xs font-semibold bg-primary/10 text-primary">
                Review Ticket
              </span>
              <DrawerTitle className="text-base font-semibold text-foreground">
                {selectedRequest?.correlationId}
              </DrawerTitle>
            </div>
            <p className="text-xs text-muted-foreground">
              Module: <strong>{selectedRequest?.module}</strong> · Target Record: <strong>#{selectedRequest?.recordId}</strong>
            </p>
          </div>

          <div className="p-5 space-y-4 max-h-[75vh] overflow-y-auto text-xs">
            {/* Requester Info Card */}
            <div className="bg-card border-border p-4 rounded-2xl border grid grid-cols-[repeat(auto-fit,minmax(min(100%,7rem),1fr))] gap-2 text-secondary-foreground">
              <div>
                <span className="text-xs font-semibold text-muted-foreground">Requested By</span>
                <p className="font-semibold text-foreground">{selectedRequest?.requestedBy.name}</p>
                <p className="text-xs text-muted-foreground">@{selectedRequest?.requestedBy.username}</p>
              </div>
              <div>
                <span className="text-xs font-semibold text-muted-foreground">Request Timestamp</span>
                <p className="font-semibold text-foreground">
                  {selectedRequest?.requestedAt && formatDateTime(selectedRequest.requestedAt)}
                </p>
                <span className="inline-block px-2 py-0.2 rounded text-xs font-semibold bg-amber-100 text-amber-800 mt-1">
                  {selectedRequest?.impact} Impact
                </span>
              </div>
            </div>

            {/* Proposed Modifications Diff */}
            <div className="bg-card border-border p-4 rounded-2xl border space-y-2">
              <p className="font-semibold text-foreground text-xs">
                Recorded now / Proposed
              </p>
              <div className="space-y-1.5">
                {selectedRequest &&
                  Object.entries(selectedRequest.requestedChanges).map(([k, v]) => (
                    <div key={k} className="bg-card border-border flex items-center justify-between gap-2 p-2 rounded-lg border">
                      <span className="font-semibold text-secondary-foreground">{selectedRequest.fieldLabels?.[k] ?? k}</span>
                      <span className="tabular-nums">
                        <span className="text-rose-700">{String(selectedRequest.currentValues?.[k] ?? '—')}</span>
                        {' → '}
                        <span className="font-semibold text-blue-700">{String(v)}</span>
                      </span>
                    </div>
                  ))}
              </div>
            </div>

            {/* Requester Rationale */}
            <div className="bg-card border-border p-4 rounded-2xl border space-y-1">
              <p className="font-semibold text-foreground text-xs">
                Requester Substantive Justification
              </p>
              <p className="bg-card border-border p-3 rounded-lg border text-foreground leading-relaxed font-medium">
                &ldquo;{selectedRequest?.reason}&rdquo;
              </p>
            </div>

            {/* Audit Warning */}
            <div className="bg-card border-border p-3 rounded-xl border flex items-start space-x-2 text-amber-900 text-xs">
              <Lock className="w-4 h-4 text-amber-700 shrink-0 mt-0.5" />
              <span className="inline-flex items-center">Audit logged<InfoTip text="Approve and apply changes the record and logs who changed it and why. Tickets marked “fixed by hand” only close after you correct the record directly." /></span>
            </div>
          </div>

          <div className="p-4 border-t border-border flex items-center justify-end space-x-2 bg-subtle">
            <Button
              type="button"
              variant="secondary"
              onClick={() => setIsReviewDrawerOpen(false)}
              className="text-xs font-semibold"
            >
              Close
            </Button>
            {(selectedRequest?.status === 'REQUESTED' || selectedRequest?.status === 'APPROVED') && (
              <>
                {selectedRequest.status === 'REQUESTED' && (
                  <>
                    <Button
                      type="button"
                      variant="outline"
                      onClick={() => {
                        setRejectionModalId(selectedRequest.id);
                        setRejectionReason('');
                      }}
                      className="text-xs font-semibold text-rose-700 border-rose-200 hover:bg-rose-50"
                    >
                      Reject
                    </Button>
                  </>
                )}
                <Button
                  type="button"
                  disabled={processingId === selectedRequest.id}
                  onClick={() => handleApplyRequest(selectedRequest.id)}
                  className="text-xs font-semibold bg-emerald-600 hover:bg-emerald-700 text-white gap-2"
                >
                  
                  <span>{processingId === selectedRequest.id ? 'Saving…' : selectedRequest.autoApply ? 'Approve and apply' : 'Mark done'}</span>
                </Button>
              </>
            )}
          </div>
        </DrawerContent>
      </Drawer>

      {/* REJECTION PROMPT MODAL */}
      {rejectionModalId && (
        <div className="fixed inset-0 z-modal flex items-center justify-center bg-black/60 backdrop-blur-xs p-4 animate-in fade-in">
          <div className="bg-card border-border border rounded-2xl shadow-2xl max-w-md w-full p-5 space-y-4 text-xs">
            <h3 className="font-semibold text-sm text-foreground">Reject Correction Request</h3>
            <textarea
              rows={3}
              value={rejectionReason}
              onChange={(e) => setRejectionReason(e.target.value)}
              placeholder="Reason"
              className="w-full p-3 rounded-lg border border-border-strong font-medium text-foreground focus:outline-hidden focus:ring-2 focus:ring-rose-500 min-h-11"
            />
            <div className="flex items-center justify-end space-x-2 pt-2 border-t border-border">
              <Button
                type="button"
                variant="secondary"
                onClick={() => setRejectionModalId(null)}
                className="text-xs font-semibold"
              >
                Cancel
              </Button>
              <Button
                type="button"
                variant="destructive"
                disabled={rejectionReason.trim().length < 3 || processingId === rejectionModalId}
                onClick={() => handleRejectRequest(rejectionModalId)}
                className="text-xs font-semibold"
              >
                Confirm Rejection
              </Button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
