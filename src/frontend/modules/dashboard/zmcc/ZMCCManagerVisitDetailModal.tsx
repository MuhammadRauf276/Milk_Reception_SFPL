'use client';

import React, { useMemo } from 'react';
import { MilkProcessLog } from '@backend/core/types';
import { formatOperationalDatetime, formatOperationalDate } from '@/lib/datetime-utils';
import {
  X,
  Truck,
  Scale,
  FlaskConical,
  Receipt,
  FileText,
  ShieldCheck,
} from 'lucide-react';
import { Modal } from '@/components/ui/modal';
import { TableWrapper } from '@/components/ui/table-wrapper';
import { dispatchResultText } from '@/frontend/lib/dispatchResultText';

interface ZMCCManagerVisitDetailModalProps {
  isOpen: boolean;
  log: MilkProcessLog | null;
  portions?: MilkProcessLog[];
  onClose: () => void;
  assignedSourceName?: string;
  /** Extra section shown after the portion results, for views that add to this modal. */
  extraSection?: React.ReactNode;
}


type PortionTestRow = {
  name: string;
  performed: boolean;
  dispatchResult: string;
  plantResult: string;
  dispatchNumber: number | null;
  plantNumber: number | null;
  unit: string;
};

const asNumber = (v: unknown): number | null => (v == null || v === '' || !Number.isFinite(Number(v)) ? null : Number(v));

/** Plant minus dispatch, with a sign, rounded to what the tests are recorded in. */
function differenceText(plant: number | null, dispatch: number | null): string {
  if (plant == null || dispatch == null) return '-';
  const d = Math.round((plant - dispatch) * 1000) / 1000;
  return d > 0 ? `+${d}` : `${d}`;
}

function buildPortionTests(p: MilkProcessLog): PortionTestRow[] {
  if (p.portion_lab_results && p.portion_lab_results.length > 0) {
    return p.portion_lab_results.map((tr) => {
      const dispatchResult = dispatchResultText(tr);
      const plantResult =
        tr.plant_numeric_value != null
          ? `${tr.plant_numeric_value}`
          : tr.plant_text_value != null && tr.plant_text_value !== ''
          ? tr.plant_text_value
          : tr.plant_is_passed === true
          ? 'Passed'
          : tr.plant_is_passed === false
          ? 'Failed'
          : tr.plant_performed
          ? tr.plant_status || 'Performed'
          : 'Pending';
      return {
        name: tr.test_name,
        performed: tr.plant_performed || tr.dispatch_performed,
        dispatchResult,
        plantResult,
        dispatchNumber: asNumber(tr.dispatch_numeric_value),
        plantNumber: asNumber(tr.plant_numeric_value),
        unit: tr.unit || '-',
      };
    });
  }
  const row = (name: string, dispatch: number | null | undefined, plant: number | null | undefined, unit: string): PortionTestRow => ({
    name,
    performed: plant != null,
    dispatchResult: dispatch != null ? `${dispatch}` : 'Not recorded',
    plantResult: plant != null ? `${plant}` : 'Pending',
    dispatchNumber: dispatch ?? null,
    plantNumber: plant ?? null,
    unit,
  });
  return [
    row('Fat', p.dispatch_fat, p.sampling_fat, '%'),
    row('LR', p.dispatch_lr, p.sampling_lr, '°L'),
    row('SNF', p.computed_dispatch_snf, p.computed_sampling_snf, '%'),
    row('TS', p.computed_dispatch_ts, p.computed_sampling_ts, '%'),
    row('MBRT', null, p.b_mbrt_minutes_test, 'min'),
  ];
}

const kg = (v: number | null | undefined) => (v == null ? null : `${v.toLocaleString()} kg`);
const when = (v: string | null | undefined) => (v ? formatOperationalDatetime(v) : null);

interface Weighing {
  label: string;
  weight: string | null;
  net: string | null;
  time: string | null;
}

/**
 * Every weighing of the vehicle in order: loaded, then one after each unloaded portion (portion-wise weighing
 * records the weight before and after each compartment). Older visits with only a gross and a tare show those two.
 */
function buildWeighings(log: MilkProcessLog, portions: MilkProcessLog[]): Weighing[] {
  const rows: Weighing[] = [];
  if (log.first_weight_of_vehicle == null) return rows;
  rows.push({ label: 'Loaded', weight: kg(log.first_weight_of_vehicle), net: null, time: when(log.first_weight_timestamp) });
  const weighed = [...portions]
    .filter((p) => p.portion_second_weight_kg != null)
    .sort((a, b) => String(a.portion_number).localeCompare(String(b.portion_number), undefined, { numeric: true }));
  for (const p of weighed) {
    rows.push({
      label: `After ${p.portion_number} unloaded`,
      weight: kg(p.portion_second_weight_kg),
      net: kg(p.portion_net_weight_kg),
      time: when(p.portion_second_weight_at),
    });
  }
  const lastWeight = weighed.length > 0 ? weighed[weighed.length - 1].portion_second_weight_kg : null;
  if (log.second_weight_of_vehicle != null && log.second_weight_of_vehicle !== lastWeight) {
    rows.push({ label: 'Empty', weight: kg(log.second_weight_of_vehicle), net: kg(log.computed_net_milk_weight), time: when(log.second_weight_timestamp) });
  }
  if (log.second_weight_of_vehicle == null) {
    rows.push({ label: 'Next weighing', weight: null, net: null, time: null });
  }
  return rows;
}

const portionLabel = (p: MilkProcessLog, idx: number) =>
  String(p.portion_number || idx + 1).replace(/^P-/, '');

const decisionClass = (d: string) =>
  d === 'ACCEPTED'
    ? 'bg-emerald-100 text-emerald-800 border border-emerald-300'
    : d === 'REJECTED'
    ? 'bg-rose-100 text-rose-800 border border-rose-300'
    : d === 'HOLD'
    ? 'bg-amber-100 text-amber-800 border border-amber-300'
    : 'bg-muted text-secondary-foreground border border-border-strong';

export const ZMCCManagerVisitDetailModal: React.FC<ZMCCManagerVisitDetailModalProps> = ({
  isOpen,
  log,
  portions,
  onClose,
  assignedSourceName,
  extraSection,
}) => {
  const displayPortions = useMemo(() => {
    if (portions && portions.length > 0) return portions;
    return log ? [log] : [];
  }, [portions, log]);

  const portionTests = useMemo(
    () => displayPortions.map((p) => new Map(buildPortionTests(p).map((t) => [t.name, t]))),
    [displayPortions]
  );
  // Portions the dispatch sent. A portion the plant added has plant results only.
  const dispatchIndexes = useMemo(
    () => displayPortions.map((p, i) => (p.is_dispatch_portion === false ? -1 : i)).filter((i) => i >= 0),
    [displayPortions]
  );
  // Each plant portion is compared with the same dispatched portion, or with the only dispatched one (composite).
  const dispatchFor = (i: number): number | null =>
    dispatchIndexes.includes(i) ? i : dispatchIndexes.length === 1 ? dispatchIndexes[0] : null;
  const weighings = useMemo(() => (log ? buildWeighings(log, displayPortions) : []), [log, displayPortions]);
  const testNames = useMemo(() => {
    const names: string[] = [];
    for (const m of portionTests) for (const n of m.keys()) if (!names.includes(n)) names.push(n);
    return names;
  }, [portionTests]);

  if (!isOpen || !log) return null;

  const isCompletedReceipt = Boolean(log.final_receipt_exists && log.final_receipt_timestamp);
  const isReceiptPending = Boolean(log.second_weight_of_vehicle != null && !log.final_receipt_exists);
  const receiptStatusText = isCompletedReceipt
    ? 'Completed'
    : isReceiptPending
    ? 'Final receipt pending'
    : 'In Progress';

  return (
    <Modal onClose={onClose} title="Visit details" closeOnOutsideClick className="max-w-4xl max-h-[90dvh] overflow-hidden flex flex-col">
        {/* Modal Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-border bg-subtle">
          <div className="flex items-center space-x-3">
            <div className="p-3 rounded-xl bg-primary/10 text-primary">
              <Truck className="w-5 h-5" />
            </div>
            <div>
              <div className="flex items-center space-x-2">
                <h2 id="modal-title" className="text-base font-semibold text-foreground">
                  Visit: {log.vehicle_number}
                </h2>
              </div>
              <p className="text-xs text-secondary-foreground font-medium">
                {log.token_number ? <><span className="font-mono font-semibold text-foreground">Token {log.token_number}</span> · </> : ''}
                {assignedSourceName || log.zonal_contractor_name || 'Station'} · Business Date:{' '}
                <span className={`font-semibold ${log.business_date ? 'text-foreground' : 'text-amber-700'}`}>
                  {log.business_date ? formatOperationalDate(log.business_date) : 'Pending plant completion'}
                </span>
              </p>
            </div>
          </div>

          <button
            onClick={onClose}
            className="p-2 min-h-11 min-w-11 rounded-xl text-secondary-foreground hover:text-secondary-foreground hover:bg-secondary transition-[color,background-color,border-color,box-shadow,opacity,transform] flex items-center justify-center"
            aria-label="Close modal"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Modal Body */}
        <div className="flex-1 overflow-y-auto p-6 space-y-6 text-xs">
          {/* 1. Dispatch Details */}
          <div className="p-5 rounded-2xl bg-card border border-border space-y-4 shadow-2xs">
            <div className="flex items-center space-x-2 border-b border-border/60 pb-2">
              <FileText className="w-4 h-4 text-muted-foreground" />
              <h3 className="text-xs font-semibold text-foreground">
                Dispatch Details
              </h3>
            </div>

            <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-4 tabular-nums">
              <div className="bg-card border-border/60 p-3 rounded-lg border">
                <span className="text-xs font-sans font-semibold text-muted-foreground block">
                  Vehicle Number
                </span>
                <span className="text-sm font-semibold text-foreground">
                  {log.vehicle_number || 'Not recorded'}
                </span>
              </div>

              <div className="bg-card border-border/60 p-3 rounded-lg border">
                <span className="text-xs font-sans font-semibold text-muted-foreground block">
                  Station
                </span>
                <span className="text-sm font-semibold text-foreground">
                  {assignedSourceName || log.zonal_contractor_name || 'Not recorded'}
                </span>
              </div>

              <div className="bg-card border-border/60 p-3 rounded-lg border">
                <span className="text-xs font-sans font-semibold text-muted-foreground block">
                  Business Date
                </span>
                <span className={`text-sm font-semibold ${log.business_date ? 'text-foreground' : 'text-amber-700'}`}>
                  {log.business_date ? formatOperationalDate(log.business_date) : 'Pending plant completion'}
                </span>
              </div>

              <div className="bg-card border-border/60 p-3 rounded-lg border">
                <span className="text-xs font-sans font-semibold text-muted-foreground block">
                  Dispatch Date
                </span>
                <span className="text-sm font-semibold text-foreground">
                  {log.dispatch_date ? formatOperationalDate(log.dispatch_date) : 'Not recorded'}
                </span>
              </div>

              <div className="bg-card border-border/60 p-3 rounded-lg border">
                <span className="text-xs font-sans font-semibold text-muted-foreground block">
                  Dispatch Quantity (@13% TS)
                </span>
                <span className="text-sm font-semibold text-primary">
                  {log.vehicle_dispatch_at_13ts_liters != null
                    ? `${Number(log.vehicle_dispatch_at_13ts_liters).toLocaleString()} L @13% TS`
                    : log.vehicle_dispatch_quantity_value != null
                    ? `${log.vehicle_dispatch_quantity_value.toLocaleString()} ${log.vehicle_dispatch_quantity_unit || ''}`
                    : log.vehicle_dispatch_gross_liters != null
                    ? `${log.vehicle_dispatch_gross_liters.toLocaleString()} L`
                    : 'Not recorded'}
                </span>
              </div>

              <div className="bg-card border-border/60 p-3 rounded-lg border">
                <span className="text-xs font-sans font-semibold text-muted-foreground block">
                  Dispatch Time
                </span>
                <span className="text-xs font-semibold text-foreground">
                  {log.dispatch_timestamp ? formatOperationalDatetime(log.dispatch_timestamp) : 'Not recorded'}
                </span>
              </div>

              <div className="bg-card border-border/60 p-3 rounded-lg border">
                <span className="text-xs font-sans font-semibold text-muted-foreground block">
                  Gate entry
                </span>
                <span className="text-xs font-semibold text-foreground">
                  {log.gate_entry_timestamp ? formatOperationalDatetime(log.gate_entry_timestamp) : 'Pending'}
                </span>
              </div>

              <div className="bg-card border-border/60 p-3 rounded-lg border">
                <span className="text-xs font-sans font-semibold text-muted-foreground block">
                  Gate exit
                </span>
                <span className="text-xs font-semibold text-foreground">
                  {log.gate_exit_timestamp ? formatOperationalDatetime(log.gate_exit_timestamp) : 'Pending'}
                </span>
              </div>

              <div className="bg-card border-border/60 p-3 rounded-lg border">
                <span className="text-xs font-sans font-semibold text-muted-foreground block">
                  Dispatch gross L
                </span>
                <span className="text-sm font-semibold text-foreground">
                  {log.vehicle_dispatch_gross_liters != null ? `${log.vehicle_dispatch_gross_liters.toLocaleString()} L` : 'Not recorded'}
                </span>
              </div>

              <div className="bg-card border-border/60 p-3 rounded-lg border">
                <span className="text-xs font-sans font-semibold text-muted-foreground block">
                  Dispatch Weight
                </span>
                <span className="text-sm font-semibold text-foreground">
                  {log.vehicle_dispatch_kg != null ? `${log.vehicle_dispatch_kg.toLocaleString()} kg` : 'Not recorded'}
                </span>
              </div>
            </div>
          </div>

          {/* 2. Weight & Quantity */}
          <div className="p-5 rounded-2xl bg-card border border-border space-y-4 shadow-2xs">
            <div className="flex items-center space-x-2 border-b border-border/60 pb-2">
              <Scale className="w-4 h-4 text-muted-foreground" />
              <h3 className="text-xs font-semibold text-foreground">
                Weight & Quantity
              </h3>
            </div>

            <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-4 tabular-nums">
              <div className="bg-card border-border/60 p-3 rounded-lg border">
                <span className="text-xs font-sans font-semibold text-muted-foreground block">
                  Gross Weight
                </span>
                <span className="text-sm font-semibold text-foreground">
                  {log.first_weight_of_vehicle != null
                    ? `${log.first_weight_of_vehicle.toLocaleString()} kg`
                    : 'Not recorded'}
                </span>
              </div>

              <div className="bg-card border-border/60 p-3 rounded-lg border">
                <span className="text-xs font-sans font-semibold text-muted-foreground block">
                  Tare Weight
                </span>
                <span className="text-sm font-semibold text-foreground">
                  {log.second_weight_of_vehicle != null
                    ? `${log.second_weight_of_vehicle.toLocaleString()} kg`
                    : log.first_weight_of_vehicle != null
                    ? 'Pending'
                    : 'Not recorded'}
                </span>
              </div>

              <div className="bg-card border-border/60 p-3 rounded-lg border">
                <span className="text-xs font-sans font-semibold text-muted-foreground block">
                  Net weight
                </span>
                <span className="text-sm font-semibold text-primary">
                  {log.computed_net_milk_weight != null
                    ? `${log.computed_net_milk_weight.toLocaleString()} kg`
                    : 'Pending'}
                </span>
              </div>

              <div className="bg-card border-border/60 p-3 rounded-lg border">
                <span className="text-xs font-sans font-semibold text-muted-foreground block">
                  Received Quantity (@13% TS)
                </span>
                <span className="text-sm font-semibold text-emerald-800">
                  {log.plant_final_at_13ts_liters != null
                    ? `${Number(log.plant_final_at_13ts_liters).toLocaleString()} L @13% TS`
                    : log.authoritative_final_liters != null
                    ? `${log.authoritative_final_liters.toLocaleString()} L`
                    : log.final_receipt_exists
                    ? 'Not recorded'
                    : 'Pending'}
                </span>
              </div>

            </div>

            {weighings.length > 0 && (
              <TableWrapper className="rounded-lg border border-border/60">
                <table className="w-full text-left text-xs tabular-nums">
                  <thead>
                    <tr className="border-b border-border text-muted-foreground">
                      <th className="py-2 px-2 font-semibold">Weighing</th>
                      <th className="py-2 px-2 font-semibold">Step</th>
                      <th className="py-2 px-2 font-semibold text-right">Weight</th>
                      <th className="py-2 px-2 font-semibold text-right">Milk Off</th>
                      <th className="py-2 px-2 font-semibold">Time</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-border/40">
                    {weighings.map((w, i) => (
                      <tr key={`${w.label}-${i}`}>
                        <td className="py-2 px-2 font-semibold text-foreground">{w.weight ? `Weight ${i + 1}` : '-'}</td>
                        <td className="py-2 px-2 text-secondary-foreground">{w.label}</td>
                        <td className="py-2 px-2 text-right font-semibold text-foreground">{w.weight ?? 'Pending'}</td>
                        <td className="py-2 px-2 text-right text-secondary-foreground">{w.net ?? '-'}</td>
                        <td className="py-2 px-2 text-secondary-foreground whitespace-nowrap">{w.time ?? '-'}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </TableWrapper>
            )}
          </div>

          {/* 3. Portion quality */}
          <div className="p-5 rounded-2xl bg-card border border-border space-y-4 shadow-2xs">
            <div className="flex items-center space-x-2 border-b border-border/60 pb-2">
              <FlaskConical className="w-4 h-4 text-muted-foreground" />
              <h3 className="text-xs font-semibold text-foreground">
                Portion quality
              </h3>
            </div>

            <div className="space-y-4">
              {displayPortions.map((p, idx) => {
                const decisionUpper = (p.calculated_status || 'Pending').toUpperCase();
                return (
                  <div key={p.portion_id || idx} className="bg-card border-border p-4 rounded-2xl border space-y-2">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <div className="flex items-center space-x-2">
                        <span className="text-xs font-semibold text-foreground">Portion #{portionLabel(p, idx)}</span>
                        <span className="text-xs text-muted-foreground tabular-nums">
                          (Quantity:{' '}
                          <span className="font-semibold text-foreground">
                            {p.is_dispatch_portion === false
                              ? 'Added at plant'
                              : p.dispatch_liters_gross != null
                              ? `${p.dispatch_liters_gross.toLocaleString()} L`
                              : p.dispatch_kg_gross != null
                              ? `${p.dispatch_kg_gross.toLocaleString()} kg`
                              : 'Not recorded'}
                          </span>
                          )
                        </span>
                      </div>
                      <span className={`px-3 py-0.5 rounded text-xs font-semibold ${decisionClass(decisionUpper)}`}>
                        {decisionUpper}
                      </span>
                    </div>
                    {p.rejection_reasons && (
                      <div className="bg-card border-border p-3 rounded-lg border text-rose-900 text-xs">
                        <span className="font-semibold">Rejection Reason: </span>
                        <span>{p.rejection_reasons}</span>
                      </div>
                    )}
                  </div>
                );
              })}

              <TableWrapper className="bg-card border-border p-4 rounded-2xl border">
                <table className="w-full text-left text-xs">
                  <thead>
                    <tr className="border-b border-border text-xs font-semibold text-muted-foreground">
                      <th className="py-2 px-2">Lab Test</th>
                      <th className="py-2 px-2">Status</th>
                      {dispatchIndexes.map((idx) => (
                        <th key={`d-${displayPortions[idx].portion_id || idx}`} className="py-2 px-2 tabular-nums whitespace-nowrap">
                          Dispatch {dispatchIndexes.length > 1 ? portionLabel(displayPortions[idx], idx) : ''}
                        </th>
                      ))}
                      {displayPortions.map((p, idx) => (
                        <th key={`p-${p.portion_id || idx}`} className="py-2 px-2 tabular-nums whitespace-nowrap">
                          Plant {displayPortions.length > 1 ? portionLabel(p, idx) : ''}
                        </th>
                      ))}
                      {displayPortions.map((p, idx) => (
                        <th key={`x-${p.portion_id || idx}`} className="py-2 px-2 tabular-nums whitespace-nowrap">
                          Diff {displayPortions.length > 1 ? portionLabel(p, idx) : ''}
                        </th>
                      ))}
                      <th className="py-2 px-2">Unit</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-border/40 tabular-nums">
                    {testNames.map((name) => (
                      <tr key={name} className="hover:bg-subtle/60">
                        <td className="py-2 px-2 font-sans font-semibold text-foreground">{name}</td>
                        <td className="py-2 px-2 font-sans">
                          {portionTests.some((t) => t.get(name)?.performed) ? (
                            <span className="inline-block px-2 py-0.5 rounded text-xs font-semibold bg-emerald-50 text-emerald-700 border border-emerald-200">Performed</span>
                          ) : (
                            <span className="inline-block px-2 py-0.5 rounded text-xs font-semibold bg-muted text-muted-foreground">Not performed</span>
                          )}
                        </td>
                        {dispatchIndexes.map((i) => (
                          <td key={`d-${i}`} className="py-2 px-2 text-secondary-foreground">
                            {portionTests[i].get(name)?.dispatchResult ?? 'Not recorded'}
                          </td>
                        ))}
                        {portionTests.map((tests, i) => (
                          <td key={`p-${i}`} className="py-2 px-2 font-semibold text-foreground">
                            {tests.get(name)?.plantResult ?? 'Pending'}
                          </td>
                        ))}
                        {portionTests.map((tests, i) => {
                          const from = dispatchFor(i);
                          const text = differenceText(
                            tests.get(name)?.plantNumber ?? null,
                            from == null ? null : portionTests[from].get(name)?.dispatchNumber ?? null
                          );
                          return (
                            <td key={`x-${i}`} className={`py-2 px-2 ${text === '-' || text === '0' ? 'text-muted-foreground' : 'font-semibold text-foreground'}`}>
                              {text}
                            </td>
                          );
                        })}
                        <td className="py-2 px-2 font-sans text-muted-foreground">
                          {portionTests.map((t) => t.get(name)?.unit).find((u) => u) ?? '-'}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </TableWrapper>
            </div>
          </div>

          {extraSection}

          {/* 4. Receipt Details */}
          <div className="p-5 rounded-2xl bg-card border border-border space-y-4 shadow-2xs">
            <div className="flex items-center space-x-2 border-b border-border/60 pb-2">
              <Receipt className="w-4 h-4 text-muted-foreground" />
              <h3 className="text-xs font-semibold text-foreground">
                Receipt Details
              </h3>
            </div>

            <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-4 tabular-nums">
              <div className="bg-card border-border/60 p-3 rounded-lg border">
                <span className="text-xs font-sans font-semibold text-muted-foreground block">
                  Receipt Status
                </span>
                <span
                  className={`text-xs font-semibold inline-block px-2 py-0.5 rounded ${
                    isCompletedReceipt
                      ? 'bg-emerald-100 text-emerald-800'
                      : isReceiptPending
                      ? 'bg-amber-100 text-amber-800'
                      : 'bg-blue-100 text-blue-800'
                  }`}
                >
                  {receiptStatusText}
                </span>
              </div>

              <div className="bg-card border-border/60 p-3 rounded-lg border">
                <span className="text-xs font-sans font-semibold text-muted-foreground block">
                  Destination Silo
                </span>
                <span className="text-sm font-semibold text-foreground">
                  {log.silo_storage_id || 'Pending'}
                </span>
              </div>

              <div className="bg-card border-border/60 p-3 rounded-lg border">
                <span className="text-xs font-sans font-semibold text-muted-foreground block">
                  Unloading Start
                </span>
                <span className="text-xs font-semibold text-foreground">
                  {log.unloading_start_timestamp
                    ? formatOperationalDatetime(log.unloading_start_timestamp)
                    : 'Pending'}
                </span>
              </div>

              <div className="bg-card border-border/60 p-3 rounded-lg border">
                <span className="text-xs font-sans font-semibold text-muted-foreground block">
                  Unloading End
                </span>
                <span className="text-xs font-semibold text-foreground">
                  {log.unloading_end_timestamp
                    ? formatOperationalDatetime(log.unloading_end_timestamp)
                    : 'Pending'}
                </span>
              </div>

              <div className="bg-card border-border/60 p-3 rounded-lg border">
                <span className="text-xs font-sans font-semibold text-muted-foreground block">
                  Final receipt
                </span>
                <span className="text-xs font-semibold text-emerald-800">
                  {log.final_receipt_timestamp
                    ? formatOperationalDatetime(log.final_receipt_timestamp)
                    : 'Pending'}
                </span>
              </div>
            </div>
          </div>
        </div>

        {/* Modal Footer */}
        <div className="flex items-center justify-between px-6 py-4 border-t border-border bg-subtle">
          <div className="flex items-center space-x-1.5 text-secondary-foreground text-xs font-semibold">
            <ShieldCheck className="w-4 h-4 text-muted-foreground" />
            <span>Station: {assignedSourceName || log.zonal_contractor_name || 'Assigned Station'}</span>
          </div>

          <button
            onClick={onClose}
            className="min-h-11 min-w-20 px-4 py-2 rounded-xl bg-primary text-white text-xs font-semibold hover:bg-primary/90 transition-[color,background-color,border-color,box-shadow,opacity,transform] shadow-2xs flex items-center justify-center focus:outline-hidden focus:ring-2 focus:ring-primary"
          >
            Close
          </button>
        </div>
      </Modal>
  );
};
