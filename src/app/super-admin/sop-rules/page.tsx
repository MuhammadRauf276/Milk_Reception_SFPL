'use client';

import React, { useEffect, useState } from 'react';
import { BookOpen, ShieldAlert, AlertCircle } from 'lucide-react';

interface Rule {
  id: string;
  testCode: string;
  testName: string;
  resultType: string;
  unit: string | null;
  version: number;
  ruleCategory: string;
  minValue: number | null;
  maxValue: number | null;
  acceptableOption: string | null;
  warningTrigger: string | null;
  decisionConsequence: string | null;
  isActive: boolean;
  effectiveFrom: string;
  effectiveTo: string | null;
}

export default function SuperAdminSopRulesPage() {
  const [rules, setRules] = useState<Rule[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    async function loadRules() {
      try {
        const res = await fetch('/api/super-admin/sop-rules');
        const data = await res.json();
        if (res.ok) setRules(data.rules || []);
        else setError(data.error);
      } catch (err: any) {
        setError(err.message);
      } finally {
        setLoading(false);
      }
    }

    loadRules();
  }, []);

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-xl font-black text-[#111311]">SOP Laboratory Rules & Thresholds</h1>
        <p className="text-xs font-medium text-slate-500 mt-1">
          Versioned SOP rule foundation (RELEASE vs MONITORING). SOP rules strictly require approved company document configuration.
        </p>
      </div>

      {error && (
        <div className="p-4 bg-rose-50 border border-rose-200 rounded-xl text-rose-800 text-xs font-bold flex items-center space-x-2">
          <ShieldAlert className="w-4 h-4 text-rose-600 shrink-0" />
          <span>{error}</span>
        </div>
      )}

      <div className="p-4 bg-blue-50 border border-blue-200 rounded-xl text-blue-900 text-xs font-bold flex items-center space-x-2">
        <AlertCircle className="w-4 h-4 text-blue-700 shrink-0" />
        <span>
          BUSINESS RULE PROTECTION: Monitoring rules do NOT perform automatic vehicle rejection or hold. Active release decision remains chemist-authoritative.
        </span>
      </div>

      {/* SOP RULES TABLE */}
      <div className="bg-white rounded-xl border border-[#EAE4D5]/80 shadow-sm overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-left text-xs">
            <thead className="bg-[#FDFBF9] text-slate-600 border-b border-[#EAE4D5]">
              <tr>
                <th className="p-3 font-bold">Lab Test</th>
                <th className="p-3 font-bold">Category</th>
                <th className="p-3 font-bold">Version</th>
                <th className="p-3 font-bold">Numeric Range</th>
                <th className="p-3 font-bold">Acceptable Option</th>
                <th className="p-3 font-bold">Consequence</th>
                <th className="p-3 font-bold">Status</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-[#EAE4D5]/60 font-medium">
              {loading ? (
                <tr>
                  <td colSpan={7} className="p-6 text-center text-slate-400 font-mono">
                    Loading versioned SOP rules...
                  </td>
                </tr>
              ) : rules.length === 0 ? (
                <tr>
                  <td colSpan={7} className="p-6 text-center text-slate-400 font-mono">
                    No active SOP rules configured yet. (BUSINESS RULE REQUIRED)
                  </td>
                </tr>
              ) : (
                rules.map((r) => (
                  <tr key={r.id} className="hover:bg-slate-50">
                    <td className="p-3">
                      <div className="font-bold text-[#111311]">{r.testName}</div>
                      <div className="font-mono text-[10px] text-slate-500">{r.testCode}</div>
                    </td>
                    <td className="p-3">
                      <span className={`px-2 py-0.5 rounded font-mono text-[10px] font-bold ${
                        r.ruleCategory === 'RELEASE' ? 'bg-emerald-100 text-emerald-900' : 'bg-blue-100 text-blue-900'
                      }`}>
                        {r.ruleCategory}
                      </span>
                    </td>
                    <td className="p-3 font-mono font-bold text-slate-700">v{r.version}</td>
                    <td className="p-3 font-mono text-slate-700">
                      {r.minValue !== null || r.maxValue !== null ? (
                        `${r.minValue ?? '-'} to ${r.maxValue ?? '-'} ${r.unit || ''}`
                      ) : (
                        '-'
                      )}
                    </td>
                    <td className="p-3 font-mono text-slate-700">{r.acceptableOption || '-'}</td>
                    <td className="p-3 font-mono text-slate-700">{r.decisionConsequence || '-'}</td>
                    <td className="p-3">
                      {r.isActive ? (
                        <span className="px-2 py-0.5 rounded bg-emerald-100 text-emerald-800 text-[10px] font-bold">
                          Active
                        </span>
                      ) : (
                        <span className="px-2 py-0.5 rounded bg-rose-100 text-rose-800 text-[10px] font-bold">
                          Inactive
                        </span>
                      )}
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
