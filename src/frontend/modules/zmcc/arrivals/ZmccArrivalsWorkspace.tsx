'use client';

import React, { useState, useEffect, useCallback } from 'react';
import { User } from '@backend/core/types';
import {
  Truck,
  CheckCircle2,
  AlertCircle,
  Clock,
  MapPin,
  RefreshCw,
  Search,
  FileText,
  Calendar,
  Building2,
  Edit3,
  X,
  ShieldAlert,
  Users,
  UserPlus,
  Plus,
} from 'lucide-react';

import { useToast } from '@/frontend/context/ToastContext';
import { toDatetimeLocalInput, datetimeLocalToIso } from '@/lib/datetime-utils';

interface ZmccArrivalsWorkspaceProps {
  currentUser: User | null;
}

type MainTab = 'MOT_ARRIVAL' | 'CONTRACTOR_ARRIVAL' | 'LOCAL_SUPPLIER_ARRIVAL' | 'HISTORY';

export const ZmccArrivalsWorkspace: React.FC<ZmccArrivalsWorkspaceProps> = ({ currentUser }) => {
  const toast = useToast();
  const isSuperAdmin = currentUser?.role === 'SUPER_ADMIN';
  const isZmccManager = currentUser?.role === 'ZMCC_MANAGER';
  const isPheOperator = currentUser?.role === 'PHE_OPERATOR';
  const canSubmit = isPheOperator || isSuperAdmin;
  const canCorrect = isZmccManager || isSuperAdmin;

  const [activeTab, setActiveTab] = useState<MainTab>(canSubmit ? 'MOT_ARRIVAL' : 'HISTORY');

  // MOT Arrival Form State
  const [arrivingJourneys, setArrivingJourneys] = useState<any[]>([]);
  const [loadingJourneys, setLoadingJourneys] = useState(false);
  const [selectedJourney, setSelectedJourney] = useState<any | null>(null);
  const [routeMilkToken, setRouteMilkToken] = useState('');
  const [motArrivalTimestamp, setMotArrivalTimestamp] = useState(() =>
    toDatetimeLocalInput(new Date())
  );
  const [motGps, setMotGps] = useState<{ lat: number | null; lng: number | null; acc: number | null }>({
    lat: null,
    lng: null,
    acc: null,
  });
  const [motEventId, setMotEventId] = useState('');
  const [motSubmitting, setMotSubmitting] = useState(false);
  const [motSuccessResult, setMotSuccessResult] = useState<any | null>(null);
  const [motError, setMotError] = useState<string | null>(null);

  // Contractor Arrival Form State
  const [contractors, setContractors] = useState<any[]>([]);
  const [selectedContractorId, setSelectedContractorId] = useState('');
  const [contractorRmrNumber, setContractorRmrNumber] = useState('');
  const [contractorVehicleNumber, setContractorVehicleNumber] = useState('');
  const [contractorArrivalTimestamp, setContractorArrivalTimestamp] = useState(() =>
    toDatetimeLocalInput(new Date())
  );
  const [contractorGps, setContractorGps] = useState<{ lat: number | null; lng: number | null; acc: number | null }>({
    lat: null,
    lng: null,
    acc: null,
  });
  const [contractorEventId, setContractorEventId] = useState('');
  const [contractorSubmitting, setContractorSubmitting] = useState(false);
  const [contractorSuccessResult, setContractorSuccessResult] = useState<any | null>(null);
  const [contractorError, setContractorError] = useState<string | null>(null);

  // Local Supplier Arrival Form State
  const [localSuppliers, setLocalSuppliers] = useState<any[]>([]);
  const [loadingLocalSuppliers, setLoadingLocalSuppliers] = useState(false);
  const [selectedLocalSupplierId, setSelectedLocalSupplierId] = useState('');
  const [localSupplierRmrNumber, setLocalSupplierRmrNumber] = useState('');
  const [localSupplierVehicleNumber, setLocalSupplierVehicleNumber] = useState('');
  const [localSupplierArrivalTimestamp, setLocalSupplierArrivalTimestamp] = useState(() =>
    toDatetimeLocalInput(new Date())
  );
  const [localSupplierGps, setLocalSupplierGps] = useState<{ lat: number | null; lng: number | null; acc: number | null }>({
    lat: null,
    lng: null,
    acc: null,
  });
  const [localSupplierEventId, setLocalSupplierEventId] = useState('');
  const [localSupplierSubmitting, setLocalSupplierSubmitting] = useState(false);
  const [localSupplierSuccessResult, setLocalSupplierSuccessResult] = useState<any | null>(null);
  const [localSupplierError, setLocalSupplierError] = useState<string | null>(null);

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
  const [motArrivals, setMotArrivals] = useState<any[]>([]);
  const [contractorArrivals, setContractorArrivals] = useState<any[]>([]);
  const [localSupplierArrivals, setLocalSupplierArrivals] = useState<any[]>([]);
  const [loadingHistory, setLoadingHistory] = useState(false);

  // Correction Modal State
  const [correctionTarget, setCorrectionTarget] = useState<{ type: 'MOT' | 'CONTRACTOR' | 'LOCAL_SUPPLIER'; record: any } | null>(null);
  const [corrReason, setCorrReason] = useState('');
  const [corrToken, setCorrToken] = useState('');
  const [corrRmr, setCorrRmr] = useState('');
  const [corrVehicle, setCorrVehicle] = useState('');
  const [corrLocalSupplierId, setCorrLocalSupplierId] = useState('');
  const [corrTimestamp, setCorrTimestamp] = useState('');
  const [corrLat, setCorrLat] = useState<string>('');
  const [corrLng, setCorrLng] = useState<string>('');
  const [corrAcc, setCorrAcc] = useState<string>('');
  const [corrSubmitting, setCorrSubmitting] = useState(false);
  const [corrError, setCorrError] = useState<string | null>(null);

  // Helpers to generate UUID client_event_id
  const generateClientEventId = (prefix: string) => {
    const random = Math.random().toString(36).substring(2, 10);
    return `${prefix}-${Date.now()}-${random}`;
  };

  const initMotForm = useCallback(() => {
    setSelectedJourney(null);
    setRouteMilkToken('');
    setMotArrivalTimestamp(toDatetimeLocalInput(new Date()));
    setMotGps({ lat: null, lng: null, acc: null });
    setMotEventId(generateClientEventId('mot-arr'));
    setMotError(null);
  }, []);

  const initContractorForm = useCallback(() => {
    setSelectedContractorId('');
    setContractorRmrNumber('');
    setContractorVehicleNumber('');
    setContractorArrivalTimestamp(toDatetimeLocalInput(new Date()));
    setContractorGps({ lat: null, lng: null, acc: null });
    setContractorEventId(generateClientEventId('con-arr'));
    setContractorError(null);
  }, []);

  const initLocalSupplierForm = useCallback(() => {
    setSelectedLocalSupplierId('');
    setLocalSupplierRmrNumber('');
    setLocalSupplierVehicleNumber('');
    setLocalSupplierArrivalTimestamp(toDatetimeLocalInput(new Date()));
    setLocalSupplierGps({ lat: null, lng: null, acc: null });
    setLocalSupplierEventId(generateClientEventId('ls-arr'));
    setLocalSupplierError(null);
  }, []);

  // Fetch arriving journeys for MOT
  const fetchArrivingJourneys = useCallback(async () => {
    setLoadingJourneys(true);
    try {
      const res = await fetch('/api/zmcc/arrivals/arriving-journeys');
      if (res.ok) {
        const data = await res.json();
        setArrivingJourneys(data || []);
      }
    } catch (err) {
      console.error('Failed to fetch arriving journeys', err);
    } finally {
      setLoadingJourneys(false);
    }
  }, []);

  // Fetch active contractors
  const fetchContractors = useCallback(async () => {
    try {
      const res = await fetch('/api/zmcc/arrivals/contractors');
      if (res.ok) {
        const data = await res.json();
        setContractors(data || []);
      }
    } catch (err) {
      console.error('Failed to fetch contractors', err);
    }
  }, []);

  // Fetch local suppliers for directory selection
  const fetchLocalSuppliers = useCallback(async () => {
    setLoadingLocalSuppliers(true);
    try {
      const res = await fetch('/api/zmcc/local-suppliers?is_active=true&pageSize=100');
      if (res.ok) {
        const data = await res.json();
        setLocalSuppliers(data.items || []);
      }
    } catch (err) {
      console.error('Failed to fetch local suppliers', err);
    } finally {
      setLoadingLocalSuppliers(false);
    }
  }, []);

  // Fetch history
  const fetchHistory = useCallback(async () => {
    setLoadingHistory(true);
    try {
      const params = new URLSearchParams();
      if (historyDate) params.set('date', historyDate);
      if (historySearch) params.set('search', historySearch);

      const [motRes, conRes, lsRes] = await Promise.all([
        fetch(`/api/zmcc/arrivals/mot?${params.toString()}`),
        fetch(`/api/zmcc/arrivals/contractor?${params.toString()}`),
        fetch(`/api/zmcc/arrivals/local-supplier?${params.toString()}`),
      ]);

      if (motRes.ok) {
        const motData = await motRes.json();
        setMotArrivals(motData.items || []);
      }
      if (conRes.ok) {
        const conData = await conRes.json();
        setContractorArrivals(conData.items || []);
      }
      if (lsRes.ok) {
        const lsData = await lsRes.json();
        setLocalSupplierArrivals(lsData.items || []);
      }
    } catch (err) {
      console.error('Failed to fetch arrival history', err);
    } finally {
      setLoadingHistory(false);
    }
  }, [historyDate, historySearch]);

  useEffect(() => {
    if (canSubmit) {
      fetchArrivingJourneys();
      fetchContractors();
      fetchLocalSuppliers();
      initMotForm();
      initContractorForm();
      initLocalSupplierForm();
    }
    fetchHistory();
  }, [canSubmit, fetchArrivingJourneys, fetchContractors, fetchLocalSuppliers, fetchHistory, initMotForm, initContractorForm, initLocalSupplierForm]);

  // GPS capture handler
  const captureGps = (target: 'MOT' | 'CONTRACTOR' | 'LOCAL_SUPPLIER') => {
    if (typeof window === 'undefined' || !navigator.geolocation) {
      toast.showWarning('Geolocation is not supported by your browser. Arrival can proceed without GPS.');
      return;
    }
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        const coords = {
          lat: Number(pos.coords.latitude.toFixed(7)),
          lng: Number(pos.coords.longitude.toFixed(7)),
          acc: Number(pos.coords.accuracy.toFixed(2)),
        };
        if (target === 'MOT') setMotGps(coords);
        else if (target === 'CONTRACTOR') setContractorGps(coords);
        else setLocalSupplierGps(coords);
        toast.showSuccess('GPS coordinates captured successfully.');
      },
      (err) => {
        let msg = 'Failed to capture GPS location.';
        if (err.code === 1) msg = 'Location permission was denied. Arrival can proceed without GPS.';
        else if (err.code === 2) msg = 'Location position unavailable. Arrival can proceed without GPS.';
        else if (err.code === 3) msg = 'Location request timed out. Arrival can proceed without GPS.';
        else if (err.message) msg = `GPS error: ${err.message}. Arrival can proceed without GPS.`;

        toast.showWarning(msg);
        if (target === 'MOT') setMotGps({ lat: null, lng: null, acc: null });
        else if (target === 'CONTRACTOR') setContractorGps({ lat: null, lng: null, acc: null });
        else setLocalSupplierGps({ lat: null, lng: null, acc: null });
      },
      { enableHighAccuracy: true, timeout: 10000, maximumAge: 0 }
    );
  };

  // Submit MOT Arrival
  const handleMotSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedJourney) {
      setMotError('Please select a journey.');
      return;
    }
    if (!routeMilkToken.trim()) {
      setMotError('Route Milk Token is required from the driver.');
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
          route_milk_token: routeMilkToken.trim(),
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
        fetchHistory();
      }
    } catch (err: any) {
      setMotError(err.message || 'An unexpected error occurred.');
    } finally {
      setMotSubmitting(false);
    }
  };

  // Submit Contractor Arrival
  const handleContractorSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedContractorId) {
      setContractorError('Please select a contractor.');
      return;
    }
    if (!contractorRmrNumber.trim()) {
      setContractorError('Contractor RMR number is required.');
      return;
    }
    if (!contractorVehicleNumber.trim()) {
      setContractorError('Vehicle number is required.');
      return;
    }
    setContractorSubmitting(true);
    setContractorError(null);
    try {
      const res = await fetch('/api/zmcc/arrivals/contractor', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          contractor_source_id: selectedContractorId,
          rmr_number: contractorRmrNumber.trim(),
          vehicle_number: contractorVehicleNumber.trim().toUpperCase(),
          arrival_timestamp: datetimeLocalToIso(contractorArrivalTimestamp) || new Date(contractorArrivalTimestamp).toISOString(),
          client_event_id: contractorEventId,
          phe_latitude: contractorGps.lat,
          phe_longitude: contractorGps.lng,
          phe_gps_accuracy: contractorGps.acc,
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        setContractorError(data.error || 'Failed to record contractor arrival.');
      } else {
        setContractorSuccessResult(data);
        fetchHistory();
      }
    } catch (err: any) {
      setContractorError(err.message || 'An unexpected error occurred.');
    } finally {
      setContractorSubmitting(false);
    }
  };

  // Fast inline Add Local Supplier handler
  const handleCreateLocalSupplier = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newSupplierName.trim()) {
      setAddSupplierError('Supplier name is required.');
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
          phone: newSupplierPhone.trim() || undefined,
          cnic: newSupplierCnic.trim() || undefined,
          erp_reference: newSupplierErpRef.trim() || undefined,
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        setAddSupplierError(data.error || 'Failed to create local supplier.');
      } else {
        toast.showSuccess(`Local supplier "${data.name}" onboarded (${data.local_supplier_code})`);
        setShowAddSupplierModal(false);
        setNewSupplierName('');
        setNewSupplierPhone('');
        setNewSupplierCnic('');
        setNewSupplierErpRef('');
        setLocalSuppliers((prev) => [data, ...prev]);
        setSelectedLocalSupplierId(data.id);
      }
    } catch (err: any) {
      setAddSupplierError(err.message || 'An unexpected error occurred.');
    } finally {
      setAddSupplierSubmitting(false);
    }
  };

  // Submit Local Supplier Arrival
  const handleLocalSupplierSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedLocalSupplierId) {
      setLocalSupplierError('Please select a local supplier.');
      return;
    }
    if (!localSupplierRmrNumber.trim()) {
      setLocalSupplierError('Local supplier RMR number is required.');
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
          rmr_number: localSupplierRmrNumber.trim(),
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
        setLocalSupplierError(data.error || 'Failed to record local supplier arrival.');
      } else {
        setLocalSupplierSuccessResult(data);
        fetchHistory();
      }
    } catch (err: any) {
      setLocalSupplierError(err.message || 'An unexpected error occurred.');
    } finally {
      setLocalSupplierSubmitting(false);
    }
  };

  // Open Correction Modal
  const openCorrectionModal = (type: 'MOT' | 'CONTRACTOR' | 'LOCAL_SUPPLIER', record: any) => {
    setCorrectionTarget({ type, record });
    setCorrReason('');
    setCorrError(null);
    setCorrTimestamp(record.arrival_timestamp ? toDatetimeLocalInput(record.arrival_timestamp) : '');
    setCorrLat(record.phe_latitude != null ? String(record.phe_latitude) : '');
    setCorrLng(record.phe_longitude != null ? String(record.phe_longitude) : '');
    setCorrAcc(record.phe_gps_accuracy != null ? String(record.phe_gps_accuracy) : '');

    if (type === 'MOT') {
      setCorrToken(record.route_milk_token || '');
    } else if (type === 'CONTRACTOR') {
      setCorrRmr(record.rmr_number || '');
      setCorrVehicle(record.vehicle_number || '');
    } else if (type === 'LOCAL_SUPPLIER') {
      setCorrLocalSupplierId(record.local_supplier_id ? String(record.local_supplier_id) : '');
      setCorrRmr(record.rmr_number || '');
      setCorrVehicle(record.vehicle_number || '');
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

      const payload: any = {
        reason: corrReason.trim(),
        arrival_timestamp: datetimeLocalToIso(corrTimestamp) || new Date(corrTimestamp).toISOString(),
      };

      if (correctionTarget.type === 'MOT') {
        payload.route_milk_token = corrToken.trim();
      } else if (correctionTarget.type === 'CONTRACTOR') {
        payload.rmr_number = corrRmr.trim();
        payload.vehicle_number = corrVehicle.trim().toUpperCase();
      } else if (correctionTarget.type === 'LOCAL_SUPPLIER') {
        payload.local_supplier_id = corrLocalSupplierId || undefined;
        payload.rmr_number = corrRmr.trim();
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
    } catch (err: any) {
      setCorrError(err.message || 'An unexpected error occurred.');
    } finally {
      setCorrSubmitting(false);
    }
  };

  return (
    <div className="space-y-6">
      {/* Tab Navigation */}
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-[#EAE4D5] pb-3">
        <div className="flex flex-wrap gap-2">
          {canSubmit && (
            <>
              <button
                type="button"
                onClick={() => setActiveTab('MOT_ARRIVAL')}
                className={`flex items-center space-x-2 px-4 py-2.5 rounded-xl text-xs font-black transition-all ${
                  activeTab === 'MOT_ARRIVAL'
                    ? 'bg-[#1E3A8A] text-white shadow-xs'
                    : 'bg-white text-slate-700 hover:bg-[#F4F0E6] border border-[#EAE4D5]'
                }`}
              >
                <Truck className="w-4 h-4" />
                <span>Record MOT Arrival</span>
              </button>
              <button
                type="button"
                onClick={() => setActiveTab('CONTRACTOR_ARRIVAL')}
                className={`flex items-center space-x-2 px-4 py-2.5 rounded-xl text-xs font-black transition-all ${
                  activeTab === 'CONTRACTOR_ARRIVAL'
                    ? 'bg-[#1E3A8A] text-white shadow-xs'
                    : 'bg-white text-slate-700 hover:bg-[#F4F0E6] border border-[#EAE4D5]'
                }`}
              >
                <Building2 className="w-4 h-4" />
                <span>Record Contractor Arrival</span>
              </button>
              <button
                type="button"
                onClick={() => setActiveTab('LOCAL_SUPPLIER_ARRIVAL')}
                className={`flex items-center space-x-2 px-4 py-2.5 rounded-xl text-xs font-black transition-all ${
                  activeTab === 'LOCAL_SUPPLIER_ARRIVAL'
                    ? 'bg-emerald-700 text-white shadow-xs'
                    : 'bg-white text-slate-700 hover:bg-emerald-50/50 border border-[#EAE4D5]'
                }`}
              >
                <Users className="w-4 h-4" />
                <span>Record Local Supplier Arrival</span>
              </button>
            </>
          )}
          <button
            type="button"
            onClick={() => setActiveTab('HISTORY')}
            className={`flex items-center space-x-2 px-4 py-2.5 rounded-xl text-xs font-black transition-all ${
              activeTab === 'HISTORY'
                ? 'bg-[#1E3A8A] text-white shadow-xs'
                : 'bg-white text-slate-700 hover:bg-[#F4F0E6] border border-[#EAE4D5]'
            }`}
          >
            <Clock className="w-4 h-4" />
            <span>Arrival History & Corrections</span>
          </button>
        </div>
      </div>

      {/* 1. MOT ARRIVAL SUB-TAB */}
      {activeTab === 'MOT_ARRIVAL' && canSubmit && (
        <div className="space-y-6">
          {motSuccessResult ? (
            <div className="bg-emerald-50 border-2 border-emerald-500/40 rounded-2xl p-6 space-y-4">
              <div className="flex items-center space-x-3 text-emerald-800">
                <CheckCircle2 className="w-8 h-8 text-emerald-600 shrink-0" />
                <div>
                  <h3 className="text-base font-black">MOT Arrival Recorded & Journey Completed!</h3>
                  <p className="text-xs text-emerald-700">
                    The MOT journey has been completed. Tokens generated below:
                  </p>
                </div>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-4 bg-white p-4 rounded-xl border border-emerald-200">
                <div>
                  <span className="text-[11px] font-bold text-slate-500 uppercase tracking-wider">Route Milk Token</span>
                  <div className="text-base font-mono font-black text-slate-900 mt-0.5">
                    {motSuccessResult.route_milk_token}
                  </div>
                </div>
                <div>
                  <span className="text-[11px] font-bold text-emerald-700 uppercase tracking-wider">Generated ZMCC Token</span>
                  <div className="text-base font-mono font-black text-emerald-700 mt-0.5">
                    {motSuccessResult.zmcc_token}
                  </div>
                </div>
                <div>
                  <span className="text-[11px] font-bold text-slate-500 uppercase tracking-wider">Arrival Time</span>
                  <div className="text-xs font-bold text-slate-800 mt-0.5">
                    {new Date(motSuccessResult.arrival_timestamp).toLocaleString('en-GB', { timeZone: 'Asia/Karachi' })} PKT
                  </div>
                </div>
                <div>
                  <span className="text-[11px] font-bold text-slate-500 uppercase tracking-wider">Journey Number</span>
                  <div className="text-xs font-bold text-slate-800 mt-0.5">
                    {motSuccessResult.journey?.journey_number || selectedJourney?.journey_number}
                  </div>
                </div>
              </div>

              {motSuccessResult.journey?.summary && (
                <div className="p-4 rounded-xl bg-white border border-emerald-200 space-y-3">
                  <div className="flex items-center justify-between">
                    <span className="text-xs font-black uppercase tracking-wider text-slate-700">
                      MOT Journey Final Summary (v{motSuccessResult.journey.summary.summary_version} — Rev #{motSuccessResult.journey.summary.revision})
                    </span>
                    <span className="text-[11px] font-bold text-slate-500">
                      Ended: {new Date(motSuccessResult.journey.summary.journey_ended_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })} PKT
                    </span>
                  </div>

                  <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 text-center">
                    <div className="p-2 bg-slate-50 rounded-lg border border-[#EAE4D5]">
                      <div className="text-[10px] uppercase font-bold text-slate-500">Assigned Shops</div>
                      <div className="text-sm font-black text-slate-900">{motSuccessResult.journey.summary.assigned_shop_count}</div>
                    </div>
                    <div className="p-2 bg-slate-50 rounded-lg border border-[#EAE4D5]">
                      <div className="text-[10px] uppercase font-bold text-emerald-700">Collected Shops</div>
                      <div className="text-sm font-black text-emerald-800">{motSuccessResult.journey.summary.collected_shop_count}</div>
                    </div>
                    <div className="p-2 bg-slate-50 rounded-lg border border-[#EAE4D5]">
                      <div className="text-[10px] uppercase font-bold text-amber-700">Skipped Shops</div>
                      <div className="text-sm font-black text-amber-800">{motSuccessResult.journey.summary.skipped_shop_count}</div>
                    </div>
                    <div className="p-2 bg-slate-50 rounded-lg border border-[#EAE4D5]">
                      <div className="text-[10px] uppercase font-bold text-blue-700">Pending Sync</div>
                      <div className="text-sm font-black text-blue-800">{motSuccessResult.journey.summary.pending_shop_count}</div>
                    </div>
                  </div>

                  <div className="grid grid-cols-2 sm:grid-cols-6 gap-2 text-center">
                    <div className="p-2 bg-slate-50 rounded-lg border border-[#EAE4D5]">
                      <div className="text-[10px] uppercase font-bold text-slate-500">Gross Liters</div>
                      <div className="text-xs font-mono font-black text-slate-900">
                        {Number(motSuccessResult.journey.summary.total_gross_liters).toFixed(2)} L
                      </div>
                    </div>
                    <div className="p-2 bg-slate-50 rounded-lg border border-[#EAE4D5]">
                      <div className="text-[10px] uppercase font-bold text-slate-500">@13TS Liters</div>
                      <div className="text-xs font-mono font-black text-slate-900">
                        {Number(motSuccessResult.journey.summary.total_at_13ts_liters).toFixed(2)} L
                      </div>
                    </div>
                    <div className="p-2 bg-slate-50 rounded-lg border border-[#EAE4D5]">
                      <div className="text-[10px] uppercase font-bold text-slate-500">Weighted LR</div>
                      <div className="text-xs font-mono font-black text-slate-800">
                        {motSuccessResult.journey.summary.weighted_avg_lr != null ? Number(motSuccessResult.journey.summary.weighted_avg_lr).toFixed(2) : '—'}
                      </div>
                    </div>
                    <div className="p-2 bg-slate-50 rounded-lg border border-[#EAE4D5]">
                      <div className="text-[10px] uppercase font-bold text-slate-500">Weighted Fat</div>
                      <div className="text-xs font-mono font-black text-slate-800">
                        {motSuccessResult.journey.summary.weighted_avg_fat != null ? `${Number(motSuccessResult.journey.summary.weighted_avg_fat).toFixed(2)}%` : '—'}
                      </div>
                    </div>
                    <div className="p-2 bg-slate-50 rounded-lg border border-[#EAE4D5]">
                      <div className="text-[10px] uppercase font-bold text-slate-500">Weighted SNF</div>
                      <div className="text-xs font-mono font-black text-slate-800">
                        {motSuccessResult.journey.summary.weighted_avg_snf != null ? `${Number(motSuccessResult.journey.summary.weighted_avg_snf).toFixed(2)}%` : '—'}
                      </div>
                    </div>
                    <div className="p-2 bg-slate-50 rounded-lg border border-[#EAE4D5]">
                      <div className="text-[10px] uppercase font-bold text-slate-500">Weighted TS</div>
                      <div className="text-xs font-mono font-black text-slate-800">
                        {motSuccessResult.journey.summary.weighted_avg_ts != null ? `${Number(motSuccessResult.journey.summary.weighted_avg_ts).toFixed(2)}%` : '—'}
                      </div>
                    </div>
                  </div>

                  {motSuccessResult.journey.summary.pending_shop_count > 0 && (
                    <div className="flex items-center space-x-2 text-[11px] font-bold text-blue-800 bg-blue-50 p-2.5 rounded-lg border border-blue-200">
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
                className="px-4 py-2 bg-emerald-600 hover:bg-emerald-700 text-white rounded-xl text-xs font-bold transition-all"
              >
                Record Another Arrival
              </button>
            </div>
          ) : (
            <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
              {/* Arriving Journeys Selector */}
              <div className="lg:col-span-6 space-y-4">
                <div className="flex items-center justify-between">
                  <h3 className="text-sm font-black text-slate-900">
                    Active Collecting Journeys ({arrivingJourneys.length})
                  </h3>
                  <button
                    type="button"
                    onClick={fetchArrivingJourneys}
                    className="p-1.5 text-slate-500 hover:text-slate-800 rounded-lg hover:bg-slate-100"
                    title="Refresh"
                  >
                    <RefreshCw className={`w-4 h-4 ${loadingJourneys ? 'animate-spin' : ''}`} />
                  </button>
                </div>

                {arrivingJourneys.length === 0 ? (
                  <div className="bg-white rounded-2xl border border-[#EAE4D5] p-8 text-center text-xs text-slate-500">
                    No MOT journeys currently in COLLECTING status for this ZMCC.
                  </div>
                ) : (
                  <div className="space-y-3">
                    {arrivingJourneys.map((j) => {
                      const isSelected = selectedJourney?.id === j.id;
                      return (
                        <div
                          key={j.id}
                          onClick={() => setSelectedJourney(j)}
                          className={`p-4 rounded-2xl border transition-all cursor-pointer ${
                            isSelected
                              ? 'bg-blue-50/60 border-[#1E3A8A] shadow-xs'
                              : 'bg-white border-[#EAE4D5] hover:border-slate-300'
                          }`}
                        >
                          <div className="flex items-center justify-between mb-2">
                            <span className="font-mono text-xs font-black text-[#1E3A8A]">
                              {j.journey_number}
                            </span>
                            <span className="text-[11px] font-bold px-2 py-0.5 rounded-full bg-blue-100 text-blue-800">
                              COLLECTING
                            </span>
                          </div>
                          <div className="text-xs font-bold text-slate-800">
                            {j.route?.route_code} — {j.route?.name}
                          </div>
                          <div className="text-[11px] text-slate-600 mt-1 flex flex-wrap gap-x-4">
                            <span>Vehicle: <strong>{j.mot_vehicle?.vehicle_number}</strong></span>
                            <span>Driver: <strong>{j.mot_profile?.name}</strong></span>
                          </div>
                          <div className="text-[11px] text-slate-500 mt-2 flex justify-between border-t border-slate-100 pt-2">
                            <span>Visited: <strong>{j.visited_stops}/{j.total_stops} stops</strong></span>
                            <span>Gross: <strong>{j.total_gross_liters} L</strong></span>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>

              {/* Arrival Form */}
              <div className="lg:col-span-6 bg-white rounded-2xl border border-[#EAE4D5] p-6 shadow-xs space-y-4">
                <h3 className="text-sm font-black text-slate-900 border-b pb-2">
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
                    <div className="p-3 bg-slate-50 rounded-xl border border-slate-200 text-xs space-y-1">
                      <div>Selected Journey: <strong className="font-mono">{selectedJourney.journey_number}</strong></div>
                      <div>Vehicle: <strong>{selectedJourney.mot_vehicle?.vehicle_number}</strong></div>
                      <div>Driver: <strong>{selectedJourney.mot_profile?.name}</strong></div>
                    </div>

                    <div>
                      <label className="block text-xs font-bold text-slate-700 mb-1">
                        Route Milk Token (from physical slip) <span className="text-rose-500">*</span>
                      </label>
                      <input
                        type="text"
                        value={routeMilkToken}
                        onChange={(e) => setRouteMilkToken(e.target.value)}
                        placeholder="e.g. RMT-10293"
                        required
                        className="w-full text-xs font-bold px-3 py-2 border rounded-xl focus:ring-2 focus:ring-[#1E3A8A] outline-hidden font-mono uppercase"
                      />
                    </div>

                    <div>
                      <label className="block text-xs font-bold text-slate-700 mb-1">
                        Arrival Timestamp (PKT) <span className="text-rose-500">*</span>
                      </label>
                      <input
                        type="datetime-local"
                        value={motArrivalTimestamp}
                        onChange={(e) => setMotArrivalTimestamp(e.target.value)}
                        required
                        className="w-full text-xs font-bold px-3 py-2 border rounded-xl focus:ring-2 focus:ring-[#1E3A8A] outline-hidden"
                      />
                    </div>

                    <div>
                      <div className="flex items-center justify-between mb-1">
                        <label className="text-xs font-bold text-slate-700">PHE GPS Coordinates (Optional)</label>
                        <button
                          type="button"
                          onClick={() => captureGps('MOT')}
                          className="text-[11px] font-bold text-[#1E3A8A] hover:underline flex items-center space-x-1"
                        >
                          <MapPin className="w-3 h-3" />
                          <span>Capture GPS</span>
                        </button>
                      </div>
                      <div className="text-xs text-slate-600 bg-slate-50 p-2.5 rounded-xl border font-mono">
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
                      className="w-full py-2.5 bg-[#1E3A8A] hover:bg-blue-900 text-white rounded-xl text-xs font-bold transition-all disabled:opacity-50"
                    >
                      {motSubmitting ? 'Recording Arrival...' : 'Confirm Arrival & Generate ZMCC Token'}
                    </button>
                  </form>
                )}
              </div>
            </div>
          )}
        </div>
      )}

      {/* 2. CONTRACTOR ARRIVAL SUB-TAB */}
      {activeTab === 'CONTRACTOR_ARRIVAL' && canSubmit && (
        <div className="max-w-xl mx-auto bg-white rounded-2xl border border-[#EAE4D5] p-6 shadow-xs space-y-4">
          <h3 className="text-sm font-black text-slate-900 border-b pb-2">
            Record Contractor Arrival at ZMCC
          </h3>

          {contractorSuccessResult ? (
            <div className="bg-emerald-50 border border-emerald-300 rounded-xl p-6 space-y-4">
              <div className="flex items-center space-x-3 text-emerald-800">
                <CheckCircle2 className="w-6 h-6 text-emerald-600" />
                <h4 className="text-sm font-bold">Contractor Arrival Recorded!</h4>
              </div>

              <div className="space-y-2 text-xs">
                <div>ZMCC Token: <strong className="font-mono text-emerald-800 text-sm">{contractorSuccessResult.zmcc_token}</strong></div>
                <div>Contractor RMR: <strong className="font-mono">{contractorSuccessResult.rmr_number}</strong></div>
                <div>Vehicle: <strong>{contractorSuccessResult.vehicle_number}</strong></div>
                <div>Contractor: <strong>{contractorSuccessResult.contractor_source?.name}</strong></div>
                <div>Arrival Date: <strong>{contractorSuccessResult.arrival_date}</strong></div>
              </div>

              <button
                type="button"
                onClick={() => {
                  setContractorSuccessResult(null);
                  initContractorForm();
                }}
                className="px-4 py-2 bg-emerald-600 text-white rounded-xl text-xs font-bold"
              >
                Record Another Contractor
              </button>
            </div>
          ) : (
            <form onSubmit={handleContractorSubmit} className="space-y-4">
              {contractorError && (
                <div className="p-3 bg-rose-50 border border-rose-200 text-rose-800 text-xs rounded-xl flex items-center space-x-2">
                  <AlertCircle className="w-4 h-4 shrink-0" />
                  <span>{contractorError}</span>
                </div>
              )}

              <div>
                <label className="block text-xs font-bold text-slate-700 mb-1">
                  Contractor Source <span className="text-rose-500">*</span>
                </label>
                <select
                  value={selectedContractorId}
                  onChange={(e) => setSelectedContractorId(e.target.value)}
                  required
                  className="w-full text-xs font-bold px-3 py-2 border rounded-xl focus:ring-2 focus:ring-[#1E3A8A] outline-hidden bg-white"
                >
                  <option value="">-- Select Active Contractor --</option>
                  {contractors.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.code} — {c.name}
                    </option>
                  ))}
                </select>
              </div>

              <div>
                <label className="block text-xs font-bold text-slate-700 mb-1">
                  Contractor RMR No. (from physical slip) <span className="text-rose-500">*</span>
                </label>
                <input
                  type="text"
                  inputMode="numeric"
                  pattern="[0-9]*"
                  maxLength={100}
                  value={contractorRmrNumber}
                  onChange={(e) => setContractorRmrNumber(e.target.value)}
                  placeholder="e.g. 002345"
                  required
                  className="w-full text-xs font-bold px-3 py-2 border rounded-xl focus:ring-2 focus:ring-[#1E3A8A] outline-hidden font-mono"
                />
              </div>

              <div>
                <label className="block text-xs font-bold text-slate-700 mb-1">
                  Vehicle Number <span className="text-rose-500">*</span>
                </label>
                <input
                  type="text"
                  value={contractorVehicleNumber}
                  onChange={(e) => setContractorVehicleNumber(e.target.value.toUpperCase())}
                  placeholder="e.g. LES-4029"
                  required
                  className="w-full text-xs font-bold px-3 py-2 border rounded-xl focus:ring-2 focus:ring-[#1E3A8A] outline-hidden font-mono uppercase"
                />
              </div>

              <div>
                <label className="block text-xs font-bold text-slate-700 mb-1">
                  Arrival Timestamp (PKT) <span className="text-rose-500">*</span>
                </label>
                <input
                  type="datetime-local"
                  value={contractorArrivalTimestamp}
                  onChange={(e) => setContractorArrivalTimestamp(e.target.value)}
                  required
                  className="w-full text-xs font-bold px-3 py-2 border rounded-xl focus:ring-2 focus:ring-[#1E3A8A] outline-hidden"
                />
              </div>

              <div>
                <div className="flex items-center justify-between mb-1">
                  <label className="text-xs font-bold text-slate-700">PHE GPS Coordinates (Optional)</label>
                  <button
                    type="button"
                    onClick={() => captureGps('CONTRACTOR')}
                    className="text-[11px] font-bold text-[#1E3A8A] hover:underline flex items-center space-x-1"
                  >
                    <MapPin className="w-3 h-3" />
                    <span>Capture GPS</span>
                  </button>
                </div>
                <div className="text-xs text-slate-600 bg-slate-50 p-2.5 rounded-xl border font-mono">
                  {contractorGps.lat != null ? (
                    <span>Lat: {contractorGps.lat}, Lng: {contractorGps.lng} (±{contractorGps.acc}m)</span>
                  ) : (
                    <span className="text-slate-400">GPS not captured yet</span>
                  )}
                </div>
              </div>

              <button
                type="submit"
                disabled={contractorSubmitting}
                className="w-full py-2.5 bg-[#1E3A8A] hover:bg-blue-900 text-white rounded-xl text-xs font-bold transition-all disabled:opacity-50"
              >
                {contractorSubmitting ? 'Recording Arrival...' : 'Record Contractor Arrival & Generate Token'}
              </button>
            </form>
          )}
        </div>
      )}

      {/* 2.5 LOCAL SUPPLIER ARRIVAL SUB-TAB */}
      {activeTab === 'LOCAL_SUPPLIER_ARRIVAL' && canSubmit && (
        <div className="max-w-xl mx-auto bg-white rounded-2xl border border-emerald-200 p-6 shadow-xs space-y-4">
          <div className="flex items-center justify-between border-b border-emerald-100 pb-3">
            <div>
              <div className="flex items-center space-x-2">
                <Users className="w-5 h-5 text-emerald-700" />
                <h3 className="text-sm font-black text-slate-900">
                  Record Local Supplier Arrival at ZMCC
                </h3>
              </div>
              <p className="text-[11px] text-slate-500 mt-0.5">
                Fast onboarding & intake for direct local suppliers within this ZMCC
              </p>
            </div>
            <button
              type="button"
              onClick={() => {
                setShowAddSupplierModal(true);
                setAddSupplierError(null);
              }}
              className="flex items-center space-x-1 px-3 py-1.5 bg-emerald-50 text-emerald-800 hover:bg-emerald-100 border border-emerald-300 rounded-xl text-xs font-bold transition-all cursor-pointer"
            >
              <UserPlus className="w-3.5 h-3.5 text-emerald-700" />
              <span>+ Add Local Supplier</span>
            </button>
          </div>

          {localSupplierSuccessResult ? (
            <div className="bg-emerald-50 border border-emerald-300 rounded-xl p-6 space-y-4">
              <div className="flex items-center space-x-3 text-emerald-800">
                <CheckCircle2 className="w-6 h-6 text-emerald-600" />
                <div>
                  <h4 className="text-sm font-bold">Local Supplier Arrival Recorded!</h4>
                  <span className="text-[11px] text-emerald-700">ZMCC-Local Intake Verified</span>
                </div>
              </div>

              <div className="space-y-2 text-xs divide-y divide-emerald-200/60 pt-2">
                <div className="pb-1.5">
                  ZMCC Token: <strong className="font-mono text-emerald-900 text-sm font-black">{localSupplierSuccessResult.zmcc_token}</strong>
                </div>
                <div className="py-1.5">
                  Supplier RMR No: <strong className="font-mono text-slate-800">{localSupplierSuccessResult.rmr_number}</strong>
                </div>
                <div className="py-1.5">
                  Vehicle: <strong className="font-mono text-slate-800">{localSupplierSuccessResult.vehicle_number}</strong>
                </div>
                <div className="py-1.5">
                  Supplier: <strong className="text-slate-900">{localSupplierSuccessResult.local_supplier?.name}</strong>{' '}
                  <span className="text-slate-500 font-mono text-[11px]">({localSupplierSuccessResult.local_supplier?.local_supplier_code})</span>
                </div>
                <div className="py-1.5">
                  Candidate ERP Reference:{' '}
                  {localSupplierSuccessResult.local_supplier?.erp_reference ? (
                    <span className="inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-bold bg-amber-100 text-amber-800">
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
                className="px-4 py-2 bg-emerald-600 hover:bg-emerald-700 text-white rounded-xl text-xs font-bold transition-all cursor-pointer"
              >
                Record Another Local Supplier
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
                  <label className="block text-xs font-bold text-slate-700">
                    Local Supplier <span className="text-rose-500">*</span>
                  </label>
                  <button
                    type="button"
                    onClick={() => {
                      setShowAddSupplierModal(true);
                      setAddSupplierError(null);
                    }}
                    className="text-[11px] font-bold text-emerald-700 hover:underline flex items-center space-x-1 cursor-pointer"
                  >
                    <Plus className="w-3 h-3" />
                    <span>Quick Add Supplier</span>
                  </button>
                </div>
                <select
                  value={selectedLocalSupplierId}
                  onChange={(e) => setSelectedLocalSupplierId(e.target.value)}
                  required
                  className="w-full text-xs font-bold px-3 py-2 border rounded-xl focus:ring-2 focus:ring-emerald-600 outline-hidden bg-white"
                >
                  <option value="">-- Select Local Supplier Directory Entry --</option>
                  {localSuppliers.map((s) => (
                    <option key={s.id} value={s.id}>
                      {s.local_supplier_code} — {s.name} {s.erp_reference ? `(ERP: ${s.erp_reference} - Pending)` : ''}
                    </option>
                  ))}
                </select>
                {localSuppliers.length === 0 && !loadingLocalSuppliers && (
                  <p className="text-[11px] text-amber-700 mt-1">
                    No suppliers in directory yet. Click "+ Add Local Supplier" above to onboard the first one.
                  </p>
                )}
              </div>

              <div>
                <label className="block text-xs font-bold text-slate-700 mb-1">
                  Supplier RMR No. (from physical slip) <span className="text-rose-500">*</span>
                </label>
                <input
                  type="text"
                  inputMode="numeric"
                  pattern="[0-9]*"
                  maxLength={100}
                  value={localSupplierRmrNumber}
                  onChange={(e) => setLocalSupplierRmrNumber(e.target.value)}
                  placeholder="e.g. 002345"
                  required
                  className="w-full text-xs font-bold px-3 py-2 border rounded-xl focus:ring-2 focus:ring-emerald-600 outline-hidden font-mono"
                />
              </div>

              <div>
                <label className="block text-xs font-bold text-slate-700 mb-1">
                  Vehicle Number <span className="text-rose-500">*</span>
                </label>
                <input
                  type="text"
                  value={localSupplierVehicleNumber}
                  onChange={(e) => setLocalSupplierVehicleNumber(e.target.value.toUpperCase())}
                  placeholder="e.g. LES-4029"
                  required
                  className="w-full text-xs font-bold px-3 py-2 border rounded-xl focus:ring-2 focus:ring-emerald-600 outline-hidden font-mono uppercase"
                />
              </div>

              <div>
                <label className="block text-xs font-bold text-slate-700 mb-1">
                  Arrival Timestamp (PKT) <span className="text-rose-500">*</span>
                </label>
                <input
                  type="datetime-local"
                  value={localSupplierArrivalTimestamp}
                  onChange={(e) => setLocalSupplierArrivalTimestamp(e.target.value)}
                  required
                  className="w-full text-xs font-bold px-3 py-2 border rounded-xl focus:ring-2 focus:ring-emerald-600 outline-hidden"
                />
              </div>

              <div>
                <div className="flex items-center justify-between mb-1">
                  <label className="text-xs font-bold text-slate-700">PHE GPS Coordinates (Optional)</label>
                  <button
                    type="button"
                    onClick={() => captureGps('LOCAL_SUPPLIER')}
                    className="text-[11px] font-bold text-emerald-700 hover:underline flex items-center space-x-1 cursor-pointer"
                  >
                    <MapPin className="w-3 h-3" />
                    <span>Capture GPS</span>
                  </button>
                </div>
                <div className="text-xs text-slate-600 bg-slate-50 p-2.5 rounded-xl border font-mono">
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
                className="w-full py-2.5 bg-emerald-700 hover:bg-emerald-800 text-white rounded-xl text-xs font-bold transition-all disabled:opacity-50 cursor-pointer"
              >
                {localSupplierSubmitting ? 'Recording Arrival...' : 'Record Local Supplier Arrival & Generate Token'}
              </button>
            </form>
          )}
        </div>
      )}

      {/* 3. ARRIVAL HISTORY SUB-TAB */}
      {activeTab === 'HISTORY' && (
        <div className="space-y-4">
          {/* Filters */}
          <div className="bg-white rounded-2xl border border-[#EAE4D5] p-4 flex flex-wrap items-center justify-between gap-3 shadow-xs">
            <div className="flex flex-wrap items-center gap-3">
              <div className="flex rounded-xl border border-slate-200 overflow-hidden text-xs font-bold">
                <button
                  type="button"
                  onClick={() => setHistoryType('ALL')}
                  className={`px-3 py-1.5 ${historyType === 'ALL' ? 'bg-[#1E3A8A] text-white' : 'bg-white text-slate-700'}`}
                >
                  All
                </button>
                <button
                  type="button"
                  onClick={() => setHistoryType('MOT')}
                  className={`px-3 py-1.5 ${historyType === 'MOT' ? 'bg-[#1E3A8A] text-white' : 'bg-white text-slate-700'}`}
                >
                  MOT Only
                </button>
                <button
                  type="button"
                  onClick={() => setHistoryType('CONTRACTOR')}
                  className={`px-3 py-1.5 ${historyType === 'CONTRACTOR' ? 'bg-[#1E3A8A] text-white' : 'bg-white text-slate-700'}`}
                >
                  Contractors
                </button>
                <button
                  type="button"
                  onClick={() => setHistoryType('LOCAL_SUPPLIER')}
                  className={`px-3 py-1.5 ${historyType === 'LOCAL_SUPPLIER' ? 'bg-emerald-700 text-white' : 'bg-white text-slate-700'}`}
                >
                  Local Suppliers
                </button>
              </div>

              <input
                type="date"
                value={historyDate}
                onChange={(e) => setHistoryDate(e.target.value)}
                className="text-xs font-bold px-3 py-1.5 border rounded-xl bg-white"
              />

              <div className="relative">
                <Search className="w-3.5 h-3.5 absolute left-3 top-2.5 text-slate-400" />
                <input
                  type="text"
                  value={historySearch}
                  onChange={(e) => setHistorySearch(e.target.value)}
                  placeholder="Search tokens, vehicle..."
                  className="text-xs pl-8 pr-3 py-1.5 border rounded-xl bg-white w-48"
                />
              </div>
            </div>

            <button
              type="button"
              onClick={fetchHistory}
              className="flex items-center space-x-1 px-3 py-1.5 bg-slate-100 hover:bg-slate-200 text-slate-700 rounded-xl text-xs font-bold"
            >
              <RefreshCw className={`w-3.5 h-3.5 ${loadingHistory ? 'animate-spin' : ''}`} />
              <span>Refresh</span>
            </button>
          </div>

          {/* Table */}
          <div className="bg-white rounded-2xl border border-[#EAE4D5] overflow-hidden shadow-xs">
            <div className="overflow-x-auto">
              <table className="w-full text-left text-xs border-collapse">
                <thead>
                  <tr className="bg-slate-50 border-b border-[#EAE4D5] text-[11px] uppercase tracking-wider text-slate-500 font-bold">
                    <th className="p-3">Type</th>
                    <th className="p-3">ZMCC Token</th>
                    <th className="p-3">Route / Slip Token</th>
                    <th className="p-3">Vehicle / Source</th>
                    <th className="p-3">Arrival Time (PKT)</th>
                    <th className="p-3">Recorded By</th>
                    <th className="p-3">Corrections</th>
                    {canCorrect && <th className="p-3 text-right">Action</th>}
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {/* MOT Arrivals */}
                  {(historyType === 'ALL' || historyType === 'MOT') &&
                    motArrivals.map((arr) => (
                      <tr key={`mot-${arr.id}`} className="hover:bg-slate-50/60 transition-colors">
                        <td className="p-3">
                          <span className="px-2 py-0.5 rounded-full text-[10px] font-black bg-blue-100 text-blue-800">
                            MOT
                          </span>
                        </td>
                        <td className="p-3 font-mono font-black text-slate-900">{arr.zmcc_token}</td>
                        <td className="p-3 font-mono font-bold text-slate-700">{arr.route_milk_token}</td>
                        <td className="p-3">
                          <div className="font-bold text-slate-800">
                            {arr.journey?.vehicle_number || '—'}
                          </div>
                          <div className="text-[11px] text-slate-500">
                            {arr.journey?.journey_number} ({arr.journey?.route_code})
                          </div>
                        </td>
                        <td className="p-3 text-slate-700 font-medium">
                          {new Date(arr.arrival_timestamp).toLocaleString('en-GB', { timeZone: 'Asia/Karachi' })}
                        </td>
                        <td className="p-3 text-slate-600">{arr.recorded_by?.full_name || arr.recorded_by?.username}</td>
                        <td className="p-3">
                          <span
                            className={`text-[11px] font-bold px-2 py-0.5 rounded-full ${
                              arr.correction_count >= 2
                                ? 'bg-rose-100 text-rose-800'
                                : arr.correction_count > 0
                                ? 'bg-amber-100 text-amber-800'
                                : 'bg-slate-100 text-slate-600'
                            }`}
                          >
                            {arr.correction_count}/2 {arr.correction_count >= 2 && '(Locked)'}
                          </span>
                        </td>
                        {canCorrect && (
                          <td className="p-3 text-right">
                            {arr.correction_count < 2 ? (
                              <button
                                type="button"
                                onClick={() => openCorrectionModal('MOT', arr)}
                                className="px-2.5 py-1 text-xs font-bold text-[#1E3A8A] hover:bg-blue-50 rounded-lg"
                              >
                                Correct
                              </button>
                            ) : (
                              <span className="text-slate-400 text-xs">Locked</span>
                            )}
                          </td>
                        )}
                      </tr>
                    ))}

                  {/* Contractor Arrivals */}
                  {(historyType === 'ALL' || historyType === 'CONTRACTOR') &&
                    contractorArrivals.map((arr) => (
                      <tr key={`con-${arr.id}`} className="hover:bg-slate-50/60 transition-colors">
                        <td className="p-3">
                          <span className="px-2 py-0.5 rounded-full text-[10px] font-black bg-amber-100 text-amber-800">
                            CONTRACTOR
                          </span>
                        </td>
                        <td className="p-3 font-mono font-black text-slate-900">{arr.zmcc_token}</td>
                        <td className="p-3 font-mono font-bold text-amber-900">{arr.rmr_number || '—'}</td>
                        <td className="p-3">
                          <div className="font-bold text-slate-800">{arr.vehicle_number}</div>
                          <div className="text-[11px] text-slate-500">
                            {arr.contractor_source?.name} ({arr.contractor_source?.code})
                          </div>
                        </td>
                        <td className="p-3 text-slate-700 font-medium">
                          {new Date(arr.arrival_timestamp).toLocaleString('en-GB', { timeZone: 'Asia/Karachi' })}
                        </td>
                        <td className="p-3 text-slate-600">{arr.recorded_by?.full_name || arr.recorded_by?.username}</td>
                        <td className="p-3">
                          <span
                            className={`text-[11px] font-bold px-2 py-0.5 rounded-full ${
                              arr.correction_count >= 2
                                ? 'bg-rose-100 text-rose-800'
                                : arr.correction_count > 0
                                ? 'bg-amber-100 text-amber-800'
                                : 'bg-slate-100 text-slate-600'
                            }`}
                          >
                            {arr.correction_count}/2 {arr.correction_count >= 2 && '(Locked)'}
                          </span>
                        </td>
                        {canCorrect && (
                          <td className="p-3 text-right">
                            {arr.correction_count < 2 ? (
                              <button
                                type="button"
                                onClick={() => openCorrectionModal('CONTRACTOR', arr)}
                                className="px-2.5 py-1 text-xs font-bold text-[#1E3A8A] hover:bg-blue-50 rounded-lg"
                              >
                                Correct
                              </button>
                            ) : (
                              <span className="text-slate-400 text-xs">Locked</span>
                            )}
                          </td>
                        )}
                      </tr>
                    ))}

                  {/* Local Supplier Arrivals */}
                  {(historyType === 'ALL' || historyType === 'LOCAL_SUPPLIER') &&
                    localSupplierArrivals.map((arr) => (
                      <tr key={`ls-${arr.id}`} className="hover:bg-slate-50/60 transition-colors">
                        <td className="p-3">
                          <span className="px-2 py-0.5 rounded-full text-[10px] font-black bg-emerald-100 text-emerald-800">
                            LOCAL_SUPPLIER
                          </span>
                        </td>
                        <td className="p-3 font-mono font-black text-slate-900">{arr.zmcc_token}</td>
                        <td className="p-3 font-mono font-bold text-emerald-900">{arr.rmr_number || '—'}</td>
                        <td className="p-3">
                          <div className="font-bold text-slate-800">{arr.vehicle_number}</div>
                          <div className="text-[11px] text-slate-600 font-medium">
                            {arr.local_supplier?.name}{' '}
                            <span className="font-mono text-slate-400">({arr.local_supplier?.local_supplier_code})</span>
                          </div>
                          {arr.local_supplier?.erp_reference && (
                            <div className="text-[10px] text-amber-700 font-semibold">
                              ERP: {arr.local_supplier.erp_reference} (Pending Verification)
                            </div>
                          )}
                        </td>
                        <td className="p-3 text-slate-700 font-medium">
                          {new Date(arr.arrival_timestamp).toLocaleString('en-GB', { timeZone: 'Asia/Karachi' })}
                        </td>
                        <td className="p-3 text-slate-600">{arr.recorded_by?.full_name || arr.recorded_by?.username}</td>
                        <td className="p-3">
                          <span
                            className={`text-[11px] font-bold px-2 py-0.5 rounded-full ${
                              arr.correction_count >= 2
                                ? 'bg-rose-100 text-rose-800'
                                : arr.correction_count > 0
                                ? 'bg-amber-100 text-amber-800'
                                : 'bg-slate-100 text-slate-600'
                            }`}
                          >
                            {arr.correction_count}/2 {arr.correction_count >= 2 && '(Locked)'}
                          </span>
                        </td>
                        {canCorrect && (
                          <td className="p-3 text-right">
                            {arr.correction_count < 2 ? (
                              <button
                                type="button"
                                onClick={() => openCorrectionModal('LOCAL_SUPPLIER', arr)}
                                className="px-2.5 py-1 text-xs font-bold text-emerald-700 hover:bg-emerald-50 rounded-lg cursor-pointer"
                              >
                                Correct
                              </button>
                            ) : (
                              <span className="text-slate-400 text-xs">Locked</span>
                            )}
                          </td>
                        )}
                      </tr>
                    ))}

                  {motArrivals.length === 0 && contractorArrivals.length === 0 && localSupplierArrivals.length === 0 && (
                    <tr>
                      <td colSpan={canCorrect ? 8 : 7} className="p-8 text-center text-xs text-slate-400">
                        No arrival records found matching current criteria.
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}

      {/* 4. CORRECTION MODAL (ZMCC MANAGER / SUPER ADMIN) */}
      {correctionTarget && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/50 backdrop-blur-xs">
          <div className="bg-white rounded-2xl max-w-lg w-full p-6 shadow-2xl space-y-4 border border-[#EAE4D5]">
            <div className="flex items-center justify-between border-b pb-3">
              <div>
                <h3 className="text-sm font-black text-slate-900">
                  Correct {correctionTarget.type} Arrival Record
                </h3>
                <p className="text-[11px] text-slate-500">
                  Token: <strong>{correctionTarget.record.zmcc_token}</strong> (Remaining Corrections:{' '}
                  <strong>{2 - correctionTarget.record.correction_count}</strong>)
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
                  <label className="block font-bold text-slate-700 mb-1">Route Milk Token</label>
                  <input
                    type="text"
                    value={corrToken}
                    onChange={(e) => setCorrToken(e.target.value)}
                    required
                    className="w-full px-3 py-2 border rounded-xl font-mono uppercase"
                  />
                </div>
              ) : correctionTarget.type === 'CONTRACTOR' ? (
                <>
                  <div>
                    <label className="block font-bold text-slate-700 mb-1">Contractor RMR Number</label>
                    <input
                      type="text"
                      inputMode="numeric"
                      pattern="[0-9]*"
                      maxLength={100}
                      value={corrRmr}
                      onChange={(e) => setCorrRmr(e.target.value)}
                      placeholder="e.g. 002345"
                      required
                      className="w-full px-3 py-2 border rounded-xl font-mono"
                    />
                  </div>
                  <div>
                    <label className="block font-bold text-slate-700 mb-1">Vehicle Number</label>
                    <input
                      type="text"
                      value={corrVehicle}
                      onChange={(e) => setCorrVehicle(e.target.value.toUpperCase())}
                      required
                      className="w-full px-3 py-2 border rounded-xl font-mono uppercase"
                    />
                  </div>
                </>
              ) : (
                <>
                  <div>
                    <label className="block font-bold text-slate-700 mb-1">Local Supplier (Same ZMCC)</label>
                    <select
                      value={corrLocalSupplierId}
                      onChange={(e) => setCorrLocalSupplierId(e.target.value)}
                      required
                      className="w-full px-3 py-2 border rounded-xl bg-white font-bold"
                    >
                      <option value="">-- Select Local Supplier --</option>
                      {localSuppliers.map((s) => (
                        <option key={s.id} value={s.id}>
                          {s.local_supplier_code} — {s.name}
                        </option>
                      ))}
                    </select>
                  </div>
                  <div>
                    <label className="block font-bold text-slate-700 mb-1">Supplier RMR Number</label>
                    <input
                      type="text"
                      inputMode="numeric"
                      pattern="[0-9]*"
                      maxLength={100}
                      value={corrRmr}
                      onChange={(e) => setCorrRmr(e.target.value)}
                      placeholder="e.g. 002345"
                      required
                      className="w-full px-3 py-2 border rounded-xl font-mono"
                    />
                  </div>
                  <div>
                    <label className="block font-bold text-slate-700 mb-1">Vehicle Number</label>
                    <input
                      type="text"
                      value={corrVehicle}
                      onChange={(e) => setCorrVehicle(e.target.value.toUpperCase())}
                      required
                      className="w-full px-3 py-2 border rounded-xl font-mono uppercase"
                    />
                  </div>
                </>
              )}

              <div>
                <label className="block font-bold text-slate-700 mb-1">Arrival Timestamp (PKT)</label>
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
                  <label className="block font-bold text-slate-700 mb-1">Latitude</label>
                  <input
                    type="number"
                    step="0.0000001"
                    value={corrLat}
                    onChange={(e) => setCorrLat(e.target.value)}
                    className="w-full px-3 py-2 border rounded-xl"
                  />
                </div>
                <div>
                  <label className="block font-bold text-slate-700 mb-1">Longitude</label>
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
                <label className="block font-bold text-slate-700 mb-1">
                  Reason for Correction <span className="text-rose-500">*</span>
                </label>
                <textarea
                  value={corrReason}
                  onChange={(e) => setCorrReason(e.target.value)}
                  placeholder="Explain why this correction is being made (Audit logged)..."
                  required
                  rows={3}
                  className="w-full px-3 py-2 border rounded-xl"
                />
              </div>

              <div className="flex justify-end space-x-2 pt-2 border-t">
                <button
                  type="button"
                  onClick={() => setCorrectionTarget(null)}
                  className="px-4 py-2 border rounded-xl text-slate-600 font-bold hover:bg-slate-50 cursor-pointer"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={corrSubmitting}
                  className="px-4 py-2 bg-[#1E3A8A] text-white rounded-xl font-bold hover:bg-blue-900 disabled:opacity-50 cursor-pointer"
                >
                  {corrSubmitting ? 'Saving...' : 'Apply Correction'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* 5. INLINE ADD LOCAL SUPPLIER MODAL */}
      {showAddSupplierModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/50 backdrop-blur-xs">
          <div className="bg-white rounded-2xl max-w-md w-full p-6 shadow-2xl space-y-4 border border-emerald-200">
            <div className="flex items-center justify-between border-b border-emerald-100 pb-3">
              <div className="flex items-center space-x-2">
                <UserPlus className="w-5 h-5 text-emerald-700" />
                <h3 className="text-sm font-black text-slate-900">
                  Quick Onboard Local Supplier
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

            <p className="text-[11px] text-slate-500 bg-slate-50 p-2.5 rounded-xl border">
              Creates a local supplier directory entry for this ZMCC. Candidate ERP reference is optional and remains strictly <strong className="text-amber-700">Pending Verification</strong>.
            </p>

            {addSupplierError && (
              <div className="p-3 bg-rose-50 border border-rose-200 text-rose-800 text-xs rounded-xl flex items-center space-x-2">
                <AlertCircle className="w-4 h-4 shrink-0" />
                <span>{addSupplierError}</span>
              </div>
            )}

            <form onSubmit={handleCreateLocalSupplier} className="space-y-3 text-xs">
              <div>
                <label className="block font-bold text-slate-700 mb-1">
                  Supplier Name <span className="text-rose-500">*</span>
                </label>
                <input
                  type="text"
                  value={newSupplierName}
                  onChange={(e) => setNewSupplierName(e.target.value)}
                  placeholder="e.g. Haji Milk Supplier"
                  required
                  maxLength={150}
                  className="w-full px-3 py-2 border rounded-xl focus:ring-2 focus:ring-emerald-600 outline-hidden font-bold"
                />
              </div>

              <div>
                <label className="block font-bold text-slate-700 mb-1">
                  Phone (Optional)
                </label>
                <input
                  type="text"
                  value={newSupplierPhone}
                  onChange={(e) => setNewSupplierPhone(e.target.value)}
                  placeholder="e.g. 0300-1234567"
                  maxLength={50}
                  className="w-full px-3 py-2 border rounded-xl font-mono"
                />
              </div>

              <div>
                <label className="block font-bold text-slate-700 mb-1">
                  CNIC (Optional)
                </label>
                <input
                  type="text"
                  value={newSupplierCnic}
                  onChange={(e) => setNewSupplierCnic(e.target.value)}
                  placeholder="e.g. 35201-1234567-1"
                  maxLength={50}
                  className="w-full px-3 py-2 border rounded-xl font-mono"
                />
              </div>

              <div>
                <label className="block font-bold text-slate-700 mb-1">
                  Candidate ERP Reference (Optional - Pending Verification)
                </label>
                <input
                  type="text"
                  value={newSupplierErpRef}
                  onChange={(e) => setNewSupplierErpRef(e.target.value)}
                  placeholder="e.g. 00-2345 or SAP code"
                  maxLength={100}
                  className="w-full px-3 py-2 border rounded-xl font-mono"
                />
                <p className="text-[10px] text-slate-400 mt-1">
                  Leading zeros preserved. Placeholders like 'New', 'Pending', 'Unknown', 'N/A' will be rejected.
                </p>
              </div>

              <div className="flex justify-end space-x-2 pt-3 border-t">
                <button
                  type="button"
                  onClick={() => setShowAddSupplierModal(false)}
                  className="px-4 py-2 border rounded-xl text-slate-600 font-bold hover:bg-slate-50 cursor-pointer"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={addSupplierSubmitting}
                  className="px-4 py-2 bg-emerald-700 hover:bg-emerald-800 text-white rounded-xl font-bold transition-all disabled:opacity-50 cursor-pointer"
                >
                  {addSupplierSubmitting ? 'Saving...' : 'Save & Select Supplier'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
};
