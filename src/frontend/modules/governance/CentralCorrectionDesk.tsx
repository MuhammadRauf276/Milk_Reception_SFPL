'use client';

import React, { useState, useEffect, useCallback, useMemo } from 'react';
import {
  ShieldCheck,
  Clock,
  CheckCircle2,
  XCircle,
  AlertTriangle,
  Search,
  Filter,
  ArrowRight,
  Database,
  History,
  FileCheck2,
} from 'lucide-react';
import { getErrorMessage } from '@/lib/errors';
import { SerializedCorrectionRequest } from '@/backend/services/correctionGovernanceService';

export const CentralCorrectionDesk: React.FC = () => {
  const [requests, setRequests] = useState<SerializedCorrectionRequest[]>([]);
  const [loading, setLoading] = useState<boolean>(true);
  const [error, setError] = useState<string | null>(null);
  const [statusFilter, setStatusFilter] = useState<string>('REQUESTED');
  const [moduleFilter, setModuleFilter] = useState<string>('ALL');
  const [searchQuery, setSearchQuery] = useState<string>('');
  const [activeTab, setActiveTab] = useState<'PENDING' | 'SEARCH_OVERRIDE' | 'AUDIT_LEDGER'>('PENDING');

  // Action states
  const [processingId, setProcessingId] = useState<string | null>(null);
  const [rejectionModalId, setRejectionModalId] = useState<string | null>(null);
  const [rejectionReason, setRejectionReason] = useState<string>('');
  const [actionSuccessMsg, setActionSuccessMsg] = useState<string | null>(null);

  const fetchRequests = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const params = new URLSearchParams();
      if (statusFilter !== 'ALL') params.set('status', statusFilter);
      if (moduleFilter !== 'ALL') params.set('module', moduleFilter);

      const res = await fetch(`/api/corrections?${params.toString()}`);
      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.error || 'Failed to load correction requests.');
      }
      setRequests(data.items || []);
    } catch (err) {
      setError(getErrorMessage(err));
    } finally {
      setLoading(false);
    }
  }, [statusFilter, moduleFilter]);

  useEffect(() => {
    fetchRequests();
  }, [fetchRequests]);

  const handleApply = async (id: string) => {
    setProcessingId(id);
    setError(null);
    try {
      const res = await fetch(`/api/corrections/${id}/apply`, {
        method: 'POST',
      });
      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.error || 'Failed to apply correction.');
      }
      setActionSuccessMsg(`Correction #${id} successfully applied to production database.`);
      fetchRequests();
      setTimeout(() => setActionSuccessMsg(null), 4000);
    } catch (err) {
      setError(getErrorMessage(err));
    } finally {
      setProcessingId(null);
    }
  };

  const handleReject = async (id: string) => {
    if (rejectionReason.trim().length < 3) {
      setError('Please provide a substantive rejection reason of at least 3 characters.');
      return;
    }
    setProcessingId(id);
    setError(null);
    try {
      const res = await fetch(`/api/corrections/${id}/reject`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ reason: rejectionReason.trim() }),
      });
      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.error || 'Failed to reject correction.');
      }
      setActionSuccessMsg(`Correction request #${id} was rejected.`);
      setRejectionModalId(null);
      setRejectionReason('');
      fetchRequests();
      setTimeout(() => setActionSuccessMsg(null), 4000);
    } catch (err) {
      setError(getErrorMessage(err));
    } finally {
      setProcessingId(null);
    }
  };

  const filteredRequests = useMemo(() => {
    return requests.filter((r) => {
      if (searchQuery.trim()) {
        const q = searchQuery.toLowerCase();
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
  }, [requests, searchQuery]);

  const counts = useMemo(() => {
    const pending = requests.filter((r) => r.status === 'REQUESTED').length;
    const applied = requests.filter((r) => r.status === 'APPLIED').length;
    const highImpact = requests.filter((r) => r.impact === 'HIGH').length;
    return { pending, applied, highImpact };
  }, [requests]);

  return (
    <div className="space-y-6">
      {/* 1. Header & KPI Counter Cards */}
      <div className="p-5 rounded-2xl bg-card border border-border/80 shadow-xs space-y-4">
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 pb-3 border-b border-border/80">
          <div className="flex items-center space-x-3">
            <div className="p-2.5 rounded-xl bg-primary/10 text-primary">
              <ShieldCheck className="w-6 h-6" />
            </div>
            <div>
              <h1 className="text-base font-bold text-foreground">
                Correction desk
              </h1>
            </div>
          </div>

          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={fetchRequests}
              disabled={loading}
              className="flex items-center space-x-1.5 px-3 py-1.5 rounded-xl bg-subtle border border-border/80 text-xs font-semibold text-foreground hover:bg-muted/60 transition-all disabled:opacity-50"
            >
              <span>{loading ? 'Refreshing…' : 'Refresh Queue'}</span>
            </button>
          </div>
        </div>

        {/* 3 Metric Pills */}
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
          <div className="p-3.5 rounded-xl bg-amber-50/70 border border-amber-200/80 flex items-center justify-between">
            <div>
              <p className="text-[11px] font-semibold text-amber-900">Pending Review</p>
              <p className="text-xl font-bold text-amber-950 tabular-nums">{counts.pending}</p>
            </div>
            <Clock className="w-5 h-5 text-amber-600" />
          </div>

          <div className="p-3.5 rounded-xl bg-emerald-50/70 border border-emerald-200/80 flex items-center justify-between">
            <div>
              <p className="text-[11px] font-semibold text-emerald-900">Applied Corrections</p>
              <p className="text-xl font-bold text-emerald-950 tabular-nums">{counts.applied}</p>
            </div>
            <CheckCircle2 className="w-5 h-5 text-emerald-600" />
          </div>

          <div className="p-3.5 rounded-xl bg-rose-50/70 border border-rose-200/80 flex items-center justify-between">
            <div>
              <p className="text-[11px] font-semibold text-rose-900">High Impact Tickets</p>
              <p className="text-xl font-bold text-rose-950 tabular-nums">{counts.highImpact}</p>
            </div>
            <AlertTriangle className="w-5 h-5 text-rose-600" />
          </div>
        </div>
      </div>

      {/* 2. Sub-tab Navigation */}
      <div className="flex items-center space-x-1 p-1 bg-slate-100 rounded-xl border border-slate-200 text-xs max-w-fit">
        <button
          type="button"
          onClick={() => {
            setActiveTab('PENDING');
            setStatusFilter('REQUESTED');
          }}
          className={`px-4 py-1.5 rounded-lg font-semibold transition-all ${
            activeTab === 'PENDING'
              ? 'bg-white text-primary shadow-xs'
              : 'text-slate-600 hover:text-slate-900'
          }`}
        >
          Pending Correction Tickets ({counts.pending})
        </button>
        <button
          type="button"
          onClick={() => {
            setActiveTab('AUDIT_LEDGER');
            setStatusFilter('ALL');
          }}
          className={`px-4 py-1.5 rounded-lg font-semibold transition-all ${
            activeTab === 'AUDIT_LEDGER'
              ? 'bg-white text-primary shadow-xs'
              : 'text-slate-600 hover:text-slate-900'
          }`}
        >
          All Requests & Audit Ledger
        </button>
      </div>

      {/* 3. Notifications / Errors */}
      {actionSuccessMsg && (
        <div className="p-3.5 bg-emerald-50 border border-emerald-200 rounded-xl text-emerald-800 text-xs font-semibold flex items-center space-x-2 animate-in fade-in">
          <CheckCircle2 className="w-4 h-4 text-emerald-600 shrink-0" />
          <span>{actionSuccessMsg}</span>
        </div>
      )}

      {error && (
        <div className="p-3.5 bg-rose-50 border border-rose-200 rounded-xl text-rose-800 text-xs font-semibold flex items-center space-x-2 animate-in fade-in">
          <AlertTriangle className="w-4 h-4 text-rose-600 shrink-0" />
          <span>{error}</span>
        </div>
      )}

      {/* 4. Filter Bar */}
      <div className="flex flex-col sm:flex-row items-stretch sm:items-center justify-between gap-3 p-3 bg-white border border-slate-200 rounded-xl text-xs">
        <div className="flex items-center space-x-2 flex-1">
          <Search className="w-4 h-4 text-slate-400 shrink-0" />
          <input
            type="text"
            placeholder="Search by Correlation ID, record #, requester, or reason…"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="w-full bg-transparent font-medium text-slate-800 focus:outline-hidden"
          />
        </div>

        <div className="flex items-center space-x-2 shrink-0">
          <div className="flex items-center space-x-1.5">
            <Filter className="w-3.5 h-3.5 text-slate-500" />
            <span className="font-semibold text-slate-700">Module:</span>
          </div>
          <select
            value={moduleFilter}
            onChange={(e) => setModuleFilter(e.target.value)}
            className="p-1.5 rounded-lg border border-slate-300 bg-white font-medium text-slate-800 focus:outline-hidden"
          >
            <option value="ALL">All modules</option>
            <option value="ZMCC_LAB_SESSION">ZMCC lab sessions</option>
            <option value="MOT_SHOP_COLLECTION">Shop collections</option>
            <option value="VEHICLE_VISIT">Vehicle visits</option>
            <option value="ZMCC_MOT_ARRIVAL">MOT Arrivals</option>
            <option value="ZMCC_LOCAL_SUPPLIER_ARRIVAL">Supplier arrivals</option>
          </select>
        </div>
      </div>

      {/* 5. Request Cards List */}
      {loading ? (
        <div className="p-12 text-center text-xs text-slate-400 font-semibold tabular-nums">
          Loading correction requests…
        </div>
      ) : filteredRequests.length === 0 ? (
        <div className="p-12 text-center bg-white border border-slate-200 rounded-2xl space-y-2">
          <FileCheck2 className="w-10 h-10 text-slate-300 mx-auto" />
          <h3 className="font-semibold text-slate-800 text-sm">No Correction Requests Found</h3>
          <p className="text-slate-500 text-xs">
            {activeTab === 'PENDING'
              ? 'All field entries are verified. There are no pending correction tickets waiting for your approval.'
              : 'No correction requests match your active search filters.'}
          </p>
        </div>
      ) : (
        <div className="space-y-4">
          {filteredRequests.map((req) => {
            const isPending = req.status === 'REQUESTED';
            const isApplied = req.status === 'APPLIED';
            const isRejected = req.status === 'REJECTED';

            return (
              <div
                key={req.id}
                className="bg-white border border-slate-200 rounded-2xl shadow-xs p-5 space-y-4 hover:border-slate-300 transition-all text-xs"
              >
                {/* Header Row */}
                <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 pb-3 border-b border-slate-100">
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

                  <div className="flex items-center space-x-3 text-slate-500 text-[11px]">
                    <span>
                      Requested by <strong className="text-slate-800">{req.requestedBy.name}</strong> (@{req.requestedBy.username})
                    </span>
                    <span>·</span>
                    <span className="tabular-nums">
                      {new Date(req.requestedAt).toLocaleString()}
                    </span>
                  </div>
                </div>

                {/* Diff & Changes Grid */}
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  {/* Left Column: Requested Changes */}
                  <div className="p-3.5 rounded-xl bg-slate-50 border border-slate-200/80 space-y-2">
                    <p className="font-semibold text-slate-700 text-[11px] uppercase tracking-wider">
                      Proposed Modifications
                    </p>
                    <div className="space-y-1.5 font-medium">
                      {Object.entries(req.requestedChanges).map(([k, v]) => (
                        <div key={k} className="flex items-center justify-between p-2 rounded-lg bg-white border border-slate-200">
                          <span className="font-semibold text-slate-700">{k}:</span>
                          <span className="font-bold text-blue-700 tabular-nums">{String(v)}</span>
                        </div>
                      ))}
                    </div>
                  </div>

                  {/* Right Column: Requester Rationale */}
                  <div className="p-3.5 rounded-xl bg-slate-50 border border-slate-200/80 space-y-2">
                    <p className="font-semibold text-slate-700 text-[11px] uppercase tracking-wider">
                      Substantive Reason & Evidence
                    </p>
                    <p className="p-2 rounded-lg bg-white border border-slate-200 text-slate-800 leading-relaxed font-medium">
                      &ldquo;{req.reason}&rdquo;
                    </p>
                    {req.reviewedBy && (
                      <div className="text-[11px] text-slate-500 pt-1">
                        Reviewed by <strong className="text-slate-800">{req.reviewedBy.name}</strong>
                        {req.reviewedAt && ` on ${new Date(req.reviewedAt).toLocaleDateString()}`}
                        {req.reviewReason && ` · Note: "${req.reviewReason}"`}
                      </div>
                    )}
                  </div>
                </div>

                {/* Footer & Action Buttons */}
                <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 pt-2">
                  <div className="flex items-center space-x-2">
                    <span className="font-semibold text-slate-600">Status:</span>
                    <span
                      className={`px-2.5 py-0.5 rounded-md font-bold text-[10px] ${
                        isPending
                          ? 'bg-amber-100 text-amber-800'
                          : isApplied
                          ? 'bg-emerald-100 text-emerald-800'
                          : 'bg-rose-100 text-rose-800'
                      }`}
                    >
                      {req.status}
                    </span>
                  </div>

                  {isPending && (
                    <div className="flex items-center space-x-2">
                      <button
                        type="button"
                        disabled={processingId === req.id}
                        onClick={() => {
                          setRejectionModalId(req.id);
                          setRejectionReason('');
                        }}
                        className="px-3.5 py-1.5 rounded-xl border border-rose-300 text-rose-700 font-semibold hover:bg-rose-50 transition-colors disabled:opacity-50"
                      >
                        Reject
                      </button>

                      <button
                        type="button"
                        disabled={processingId === req.id}
                        onClick={() => handleApply(req.id)}
                        className="px-4 py-1.5 rounded-xl bg-blue-600 hover:bg-blue-700 text-white font-semibold shadow-xs transition-colors disabled:opacity-50 flex items-center space-x-1.5"
                      >
                        {processingId === req.id ? (
                          <span>Executing…</span>
                        ) : (
                          <>
                            <CheckCircle2 className="w-3.5 h-3.5" />
                            <span>1-Click Approve & Apply</span>
                          </>
                        )}
                      </button>
                    </div>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* Rejection Prompt Modal */}
      {rejectionModalId && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-xs p-4 animate-in fade-in">
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
              <button
                type="button"
                onClick={() => setRejectionModalId(null)}
                className="px-3.5 py-1.5 rounded-xl border border-slate-300 text-slate-700 font-semibold hover:bg-slate-100"
              >
                Cancel
              </button>
              <button
                type="button"
                disabled={rejectionReason.trim().length < 3 || processingId === rejectionModalId}
                onClick={() => handleReject(rejectionModalId)}
                className="px-4 py-1.5 rounded-xl bg-rose-600 hover:bg-rose-700 text-white font-semibold disabled:opacity-50"
              >
                Confirm Rejection
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
