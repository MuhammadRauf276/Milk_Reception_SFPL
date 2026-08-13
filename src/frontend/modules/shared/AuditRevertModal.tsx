'use client';

import React, { useState, useEffect, useCallback } from 'react';
import { History, X, RotateCcw, ShieldAlert, CheckCircle2, UserCheck } from 'lucide-react';
import { MilkProcessLog, DataAuditLog, User } from '@core/types';

interface AuditRevertModalProps {
  isOpen: boolean;
  onClose: () => void;
  log: MilkProcessLog | null;
  currentUser: User | null;
  onRollbackComplete: () => Promise<void>;
}

export const AuditRevertModal: React.FC<AuditRevertModalProps> = ({
  isOpen,
  onClose,
  log,
  currentUser,
  onRollbackComplete
}) => {
  const [auditLogs, setAuditLogs] = useState<DataAuditLog[]>([]);
  const [loading, setLoading] = useState(false);
  const [revertingId, setRevertingId] = useState<number | null>(null);
  const [msg, setMsg] = useState<string | null>(null);

  const fetchAuditTrail = useCallback(async () => {
    if (!log) return;
    setLoading(true);
    try {
      const res = await fetch(`/api/logs/${log.id}/audit`);
      const data = await res.json();
      if (data.auditLogs) {
        setAuditLogs(data.auditLogs);
      }
    } catch (_err) {
      // Handled
    } finally {
      setLoading(false);
    }
  }, [log]);

  useEffect(() => {
    if (isOpen && log) {
      fetchAuditTrail();
    }
  }, [isOpen, log, fetchAuditTrail]);

  if (!isOpen || !log) return null;

  const handleRollback = async (auditEntry: DataAuditLog) => {
    setRevertingId(auditEntry.id);
    setMsg(null);

    try {
      const res = await fetch(`/api/logs/${log.id}/audit`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ audit_log_id: auditEntry.id }),
      });

      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.error || 'Failed to rollback field');
      }

      setMsg(`Successfully rolled back column '${auditEntry.column_name}' to '${auditEntry.original_value || 'null'}'.`);
      await fetchAuditTrail();
      await onRollbackComplete();
    } catch (err: unknown) {
      setMsg(err instanceof Error ? err.message : 'Rollback failed');
    } finally {
      setRevertingId(null);
    }
  };

  const isAdminOrMgmt = currentUser?.role === 'Admin' || currentUser?.role === 'Management';

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/60 backdrop-blur-sm">
      <div className="relative w-full max-w-2xl bg-white text-[#0F172A] rounded-2xl shadow-2xl border border-[#E2E8F0] overflow-hidden max-h-[90vh] flex flex-col">
        <div className="flex items-center justify-between px-6 py-4 border-b border-[#E2E8F0] bg-[#F8FAFC]">
          <div className="flex items-center space-x-3">
            <div className="p-2.5 bg-[#1E3A8A] text-white rounded-xl shadow-sm">
              <History className="w-5 h-5" />
            </div>
            <div>
              <h3 className="text-base font-extrabold tracking-tight text-[#0F172A]">
                Audit Trail & Revert System - Vehicle {log.vehicle_number}
              </h3>
              <p className="text-xs text-[#334155] font-semibold">
                Log #{log.id} | Chronological Data Entry History
              </p>
            </div>
          </div>
          <button onClick={onClose} className="p-1.5 rounded-lg text-slate-400 hover:text-[#0F172A] hover:bg-slate-100">
            <X className="w-5 h-5" />
          </button>
        </div>

        <div className="p-6 overflow-y-auto space-y-4">
          {msg && (
            <div className="p-3 text-xs font-bold rounded-xl bg-amber-50 border border-amber-200 text-[#B45309] flex items-center gap-2">
              <CheckCircle2 className="w-4 h-4 text-[#B45309] shrink-0" />
              <span>{msg}</span>
            </div>
          )}

          {!isAdminOrMgmt && (
            <div className="p-3 text-xs font-semibold rounded-xl bg-slate-100 text-slate-700 flex items-center gap-2">
              <ShieldAlert className="w-4 h-4 text-slate-500 shrink-0" />
              <span>You are viewing the Audit Trail in Read-Only mode. Only Administrators or Management can perform rollbacks.</span>
            </div>
          )}

          {loading ? (
            <div className="p-8 text-center text-xs font-bold text-slate-400">Loading audit history...</div>
          ) : auditLogs.length === 0 ? (
            <div className="p-8 text-center border border-dashed border-[#E2E8F0] rounded-xl text-xs font-medium text-slate-400">
              No audit logs recorded for this vehicle log yet.
            </div>
          ) : (
            <div className="space-y-3">
              {auditLogs.map((entry) => (
                <div
                  key={`audit-revert-entry-${String(entry.id)}`}
                  className="p-4 rounded-xl bg-[#F8FAFC] border border-[#E2E8F0] shadow-sm flex flex-col sm:flex-row sm:items-center justify-between gap-3"
                >
                  <div className="space-y-1">
                    <div className="flex items-center space-x-2">
                      <span className="px-2 py-0.5 rounded text-[9.5px] font-extrabold uppercase font-mono bg-[#0F172A] text-white">
                        {entry.action_type}
                      </span>
                      <span className="text-xs font-extrabold text-[#0F172A] font-mono">
                        {entry.column_name}
                      </span>
                      <span className="text-[10px] text-slate-400 font-semibold">
                        {new Date(entry.timestamp).toLocaleString()}
                      </span>
                    </div>

                    <div className="text-xs space-y-0.5 pt-1">
                      <div className="flex items-center gap-2">
                        <span className="text-slate-500 font-semibold">Modified by:</span>
                        <span className="font-extrabold text-[#0F172A] flex items-center gap-1">
                          <UserCheck className="w-3.5 h-3.5 text-[#1E40AF]" />
                          {entry.modified_by_user} ({entry.role})
                        </span>
                      </div>
                      <div className="grid grid-cols-2 gap-2 pt-1 font-mono text-[11px]">
                        <div className="p-2 rounded-lg bg-white border border-[#E2E8F0]">
                          <span className="text-[9px] text-slate-400 font-semibold block">Previous Value</span>
                          <span className="font-bold text-rose-700 truncate block">
                            {entry.original_value ?? 'null'}
                          </span>
                        </div>
                        <div className="p-2 rounded-lg bg-white border border-[#E2E8F0]">
                          <span className="text-[9px] text-slate-400 font-semibold block">Updated Value</span>
                          <span className="font-bold text-emerald-700 truncate block">
                            {entry.new_value ?? 'null'}
                          </span>
                        </div>
                      </div>
                    </div>
                  </div>

                  {isAdminOrMgmt && (
                    <div className="sm:self-center shrink-0">
                      <button
                        onClick={() => handleRollback(entry)}
                        disabled={revertingId === entry.id}
                        className="flex items-center space-x-1.5 px-3.5 py-2 rounded-xl bg-[#1E3A8A] hover:bg-blue-900 text-white font-extrabold text-xs shadow-sm border border-indigo-950 transition disabled:opacity-50"
                      >
                        <RotateCcw className={`w-3.5 h-3.5 ${revertingId === entry.id ? 'animate-spin' : ''}`} />
                        <span>{revertingId === entry.id ? 'Rolling back...' : 'Rollback to Original'}</span>
                      </button>
                    </div>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>

        <div className="flex items-center justify-between px-6 py-3 border-t border-[#E2E8F0] bg-[#F8FAFC] text-xs font-bold text-[#334155]">
          <span>Audit Log Records: {auditLogs.length}</span>
          <button
            onClick={onClose}
            className="px-4 py-2 rounded-xl bg-[#0F172A] text-white font-extrabold hover:bg-slate-800 transition"
          >
            Close
          </button>
        </div>
      </div>
    </div>
  );
};
