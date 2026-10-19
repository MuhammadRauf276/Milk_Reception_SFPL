'use client';

import React, { useEffect, useState } from 'react';
import { AlertTriangle, ShieldAlert, CheckCircle2 } from 'lucide-react';
import { getErrorMessage } from '@/lib/errors';

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
      } catch (err) {
        setError(getErrorMessage(err));
      } finally {
        setLoading(false);
      }
    }

    loadWarnings();
  }, []);

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-xl font-semibold text-foreground">QA Warnings & Supplier Escalation Foundation</h1>
      </div>

      {error && (
        <div className="p-4 bg-rose-50 border border-rose-200 rounded-xl text-rose-800 text-xs font-semibold flex items-center space-x-2 animate-panel-in">
          <ShieldAlert className="w-4 h-4 text-rose-600 shrink-0" />
          <span>{error}</span>
        </div>
      )}

      {/* MONTHLY SUMMARY PER SOURCE */}
      <div className="bg-white p-5 rounded-xl border border-border/80 shadow-xs space-y-3">
        <h2 className="text-sm font-semibold text-foreground">Derived Monthly Active Warnings per Supplier</h2>
        <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-3 text-xs">
          {summary.map((s) => (
            <div key={s.sourceId} className="p-3 rounded-lg bg-slate-50 border border-slate-200 flex justify-between items-center">
              <div>
                <div className="font-semibold text-foreground">{s.sourceName}</div>
                <div className="tabular-nums text-[10px] text-slate-500">{s.sourceCode} ({s.sourceType})</div>
              </div>
              <div className="tabular-nums text-sm font-semibold px-2.5 py-1 rounded bg-amber-100 text-amber-900">
                {s.activeWarningCount} Warnings
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* WARNING EVENT RECORDS TABLE */}
      <div className="bg-white rounded-xl border border-border/80 shadow-xs overflow-hidden space-y-2 p-4">
        <h2 className="text-sm font-semibold text-foreground flex items-center space-x-2">
          <AlertTriangle className="w-4 h-4 text-amber-600" />
          <span>Warning log</span>
        </h2>

        <div className="overflow-x-auto">
          <table className="w-full text-left text-xs">
            <thead className="bg-subtle text-slate-600 border-b border-border">
              <tr>
                <th className="p-3 font-semibold">Timestamp</th>
                <th className="p-3 font-semibold">Procurement Source</th>
                <th className="p-3 font-semibold">Lab Test</th>
                <th className="p-3 font-semibold">Reason</th>
                <th className="p-3 font-semibold">Created By</th>
                <th className="p-3 font-semibold">Status</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border/60 font-medium">
              {loading ? (
                <tr>
                  <td colSpan={6} className="p-6 text-center text-slate-400 tabular-nums">
                    Loading warning events…
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
                    <td className="p-3 tabular-nums text-[11px] text-slate-500">
                      {new Date(w.createdAt).toLocaleString()}
                    </td>
                    <td className="p-3">
                      <div className="font-semibold text-foreground">{w.procurementSource.name}</div>
                      <div className="tabular-nums text-[10px] text-slate-500">{w.procurementSource.code}</div>
                    </td>
                    <td className="p-3 tabular-nums text-slate-700">{w.labTest?.name || '-'}</td>
                    <td className="p-3 text-slate-800">{w.reason}</td>
                    <td className="p-3 text-slate-600">{w.createdBy}</td>
                    <td className="p-3">
                      <span className="px-2 py-0.5 rounded bg-amber-100 text-amber-900 tabular-nums text-[10px] font-semibold">
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
