'use client';

import React from 'react';
import { Combobox } from '@/components/ui/combobox';
import { ZmccDrawer, ZmccErrorBanner, zmccGhostBtn, zmccInputClass, zmccLabelClass, zmccPrimaryBtn } from '../shared/ZmccDrawer';
import type { useArrivalCorrection } from './useArrivalCorrection';
import type { HcSupplierRow } from './arrivalTypes';

interface Props {
  c: ReturnType<typeof useArrivalCorrection>;
  localSuppliers: HcSupplierRow[];
}

export const CorrectionDrawer: React.FC<Props> = ({ c, localSuppliers }) => {
  const t = c.target;
  const close = () => c.setTarget(null);
  const upper = `${zmccInputClass} tabular-nums uppercase`;
  return (
    <ZmccDrawer
      open={!!t}
      onClose={close}
      title={t ? `Correct ${t.type}` : 'Correct arrival'}
      subtitle={
        t && (
          <>
            Token: <strong>{t.record.zmcc_token}</strong>
          </>
        )
      }
    >
      {t && (
        <>
          <ZmccErrorBanner message={c.error} />
          <form onSubmit={c.submit} className="space-y-4">
            {t.type === 'MC' ? (
              <div>
                <label className={zmccLabelClass}>Raw Milk Token Number</label>
                <input
                  type="text"
                  value={c.token}
                  onChange={(e) => c.setToken(e.target.value)}
                  placeholder="e.g. 001924"
                  required
                  className={upper}
                />
                {t.record.route_milk_token && (
                  <div className="bg-card border-border mt-2 p-2.5 border rounded-xl text-xs text-slate-600">
                    <span className="font-semibold text-slate-500">Legacy token:</span>{' '}
                    <span className="tabular-nums font-semibold text-slate-800">{t.record.route_milk_token}</span>
                  </div>
                )}
              </div>
            ) : (
              <>
                <div>
                  <label className={zmccLabelClass}>HC Supplier (Same ZMCC)</label>
                  <Combobox
                    options={localSuppliers.map((s) => ({ value: s.id, label: `${s.local_supplier_code} · ${s.name}`, keywords: `${s.phone || ''} ${s.cnic || ''}` }))}
                    value={c.localSupplierId}
                    onValueChange={c.setLocalSupplierId}
                    placeholder="Select supplier"
                    searchPlaceholder="Search supplier"
                    className="min-h-[44px] w-full font-semibold"
                  />
                </div>
                <div>
                  <label className={zmccLabelClass}>Raw Milk Token Number</label>
                  <input
                    type="text"
                    value={c.token}
                    onChange={(e) => c.setToken(e.target.value)}
                    placeholder="e.g. 001924"
                    required
                    className={upper}
                  />
                </div>
                {t.record.rmr_number && (
                  <div className="bg-card border-border p-2.5 border rounded-xl text-xs text-slate-600">
                    <span className="font-semibold text-slate-500">RMR:</span>{' '}
                    <span className="tabular-nums font-semibold text-slate-800">{t.record.rmr_number}</span>
                  </div>
                )}
                <div>
                  <label className={zmccLabelClass}>Vehicle Number</label>
                  <input
                    type="text"
                    value={c.vehicle}
                    onChange={(e) => c.setVehicle(e.target.value.toUpperCase())}
                    required
                    className={upper}
                  />
                </div>
              </>
            )}

            <div>
              <label className={zmccLabelClass}>Arrival Timestamp (PKT)</label>
              <input
                type="datetime-local"
                value={c.timestamp}
                onChange={(e) => c.setTimestamp(e.target.value)}
                required
                className={zmccInputClass}
              />
            </div>

            <div className="grid grid-cols-2 gap-2">
              <div>
                <label className={zmccLabelClass}>Latitude</label>
                <input type="number" step="0.0000001" value={c.lat} onChange={(e) => c.setLat(e.target.value)} className={zmccInputClass} />
              </div>
              <div>
                <label className={zmccLabelClass}>Longitude</label>
                <input type="number" step="0.0000001" value={c.lng} onChange={(e) => c.setLng(e.target.value)} className={zmccInputClass} />
              </div>
            </div>

            <div>
              <label className={zmccLabelClass}>
                Reason for Correction <span className="text-rose-500">*</span>
              </label>
              <textarea
                value={c.reason}
                onChange={(e) => c.setReason(e.target.value)}
                placeholder="Reason"
                required
                rows={3}
                className="min-h-11 w-full px-3 py-2 text-sm border rounded-xl"
              />
            </div>

            <div className="flex justify-end space-x-2 pt-2 border-t">
              <button type="button" onClick={close} className={zmccGhostBtn}>
                Cancel
              </button>
              <button type="submit" disabled={c.submitting} className={zmccPrimaryBtn}>
                {c.submitting ? 'Saving…' : 'Apply Correction'}
              </button>
            </div>
          </form>
        </>
      )}
    </ZmccDrawer>
  );
};
