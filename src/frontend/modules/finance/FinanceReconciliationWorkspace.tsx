'use client';

import { useEffect, useState, useCallback } from 'react';
import {
  AlertTriangle,
  CheckCircle2,
  Loader2,
  X,
  Plus,
  Edit2,
  Search,
  Building2,
  Truck,
  FileText,
  ChevronLeft,
  ChevronRight,
} from 'lucide-react';
import { Modal } from '@/components/ui/modal';
import { AnimatePresence } from 'framer-motion';

type MainFinanceTab = 'RECONCILIATION' | 'ERP_GOVERNANCE';
type GovernanceSubTab = 'MILK_SOURCES' | 'CONTRACTORS' | 'ERP_REQUESTS';

type Report = {
  summary: {
    finalizedJourneys: number;
    unresolvedJourneys: number;
    grossLossLiters: number;
    grossGainLiters: number;
    at13tsLossLiters: number;
    at13tsGainLiters: number;
    unresolvedOriginAt13tsLiters: number;
  };
  items: Array<{
    journeyId: string;
    journeyNumber: string;
    source: { code: string };
    route: { code: string };
    vehicleNumber: string;
    originAt13tsLiters: number;
    destinationAt13tsLiters: number | null;
    isResolved: boolean;
    at13ts: { loss: number; gain: number; lossPercent: number | null } | null;
  }>;
};

type Target = {
  active: {
    targetPercent: number;
    effectiveFrom: string;
    reason: string;
  } | null;
};

interface PendingSupplier {
  id: string;
  local_supplier_code: string;
  name: string;
  phone: string | null;
  erp_reference: string | null;
  erp_mapping_status: string;
}

interface ErpSourceItem {
  id: string;
  erp_code: string;
  name: string;
  is_active: boolean;
  zmcc_id: string | null;
  created_at: string;
  visibilities: Array<{
    zmcc_id: string;
    zmcc_code: string;
    zmcc_name: string;
    is_active: boolean;
  }>;
}

interface ContractorItem {
  id: string;
  code: string;
  name: string;
  erp_code: string | null;
  is_active: boolean;
}

interface ErpRequestItem {
  id: string;
  proposed_name: string;
  proposed_code: string | null;
  request_context: string;
  notes: string | null;
  status: 'PENDING' | 'APPROVED' | 'REJECTED';
  created_at: string;
  requested_by: {
    id: string;
    name: string | null;
    username: string;
    role: string;
  };
  zmcc: {
    id: string;
    code: string;
    name: string;
  };
}

interface ZmccOption {
  id: string;
  code: string;
  name: string;
  is_active: boolean;
}

const quantity = (value: number) => value.toLocaleString(undefined, { maximumFractionDigits: 2 });

export function FinanceReconciliationWorkspace() {
  const [activeMainTab, setActiveMainTab] = useState<MainFinanceTab>('RECONCILIATION');
  const [governanceTab, setGovernanceTab] = useState<GovernanceSubTab>('MILK_SOURCES');

  // Reconciliation State
  const [report, setReport] = useState<Report | null>(null);
  const [target, setTarget] = useState<Target | null>(null);
  const [reconciliationError, setReconciliationError] = useState<string | null>(null);

  // Pending HC Supplier Holds State
  const [pendingSuppliers, setPendingSuppliers] = useState<PendingSupplier[]>([]);
  const [showMappingModal, setShowMappingModal] = useState<boolean>(false);
  const [selectedSupplier, setSelectedSupplier] = useState<PendingSupplier | null>(null);
  const [erpInput, setErpInput] = useState<string>('');
  const [mappingSubmitting, setMappingSubmitting] = useState<boolean>(false);
  const [mappingError, setMappingError] = useState<string | null>(null);
  const [mappingSuccess, setMappingSuccess] = useState<string | null>(null);

  // Governance State
  const [erpSources, setErpSources] = useState<ErpSourceItem[]>([]);
  const [contractors, setContractors] = useState<ContractorItem[]>([]);
  const [erpRequests, setErpRequests] = useState<ErpRequestItem[]>([]);
  const [zmccOptions, setZmccOptions] = useState<ZmccOption[]>([]);
  const [loadingGovernance, setLoadingGovernance] = useState<boolean>(false);
  const [governanceFeedback, setGovernanceFeedback] = useState<{ type: 'success' | 'error'; message: string } | null>(null);

  // Governance Modals State
  const [showSourceModal, setShowSourceModal] = useState<boolean>(false);
  const [editingSource, setEditingSource] = useState<ErpSourceItem | null>(null);
  const [sourceForm, setSourceForm] = useState({
    erp_code: '',
    name: '',
    is_active: true,
    zmcc_ids: [] as string[],
  });
  const [submittingSource, setSubmittingSource] = useState<boolean>(false);

  const [showContractorModal, setShowContractorModal] = useState<boolean>(false);
  const [editingContractor, setEditingContractor] = useState<ContractorItem | null>(null);
  const [contractorErpInput, setContractorErpInput] = useState<string>('');
  const [submittingContractor, setSubmittingContractor] = useState<boolean>(false);

  const [showReviewModal, setShowReviewModal] = useState<boolean>(false);
  const [reviewingRequest, setReviewingRequest] = useState<ErpRequestItem | null>(null);
  const [reviewAction, setReviewAction] = useState<'APPROVE' | 'REJECT'>('APPROVE');
  const [reviewErpCode, setReviewErpCode] = useState<string>('');
  const [reviewZmccIds, setReviewZmccIds] = useState<string[]>([]);
  const [reviewNotes, setReviewNotes] = useState<string>('');
  const [submittingReview, setSubmittingReview] = useState<boolean>(false);

  // Governance Search & Filter States
  const [sourceSearch, setSourceSearch] = useState<string>('');
  const [contractorSearch, setContractorSearch] = useState<string>('');
  const [requestFilter, setRequestFilter] = useState<'ALL' | 'PENDING'>('PENDING');

  // Governance Pagination States
  const [sourcePage, setSourcePage] = useState<number>(1);
  const [contractorPage, setContractorPage] = useState<number>(1);
  const [requestPage, setRequestPage] = useState<number>(1);

  const loadPendingSuppliers = useCallback(
    () =>
      fetch('/api/zmcc/local-suppliers?erp_mapping_status=PENDING')
        .then(async (res) => {
          if (res.ok) {
            const data = await res.json();
            setPendingSuppliers(data.suppliers || []);
          }
        })
        .catch(() => {}),
    []
  );

  const loadReconciliationData = useCallback(() => {
    Promise.all([
      fetch('/api/management/zmcc-reconciliation?pageSize=25'),
      fetch('/api/super-admin/finance-loss-targets'),
    ])
      .then(async ([reportResponse, targetResponse]) => {
        const [reportBody, targetBody] = await Promise.all([
          reportResponse.json(),
          targetResponse.json(),
        ]);
        if (!reportResponse.ok) throw new Error(reportBody.error || 'Unable to load reconciliation.');
        if (!targetResponse.ok) throw new Error(targetBody.error || 'Unable to load loss target.');
        setReport(reportBody);
        setTarget(targetBody);
      })
      .catch((cause) =>
        setReconciliationError(cause instanceof Error ? cause.message : 'Unable to load Finance reconciliation.')
      );
  }, []);

  const loadGovernanceData = useCallback(async () => {
    setLoadingGovernance(true);
    try {
      const [sourcesRes, contractorsRes, requestsRes, zmccsRes] = await Promise.all([
        fetch('/api/finance/erp-sources'),
        fetch('/api/finance/contractors'),
        fetch('/api/finance/erp-requests'),
        fetch('/api/zmcc/sources'),
      ]);

      if (sourcesRes.ok) {
        const data = await sourcesRes.json();
        setErpSources(data.sources || []);
      }
      if (contractorsRes.ok) {
        const data = await contractorsRes.json();
        setContractors(data.contractors || []);
      }
      if (requestsRes.ok) {
        const data = await requestsRes.json();
        setErpRequests(data.requests || []);
      }
      if (zmccsRes.ok) {
        const data = await zmccsRes.json();
        setZmccOptions(data.zmccs || []);
      }
    } catch {
      setGovernanceFeedback({ type: 'error', message: 'Failed to load ERP governance master data.' });
    } finally {
      setLoadingGovernance(false);
    }
  }, []);

  useEffect(() => {
    loadReconciliationData();
    loadPendingSuppliers();
  }, [loadReconciliationData, loadPendingSuppliers]);

  useEffect(() => {
    if (activeMainTab === 'ERP_GOVERNANCE') {
      loadGovernanceData();
    }
  }, [activeMainTab, loadGovernanceData]);

  const handleMapErp = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedSupplier) return;
    const cleanRef = erpInput.trim();
    if (!cleanRef) {
      setMappingError('Official ERP vendor reference is required.');
      return;
    }

    setMappingSubmitting(true);
    setMappingError(null);
    setMappingSuccess(null);

    try {
      const res = await fetch(`/api/zmcc/local-suppliers/${selectedSupplier.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ erp_reference: cleanRef }),
      });
      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.error || 'Failed to update ERP reference.');
      }

      setMappingSuccess(
        `Successfully mapped HC Supplier ${selectedSupplier.name} (${selectedSupplier.local_supplier_code}) to ERP Code ${cleanRef}. Hold released.`
      );
      setPendingSuppliers((prev) => prev.filter((s) => s.id !== selectedSupplier.id));
      setSelectedSupplier(null);
      setErpInput('');
      setTimeout(() => setMappingSuccess(null), 4000);
    } catch (err: unknown) {
      setMappingError(err instanceof Error ? err.message : 'Failed to map ERP reference.');
    } finally {
      setMappingSubmitting(false);
    }
  };

  const handleOpenAddSourceModal = () => {
    setEditingSource(null);
    setSourceForm({
      erp_code: '',
      name: '',
      is_active: true,
      zmcc_ids: [],
    });
    setGovernanceFeedback(null);
    setShowSourceModal(true);
  };

  const handleOpenEditSourceModal = (source: ErpSourceItem) => {
    setEditingSource(source);
    setSourceForm({
      erp_code: source.erp_code,
      name: source.name,
      is_active: source.is_active,
      zmcc_ids: source.visibilities.filter((v) => v.is_active).map((v) => v.zmcc_id),
    });
    setGovernanceFeedback(null);
    setShowSourceModal(true);
  };

  const handleSaveSource = async (e: React.FormEvent) => {
    e.preventDefault();
    setSubmittingSource(true);
    try {
      if (editingSource) {
        const res = await fetch(`/api/finance/erp-sources/${editingSource.id}`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            name: sourceForm.name.trim(),
            is_active: sourceForm.is_active,
            zmcc_ids: sourceForm.zmcc_ids,
          }),
        });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error || 'Failed to update milk source.');
        setGovernanceFeedback({ type: 'success', message: `Milk source "${sourceForm.name}" updated.` });
      } else {
        const res = await fetch('/api/finance/erp-sources', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            erp_code: sourceForm.erp_code.trim(),
            name: sourceForm.name.trim(),
            zmcc_ids: sourceForm.zmcc_ids,
          }),
        });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error || 'Failed to create milk source.');
        setGovernanceFeedback({ type: 'success', message: `Milk source "${sourceForm.name}" created.` });
      }
      setShowSourceModal(false);
      await loadGovernanceData();
    } catch (err) {
      setGovernanceFeedback({
        type: 'error',
        message: err instanceof Error ? err.message : 'Error saving milk source.',
      });
    } finally {
      setSubmittingSource(false);
    }
  };

  const handleOpenContractorModal = (contractor: ContractorItem) => {
    setEditingContractor(contractor);
    setContractorErpInput(contractor.erp_code || '');
    setGovernanceFeedback(null);
    setShowContractorModal(true);
  };

  const handleSaveContractorErp = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!editingContractor) return;
    setSubmittingContractor(true);
    try {
      const res = await fetch('/api/finance/contractors', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          contractor_source_id: editingContractor.id,
          erp_code: contractorErpInput.trim(),
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Failed to update contractor ERP code.');
      setGovernanceFeedback({
        type: 'success',
        message: `Contractor "${editingContractor.name}" ERP code updated to ${contractorErpInput.trim()}.`,
      });
      setShowContractorModal(false);
      await loadGovernanceData();
    } catch (err) {
      setGovernanceFeedback({
        type: 'error',
        message: err instanceof Error ? err.message : 'Error updating contractor ERP code.',
      });
    } finally {
      setSubmittingContractor(false);
    }
  };

  const handleOpenReviewModal = (req: ErpRequestItem, action: 'APPROVE' | 'REJECT') => {
    setReviewingRequest(req);
    setReviewAction(action);
    setReviewErpCode(req.proposed_code || '');
    setReviewZmccIds(req.zmcc?.id ? [req.zmcc.id] : []);
    setReviewNotes('');
    setGovernanceFeedback(null);
    setShowReviewModal(true);
  };

  const handleReviewSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!reviewingRequest) return;
    setSubmittingReview(true);
    try {
      const res = await fetch('/api/finance/erp-requests', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          request_id: reviewingRequest.id,
          action: reviewAction,
          erp_code: reviewAction === 'APPROVE' ? reviewErpCode.trim() : undefined,
          zmcc_ids: reviewAction === 'APPROVE' ? reviewZmccIds : undefined,
          notes: reviewNotes.trim() || undefined,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Failed to review ERP request.');
      setGovernanceFeedback({
        type: 'success',
        message: `Request for "${reviewingRequest.proposed_name}" ${reviewAction.toLowerCase()}d.`,
      });
      setShowReviewModal(false);
      await loadGovernanceData();
    } catch (err) {
      setGovernanceFeedback({
        type: 'error',
        message: err instanceof Error ? err.message : 'Error reviewing request.',
      });
    } finally {
      setSubmittingReview(false);
    }
  };

  const toggleZmccSelection = (zmccId: string) => {
    setSourceForm((prev) => {
      const exists = prev.zmcc_ids.includes(zmccId);
      return {
        ...prev,
        zmcc_ids: exists ? prev.zmcc_ids.filter((id) => id !== zmccId) : [...prev.zmcc_ids, zmccId],
      };
    });
  };

  const toggleReviewZmccSelection = (zmccId: string) => {
    setReviewZmccIds((prev) => {
      const exists = prev.includes(zmccId);
      return exists ? prev.filter((id) => id !== zmccId) : [...prev, zmccId];
    });
  };

  if (reconciliationError) {
    return (
      <div className="rounded-xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-900">
        {reconciliationError}
      </div>
    );
  }

  if (!report || !target) {
    return (
      <div className="rounded-xl border border-border bg-white p-4 text-sm text-slate-500">
        Loading Finance reconciliation…
      </div>
    );
  }

  const s = report.summary;
  const base = s.at13tsLossLiters + s.at13tsGainLiters;
  const lossPercent = base > 0 ? (s.at13tsLossLiters / base) * 100 : null;
  const isWithinTarget =
    lossPercent !== null && target.active ? lossPercent <= target.active.targetPercent : null;

  // Filtered lists
  const filteredSources = erpSources.filter((src) => {
    if (!sourceSearch.trim()) return true;
    const term = sourceSearch.toLowerCase();
    return src.erp_code.toLowerCase().includes(term) || src.name.toLowerCase().includes(term);
  });

  const filteredContractors = contractors.filter((con) => {
    if (!contractorSearch.trim()) return true;
    const term = contractorSearch.toLowerCase();
    return (
      con.code.toLowerCase().includes(term) ||
      con.name.toLowerCase().includes(term) ||
      (con.erp_code && con.erp_code.toLowerCase().includes(term))
    );
  });

  const filteredRequests = erpRequests.filter((req) => {
    if (requestFilter === 'PENDING') return req.status === 'PENDING';
    return true;
  });

  // Table pagination
  const SOURCES_PAGE_SIZE = 10;
  const totalSourcePages = Math.ceil(filteredSources.length / SOURCES_PAGE_SIZE) || 1;
  const paginatedSources = filteredSources.slice(
    (sourcePage - 1) * SOURCES_PAGE_SIZE,
    sourcePage * SOURCES_PAGE_SIZE
  );

  const CONTRACTORS_PAGE_SIZE = 10;
  const totalContractorPages = Math.ceil(filteredContractors.length / CONTRACTORS_PAGE_SIZE) || 1;
  const paginatedContractors = filteredContractors.slice(
    (contractorPage - 1) * CONTRACTORS_PAGE_SIZE,
    contractorPage * CONTRACTORS_PAGE_SIZE
  );

  // Cards pagination (strict max 6 per screen)
  const REQUESTS_PAGE_SIZE = 6;
  const totalRequestPages = Math.ceil(filteredRequests.length / REQUESTS_PAGE_SIZE) || 1;
  const paginatedRequests = filteredRequests.slice(
    (requestPage - 1) * REQUESTS_PAGE_SIZE,
    requestPage * REQUESTS_PAGE_SIZE
  );

  const pendingRequestsCount = erpRequests.filter((r) => r.status === 'PENDING').length;

  return (
    <section className="space-y-4 animate-panel-in">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 border-b border-border pb-3">
        <div>
          <h1 className="text-xl font-semibold text-foreground">Finance Operations & MPD</h1>
        </div>
        <div className="flex items-center space-x-2 bg-subtle p-1 rounded-xl border border-border">
          <button
            type="button"
            onClick={() => setActiveMainTab('RECONCILIATION')}
            className={`px-3 py-1.5 rounded-lg text-xs font-semibold transition ${
              activeMainTab === 'RECONCILIATION'
                ? 'bg-primary text-white shadow-2xs'
                : 'text-slate-600 hover:text-foreground'
            }`}
          >
            MPD Reconciliation
          </button>
          <button
            type="button"
            onClick={() => setActiveMainTab('ERP_GOVERNANCE')}
            className={`flex items-center space-x-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold transition ${
              activeMainTab === 'ERP_GOVERNANCE'
                ? 'bg-primary text-white shadow-2xs'
                : 'text-slate-600 hover:text-foreground'
            }`}
          >
            <span>ERP & Source Governance</span>
            {pendingRequestsCount > 0 && (
              <span className="w-4 h-4 rounded-full bg-amber-500 text-white text-[10px] font-bold flex items-center justify-center">
                {pendingRequestsCount}
              </span>
            )}
          </button>
        </div>
      </div>

      {activeMainTab === 'RECONCILIATION' ? (
        <div className="space-y-4">
          {pendingSuppliers.length > 0 && (
            <div className="rounded-xl border border-amber-300 bg-amber-50 p-4 text-amber-900 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3 shadow-2xs">
              <div className="flex items-center space-x-3">
                <div className="p-2 bg-amber-100 rounded-lg text-amber-700">
                  <AlertTriangle className="w-5 h-5 shrink-0" />
                </div>
                <div>
                  <p className="text-sm font-semibold">
                    Payment on hold: {pendingSuppliers.length}{' '}
                    {pendingSuppliers.length === 1 ? 'entity' : 'entities'} pending ERP code mapping
                  </p>
                  <p className="text-xs text-amber-700 font-medium mt-0.5">
                    Non-blocking milk intake permitted. Map official ERP vendor code to release disbursement hold.
                  </p>
                </div>
              </div>
              <button
                type="button"
                onClick={() => {
                  setMappingError(null);
                  setMappingSuccess(null);
                  setSelectedSupplier(null);
                  setErpInput('');
                  setShowMappingModal(true);
                }}
                className="px-4 py-2 bg-amber-600 hover:bg-amber-700 text-white text-xs font-semibold rounded-lg transition shadow-2xs shrink-0"
              >
                Review & Map ERP Codes
              </button>
            </div>
          )}

          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <div className="rounded-xl border border-border bg-white p-4">
              <p className="text-xs font-semibold text-slate-500">Active 13TS target</p>
              <p className="mt-1 text-xl font-semibold">
                {target.active ? `${target.active.targetPercent}%` : 'Not configured'}
              </p>
              <p className="mt-1 text-xs text-slate-500">
                {target.active
                  ? `Effective ${new Date(target.active.effectiveFrom).toLocaleDateString()}`
                  : 'Super Admin must activate a target.'}
              </p>
            </div>
            <div className="rounded-xl border border-border bg-white p-4">
              <p className="text-xs font-semibold text-slate-500">Observed 13TS loss</p>
              <p className="mt-1 text-xl font-semibold">
                {lossPercent === null ? 'No finalized base' : `${lossPercent.toFixed(2)}%`}
              </p>
              <p className="mt-1 text-xs text-slate-500">
                {isWithinTarget === null
                  ? 'Target comparison unavailable'
                  : isWithinTarget
                  ? 'Within active target'
                  : 'Above active target'}
              </p>
            </div>
            <div className="rounded-xl border border-border bg-white p-4">
              <p className="text-xs font-semibold text-slate-500">13TS loss / gain</p>
              <p className="mt-1 text-xl font-semibold">
                {quantity(s.at13tsLossLiters)} / {quantity(s.at13tsGainLiters)} L
              </p>
            </div>
            <div className="rounded-xl border border-border bg-white p-4">
              <p className="text-xs font-semibold text-slate-500">Gross loss / gain</p>
              <p className="mt-1 text-xl font-semibold">
                {quantity(s.grossLossLiters)} / {quantity(s.grossGainLiters)} L
              </p>
            </div>
          </div>

          <div className="rounded-xl border border-border bg-white p-4">
            <p className="font-semibold text-slate-900">Verification queue</p>
            <p className="mt-1 text-sm text-slate-600">
              {s.unresolvedJourneys} unresolved journeys · {quantity(s.unresolvedOriginAt13tsLiters)} L at 13TS awaiting final ZMCC result.
            </p>
            <div className="mt-3 overflow-x-auto">
              <table className="w-full text-left text-xs">
                <thead className="text-slate-500">
                  <tr>
                    <th className="pb-2">Source</th>
                    <th className="pb-2">Route</th>
                    <th className="pb-2">Journey</th>
                    <th className="pb-2">Vehicle</th>
                    <th className="pb-2">13TS variance</th>
                    <th className="pb-2">Status</th>
                  </tr>
                </thead>
                <tbody>
                  {report.items.map((row) => (
                    <tr key={row.journeyId} className="border-t border-border">
                      <td className="py-2">{row.source.code}</td>
                      <td className="py-2">{row.route.code}</td>
                      <td className="py-2">{row.journeyNumber}</td>
                      <td className="py-2">{row.vehicleNumber}</td>
                      <td className="py-2">
                        {row.at13ts ? `${quantity(row.at13ts.loss)} L loss / ${quantity(row.at13ts.gain)} L gain` : '—'}
                      </td>
                      <td className="py-2">{row.isResolved ? 'Finalized' : 'Unresolved'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      ) : (
        <div className="space-y-4">
          {governanceFeedback && (
            <div
              className={`p-3 rounded-xl text-xs font-semibold flex items-center justify-between ${
                governanceFeedback.type === 'success'
                  ? 'bg-emerald-50 text-emerald-800 border border-emerald-200'
                  : 'bg-rose-50 text-rose-800 border border-rose-200'
              }`}
            >
              <span>{governanceFeedback.message}</span>
              <button
                type="button"
                onClick={() => setGovernanceFeedback(null)}
                className="text-slate-500 hover:text-slate-800 p-1"
              >
                <X className="w-3.5 h-3.5" />
              </button>
            </div>
          )}

          <div className="flex flex-wrap items-center justify-between gap-3 bg-white p-3 rounded-xl border border-border shadow-2xs">
            <div className="flex items-center space-x-2">
              <button
                type="button"
                onClick={() => {
                  setGovernanceTab('MILK_SOURCES');
                  setSourcePage(1);
                }}
                className={`flex items-center space-x-1.5 px-3 py-1.5 rounded-xl text-xs font-semibold transition ${
                  governanceTab === 'MILK_SOURCES'
                    ? 'bg-primary text-white shadow-2xs'
                    : 'bg-subtle text-slate-700 hover:bg-slate-100'
                }`}
              >
                <Building2 className="w-3.5 h-3.5" />
                <span>Milk Sources ({erpSources.length})</span>
              </button>

              <button
                type="button"
                onClick={() => {
                  setGovernanceTab('CONTRACTORS');
                  setContractorPage(1);
                }}
                className={`flex items-center space-x-1.5 px-3 py-1.5 rounded-xl text-xs font-semibold transition ${
                  governanceTab === 'CONTRACTORS'
                    ? 'bg-primary text-white shadow-2xs'
                    : 'bg-subtle text-slate-700 hover:bg-slate-100'
                }`}
              >
                <Truck className="w-3.5 h-3.5" />
                <span>Plant Contractors ({contractors.length})</span>
              </button>

              <button
                type="button"
                onClick={() => {
                  setGovernanceTab('ERP_REQUESTS');
                  setRequestPage(1);
                }}
                className={`flex items-center space-x-1.5 px-3 py-1.5 rounded-xl text-xs font-semibold transition ${
                  governanceTab === 'ERP_REQUESTS'
                    ? 'bg-primary text-white shadow-2xs'
                    : 'bg-subtle text-slate-700 hover:bg-slate-100'
                }`}
              >
                <FileText className="w-3.5 h-3.5" />
                <span>Field ERP Requests</span>
                {pendingRequestsCount > 0 && (
                  <span className="px-1.5 py-0.2 rounded-full bg-amber-500 text-white text-[10px] font-bold">
                    {pendingRequestsCount}
                  </span>
                )}
              </button>
            </div>

            <button
              type="button"
              disabled={loadingGovernance}
              onClick={loadGovernanceData}
              className="flex items-center space-x-1.5 px-3 py-1.5 rounded-xl border border-border text-xs font-semibold text-slate-700 hover:bg-subtle transition"
            >
              <span>Refresh</span>
            </button>
          </div>

          {governanceTab === 'MILK_SOURCES' && (
            <div className="bg-white rounded-xl border border-border p-4 space-y-4 shadow-2xs">
              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                <div className="relative flex-1 max-w-sm">
                  <Search className="w-3.5 h-3.5 text-slate-400 absolute left-3 top-2.5" />
                  <input
                    type="text"
                    value={sourceSearch}
                    onChange={(e) => {
                      setSourceSearch(e.target.value);
                      setSourcePage(1);
                    }}
                    placeholder="Search by ERP code or source name…"
                    className="w-full pl-8 pr-3 py-1.5 border border-border rounded-xl text-xs font-semibold focus:ring-2 focus:ring-primary outline-hidden"
                  />
                </div>

                <button
                  type="button"
                  onClick={handleOpenAddSourceModal}
                  className="flex items-center space-x-1 px-3.5 py-2 bg-primary hover:bg-primary-hover text-white rounded-xl text-xs font-semibold transition shadow-2xs"
                >
                  <Plus className="w-3.5 h-3.5" />
                  <span>Create Milk Source</span>
                </button>
              </div>

              <div className="overflow-x-auto border border-border rounded-xl">
                <table className="w-full text-left text-xs">
                  <thead className="bg-subtle text-slate-600 font-semibold border-b border-border">
                    <tr>
                      <th className="py-2.5 px-3">ERP Code</th>
                      <th className="py-2.5 px-3">Source Name</th>
                      <th className="py-2.5 px-3">ZMCC Visibility</th>
                      <th className="py-2.5 px-3">Status</th>
                      <th className="py-2.5 px-3 text-right">Action</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-border">
                    {paginatedSources.map((source) => (
                      <tr key={source.id} className="hover:bg-subtle transition-colors">
                        <td className="py-2.5 px-3 font-mono font-bold text-slate-900">
                          {source.erp_code}
                        </td>
                        <td className="py-2.5 px-3 font-semibold text-slate-800">
                          {source.name}
                        </td>
                        <td className="py-2.5 px-3">
                          <div className="flex flex-wrap gap-1">
                            {source.visibilities.filter((v) => v.is_active).length === 0 ? (
                              <span className="text-slate-400 text-[11px]">Unassigned to ZMCC</span>
                            ) : (
                              source.visibilities
                                .filter((v) => v.is_active)
                                .map((v) => (
                                  <span
                                    key={v.zmcc_id}
                                    className="px-2 py-0.5 rounded-md text-[10px] font-semibold bg-slate-100 text-slate-800 border border-border"
                                  >
                                    [{v.zmcc_code}] {v.zmcc_name}
                                  </span>
                                ))
                            )}
                          </div>
                        </td>
                        <td className="py-2.5 px-3">
                          <span
                            className={`px-2 py-0.5 rounded-full text-[10px] font-semibold ${
                              source.is_active
                                ? 'bg-emerald-100 text-emerald-800'
                                : 'bg-slate-100 text-slate-500'
                            }`}
                          >
                            {source.is_active ? 'Active' : 'Inactive'}
                          </span>
                        </td>
                        <td className="py-2.5 px-3 text-right">
                          <button
                            type="button"
                            onClick={() => handleOpenEditSourceModal(source)}
                            className="p-1.5 hover:bg-subtle text-slate-600 hover:text-primary rounded-lg transition"
                          >
                            <Edit2 className="w-3.5 h-3.5" />
                          </button>
                        </td>
                      </tr>
                    ))}
                    {paginatedSources.length === 0 && (
                      <tr>
                        <td colSpan={5} className="py-8 text-center text-slate-400">
                          No milk sources found.
                        </td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>

              {totalSourcePages > 1 && (
                <div className="flex items-center justify-between pt-2">
                  <span className="text-xs text-slate-500">
                    Page {sourcePage} of {totalSourcePages} ({filteredSources.length} total)
                  </span>
                  <div className="flex items-center space-x-2">
                    <button
                      type="button"
                      disabled={sourcePage <= 1}
                      onClick={() => setSourcePage((p) => Math.max(1, p - 1))}
                      className="p-1.5 rounded-lg border border-border disabled:opacity-40 hover:bg-subtle"
                    >
                      <ChevronLeft className="w-4 h-4" />
                    </button>
                    <button
                      type="button"
                      disabled={sourcePage >= totalSourcePages}
                      onClick={() => setSourcePage((p) => Math.min(totalSourcePages, p + 1))}
                      className="p-1.5 rounded-lg border border-border disabled:opacity-40 hover:bg-subtle"
                    >
                      <ChevronRight className="w-4 h-4" />
                    </button>
                  </div>
                </div>
              )}
            </div>
          )}

          {governanceTab === 'CONTRACTORS' && (
            <div className="bg-white rounded-xl border border-border p-4 space-y-4 shadow-2xs">
              <div className="relative max-w-sm">
                <Search className="w-3.5 h-3.5 text-slate-400 absolute left-3 top-2.5" />
                <input
                  type="text"
                  value={contractorSearch}
                  onChange={(e) => {
                    setContractorSearch(e.target.value);
                    setContractorPage(1);
                  }}
                  placeholder="Search by contractor code, name, or ERP code…"
                  className="w-full pl-8 pr-3 py-1.5 border border-border rounded-xl text-xs font-semibold focus:ring-2 focus:ring-primary outline-hidden"
                />
              </div>

              <div className="overflow-x-auto border border-border rounded-xl">
                <table className="w-full text-left text-xs">
                  <thead className="bg-subtle text-slate-600 font-semibold border-b border-border">
                    <tr>
                      <th className="py-2.5 px-3">Contractor Code</th>
                      <th className="py-2.5 px-3">Name</th>
                      <th className="py-2.5 px-3">Assigned ERP Code</th>
                      <th className="py-2.5 px-3">Status</th>
                      <th className="py-2.5 px-3 text-right">Action</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-border">
                    {paginatedContractors.map((contractor) => (
                      <tr key={contractor.id} className="hover:bg-subtle transition-colors">
                        <td className="py-2.5 px-3 font-mono font-bold text-slate-900">
                          {contractor.code}
                        </td>
                        <td className="py-2.5 px-3 font-semibold text-slate-800">
                          {contractor.name}
                        </td>
                        <td className="py-2.5 px-3">
                          {contractor.erp_code ? (
                            <span className="font-mono font-bold text-emerald-800 bg-emerald-50 px-2 py-0.5 rounded-md border border-emerald-200">
                              [{contractor.erp_code}]
                            </span>
                          ) : (
                            <span className="text-amber-700 font-semibold">Unassigned</span>
                          )}
                        </td>
                        <td className="py-2.5 px-3">
                          <span
                            className={`px-2 py-0.5 rounded-full text-[10px] font-semibold ${
                              contractor.is_active
                                ? 'bg-emerald-100 text-emerald-800'
                                : 'bg-slate-100 text-slate-500'
                            }`}
                          >
                            {contractor.is_active ? 'Active' : 'Inactive'}
                          </span>
                        </td>
                        <td className="py-2.5 px-3 text-right">
                          <button
                            type="button"
                            onClick={() => handleOpenContractorModal(contractor)}
                            className="px-2.5 py-1 text-xs font-semibold text-primary hover:bg-subtle rounded-lg transition"
                          >
                            Assign ERP
                          </button>
                        </td>
                      </tr>
                    ))}
                    {paginatedContractors.length === 0 && (
                      <tr>
                        <td colSpan={5} className="py-8 text-center text-slate-400">
                          No contractors found.
                        </td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>

              {totalContractorPages > 1 && (
                <div className="flex items-center justify-between pt-2">
                  <span className="text-xs text-slate-500">
                    Page {contractorPage} of {totalContractorPages} ({filteredContractors.length} total)
                  </span>
                  <div className="flex items-center space-x-2">
                    <button
                      type="button"
                      disabled={contractorPage <= 1}
                      onClick={() => setContractorPage((p) => Math.max(1, p - 1))}
                      className="p-1.5 rounded-lg border border-border disabled:opacity-40 hover:bg-subtle"
                    >
                      <ChevronLeft className="w-4 h-4" />
                    </button>
                    <button
                      type="button"
                      disabled={contractorPage >= totalContractorPages}
                      onClick={() => setContractorPage((p) => Math.min(totalContractorPages, p + 1))}
                      className="p-1.5 rounded-lg border border-border disabled:opacity-40 hover:bg-subtle"
                    >
                      <ChevronRight className="w-4 h-4" />
                    </button>
                  </div>
                </div>
              )}
            </div>
          )}

          {governanceTab === 'ERP_REQUESTS' && (
            <div className="space-y-4">
              <div className="flex items-center justify-between">
                <div className="flex items-center space-x-2">
                  <button
                    type="button"
                    onClick={() => {
                      setRequestFilter('PENDING');
                      setRequestPage(1);
                    }}
                    className={`px-3 py-1.5 rounded-xl text-xs font-semibold transition ${
                      requestFilter === 'PENDING'
                        ? 'bg-amber-600 text-white'
                        : 'bg-white border border-border text-slate-700'
                    }`}
                  >
                    Pending ({erpRequests.filter((r) => r.status === 'PENDING').length})
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      setRequestFilter('ALL');
                      setRequestPage(1);
                    }}
                    className={`px-3 py-1.5 rounded-xl text-xs font-semibold transition ${
                      requestFilter === 'ALL'
                        ? 'bg-primary text-white'
                        : 'bg-white border border-border text-slate-700'
                    }`}
                  >
                    All Requests ({erpRequests.length})
                  </button>
                </div>
              </div>

              {paginatedRequests.length === 0 ? (
                <div className="bg-white rounded-xl border border-border p-8 text-center text-xs text-slate-400">
                  No ERP code requests matching the selected filter.
                </div>
              ) : (
                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                  {paginatedRequests.map((req) => (
                    <div
                      key={req.id}
                      className="bg-white rounded-xl border border-border p-4 shadow-2xs flex flex-col justify-between space-y-3"
                    >
                      <div className="space-y-2">
                        <div className="flex items-center justify-between">
                          <span
                            className={`px-2 py-0.5 rounded-full text-[10px] font-semibold uppercase ${
                              req.status === 'PENDING'
                                ? 'bg-amber-100 text-amber-800'
                                : req.status === 'APPROVED'
                                ? 'bg-emerald-100 text-emerald-800'
                                : 'bg-rose-100 text-rose-800'
                            }`}
                          >
                            {req.status}
                          </span>
                          <span className="text-[11px] text-slate-400">
                            {new Date(req.created_at).toLocaleDateString()}
                          </span>
                        </div>

                        <div>
                          <h4 className="text-sm font-semibold text-slate-900">{req.proposed_name}</h4>
                          {req.proposed_code && (
                            <p className="text-xs font-mono font-bold text-slate-600 mt-0.5">
                              Proposed Code: {req.proposed_code}
                            </p>
                          )}
                        </div>

                        <div className="text-xs space-y-1 text-slate-600 bg-subtle p-2 rounded-lg">
                          <div>
                            ZMCC: <strong className="text-slate-800">{req.zmcc?.name}</strong>
                          </div>
                          <div>
                            Requested by:{' '}
                            <strong className="text-slate-800">
                              {req.requested_by.name || req.requested_by.username} (
                              {req.requested_by.role === 'MOT' ? 'Mobile Tester' : req.requested_by.role})
                            </strong>
                          </div>
                          {req.notes && <div>Notes: {req.notes}</div>}
                        </div>
                      </div>

                      {req.status === 'PENDING' ? (
                        <div className="flex items-center space-x-2 pt-2 border-t border-border">
                          <button
                            type="button"
                            onClick={() => handleOpenReviewModal(req, 'REJECT')}
                            className="flex-1 py-1.5 border border-rose-300 text-rose-800 hover:bg-rose-50 rounded-xl text-xs font-semibold transition"
                          >
                            Reject
                          </button>
                          <button
                            type="button"
                            onClick={() => handleOpenReviewModal(req, 'APPROVE')}
                            className="flex-1 py-1.5 bg-emerald-600 hover:bg-emerald-700 text-white rounded-xl text-xs font-semibold transition"
                          >
                            Approve
                          </button>
                        </div>
                      ) : (
                        <div className="pt-2 border-t border-border text-[11px] text-slate-400 text-center font-medium">
                          Reviewed
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              )}

              {totalRequestPages > 1 && (
                <div className="flex items-center justify-between pt-2">
                  <span className="text-xs text-slate-500">
                    Page {requestPage} of {totalRequestPages}
                  </span>
                  <div className="flex items-center space-x-2">
                    <button
                      type="button"
                      disabled={requestPage <= 1}
                      onClick={() => setRequestPage((p) => Math.max(1, p - 1))}
                      className="px-3 py-1.5 rounded-xl border border-border text-xs font-semibold text-slate-700 disabled:opacity-40 hover:bg-subtle"
                    >
                      Previous
                    </button>
                    <button
                      type="button"
                      disabled={requestPage >= totalRequestPages}
                      onClick={() => setRequestPage((p) => Math.min(totalRequestPages, p + 1))}
                      className="px-3 py-1.5 rounded-xl border border-border text-xs font-semibold text-slate-700 disabled:opacity-40 hover:bg-subtle"
                    >
                      Next
                    </button>
                  </div>
                </div>
              )}
            </div>
          )}
        </div>
      )}

      <AnimatePresence>
        {showMappingModal && (
          <Modal
            key="modal-0"
            onClose={() => setShowMappingModal(false)}
            title="Finance mapping"
            className="max-w-2xl p-6 space-y-4 max-h-[90vh] overflow-y-auto"
          >
            <div className="flex items-center justify-between pb-3 border-b border-border">
              <div className="flex items-center space-x-2">
                <AlertTriangle className="w-5 h-5 text-amber-600" />
                <h2 className="text-base font-semibold text-slate-900">
                  Release Financial Hold: ERP Vendor Mapping
                </h2>
              </div>
              <button
                type="button"
                onClick={() => setShowMappingModal(false)}
                className="p-1.5 rounded-lg border border-border text-slate-500 hover:bg-subtle"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            {mappingSuccess && (
              <div className="p-3 bg-emerald-50 border border-emerald-200 rounded-xl text-xs font-semibold text-emerald-800 flex items-center gap-2">
                <CheckCircle2 className="w-4 h-4 shrink-0 text-emerald-600" />
                <span>{mappingSuccess}</span>
              </div>
            )}

            {mappingError && (
              <div className="p-3 bg-rose-50 border border-rose-200 rounded-xl text-xs font-semibold text-rose-800 flex items-center gap-2">
                <AlertTriangle className="w-4 h-4 shrink-0 text-rose-600" />
                <span>{mappingError}</span>
              </div>
            )}

            {selectedSupplier ? (
              <form onSubmit={handleMapErp} className="space-y-4 p-4 bg-subtle rounded-xl border border-border">
                <div className="flex items-center justify-between">
                  <h3 className="text-xs font-semibold text-slate-700">
                    Assign ERP Code for: {selectedSupplier.name} ({selectedSupplier.local_supplier_code})
                  </h3>
                  <button
                    type="button"
                    onClick={() => {
                      setSelectedSupplier(null);
                      setErpInput('');
                    }}
                    className="text-xs text-slate-500 underline font-semibold hover:text-slate-800"
                  >
                    Back to list
                  </button>
                </div>

                <div>
                  <label className="block text-xs font-semibold text-slate-600 mb-1">
                    Official ERP Vendor Reference *
                  </label>
                  <input
                    type="text"
                    required
                    maxLength={100}
                    value={erpInput}
                    onChange={(e) => setErpInput(e.target.value)}
                    placeholder="e.g. 00045231"
                    className="w-full px-3 py-2 border border-border rounded-xl text-xs tabular-nums font-semibold focus:ring-2 focus:ring-primary"
                  />
                </div>

                <div className="flex justify-end space-x-2 pt-2">
                  <button
                    type="button"
                    onClick={() => {
                      setSelectedSupplier(null);
                      setErpInput('');
                    }}
                    className="px-4 py-2 text-xs font-semibold text-slate-600 hover:bg-slate-200 rounded-xl transition"
                  >
                    Cancel
                  </button>
                  <button
                    type="submit"
                    disabled={mappingSubmitting}
                    className="flex items-center space-x-1.5 px-4 py-2 bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-semibold rounded-xl transition shadow-2xs"
                  >
                    {mappingSubmitting && <Loader2 className="w-3.5 h-3.5 animate-spin" />}
                    <span>Save & Release Hold</span>
                  </button>
                </div>
              </form>
            ) : (
              <div className="space-y-3">
                {pendingSuppliers.length === 0 ? (
                  <div className="py-8 text-center text-slate-400 font-semibold text-xs">
                    No HC suppliers are currently pending ERP mapping.
                  </div>
                ) : (
                  <div className="overflow-x-auto border border-border rounded-xl">
                    <table className="w-full text-left text-xs">
                      <thead className="bg-subtle text-slate-600 font-semibold border-b border-border">
                        <tr>
                          <th className="py-2.5 px-3">HC Supplier Code</th>
                          <th className="py-2.5 px-3">Name</th>
                          <th className="py-2.5 px-3">Phone</th>
                          <th className="py-2.5 px-3">Candidate Ref</th>
                          <th className="py-2.5 px-3 text-right">Action</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-border">
                        {pendingSuppliers.map((sup) => (
                          <tr key={sup.id} className="hover:bg-subtle">
                            <td className="py-2 px-3 tabular-nums font-semibold text-primary">
                              {sup.local_supplier_code}
                            </td>
                            <td className="py-2 px-3 font-semibold text-slate-800">{sup.name}</td>
                            <td className="py-2 px-3 tabular-nums text-slate-600">{sup.phone || '—'}</td>
                            <td className="py-2 px-3 tabular-nums text-amber-700">{sup.erp_reference || '—'}</td>
                            <td className="py-2 px-3 text-right">
                              <button
                                type="button"
                                onClick={() => {
                                  setSelectedSupplier(sup);
                                  setErpInput(sup.erp_reference || '');
                                  setMappingError(null);
                                  setMappingSuccess(null);
                                }}
                                className="px-3 py-1 bg-primary hover:bg-primary-hover text-white rounded-lg text-xs font-semibold transition shadow-2xs"
                              >
                                1-Click Map
                              </button>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </div>
            )}

            <div className="flex justify-end pt-3 border-t border-border">
              <button
                type="button"
                onClick={() => setShowMappingModal(false)}
                className="px-4 py-2 border border-border text-slate-700 hover:bg-subtle rounded-xl text-xs font-semibold transition"
              >
                Close
              </button>
            </div>
          </Modal>
        )}

        {showSourceModal && (
          <Modal
            key="modal-source"
            onClose={() => setShowSourceModal(false)}
            title={editingSource ? 'Edit Milk Source' : 'Create Milk Source'}
            className="max-w-md p-6 space-y-4"
          >
            <div className="flex items-center justify-between pb-3 border-b border-border">
              <h3 className="text-sm font-semibold text-foreground">
                {editingSource ? 'Edit Milk Source' : 'Create Milk Source'}
              </h3>
              <button
                type="button"
                onClick={() => setShowSourceModal(false)}
                className="p-1 rounded-lg text-slate-400 hover:text-slate-600"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <form onSubmit={handleSaveSource} className="space-y-3 text-xs">
              <div>
                <label className="block font-semibold text-foreground mb-1">
                  ERP Code <span className="text-rose-600">*</span>
                </label>
                <input
                  type="text"
                  required
                  disabled={Boolean(editingSource)}
                  value={sourceForm.erp_code}
                  onChange={(e) => setSourceForm((prev) => ({ ...prev, erp_code: e.target.value }))}
                  placeholder="e.g. 1042"
                  className="w-full px-3 py-2 border border-border rounded-xl font-semibold bg-white disabled:bg-subtle disabled:text-slate-500"
                />
              </div>

              <div>
                <label className="block font-semibold text-foreground mb-1">
                  Source Name <span className="text-rose-600">*</span>
                </label>
                <input
                  type="text"
                  required
                  value={sourceForm.name}
                  onChange={(e) => setSourceForm((prev) => ({ ...prev, name: e.target.value }))}
                  placeholder="e.g. Bhalwal Dairy Hub"
                  className="w-full px-3 py-2 border border-border rounded-xl font-semibold bg-white"
                />
              </div>

              {editingSource && (
                <div>
                  <label className="flex items-center space-x-2 cursor-pointer pt-1">
                    <input
                      type="checkbox"
                      checked={sourceForm.is_active}
                      onChange={(e) => setSourceForm((prev) => ({ ...prev, is_active: e.target.checked }))}
                      className="w-4 h-4 rounded text-primary focus:ring-primary"
                    />
                    <span className="font-semibold text-slate-700">Source Active Status</span>
                  </label>
                </div>
              )}

              <div>
                <label className="block font-semibold text-foreground mb-1">
                  Visible ZMCC Facilities
                </label>
                <div className="max-h-40 overflow-y-auto border border-border rounded-xl p-2.5 space-y-1.5 bg-subtle">
                  {zmccOptions.map((z) => (
                    <label key={z.id} className="flex items-center space-x-2 cursor-pointer text-xs">
                      <input
                        type="checkbox"
                        checked={sourceForm.zmcc_ids.includes(z.id)}
                        onChange={() => toggleZmccSelection(z.id)}
                        className="w-3.5 h-3.5 rounded text-primary focus:ring-primary"
                      />
                      <span className="text-slate-800">
                        [{z.code}] {z.name}
                      </span>
                    </label>
                  ))}
                  {zmccOptions.length === 0 && (
                    <span className="text-slate-400 text-xs">No ZMCCs loaded.</span>
                  )}
                </div>
              </div>

              <div className="flex justify-end space-x-2 pt-3 border-t border-border">
                <button
                  type="button"
                  onClick={() => setShowSourceModal(false)}
                  className="px-4 py-2 border border-border rounded-xl text-slate-600 font-semibold hover:bg-subtle"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={submittingSource}
                  className="px-4 py-2 bg-primary hover:bg-primary-hover text-white rounded-xl font-semibold transition disabled:opacity-50"
                >
                  {submittingSource ? 'Saving…' : 'Save Milk Source'}
                </button>
              </div>
            </form>
          </Modal>
        )}

        {showContractorModal && editingContractor && (
          <Modal
            key="modal-contractor"
            onClose={() => setShowContractorModal(false)}
            title="Assign Contractor ERP Code"
            className="max-w-md p-6 space-y-4"
          >
            <div className="flex items-center justify-between pb-3 border-b border-border">
              <h3 className="text-sm font-semibold text-foreground">
                Assign Contractor ERP Code
              </h3>
              <button
                type="button"
                onClick={() => setShowContractorModal(false)}
                className="p-1 rounded-lg text-slate-400 hover:text-slate-600"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <form onSubmit={handleSaveContractorErp} className="space-y-3 text-xs">
              <div className="bg-subtle p-3 rounded-xl border border-border space-y-1">
                <div>
                  Contractor: <strong className="text-slate-800">{editingContractor.name}</strong>
                </div>
                <div>
                  Code: <strong className="font-mono text-slate-800">{editingContractor.code}</strong>
                </div>
              </div>

              <div>
                <label className="block font-semibold text-foreground mb-1">
                  Official ERP Code <span className="text-rose-600">*</span>
                </label>
                <input
                  type="text"
                  required
                  value={contractorErpInput}
                  onChange={(e) => setContractorErpInput(e.target.value)}
                  placeholder="e.g. 500124"
                  className="w-full px-3 py-2 border border-border rounded-xl font-semibold bg-white"
                />
              </div>

              <div className="flex justify-end space-x-2 pt-3 border-t border-border">
                <button
                  type="button"
                  onClick={() => setShowContractorModal(false)}
                  className="px-4 py-2 border border-border rounded-xl text-slate-600 font-semibold hover:bg-subtle"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={submittingContractor}
                  className="px-4 py-2 bg-primary hover:bg-primary-hover text-white rounded-xl font-semibold transition disabled:opacity-50"
                >
                  {submittingContractor ? 'Saving…' : 'Save ERP Code'}
                </button>
              </div>
            </form>
          </Modal>
        )}

        {showReviewModal && reviewingRequest && (
          <Modal
            key="modal-review"
            onClose={() => setShowReviewModal(false)}
            title={reviewAction === 'APPROVE' ? 'Approve ERP Request' : 'Reject ERP Request'}
            className="max-w-md p-6 space-y-4"
          >
            <div className="flex items-center justify-between pb-3 border-b border-border">
              <h3 className="text-sm font-semibold text-foreground">
                {reviewAction === 'APPROVE' ? 'Approve ERP Request' : 'Reject ERP Request'}
              </h3>
              <button
                type="button"
                onClick={() => setShowReviewModal(false)}
                className="p-1 rounded-lg text-slate-400 hover:text-slate-600"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <form onSubmit={handleReviewSubmit} className="space-y-3 text-xs">
              <div className="bg-subtle p-3 rounded-xl border border-border space-y-1">
                <div>
                  Proposed Source: <strong className="text-slate-800">{reviewingRequest.proposed_name}</strong>
                </div>
                <div>
                  Requesting ZMCC: <strong className="text-slate-800">{reviewingRequest.zmcc?.name}</strong>
                </div>
                {reviewingRequest.proposed_code && (
                  <div>
                    Proposed Code: <strong className="font-mono text-slate-800">{reviewingRequest.proposed_code}</strong>
                  </div>
                )}
              </div>

              {reviewAction === 'APPROVE' && (
                <>
                  <div>
                    <label className="block font-semibold text-foreground mb-1">
                      Official ERP Code <span className="text-rose-600">*</span>
                    </label>
                    <input
                      type="text"
                      required
                      value={reviewErpCode}
                      onChange={(e) => setReviewErpCode(e.target.value)}
                      placeholder="e.g. 1045"
                      className="w-full px-3 py-2 border border-border rounded-xl font-semibold bg-white"
                    />
                  </div>

                  <div>
                    <label className="block font-semibold text-foreground mb-1">
                      Visible ZMCC Facilities
                    </label>
                    <div className="max-h-36 overflow-y-auto border border-border rounded-xl p-2.5 space-y-1.5 bg-subtle">
                      {zmccOptions.map((z) => (
                        <label key={z.id} className="flex items-center space-x-2 cursor-pointer text-xs">
                          <input
                            type="checkbox"
                            checked={reviewZmccIds.includes(z.id)}
                            onChange={() => toggleReviewZmccSelection(z.id)}
                            className="w-3.5 h-3.5 rounded text-primary focus:ring-primary"
                          />
                          <span className="text-slate-800">
                            [{z.code}] {z.name}
                          </span>
                        </label>
                      ))}
                    </div>
                  </div>
                </>
              )}

              <div>
                <label className="block font-semibold text-foreground mb-1">
                  Review Notes (Optional)
                </label>
                <textarea
                  rows={2}
                  value={reviewNotes}
                  onChange={(e) => setReviewNotes(e.target.value)}
                  placeholder="Enter approval / rejection note…"
                  className="w-full px-3 py-2 border border-border rounded-xl bg-white resize-none"
                />
              </div>

              <div className="flex justify-end space-x-2 pt-3 border-t border-border">
                <button
                  type="button"
                  onClick={() => setShowReviewModal(false)}
                  className="px-4 py-2 border border-border rounded-xl text-slate-600 font-semibold hover:bg-subtle"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={submittingReview}
                  className={`px-4 py-2 rounded-xl font-semibold text-white transition disabled:opacity-50 ${
                    reviewAction === 'APPROVE' ? 'bg-emerald-600 hover:bg-emerald-700' : 'bg-rose-600 hover:bg-rose-700'
                  }`}
                >
                  {submittingReview
                    ? 'Processing…'
                    : reviewAction === 'APPROVE'
                    ? 'Approve & Create Source'
                    : 'Confirm Rejection'}
                </button>
              </div>
            </form>
          </Modal>
        )}
      </AnimatePresence>
    </section>
  );
}
