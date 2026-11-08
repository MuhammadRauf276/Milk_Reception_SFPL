'use client';

import { CheckCircle2, Camera, ChevronRight, FileText, MapPin, Maximize2, ShieldAlert } from 'lucide-react';
import type { UnifiedApprovalItem } from '@/backend/services/approvals/approvalInboxService';
import { getRoleLabel } from '@/backend/core/roles/labels';
import { InfoTip } from '@/components/ui/info-tip';
import { TableWrapper } from '@/components/ui/table-wrapper';
import { cn } from '@/lib/utils';
import { formatDateTime } from '@/lib/format';

export function ApprovalDetailBody({
  item,
  onPreviewPhoto,
}: {
  item: UnifiedApprovalItem;
  onPreviewPhoto: (url: string) => void;
}) {
  const failedTests = item.details.testValues?.filter((t) => t.outcome === 'FAIL' || t.pass === false) ?? [];

  return (
    <div className="p-4 sm:p-6 space-y-6 flex-1">
      {/* 1. Immediate Actionable Summary (High Prominence) */}
      <div className="space-y-3">
        <h3 className="text-xs font-semibold text-muted-foreground">
          Exception Summary
        </h3>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          {failedTests.length ? (
            failedTests.map((t, idx) => (
              <div
                key={idx}
                className="bg-card border-border p-3.5 rounded-2xl border text-rose-950 flex flex-col justify-between"
              >
                <div className="flex items-center justify-between">
                  <span className="font-semibold text-xs">
                    {t.name} ({t.code})
                  </span>
                  <span className="px-2 py-0.5 rounded text-xs font-semibold bg-rose-700 text-white">
                    Out of Range
                  </span>
                </div>
                <div className="mt-2 flex items-baseline gap-2">
                  <span className="text-xl sm:text-2xl font-semibold text-rose-700">
                    {t.value !== null && t.value !== undefined ? String(t.value) : 'N/A'}
                  </span>
                  {((t.min !== undefined && t.min !== null) || (t.max !== undefined && t.max !== null)) && (
                    <span className="text-xs text-rose-800">
                      (Required: {t.min !== undefined && t.min !== null ? `Min ${t.min}` : ''}{' '}
                      {t.max !== undefined && t.max !== null ? `Max ${t.max}` : ''})
                    </span>
                  )}
                </div>
              </div>
            ))
          ) : (
            <div className="bg-card border-border p-3.5 rounded-2xl border text-emerald-950 flex items-center gap-2">
              <CheckCircle2 className="w-5 h-5 text-emerald-600 shrink-0" />
              <div>
                <p className="text-xs font-semibold">All Test Values In Range</p>
              </div>
            </div>
          )}

          {/* Seal Verification Status (Stage 4) */}
          {item.details.sealNumber && (
            <div
              className={cn(
                'p-3.5 rounded-2xl border flex flex-col justify-between',
                item.details.sealMatch === false
                  ? 'border-rose-300 bg-rose-50 text-rose-950'
                  : 'border-emerald-300 bg-emerald-50 text-emerald-950'
              )}
            >
              <div className="flex items-center justify-between">
                <span className="font-semibold text-xs">Security Seal Verification</span>
                <span
                  className={cn(
                    'px-2 py-0.5 rounded text-xs font-semibold text-white',
                    item.details.sealMatch === false ? 'bg-rose-700' : 'bg-emerald-700'
                  )}
                >
                  {item.details.sealMatch === false ? 'Mismatch' : 'Verified'}
                </span>
              </div>
              <div className="mt-2 text-xs">
                <p>
                  Dispatch Seal: <strong>{item.details.sealNumber}</strong>
                </p>
                {item.details.plantSealNumberEntered && (
                  <p>
                    Entered at Plant: <strong>{item.details.plantSealNumberEntered}</strong>
                  </p>
                )}
              </div>
            </div>
          )}

          {/* Operator Initial Decision Card */}
          <div className="bg-card border-border p-3.5 rounded-2xl border flex flex-col justify-between">
            <div className="flex items-center justify-between">
              <span className="font-semibold text-xs text-secondary-foreground">Operator Stated Verdict</span>
              <span
                className={cn(
                  'px-2 py-0.5 rounded text-xs font-semibold',
                  item.details.personDecision === 'REJECT'
                    ? 'bg-rose-100 text-rose-800 border border-rose-300'
                    : 'bg-emerald-100 text-emerald-800 border border-emerald-300'
                )}
              >
                {item.details.personDecision === 'REJECT' ? 'Rejected by Operator' : 'Accepted by Operator'}
              </span>
            </div>
            {item.details.personRemarks && item.details.personRemarks.trim().split(/\s+/).length > 4 ? (
              <div className="mt-1 flex items-center gap-1 text-xs text-secondary-foreground">
                <span>Remarks</span>
                <InfoTip text={item.details.personRemarks} />
              </div>
            ) : (
              <p className="mt-2 text-xs text-secondary-foreground ">{item.details.personRemarks || 'No remarks'}</p>
            )}
          </div>

        </div>
      </div>

      {/* 2. Captured Proof Photos (Live Camera Evidence) */}
      {item.details.photos && item.details.photos.length > 0 && (
        <div className="space-y-3">
          <h3 className="text-xs font-semibold text-muted-foreground flex items-center gap-1.5">
            <Camera className="w-3.5 h-3.5" />
            <span>Live Camera Evidence ({item.details.photos.length})</span>
          </h3>

          <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-3">
            {item.details.photos.map((photo, pIdx) => (
              <div
                key={pIdx}
                className="group relative rounded-xl border border-border bg-muted overflow-hidden aspect-4/3 flex flex-col justify-end p-2 cursor-pointer shadow-2xs hover:shadow-xs transition"
                onClick={() => photo.url && onPreviewPhoto(photo.url)}
              >
                {photo.url ? (
                  /* eslint-disable-next-line @next/next/no-img-element */
                  <img
                    src={photo.url}
                    alt="Captured evidence"
                    loading="lazy"
                    className="absolute inset-0 w-full h-full object-cover group-hover:scale-105 transition"
                  />
                ) : (
                  <div className="absolute inset-0 flex items-center justify-center text-muted-foreground">
                    <Camera className="w-8 h-8 opacity-40" />
                  </div>
                )}
                <div className="relative z-10 bg-slate-900/80 backdrop-blur-xs text-white p-1 rounded text-xs flex items-center justify-between">
                  <span className="break-words min-w-0">{photo.testCode || photo.label || 'Test Proof'}</span>
                  <Maximize2 className="w-3 h-3 shrink-0 ml-1 opacity-70 group-hover:opacity-100" />
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* 3. Progressive Disclosure Container: Calculation, Policy & Audit Details */}
      <details className="group border border-border rounded-xl bg-card overflow-hidden text-xs">
        <summary className="min-h-11 p-3.5 font-semibold text-secondary-foreground flex items-center justify-between cursor-pointer select-none hover:bg-muted/70 transition">
          <span className="flex items-center gap-2">
            <FileText className="w-4 h-4 text-muted-foreground" />
            <span>Details</span>
          </span>
          <ChevronRight className="w-4 h-4 text-muted-foreground transition group-open:rotate-90" />
        </summary>

        <div className="p-4 border-t border-border bg-white space-y-4">
          {item.details.testValues && item.details.testValues.length > 0 && (
            <div>
              <h4 className="font-semibold text-secondary-foreground mb-2">Complete Laboratory Results</h4>
              <TableWrapper className="border border-border rounded-lg">
                <table className="w-full text-left border-collapse text-xs">
                  <thead className="bg-subtle text-secondary-foreground font-semibold border-b border-border">
                    <tr>
                      <th className="p-2">Test Name</th>
                      <th className="p-2">Observed Value</th>
                      <th className="p-2">Rule Bounds</th>
                      <th className="p-2 text-right">Result</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-border">
                    {item.details.testValues.map((t, tIdx) => (
                      <tr key={tIdx} className={t.outcome === 'FAIL' || t.pass === false ? 'bg-rose-50/50' : ''}>
                        <td className="p-2 font-medium">
                          {t.name} ({t.code})
                        </td>
                        <td className="p-2 font-semibold">{t.value !== null && t.value !== undefined ? String(t.value) : '—'}</td>
                        <td className="p-2 text-muted-foreground">
                          {t.min !== undefined && t.min !== null ? `Min: ${t.min} ` : ''}
                          {t.max !== undefined && t.max !== null ? `Max: ${t.max}` : ''}
                          {!t.min && !t.max ? 'Monitoring' : ''}
                        </td>
                        <td className="p-2 text-right">
                          <span
                            className={cn(
                              'px-2 py-0.5 rounded text-xs font-semibold',
                              t.outcome === 'FAIL' || t.pass === false
                                ? 'bg-rose-100 text-rose-800'
                                : 'bg-emerald-100 text-emerald-800'
                            )}
                          >
                            {t.outcome === 'FAIL' || t.pass === false ? 'FAIL' : 'PASS'}
                          </span>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </TableWrapper>
            </div>
          )}

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 text-xs text-secondary-foreground">
            <div className="bg-card border-border p-3 rounded-lg border space-y-1">
              <p className="font-semibold text-foreground">Audit & Attribution</p>
              <p>
                Submitter User ID: <code className="text-xs font-mono">{item.submittedBy.id}</code>
              </p>
              <p>
                Real Role: <strong>{getRoleLabel(item.submittedBy.role)}</strong>
              </p>
              {item.submittedBy.performedAsRole && (
                <p>
                  Performed As Role: <strong>{getRoleLabel(item.submittedBy.performedAsRole)}</strong>
                </p>
              )}
              <p>
                Delegated Action: <strong>{item.submittedBy.isDelegated ? 'Yes' : 'No'}</strong>
              </p>
            </div>

            {item.details.formulaAudit?.gpsCoordinates && (
              <div className="bg-card border-border p-3 rounded-lg border space-y-1">
                <p className="font-semibold text-foreground flex items-center gap-1">
                  <MapPin className="w-3.5 h-3.5 text-muted-foreground" />
                  <span>GPS Geofence Capture</span>
                </p>
                <p>
                  Latitude: <strong>{item.details.formulaAudit.gpsCoordinates.latitude.toFixed(6)}</strong>
                </p>
                <p>
                  Longitude: <strong>{item.details.formulaAudit.gpsCoordinates.longitude.toFixed(6)}</strong>
                </p>
                {item.details.formulaAudit.gpsCoordinates.accuracy && (
                  <p>Accuracy: ±{item.details.formulaAudit.gpsCoordinates.accuracy}m</p>
                )}
              </div>
            )}
          </div>
        </div>
      </details>

      {/* 4. Self-Approval Guard Banner (Segregation of Duties) */}
      {!item.canDecide && (
        <div className="bg-card border-border p-4 rounded-2xl border text-amber-950 flex items-start gap-3">
          <ShieldAlert className="w-5 h-5 text-amber-600 shrink-0 mt-0.5" />
          <div className="space-y-1 text-xs">
            <p className="font-semibold text-sm">Segregation of Duties Enforcement</p>
            <p>
              {item.disabledReason ||
                'You do not have administrative authority to decide this item or submitted it yourself.'}
            </p>
          </div>
        </div>
      )}

      {/* 5. Decided Audit Stamp (if decided) */}
      {item.decision && (
        <div className="bg-card border-border p-4 rounded-2xl border space-y-1 text-xs">
          <p className="font-semibold text-foreground">Decision Recorded by {item.decision.decidedBy}</p>
          <p className="text-secondary-foreground">
            Verdict: <strong>{item.decision.verdict === 'OKAY' ? 'Approved' : 'Rejected'}</strong> · Decided at{' '}
            {formatDateTime(item.decision.decidedAt)}
          </p>
          {item.decision.remarks &&
            (item.decision.remarks.trim().split(/\s+/).length > 4 ? (
              <div className="flex items-center gap-1 text-secondary-foreground">
                <span>Remarks</span>
                <InfoTip text={item.decision.remarks} />
              </div>
            ) : (
              <p className="text-secondary-foreground mt-1">{item.decision.remarks}</p>
            ))}
        </div>
      )}
    </div>
  );
}
