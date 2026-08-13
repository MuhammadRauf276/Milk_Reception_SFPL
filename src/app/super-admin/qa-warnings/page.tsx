'use client';

import React, { useEffect, useState } from 'react';
import { AlertTriangle, ShieldAlert, CheckCircle2 } from 'lucide-react';

interface WarningItem {
  id: string;
  procurementSourceId: string;
  procurementSource: {
    code: string;
    name: string;
    sourceType: string;
  };
  visitId: string | null;
  portionId: string | null;
  labTest: { code: string; name: string } | null;
  reason: string;
  status: string;
  createdAt: string;
  createdBy: string;
  acknowledgedBy: string | null;
}

interface MonthlySummaryItem {
  sourceId: string;
  sourceCode: string;
  sourceName: string;
  sourceType: string;
  activeWarningCount: number;
}

export default function SuperAdminQaWarningsPage() {
  const [warnings, setWarnings] = useState<WarningItem[]>([]);
  const [summary, setSummary] = useState<MonthlySummaryItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    async function loadWarnings() {
      try {
        const res = await fetch('/api/super-admin/qa-warnings');
        const data = await res.json();
        if (res.ok) {
          setWarnings(data.warnings || []);
          setSummary(data.monthlySummary || []);
        } else {
          setError(data.error);
        }
      } catch (err: any) {
        setError(err.message);
      } finally {
        setLoading(false);
      }
    }

    loadWarnings();
  }, []);

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-xl font-black text-[#111311]">QA Warnings & Supplier Escalation Foundation</h1>
        <p className="text-xs font-medium text-slate-500 mt-1">
          Individual immutable warning events linked to Procurement Sources. Monthly warning counts are derived dynamically.
        </p>
      </div>

      {error && (
        <div className="p-4 bg-rose-50 border border-rose-200 rounded-xl text-rose-800 text-xs font-bold flex items-center space-x-2">
          <ShieldAlert className="w-4 h-4 text-rose-600 shrink-0" />
          <span>{error}</span>
        </div>
      )}

      {/* MONTHLY SUMMARY PER SOURCE */}
      <div className="bg-white p-5 rounded-xl border border-[#EAE4D5]/80 shadow-sm space-y-3">
        <h2 className="text-sm font-extrabold text-[#111311]">Derived Monthly Active Warnings per Supplier</h2>
        <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-3 text-xs">
          {summary.map((s) => (
            <div key={s.sourceId} className="p-3 rounded-lg bg-slate-50 border border-slate-200 flex justify-between items-center">
              <div>
                <div className="font-bold text-[#111311]">{s.sourceName}</div>
                <div className="font-mono text-[10px] text-slate-500">{s.sourceCode} ({s.sourceType})</div>
              </div>
              <div className="font-mono text-sm font-black px-2.5 py-1 rounded bg-amber-100 text-amber-900">
                {s.activeWarningCount} Warnings
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* WARNING EVENT RECORDS TABLE */}
      <div className="bg-white rounded-xl border border-[#EAE4D5]/80 shadow-sm overflow-hidden space-y-2 p-4">
        <h2 className="text-sm font-extrabold text-[#111311] flex items-center space-x-2">
          <AlertTriangle className="w-4 h-4 text-amber-600" />
          <span>Individual Immutable Warning Log</span>
        </h2>

        <div className="overflow-x-auto">
          <table className="w-full text-left text-xs">
            <thead className="bg-[#FDFBF9] text-slate-600 border-b border-[#EAE4D5]">
              <tr>
                <th className="p-3 font-bold">Timestamp</th>
                <th className="p-3 font-bold">Procurement Source</th>
                <th className="p-3 font-bold">Lab Test</th>
                <th className="p-3 font-bold">Reason</th>
                <th className="p-3 font-bold">Created By</th>
                <th className="p-3 font-bold">Status</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-[#EAE4D5]/60 font-medium">
              {loading ? (
                <tr>
                  <td colSpan={6} className="p-6 text-center text-slate-400 font-mono">
                    Loading warning events...
                  </td>
                </tr>
              ) : warnings.length === 0 ? (
                <tr>
                  <td colSpan={6} className="p-8 text-center text-slate-400 font-medium">
                    <CheckCircle2 className="w-8 h-8 text-emerald-500 mx-auto mb-2" />
                    No active supplier warnings recorded. (Clean State)
                  </td>
                </tr>
              ) : (
                warnings.map((w) => (
                  <tr key={w.id} className="hover:bg-slate-50">
                    <td className="p-3 font-mono text-[11px] text-slate-500">
                      {new Date(w.createdAt).toLocaleString()}
                    </td>
                    <td className="p-3">
                      <div className="font-bold text-[#111311]">{w.procurementSource.name}</div>
                      <div className="font-mono text-[10px] text-slate-500">{w.procurementSource.code}</div>
                    </td>
                    <td className="p-3 font-mono text-slate-700">{w.labTest?.name || '-'}</td>
                    <td className="p-3 text-slate-800">{w.reason}</td>
                    <td className="p-3 text-slate-600">{w.createdBy}</td>
                    <td className="p-3">
                      <span className="px-2 py-0.5 rounded bg-amber-100 text-amber-900 font-mono text-[10px] font-bold">
                        {w.status}
                      </span>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
