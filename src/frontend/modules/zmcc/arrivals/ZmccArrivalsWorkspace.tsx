'use client';

import React, { useState, useEffect, useCallback, useEffectEvent, useRef } from 'react';
import { User } from '@backend/core/types';
import {
  Truck,
  CheckCircle2,
  AlertCircle,
  Clock,
  MapPin,
  Search,
  X,
  Users,
  UserPlus,
  Plus,
  Loader2,
} from 'lucide-react';

import { useToast } from '@/frontend/context/ToastContext';
import { toDatetimeLocalInput, datetimeLocalToIso } from '@/lib/datetime-utils';
import { Modal } from '@/components/ui/modal';
import { onActivateKey } from '@/lib/a11y';
import { SegmentedTabs } from '@/components/ui/segmented-tabs';
import { AnimatePresence } from 'framer-motion';
import { getErrorMessage } from '@/lib/errors';
import { acquireRobustGps } from '@/lib/gps';
import { canActAs } from '@/backend/core/roles/hierarchy';
import { RequestCorrectionModal, EditableFieldOption } from '@/frontend/modules/governance/RequestCorrectionModal';
import type {
  InsideVehicle,
  serializeContractorArrival,
  serializeLocalSupplierArrival,
  serializeMotArrival,
} from '@/backend/services/zmccArrival/zmccArrivalCore';
import type { serializeLocalSupplier } from '@/backend/services/zmccLocalSupplierService';

export type MainTab = 'MOT_ARRIVAL' | 'LOCAL_SUPPLIER_ARRIVAL' | 'INSIDE_ZMCC' | 'HISTORY';

type MotArrivalRow = ReturnType<typeof serializeMotArrival>;
type ContractorArrivalRow = ReturnType<typeof serializeContractorArrival>;
type LocalSupplierArrivalRow = ReturnType<typeof serializeLocalSupplierArrival>;
type LocalSupplierRow = ReturnType<typeof serializeLocalSupplier>;
type CorrectionTarget =
  | { type: 'MOT'; record: MotArrivalRow }
  | { type: 'CONTRACTOR'; record: ContractorArrivalRow }
  | { type: 'LOCAL_SUPPLIER'; record: LocalSupplierArrivalRow };

/** Row shape of GET /api/zmcc/arrivals/arriving-journeys (see getArrivingMotJourneys). */
type ArrivingJourney = {
  id: string;
  journey_number: string;
  operational_date: string;
  started_at: string;
  route: { id: string; route_code: string; name: string } | null;
  mot_vehicle: { id: string; vehicle_number: string } | null;
  mot_profile: { id: string; mot_code: string; name: string; phone_number: string | null } | null;
  zmcc: { id: string; code: string; name: string } | null;
  total_stops: number;
  visited_stops: number;
  skipped_stops?: number;
  pending_stops?: number;
  total_gross_liters: number;
  total_at_13ts_liters: number;
  stops?: Array<{
    id: string;
    planned_sequence: number;
    status: string;
    skip_reason?: string | null;
    shop?: {
      id: string;
      shop_code: string;
      shop_name: string;
      owner_name: string;
    } | null;
    collection?: {
      gross_liters: number;
      at_13ts_liters?: number;
    } | null;
  }>;
};

interface ZmccArrivalsWorkspaceProps {
  currentUser: User | null;
  activeTab?: MainTab;
  onTabChange?: (tab: MainTab) => void;
  hideTabBar?: boolean;
}

/** Unique client_event_id used to make arrival/exit submissions idempotent. */
function generateClientEventId(prefix: string) {
  const random = Math.random().toString(36).substring(2, 10);
  return `${prefix}-${Date.now()}-${random}`;
}

export const ZmccArrivalsWorkspace: React.FC<ZmccArrivalsWorkspaceProps> = ({
  currentUser,
  activeTab: controlledTab,
  onTabChange,
  hideTabBar = true,
}) => {
  const toast = useToast();
  const isSuperAdmin = currentUser?.role === 'SUPER_ADMIN';
  const isDataExecutive = currentUser?.role === 'DATA_EXECUTIVE';
  const isZmccManager = currentUser?.role === 'ZMCC_MANAGER';
  // PHE Operator, MDO and every role above them can record arrivals (server checks again).
  const canSubmit = !!currentUser && canActAs(currentUser.role, 'PHE_OPERATOR');
  const canDirectCorrect = isDataExecutive || isSuperAdmin;
  const canCorrect = canDirectCorrect;

  const [requestModalState, setRequestModalState] = useState<{
    isOpen: boolean;
    module: string;
    recordId: string;
    label: string;
    fields: EditableFieldOption[];
  }>({
    isOpen: false,
    module: '',
    recordId: '',
    label: '',
    fields: [],
  });

  const openRequestCorrection = (type: 'MOT' | 'CONTRACTOR' | 'LOCAL_SUPPLIER', record: MotArrivalRow | ContractorArrivalRow | LocalSupplierArrivalRow) => {
    const fields: EditableFieldOption[] = [];
    let moduleName = 'ZMCC_MOT_ARRIVAL';
    let label = `Arrival #${record.id}`;

    if (type === 'MOT') {
      const r = record as MotArrivalRow;
      moduleName = 'ZMCC_MOT_ARRIVAL';
      label = `MOT Arrival (Token: ${r.zmcc_token || r.id})`;
      fields.push({ field: 'raw_milk_token_number', label: 'Token Number', currentValue: r.raw_milk_token_number, type: 'text' });
    } else if (type === 'CONTRACTOR') {
      const r = record as ContractorArrivalRow;
      moduleName = 'ZMCC_CONTRACTOR_ARRIVAL';
      label = `Contractor Arrival (Token: ${r.zmcc_token || r.id})`;
      fields.push({ field: 'rmr_number', label: 'RMR Number', currentValue: r.rmr_number, type: 'text' });
      fields.push({ field: 'vehicle_number', label: 'Vehicle Number', currentValue: r.vehicle_number, type: 'text' });
    } else {
      const r = record as LocalSupplierArrivalRow;
      moduleName = 'ZMCC_LOCAL_SUPPLIER_ARRIVAL';
      label = `Local Supplier Arrival (Token: ${r.zmcc_token || r.id})`;
      fields.push({ field: 'raw_milk_token_number', label: 'Token Number', currentValue: r.raw_milk_token_number, type: 'text' });
      fields.push({ field: 'rmr_number', label: 'RMR Number', currentValue: r.rmr_number, type: 'text' });
    }

    setRequestModalState({
      isOpen: true,
      module: moduleName,
      recordId: String(record.id),
      label,
      fields,
    });
  };

  const [internalTab, setInternalTab] = useState<MainTab>(canSubmit ? 'MOT_ARRIVAL' : 'HISTORY');
  const activeTab = controlledTab || internalTab;

  const setActiveTab = (tab: MainTab) => {
    setInternalTab(tab);
    if (onTabChange) onTabChange(tab);
  };

  // MOT Arrival Form State
  const [arrivingJourneys, setArrivingJourneys] = useState<ArrivingJourney[]>([]);
  const [loadingJourneys, setLoadingJourneys] = useState(canSubmit);
  const [selectedJourney, setSelectedJourney] = useState<ArrivingJourney | null>(null);
  const [rawMilkTokenNumber, setRawMilkTokenNumber] = useState('');
  const [rawMilkTokenPolicyMode, setRawMilkTokenPolicyMode] = useState<'REQUIRED' | 'OPTIONAL' | 'DISABLED'>('REQUIRED');
  const [motArrivalTimestamp, setMotArrivalTimestamp] = useState(() =>
    toDatetimeLocalInput(new Date())
  );
  const [motGps, setMotGps] = useState<{ lat: number | null; lng: number | null; acc: number | null }>({
    lat: null,
    lng: null,
    acc: null,
  });
  const [motEventId, setMotEventId] = useState(() => generateClientEventId('mot-arr'));
  const [motSubmitting, setMotSubmitting] = useState(false);
  const [motSuccessResult, setMotSuccessResult] = useState<MotArrivalRow | null>(null);
  const [motError, setMotError] = useState<string | null>(null);

  // HC Supplier Arrival Form State
  const [localSuppliers, setLocalSuppliers] = useState<LocalSupplierRow[]>([]);
  const [loadingLocalSuppliers, setLoadingLocalSuppliers] = useState(canSubmit);
  const [availableSources, setAvailableSources] = useState<Array<{ id: string; erp_code: string; name: string }>>([]);
  const [selectedMilkSourceId, setSelectedMilkSourceId] = useState('');
  const [supplierSearchTerm, setSupplierSearchTerm] = useState('');
  const [selectedLocalSupplierId, setSelectedLocalSupplierId] = useState('');
  const [localSupplierRawMilkTokenNumber, setLocalSupplierRawMilkTokenNumber] = useState('');
  const [localSupplierVehicleNumber, setLocalSupplierVehicleNumber] = useState('');
  const [localSupplierArrivalTimestamp, setLocalSupplierArrivalTimestamp] = useState(() =>
    toDatetimeLocalInput(new Date())
  );
  const [localSupplierGps, setLocalSupplierGps] = useState<{ lat: number | null; lng: number | null; acc: number | null }>({
    lat: null,
    lng: null,
    acc: null,
  });
  const [localSupplierEventId, setLocalSupplierEventId] = useState(() => generateClientEventId('ls-arr'));
  const [localSupplierSubmitting, setLocalSupplierSubmitting] = useState(false);
  const [localSupplierSuccessResult, setLocalSupplierSuccessResult] = useState<LocalSupplierArrivalRow | null>(null);
  const [localSupplierError, setLocalSupplierError] = useState<string | null>(null);

  // Inside Vehicles State & Gate Exit Modal
  const [insideVehicles, setInsideVehicles] = useState<InsideVehicle[]>([]);
  const [insideHasMore, setInsideHasMore] = useState(false);
  const [insideTotalCount, setInsideTotalCount] = useState(0);
  const [loadingInside, setLoadingInside] = useState(true);
  const [insidePage, setInsidePage] = useState(1);

  // Inline "Add Local Supplier" Modal State
  const [showAddSupplierModal, setShowAddSupplierModal] = useState(false);
  const [newSupplierName, setNewSupplierName] = useState('');
  const [newSupplierPhone, setNewSupplierPhone] = useState('');
  const [newSupplierCnic, setNewSupplierCnic] = useState('');
  const [newSupplierErpRef, setNewSupplierErpRef] = useState('');
  const [addSupplierSubmitting, setAddSupplierSubmitting] = useState(false);
  const [addSupplierError, setAddSupplierError] = useState<string | null>(null);

  // History State
  const [historyType, setHistoryType] = useState<'ALL' | 'MOT' | 'CONTRACTOR' | 'LOCAL_SUPPLIER'>('ALL');
  const [historyDate, setHistoryDate] = useState('');
  const [historySearch, setHistorySearch] = useState('');
  const [historyPage, setHistoryPage] = useState(1);
  const [historyPageSize] = useState(20);
  const [historyTotalPages, setHistoryTotalPages] = useState(1);
  const [historyTotalRecords, setHistoryTotalRecords] = useState(0);
  const [motArrivals, setMotArrivals] = useState<MotArrivalRow[]>([]);
  const [contractorArrivals, setContractorArrivals] = useState<ContractorArrivalRow[]>([]);
  const [localSupplierArrivals, setLocalSupplierArrivals] = useState<LocalSupplierArrivalRow[]>([]);
  const [refreshingHistory, setLoadingHistory] = useState(false);

  // Correction Modal State
  const [correctionTarget, setCorrectionTarget] = useState<CorrectionTarget | null>(null);
  const [corrReason, setCorrReason] = useState('');
  const [corrToken, setCorrToken] = useState('');
  const [corrRmr, setCorrRmr] = useState('');
  const [corrVehicle, setCorrVehicle] = useState('');
  const [corrLocalSupplierId, setCorrLocalSupplierId] = useState('');
  const [corrMilkSourceId, setCorrMilkSourceId] = useState('');
  const [corrTimestamp, setCorrTimestamp] = useState('');
  const [corrLat, setCorrLat] = useState<string>('');
  const [corrLng, setCorrLng] = useState<string>('');
  const [corrAcc, setCorrAcc] = useState<string>('');
  const [corrSubmitting, setCorrSubmitting] = useState(false);
  const [corrError, setCorrError] = useState<string | null>(null);


  const initMotForm = useCallback(() => {
    setSelectedJourney(null);
    setRawMilkTokenNumber('');
    setMotArrivalTimestamp(toDatetimeLocalInput(new Date()));
    setMotGps({ lat: null, lng: null, acc: null });
    setMotEventId(generateClientEventId('mot-arr'));
    setMotError(null);
  }, []);

  const initLocalSupplierForm = useCallback(() => {
    setSelectedLocalSupplierId('');
    setSelectedMilkSourceId('');
    setSupplierSearchTerm('');
    setLocalSupplierRawMilkTokenNumber('');
    setLocalSupplierVehicleNumber('');
    setLocalSupplierArrivalTimestamp(toDatetimeLocalInput(new Date()));
    setLocalSupplierGps({ lat: null, lng: null, acc: null });
    setLocalSupplierEventId(generateClientEventId('ls-arr'));
    setLocalSupplierError(null);
  }, []);

  // Fetch arriving journeys for MOT
  const loadArrivingJourneys = useCallback(
    () =>
      fetch('/api/zmcc/arrivals/arriving-journeys')
        .then(async (res) => {
          if (res.ok) {
            const data = await res.json();
            setArrivingJourneys(data || []);
          }
        })
        .catch((err) => {
          console.error('Failed to fetch arriving journeys', err);
        })
        .finally(() => {
          setLoadingJourneys(false);
        }),
    []
  );

  const fetchArrivingJourneys = () => {
    setLoadingJourneys(true);
    return loadArrivingJourneys();
  };

  // Fetch local suppliers for directory selection
  const loadLocalSuppliers = useCallback(
    () =>
      fetch('/api/zmcc/local-suppliers?is_active=true')
        .then(async (res) => {
          if (res.ok) {
            const data = await res.json();
            setLocalSuppliers(data.suppliers || []);
          }
        })
        .catch((err) => {
          console.error('Failed to fetch local suppliers', err);
        })
        .finally(() => {
          setLoadingLocalSuppliers(false);
        }),
    []
  );

  // Fetch available milk sources for ZMCC
  const loadAvailableSources = useCallback(() => {
    const zmccId = currentUser?.procurement_source?.id;
    if (!zmccId) return;
    fetch(`/api/sources/available?zmcc_id=${zmccId}`)
      .then(async (res) => {
        if (res.ok) {
          const data = await res.json();
          setAvailableSources(data.sources || []);
        }
      })
      .catch((err) => {
        console.error('Failed to fetch available sources', err);
      });
  }, [currentUser?.procurement_source?.id]);

  // Fetch inside vehicles
  const loadInsideVehicles = useCallback(
    () =>
      fetch('/api/zmcc/arrivals/inside')
        .then(async (res) => {
          if (res.ok) {
            const data = await res.json();
            setInsideVehicles(data.vehicles || []);
            setInsideHasMore(Boolean(data.has_more));
            setInsideTotalCount(data.total_count ?? (data.vehicles || []).length);
          }
        })
        .catch((err) => {
          console.error('Failed to fetch vehicles inside ZMCC', err);
        })
        .finally(() => {
          setLoadingInside(false);
        }),
    []
  );

  const fetchInsideVehicles = () => {
    setLoadingInside(true);
    return loadInsideVehicles();
  };

  // Fetch history
  const historyParams = new URLSearchParams();
  if (historyDate) historyParams.set('date', historyDate);
  if (historySearch) historyParams.set('search', historySearch);
  historyParams.set('page', String(historyPage));
  historyParams.set('pageSize', String(historyPageSize));
  const historyQuery = historyParams.toString();
  // Filters whose history request last settled; any other query means a fetch is in flight.
  const [loadedHistoryQuery, setLoadedHistoryQuery] = useState<string | null>(null);
  const loadingHistory = refreshingHistory || loadedHistoryQuery !== historyQuery;

  const loadHistory = useCallback(
    () =>
      Promise.all([
        fetch(`/api/zmcc/arrivals/mot?${historyQuery}`),
        fetch(`/api/zmcc/arrivals/contractor?${historyQuery}`),
        fetch(`/api/zmcc/arrivals/local-supplier?${historyQuery}`),
      ])
        .then(async ([motRes, conRes, lsRes]) => {
          let totalCount = 0;
          let maxPages = 1;

          if (motRes.ok) {
            const motData = await motRes.json();
            setMotArrivals(motData.items || []);
            if (motData.total) totalCount += motData.total;
            if (motData.totalPages && motData.totalPages > maxPages) maxPages = motData.totalPages;
          }
          if (conRes.ok) {
            const conData = await conRes.json();
            setContractorArrivals(conData.items || []);
            if (conData.total) totalCount += conData.total;
            if (conData.totalPages && conData.totalPages > maxPages) maxPages = conData.totalPages;
          }
          if (lsRes.ok) {
            const lsData = await lsRes.json();
            setLocalSupplierArrivals(lsData.items || []);
            if (lsData.total) totalCount += lsData.total;
            if (lsData.totalPages && lsData.totalPages > maxPages) maxPages = lsData.totalPages;
          }

          setHistoryTotalRecords(totalCount);
          setHistoryTotalPages(maxPages);
        })
        .catch((err) => {
          console.error('Failed to fetch arrival history', err);
        })
        .finally(() => {
          setLoadingHistory(false);
          setLoadedHistoryQuery(historyQuery);
        }),
    [historyQuery]
  );

  const fetchHistory = () => {
    setLoadingHistory(true);
    return loadHistory();
  };

  // Fetch paper reference policies
  const loadPolicies = useCallback(
    () =>
      fetch('/api/paper-reference-policies')
        .then(async (res) => {
          if (res.ok) {
            const data = await res.json();
            const rmtPolicy = (data.policies || []).find((p: { referenceType: string; policyMode?: 'REQUIRED' | 'OPTIONAL' | 'DISABLED' }) => p.referenceType === 'RAW_MILK_TOKEN');
            if (rmtPolicy?.policyMode) {
              setRawMilkTokenPolicyMode(rmtPolicy.policyMode);
            }
          }
        })
        .catch((err) => {
          console.error('Failed to fetch paper reference policies', err);
        }),
    []
  );

  useEffect(() => {
    loadPolicies();
    if (canSubmit) {
      loadArrivingJourneys();
      loadLocalSuppliers();
      loadAvailableSources();
    }
  }, [canSubmit, loadPolicies, loadArrivingJourneys, loadLocalSuppliers, loadAvailableSources]);

  // Initial load; the history list also reloads whenever its filters change.
  useEffect(() => {
    loadInsideVehicles();
  }, [loadInsideVehicles]);

  useEffect(() => {
    loadHistory();
  }, [loadHistory]);

  // Refresh the list behind a tab when it becomes active (also for parent-controlled tabs).
  const refreshTabData = useEffectEvent((tab: MainTab) => {
    if (tab === 'INSIDE_ZMCC') {
      loadInsideVehicles();
    } else if (tab === 'HISTORY') {
      loadHistory();
    }
  });

  const lastRefreshedTab = useRef(activeTab);
  useEffect(() => {
    // The initial tab is covered by the initial loads above.
    if (lastRefreshedTab.current === activeTab) return;
    lastRefreshedTab.current = activeTab;
    refreshTabData(activeTab);
  }, [activeTab]);

  // GPS capture handler with progressive offline fallback
  const captureGps = async (target: 'MOT' | 'LOCAL_SUPPLIER') => {
    try {
      const res = await acquireRobustGps({
        facilityCode: currentUser?.procurement_source?.code,
        allowFacilityFallback: true,
        maxCacheAgeMs: 30_000,
      });

      if (res.location) {
        const coords = {
          lat: Number(res.location.latitude.toFixed(7)),
          lng: Number(res.location.longitude.toFixed(7)),
          acc: res.location.accuracy != null ? Number(res.location.accuracy.toFixed(2)) : null,
        };
        if (target === 'MOT') setMotGps(coords);
        else setLocalSupplierGps(coords);

        if (res.status === 'FALLBACK') {
          toast.showInfo(`Using ${res.location.label || 'offline fallback'} coordinates.`);
        } else {
          toast.showSuccess('GPS coordinates captured successfully.');
        }
      } else {
        toast.showWarning(res.errorMsg || 'Failed to capture GPS. Arrival can proceed without GPS.');
        if (target === 'MOT') setMotGps({ lat: null, lng: null, acc: null });
        else setLocalSupplierGps({ lat: null, lng: null, acc: null });
      }
    } catch {
      toast.showWarning('GPS unavailable. Arrival can proceed without GPS.');
      if (target === 'MOT') setMotGps({ lat: null, lng: null, acc: null });
      else setLocalSupplierGps({ lat: null, lng: null, acc: null });
    }
  };

  // Submit MOT Arrival
  const handleMotSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedJourney) {
      setMotError('Please select a journey.');
      return;
    }
    if (rawMilkTokenPolicyMode === 'REQUIRED' && !rawMilkTokenNumber.trim()) {
      setMotError('PHE Raw Milk Token is REQUIRED by operational policy.');
      return;
    }
    if (rawMilkTokenPolicyMode === 'DISABLED' && rawMilkTokenNumber.trim()) {
      setMotError('PHE Raw Milk Token is DISABLED by operational policy. Please clear the field.');
      return;
    }
    setMotSubmitting(true);
    setMotError(null);
    try {
      const res = await fetch('/api/zmcc/arrivals/mot', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          journey_id: selectedJourney.id,
          raw_milk_token_number: rawMilkTokenNumber.trim() || undefined,
          arrival_timestamp: datetimeLocalToIso(motArrivalTimestamp) || new Date(motArrivalTimestamp).toISOString(),
          client_event_id: motEventId,
          phe_latitude: motGps.lat,
          phe_longitude: motGps.lng,
          phe_gps_accuracy: motGps.acc,
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        setMotError(data.error || 'Failed to record MOT arrival.');
      } else {
        setMotSuccessResult(data);
        fetchArrivingJourneys();
        fetchInsideVehicles();
        fetchHistory();
      }
    } catch (err) {
      setMotError(getErrorMessage(err) || 'An unexpected error occurred.');
    } finally {
      setMotSubmitting(false);
    }
  };

  // Fast inline Add Local Supplier handler
  const handleCreateLocalSupplier = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newSupplierName.trim() || !newSupplierPhone.trim() || !newSupplierCnic.trim()) {
      setAddSupplierError('Supplier name, phone number, and CNIC are required.');
      return;
    }
    setAddSupplierSubmitting(true);
    setAddSupplierError(null);
    try {
      const res = await fetch('/api/zmcc/local-suppliers', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: newSupplierName.trim(),
          phone: newSupplierPhone.trim(),
          cnic: newSupplierCnic.trim(),
          erp_reference: newSupplierErpRef.trim() || undefined,
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        setAddSupplierError(data.error || 'Failed to create local supplier.');
      } else {
        const supplier = data.supplier;
        if (supplier.approval_status === 'PENDING_APPROVAL') {
          toast.showInfo(`HC "${supplier.name}" saved. It is waiting for Zonal Manager approval.`);
        } else {
          toast.showSuccess(`Local supplier "${supplier.name}" onboarded (${supplier.local_supplier_code})`);
        }
        setShowAddSupplierModal(false);
        setNewSupplierName('');
        setNewSupplierPhone('');
        setNewSupplierCnic('');
        setNewSupplierErpRef('');
        setSupplierSearchTerm('');
        setLocalSuppliers((prev) => [supplier, ...prev]);
        if (supplier.approval_status === 'ACTIVE') setSelectedLocalSupplierId(supplier.id);
      }
    } catch (err) {
      setAddSupplierError(getErrorMessage(err) || 'An unexpected error occurred.');
    } finally {
      setAddSupplierSubmitting(false);
    }
  };

  // Submit HC Supplier Arrival
  const handleLocalSupplierSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedLocalSupplierId) {
      setLocalSupplierError('Please select an HC supplier.');
      return;
    }
    if (!localSupplierRawMilkTokenNumber.trim()) {
      setLocalSupplierError('Raw Milk Token number is required.');
      return;
    }
    if (!localSupplierVehicleNumber.trim()) {
      setLocalSupplierError('Vehicle number is required.');
      return;
    }
    setLocalSupplierSubmitting(true);
    setLocalSupplierError(null);
    try {
      const res = await fetch('/api/zmcc/arrivals/local-supplier', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          local_supplier_id: selectedLocalSupplierId,
          milk_source_id: selectedMilkSourceId ? selectedMilkSourceId : null,
          raw_milk_token_number: localSupplierRawMilkTokenNumber.trim(),
          vehicle_number: localSupplierVehicleNumber.trim().toUpperCase(),
          arrival_timestamp: datetimeLocalToIso(localSupplierArrivalTimestamp) || new Date(localSupplierArrivalTimestamp).toISOString(),
          client_event_id: localSupplierEventId,
          phe_latitude: localSupplierGps.lat,
          phe_longitude: localSupplierGps.lng,
          phe_gps_accuracy: localSupplierGps.acc,
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        setLocalSupplierError(data.error || 'Failed to record HC supplier arrival.');
      } else {
        setLocalSupplierSuccessResult(data);
        fetchInsideVehicles();
        fetchHistory();
      }
    } catch (err) {
      setLocalSupplierError(getErrorMessage(err) || 'An unexpected error occurred.');
    } finally {
      setLocalSupplierSubmitting(false);
    }
  };

  // Open Correction Modal
  const openCorrectionModal = (target: CorrectionTarget) => {
    const { record } = target;
    setCorrectionTarget(target);
    setCorrReason('');
    setCorrError(null);
    setCorrTimestamp(record.arrival_timestamp ? toDatetimeLocalInput(record.arrival_timestamp) : '');
    setCorrLat(record.phe_latitude != null ? String(record.phe_latitude) : '');
    setCorrLng(record.phe_longitude != null ? String(record.phe_longitude) : '');
    setCorrAcc(record.phe_gps_accuracy != null ? String(record.phe_gps_accuracy) : '');

    if (target.type === 'MOT') {
      setCorrToken(target.record.raw_milk_token_number || '');
    } else if (target.type === 'CONTRACTOR') {
      setCorrRmr(target.record.rmr_number || '');
      setCorrVehicle(target.record.vehicle_number || '');
    } else if (target.type === 'LOCAL_SUPPLIER') {
      setCorrLocalSupplierId(target.record.local_supplier_id ? String(target.record.local_supplier_id) : '');
      setCorrMilkSourceId(target.record.milk_source_id ? String(target.record.milk_source_id) : '');
      setCorrToken(target.record.raw_milk_token_number || '');
      setCorrRmr('');
      setCorrVehicle(target.record.vehicle_number || '');
    }
  };

  // Submit Correction
  const handleCorrectionSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!correctionTarget) return;
    if (!corrReason.trim() || corrReason.trim().length < 5) {
      setCorrError('Reason is mandatory (at least 5 characters).');
      return;
    }
    setCorrSubmitting(true);
    setCorrError(null);
    try {
      let url = '';
      if (correctionTarget.type === 'MOT') {
        url = `/api/zmcc/arrivals/mot/${correctionTarget.record.id}`;
      } else if (correctionTarget.type === 'CONTRACTOR') {
        url = `/api/zmcc/arrivals/contractor/${correctionTarget.record.id}`;
      } else {
        url = `/api/zmcc/arrivals/local-supplier/${correctionTarget.record.id}`;
      }

      const payload: Record<string, unknown> = {
        reason: corrReason.trim(),
        arrival_timestamp: datetimeLocalToIso(corrTimestamp) || new Date(corrTimestamp).toISOString(),
      };

      if (correctionTarget.type === 'MOT') {
        if (corrToken.trim()) {
          payload.raw_milk_token_number = corrToken.trim();
        }
      } else if (correctionTarget.type === 'CONTRACTOR') {
        payload.rmr_number = corrRmr.trim();
        payload.vehicle_number = corrVehicle.trim().toUpperCase();
      } else if (correctionTarget.type === 'LOCAL_SUPPLIER') {
        payload.local_supplier_id = corrLocalSupplierId || undefined;
        payload.milk_source_id = corrMilkSourceId ? corrMilkSourceId : null;
        payload.raw_milk_token_number = corrToken.trim();
        payload.vehicle_number = corrVehicle.trim().toUpperCase();
      }

      if (corrLat && corrLng) {
        payload.phe_latitude = Number(corrLat);
        payload.phe_longitude = Number(corrLng);
        if (corrAcc) payload.phe_gps_accuracy = Number(corrAcc);
      }

      const res = await fetch(url, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });

      const data = await res.json();
      if (!res.ok) {
        setCorrError(data.error || 'Failed to apply correction.');
      } else {
        toast.showSuccess('Arrival correction applied successfully.');
        setCorrectionTarget(null);
        fetchHistory();
      }
    } catch (err) {
      setCorrError(getErrorMessage(err) || 'An unexpected error occurred.');
    } finally {
      setCorrSubmitting(false);
    }
  };

  return (
    <div className="space-y-6">
      {!hideTabBar && (
        <SegmentedTabs
          label="Arrival views"
          value={activeTab}
          onValueChange={setActiveTab}
          tabs={[
            ...(canSubmit
              ? [
                  { value: 'MOT_ARRIVAL' as const, label: 'MOT arrival', icon: Truck },
                  { value: 'LOCAL_SUPPLIER_ARRIVAL' as const, label: 'HC supplier arrival', icon: Users },
                ]
              : []),
            { value: 'HISTORY' as const, label: 'History & corrections', icon: Clock },
          ]}
        />
      )}

      {activeTab === 'MOT_ARRIVAL' && canSubmit && (
        <div className="space-y-6 animate-panel-in">
          {motSuccessResult ? (
            <div className="bg-emerald-50 border-2 border-emerald-500/40 rounded-xl p-6 space-y-4">
              <div className="flex items-center space-x-3 text-emerald-800">
                <CheckCircle2 className="w-8 h-8 text-emerald-600 shrink-0" />
                <div>
                  <h3 className="text-base font-semibold">MOT Arrival Recorded & Journey Completed!</h3>
                </div>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-4 bg-white p-4 rounded-xl border border-emerald-200">
                <div>
                  <span className="text-xs font-semibold text-slate-500 uppercase tracking-wider">
                    Raw Milk Token
                  </span>
                  <div className="text-base tabular-nums font-semibold text-slate-900 mt-0.5">
                    {motSuccessResult.raw_milk_token_number || '—'}
                  </div>
                  {motSuccessResult.route_milk_token && (
                    <div className="text-xs text-slate-500 mt-0.5">
                      <span className="font-semibold">Legacy Route Milk Token:</span>{' '}
                      <span className="tabular-nums">{motSuccessResult.route_milk_token}</span>
                    </div>
                  )}
                </div>
                <div>
                  <span className="text-xs font-semibold text-emerald-700 uppercase tracking-wider">Generated ZMCC Token</span>
                  <div className="text-base tabular-nums font-semibold text-emerald-700 mt-0.5">
                    {motSuccessResult.zmcc_token}
                  </div>
                </div>
                <div>
                  <span className="text-xs font-semibold text-slate-500 uppercase tracking-wider">Arrival Time</span>
                  <div className="text-xs font-semibold text-slate-800 mt-0.5">
                    {new Date(motSuccessResult.arrival_timestamp).toLocaleString('en-GB', { timeZone: 'Asia/Karachi' })} PKT
                  </div>
                </div>
                <div>
                  <span className="text-xs font-semibold text-slate-500 uppercase tracking-wider">Journey Number</span>
                  <div className="text-xs font-semibold text-slate-800 mt-0.5">
                    {motSuccessResult.journey?.journey_number || selectedJourney?.journey_number}
                  </div>
                </div>
              </div>

              {motSuccessResult.journey?.summary && (
                <div className="p-4 rounded-xl bg-white border border-emerald-200 space-y-3">
                  <div className="flex items-center justify-between">
                    <span className="text-xs font-semibold uppercase tracking-wider text-slate-700">
                      MOT Journey Final Summary (v{motSuccessResult.journey.summary.summary_version}, Rev #{motSuccessResult.journey.summary.revision})
                    </span>
                    <span className="text-xs font-semibold text-slate-500">
                      Ended: {new Date(motSuccessResult.journey.summary.journey_ended_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })} PKT
                    </span>
                  </div>

                  <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 text-center">
                    <div className="p-2 bg-slate-50 rounded-lg border border-border">
                      <div className="text-xs uppercase font-semibold text-slate-500">Assigned Shops</div>
                      <div className="text-sm font-semibold text-slate-900">{motSuccessResult.journey.summary.assigned_shop_count}</div>
                    </div>
                    <div className="p-2 bg-slate-50 rounded-lg border border-border">
                      <div className="text-xs uppercase font-semibold text-emerald-700">Collected Shops</div>
                      <div className="text-sm font-semibold text-emerald-800">{motSuccessResult.journey.summary.collected_shop_count}</div>
                    </div>
                    <div className="p-2 bg-slate-50 rounded-lg border border-border">
                      <div className="text-xs uppercase font-semibold text-amber-700">Skipped Shops</div>
                      <div className="text-sm font-semibold text-amber-800">{motSuccessResult.journey.summary.skipped_shop_count}</div>
                    </div>
                    <div className="p-2 bg-slate-50 rounded-lg border border-border">
                      <div className="text-xs uppercase font-semibold text-blue-700">Pending Sync</div>
                      <div className="text-sm font-semibold text-blue-800">{motSuccessResult.journey.summary.pending_shop_count}</div>
                    </div>
                  </div>

                  <div className="grid grid-cols-2 sm:grid-cols-6 gap-2 text-center">
                    <div className="p-2 bg-slate-50 rounded-lg border border-border">
                      <div className="text-xs uppercase font-semibold text-slate-500">Gross Liters</div>
                      <div className="text-xs tabular-nums font-semibold text-slate-900">
                        {Number(motSuccessResult.journey.summary.total_gross_liters).toFixed(2)} L
                      </div>
                    </div>
                    <div className="p-2 bg-slate-50 rounded-lg border border-border">
                      <div className="text-xs uppercase font-semibold text-slate-500">@13TS Liters</div>
                      <div className="text-xs tabular-nums font-semibold text-slate-900">
                        {Number(motSuccessResult.journey.summary.total_at_13ts_liters).toFixed(2)} L
                      </div>
                    </div>
                    <div className="p-2 bg-slate-50 rounded-lg border border-border">
                      <div className="text-xs uppercase font-semibold text-slate-500">Weighted LR</div>
                      <div className="text-xs tabular-nums font-semibold text-slate-800">
                        {motSuccessResult.journey.summary.weighted_avg_lr != null ? Number(motSuccessResult.journey.summary.weighted_avg_lr).toFixed(2) : '—'}
                      </div>
                    </div>
                    <div className="p-2 bg-slate-50 rounded-lg border border-border">
                      <div className="text-xs uppercase font-semibold text-slate-500">Weighted Fat</div>
                      <div className="text-xs tabular-nums font-semibold text-slate-800">
                        {motSuccessResult.journey.summary.weighted_avg_fat != null ? `${Number(motSuccessResult.journey.summary.weighted_avg_fat).toFixed(2)}%` : '—'}
                      </div>
                    </div>
                    <div className="p-2 bg-slate-50 rounded-lg border border-border">
                      <div className="text-xs uppercase font-semibold text-slate-500">Weighted SNF</div>
                      <div className="text-xs tabular-nums font-semibold text-slate-800">
                        {motSuccessResult.journey.summary.weighted_avg_snf != null ? `${Number(motSuccessResult.journey.summary.weighted_avg_snf).toFixed(2)}%` : '—'}
                      </div>
                    </div>
                    <div className="p-2 bg-slate-50 rounded-lg border border-border">
                      <div className="text-xs uppercase font-semibold text-slate-500">Weighted TS</div>
                      <div className="text-xs tabular-nums font-semibold text-slate-800">
                        {motSuccessResult.journey.summary.weighted_avg_ts != null ? `${Number(motSuccessResult.journey.summary.weighted_avg_ts).toFixed(2)}%` : '—'}
                      </div>
                    </div>
                  </div>

                  {motSuccessResult.journey.summary.pending_shop_count > 0 && (
                    <div className="flex items-center space-x-2 text-xs font-semibold text-blue-800 bg-blue-50 p-2.5 rounded-lg border border-blue-200">
                      <Clock className="w-4 h-4 shrink-0 text-blue-600" />
                      <span>
                        Waiting for delayed collection sync: {motSuccessResult.journey.summary.pending_shop_count} assigned shop record(s) are still unresolved.
                      </span>
                    </div>
                  )}
                </div>
              )}

              <button
                type="button"
                onClick={() => {
                  setMotSuccessResult(null);
                  initMotForm();
                }}
                className="px-4 py-2 bg-emerald-600 hover:bg-emerald-700 text-white rounded-xl text-xs font-semibold transition-all"
              >
                Record Another Arrival
              </button>
            </div>
          ) : (
            <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
              <div className="lg:col-span-6 space-y-4">
                <div className="flex items-center justify-between">
                  <h3 className="text-sm font-semibold text-slate-900">
                    Active Collecting Journeys ({arrivingJourneys.length})
                  </h3>
                  <button
                    type="button"
                    onClick={fetchArrivingJourneys}
                    className="flex items-center gap-1.5 px-2.5 py-1 text-xs font-semibold text-slate-600 hover:text-slate-900 rounded-lg hover:bg-slate-100"
                  >
                    {loadingJourneys && <Loader2 className="w-3.5 h-3.5 animate-spin" />}
                    Refresh
                  </button>
                </div>

                {arrivingJourneys.length === 0 ? (
                  <div className="bg-white rounded-xl border border-border p-8 text-center text-xs text-slate-500">
                    No MOT journeys currently in COLLECTING status for this ZMCC.
                  </div>
                ) : (
                  <div className="space-y-3">
                    {arrivingJourneys.map((j) => {
                      const isSelected = selectedJourney?.id === j.id;
                      return (
                        <div
                          role="button"
                          tabIndex={0}
                          onKeyDown={onActivateKey}
                          key={j.id}
                          onClick={() => setSelectedJourney(j)}
                          className={`p-4 rounded-xl border transition-all cursor-pointer ${
                            isSelected
                              ? 'bg-blue-50/60 border-primary shadow-2xs'
                              : 'bg-white border-border hover:border-slate-300'
                          }`}
                        >
                          <div className="flex items-center justify-between mb-2">
                            <span className="tabular-nums text-xs font-semibold text-primary">
                              {j.journey_number}
                            </span>
                            <span className="text-xs font-semibold px-2 py-0.5 rounded-full bg-blue-100 text-blue-800">
                              COLLECTING
                            </span>
                          </div>
                          <div className="text-xs font-semibold text-slate-800">
                            {j.route?.route_code} · {j.route?.name}
                          </div>
                          <div className="text-xs text-slate-600 mt-1 flex flex-wrap gap-x-4">
                            <span>Vehicle: <strong>{j.mot_vehicle?.vehicle_number}</strong></span>
                            <span>MOT: <strong>{j.mot_profile?.name}</strong></span>
                          </div>
                          <div className="text-xs text-slate-500 mt-2 flex flex-wrap items-center justify-between gap-1 border-t border-slate-100 pt-2">
                            <div className="flex items-center space-x-2 text-[11px]">
                              <span>Assigned: <strong>{j.total_stops}</strong></span>
                              <span>·</span>
                              <span className="text-emerald-700">Collected: <strong>{j.visited_stops}</strong></span>
                              <span>·</span>
                              <span className="text-amber-700">Skipped: <strong>{j.skipped_stops || 0}</strong></span>
                            </div>
                            <span className="font-semibold text-slate-800">{j.total_gross_liters} L</span>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>

              <div className="lg:col-span-6 bg-white rounded-xl border border-border p-6 shadow-2xs space-y-4">
                <h3 className="text-sm font-semibold text-slate-900 border-b pb-2">
                  Record MOT Arrival at ZMCC
                </h3>

                {motError && (
                  <div className="p-3 bg-rose-50 border border-rose-200 text-rose-800 text-xs rounded-xl flex items-center space-x-2">
                    <AlertCircle className="w-4 h-4 shrink-0" />
                    <span>{motError}</span>
                  </div>
                )}

                {!selectedJourney ? (
                  <div className="p-8 text-center text-xs text-slate-400">
                    Select a journey from the left list to record its arrival.
                  </div>
                ) : (
                  <form onSubmit={handleMotSubmit} className="space-y-4">
                    <div className="p-3 bg-slate-50 rounded-xl border border-slate-200 text-xs space-y-3">
                      <div className="flex items-center justify-between">
                        <span className="font-semibold text-slate-800 tabular-nums">
                          Journey #{selectedJourney.journey_number}
                        </span>
                        <span className="text-[11px] font-semibold text-slate-600">
                          {selectedJourney.route?.route_code} · {selectedJourney.route?.name}
                        </span>
                      </div>

                      <div className="grid grid-cols-2 gap-2 text-[11px] text-slate-600">
                        <div>Vehicle: <strong className="text-slate-900">{selectedJourney.mot_vehicle?.vehicle_number}</strong></div>
                        <div>MOT: <strong className="text-slate-900">{selectedJourney.mot_profile?.name}</strong></div>
                      </div>

                      <div className="grid grid-cols-4 gap-2 text-center pt-1 border-t border-slate-200">
                        <div className="p-2 bg-white rounded-lg border border-border">
                          <div className="text-[10px] uppercase font-semibold text-slate-500">Assigned</div>
                          <div className="text-xs font-semibold text-slate-900">{selectedJourney.total_stops}</div>
                        </div>
                        <div className="p-2 bg-white rounded-lg border border-border">
                          <div className="text-[10px] uppercase font-semibold text-emerald-700">Collected</div>
                          <div className="text-xs font-semibold text-emerald-800">{selectedJourney.visited_stops}</div>
                        </div>
                        <div className="p-2 bg-white rounded-lg border border-border">
                          <div className="text-[10px] uppercase font-semibold text-amber-700">Skipped</div>
                          <div className="text-xs font-semibold text-amber-800">{selectedJourney.skipped_stops || 0}</div>
                        </div>
                        <div className="p-2 bg-white rounded-lg border border-border">
                          <div className="text-[10px] uppercase font-semibold text-blue-700">Pending</div>
                          <div className="text-xs font-semibold text-blue-800">
                            {selectedJourney.pending_stops ?? Math.max(0, selectedJourney.total_stops - selectedJourney.visited_stops - (selectedJourney.skipped_stops || 0))}
                          </div>
                        </div>
                      </div>

                      {selectedJourney.stops && selectedJourney.stops.length > 0 && (
                        <div className="space-y-1.5 pt-2 border-t border-slate-200">
                          <div className="text-[11px] font-semibold text-slate-700">
                            Journey Stops ({selectedJourney.stops.length})
                          </div>
                          <div className="space-y-1.5 max-h-48 overflow-y-auto pr-1">
                            {selectedJourney.stops.map((stop) => (
                              <div
                                key={stop.id}
                                className="flex items-center justify-between p-2 rounded-lg bg-white border border-border text-xs"
                              >
                                <div className="flex items-center space-x-2">
                                  <span className="w-5 h-5 rounded-full bg-primary text-white text-[10px] font-semibold flex items-center justify-center shrink-0">
                                    {stop.planned_sequence}
                                  </span>
                                  <div>
                                    <div className="font-semibold text-slate-900 text-xs">
                                      {stop.shop?.shop_name || `Shop #${stop.planned_sequence}`}
                                    </div>
                                    <div className="text-[10px] text-slate-500">
                                      {stop.shop?.shop_code ? `${stop.shop.shop_code} · ` : ''}{stop.shop?.owner_name || '—'}
                                    </div>
                                  </div>
                                </div>
                                <div>
                                  {stop.status === 'VISITED' ? (
                                    <span className="px-2 py-0.5 rounded-full text-[10px] font-semibold uppercase bg-emerald-100 text-emerald-800 border border-emerald-300">
                                      {stop.collection?.gross_liters != null ? `${Number(stop.collection.gross_liters).toFixed(1)} L` : 'Visited'}
                                    </span>
                                  ) : stop.status === 'SKIPPED' ? (
                                    <span className="px-2 py-0.5 rounded-full text-[10px] font-semibold bg-amber-100 text-amber-900 border border-amber-300">
                                      SKIPPED {stop.skip_reason ? `· ${stop.skip_reason}` : ''}
                                    </span>
                                  ) : (
                                    <span className="px-2 py-0.5 rounded-full text-[10px] font-semibold uppercase bg-slate-100 text-slate-700 border border-slate-300">
                                      Pending
                                    </span>
                                  )}
                                </div>
                              </div>
                            ))}
                          </div>
                        </div>
                      )}
                    </div>

                    <div>
                      <label className="block text-xs font-semibold text-slate-700 mb-1">
                        Raw Milk Token No.
                        {rawMilkTokenPolicyMode === 'REQUIRED' && <span className="text-rose-500"> *</span>}
                        {rawMilkTokenPolicyMode === 'OPTIONAL' && <span className="text-slate-400 font-normal"> (Optional)</span>}
                        {rawMilkTokenPolicyMode === 'DISABLED' && <span className="text-amber-600 font-normal"> (Disabled by Policy)</span>}
                      </label>
                      <input
                        type="text"
                        pattern="[0-9]*"
                        inputMode="numeric"
                        disabled={rawMilkTokenPolicyMode === 'DISABLED'}
                        value={rawMilkTokenNumber}
                        onChange={(e) => setRawMilkTokenNumber(e.target.value.replace(/[^0-9]/g, ''))}
                        placeholder={rawMilkTokenPolicyMode === 'DISABLED' ? 'Disabled by operational policy' : 'e.g. 001924'}
                        className="w-full text-xs font-semibold px-3 py-2 border rounded-xl focus:ring-2 focus:ring-primary outline-hidden tabular-nums disabled:bg-slate-100 disabled:text-slate-400"
                      />
                    </div>

                    <div>
                      <label className="block text-xs font-semibold text-slate-700 mb-1">
                        Arrival Timestamp (PKT) <span className="text-rose-500">*</span>
                      </label>
                      <input
                        type="datetime-local"
                        value={motArrivalTimestamp}
                        onChange={(e) => setMotArrivalTimestamp(e.target.value)}
                        required
                        className="w-full text-xs font-semibold px-3 py-2 border rounded-xl focus:ring-2 focus:ring-primary outline-hidden"
                      />
                    </div>

                    <div>
                      <div className="flex items-center justify-between mb-1">
                        <label className="text-xs font-semibold text-slate-700">PHE GPS Coordinates (Optional)</label>
                        <button
                          type="button"
                          onClick={() => captureGps('MOT')}
                          className="text-xs font-semibold text-primary hover:underline flex items-center space-x-1"
                        >
                          <MapPin className="w-3 h-3" />
                          <span>Capture GPS</span>
                        </button>
                      </div>
                      <div className="text-xs text-slate-600 bg-slate-50 p-2.5 rounded-xl border tabular-nums">
                        {motGps.lat != null ? (
                          <span>Lat: {motGps.lat}, Lng: {motGps.lng} (±{motGps.acc}m)</span>
                        ) : (
                          <span className="text-slate-400">GPS not captured yet</span>
                        )}
                      </div>
                    </div>

                    <button
                      type="submit"
                      disabled={motSubmitting}
                      className="w-full py-2.5 bg-primary hover:bg-primary-hover text-white rounded-xl text-xs font-semibold transition-all disabled:opacity-50"
                    >
                      {motSubmitting ? 'Recording Arrival…' : 'Confirm Arrival & Generate ZMCC Token'}
                    </button>
                  </form>
                )}
              </div>
            </div>
          )}
        </div>
      )}

      {activeTab === 'INSIDE_ZMCC' && (
        <div className="space-y-4 animate-panel-in">
          <div className="flex items-center justify-between">
            <div>
              <h3 className="text-sm font-semibold text-slate-900">
                Vehicles Currently Inside ZMCC ({insideTotalCount > insideVehicles.length ? `${insideVehicles.length} of ${insideTotalCount}` : insideVehicles.length})
              </h3>
            </div>
            <button
              type="button"
              onClick={fetchInsideVehicles}
              className="flex items-center space-x-1.5 px-3 py-1.5 bg-white border border-border rounded-xl text-xs font-semibold text-slate-700 hover:bg-slate-50 transition-all cursor-pointer"
            >
              {loadingInside && <Loader2 className="w-3.5 h-3.5 animate-spin" />}
              <span>Refresh</span>
            </button>
          </div>

          {insideHasMore && (
            <div className="p-3 bg-amber-50 border border-amber-200 rounded-xl flex items-center space-x-2 text-amber-800 text-xs">
              <AlertCircle className="w-4 h-4 text-amber-600 shrink-0" />
              <span>
                <strong>Warning:</strong> Display capped at {insideVehicles.length} of {insideTotalCount} active vehicles inside ZMCC.
              </span>
            </div>
          )}

          {insideVehicles.length === 0 ? (
            <div className="bg-white rounded-xl border border-border p-12 text-center text-xs text-slate-400">
              <Truck className="w-8 h-8 text-slate-300 mx-auto mb-2" />
              <span>No vehicles currently inside ZMCC. All gate-tracked vehicles have exited.</span>
            </div>
          ) : (
            (() => {
              const INSIDE_PAGE_SIZE = 6;
              const totalInsidePages = Math.ceil(insideVehicles.length / INSIDE_PAGE_SIZE) || 1;
              const currentInsideVehicles = insideVehicles.slice((insidePage - 1) * INSIDE_PAGE_SIZE, insidePage * INSIDE_PAGE_SIZE);

              return (
                <div className="space-y-4">
                  <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                    {currentInsideVehicles.map((v) => (
                      <div
                        key={`${v.arrival_type}-${v.id}`}
                        className="bg-white rounded-xl border border-border p-5 shadow-2xs flex flex-col justify-between space-y-4 hover:border-slate-300 transition-all"
                      >
                        <div className="space-y-3">
                          <div className="flex items-center justify-between">
                            <span className={`px-2.5 py-0.5 rounded-full text-xs font-semibold uppercase tracking-wider ${
                              v.arrival_type === 'MOT'
                                ? 'bg-blue-100 text-blue-800'
                                : 'bg-emerald-100 text-emerald-800'
                            }`}>
                              {v.arrival_type === 'MOT' ? 'MOT Vehicle' : 'HC Supplier'}
                            </span>
                            <span className="tabular-nums text-xs font-semibold text-slate-900">
                              {v.vehicle_number}
                            </span>
                          </div>

                          <div className="text-xs space-y-1">
                            <div className="font-semibold text-slate-800">
                              {v.source_name}
                            </div>
                            <div className="flex items-center space-x-2 text-xs text-slate-500 tabular-nums">
                              <span>Token: <strong>{v.zmcc_token}</strong></span>
                            </div>
                            <div className="text-xs text-slate-500 flex items-center space-x-1">
                              <Clock className="w-3 h-3 text-slate-400" />
                              <span>Entered: {new Date(v.arrival_timestamp).toLocaleString('en-GB', { timeZone: 'Asia/Karachi' })} PKT</span>
                            </div>
                          </div>

                          <div className="pt-2 border-t border-slate-100 flex flex-wrap gap-1.5 items-center">
                            <span className={`px-2 py-0.5 rounded-md text-xs font-semibold ${
                              v.lab_status === 'COMPLETED'
                                ? 'bg-slate-100 text-slate-800'
                                : 'bg-amber-100 text-amber-800'
                            }`}>
                              Lab: {v.lab_status}
                            </span>
                            {v.lab_decision && (
                              <span className={`px-2 py-0.5 rounded-md text-xs font-semibold ${
                                v.lab_decision === 'ACCEPTED'
                                  ? 'bg-emerald-100 text-emerald-800'
                                  : 'bg-rose-100 text-rose-800'
                              }`}>
                                {v.lab_decision}
                              </span>
                            )}
                            {v.has_tank_receipt && (
                              <span className="px-2 py-0.5 rounded-md text-xs font-semibold bg-blue-100 text-blue-800">
                                Tank Received
                              </span>
                            )}
                          </div>
                        </div>

                        <div className="p-2 bg-slate-50 rounded-xl border border-slate-200 text-center">
                          <span className="text-xs font-semibold text-slate-500">Old record. Gate exit is no longer used.</span>
                        </div>
                      </div>
                    ))}
                  </div>

                  {totalInsidePages > 1 && (
                    <div className="flex items-center justify-between pt-3 border-t border-border">
                      <span className="text-xs text-slate-500">
                        Page {insidePage} of {totalInsidePages}
                      </span>
                      <div className="flex items-center space-x-2">
                        <button
                          type="button"
                          disabled={insidePage <= 1}
                          onClick={() => setInsidePage((p) => Math.max(1, p - 1))}
                          className="px-3 py-1.5 rounded-xl border border-border text-xs font-semibold text-slate-700 disabled:opacity-40 hover:bg-slate-50 cursor-pointer"
                        >
                          Previous
                        </button>
                        <button
                          type="button"
                          disabled={insidePage >= totalInsidePages}
                          onClick={() => setInsidePage((p) => Math.min(totalInsidePages, p + 1))}
                          className="px-3 py-1.5 rounded-xl border border-border text-xs font-semibold text-slate-700 disabled:opacity-40 hover:bg-slate-50 cursor-pointer"
                        >
                          Next
                        </button>
                      </div>
                    </div>
                  )}
                </div>
              );
            })()
          )}
        </div>
      )}

      {activeTab === 'LOCAL_SUPPLIER_ARRIVAL' && canSubmit && (
        <div className="max-w-xl mx-auto bg-white rounded-xl border border-emerald-200 p-6 shadow-2xs space-y-4 animate-panel-in">
          <div className="flex items-center justify-between border-b border-emerald-100 pb-3">
            <div>
              <div className="flex items-center space-x-2">
                <Users className="w-5 h-5 text-emerald-700" />
                <h3 className="text-sm font-semibold text-slate-900">
                  Record HC Supplier Arrival at ZMCC
                </h3>
              </div>
            </div>
            <button
              type="button"
              onClick={() => {
                setShowAddSupplierModal(true);
                setAddSupplierError(null);
              }}
              className="flex items-center space-x-1 px-3 py-1.5 bg-emerald-50 text-emerald-800 hover:bg-emerald-100 border border-emerald-300 rounded-xl text-xs font-semibold transition-all cursor-pointer"
            >
              <UserPlus className="w-3.5 h-3.5 text-emerald-700" />
              <span>+ Add HC Supplier</span>
            </button>
          </div>

          {localSupplierSuccessResult ? (
            <div className="bg-emerald-50 border border-emerald-300 rounded-xl p-6 space-y-4">
              <div className="flex items-center space-x-3 text-emerald-800">
                <CheckCircle2 className="w-6 h-6 text-emerald-600" />
                <div>
                  <h4 className="text-sm font-semibold">HC Supplier Arrival Recorded!</h4>
                  <span className="text-xs text-emerald-700">HC Supplier Arrival Recorded</span>
                </div>
              </div>

              <div className="space-y-2 text-xs divide-y divide-emerald-200/60 pt-2">
                <div className="pb-1.5">
                  ZMCC Token: <strong className="tabular-nums text-emerald-900 text-sm font-semibold">{localSupplierSuccessResult.zmcc_token}</strong>
                </div>
                <div className="py-1.5">
                  Raw Milk Token: <strong className="tabular-nums text-slate-800">{localSupplierSuccessResult.raw_milk_token_number || '—'}</strong>
                  {localSupplierSuccessResult.rmr_number && (
                    <span className="text-slate-500 text-xs ml-2">
                      (Legacy RMR: <strong className="tabular-nums text-slate-700">{localSupplierSuccessResult.rmr_number}</strong>)
                    </span>
                  )}
                </div>
                <div className="py-1.5">
                  Vehicle: <strong className="tabular-nums text-slate-800">{localSupplierSuccessResult.vehicle_number}</strong>
                </div>
                <div className="py-1.5">
                  Supplier: <strong className="text-slate-900">{localSupplierSuccessResult.local_supplier?.name}</strong>{' '}
                  <span className="text-slate-500 tabular-nums text-xs">({localSupplierSuccessResult.local_supplier?.local_supplier_code})</span>
                </div>
                {localSupplierSuccessResult.milk_source_code_snapshot && (
                  <div className="py-1.5">
                    Milk Source / ERP:{' '}
                    <span className="font-semibold text-slate-900">
                      [{localSupplierSuccessResult.milk_source_code_snapshot}] {localSupplierSuccessResult.milk_source_name_snapshot || ''}
                    </span>
                  </div>
                )}
                <div className="py-1.5">
                  Candidate ERP Reference:{' '}
                  {localSupplierSuccessResult.local_supplier?.erp_reference ? (
                    <span className="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-semibold bg-amber-100 text-amber-800">
                      {localSupplierSuccessResult.local_supplier.erp_reference} (Pending Verification)
                    </span>
                  ) : (
                    <span className="text-slate-400">None (Unmapped)</span>
                  )}
                </div>
                <div className="pt-1.5">
                  Arrival Date: <strong className="text-slate-800">{localSupplierSuccessResult.arrival_date}</strong>
                </div>
              </div>

              <button
                type="button"
                onClick={() => {
                  setLocalSupplierSuccessResult(null);
                  initLocalSupplierForm();
                }}
                className="px-4 py-2 bg-emerald-600 hover:bg-emerald-700 text-white rounded-xl text-xs font-semibold transition-all cursor-pointer"
              >
                Record Another HC Supplier
              </button>
            </div>
          ) : (
            <form onSubmit={handleLocalSupplierSubmit} className="space-y-4">
              {localSupplierError && (
                <div className="p-3 bg-rose-50 border border-rose-200 text-rose-800 text-xs rounded-xl flex items-center space-x-2">
                  <AlertCircle className="w-4 h-4 shrink-0" />
                  <span>{localSupplierError}</span>
                </div>
              )}

              <div>
                <div className="flex items-center justify-between mb-1">
                  <label className="block text-xs font-semibold text-slate-700">
                    HC Supplier <span className="text-rose-500">*</span>
                  </label>
                  <button
                    type="button"
                    onClick={() => {
                      setShowAddSupplierModal(true);
                      setAddSupplierError(null);
                    }}
                    className="text-xs font-semibold text-emerald-700 hover:underline flex items-center space-x-1 cursor-pointer"
                  >
                    <Plus className="w-3 h-3" />
                    <span>Quick Add Supplier</span>
                  </button>
                </div>
                <div className="relative mb-1.5">
                  <Search className="w-3.5 h-3.5 text-slate-400 absolute left-2.5 top-2.5" />
                  <input
                    type="text"
                    value={supplierSearchTerm}
                    onChange={(e) => setSupplierSearchTerm(e.target.value)}
                    placeholder="Search by code, name, phone, CNIC, ERP ref…"
                    className="w-full text-xs pl-8 pr-3 py-1.5 border rounded-xl focus:ring-2 focus:ring-emerald-600 outline-hidden bg-slate-50"
                  />
                </div>
                {(() => {
                  const filteredSuppliers = localSuppliers.filter((s) => {
                    if (!supplierSearchTerm.trim()) return true;
                    const term = supplierSearchTerm.toLowerCase();
                    return (
                      (s.local_supplier_code || '').toLowerCase().includes(term) ||
                      (s.name || '').toLowerCase().includes(term) ||
                      (s.phone || '').toLowerCase().includes(term) ||
                      (s.cnic || '').toLowerCase().includes(term) ||
                      (s.erp_reference || '').toLowerCase().includes(term)
                    );
                  });

                  return (
                    <>
                      <select
                        value={selectedLocalSupplierId}
                        onChange={(e) => setSelectedLocalSupplierId(e.target.value)}
                        required
                        className="w-full text-xs font-semibold px-3 py-2 border rounded-xl focus:ring-2 focus:ring-emerald-600 outline-hidden bg-white"
                      >
                        <option value="">Select supplier</option>
                        {filteredSuppliers.map((s) => (
                          <option key={s.id} value={s.id} disabled={s.approval_status !== 'ACTIVE'}>
                            {s.local_supplier_code} · {s.name}
                            {s.approval_status === 'PENDING_APPROVAL' ? ' (waiting for Zonal Manager approval)' : ''}
                          </option>
                        ))}
                        {selectedLocalSupplierId && !filteredSuppliers.some((s) => s.id === selectedLocalSupplierId) && (() => {
                          const sel = localSuppliers.find((s) => s.id === selectedLocalSupplierId);
                          return sel ? (
                            <option key={sel.id} value={sel.id}>
                              {sel.local_supplier_code} · {sel.name}
                            </option>
                          ) : null;
                        })()}
                      </select>
                      {localSuppliers.some((s) => s.approval_status === 'PENDING_APPROVAL') && (
                        <p className="text-xs text-amber-700 mt-1">
                          This HC is waiting for Zonal Manager approval. You cannot receive milk from it yet.
                        </p>
                      )}
                      {localSuppliers.length === 0 && !loadingLocalSuppliers && (
                        <p className="text-xs text-amber-700 mt-1">
                          No suppliers in directory yet. Click &quot;+ Quick Add Supplier&quot; above to onboard the first one.
                        </p>
                      )}
                      {localSuppliers.length > 0 && filteredSuppliers.length === 0 && supplierSearchTerm && (
                        <p className="text-xs text-slate-500 mt-1">
                          No suppliers match &quot;{supplierSearchTerm}&quot;. Clear search or click &quot;+ Quick Add Supplier&quot;.
                        </p>
                      )}
                    </>
                  );
                })()}
              </div>

              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1">
                  Milk Source / ERP Code
                </label>
                <select
                  value={selectedMilkSourceId}
                  onChange={(e) => setSelectedMilkSourceId(e.target.value)}
                  className="w-full text-xs font-semibold px-3 py-2 border rounded-xl focus:ring-2 focus:ring-emerald-600 outline-hidden bg-white"
                >
                  <option value="">Unassigned</option>
                  {availableSources.map((s) => (
                    <option key={s.id} value={s.id}>
                      {s.name}
                    </option>
                  ))}
                </select>
              </div>

              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1">
                  Raw Milk Token No. <span className="text-rose-500">*</span>
                </label>
                <input
                  type="text"
                  inputMode="numeric"
                  pattern="[0-9]*"
                  maxLength={100}
                  value={localSupplierRawMilkTokenNumber}
                  onChange={(e) => setLocalSupplierRawMilkTokenNumber(e.target.value.replace(/[^0-9]/g, ''))}
                  placeholder="e.g. 001924"
                  required
                  className="w-full text-xs font-semibold px-3 py-2 border rounded-xl focus:ring-2 focus:ring-emerald-600 outline-hidden tabular-nums"
                />
              </div>

              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1">
                  Vehicle Number <span className="text-rose-500">*</span>
                </label>
                <input
                  type="text"
                  value={localSupplierVehicleNumber}
                  onChange={(e) => setLocalSupplierVehicleNumber(e.target.value.toUpperCase())}
                  placeholder="e.g. LES-4029"
                  required
                  className="w-full text-xs font-semibold px-3 py-2 border rounded-xl focus:ring-2 focus:ring-emerald-600 outline-hidden tabular-nums uppercase"
                />
              </div>

              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1">
                  Arrival Timestamp (PKT) <span className="text-rose-500">*</span>
                </label>
                <input
                  type="datetime-local"
                  value={localSupplierArrivalTimestamp}
                  onChange={(e) => setLocalSupplierArrivalTimestamp(e.target.value)}
                  required
                  className="w-full text-xs font-semibold px-3 py-2 border rounded-xl focus:ring-2 focus:ring-emerald-600 outline-hidden"
                />
              </div>

              <div>
                <div className="flex items-center justify-between mb-1">
                  <label className="text-xs font-semibold text-slate-700">PHE GPS Coordinates (Optional)</label>
                  <button
                    type="button"
                    onClick={() => captureGps('LOCAL_SUPPLIER')}
                    className="text-xs font-semibold text-emerald-700 hover:underline flex items-center space-x-1 cursor-pointer"
                  >
                    <MapPin className="w-3 h-3" />
                    <span>Capture GPS</span>
                  </button>
                </div>
                <div className="text-xs text-slate-600 bg-slate-50 p-2.5 rounded-xl border tabular-nums">
                  {localSupplierGps.lat != null ? (
                    <span>Lat: {localSupplierGps.lat}, Lng: {localSupplierGps.lng} (±{localSupplierGps.acc}m)</span>
                  ) : (
                    <span className="text-slate-400">GPS not captured yet</span>
                  )}
                </div>
              </div>

              <button
                type="submit"
                disabled={localSupplierSubmitting}
                className="w-full py-2.5 bg-emerald-700 hover:bg-emerald-800 text-white rounded-xl text-xs font-semibold transition-all disabled:opacity-50 cursor-pointer"
              >
                {localSupplierSubmitting ? 'Recording Arrival…' : 'Record HC Supplier Arrival & Generate Token'}
              </button>
            </form>
          )}
        </div>
      )}

      {activeTab === 'HISTORY' && (
        <div className="space-y-4 animate-panel-in">
          <div className="bg-white rounded-xl border border-border p-4 flex flex-wrap items-center justify-between gap-3 shadow-2xs">
            <div className="flex flex-wrap items-center gap-3">
              <div className="flex rounded-xl border border-slate-200 overflow-hidden text-xs font-semibold">
                <button
                  type="button"
                  onClick={() => setHistoryType('ALL')}
                  className={`px-3 py-1.5 ${historyType === 'ALL' ? 'bg-primary text-white' : 'bg-white text-slate-700'}`}
                >
                  All
                </button>
                <button
                  type="button"
                  onClick={() => { setHistoryType('MOT'); setHistoryPage(1); }}
                  className={`px-3 py-1.5 ${historyType === 'MOT' ? 'bg-primary text-white' : 'bg-white text-slate-700'}`}
                >
                  MOT Only
                </button>
                <button
                  type="button"
                  onClick={() => { setHistoryType('CONTRACTOR'); setHistoryPage(1); }}
                  className={`px-3 py-1.5 ${historyType === 'CONTRACTOR' ? 'bg-primary text-white' : 'bg-white text-slate-700'}`}
                >
                  Contractors
                </button>
                <button
                  type="button"
                  onClick={() => { setHistoryType('LOCAL_SUPPLIER'); setHistoryPage(1); }}
                  className={`px-3 py-1.5 ${historyType === 'LOCAL_SUPPLIER' ? 'bg-emerald-700 text-white' : 'bg-white text-slate-700'}`}
                >
                  HC Suppliers
                </button>
              </div>

              <input
                type="date"
                value={historyDate}
                onChange={(e) => { setHistoryDate(e.target.value); setHistoryPage(1); }}
                className="text-xs font-semibold px-3 py-1.5 border rounded-xl bg-white"
              />

              <div className="relative">
                <Search className="w-3.5 h-3.5 absolute left-3 top-2.5 text-slate-400" />
                <input
                  type="text"
                  value={historySearch}
                  onChange={(e) => { setHistorySearch(e.target.value); setHistoryPage(1); }}
                  placeholder="Search tokens, vehicle…"
                  className="text-xs pl-8 pr-3 py-1.5 border rounded-xl bg-white w-48"
                />
              </div>
            </div>

            <button
              type="button"
              onClick={fetchHistory}
              className="flex items-center space-x-1 px-3 py-1.5 bg-slate-100 hover:bg-slate-200 text-slate-700 rounded-xl text-xs font-semibold"
            >
              <span>Refresh</span>
            </button>
          </div>

          <div className="bg-white rounded-xl border border-border overflow-hidden shadow-2xs">
            <div className="overflow-x-auto">
              <table className="w-full text-left text-xs border-collapse">
                <thead>
                  <tr className="bg-slate-50 border-b border-border text-xs uppercase tracking-wider text-slate-500 font-semibold">
                    <th className="p-3">Type</th>
                    <th className="p-3">ZMCC Token</th>
                    <th className="p-3">Route / Slip Token</th>
                    <th className="p-3">Vehicle / Source</th>
                    <th className="p-3">Arrival Time (PKT)</th>
                    <th className="p-3">Recorded By</th>
                    <th className="p-3">Corrections</th>
                    {(canDirectCorrect || isZmccManager) && <th className="p-3 text-right">Action</th>}
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {(historyType === 'ALL' || historyType === 'MOT') &&
                    motArrivals.map((arr) => (
                      <tr key={`mot-${arr.id}`} className="hover:bg-slate-50/60 transition-colors">
                        <td className="p-3">
                          <span className="px-2 py-0.5 rounded-full text-xs font-semibold bg-blue-100 text-blue-800">
                            MOT
                          </span>
                        </td>
                        <td className="p-3 tabular-nums font-semibold text-slate-900">{arr.zmcc_token}</td>
                        <td className="p-3 tabular-nums font-semibold text-slate-700">
                          <div>{arr.raw_milk_token_number || '—'}</div>
                          {arr.route_milk_token && (
                            <div className="text-xs text-slate-500 font-sans font-normal mt-0.5">
                              Legacy Route Milk Token: <span className="tabular-nums">{arr.route_milk_token}</span>
                            </div>
                          )}
                        </td>
                        <td className="p-3">
                          <div className="font-semibold text-slate-800">
                            {arr.journey?.vehicle_number || '—'}
                          </div>
                          <div className="text-xs text-slate-500">
                            {arr.journey?.journey_number} ({arr.journey?.route_code})
                          </div>
                        </td>
                        <td className="p-3 text-slate-700 font-medium">
                          {new Date(arr.arrival_timestamp).toLocaleString('en-GB', { timeZone: 'Asia/Karachi' })}
                        </td>
                        <td className="p-3 text-slate-600">{arr.recorded_by?.full_name || arr.recorded_by?.username}</td>
                        <td className="p-3">
                          {(() => {
                            const mgrCount = arr.manager_correction_count ?? 0;
                            const isLocked = !isSuperAdmin && mgrCount >= 5;
                            return (
                              <span
                                className={`text-xs font-semibold px-2 py-0.5 rounded-full ${
                                  isLocked
                                    ? 'bg-rose-100 text-rose-800'
                                    : mgrCount > 0
                                    ? 'bg-amber-100 text-amber-800'
                                    : 'bg-slate-100 text-slate-600'
                                }`}
                              >
                                {isSuperAdmin ? `${arr.correction_count} saves` : `${mgrCount}/5 ${isLocked ? '(Locked)' : ''}`}
                              </span>
                            );
                          })()}
                        </td>
                        {(canDirectCorrect || isZmccManager) && (
                          <td className="p-3 text-right">
                            {canDirectCorrect ? (
                              (!isSuperAdmin && (arr.manager_correction_count ?? 0) >= 5) ? (
                                <span className="text-slate-400 text-xs">Locked</span>
                              ) : (
                                <button
                                  type="button"
                                  onClick={() => openCorrectionModal({ type: 'MOT', record: arr })}
                                  className="px-2.5 py-1 text-xs font-semibold text-primary hover:bg-blue-50 rounded-lg cursor-pointer"
                                >
                                  Correct
                                </button>
                              )
                            ) : (
                              <button
                                type="button"
                                onClick={() => openRequestCorrection('MOT', arr)}
                                className="px-2.5 py-1 text-xs font-semibold text-amber-700 hover:bg-amber-50 rounded-lg border border-amber-200 cursor-pointer"
                              >
                                Request Correction
                              </button>
                            )}
                          </td>
                        )}
                      </tr>
                    ))}

                  {(historyType === 'ALL' || historyType === 'CONTRACTOR') &&
                    contractorArrivals.map((arr) => (
                      <tr key={`con-${arr.id}`} className="hover:bg-slate-50/60 transition-colors">
                        <td className="p-3">
                          <span className="px-2 py-0.5 rounded-full text-xs font-semibold bg-amber-100 text-amber-800">
                            CONTRACTOR
                          </span>
                        </td>
                        <td className="p-3 tabular-nums font-semibold text-slate-900">{arr.zmcc_token}</td>
                        <td className="p-3 tabular-nums font-semibold text-amber-900">{arr.rmr_number || '—'}</td>
                        <td className="p-3">
                          <div className="font-semibold text-slate-800">{arr.vehicle_number}</div>
                          <div className="text-xs text-slate-500">
                            {arr.contractor_source?.name} ({arr.contractor_source?.code})
                          </div>
                        </td>
                        <td className="p-3 text-slate-700 font-medium">
                          {new Date(arr.arrival_timestamp).toLocaleString('en-GB', { timeZone: 'Asia/Karachi' })}
                        </td>
                        <td className="p-3 text-slate-600">{arr.recorded_by?.full_name || arr.recorded_by?.username}</td>
                        <td className="p-3">
                          {(() => {
                            const mgrCount = arr.correction_count ?? 0;
                            const isLocked = !isSuperAdmin && mgrCount >= 5;
                            return (
                              <span
                                className={`text-xs font-semibold px-2 py-0.5 rounded-full ${
                                  isLocked
                                    ? 'bg-rose-100 text-rose-800'
                                    : mgrCount > 0
                                    ? 'bg-amber-100 text-amber-800'
                                    : 'bg-slate-100 text-slate-600'
                                }`}
                              >
                                {isSuperAdmin ? `${arr.correction_count} saves` : `${mgrCount}/5 ${isLocked ? '(Locked)' : ''}`}
                              </span>
                            );
                          })()}
                        </td>
                        {(canDirectCorrect || isZmccManager) && (
                          <td className="p-3 text-right">
                            {canDirectCorrect ? (
                              (!isSuperAdmin && (arr.correction_count ?? 0) >= 5) ? (
                                <span className="text-slate-400 text-xs">Locked</span>
                              ) : (
                                <button
                                  type="button"
                                  onClick={() => openCorrectionModal({ type: 'CONTRACTOR', record: arr })}
                                  className="px-2.5 py-1 text-xs font-semibold text-primary hover:bg-blue-50 rounded-lg cursor-pointer"
                                >
                                  Correct
                                </button>
                              )
                            ) : (
                              <button
                                type="button"
                                onClick={() => openRequestCorrection('CONTRACTOR', arr)}
                                className="px-2.5 py-1 text-xs font-semibold text-amber-700 hover:bg-amber-50 rounded-lg border border-amber-200 cursor-pointer"
                              >
                                Request Correction
                              </button>
                            )}
                          </td>
                        )}
                      </tr>
                    ))}

                  {(historyType === 'ALL' || historyType === 'LOCAL_SUPPLIER') &&
                    localSupplierArrivals.map((arr) => (
                      <tr key={`ls-${arr.id}`} className="hover:bg-slate-50/60 transition-colors">
                        <td className="p-3">
                          <span className="px-2 py-0.5 rounded-full text-xs font-semibold bg-emerald-100 text-emerald-800">
                            HC_SUPPLIER
                          </span>
                        </td>
                        <td className="p-3 tabular-nums font-semibold text-slate-900">{arr.zmcc_token}</td>
                        <td className="p-3 tabular-nums font-semibold text-emerald-900">
                          <div>{arr.raw_milk_token_number || '—'}</div>
                          {arr.rmr_number && (
                            <div className="text-xs text-slate-500 font-sans font-normal mt-0.5">
                              Legacy RMR: <span className="tabular-nums">{arr.rmr_number}</span>
                            </div>
                          )}
                        </td>
                        <td className="p-3">
                          <div className="font-semibold text-slate-800">{arr.vehicle_number}</div>
                          <div className="text-xs text-slate-600 font-medium">
                            {arr.local_supplier?.name}{' '}
                            <span className="tabular-nums text-slate-400">({arr.local_supplier?.local_supplier_code})</span>
                          </div>
                          {arr.milk_source_code_snapshot ? (
                            <div className="text-xs font-semibold text-emerald-800">
                              [{arr.milk_source_code_snapshot}] {arr.milk_source_name_snapshot || ''}
                            </div>
                          ) : arr.local_supplier?.erp_reference ? (
                            <div className="text-xs text-amber-700 font-semibold">
                              ERP: {arr.local_supplier.erp_reference} (Pending Verification)
                            </div>
                          ) : null}
                        </td>
                        <td className="p-3 text-slate-700 font-medium">
                          {new Date(arr.arrival_timestamp).toLocaleString('en-GB', { timeZone: 'Asia/Karachi' })}
                        </td>
                        <td className="p-3 text-slate-600">{arr.recorded_by?.full_name || arr.recorded_by?.username}</td>
                        <td className="p-3">
                          {(() => {
                            const mgrCount = arr.manager_correction_count ?? 0;
                            const isLocked = !isSuperAdmin && mgrCount >= 5;
                            return (
                              <span
                                className={`text-xs font-semibold px-2 py-0.5 rounded-full ${
                                  isLocked
                                    ? 'bg-rose-100 text-rose-800'
                                    : mgrCount > 0
                                    ? 'bg-amber-100 text-amber-800'
                                    : 'bg-slate-100 text-slate-600'
                                }`}
                              >
                                {isSuperAdmin ? `${arr.correction_count} saves` : `${mgrCount}/5 ${isLocked ? '(Locked)' : ''}`}
                              </span>
                            );
                          })()}
                        </td>
                        {(canDirectCorrect || isZmccManager) && (
                          <td className="p-3 text-right">
                            {canDirectCorrect ? (
                              (!isSuperAdmin && (arr.manager_correction_count ?? 0) >= 5) ? (
                                <span className="text-slate-400 text-xs">Locked</span>
                              ) : (
                                <button
                                  type="button"
                                  onClick={() => openCorrectionModal({ type: 'LOCAL_SUPPLIER', record: arr })}
                                  className="px-2.5 py-1 text-xs font-semibold text-emerald-700 hover:bg-emerald-50 rounded-lg cursor-pointer"
                                >
                                  Correct
                                </button>
                              )
                            ) : (
                              <button
                                type="button"
                                onClick={() => openRequestCorrection('LOCAL_SUPPLIER', arr)}
                                className="px-2.5 py-1 text-xs font-semibold text-amber-700 hover:bg-amber-50 rounded-lg border border-amber-200 cursor-pointer"
                              >
                                Request Correction
                              </button>
                            )}
                          </td>
                        )}
                      </tr>
                    ))}

                  {motArrivals.length === 0 && contractorArrivals.length === 0 && localSupplierArrivals.length === 0 && (
                    <tr>
                      <td colSpan={(canDirectCorrect || isZmccManager) ? 8 : 7} className="p-8 text-center text-xs text-slate-400">
                        No arrival records found matching current criteria.
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>

            {historyTotalPages > 1 && (
              <div className="flex items-center justify-between p-3 border-t border-border bg-slate-50 text-xs font-semibold text-slate-700">
                <div>
                  Page <span className="font-semibold text-primary">{historyPage}</span> of{' '}
                  <span className="font-semibold text-primary">{historyTotalPages}</span> ({historyTotalRecords} records)
                </div>
                <div className="flex items-center space-x-2">
                  <button
                    type="button"
                    disabled={historyPage <= 1 || loadingHistory}
                    onClick={() => setHistoryPage((p) => Math.max(1, p - 1))}
                    className="px-3 py-1 bg-white border border-slate-300 rounded-lg hover:bg-slate-100 disabled:opacity-40 disabled:cursor-not-allowed font-semibold"
                  >
                    Previous
                  </button>
                  <button
                    type="button"
                    disabled={historyPage >= historyTotalPages || loadingHistory}
                    onClick={() => setHistoryPage((p) => Math.min(historyTotalPages, p + 1))}
                    className="px-3 py-1 bg-white border border-slate-300 rounded-lg hover:bg-slate-100 disabled:opacity-40 disabled:cursor-not-allowed font-semibold"
                  >
                    Next
                  </button>
                </div>
              </div>
            )}
          </div>
        </div>
      )}

      <AnimatePresence>{correctionTarget && (
        <Modal key="modal-0" onClose={() => setCorrectionTarget(null)} title="Correct arrival record" className="max-w-lg p-6 space-y-4">
            <div className="flex items-center justify-between border-b pb-3">
              <div>
                <h3 className="text-sm font-semibold text-slate-900">
                  Correct {correctionTarget.type} Arrival Record
                </h3>
                <p className="text-xs text-slate-500">
                  Token: <strong>{correctionTarget.record.zmcc_token}</strong>{' '}
                  {isSuperAdmin ? (
                    <span>(Super Admin: Unlimited saves)</span>
                  ) : (
                    <span>
                      (Remaining Manager Corrections:{' '}
                      <strong>{Math.max(0, 5 - (('manager_correction_count' in correctionTarget.record ? correctionTarget.record.manager_correction_count : correctionTarget.record.correction_count) ?? 0))}</strong>)
                    </span>
                  )}
                </p>
              </div>
              <button
                type="button"
                onClick={() => setCorrectionTarget(null)}
                className="text-slate-400 hover:text-slate-600 p-1"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            {corrError && (
              <div className="p-3 bg-rose-50 border border-rose-200 text-rose-800 text-xs rounded-xl flex items-center space-x-2">
                <AlertCircle className="w-4 h-4 shrink-0" />
                <span>{corrError}</span>
              </div>
            )}

            <form onSubmit={handleCorrectionSubmit} className="space-y-4 text-xs">
              {correctionTarget.type === 'MOT' ? (
                <div>
                  <label className="block font-semibold text-slate-700 mb-1">
                    Raw Milk Token Number
                  </label>
                  <input
                    type="text"
                    value={corrToken}
                    onChange={(e) => setCorrToken(e.target.value)}
                    placeholder="e.g. 001924"
                    required
                    className="w-full px-3 py-2 border rounded-xl tabular-nums uppercase"
                  />
                  {correctionTarget.record.route_milk_token && (
                    <div className="mt-2 p-2.5 bg-slate-50 border border-slate-200 rounded-xl text-xs text-slate-600">
                      <span className="font-semibold text-slate-500">Legacy Route Milk Token:</span>{' '}
                      <span className="tabular-nums font-semibold text-slate-800">{correctionTarget.record.route_milk_token}</span>
                      <span className="text-xs text-slate-400 ml-1.5">(Read-only)</span>
                    </div>
                  )}
                </div>
              ) : correctionTarget.type === 'CONTRACTOR' ? (
                <>
                  <div>
                    <label className="block font-semibold text-slate-700 mb-1">Contractor RMR Number</label>
                    <input
                      type="text"
                      inputMode="numeric"
                      pattern="[0-9]*"
                      maxLength={100}
                      value={corrRmr}
                      onChange={(e) => setCorrRmr(e.target.value)}
                      placeholder="e.g. 002345"
                      required
                      className="w-full px-3 py-2 border rounded-xl tabular-nums"
                    />
                  </div>
                  <div>
                    <label className="block font-semibold text-slate-700 mb-1">Vehicle Number</label>
                    <input
                      type="text"
                      value={corrVehicle}
                      onChange={(e) => setCorrVehicle(e.target.value.toUpperCase())}
                      required
                      className="w-full px-3 py-2 border rounded-xl tabular-nums uppercase"
                    />
                  </div>
                </>
              ) : (
                <>
                  <div>
                    <label className="block font-semibold text-slate-700 mb-1">HC Supplier (Same ZMCC)</label>
                    <select
                      value={corrLocalSupplierId}
                      onChange={(e) => setCorrLocalSupplierId(e.target.value)}
                      required
                      className="w-full px-3 py-2 border rounded-xl bg-white font-semibold"
                    >
                      <option value="">Select supplier</option>
                      {localSuppliers.map((s) => (
                        <option key={s.id} value={s.id}>
                          {s.local_supplier_code} · {s.name}
                        </option>
                      ))}
                    </select>
                  </div>
                  <div>
                    <label className="block font-semibold text-slate-700 mb-1">Milk Source / ERP Code</label>
                    <select
                      value={corrMilkSourceId}
                      onChange={(e) => setCorrMilkSourceId(e.target.value)}
                      className="w-full px-3 py-2 border rounded-xl bg-white font-semibold text-xs"
                    >
                      <option value="">Unassigned</option>
                      {availableSources.map((s) => (
                        <option key={s.id} value={s.id}>
                          {s.name}
                        </option>
                      ))}
                    </select>
                  </div>
                  <div>
                    <label className="block font-semibold text-slate-700 mb-1">Raw Milk Token Number</label>
                    <input
                      type="text"
                      value={corrToken}
                      onChange={(e) => setCorrToken(e.target.value)}
                      placeholder="e.g. 001924"
                      required
                      className="w-full px-3 py-2 border rounded-xl tabular-nums uppercase"
                    />
                  </div>
                  {correctionTarget.record.rmr_number && (
                    <div className="p-2.5 bg-slate-50 border border-slate-200 rounded-xl text-xs text-slate-600">
                      <span className="font-semibold text-slate-500">Legacy RMR:</span>{' '}
                      <span className="tabular-nums font-semibold text-slate-800">{correctionTarget.record.rmr_number}</span>
                      <span className="text-xs text-slate-400 ml-1.5">(Read-only)</span>
                    </div>
                  )}
                  <div>
                    <label className="block font-semibold text-slate-700 mb-1">Vehicle Number</label>
                    <input
                      type="text"
                      value={corrVehicle}
                      onChange={(e) => setCorrVehicle(e.target.value.toUpperCase())}
                      required
                      className="w-full px-3 py-2 border rounded-xl tabular-nums uppercase"
                    />
                  </div>
                </>
              )}

              <div>
                <label className="block font-semibold text-slate-700 mb-1">Arrival Timestamp (PKT)</label>
                <input
                  type="datetime-local"
                  value={corrTimestamp}
                  onChange={(e) => setCorrTimestamp(e.target.value)}
                  required
                  className="w-full px-3 py-2 border rounded-xl"
                />
              </div>

              <div className="grid grid-cols-2 gap-2">
                <div>
                  <label className="block font-semibold text-slate-700 mb-1">Latitude</label>
                  <input
                    type="number"
                    step="0.0000001"
                    value={corrLat}
                    onChange={(e) => setCorrLat(e.target.value)}
                    className="w-full px-3 py-2 border rounded-xl"
                  />
                </div>
                <div>
                  <label className="block font-semibold text-slate-700 mb-1">Longitude</label>
                  <input
                    type="number"
                    step="0.0000001"
                    value={corrLng}
                    onChange={(e) => setCorrLng(e.target.value)}
                    className="w-full px-3 py-2 border rounded-xl"
                  />
                </div>
              </div>

              <div>
                <label className="block font-semibold text-slate-700 mb-1">
                  Reason for Correction <span className="text-rose-500">*</span>
                </label>
                <textarea
                  value={corrReason}
                  onChange={(e) => setCorrReason(e.target.value)}
                  placeholder="Explain why this correction is being made (Audit logged)…"
                  required
                  rows={3}
                  className="w-full px-3 py-2 border rounded-xl"
                />
              </div>

              <div className="flex justify-end space-x-2 pt-2 border-t">
                <button
                  type="button"
                  onClick={() => setCorrectionTarget(null)}
                  className="px-4 py-2 border rounded-xl text-slate-600 font-semibold hover:bg-slate-50 cursor-pointer"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={corrSubmitting}
                  className="px-4 py-2 bg-primary text-white rounded-xl font-semibold hover:bg-primary-hover disabled:opacity-50 cursor-pointer"
                >
                  {corrSubmitting ? 'Saving…' : 'Apply Correction'}
                </button>
              </div>
            </form>
          </Modal>
      )}</AnimatePresence>

      <AnimatePresence>{showAddSupplierModal && (
        <Modal key="modal-1" onClose={() => setShowAddSupplierModal(false)} title="Add HC supplier" className="max-w-md p-6 space-y-4 border-emerald-200">
            <div className="flex items-center justify-between border-b border-emerald-100 pb-3">
              <div className="flex items-center space-x-2">
                <UserPlus className="w-5 h-5 text-emerald-700" />
                <h3 className="text-sm font-semibold text-slate-900">
                  Quick Onboard HC Supplier
                </h3>
              </div>
              <button
                type="button"
                onClick={() => setShowAddSupplierModal(false)}
                className="text-slate-400 hover:text-slate-600 p-1 cursor-pointer"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            {addSupplierError && (
              <div className="p-3 bg-rose-50 border border-rose-200 text-rose-800 text-xs rounded-xl flex items-center space-x-2">
                <AlertCircle className="w-4 h-4 shrink-0" />
                <span>{addSupplierError}</span>
              </div>
            )}

            <form onSubmit={handleCreateLocalSupplier} className="space-y-3 text-xs">
              <div>
                <label className="block font-semibold text-slate-700 mb-1">
                  Supplier Name <span className="text-rose-500">*</span>
                </label>
                <input
                  type="text"
                  value={newSupplierName}
                  onChange={(e) => setNewSupplierName(e.target.value)}
                  placeholder="e.g. Haji Milk Supplier"
                  required
                  maxLength={150}
                  className="w-full px-3 py-2 border rounded-xl focus:ring-2 focus:ring-emerald-600 outline-hidden font-semibold"
                />
              </div>

              <div>
                <label className="block font-semibold text-slate-700 mb-1">
                  Phone *
                </label>
                <input
                  type="text"
                  required
                  value={newSupplierPhone}
                  onChange={(e) => setNewSupplierPhone(e.target.value)}
                  placeholder="e.g. 0300-1234567"
                  maxLength={50}
                  className="w-full px-3 py-2 border rounded-xl tabular-nums"
                />
              </div>

              <div>
                <label className="block font-semibold text-slate-700 mb-1">
                  CNIC *
                </label>
                <input
                  type="text"
                  required
                  value={newSupplierCnic}
                  onChange={(e) => setNewSupplierCnic(e.target.value)}
                  placeholder="e.g. 35201-1234567-1"
                  maxLength={50}
                  className="w-full px-3 py-2 border rounded-xl tabular-nums"
                />
              </div>

              <div>
                <label className="block font-semibold text-slate-700 mb-1">
                  Candidate ERP Reference (Optional - Pending Verification)
                </label>
                <input
                  type="text"
                  value={newSupplierErpRef}
                  onChange={(e) => setNewSupplierErpRef(e.target.value)}
                  placeholder="e.g. 00-2345 or SAP code"
                  maxLength={100}
                  className="w-full px-3 py-2 border rounded-xl tabular-nums"
                />
                <p className="text-xs text-slate-400 mt-1">
                  Leading zeros preserved. Placeholders like &apos;New&apos;, &apos;Pending&apos;, &apos;Unknown&apos;, &apos;N/A&apos; will be rejected.
                </p>
              </div>

              <div className="flex justify-end space-x-2 pt-3 border-t">
                <button
                  type="button"
                  onClick={() => setShowAddSupplierModal(false)}
                  className="px-4 py-2 border rounded-xl text-slate-600 font-semibold hover:bg-slate-50 cursor-pointer"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={addSupplierSubmitting}
                  className="px-4 py-2 bg-emerald-700 hover:bg-emerald-800 text-white rounded-xl font-semibold transition-all disabled:opacity-50 cursor-pointer"
                >
                  {addSupplierSubmitting ? 'Saving…' : 'Save & Select Supplier'}
                </button>
              </div>
            </form>
          </Modal>
      )}</AnimatePresence>

      <RequestCorrectionModal
        isOpen={requestModalState.isOpen}
        onClose={() => setRequestModalState((prev) => ({ ...prev, isOpen: false }))}
        module={requestModalState.module}
        recordId={requestModalState.recordId}
        recordIdentifierLabel={requestModalState.label}
        availableFields={requestModalState.fields}
        onSuccess={() => {
          toast.showSuccess('Correction request submitted to Data Executive desk.');
          fetchHistory();
        }}
      />
    </div>
  );
};

