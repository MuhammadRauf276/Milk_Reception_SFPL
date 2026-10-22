'use client';

import React, { useState } from 'react';
import { useSearchParams } from 'next/navigation';
import { AnimatePresence, motion } from 'framer-motion';
import { Truck, Clock, Users, Warehouse } from 'lucide-react';
import { User } from '@backend/core/types';
import { useToast } from '@/frontend/context/ToastContext';
import { SegmentedTabs } from '@/components/ui/segmented-tabs';
import { fadeSlide } from '@/components/motion/presets';
import { canActAs } from '@/backend/core/roles/hierarchy';
import { RequestCorrectionModal, EditableFieldOption, type RequestCorrectionModalProps } from '@/frontend/modules/governance/RequestCorrectionModal';
import type { HcArrivalRow, MainTab, McArrivalRow } from './arrivalTypes';
import { useArrivalsData } from './useArrivalsData';
import { useGpsCapture } from './useGpsCapture';
import { useMcArrivalForm } from './useMcArrivalForm';
import { useHcArrivalForm } from './useHcArrivalForm';
import { useAddHcSupplier } from './useAddHcSupplier';
import { useArrivalCorrection } from './useArrivalCorrection';
import { McArrivalPanel } from './McArrivalPanel';
import { HcArrivalPanel } from './HcArrivalPanel';
import { InsideVehiclesPanel } from './InsideVehiclesPanel';
import { HistoryPanel, type HistoryType } from './HistoryPanel';
import { CorrectionDrawer } from './CorrectionDrawer';
import { AddSupplierDrawer } from './AddSupplierDrawer';

export type { MainTab };

interface ZmccArrivalsWorkspaceProps {
  currentUser: User | null;
  activeTab?: MainTab;
  onTabChange?: (tab: MainTab) => void;
  hideTabBar?: boolean;
}

export const ZmccArrivalsWorkspace: React.FC<ZmccArrivalsWorkspaceProps> = ({
  currentUser,
  activeTab: controlledTab,
  onTabChange,
  hideTabBar = false,
}) => {
  const toast = useToast();
  const isSuperAdmin = currentUser?.role === 'SUPER_ADMIN';
  const isDataExecutive = currentUser?.role === 'DATA_EXECUTIVE';
  // PHE Operator, MDO and every role above them can record arrivals (server checks again).
  const canSubmit = !!currentUser && (canActAs(currentUser.role, 'PHE_OPERATOR') || canActAs(currentUser.role, 'MDO'));
  const canDirectCorrect = isDataExecutive || isSuperAdmin;

  const [requestModalState, setRequestModalState] = useState<{
    isOpen: boolean;
    module: RequestCorrectionModalProps['module'];
    recordId: string;
    label: string;
    fields: EditableFieldOption[];
  }>({ isOpen: false, module: 'ZMCC_MC_ARRIVAL', recordId: '', label: '', fields: [] });

  const openRequestCorrection = (type: 'MC' | 'HC', record: McArrivalRow | HcArrivalRow) => {
    const fields: EditableFieldOption[] = [];
    let moduleName: RequestCorrectionModalProps['module'] = 'ZMCC_MC_ARRIVAL';
    let label = `Arrival #${record.id}`;

    if (type === 'MC') {
      const r = record as McArrivalRow;
      moduleName = 'ZMCC_MC_ARRIVAL';
      label = `MC Arrival (Token: ${r.zmcc_token || r.id})`;
      fields.push({ field: 'raw_milk_token_number', label: 'Token Number', currentValue: r.raw_milk_token_number, type: 'text' });
    } else {
      const r = record as HcArrivalRow;
      moduleName = 'ZMCC_HC_ARRIVAL';
      label = `HC Arrival (Token: ${r.zmcc_token || r.id})`;
      fields.push({ field: 'raw_milk_token_number', label: 'Token Number', currentValue: r.raw_milk_token_number, type: 'text' });
      fields.push({ field: 'vehicle_number', label: 'Vehicle Number', currentValue: r.vehicle_number, type: 'text' });
    }

    setRequestModalState({ isOpen: true, module: moduleName, recordId: String(record.id), label, fields });
  };

  const [internalTab, setInternalTab] = useState<MainTab>(canSubmit ? 'MC_ARRIVAL' : 'HISTORY');
  const activeTab = controlledTab || internalTab;
  const setActiveTab = (tab: MainTab) => {
    setInternalTab(tab);
    if (onTabChange) onTabChange(tab);
  };

  // History filters (the data hook debounces the search).
  const [historyType, setHistoryType] = useState<HistoryType>('ALL');
  const [historyDate, setHistoryDate] = useState('');
  const [historySearch, setHistorySearch] = useState('');
  const [historyPage, setHistoryPage] = useState(1);

  const searchParams = useSearchParams();
  const effectiveZmccId =
    currentUser?.procurement_source?.id ||
    searchParams?.get('zmccId') ||
    searchParams?.get('zmcc_id') ||
    searchParams?.get('sourceId') ||
    undefined;

  const correction = useArrivalCorrection(() => {
    void data.fetchHistory();
  });
  const data = useArrivalsData({
    activeTab,
    canSubmit,
    correctionOpen: !!correction.target,
    zmccSourceId: effectiveZmccId,
    historyDate,
    historySearch,
    historyPage,
    historyPageSize: 20,
  });

  const captureGps = useGpsCapture(currentUser?.procurement_source?.code);
  const mcForm = useMcArrivalForm(data.rawMilkTokenPolicyMode, () => {
    void data.fetchArrivingJourneys();
    void data.fetchInsideVehicles();
    void data.fetchHistory();
  });
  const hcForm = useHcArrivalForm(() => {
    void data.fetchInsideVehicles();
    void data.fetchHistory();
  });
  const addSupplier = useAddHcSupplier((supplier) => {
    hcForm.setSupplierSearchTerm('');
    data.addLocalSupplierToCache(supplier);
    if (supplier.approval_status === 'ACTIVE') hcForm.setSelectedLocalSupplierId(supplier.id);
  });

  const tabs = [
    ...(canSubmit
      ? [
          { value: 'MC_ARRIVAL' as const, label: 'MC arrival', icon: Truck },
          { value: 'HC_ARRIVAL' as const, label: 'HC arrival', icon: Users },
          { value: 'INSIDE_ZMCC' as const, label: 'Inside vehicles', icon: Warehouse },
        ]
      : []),
    { value: 'HISTORY' as const, label: 'History & corrections', icon: Clock },
  ];

  return (
    <div className="space-y-6">
      {!hideTabBar && (
        <div className="lg:hidden">
          <SegmentedTabs label="Arrival views" value={activeTab} onValueChange={setActiveTab} tabs={tabs} />
        </div>
      )}

      <AnimatePresence mode="wait" initial={false}>
        <motion.div key={activeTab} variants={fadeSlide} initial="initial" animate="animate" exit="exit">
          {activeTab === 'MC_ARRIVAL' && canSubmit && (
            <McArrivalPanel
              form={mcForm}
              journeys={data.arrivingJourneys}
              loadingJourneys={data.loadingJourneys}
              onRefresh={() => void data.fetchArrivingJourneys()}
              policyMode={data.rawMilkTokenPolicyMode}
              onCaptureGps={() => captureGps(mcForm.setGps)}
            />
          )}

          {activeTab === 'INSIDE_ZMCC' && (
            <InsideVehiclesPanel
              insideVehicles={data.insideVehicles}
              insideHasMore={data.insideHasMore}
              insideTotalCount={data.insideTotalCount}
              loadingInside={data.loadingInside}
              onRefresh={() => void data.fetchInsideVehicles()}
            />
          )}

          {activeTab === 'HC_ARRIVAL' && canSubmit && (
            <HcArrivalPanel
              form={hcForm}
              localSuppliers={data.localSuppliers}
              loadingLocalSuppliers={data.loadingLocalSuppliers}
              onAddSupplier={addSupplier.openDrawer}
              onCaptureGps={() => captureGps(hcForm.setGps)}
            />
          )}

          {activeTab === 'HISTORY' && (
            <HistoryPanel
              historyType={historyType}
              onTypeChange={(t) => {
                setHistoryType(t);
                if (t !== 'ALL') setHistoryPage(1);
              }}
              historyDate={historyDate}
              onDateChange={(d) => {
                setHistoryDate(d);
                setHistoryPage(1);
              }}
              historySearch={historySearch}
              onSearchChange={(s) => {
                setHistorySearch(s);
                setHistoryPage(1);
              }}
              historyPage={historyPage}
              onPageChange={setHistoryPage}
              totalPages={data.historyTotalPages}
              totalRecords={data.historyTotalRecords}
              loading={data.loadingHistory}
              onRefresh={() => void data.fetchHistory()}
              mcArrivals={data.mcArrivals}
              hcArrivals={data.hcArrivals}
              canDirectCorrect={canDirectCorrect}
              canRequestCorrection={!canDirectCorrect}
              onCorrect={correction.open}
              onRequestCorrection={openRequestCorrection}
            />
          )}
        </motion.div>
      </AnimatePresence>

      <CorrectionDrawer c={correction} localSuppliers={data.localSuppliers} />
      <AddSupplierDrawer s={addSupplier} />

      <RequestCorrectionModal
        isOpen={requestModalState.isOpen}
        onClose={() => setRequestModalState((prev) => ({ ...prev, isOpen: false }))}
        module={requestModalState.module}
        recordId={requestModalState.recordId}
        recordIdentifierLabel={requestModalState.label}
        availableFields={requestModalState.fields}
        onSuccess={() => {
          toast.showSuccess('Correction request sent. Follow it under My correction requests.');
          void data.fetchHistory();
        }}
      />
    </div>
  );
};
