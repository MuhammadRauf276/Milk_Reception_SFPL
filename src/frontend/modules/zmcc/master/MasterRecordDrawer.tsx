'use client';

import React from 'react';
import { Loader2 } from 'lucide-react';
import { ZmccDrawer, ZmccErrorBanner } from '../shared/ZmccDrawer';
import { OrgRecordForms } from './OrgRecordForms';
import { OperationalRecordForms } from './OperationalRecordForms';
import type { useMasterRecordForm } from './useMasterRecordForm';
import type { MasterModalType } from './masterTypes';
import type { MasterFormProps } from './masterFormProps';

type Helpers = Pick<MasterFormProps, 'helperRoutes' | 'helperAreas' | 'helperChillers'>;

interface Props extends Helpers {
  form: ReturnType<typeof useMasterRecordForm>;
}

const ORG: MasterModalType[] = [
  'CREATE_LOCAL_SUPPLIER', 'EDIT_LOCAL_SUPPLIER', 'CREATE_ROUTE', 'EDIT_ROUTE', 'CREATE_AREA', 'EDIT_AREA',
  'CREATE_MILK_SOURCE', 'EDIT_MILK_SOURCE', 'CREATE_CHILLER', 'EDIT_CHILLER',
];

export const MasterRecordDrawer: React.FC<Props> = ({ form, ...helpers }) => {
  const { modalType, activeRecord, formData, setFormData } = form;
  const title = (() => {
    switch (modalType) {
      case 'CREATE_LOCAL_SUPPLIER': return 'Register HC Supplier';
      case 'EDIT_LOCAL_SUPPLIER': return `Edit HC Supplier: ${activeRecord?.local_supplier_code}`;
      case 'CREATE_ROUTE': return 'Create New Route';
      case 'EDIT_ROUTE': return `Edit Route: ${activeRecord?.route_code}`;
      case 'CREATE_AREA': return 'Create Collection Area';
      case 'EDIT_AREA': return `Edit Area: ${activeRecord?.area_code}`;
      case 'CREATE_MILK_SOURCE': return 'Create Milk Source';
      case 'EDIT_MILK_SOURCE': return `Edit Milk Source: ${activeRecord?.name}`;
      case 'CREATE_CHILLER': return 'Create Chiller Ownership Option';
      case 'EDIT_CHILLER': return `Edit Chiller Ownership: ${activeRecord?.ownership_code}`;
      case 'CREATE_SHOP': return 'Register Collection Shop';
      case 'EDIT_SHOP': return `Edit Shop: ${activeRecord?.shop_code}`;
      case 'CREATE_TANK': return 'Create ZMCC Tank';
      case 'EDIT_TANK': return `Edit Tank: ${activeRecord?.tank_code}`;
      case 'TOGGLE_ACTIVE': return activeRecord?.is_active ? 'Confirm Deactivation' : 'Confirm Activation';
      default: return 'ZMCC master data record';
    }
  })();

  const formProps = modalType
    ? { modalType, formData, setFormData, activeRecord, ...helpers }
    : null;

  return (
    <ZmccDrawer open={!!modalType} onClose={form.closeModal} title={title}>
      <ZmccErrorBanner message={form.modalError} />
      {formProps && (
        <form onSubmit={form.submit} className="space-y-4">
          {ORG.includes(formProps.modalType) ? <OrgRecordForms {...formProps} /> : <OperationalRecordForms {...formProps} />}

          <div className="flex items-center justify-end gap-2.5 pt-3 border-t border-border">
            <button
              type="button"
              onClick={form.closeModal}
              disabled={form.isSubmitting}
              className="px-4 py-2 min-h-[44px] rounded-xl border border-border text-sm font-semibold text-slate-700 hover:bg-slate-100 transition"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={form.isSubmitting}
              className={`px-5 py-2 min-h-[44px] rounded-xl text-sm font-semibold text-white transition shadow-2xs flex items-center gap-2 ${
                modalType === 'TOGGLE_ACTIVE' && activeRecord?.is_active
                  ? 'bg-rose-600 hover:bg-rose-700'
                  : 'bg-primary hover:bg-primary-hover'
              }`}
            >
              {form.isSubmitting && <Loader2 className="w-3.5 h-3.5 animate-spin" />}
              <span>
                {modalType === 'TOGGLE_ACTIVE'
                  ? activeRecord?.is_active
                    ? 'Confirm Deactivation'
                    : 'Confirm Activation'
                  : 'Save Record'}
              </span>
            </button>
          </div>
        </form>
      )}
    </ZmccDrawer>
  );
};
