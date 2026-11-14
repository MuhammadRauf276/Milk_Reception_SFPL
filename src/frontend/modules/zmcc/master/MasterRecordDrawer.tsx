'use client';

import React from 'react';
import { Button } from '@/components/ui/button';
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

          <div className="flex items-center justify-end gap-2 pt-3 border-t border-border">
            <Button
              type="button"
              variant="secondary"
              onClick={form.closeModal}
              disabled={form.isSubmitting}
            >
              Cancel
            </Button>
            <Button
              type="submit"
              variant={modalType === 'TOGGLE_ACTIVE' && activeRecord?.is_active ? 'destructive' : 'default'}
              loading={form.isSubmitting}
            >
              {modalType === 'TOGGLE_ACTIVE'
                ? activeRecord?.is_active
                  ? 'Confirm Deactivation'
                  : 'Confirm Activation'
                : 'Save Record'}
            </Button>
          </div>
        </form>
      )}
    </ZmccDrawer>
  );
};
