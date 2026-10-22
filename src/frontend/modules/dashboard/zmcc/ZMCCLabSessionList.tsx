'use client';

import React, { useEffect, useState } from 'react';
import { AlertTriangle, ShieldCheck } from 'lucide-react';
import { formatOperationalDatetime } from '@/lib/datetime-utils';
import { Pager, pageCount, paginate } from '../components/Pager';
import type { ZmccLabSessionItem } from './zmccQualityTypes';

/** Paginated list of ZMCC lab sessions with their manager-review state. */
export const ZMCCLabSessionList: React.FC<{
  sessions: ZmccLabSessionItem[];
  onReview: (session: ZmccLabSessionItem) => void;
}> = ({ sessions, onReview }) => {
  const [page, setPage] = useState(1);
  const totalPages = pageCount(sessions.length);
  const currentPage = Math.min(page, totalPages);

  // Back to the first page whenever the filtered result set changes.
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setPage(1);
  }, [sessions]);

  return (
    <div className="space-y-4">
      {paginate(sessions, currentPage).map((session) => {
        const isRejected = session.decision === 'REJECTED';
        const isAccepted = session.decision === 'ACCEPTED';
        const hasExited = !!(session.mot_arrival?.exit_timestamp || session.local_supplier_arrival?.exit_timestamp);
        const exitTimestamp = session.mot_arrival?.exit_timestamp || session.local_supplier_arrival?.exit_timestamp;
        const vehicleNumber =
          session.mot_arrival?.journey?.mot_vehicle?.vehicle_number ||
          session.local_supplier_arrival?.vehicle_number ||
          '—';
        const tokenNumber =
          session.mot_arrival?.zmcc_token ||
          session.local_supplier_arrival?.zmcc_token ||
          '—';
        const arrivalSource =
          session.arrival_type === 'MOT'
            ? `Route: ${session.mot_arrival?.journey?.route?.name || 'MC'}`
            : `Supplier: ${session.local_supplier_arrival?.local_supplier?.name || 'HC'}${session.tank_receipt?.milk_source_name_snapshot ? ` · Source: ${session.tank_receipt.milk_source_name_snapshot}` : ''}`;

        const canReview =
          session.status === 'COMPLETED' &&
          (session.decision === 'REJECTED' ||
            session.manager_review_status === 'PENDING' ||
            session.manager_review_status === 'REVIEWED_EXITED');

        return (
          <div
            key={session.id}
            className={`p-4 rounded-xl bg-card border shadow-2xs space-y-3 transition-all ${
              isRejected
                ? 'border-rose-300 bg-rose-50/20'
                : session.manager_review_status === 'APPROVED'
                ? 'border-emerald-300 bg-emerald-50/20'
                : 'border-border/80 hover:border-primary/40'
            }`}
          >
            {/* Header row */}
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 pb-2.5 border-b border-border/60">
              <div className="flex items-center space-x-2.5 flex-wrap gap-y-1">
                <span className="text-base font-semibold tabular-nums text-foreground tracking-tight">
                  {vehicleNumber}
                </span>
                <span className="px-2 py-0.5 rounded text-xs font-semibold uppercase tracking-wider bg-slate-900 text-white">
                  {session.arrival_type === 'MOT' ? 'MC' : 'HC'}
                </span>
                <span className="px-2 py-0.5 rounded text-xs tabular-nums font-semibold bg-slate-100 text-slate-700 border border-slate-200">
                  Token: {tokenNumber}
                </span>
                <span className="text-xs font-medium text-slate-600">{arrivalSource}</span>
                {session.gross_liters != null && (
                  <span className="text-xs tabular-nums font-semibold text-slate-800">
                    {session.gross_liters.toLocaleString()} L
                  </span>
                )}
              </div>

              <div className="flex items-center gap-2">
                {canReview && (
                  <button
                    type="button"
                    onClick={() => onReview(session)}
                    className="flex min-h-11 items-center space-x-1 px-3 py-1 rounded-lg bg-primary text-white text-xs font-semibold hover:bg-primary/90 shadow-2xs transition-all"
                  >
                    <ShieldCheck className="w-3.5 h-3.5" />
                    <span>
                      {session.manager_review_status === 'REVIEWED_EXITED'
                        ? 'Re-Review Exited'
                        : session.decision === 'REJECTED'
                        ? 'Review Rejection'
                        : 'Review Exception'}
                    </span>
                  </button>
                )}
              </div>
            </div>

            {/* Status Badges Row */}
            <div className="flex items-center gap-2 flex-wrap text-xs">
              <span
                className={`px-2 py-0.5 rounded text-xs font-semibold uppercase tracking-wider ${
                  session.system_quality_outcome === 'IN_SPEC'
                    ? 'bg-emerald-100 text-emerald-800'
                    : session.system_quality_outcome === 'OUT_OF_SPEC'
                    ? 'bg-rose-100 text-rose-800'
                    : session.system_quality_outcome === 'RULE_CONFIGURATION_ERROR'
                    ? 'bg-rose-200 text-rose-900 border border-rose-400'
                    : 'bg-slate-100 text-slate-700'
                }`}
              >
                System: {session.system_quality_outcome === 'OUT_OF_SPEC' ? 'FAIL' : session.system_quality_outcome === 'IN_SPEC' ? 'PASS' : session.system_quality_outcome || 'EVALUATED'}
              </span>

              <span
                className={`px-2 py-0.5 rounded text-xs font-semibold uppercase tracking-wider ${
                  isAccepted
                    ? 'bg-emerald-100 text-emerald-800'
                    : isRejected
                    ? 'bg-rose-100 text-rose-800'
                    : 'bg-amber-100 text-amber-800'
                }`}
              >
                Decision: {session.decision}
              </span>

              {session.manager_review_status && session.manager_review_status !== 'NONE' && (
                <span
                  className={`px-2 py-0.5 rounded text-xs font-semibold uppercase tracking-wider ${
                    session.manager_review_status === 'APPROVED'
                      ? 'bg-emerald-200 text-emerald-900'
                      : session.manager_review_status === 'REVIEWED_EXITED'
                      ? 'bg-slate-100 text-slate-800 border border-slate-300'
                      : session.manager_review_status === 'REJECTED'
                      ? 'bg-rose-200 text-rose-900'
                      : 'bg-amber-200 text-amber-900'
                  }`}
                >
                  Manager: {session.manager_review_status}
                </span>
              )}

              {hasExited ? (
                <span className="px-2 py-0.5 rounded text-xs font-semibold bg-amber-100 text-amber-900 border border-amber-300">
                  Vehicle Exited: {formatOperationalDatetime(exitTimestamp!)}
                </span>
              ) : (
                <span className="px-2 py-0.5 rounded text-xs font-semibold bg-blue-100 text-blue-800">
                  Vehicle On-Site
                </span>
              )}

              {session.tank_receipt ? (
                <span className="px-2 py-0.5 rounded text-xs font-semibold bg-emerald-50 text-emerald-700 border border-emerald-200">
                  In Tank: {session.tank_receipt.tank?.tank_code || 'Received'} ({session.tank_receipt.gross_liters} L)
                </span>
              ) : (
                <span className="px-2 py-0.5 rounded text-xs font-semibold bg-slate-100 text-slate-600">
                  No Tank Receipt
                </span>
              )}
            </div>

            {/* Rejection / Review Reasons */}
            {session.rejection_reason && (
              <div className="p-2.5 rounded-lg text-xs font-semibold flex items-start gap-2 bg-rose-100/70 border border-rose-200 text-rose-900">
                <AlertTriangle className="w-3.5 h-3.5 shrink-0 mt-0.5 text-rose-700" />
                <div>
                  <span className="font-semibold uppercase text-xs block">Rejection Reason:</span>
                  <span>{session.rejection_reason}</span>
                </div>
              </div>
            )}

            {session.manager_review_reason && (
              <div className="p-2.5 rounded-lg text-xs font-semibold flex items-start gap-2 bg-slate-50 border border-slate-200 text-slate-800">
                <ShieldCheck className="w-3.5 h-3.5 shrink-0 mt-0.5 text-slate-700" />
                <div>
                  <span className="font-semibold uppercase text-xs block">
                    Manager Review Justification ({session.manager_review_status}):
                  </span>
                  <span>{session.manager_review_reason}</span>
                </div>
              </div>
            )}

            {/* Observed Results & Rule Version Table (collapsible) */}
            {session.results && session.results.length > 0 && (
              <details className="group rounded-lg border border-border/80 overflow-hidden" open={isRejected}>
                <summary className="min-h-11 flex cursor-pointer select-none items-center px-3 text-xs font-semibold text-slate-700 hover:bg-subtle">
                  Observed results ({session.results.length})
                </summary>
                <div className="overflow-x-auto border-t border-border/80">
                  <table className="w-full text-left text-xs tabular-nums">
                    <thead className="bg-slate-50 text-xs font-sans font-semibold uppercase tracking-wider text-slate-600 border-b border-border/80">
                      <tr>
                        <th className="py-1.5 px-3">Test</th>
                        <th className="py-1.5 px-3">Observed Value</th>
                        <th className="py-1.5 px-3">Evaluation Status</th>
                        <th className="py-1.5 px-3 font-sans">Applied SOP Rule</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-border/40 text-xs">
                      {session.results.map((r) => {
                        const valStr =
                          r.numeric_value !== null
                            ? `${r.numeric_value}${r.unit_snapshot ? ' ' + r.unit_snapshot : ''}`
                            : r.text_value || '—';
                        const isPass = r.is_passed === true;
                        const isFail = r.is_passed === false;

                        return (
                          <tr key={r.id} className="hover:bg-subtle transition-colors">
                            <td className="py-1.5 px-3 font-sans font-semibold text-slate-800">
                              {r.test_name_snapshot} ({r.test_code_snapshot})
                            </td>
                            <td className="py-1.5 px-3 font-semibold text-slate-900">{valStr}</td>
                            <td className="py-1.5 px-3">
                              <span
                                className={`px-2 py-0.5 rounded text-xs font-semibold ${
                                  isPass
                                    ? 'bg-emerald-100 text-emerald-800'
                                    : isFail
                                    ? 'bg-rose-100 text-rose-800'
                                    : r.evaluation_status === 'WARNING'
                                    ? 'bg-amber-100 text-amber-800'
                                    : 'bg-slate-100 text-slate-600'
                                }`}
                              >
                                {r.evaluation_status}
                              </span>
                            </td>
                            <td className="py-1.5 px-3 font-sans text-slate-600 text-[11px]">
                              {r.applied_rule_version ? `Rule v${r.applied_rule_version}` : 'Default SOP'}
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              </details>
            )}
          </div>
        );
      })}
      <Pager page={currentPage} totalPages={totalPages} total={sessions.length} onPageChange={setPage} />
    </div>
  );
};
