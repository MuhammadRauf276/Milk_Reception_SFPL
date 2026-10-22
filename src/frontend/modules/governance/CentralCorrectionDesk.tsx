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
  Calculator,
  Loader2,
  ArrowRight,
  Edit3,
  Layers,
  History,
  Info,
  ChevronRight,
  Truck,
  Building,
  Scale,
  Milk,
  Lock,
} from 'lucide-react';
import { getErrorMessage } from '@/lib/errors';
import { SerializedCorrectionRequest } from '@/backend/services/correctionGovernanceService';
import { useCurrentUser } from '@/frontend/hooks/useCurrentUser';
import { Drawer, DrawerContent, DrawerTitle } from '@/components/ui/drawer';
import { Button } from '@/components/ui/button';
import { computeCanonicalMilkMetrics } from '@/backend/utils/milkFormulas';

export interface StageRecordItem {
  id: string;
  stage: string;
  token?: string;
  collection_number?: string;
  shop_name?: string;
  route_name?: string;
  zmcc_name?: string;
  quantity_value?: number | null;
  quantity_unit?: string;
  gross_liters?: number | null;
  density?: number | null;
  lr?: number | null;
  fat?: number | null;
  snf?: number | null;
  ts?: number | null;
  at_13ts_liters?: number | null;
  operational_date?: string;
  correction_count?: number;
  submitted_by?: string;
  arrival_type?: string;
  vehicle_number?: string;
  supplier_name?: string;
  milk_source?: string | null;
  decision?: string;
  rejection_reason?: string | null;
  started_at?: string;
  completed_at?: string | null;
  results?: Array<{
    id: string;
    test_id: string;
    test_name: string;
    test_code: string;
    numeric_value: number | null;
    text_value: string | null;
    unit: string;
    result_type: string;
  }>;
  portions?: Array<{
    id: string;
    portion_number?: number;
    seal_number?: string;
    net_weight_kg?: number | null;
    decision?: string;
  }>;
  raw_milk_dispatch_note_number?: string | null;
  source_name?: string;
  source_type?: string;
  current_status?: string;
  created_at?: string;
  token_number?: string | null;
  gross_weight_kg?: number | null;
  tare_weight_kg?: number | null;
  net_weight_kg?: number | null;
  silo_number?: string;
}

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

  // Filters for Tab 2 (Direct Record Corrections)
  const [selectedStage, setSelectedStage] = useState<'1' | '2' | '3' | '4'>('1');
  const [recordSearch, setRecordSearch] = useState<string>('');
  const [recordPage, setRecordPage] = useState<number>(1);

  // Selected record for Stage Record Direct Edit Drawer
  const [selectedRecord, setSelectedRecord] = useState<StageRecordItem | null>(null);
  const [isEditDrawerOpen, setIsEditDrawerOpen] = useState(false);
  const [savingDirectEdit, setSavingDirectEdit] = useState(false);

  // Direct Edit Form State
  const [editReason, setEditReason] = useState<string>('');
  const [editToken, setEditToken] = useState<string>('');
  const [editVehicle, setEditVehicle] = useState<string>('');
  const [editQtyVal, setEditQtyVal] = useState<string>('');
  const [editQtyUnit, setEditQtyUnit] = useState<'KG' | 'LITER'>('KG');
  const [editLr, setEditLr] = useState<string>('');
  const [editFat, setEditFat] = useState<string>('');
  const [editDecision, setEditDecision] = useState<'ACCEPTED' | 'REJECTED'>('ACCEPTED');
  const [editGrossWeight, setEditGrossWeight] = useState<string>('');
  const [editTareWeight, setEditTareWeight] = useState<string>('');

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

  // Query Tab 2: Direct Stage Records
  const recordsQuery = useQuery({
    queryKey: ['corrections', 'records', { stage: selectedStage, search: recordSearch, page: recordPage }],
    queryFn: ({ signal }) => {
      const params = new URLSearchParams({
        stage: selectedStage,
        page: String(recordPage),
        pageSize: '25',
      });
      if (recordSearch) params.set('search', recordSearch);
      return fetchJson<{ items?: StageRecordItem[]; total?: number }>(`/api/corrections/records?${params.toString()}`, { signal });
    },
    placeholderData: keepPreviousData,
    enabled: activeTab === 'DIRECT_EDIT',
  });
  const stageRecords = useMemo(() => recordsQuery.data?.items ?? [], [recordsQuery.data]);
  const totalStageRecords = recordsQuery.data?.total ?? 0;

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
      setActionSuccessMsg(`Correction #${id} successfully applied to production database.`);
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

  // Tab 1: Mark a ticket Approved (agreed, correction still to be made)
  const handleApproveRequest = async (id: string) => {
    setProcessingId(id);
    setActionError(null);
    try {
      await fetchJson(`/api/corrections/${id}/approve`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' });
      setActionSuccessMsg(`Ticket #${id} marked Approved.`);
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

  // Tab 2: Open Direct Edit Drawer
  const openDirectEditDrawer = (rec: StageRecordItem) => {
    setSelectedRecord(rec);
    setEditReason('');
    setEditToken(rec.token || rec.raw_milk_dispatch_note_number || rec.token_number || '');
    setEditVehicle(rec.vehicle_number || '');
    setEditQtyVal(rec.quantity_value != null ? String(rec.quantity_value) : '');
    setEditQtyUnit((rec.quantity_unit as 'KG' | 'LITER') || 'KG');
    setEditLr(rec.lr != null ? String(rec.lr) : '');
    setEditFat(rec.fat != null ? String(rec.fat) : '');
    setEditDecision((rec.decision as 'ACCEPTED' | 'REJECTED') || 'ACCEPTED');
    setEditGrossWeight(rec.gross_weight_kg != null ? String(rec.gross_weight_kg) : '');
    setEditTareWeight(rec.tare_weight_kg != null ? String(rec.tare_weight_kg) : '');
    setIsEditDrawerOpen(true);
    setActionError(null);
  };

  // Tab 2: Live Calculation Preview for Direct Edit
  const livePreview = useMemo(() => {
    const qVal = parseFloat(editQtyVal);
    const lrVal = parseFloat(editLr);
    const fatVal = parseFloat(editFat);

    if (!isNaN(qVal) && qVal > 0 && !isNaN(lrVal) && !isNaN(fatVal) && lrVal > 0 && fatVal >= 0) {
      try {
        return computeCanonicalMilkMetrics(qVal, editQtyUnit, lrVal, fatVal);
      } catch {
        return null;
      }
    }
    return null;
  }, [editQtyVal, editQtyUnit, editLr, editFat]);

  // Tab 2: Submit Direct Correction
  const handleSaveDirectCorrection = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedRecord) return;
    if (editReason.trim().length < 5) {
      setActionError('A substantive correction reason of at least 5 characters is mandatory for audit logging.');
      return;
    }

    setSavingDirectEdit(true);
    setActionError(null);

    const changes: Record<string, unknown> = {};

    if (selectedStage === '1') {
      if (editToken) changes.shop_rmr_number = editToken.trim();
      if (editQtyVal) changes.quantity_value = parseFloat(editQtyVal);
      changes.quantity_unit = editQtyUnit;
      if (editLr) changes.lr = parseFloat(editLr);
      if (editFat) changes.fat = parseFloat(editFat);
    } else if (selectedStage === '2') {
      if (editQtyVal) changes.quantity_value = parseFloat(editQtyVal);
      changes.quantity_unit = editQtyUnit;
      changes.decision = editDecision;
    } else if (selectedStage === '3') {
      if (editToken) changes.raw_milk_dispatch_note_number = editToken.trim();
      if (editQtyVal) changes.quantity_value = parseFloat(editQtyVal);
      changes.quantity_unit = editQtyUnit;
      if (editLr) changes.lr = parseFloat(editLr);
      if (editFat) changes.fat = parseFloat(editFat);
    } else if (selectedStage === '4') {
      if (editToken) changes.token_number = editToken.trim();
      if (editVehicle) changes.vehicle_number = editVehicle.trim().toUpperCase();
      if (editGrossWeight) changes.gross_weight_kg = parseFloat(editGrossWeight);
      if (editTareWeight) changes.tare_weight_kg = parseFloat(editTareWeight);
    }

    try {
      await fetchJson('/api/corrections/records', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          stage: selectedStage,
          recordId: selectedRecord.id,
          reason: editReason.trim(),
          changes,
        }),
      });

      setActionSuccessMsg(`Record #${selectedRecord.id} successfully updated with new parameters and recomputed.`);
      setIsEditDrawerOpen(false);
      setSelectedRecord(null);
      handleRefresh();
      setTimeout(() => setActionSuccessMsg(null), 5000);
    } catch (err) {
      setActionError(getErrorMessage(err));
    } finally {
      setSavingDirectEdit(false);
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
                <h1 className="text-lg font-bold text-foreground tracking-tight">
                  Correction & Record Amendment Suite
                </h1>
                <span className="px-2.5 py-0.5 rounded-full text-[10px] font-bold uppercase tracking-wider bg-emerald-100 text-emerald-800 border border-emerald-200">
                  Authority Level 1
                </span>
              </div>
              <p className="text-xs text-muted-foreground mt-0.5">
                Sole cryptographic amendment authority for {isSuperAdmin ? 'Super Administrator' : 'Data Executive'}. All changes permanently logged to immutable audit ledger.
              </p>
            </div>
          </div>

          <div className="flex items-center gap-2">
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={handleRefresh}
              disabled={requestsQuery.isPending || recordsQuery.isPending}
              className="h-9 px-3 text-xs font-semibold gap-1.5"
            >
              <Loader2 className={`w-3.5 h-3.5 ${requestsQuery.isPending || recordsQuery.isPending ? 'animate-spin' : ''}`} />
              <span>Refresh Workspace</span>
            </Button>
          </div>
        </div>

        {/* 3 Metric Summary Cards */}
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
          <div className="p-4 rounded-xl bg-amber-50/80 border border-amber-200/90 flex items-center justify-between">
            <div>
              <p className="text-[11px] font-bold uppercase tracking-wider text-amber-900">Pending Field Requests</p>
              <p className="text-2xl font-black text-amber-950 tabular-nums">{counts.pending}</p>
            </div>
            <div className="p-2.5 rounded-xl bg-amber-100/80 text-amber-700">
              <Clock className="w-5 h-5" />
            </div>
          </div>

          <div className="p-4 rounded-xl bg-emerald-50/80 border border-emerald-200/90 flex items-center justify-between">
            <div>
              <p className="text-[11px] font-bold uppercase tracking-wider text-emerald-900">Applied Corrections</p>
              <p className="text-2xl font-black text-emerald-950 tabular-nums">{counts.applied}</p>
            </div>
            <div className="p-2.5 rounded-xl bg-emerald-100/80 text-emerald-700">
              <CheckCircle2 className="w-5 h-5" />
            </div>
          </div>

          <div className="p-4 rounded-xl bg-rose-50/80 border border-rose-200/90 flex items-center justify-between">
            <div>
              <p className="text-[11px] font-bold uppercase tracking-wider text-rose-900">High Impact Tickets</p>
              <p className="text-2xl font-black text-rose-950 tabular-nums">{counts.highImpact}</p>
            </div>
            <div className="p-2.5 rounded-xl bg-rose-100/80 text-rose-700">
              <AlertTriangle className="w-5 h-5" />
            </div>
          </div>
        </div>
      </div>

      {/* 2. Top-Level Tab Navigation (Synchronized with ?tab=) */}
      <div className="flex flex-wrap items-center gap-1.5 p-1 bg-slate-100 rounded-xl border border-slate-200 text-xs">
        <button
          type="button"
          onClick={() => setTab('REQUESTS')}
          className={`flex items-center space-x-2 px-4 py-2 rounded-lg font-bold transition-all ${
            activeTab === 'REQUESTS'
              ? 'bg-white text-primary shadow-xs'
              : 'text-slate-600 hover:text-slate-900'
          }`}
        >
          <Clock className="w-4 h-4" />
          <span>Correction Requests Queue</span>
          {counts.pending > 0 && (
            <span className="px-1.5 py-0.2 rounded-full text-[10px] font-extrabold bg-amber-100 text-amber-800">
              {counts.pending}
            </span>
          )}
        </button>

        <button
          type="button"
          onClick={() => setTab('DIRECT_EDIT')}
          className={`flex items-center space-x-2 px-4 py-2 rounded-lg font-bold transition-all ${
            activeTab === 'DIRECT_EDIT'
              ? 'bg-white text-primary shadow-xs'
              : 'text-slate-600 hover:text-slate-900'
          }`}
        >
          <Edit3 className="w-4 h-4" />
          <span>Direct Record Corrections (Stages 1-4)</span>
          <span className="px-1.5 py-0.2 rounded-full text-[10px] font-extrabold bg-blue-100 text-blue-800">
            Live Hub
          </span>
        </button>

        <button
          type="button"
          onClick={() => setTab('AUDIT')}
          className={`flex items-center space-x-2 px-4 py-2 rounded-lg font-bold transition-all ${
            activeTab === 'AUDIT'
              ? 'bg-white text-primary shadow-xs'
              : 'text-slate-600 hover:text-slate-900'
          }`}
        >
          <History className="w-4 h-4" />
          <span>Immutable Audit Ledger</span>
        </button>
      </div>

      {/* Action Success / Error Feedback */}
      {actionSuccessMsg && (
        <div className="p-3.5 bg-emerald-50 border border-emerald-200 rounded-xl text-emerald-800 text-xs font-semibold flex items-center space-x-2 animate-in fade-in">
          <CheckCircle2 className="w-4 h-4 text-emerald-600 shrink-0" />
          <span>{actionSuccessMsg}</span>
        </div>
      )}

      {actionError && (
        <div className="p-3.5 bg-rose-50 border border-rose-200 rounded-xl text-rose-800 text-xs font-semibold flex items-center space-x-2 animate-in fade-in">
          <AlertTriangle className="w-4 h-4 text-rose-600 shrink-0" />
          <span>{actionError}</span>
        </div>
      )}

      {/* TAB 1: CORRECTION REQUESTS QUEUE */}
      {activeTab === 'REQUESTS' && (
        <div className="space-y-4">
          {/* Filter Bar */}
          <div className="flex flex-col sm:flex-row items-stretch sm:items-center justify-between gap-3 p-3 bg-white border border-slate-200 rounded-xl text-xs">
            <div className="flex items-center space-x-2 flex-1">
              <Search className="w-4 h-4 text-slate-400 shrink-0" />
              <input
                type="text"
                placeholder="Search requests by Correlation ID, record #, requester, or reason…"
                value={reqSearchQuery}
                onChange={(e) => setReqSearchQuery(e.target.value)}
                className="w-full bg-transparent font-medium text-slate-800 focus:outline-hidden"
              />
            </div>

            <div className="flex flex-wrap items-center gap-2 shrink-0">
              <div className="flex items-center space-x-1.5">
                <span className="font-semibold text-slate-600">Status:</span>
                <select
                  value={statusFilter}
                  onChange={(e) => setStatusFilter(e.target.value)}
                  className="h-9 px-2 rounded-lg border border-slate-300 bg-white font-medium text-slate-800 focus:outline-hidden"
                >
                  <option value="REQUESTED">Open</option>
                  <option value="APPROVED">Approved</option>
                  <option value="REJECTED">Rejected</option>
                  <option value="APPLIED">Done</option>
                  <option value="ALL">All Statuses</option>
                </select>
              </div>

              <div className="flex items-center space-x-1.5">
                <Filter className="w-3.5 h-3.5 text-slate-500" />
                <span className="font-semibold text-slate-600">Module:</span>
                <select
                  value={moduleFilter}
                  onChange={(e) => setModuleFilter(e.target.value)}
                  className="h-9 px-2 rounded-lg border border-slate-300 bg-white font-medium text-slate-800 focus:outline-hidden"
                >
                  <option value="ALL">All Modules</option>
                  <option value="MOT_SHOP_COLLECTION">Stage 1: Shop Collections</option>
                  <option value="ZMCC_LAB_SESSION">Stage 2: ZMCC Lab Sessions</option>
                  <option value="VEHICLE_VISIT">Stage 3 & 4: Vehicle Visits</option>
                  <option value="ZMCC_MC_ARRIVAL">MC arrivals</option>
                  <option value="ZMCC_HC_ARRIVAL">HC arrivals</option>
                  <option value="ZMCC_WEIGHING">Weighing</option>
                  <option value="ZMCC_EXIT">Exit records</option>
                </select>
              </div>
            </div>
          </div>

          {/* Requests List */}
          {requestsQuery.isPending ? (
            <div className="p-12 text-center text-xs text-slate-400 font-semibold tabular-nums">
              Loading correction requests…
            </div>
          ) : filteredRequests.length === 0 ? (
            <div className="p-12 text-center bg-white border border-slate-200 rounded-2xl space-y-2">
              <FileCheck2 className="w-10 h-10 text-slate-300 mx-auto" />
              <h3 className="font-semibold text-slate-800 text-sm">No Correction Requests Found</h3>
              <p className="text-slate-500 text-xs">
                {statusFilter === 'REQUESTED'
                  ? 'There are no pending correction tickets waiting for your review.'
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
                    className="bg-white border border-slate-200 rounded-2xl shadow-xs p-4 space-y-3 hover:border-primary/40 transition-all text-xs"
                  >
                    <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 pb-2.5 border-b border-slate-100">
                      <div className="flex items-center space-x-2.5">
                        <span
                          className={`px-2.5 py-0.5 rounded-full font-bold text-[10px] tracking-wide uppercase ${
                            req.impact === 'HIGH'
                              ? 'bg-rose-100 text-rose-800'
                              : req.impact === 'MEDIUM'
                              ? 'bg-amber-100 text-amber-800'
                              : 'bg-blue-100 text-blue-800'
                          }`}
                        >
                          {req.impact} Impact
                        </span>
                        <span className="font-bold text-slate-900 tabular-nums">
                          {req.correlationId}
                        </span>
                        <span className="text-slate-400">·</span>
                        <span className="font-semibold text-slate-700">
                          {req.module} #{req.recordId}
                        </span>
                      </div>

                      <div className="flex items-center space-x-2 text-slate-500 text-[11px]">
                        <span>
                          From <strong className="text-slate-800">{req.requestedBy.name}</strong> (@{req.requestedBy.username})
                        </span>
                        <span>·</span>
                        <span className="tabular-nums">
                          {new Date(req.requestedAt).toLocaleString()}
                        </span>
                      </div>
                    </div>

                    <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                      <div className="p-3 rounded-xl bg-slate-50 border border-slate-200/80 space-y-1.5">
                        <p className="font-bold text-slate-700 text-[10px] uppercase tracking-wider">
                          Recorded now / Proposed
                        </p>
                        <div className="space-y-1">
                          {Object.entries(req.requestedChanges).map(([k, v]) => (
                            <div key={k} className="flex items-center justify-between gap-2 p-1.5 rounded-lg bg-white border border-slate-200">
                              <span className="font-semibold text-slate-700">{k}:</span>
                              <span className="tabular-nums">
                                <span className="text-rose-700">{String(req.currentValues?.[k] ?? '—')}</span>
                                {' → '}
                                <span className="font-bold text-blue-700">{String(v)}</span>
                              </span>
                            </div>
                          ))}
                        </div>
                      </div>

                      <div className="p-3 rounded-xl bg-slate-50 border border-slate-200/80 space-y-1.5">
                        <p className="font-bold text-slate-700 text-[10px] uppercase tracking-wider">
                          Requester Rationale
                        </p>
                        <p className="p-2 rounded-lg bg-white border border-slate-200 text-slate-800 leading-relaxed font-medium">
                          &ldquo;{req.reason}&rdquo;
                        </p>
                        {req.reviewedBy && (
                          <p className="text-[10px] text-slate-500 pt-1">
                            Reviewed by <strong className="text-slate-800">{req.reviewedBy.name}</strong> on {req.reviewedAt && new Date(req.reviewedAt).toLocaleDateString()}
                          </p>
                        )}
                      </div>
                    </div>

                    <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 pt-2 border-t border-slate-100">
                      <div className="flex items-center space-x-2">
                        <span className="font-semibold text-slate-600">Current Status:</span>
                        <span
                          className={`px-2.5 py-0.5 rounded-md font-bold text-[10px] ${
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
                          className="h-8 text-xs font-semibold gap-1.5"
                        >
                          <Info className="w-3.5 h-3.5 text-slate-500" />
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
                              className="h-8 text-xs font-semibold bg-emerald-600 hover:bg-emerald-700 text-white gap-1.5"
                            >
                              <CheckCircle2 className="w-3.5 h-3.5" />
                              <span>{processingId === req.id ? 'Saving…' : 'Apply & mark Done'}</span>
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

      {/* TAB 2: DIRECT RECORD CORRECTIONS HUB (STAGES 1-4) */}
      {activeTab === 'DIRECT_EDIT' && (
        <div className="space-y-4">
          {/* Stage Selector Tabs */}
          <div className="grid grid-cols-2 md:grid-cols-4 gap-2.5">
            <button
              type="button"
              onClick={() => {
                setSelectedStage('1');
                setRecordPage(1);
              }}
              className={`p-3.5 rounded-xl border text-left transition-all ${
                selectedStage === '1'
                  ? 'bg-primary/5 border-primary shadow-xs ring-1 ring-primary/20'
                  : 'bg-white border-slate-200 hover:border-slate-300'
              }`}
            >
              <div className="flex items-center space-x-2">
                <Truck className="w-4 h-4 text-primary" />
                <span className="font-bold text-xs text-foreground">Stage 1: Field MOT</span>
              </div>
              <p className="text-[11px] text-muted-foreground mt-1">
                Shop Collections, RMR Notes, LR & Fat
              </p>
            </button>

            <button
              type="button"
              onClick={() => {
                setSelectedStage('2');
                setRecordPage(1);
              }}
              className={`p-3.5 rounded-xl border text-left transition-all ${
                selectedStage === '2'
                  ? 'bg-primary/5 border-primary shadow-xs ring-1 ring-primary/20'
                  : 'bg-white border-slate-200 hover:border-slate-300'
              }`}
            >
              <div className="flex items-center space-x-2">
                <Building className="w-4 h-4 text-primary" />
                <span className="font-bold text-xs text-foreground">Stage 2: ZMCC Intake</span>
              </div>
              <p className="text-[11px] text-muted-foreground mt-1">
                Portions, Lab Sessions, HC & Tanks
              </p>
            </button>

            <button
              type="button"
              onClick={() => {
                setSelectedStage('3');
                setRecordPage(1);
              }}
              className={`p-3.5 rounded-xl border text-left transition-all ${
                selectedStage === '3'
                  ? 'bg-primary/5 border-primary shadow-xs ring-1 ring-primary/20'
                  : 'bg-white border-slate-200 hover:border-slate-300'
              }`}
            >
              <div className="flex items-center space-x-2">
                <Milk className="w-4 h-4 text-primary" />
                <span className="font-bold text-xs text-foreground">Stage 3: Dispatch</span>
              </div>
              <p className="text-[11px] text-muted-foreground mt-1">
                Dispatches to Plant, Note #, Seals
              </p>
            </button>

            <button
              type="button"
              onClick={() => {
                setSelectedStage('4');
                setRecordPage(1);
              }}
              className={`p-3.5 rounded-xl border text-left transition-all ${
                selectedStage === '4'
                  ? 'bg-primary/5 border-primary shadow-xs ring-1 ring-primary/20'
                  : 'bg-white border-slate-200 hover:border-slate-300'
              }`}
            >
              <div className="flex items-center space-x-2">
                <Scale className="w-4 h-4 text-primary" />
                <span className="font-bold text-xs text-foreground">Stage 4: Plant Reception</span>
              </div>
              <p className="text-[11px] text-muted-foreground mt-1">
                Gross & Tare Weights, QA Lab, Silos
              </p>
            </button>
          </div>

          {/* Search Bar */}
          <div className="flex items-center justify-between gap-3 p-3 bg-white border border-slate-200 rounded-xl text-xs">
            <div className="flex items-center space-x-2 flex-1">
              <Search className="w-4 h-4 text-slate-400 shrink-0" />
              <input
                type="text"
                placeholder={`Search Stage ${selectedStage} records by token, vehicle, supplier, or route…`}
                value={recordSearch}
                onChange={(e) => {
                  setRecordSearch(e.target.value);
                  setRecordPage(1);
                }}
                className="w-full bg-transparent font-medium text-slate-800 focus:outline-hidden"
              />
            </div>
            <span className="text-[11px] font-semibold text-slate-500 tabular-nums shrink-0">
              {totalStageRecords} Total Records
            </span>
          </div>

          {/* Records Table */}
          <div className="overflow-hidden rounded-xl border border-slate-200 bg-white shadow-xs">
            <div className="overflow-x-auto">
              <table className="w-full text-left text-xs">
                <thead className="border-b border-slate-200 bg-slate-50 text-slate-600">
                  <tr>
                    <th className="p-3 font-semibold">Token / ID</th>
                    {selectedStage === '1' && (
                      <>
                        <th className="p-3 font-semibold">Shop & Route</th>
                        <th className="p-3 font-semibold">Quantity</th>
                        <th className="p-3 font-semibold">Chemistry (LR / Fat)</th>
                        <th className="p-3 font-semibold">13 TS Liters</th>
                      </>
                    )}
                    {selectedStage === '2' && (
                      <>
                        <th className="p-3 font-semibold">Type & Vehicle</th>
                        <th className="p-3 font-semibold">Supplier / Source</th>
                        <th className="p-3 font-semibold">Decision</th>
                        <th className="p-3 font-semibold">Quantity & Solids</th>
                      </>
                    )}
                    {selectedStage === '3' && (
                      <>
                        <th className="p-3 font-semibold">Vehicle & Source</th>
                        <th className="p-3 font-semibold">Dispatched Quantity</th>
                        <th className="p-3 font-semibold">LR & Fat</th>
                        <th className="p-3 font-semibold">Status</th>
                      </>
                    )}
                    {selectedStage === '4' && (
                      <>
                        <th className="p-3 font-semibold">Vehicle & Source</th>
                        <th className="p-3 font-semibold">Gross / Tare (KG)</th>
                        <th className="p-3 font-semibold">Net Weight (KG)</th>
                        <th className="p-3 font-semibold">Silo Dest.</th>
                      </>
                    )}
                    <th className="p-3 font-semibold text-right">Actions</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100 font-medium">
                  {recordsQuery.isPending ? (
                    <tr>
                      <td colSpan={6} className="p-8 text-center text-slate-400 font-semibold tabular-nums">
                        Loading stage records…
                      </td>
                    </tr>
                  ) : stageRecords.length === 0 ? (
                    <tr>
                      <td colSpan={6} className="p-8 text-center text-slate-400 font-medium">
                        No records found matching your active filter.
                      </td>
                    </tr>
                  ) : (
                    stageRecords.map((rec) => (
                      <tr key={rec.id} className="hover:bg-slate-50 transition-colors">
                        <td className="p-3 font-bold text-slate-900 tabular-nums">
                          <span className="bg-slate-100 px-2 py-0.5 rounded text-slate-800">
                            {rec.token || `#${rec.id}`}
                          </span>
                          {rec.correction_count && rec.correction_count > 0 ? (
                            <span className="ml-1.5 text-[10px] text-amber-700 bg-amber-50 border border-amber-200 px-1.5 py-0.2 rounded font-semibold">
                              {rec.correction_count} edits
                            </span>
                          ) : null}
                        </td>

                        {selectedStage === '1' && (
                          <>
                            <td className="p-3 text-slate-700">
                              <span className="font-semibold text-slate-800">{rec.shop_name}</span>
                              <div className="text-[11px] text-slate-500">{rec.route_name}</div>
                            </td>
                            <td className="p-3 tabular-nums font-semibold text-slate-800">
                              {rec.quantity_value} {rec.quantity_unit}
                            </td>
                            <td className="p-3 tabular-nums text-slate-700">
                              LR: <strong>{rec.lr}</strong> · Fat: <strong>{rec.fat}%</strong>
                            </td>
                            <td className="p-3 tabular-nums font-bold text-emerald-700">
                              {rec.at_13ts_liters != null ? `${rec.at_13ts_liters} L` : '—'}
                            </td>
                          </>
                        )}

                        {selectedStage === '2' && (
                          <>
                            <td className="p-3 text-slate-700">
                              <span className="font-bold text-slate-800">{rec.vehicle_number}</span>
                              <div className="text-[11px] text-slate-500 uppercase">{rec.arrival_type}</div>
                            </td>
                            <td className="p-3 text-slate-700">
                              <span className="font-semibold">{rec.supplier_name}</span>
                              {rec.milk_source && <div className="text-[11px] text-blue-600">{rec.milk_source}</div>}
                            </td>
                            <td className="p-3">
                              <span
                                className={`px-2 py-0.5 rounded text-[10px] font-bold ${
                                  rec.decision === 'ACCEPTED'
                                    ? 'bg-emerald-100 text-emerald-800'
                                    : 'bg-rose-100 text-rose-800'
                                }`}
                              >
                                {rec.decision}
                              </span>
                            </td>
                            <td className="p-3 tabular-nums text-slate-700">
                              {rec.quantity_value ? `${rec.quantity_value} ${rec.quantity_unit}` : '—'}
                              {rec.at_13ts_liters != null && (
                                <div className="text-[11px] text-emerald-700 font-semibold">
                                  @13: {rec.at_13ts_liters} L
                                </div>
                              )}
                            </td>
                          </>
                        )}

                        {selectedStage === '3' && (
                          <>
                            <td className="p-3 text-slate-700">
                              <span className="font-bold text-slate-800">{rec.vehicle_number}</span>
                              <div className="text-[11px] text-slate-500">{rec.source_name}</div>
                            </td>
                            <td className="p-3 tabular-nums font-semibold text-slate-800">
                              {rec.quantity_value ? `${rec.quantity_value} ${rec.quantity_unit}` : '—'}
                            </td>
                            <td className="p-3 tabular-nums text-slate-700">
                              LR: {rec.lr || '—'} · Fat: {rec.fat != null ? `${rec.fat}%` : '—'}
                            </td>
                            <td className="p-3">
                              <span className="bg-slate-100 text-slate-700 px-2 py-0.5 rounded text-[10px] font-bold">
                                {rec.current_status}
                              </span>
                            </td>
                          </>
                        )}

                        {selectedStage === '4' && (
                          <>
                            <td className="p-3 text-slate-700">
                              <span className="font-bold text-slate-800">{rec.vehicle_number}</span>
                              <div className="text-[11px] text-slate-500">{rec.source_name}</div>
                            </td>
                            <td className="p-3 tabular-nums text-slate-700">
                              {rec.gross_weight_kg ? `${rec.gross_weight_kg} KG` : '—'} /{' '}
                              {rec.tare_weight_kg ? `${rec.tare_weight_kg} KG` : '—'}
                            </td>
                            <td className="p-3 tabular-nums font-bold text-emerald-700">
                              {rec.net_weight_kg ? `${rec.net_weight_kg} KG` : '—'}
                            </td>
                            <td className="p-3 text-slate-700">
                              <span className="bg-blue-50 text-blue-800 px-2 py-0.5 rounded text-[11px] font-semibold">
                                {rec.silo_number}
                              </span>
                            </td>
                          </>
                        )}

                        <td className="p-3 text-right">
                          <Button
                            type="button"
                            size="sm"
                            variant="outline"
                            onClick={() => openDirectEditDrawer(rec)}
                            className="h-8 text-xs font-semibold gap-1.5"
                          >
                            <Edit3 className="w-3.5 h-3.5 text-primary" />
                            <span>Edit Record</span>
                          </Button>
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}

      {/* TAB 3: IMMUTABLE AUDIT LEDGER */}
      {activeTab === 'AUDIT' && (
        <div className="p-6 bg-white border border-slate-200 rounded-2xl space-y-3 text-xs">
          <div className="flex items-center justify-between pb-3 border-b border-slate-200">
            <div>
              <h3 className="font-bold text-sm text-slate-900">Cryptographic Correction Audit Trail</h3>
              <p className="text-slate-500">
                Every record amendment made by Data Executive and Super Admin writes an append-only row here.
              </p>
            </div>
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => router.push('/super-admin/audit')}
              className="text-xs font-semibold gap-1.5"
            >
              <span>Open Full Audit Explorer</span>
              <ChevronRight className="w-3.5 h-3.5" />
            </Button>
          </div>
          <p className="text-slate-600">
            Click &ldquo;Open Full Audit Explorer&rdquo; above to inspect the complete multi-entity timeline with deep JSON diff inspection and operator identity stamps.
          </p>
        </div>
      )}

      {/* DRAWER 1: TICKET REVIEW & DECISION DRAWER */}
      <Drawer open={isReviewDrawerOpen} onOpenChange={setIsReviewDrawerOpen}>
        <DrawerContent className="max-w-2xl">
          <div className="p-5 border-b border-border space-y-1">
            <div className="flex items-center space-x-2">
              <span className="px-2 py-0.5 rounded text-[10px] font-bold uppercase tracking-wider bg-primary/10 text-primary">
                Review Ticket
              </span>
              <DrawerTitle className="text-base font-bold text-foreground">
                {selectedRequest?.correlationId}
              </DrawerTitle>
            </div>
            <p className="text-xs text-muted-foreground">
              Module: <strong>{selectedRequest?.module}</strong> · Target Record: <strong>#{selectedRequest?.recordId}</strong>
            </p>
          </div>

          <div className="p-5 space-y-4 max-h-[75vh] overflow-y-auto text-xs">
            {/* Requester Info Card */}
            <div className="p-3.5 rounded-xl bg-slate-50 border border-slate-200 grid grid-cols-2 gap-2 text-slate-700">
              <div>
                <span className="text-[10px] uppercase font-bold text-slate-500">Requested By</span>
                <p className="font-semibold text-slate-900">{selectedRequest?.requestedBy.name}</p>
                <p className="text-[11px] text-slate-500">@{selectedRequest?.requestedBy.username}</p>
              </div>
              <div>
                <span className="text-[10px] uppercase font-bold text-slate-500">Request Timestamp</span>
                <p className="font-semibold text-slate-900">
                  {selectedRequest?.requestedAt && new Date(selectedRequest.requestedAt).toLocaleString()}
                </p>
                <span className="inline-block px-2 py-0.2 rounded text-[10px] font-bold uppercase bg-amber-100 text-amber-800 mt-1">
                  {selectedRequest?.impact} Impact
                </span>
              </div>
            </div>

            {/* Proposed Modifications Diff */}
            <div className="p-3.5 rounded-xl bg-slate-50 border border-slate-200 space-y-2">
              <p className="font-bold text-slate-800 text-[11px] uppercase tracking-wider">
                Recorded now / Proposed
              </p>
              <div className="space-y-1.5">
                {selectedRequest &&
                  Object.entries(selectedRequest.requestedChanges).map(([k, v]) => (
                    <div key={k} className="flex items-center justify-between gap-2 p-2 rounded-lg bg-white border border-slate-200">
                      <span className="font-semibold text-slate-700">{k}</span>
                      <span className="tabular-nums">
                        <span className="text-rose-700">{String(selectedRequest.currentValues?.[k] ?? '—')}</span>
                        {' → '}
                        <span className="font-bold text-blue-700">{String(v)}</span>
                      </span>
                    </div>
                  ))}
              </div>
            </div>

            {/* Requester Rationale */}
            <div className="p-3.5 rounded-xl bg-slate-50 border border-slate-200 space-y-1">
              <p className="font-bold text-slate-800 text-[11px] uppercase tracking-wider">
                Requester Substantive Justification
              </p>
              <p className="p-2.5 rounded-lg bg-white border border-slate-200 text-slate-800 leading-relaxed font-medium">
                &ldquo;{selectedRequest?.reason}&rdquo;
              </p>
            </div>

            {/* Audit Warning */}
            <div className="p-3 rounded-xl bg-amber-50 border border-amber-200 flex items-start space-x-2 text-amber-900 text-xs">
              <Lock className="w-4 h-4 text-amber-700 shrink-0 mt-0.5" />
              <span>
                Applying a ticket for MC arrival, HC arrival, lab or shop records overwrites the fields in the database and writes an immutable audit row. For weighing and exit tickets, fix the record first, then apply to mark the ticket Done.
              </span>
            </div>
          </div>

          <div className="p-4 border-t border-border flex items-center justify-end space-x-2 bg-slate-50">
            <Button
              type="button"
              variant="outline"
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
                    <Button
                      type="button"
                      variant="outline"
                      disabled={processingId === selectedRequest.id}
                      onClick={() => handleApproveRequest(selectedRequest.id)}
                      className="text-xs font-semibold"
                    >
                      Approve only
                    </Button>
                  </>
                )}
                <Button
                  type="button"
                  disabled={processingId === selectedRequest.id}
                  onClick={() => handleApplyRequest(selectedRequest.id)}
                  className="text-xs font-semibold bg-emerald-600 hover:bg-emerald-700 text-white gap-1.5"
                >
                  <CheckCircle2 className="w-3.5 h-3.5" />
                  <span>{processingId === selectedRequest.id ? 'Saving…' : 'Apply & mark Done'}</span>
                </Button>
              </>
            )}
          </div>
        </DrawerContent>
      </Drawer>

      {/* DRAWER 2: STAGE RECORD DIRECT EDIT & CORRECTION DRAWER */}
      <Drawer open={isEditDrawerOpen} onOpenChange={setIsEditDrawerOpen}>
        <DrawerContent className="max-w-2xl">
          <div className="p-5 border-b border-border space-y-1">
            <div className="flex items-center space-x-2">
              <span className="px-2 py-0.5 rounded text-[10px] font-bold uppercase tracking-wider bg-blue-100 text-blue-800">
                Direct Record Correction
              </span>
              <DrawerTitle className="text-base font-bold text-foreground">
                Stage {selectedStage} Record #{selectedRecord?.id}
              </DrawerTitle>
            </div>
            <p className="text-xs text-muted-foreground">
              Token: <strong>{selectedRecord?.token}</strong> · Currently has {selectedRecord?.correction_count ?? 0} previous amendments.
            </p>
          </div>

          <form onSubmit={handleSaveDirectCorrection}>
            <div className="p-5 space-y-4 max-h-[75vh] overflow-y-auto text-xs">
              {/* STAGE 1 & 3 INPUTS: Tokens & Weights */}
              {(selectedStage === '1' || selectedStage === '3') && (
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <div>
                    <label className="block font-semibold text-slate-700 mb-1">
                      {selectedStage === '1' ? 'Shop Receipt Token (RMR #)' : 'Raw Milk Dispatch Note #'}
                    </label>
                    <input
                      type="text"
                      value={editToken}
                      onChange={(e) => setEditToken(e.target.value.toUpperCase())}
                      placeholder="e.g. 001924"
                      className="h-10 w-full rounded-xl border border-slate-300 px-3 text-xs uppercase font-mono font-semibold"
                    />
                  </div>

                  <div>
                    <label className="block font-semibold text-slate-700 mb-1">
                      Quantity Value & Unit
                    </label>
                    <div className="flex space-x-1.5">
                      <input
                        type="number"
                        step="0.01"
                        value={editQtyVal}
                        onChange={(e) => setEditQtyVal(e.target.value)}
                        placeholder="Quantity"
                        className="h-10 flex-1 rounded-xl border border-slate-300 px-3 text-xs font-semibold tabular-nums"
                      />
                      <select
                        value={editQtyUnit}
                        onChange={(e) => setEditQtyUnit(e.target.value as 'KG' | 'LITER')}
                        className="h-10 rounded-xl border border-slate-300 px-2 text-xs font-semibold bg-white"
                      >
                        <option value="KG">KG</option>
                        <option value="LITER">LITER</option>
                      </select>
                    </div>
                  </div>
                </div>
              )}

              {/* CHEMISTRY INPUTS (LR & FAT) */}
              {(selectedStage === '1' || selectedStage === '3') && (
                <div className="grid grid-cols-2 gap-3 bg-slate-50 p-3 rounded-xl border border-slate-200">
                  <div>
                    <label className="block font-semibold text-slate-700 mb-1">
                      Corrected LR
                    </label>
                    <input
                      type="number"
                      step="0.01"
                      value={editLr}
                      onChange={(e) => setEditLr(e.target.value)}
                      placeholder="e.g. 28.5"
                      className="h-10 w-full rounded-xl border border-slate-300 px-3 text-xs font-semibold tabular-nums bg-white"
                    />
                  </div>
                  <div>
                    <label className="block font-semibold text-slate-700 mb-1">
                      Fat %
                    </label>
                    <input
                      type="number"
                      step="0.01"
                      value={editFat}
                      onChange={(e) => setEditFat(e.target.value)}
                      placeholder="e.g. 4.2"
                      className="h-10 w-full rounded-xl border border-slate-300 px-3 text-xs font-semibold tabular-nums bg-white"
                    />
                  </div>
                </div>
              )}

              {/* STAGE 2: INTAKE LAB DECISION & QUANTITY */}
              {selectedStage === '2' && (
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <div>
                    <label className="block font-semibold text-slate-700 mb-1">
                      Reception Quantity (KG)
                    </label>
                    <input
                      type="number"
                      step="0.01"
                      value={editQtyVal}
                      onChange={(e) => setEditQtyVal(e.target.value)}
                      placeholder="e.g. 4500"
                      className="h-10 w-full rounded-xl border border-slate-300 px-3 text-xs font-semibold tabular-nums"
                    />
                  </div>
                  <div>
                    <label className="block font-semibold text-slate-700 mb-1">
                      Portion Decision
                    </label>
                    <select
                      value={editDecision}
                      onChange={(e) => setEditDecision(e.target.value as 'ACCEPTED' | 'REJECTED')}
                      className="h-10 w-full rounded-xl border border-slate-300 px-2 text-xs font-semibold bg-white"
                    >
                      <option value="ACCEPTED">ACCEPTED (Unload to Tank)</option>
                      <option value="REJECTED">REJECTED (Direct Return)</option>
                    </select>
                  </div>
                </div>
              )}

              {/* STAGE 4: PLANT WEIGHTS */}
              {selectedStage === '4' && (
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <div>
                    <label className="block font-semibold text-slate-700 mb-1">
                      Plant Gate Token
                    </label>
                    <input
                      type="text"
                      value={editToken}
                      onChange={(e) => setEditToken(e.target.value.toUpperCase())}
                      className="h-10 w-full rounded-xl border border-slate-300 px-3 text-xs uppercase font-mono font-semibold"
                    />
                  </div>
                  <div>
                    <label className="block font-semibold text-slate-700 mb-1">
                      Vehicle Number
                    </label>
                    <input
                      type="text"
                      value={editVehicle}
                      onChange={(e) => setEditVehicle(e.target.value.toUpperCase())}
                      className="h-10 w-full rounded-xl border border-slate-300 px-3 text-xs uppercase font-mono font-semibold"
                    />
                  </div>
                  <div>
                    <label className="block font-semibold text-slate-700 mb-1">
                      First Weight (Gross KG)
                    </label>
                    <input
                      type="number"
                      step="0.01"
                      value={editGrossWeight}
                      onChange={(e) => setEditGrossWeight(e.target.value)}
                      className="h-10 w-full rounded-xl border border-slate-300 px-3 text-xs font-semibold tabular-nums"
                    />
                  </div>
                  <div>
                    <label className="block font-semibold text-slate-700 mb-1">
                      Second Weight (Tare KG)
                    </label>
                    <input
                      type="number"
                      step="0.01"
                      value={editTareWeight}
                      onChange={(e) => setEditTareWeight(e.target.value)}
                      className="h-10 w-full rounded-xl border border-slate-300 px-3 text-xs font-semibold tabular-nums"
                    />
                  </div>
                </div>
              )}

              {/* LIVE RECOMPUTATION PREVIEW CARD */}
              {livePreview && (
                <div className="bg-emerald-50/60 border border-emerald-200 rounded-xl p-3 space-y-2">
                  <div className="flex items-center justify-between text-emerald-900 font-bold">
                    <span className="flex items-center gap-1.5 text-xs">
                      <Calculator className="w-3.5 h-3.5" />
                      Live Recomputed Metrics Preview
                    </span>
                    <span className="text-[10px] bg-emerald-100 px-2 py-0.5 rounded text-emerald-800">
                      Auto-Calculated
                    </span>
                  </div>
                  <div className="grid grid-cols-2 sm:grid-cols-5 gap-2 text-xs">
                    <div className="bg-white p-2 rounded-lg border border-emerald-200">
                      <span className="text-[10px] text-slate-500 uppercase font-semibold">Density</span>
                      <p className="font-bold tabular-nums text-slate-900">{livePreview.density.toFixed(4)}</p>
                    </div>
                    <div className="bg-white p-2 rounded-lg border border-emerald-200">
                      <span className="text-[10px] text-slate-500 uppercase font-semibold">Gross Liters</span>
                      <p className="font-bold tabular-nums text-slate-900">{livePreview.grossLiters.toFixed(2)} L</p>
                    </div>
                    <div className="bg-white p-2 rounded-lg border border-emerald-200">
                      <span className="text-[10px] text-slate-500 uppercase font-semibold">SNF %</span>
                      <p className="font-bold tabular-nums text-slate-900">{livePreview.snf.toFixed(2)}%</p>
                    </div>
                    <div className="bg-white p-2 rounded-lg border border-emerald-200">
                      <span className="text-[10px] text-slate-500 uppercase font-semibold">Total Solids</span>
                      <p className="font-bold tabular-nums text-slate-900">{livePreview.ts.toFixed(2)}%</p>
                    </div>
                    <div className="bg-white p-2 rounded-lg border border-emerald-200">
                      <span className="text-[10px] text-emerald-800 uppercase font-bold">@13TS Liters</span>
                      <p className="font-bold tabular-nums text-emerald-700">{livePreview.at13tsLiters.toFixed(2)} L</p>
                    </div>
                  </div>
                </div>
              )}

              {/* MANDATORY JUSTIFICATION REASON */}
              <div>
                <label className="block font-semibold text-slate-800 mb-1">
                  Correction Reason / Justification <span className="text-rose-500">*</span>
                </label>
                <textarea
                  rows={3}
                  required
                  value={editReason}
                  onChange={(e) => setEditReason(e.target.value)}
                  placeholder="Explain why this record is being modified (Compulsory for immutable audit trail)…"
                  className="w-full p-2.5 border border-slate-300 rounded-xl text-xs font-medium focus:ring-2 focus:ring-primary focus:outline-hidden"
                />
                <p className="text-[11px] text-slate-400 mt-0.5">
                  Minimum 5 characters. Stamped with actor <strong>{userRole}</strong>.
                </p>
              </div>

              {/* AUDIT WARNING */}
              <div className="p-3 rounded-xl bg-slate-50 border border-slate-200 text-slate-600 flex items-start space-x-2 text-xs">
                <Lock className="w-4 h-4 text-slate-500 shrink-0 mt-0.5" />
                <span>
                  This direct correction will atomically update the record, recompute supply chain totals, adjust tank inventory if applicable, and log a permanent change event.
                </span>
              </div>
            </div>

            <div className="p-4 border-t border-border flex items-center justify-end space-x-2 bg-slate-50">
              <Button
                type="button"
                variant="outline"
                disabled={savingDirectEdit}
                onClick={() => setIsEditDrawerOpen(false)}
                className="text-xs font-semibold"
              >
                Cancel
              </Button>
              <Button
                type="submit"
                disabled={savingDirectEdit || editReason.trim().length < 5}
                className="text-xs font-semibold bg-primary text-white gap-1.5"
              >
                <CheckCircle2 className="w-3.5 h-3.5" />
                <span>{savingDirectEdit ? 'Applying & Recomputing…' : 'Apply Direct Correction'}</span>
              </Button>
            </div>
          </form>
        </DrawerContent>
      </Drawer>

      {/* REJECTION PROMPT MODAL */}
      {rejectionModalId && (
        <div className="fixed inset-0 z-modal flex items-center justify-center bg-black/60 backdrop-blur-xs p-4 animate-in fade-in">
          <div className="bg-white border border-slate-200 rounded-2xl shadow-2xl max-w-md w-full p-5 space-y-4 text-xs">
            <h3 className="font-bold text-sm text-slate-900">Reject Correction Request</h3>
            <p className="text-slate-600">
              Provide an explanation to the requester why this correction cannot be applied.
            </p>
            <textarea
              rows={3}
              value={rejectionReason}
              onChange={(e) => setRejectionReason(e.target.value)}
              placeholder="Enter substantive rejection feedback…"
              className="w-full p-2.5 rounded-xl border border-slate-300 font-medium text-slate-900 focus:outline-hidden focus:ring-2 focus:ring-rose-500"
            />
            <div className="flex items-center justify-end space-x-2 pt-2 border-t border-slate-200">
              <Button
                type="button"
                variant="outline"
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
