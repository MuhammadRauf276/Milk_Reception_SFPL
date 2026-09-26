'use client';

import { useEffect, useState, useCallback } from 'react';
import { AlertTriangle, CheckCircle2, Loader2, X } from 'lucide-react';

type Report = {
  summary: {
    finalizedJourneys: number;
    unresolvedJourneys: number;
    grossLossLiters: number;
    grossGainLiters: number;
    at13tsLossLiters: number;
    at13tsGainLiters: number;
    unresolvedOriginAt13tsLiters: number;
  };
  items: Array<{
    journeyId: string;
    journeyNumber: string;
    source: { code: string };
    route: { code: string };
    vehicleNumber: string;
    originAt13tsLiters: number;
    destinationAt13tsLiters: number | null;
    isResolved: boolean;
    at13ts: { loss: number; gain: number; lossPercent: number | null } | null;
  }>;
};

type Target = {
  active: {
    targetPercent: number;
    effectiveFrom: string;
    reason: string;
  } | null;
};

interface PendingSupplier {
  id: string;
  local_supplier_code: string;
  name: string;
  phone: string | null;
  erp_reference: string | null;
  erp_mapping_status: string;
}

const quantity = (value: number) => value.toLocaleString(undefined, { maximumFractionDigits: 2 });

export function FinanceReconciliationWorkspace() {
  const [report, setReport] = useState<Report | null>(null);
  const [target, setTarget] = useState<Target | null>(null);
  const [error, setError] = useState<string | null>(null);

  // Non-blocking ERP hold management
  const [pendingSuppliers, setPendingSuppliers] = useState<PendingSupplier[]>([]);
  const [showMappingModal, setShowMappingModal] = useState<boolean>(false);
  const [selectedSupplier, setSelectedSupplier] = useState<PendingSupplier | null>(null);
  const [erpInput, setErpInput] = useState<string>('');
  const [mappingSubmitting, setMappingSubmitting] = useState<boolean>(false);
  const [mappingError, setMappingError] = useState<string | null>(null);
  const [mappingSuccess, setMappingSuccess] = useState<string | null>(null);

  const loadPendingSuppliers = useCallback(async () => {
    try {
      const res = await fetch('/api/zmcc/local-suppliers?erp_mapping_status=PENDING');
      if (res.ok) {
        const data = await res.json();
        setPendingSuppliers(data.suppliers || []);
      }
    } catch {
      // Non-blocking background fetch
    }
  }, []);

  useEffect(() => {
    Promise.all([
      fetch('/api/management/zmcc-reconciliation?pageSize=25'),
      fetch('/api/super-admin/finance-loss-targets'),
    ])
      .then(async ([reportResponse, targetResponse]) => {
        const [reportBody, targetBody] = await Promise.all([
          reportResponse.json(),
          targetResponse.json(),
        ]);
        if (!reportResponse.ok) throw new Error(reportBody.error || 'Unable to load reconciliation.');
        if (!targetResponse.ok) throw new Error(targetBody.error || 'Unable to load loss target.');
        setReport(reportBody);
        setTarget(targetBody);
      })
      .catch((cause) => setError(cause instanceof Error ? cause.message : 'Unable to load Finance reconciliation.'));

    loadPendingSuppliers();
  }, [loadPendingSuppliers]);

  const handleMapErp = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedSupplier) return;
    const cleanRef = erpInput.trim();
    if (!cleanRef) {
      setMappingError('Official ERP vendor reference is required.');
      return;
    }

    setMappingSubmitting(true);
    setMappingError(null);
    setMappingSuccess(null);

    try {
      const res = await fetch(`/api/zmcc/local-suppliers/${selectedSupplier.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ erp_reference: cleanRef }),
      });
      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.error || 'Failed to update ERP reference.');
      }

      setMappingSuccess(`Successfully mapped ${selectedSupplier.name} (${selectedSupplier.local_supplier_code}) to ERP Code ${cleanRef}. Hold released.`);
      setPendingSuppliers((prev) => prev.filter((s) => s.id !== selectedSupplier.id));
      setSelectedSupplier(null);
      setErpInput('');
      setTimeout(() => setMappingSuccess(null), 4000);
    } catch (err: unknown) {
      setMappingError(err instanceof Error ? err.message : 'Failed to map ERP reference.');
    } finally {
      setMappingSubmitting(false);
    }
  };

  if (error) {
    return <div className="rounded-xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-900">{error}</div>;
  }
  if (!report || !target) {
    return <div className="rounded-xl border bg-white p-4 text-sm text-slate-500">Loading Finance reconciliation...</div>;
  }

  const s = report.summary;
  const base = s.at13tsLossLiters + s.at13tsGainLiters;
  const lossPercent = base > 0 ? (s.at13tsLossLiters / base) * 100 : null;
  const isWithinTarget = lossPercent !== null && target.active ? lossPercent <= target.active.targetPercent : null;

  return (
    <section className="space-y-4">
      <div>
        <h1 className="text-xl font-black text-slate-900">Finance MPD reconciliation</h1>
        <p className="text-sm text-slate-500">
          Finalized MTD quantities only. Unresolved exposure is separate and needs verification before it can affect final loss.
        </p>
      </div>

      {/* Amber Hold Alert for Entities Pending ERP Mapping */}
      {pendingSuppliers.length > 0 && (
        <div className="rounded-xl border border-amber-300 bg-amber-50 p-4 text-amber-900 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3 shadow-xs">
          <div className="flex items-center space-x-3">
            <div className="p-2 bg-amber-100 rounded-lg text-amber-700">
              <AlertTriangle className="w-5 h-5 shrink-0" />
            </div>
            <div>
              <p className="text-sm font-black">
                Payment on hold: {pendingSuppliers.length} {pendingSuppliers.length === 1 ? 'entity' : 'entities'} pending ERP code mapping
              </p>
              <p className="text-xs text-amber-700 font-medium mt-0.5">
                Non-blocking milk intake permitted. Map official ERP vendor code to release disbursement hold.
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={() => {
              setMappingError(null);
              setMappingSuccess(null);
              setSelectedSupplier(null);
              setErpInput('');
              setShowMappingModal(true);
            }}
            className="px-4 py-2 bg-amber-600 hover:bg-amber-700 text-white text-xs font-black rounded-lg transition shadow-xs shrink-0"
          >
            Review & Map ERP Codes
          </button>
        </div>
      )}

      {/* KPI Cards */}
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <div className="rounded-xl border bg-white p-4">
          <p className="text-xs font-bold text-slate-500">Active 13TS target</p>
          <p className="mt-1 text-xl font-black">{target.active ? `${target.active.targetPercent}%` : 'Not configured'}</p>
          <p className="mt-1 text-xs text-slate-500">
            {target.active ? `Effective ${new Date(target.active.effectiveFrom).toLocaleDateString()}` : 'Super Admin must activate a target.'}
          </p>
        </div>
        <div className="rounded-xl border bg-white p-4">
          <p className="text-xs font-bold text-slate-500">Observed 13TS loss</p>
          <p className="mt-1 text-xl font-black">{lossPercent === null ? 'No finalized base' : `${lossPercent.toFixed(2)}%`}</p>
          <p className="mt-1 text-xs text-slate-500">
            {isWithinTarget === null ? 'Target comparison unavailable' : isWithinTarget ? 'Within active target' : 'Above active target'}
          </p>
        </div>
        <div className="rounded-xl border bg-white p-4">
          <p className="text-xs font-bold text-slate-500">13TS loss / gain</p>
          <p className="mt-1 text-xl font-black">
            {quantity(s.at13tsLossLiters)} / {quantity(s.at13tsGainLiters)} L
          </p>
        </div>
        <div className="rounded-xl border bg-white p-4">
          <p className="text-xs font-bold text-slate-500">Gross loss / gain</p>
          <p className="mt-1 text-xl font-black">
            {quantity(s.grossLossLiters)} / {quantity(s.grossGainLiters)} L
          </p>
        </div>
      </div>

      {/* Verification Queue */}
      <div className="rounded-xl border bg-white p-4">
        <p className="font-black text-slate-900">Verification queue</p>
        <p className="mt-1 text-sm text-slate-600">
          {s.unresolvedJourneys} unresolved journeys · {quantity(s.unresolvedOriginAt13tsLiters)} L at 13TS awaiting final ZMCC result.
        </p>
        <div className="mt-3 overflow-x-auto">
          <table className="w-full text-left text-xs">
            <thead className="text-slate-500">
              <tr>
                <th className="pb-2">Source</th>
                <th className="pb-2">Route</th>
                <th className="pb-2">Journey</th>
                <th className="pb-2">Vehicle</th>
                <th className="pb-2">13TS variance</th>
                <th className="pb-2">Status</th>
              </tr>
            </thead>
            <tbody>
              {report.items.map((row) => (
                <tr key={row.journeyId} className="border-t">
                  <td className="py-2">{row.source.code}</td>
                  <td className="py-2">{row.route.code}</td>
                  <td className="py-2">{row.journeyNumber}</td>
                  <td className="py-2">{row.vehicleNumber}</td>
                  <td className="py-2">
                    {row.at13ts ? `${quantity(row.at13ts.loss)} L loss / ${quantity(row.at13ts.gain)} L gain` : '—'}
                  </td>
                  <td className="py-2">{row.isResolved ? 'Finalized' : 'Unresolved'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {/* 1-Click ERP Mapping Modal */}
      {showMappingModal && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/60 backdrop-blur-xs"
          role="dialog"
          aria-modal="true"
        >
          <div className="bg-white rounded-2xl border border-slate-200 shadow-2xl max-w-2xl w-full p-6 space-y-4 max-h-[90vh] overflow-y-auto">
            <div className="flex items-center justify-between pb-3 border-b border-slate-200">
              <div className="flex items-center space-x-2">
                <AlertTriangle className="w-5 h-5 text-amber-600" />
                <h2 className="text-base font-black text-slate-900">
                  Release Financial Hold — ERP Vendor Mapping
                </h2>
              </div>
              <button
                type="button"
                onClick={() => setShowMappingModal(false)}
                className="p-1.5 rounded-lg border border-slate-200 text-slate-500 hover:bg-slate-100"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            {mappingSuccess && (
              <div className="p-3 bg-emerald-50 border border-emerald-200 rounded-xl text-xs font-bold text-emerald-800 flex items-center gap-2">
                <CheckCircle2 className="w-4 h-4 shrink-0 text-emerald-600" />
                <span>{mappingSuccess}</span>
              </div>
            )}

            {mappingError && (
              <div className="p-3 bg-rose-50 border border-rose-200 rounded-xl text-xs font-bold text-rose-800 flex items-center gap-2">
                <AlertTriangle className="w-4 h-4 shrink-0 text-rose-600" />
                <span>{mappingError}</span>
              </div>
            )}

            {selectedSupplier ? (
              <form onSubmit={handleMapErp} className="space-y-4 p-4 bg-slate-50 rounded-xl border border-slate-200">
                <div className="flex items-center justify-between">
                  <h3 className="text-xs font-black uppercase text-slate-700">
                    Assign ERP Code for: {selectedSupplier.name} ({selectedSupplier.local_supplier_code})
                  </h3>
                  <button
                    type="button"
                    onClick={() => {
                      setSelectedSupplier(null);
                      setErpInput('');
                    }}
                    className="text-xs text-slate-500 underline font-bold hover:text-slate-800"
                  >
                    Back to list
                  </button>
                </div>

                <div>
                  <label className="block text-xs font-black uppercase text-slate-600 mb-1">
                    Official ERP Vendor Reference *
                  </label>
                  <input
                    type="text"
                    required
                    maxLength={100}
                    value={erpInput}
                    onChange={(e) => setErpInput(e.target.value)}
                    placeholder="e.g. 00045231"
                    className="w-full px-3 py-2 border border-slate-300 rounded-xl text-xs font-mono font-bold focus:ring-2 focus:ring-[#1E3A8A]"
                  />
                  <p className="text-[11px] text-slate-500 font-medium mt-1">
                    Enter the assigned ERP vendor account number. Leading zeros will be preserved. Submitting will update mapping status to MAPPED and release payment hold.
                  </p>
                </div>

                <div className="flex justify-end space-x-2 pt-2">
                  <button
                    type="button"
                    onClick={() => {
                      setSelectedSupplier(null);
                      setErpInput('');
                    }}
                    className="px-4 py-2 text-xs font-bold text-slate-600 hover:bg-slate-200 rounded-xl transition"
                  >
                    Cancel
                  </button>
                  <button
                    type="submit"
                    disabled={mappingSubmitting}
                    className="flex items-center space-x-1.5 px-4 py-2 bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-black rounded-xl transition shadow-xs"
                  >
                    {mappingSubmitting && <Loader2 className="w-3.5 h-3.5 animate-spin" />}
                    <span>Save & Release Hold</span>
                  </button>
                </div>
              </form>
            ) : (
              <div className="space-y-3">
                <p className="text-xs text-slate-600 font-medium">
                  The following entities have performed milk deliveries under temporary intake status. Assign their official ERP master vendor codes to release payment disbursement:
                </p>

                {pendingSuppliers.length === 0 ? (
                  <div className="py-8 text-center text-slate-400 font-bold text-xs">
                    No entities are currently pending ERP mapping. All holds are clear!
                  </div>
                ) : (
                  <div className="overflow-x-auto border border-slate-200 rounded-xl">
                    <table className="w-full text-left text-xs">
                      <thead className="bg-slate-50 text-slate-600 font-bold border-b border-slate-200">
                        <tr>
                          <th className="py-2.5 px-3">Supplier Code</th>
                          <th className="py-2.5 px-3">Name</th>
                          <th className="py-2.5 px-3">Phone</th>
                          <th className="py-2.5 px-3">Candidate Ref</th>
                          <th className="py-2.5 px-3 text-right">Action</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-slate-100">
                        {pendingSuppliers.map((sup) => (
                          <tr key={sup.id} className="hover:bg-slate-50/70">
                            <td className="py-2 px-3 font-mono font-bold text-[#1E3A8A]">{sup.local_supplier_code}</td>
                            <td className="py-2 px-3 font-bold text-slate-800">{sup.name}</td>
                            <td className="py-2 px-3 font-mono text-slate-600">{sup.phone || '—'}</td>
                            <td className="py-2 px-3 font-mono text-amber-700">{sup.erp_reference || '—'}</td>
                            <td className="py-2 px-3 text-right">
                              <button
                                type="button"
                                onClick={() => {
                                  setSelectedSupplier(sup);
                                  setErpInput(sup.erp_reference || '');
                                  setMappingError(null);
                                  setMappingSuccess(null);
                                }}
                                className="px-3 py-1 bg-[#1E3A8A] hover:bg-blue-900 text-white rounded-lg text-xs font-black transition shadow-2xs"
                              >
                                1-Click Map
                              </button>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </div>
            )}

            <div className="flex justify-end pt-3 border-t border-slate-200">
              <button
                type="button"
                onClick={() => setShowMappingModal(false)}
                className="px-4 py-2 border border-slate-300 text-slate-700 hover:bg-slate-100 rounded-xl text-xs font-extrabold transition"
              >
                Close
              </button>
            </div>
          </div>
        </div>
      )}
    </section>
  );
}
