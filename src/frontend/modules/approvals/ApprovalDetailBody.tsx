'use client';

import { AlertTriangle, CheckCircle2, Camera, ChevronRight, FileText, MapPin, Maximize2, ShieldAlert } from 'lucide-react';
import type { TestValueSnapshot, UnifiedApprovalItem } from '@/backend/services/approvals/approvalInboxService';
import { getRoleLabel } from '@/backend/core/roles/labels';
import { InfoTip } from '@/components/ui/info-tip';
import { TableWrapper } from '@/components/ui/table-wrapper';
import { cn } from '@/lib/utils';
import { formatDateTime, formatLabel } from '@/lib/format';

function hasObservedValue(t: TestValueSnapshot): boolean {
  if (t.value === null || t.value === undefined) return false;
  const s = String(t.value).trim();
  const upper = s.toUpperCase();
  return s !== '' && s !== '—' && s !== '-' && upper !== 'NOT_TESTED' && upper !== 'NOT_PERFORMED';
}

export function ApprovalDetailBody({
  item,
  onPreviewPhoto,
}: {
  item: UnifiedApprovalItem;
  onPreviewPhoto: (url: string) => void;
}) {
  const testValues = item.details.testValues ?? [];
  const failedTests = testValues.filter((t) => hasObservedValue(t) && (t.outcome === 'FAIL' || t.pass === false));
  const warnTests = testValues.filter((t) => hasObservedValue(t) && t.outcome === 'WARN' && t.pass !== false);
  const notDoneTests = testValues.filter(
    (t) => !hasObservedValue(t) || t.outcome === 'NOT_TESTED' || t.outcome === 'NOT_PERFORMED'
  );
  const passedTests = testValues.filter(
    (t) =>
      hasObservedValue(t) &&
      t.outcome !== 'FAIL' &&
      t.pass !== false &&
      t.outcome !== 'WARN' &&
      t.outcome !== 'NOT_TESTED' &&
      t.outcome !== 'NOT_PERFORMED'
  );
  const hasMissingTestChip = (item.reasonChips ?? []).some((c) => /test not done|missing/i.test(c));
  const hasMissingPhotoChip = (item.reasonChips ?? []).some((c) => /picture missing|photo/i.test(c));
  const hasSealMismatch = false;
  const hasExceptionChip = (item.reasonChips ?? []).length > 0 || (item.details.reasons?.length ?? 0) > 0;

  return (
    <div className="p-4 sm:p-6 space-y-6 flex-1">
      {/* 1. Immediate Actionable Summary (High Prominence) */}
      <div className="space-y-3">
        <h3 className="text-xs font-semibold text-muted-foreground">
          Why it was sent
        </h3>

        <div className="flex flex-wrap items-center gap-2 rounded-2xl border border-rose-300 bg-rose-50 p-3">
          <ShieldAlert className="size-4 shrink-0 text-rose-700" aria-hidden />
          {item.reasonChips.map((chip) => (
            <span key={chip} className="rounded-md border border-rose-200 bg-card px-2 py-0.5 text-xs font-semibold text-rose-800">
              {chip}
            </span>
          ))}
          {item.details.reasons && item.details.reasons.length > 0 && (
            <InfoTip label="Why it was sent" text={<ul className="list-disc space-y-1 pl-4">{item.details.reasons.map((r) => <li key={r}>{r}</li>)}</ul>} />
          )}
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          {failedTests.length > 0 ? (
            failedTests.map((t, idx) => (
              <div
                key={idx}
                className="bg-card border-border p-4 rounded-2xl border text-rose-950 flex flex-col justify-between"
              >
                <div className="flex items-center justify-between">
                  <span className="font-semibold text-xs">
                    {t.name}
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
          ) : notDoneTests.length > 0 || hasMissingTestChip || hasMissingPhotoChip || warnTests.length > 0 || testValues.length === 0 || hasSealMismatch ? (
            <div className="border-amber-200 bg-amber-50/60 p-4 rounded-2xl border text-amber-950 flex items-start gap-2.5">
              <AlertTriangle className="w-5 h-5 text-amber-600 shrink-0 mt-0.5" />
              <div className="space-y-1">
                <p className="text-xs font-semibold">
                  {testValues.length > 0 && notDoneTests.length > 0
                    ? `${passedTests.length} of ${testValues.length} test(s) recorded (${notDoneTests.length} not written)`
                    : hasSealMismatch
                      ? 'Dispatch seal mismatch reported'
                      : warnTests.length > 0
                        ? `${warnTests.length} test(s) in warning zone`
                        : hasMissingPhotoChip
                          ? 'Compulsory test picture missing'
                          : 'Compulsory test or photo incomplete'}
                </p>
                {hasMissingPhotoChip && (
                  <p className="text-xs text-rose-800 font-medium">Compulsory test picture is missing.</p>
                )}
                {passedTests.length > 0 && notDoneTests.length > 0 && (
                  <p className="text-xs text-amber-900">
                    Recorded test(s) are within range, but other tests were not written.
                  </p>
                )}
                {warnTests.length > 0 && (
                  <p className="text-xs text-amber-900">{warnTests.length} test(s) in warning tolerance require review.</p>
                )}
              </div>
            </div>
          ) : (
            <div className="bg-card border-border p-4 rounded-2xl border text-emerald-950 flex items-center gap-2">
              <CheckCircle2 className="w-5 h-5 text-emerald-600 shrink-0" />
              <div>
                <p className="text-xs font-semibold">All tests within SOP limits</p>
              </div>
            </div>
          )}

          {/* Seal Verification Status (Informational — Optional at all stages) */}
          {(item.details.sealNumber || item.details.plantSealNumberEntered) && (
            <div
              className={cn(
                'p-4 rounded-2xl border flex flex-col justify-between',
                item.details.sealMatch === true
                  ? 'border-emerald-300 bg-emerald-50 text-emerald-950'
                  : 'border-border bg-card text-foreground'
              )}
            >
              <div className="flex items-center justify-between">
                <span className="font-semibold text-xs">Seal check (optional)</span>
                <span
                  className={cn(
                    'px-2 py-0.5 rounded text-xs font-semibold',
                    item.details.sealMatch === true
                      ? 'bg-emerald-700 text-white'
                      : 'bg-muted text-secondary-foreground border border-border'
                  )}
                >
                  {item.details.sealMatch === true
                    ? 'Verified'
                    : item.details.sealMatch === false
                      ? 'Differs (optional)'
                      : 'Recorded'}
                </span>
              </div>
              <div className="mt-2 text-xs">
                {item.details.sealNumber && (
                  <p>
                    Dispatch Seal: <strong>{item.details.sealNumber}</strong>
                  </p>
                )}
                {item.details.plantSealNumberEntered && (
                  <p>
                    Entered at Plant: <strong>{item.details.plantSealNumberEntered}</strong>
                  </p>
                )}
              </div>
            </div>
          )}

          {/* Operator Initial Decision Card */}
          <div className="bg-card border-border p-4 rounded-2xl border flex flex-col justify-between gap-2">
            <div className="flex items-center justify-between gap-2">
              <div>
                <span className="font-semibold text-xs text-secondary-foreground block">Operator verdict</span>
                <span className="text-xs text-muted-foreground">
                  {failedTests.length > 0
                    ? 'Contradicts System Failure'
                    : hasSealMismatch
                      ? 'Seal Mismatch Detected'
                      : hasMissingTestChip || hasMissingPhotoChip || notDoneTests.length > 0
                        ? 'Incomplete Tests / Missing Photo'
                        : warnTests.length > 0 || hasExceptionChip
                          ? 'Requires Manager Exception Review'
                          : 'Within Acceptance Limits'}
                </span>
              </div>
              <span
                className={cn(
                  'px-2 py-0.5 rounded text-xs font-semibold shrink-0',
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
              <p className="mt-1 text-xs text-secondary-foreground">{item.details.personRemarks || 'No remarks'}</p>
            )}
          </div>

        </div>
      </div>

      {/* 2. Captured Proof Photos (Live Camera Evidence) */}
      {item.details.photos && item.details.photos.length > 0 && (
        <div className="space-y-3">
          <h3 className="text-xs font-semibold text-muted-foreground flex items-center gap-2">
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
                <div className="relative z-10 bg-neutral-900/80 backdrop-blur-xs text-white p-1 rounded text-xs flex items-center justify-between">
                  <span className="break-words min-w-0">{photo.label || (photo.testCode ? formatLabel(photo.testCode) : 'Test Proof')}</span>
                  <Maximize2 className="w-3 h-3 shrink-0 ml-1 opacity-70 group-hover:opacity-100" />
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* 3. Progressive Disclosure Container: Calculation, Policy & Audit Details */}
      <details className="group border border-border rounded-xl bg-card overflow-hidden text-xs">
        <summary className="min-h-11 p-4 font-semibold text-secondary-foreground flex items-center justify-between cursor-pointer select-none hover:bg-muted/70 transition">
          <span className="flex items-center gap-2">
            <FileText className="w-4 h-4 text-muted-foreground" />
            <span>Details</span>
          </span>
          <ChevronRight className="w-4 h-4 text-muted-foreground transition group-open:rotate-90" />
        </summary>

        <div className="p-4 border-t border-border bg-card space-y-4">
          {item.details.testValues && item.details.testValues.length > 0 && (
            <div>
              <h4 className="font-semibold text-secondary-foreground mb-2">Lab results</h4>
              <TableWrapper className="border border-border rounded-lg">
                <table className="w-full text-left border-collapse text-xs">
                  <thead className="bg-subtle text-secondary-foreground font-semibold border-b border-border">
                    <tr>
                      <th className="p-2">Test</th>
                      <th className="p-2">Value</th>
                      <th className="p-2">Limits</th>
                      <th className="p-2 text-right">Result</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-border">
                    {item.details.testValues.map((t, tIdx) => {
                      const hasVal = hasObservedValue(t);
                      const isNotDone = !hasVal || t.outcome === 'NOT_TESTED' || t.outcome === 'NOT_PERFORMED';
                      const isFail = !isNotDone && (t.outcome === 'FAIL' || t.pass === false);
                      const isWarn = !isNotDone && !isFail && t.outcome === 'WARN';
                      const missingReqPhoto = t.photoMode === 'REQUIRED' && !t.hasPhoto;
                      const boundsText =
                        t.min !== undefined && t.min !== null || t.max !== undefined && t.max !== null
                          ? `${t.min !== undefined && t.min !== null ? `Min: ${t.min} ` : ''}${t.max !== undefined && t.max !== null ? `Max: ${t.max}` : ''}`.trim()
                          : Array.isArray(t.allowed) && t.allowed.length > 0
                            ? t.allowed.join(' / ')
                            : t.ruleMode === 'APPLY'
                              ? 'SOP Rule'
                              : 'Monitoring';
                      return (
                        <tr key={tIdx} className={isFail ? 'bg-rose-50/50' : missingReqPhoto ? 'bg-amber-50/40' : ''}>
                          <td className="p-2 font-medium">
                            <div className="flex flex-wrap items-center gap-1.5">
                              <span>
                                {t.name}
                              </span>
                              {missingReqPhoto && (
                                <span className="rounded border border-rose-200 bg-rose-50 px-1.5 py-0.5 text-xs font-semibold text-rose-700">
                                  Picture missing
                                </span>
                              )}
                            </div>
                          </td>
                          <td className="p-2 font-semibold">
                            {hasVal ? `${t.value}${t.unit ? ` ${t.unit}` : ''}` : '—'}
                          </td>
                          <td className="p-2 text-muted-foreground">{boundsText}</td>
                          <td className="p-2 text-right">
                            <span
                              className={cn(
                                'px-2 py-0.5 rounded text-xs font-semibold',
                                isNotDone
                                  ? t.testMode === 'COMPULSORY'
                                    ? 'bg-amber-100 text-amber-800 border border-amber-200'
                                    : 'bg-muted text-muted-foreground border border-border'
                                  : isFail
                                    ? 'bg-rose-100 text-rose-800 border border-rose-200'
                                    : isWarn
                                      ? 'bg-amber-100 text-amber-800 border border-amber-200'
                                      : 'bg-emerald-100 text-emerald-800 border border-emerald-200'
                              )}
                            >
                              {isNotDone ? 'NOT DONE' : isFail ? 'FAIL' : isWarn ? 'WARN' : t.pass === null ? 'RECORDED' : 'PASS'}
                            </span>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </TableWrapper>
            </div>
          )}

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 text-xs text-secondary-foreground">
            <div className="bg-card border-border p-3 rounded-lg border space-y-1">
              <p className="font-semibold text-foreground">Submitted by</p>
              <p>
                Name: <strong>{item.submittedBy.name || '—'}</strong>
              </p>
              <p>
                Role: <strong>{getRoleLabel(item.submittedBy.role)}</strong>
              </p>
              {item.submittedBy.performedAsRole && (
                <p>
                  Acting As: <strong>{getRoleLabel(item.submittedBy.performedAsRole)}</strong>
                </p>
              )}
            </div>

            {item.details.formulaAudit?.gpsCoordinates && (
              <div className="bg-card border-border p-3 rounded-lg border space-y-1">
                <p className="font-semibold text-foreground flex items-center gap-1">
                  <MapPin className="w-3.5 h-3.5 text-muted-foreground" />
                  <span>Location verified</span>
                </p>
                <p>
                  GPS captured at submission
                  {item.details.formulaAudit.gpsCoordinates.accuracy
                    ? ` (±${Math.round(item.details.formulaAudit.gpsCoordinates.accuracy)}m accuracy)`
                    : ''}
                </p>
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
            <p className="font-semibold text-sm">Review locked</p>
            <p>
              {item.disabledReason ||
                'Another supervisor must review this item.'}
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
