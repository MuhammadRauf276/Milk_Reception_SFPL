'use client';

import React from 'react';
import { UserPlus } from 'lucide-react';
import { ZmccDrawer, ZmccErrorBanner, zmccGhostBtn, zmccInputClass, zmccLabelClass } from '../shared/ZmccDrawer';
import type { useAddHcSupplier } from './useAddHcSupplier';

export const AddSupplierDrawer: React.FC<{ s: ReturnType<typeof useAddHcSupplier> }> = ({ s }) => (
  <ZmccDrawer
    open={s.open}
    onClose={() => s.setOpen(false)}
    title="Quick Onboard HC Supplier"
    icon={<UserPlus className="mt-0.5 h-5 w-5 shrink-0 text-emerald-700" />}
  >
    <ZmccErrorBanner message={s.error} />
    <form onSubmit={s.submit} className="space-y-3">
      <div>
        <label className={zmccLabelClass}>
          Supplier Name <span className="text-rose-500">*</span>
        </label>
        <input
          type="text"
          value={s.name}
          onChange={(e) => s.setName(e.target.value)}
          placeholder="e.g. Haji Milk Supplier"
          required
          maxLength={150}
          className={`${zmccInputClass} font-semibold`}
        />
      </div>
      <div>
        <label className={zmccLabelClass}>Phone *</label>
        <input
          type="text"
          required
          value={s.phone}
          onChange={(e) => s.setPhone(e.target.value)}
          placeholder="e.g. 0300-1234567"
          maxLength={50}
          className={`${zmccInputClass} tabular-nums`}
        />
      </div>
      <div>
        <label className={zmccLabelClass}>CNIC *</label>
        <input
          type="text"
          required
          value={s.cnic}
          onChange={(e) => s.setCnic(e.target.value)}
          placeholder="e.g. 35201-1234567-1"
          maxLength={50}
          className={`${zmccInputClass} tabular-nums`}
        />
      </div>
      <div className="flex justify-end space-x-2 pt-3 border-t">
        <button type="button" onClick={() => s.setOpen(false)} className={zmccGhostBtn}>
          Cancel
        </button>
        <button
          type="submit"
          disabled={s.submitting}
          className="min-h-[44px] px-4 py-2 bg-emerald-700 hover:bg-emerald-800 text-white rounded-xl text-sm font-semibold transition-all disabled:opacity-50 cursor-pointer"
        >
          {s.submitting ? 'Saving…' : 'Save & Select Supplier'}
        </button>
      </div>
    </form>
  </ZmccDrawer>
);
