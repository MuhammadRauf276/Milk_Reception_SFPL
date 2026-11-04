'use client';

import { InfoTip } from '@/components/ui/info-tip';
import React, { Suspense, useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { AnimatePresence, motion } from 'framer-motion';
import { useSearchParams } from 'next/navigation';
import {
  CheckCircle2,
  Edit2,
  Plus,
  ShieldAlert,
  Camera,
  Check,
  Search,
} from 'lucide-react';
import { User } from '@core/types';
import { fadeSlide } from '@/components/motion/presets';
import { fetchJson } from '@/lib/query/fetchJson';
import { getErrorMessage } from '@/lib/errors';
import { useDebouncedValue } from './shared/useDebouncedValue';
import { PaginationBar } from './shared/PaginationBar';
import {
  LabTestFormDrawer,
  LabTestStatusDrawer,
  type LabTest,
} from './lab-tests/LabTestDrawers';
import { type TestPointCode, TEST_POINT_LABELS } from '@/types/test-point-policy';

const ROW_PAGE_SIZE = 35;
const LAB_TESTS_API = '/api/super-admin/lab-tests';
const STAGE_API = '/api/super-admin/stage-policies-rules';

export const STAGE_FILTERS = [
  { id: 'ALL', label: 'Master Matrix (All Stages)', unit: 'All Tests', desc: 'Unified 30-Test Matrix across all 6 stages' },
  { id: 'MOT_SHOP', label: 'MOT Shop', unit: 'Liters (L)', desc: 'Shop Intake · Can Rejection on Failure' },
  { id: 'ZMCC_LAB_MC', label: 'ZMCC MC', unit: 'kg', desc: 'Route Milk · Chilled Silo vs Rejected Tank' },
  { id: 'ZMCC_LAB_HC', label: 'ZMCC HC', unit: 'kg', desc: 'Direct supplier (HC) deliveries' },
  { id: 'ZMCC_DISPATCH', label: 'ZMCC Dispatch', unit: 'kg', desc: 'ZMCC Tanker Dispatch · 0–4.5°C & Seals' },
  { id: 'CONTRACTOR_DISPATCH', label: 'Contractor Dispatch', unit: 'kg', desc: 'Direct Contractor Tanker Dispatch' },
  { id: 'PLANT_QA', label: 'Plant QA', unit: 'kg', desc: 'Plant Reception · Zero-Tolerance Adulteration Reject' },
] as const;

export const STAGE_NAME_MAP: Record<string, string> = {
  MOT_SHOP: 'MOT Village Collection',
  ZMCC_LAB_MC: 'ZMCC Lab for MC',
  ZMCC_LAB_HC: 'ZMCC Lab for HC',
  ZMCC_DISPATCH: 'ZMCC Dispatch to Plant',
  CONTRACTOR_DISPATCH: 'Contractor Dispatch to Plant',
  DISPATCH: 'Dispatch',
  PLANT_QA: 'Plant QA Reception Lab',
};

const MATRIX_STAGES: Array<{ code: TestPointCode; shortLabel: string }> = [
  { code: 'MOT_SHOP', shortLabel: 'MOT Shop' },
  { code: 'ZMCC_LAB_MC', shortLabel: 'ZMCC MC' },
  { code: 'ZMCC_LAB_HC', shortLabel: 'ZMCC HC' },
  { code: 'ZMCC_DISPATCH', shortLabel: 'ZMCC Disp' },
  { code: 'CONTRACTOR_DISPATCH', shortLabel: 'Contr Disp' },
  { code: 'PLANT_QA', shortLabel: 'Plant QA' },
];

const STATUS_FILTER_OPTIONS = [
  { value: '', label: 'All' },
  { value: 'active', label: 'Active' },
  { value: 'inactive', label: 'Inactive' },
];

const postStage = (body: Record<string, unknown>) =>
  fetchJson<{ ok?: boolean }>(STAGE_API, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });

interface LabTestsResponse {
  labTests?: LabTest[];
  maxDisplayOrder?: number;
  pagination?: { page: number; totalPages: number; totalRecords: number };
}

type CatalogDrawer =
  | { kind: 'create'; initialStage?: string }
  | { kind: 'edit'; test: LabTest }
  | { kind: 'status'; test: LabTest; action: 'ACTIVATE' | 'DEACTIVATE' }
  | null;

export interface UnifiedStagePoliciesRulesWorkspaceProps {
  currentUser?: User | null;
  defaultTestingPoint?: string;
  allowedStages?: string[];
  forceReadOnly?: boolean;
}

function WorkspaceInner({
  currentUser,
  defaultTestingPoint = 'ALL',
  forceReadOnly = false,
}: UnifiedStagePoliciesRulesWorkspaceProps) {
  const queryClient = useQueryClient();
  const searchParams = useSearchParams();

  const paramStage = searchParams?.get('stage')?.toUpperCase() || searchParams?.get('tab')?.toUpperCase();
  const initialStage = useMemo(() => {
    if (paramStage) {
      const match = STAGE_FILTERS.find((s) => s.id === paramStage || s.id.replace(/_/g, '-') === paramStage.replace(/_/g, '-'));
      if (match) return match.id;
    }
    return defaultTestingPoint === 'CATALOG' ? 'ALL' : defaultTestingPoint;
  }, [paramStage, defaultTestingPoint]);

  const stageFilter = 'ALL';
  const [catalogSearch, setCatalogSearch] = useState('');
  const [catalogStatus, setCatalogStatus] = useState('');
  const [catalogPage, setCatalogPage] = useState(1);

  // Notices
  const [actionError, setActionError] = useState<string | null>(null);
  const [successMsg, setSuccessMsg] = useState<string | null>(null);

  // Drawers
  const [catalogDrawer, setCatalogDrawer] = useState<CatalogDrawer>(null);

  const debouncedCatalogSearch = useDebouncedValue(catalogSearch.trim(), 300);

  // User permission
  const role = currentUser?.role?.trim() || '';
  const isRoleEditor = ['SUPER_ADMIN', 'DATA_EXECUTIVE'].includes(role);
  const canEdit = !forceReadOnly && isRoleEditor;

  // Master Catalog Query
  const catalogQueryKey = useMemo(
    () => ['super-admin', 'lab-tests', { q: debouncedCatalogSearch, status: catalogStatus, stage: stageFilter, page: catalogPage }],
    [debouncedCatalogSearch, catalogStatus, stageFilter, catalogPage]
  );

  const catalogQuery = useQuery({
    queryKey: catalogQueryKey,
    queryFn: ({ signal }) => {
      const params = new URLSearchParams({
        page: String(catalogPage),
        pageSize: String(ROW_PAGE_SIZE),
      });
      if (debouncedCatalogSearch) params.set('q', debouncedCatalogSearch);
      if (catalogStatus) params.set('status', catalogStatus);
      if (stageFilter && stageFilter !== 'ALL') params.set('stage', stageFilter);
      return fetchJson<LabTestsResponse>(`${LAB_TESTS_API}?${params}`, { signal, cache: 'no-store' });
    },
  });

  const refreshAll = async () => {
    await queryClient.invalidateQueries({ queryKey: ['super-admin', 'lab-tests'] });
  };

  const resetNotices = () => {
    setSuccessMsg(null);
    setActionError(null);
  };

  // Toggle Matrix Cell Mode Mutation (CMP, APPL, OFF, AUTO)
  const updateCellModeMutation = useMutation({
    mutationFn: ({ testId, point, mode }: { testId: string; point: TestPointCode; mode: string }) =>
      fetchJson('/api/super-admin/test-point-policies', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          reason: `Super Admin set ${point} to ${mode}`,
          changes: [
            {
              labTestId: testId,
              point,
              testMode: mode,
            },
          ],
        }),
      }),
    onSuccess: async () => {
      setSuccessMsg('Testing policy assignment updated.');
      await refreshAll();
    },
    onError: (err) => setActionError(getErrorMessage(err) || 'Failed to update policy mode.'),
  });

  // 1-Click Toggle Requirement (Compulsory vs Optional for Single Stage)
  const toggleRequiredMutation = useMutation({
    mutationFn: ({ test, targetRequired }: { test: LabTest; targetRequired: boolean }) => {
      if (stageFilter && stageFilter !== 'ALL') {
        return postStage({
          action: 'toggleRequired',
          testingPoint: stageFilter,
          labTestId: test.id,
          isRequired: targetRequired,
        });
      }
      return fetchJson(`/api/super-admin/lab-tests/${test.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ isRequired: targetRequired }),
      });
    },
    onSuccess: async (_d, { test, targetRequired }) => {
      setSuccessMsg(
        `Set "${test.testName}" as ${targetRequired ? 'Compulsory' : 'Optional'}${
          stageFilter !== 'ALL' ? ` at ${STAGE_NAME_MAP[stageFilter] || stageFilter}` : ''
        }.`
      );
      await refreshAll();
    },
    onError: (err) => setActionError(getErrorMessage(err) || 'Failed to update requirement status.'),
  });

  // 1-Click Toggle Active Status
  const toggleActiveMutation = useMutation({
    mutationFn: ({ test, targetActive }: { test: LabTest; targetActive: boolean }) =>
      fetchJson(`/api/super-admin/lab-tests/${test.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ isActive: targetActive }),
      }),
    onSuccess: async (_d, { test, targetActive }) => {
      setSuccessMsg(`Test "${test.testName}" ${targetActive ? 'activated' : 'deactivated'}.`);
      await refreshAll();
    },
    onError: (err) => setActionError(getErrorMessage(err) || 'Failed to update test status.'),
  });

  const catalogTests = catalogQuery.data?.labTests ?? [];
  const catalogPagination = catalogQuery.data?.pagination;
  const nextDisplayOrder = (catalogQuery.data?.maxDisplayOrder ?? 0) + 1;
  const activeStageInfo = STAGE_FILTERS.find((s) => s.id === stageFilter) || STAGE_FILTERS[0];

  const loadError = catalogQuery.error ? getErrorMessage(catalogQuery.error) || 'Failed to load laboratory tests.' : null;
  const displayError = actionError || loadError;

  return (
    <div className="w-full max-w-full space-y-4 overflow-x-hidden">
      {/* Error & Success Alerts */}
      {displayError && (
        <div role="alert" className="flex items-center gap-2 rounded-xl border border-border bg-card p-3.5 text-xs font-semibold text-rose-800">
          <ShieldAlert className="h-4 w-4 shrink-0 text-rose-600" />
          <span>{displayError}</span>
        </div>
      )}
      <AnimatePresence initial={false}>
        {successMsg && (
          <motion.div
            key="ok"
            variants={fadeSlide}
            initial="initial"
            animate="animate"
            exit="exit"
            role="status"
            className="flex items-center gap-2 rounded-xl border border-border bg-card p-3.5 text-xs font-semibold text-emerald-900"
          >
            <CheckCircle2 className="h-4 w-4 shrink-0 text-emerald-600" />
            <span>{successMsg}</span>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Unified Master Catalog Workspace */}
      <div className="overflow-hidden rounded-xl border border-border bg-card shadow-2xs">
        {/* Master Matrix Workspace Header */}
        <div className="border-b border-slate-200 bg-slate-100/90 p-3 sm:px-4 sm:py-3.5">
          <div className="flex flex-col gap-1 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <h2 className="text-base font-bold text-slate-900">Master Test Matrix (All 6 Stages)</h2>
              <p className="text-xs text-slate-500">
                Authoritative dairy specifications & test mode policies across MOT Shop, ZMCC MC, ZMCC HC, ZMCC Dispatch, Contractor Dispatch, and Plant QA Reception.
              </p>
            </div>
            <div className="flex items-center gap-1.5 text-[11px] font-semibold text-slate-600 bg-white border border-slate-200 rounded-lg px-2.5 py-1">
              <span className="inline-block h-2 w-2 rounded-full bg-emerald-500"></span>
              <span>All 6 Stages Active</span>
            </div>
          </div>
        </div>

        {/* Toolbar: Search, Status Filter & Add Lab Test */}
        <div className="space-y-3 border-b border-slate-200 bg-slate-50 p-3 sm:px-4 sm:py-3">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <div className="flex items-center gap-2">
              <span className="text-sm font-bold text-slate-900">
                Master Matrix
              </span>
              <span className="rounded-full border border-slate-200 bg-white px-2 py-0.5 text-xs font-semibold tabular-nums text-slate-700">
                {catalogPagination?.totalRecords ?? catalogTests.length} tests
              </span>
            </div>
            {canEdit && (
              <button
                type="button"
                onClick={() => setCatalogDrawer({ kind: 'create' })}
                className="inline-flex min-h-10 items-center gap-1.5 rounded-lg bg-primary px-3 text-xs font-bold text-white shadow-2xs transition-colors hover:bg-primary-hover"
              >
                <Plus className="h-4 w-4" />
                <span>Add test</span>
              </button>
            )}
          </div>

          {/* Search & Status Filters */}
          <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
            <div className="relative flex-1">
              <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" aria-hidden="true" />
              <input
                type="search"
                value={catalogSearch}
                onChange={(e) => {
                  setCatalogSearch(e.target.value);
                  setCatalogPage(1);
                }}
                placeholder="Search tests…"
                aria-label="Search lab tests"
                className="h-10 w-full rounded-xl border border-border-strong bg-card pl-9 pr-3 text-sm focus:outline-hidden focus:border-primary"
              />
            </div>
            <div role="group" aria-label="Status filter" className="flex gap-1">
              {STATUS_FILTER_OPTIONS.map((o) => (
                <button
                  key={o.value}
                  type="button"
                  aria-pressed={catalogStatus === o.value}
                  onClick={() => {
                    setCatalogStatus(o.value);
                    setCatalogPage(1);
                  }}
                  className={`h-10 rounded-xl border px-3 text-xs font-semibold transition-colors ${
                    catalogStatus === o.value
                      ? 'border-primary bg-primary/10 text-primary'
                      : 'border-border-strong bg-white text-slate-600 hover:bg-slate-50'
                  }`}
                >
                  {o.label}
                </button>
              ))}
            </div>
          </div>
        </div>

        {/* Master Catalog Table: Master Matrix (All 6 Stages Side-by-Side) */}
        <div className="w-full overflow-x-auto">
            <table className="w-full min-w-[1330px] text-left text-xs">
              <thead className="border-b border-slate-200 bg-slate-100/90 text-slate-700">
                <tr>
                  <th className="w-10 p-2.5 text-center font-bold">#</th>
                  <th className="p-2.5 font-bold">Code</th>
                  <th className="p-2.5 font-bold">Test Name</th>
                  <th className="p-2.5 font-bold">Category</th>
                  <th className="p-2.5 font-bold text-emerald-800">Pass Range</th>
                  <th className="p-2.5 font-bold text-amber-800">Warning Hold</th>
                  <th className="p-2.5 font-bold text-rose-800">Fail Reject</th>
                  {MATRIX_STAGES.map((ms) => (
                    <th key={ms.code} className="p-2 text-center font-bold">
                      {ms.shortLabel}
                    </th>
                  ))}
                  <th className="p-2 text-center font-bold">Status</th>
                  {canEdit && <th className="sticky right-0 bg-slate-100 p-2 text-right font-bold">Actions</th>}
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-200/70 font-medium">
                {catalogQuery.isPending ? (
                  <tr>
                    <td colSpan={15} className="p-8 text-center font-semibold text-slate-400">
                      Loading matrix…
                    </td>
                  </tr>
                ) : catalogTests.length === 0 ? (
                  <tr>
                    <td colSpan={15} className="p-8 text-center text-slate-400">
                      No tests found.
                    </td>
                  </tr>
                ) : (
                  catalogTests.map((t) => {
                    const isMonitoring = t.category === 'MONITORING';
                    const stageModes = t.stageModes || {};

                    return (
                      <tr key={t.id} className={`transition-colors hover:bg-slate-50 ${t.isActive ? '' : 'bg-slate-50/70 text-slate-400'}`}>
                        <td className="p-2.5 text-center font-semibold tabular-nums text-slate-400">
                          {t.displayOrder}
                        </td>
                        <td className="p-2.5 font-mono font-bold text-slate-900 tabular-nums">
                          {t.testCode}
                        </td>
                        <td className="p-2.5 font-bold text-slate-900 max-w-[180px]">
                          <div>{t.testName}</div>
                          {t.unit && <span className="text-[10px] text-slate-500 font-normal">({t.unit})</span>}
                        </td>
                        <td className="p-2.5">
                          {isMonitoring ? (
                            <span className="inline-block rounded bg-purple-50 px-2 py-0.5 text-[10px] font-bold text-purple-700 border border-purple-200" title="Monitoring Norm: Compulsory to record for yield/pricing, but never rejects milk">
                              Monitoring Norm
                            </span>
                          ) : (
                            <span className="inline-block rounded bg-blue-50 px-2 py-0.5 text-[10px] font-bold text-blue-700 border border-blue-200">
                              Complete SOP
                            </span>
                          )}
                        </td>
                        <td className="p-2.5 font-semibold text-emerald-800 tabular-nums whitespace-nowrap">
                          <span className="inline-flex items-center rounded-md bg-emerald-50 px-2 py-0.5 text-[11px] font-bold text-emerald-800 border border-emerald-200 shadow-2xs">
                            {t.passRangeText || '—'}
                          </span>
                        </td>
                        <td className="p-2.5 font-semibold text-amber-800 tabular-nums whitespace-nowrap">
                          {t.warningHoldText && t.warningHoldText !== '—' ? (
                            <span className="inline-flex items-center rounded-md bg-amber-50 px-2 py-0.5 text-[11px] font-bold text-amber-800 border border-amber-200 shadow-2xs">
                              {t.warningHoldText}
                            </span>
                          ) : (
                            <span className="text-[11px] text-slate-400 font-normal">None (Strict)</span>
                          )}
                        </td>
                        <td className="p-2.5 font-semibold text-rose-800 tabular-nums whitespace-nowrap">
                          {isMonitoring ? (
                            <span className="inline-flex items-center rounded-md bg-purple-50 px-2 py-0.5 text-[10px] font-bold text-purple-700 border border-purple-200">
                              None (Norm)
                            </span>
                          ) : t.failRejectText && t.failRejectText !== '—' ? (
                            <span className="inline-flex items-center rounded-md bg-rose-50 px-2 py-0.5 text-[11px] font-bold text-rose-800 border border-rose-200 shadow-2xs">
                              {t.failRejectText}
                            </span>
                          ) : (
                            <span className="text-[11px] text-slate-400 font-normal">—</span>
                          )}
                        </td>

                        {/* 6 Stage Matrix Columns */}
                        {MATRIX_STAGES.map((ms) => {
                          // An inactive test is off at every stage; its stage settings come back when it is made active again.
                          const currentMode = t.isActive ? stageModes[ms.code] || 'NOT_APPLIED' : 'NOT_APPLIED';
                          const isAuto = currentMode === 'AUTO' || t.resultType === 'CALCULATED';
                          const isCmp = currentMode === 'COMPULSORY';
                          const isAppl = currentMode === 'APPLIED' || currentMode === 'OPTIONAL';

                          return (
                            <td key={ms.code} className="p-1.5 text-center">
                              {canEdit && t.isActive ? (
                                <select
                                  value={currentMode}
                                  onChange={(e) => {
                                    resetNotices();
                                    updateCellModeMutation.mutate({
                                      testId: t.id,
                                      point: ms.code,
                                      mode: e.target.value,
                                    });
                                  }}
                                  className={`rounded px-1.5 py-1 text-[10px] font-bold transition focus:outline-hidden ${
                                    isAuto
                                      ? 'bg-purple-100 text-purple-900 border border-purple-300'
                                      : isCmp
                                      ? 'bg-emerald-100 text-emerald-900 border border-emerald-300'
                                      : isAppl
                                      ? 'bg-sky-100 text-sky-900 border border-sky-300'
                                      : 'bg-slate-100 text-slate-500 border border-slate-200'
                                  }`}
                                  title={`${TEST_POINT_LABELS[ms.code]}: Click to change mode`}
                                >
                                  <option value="COMPULSORY">CMP</option>
                                  <option value="APPLIED">APPL</option>
                                  <option value="NOT_APPLIED">OFF</option>
                                  {isAuto && <option value="AUTO">AUTO</option>}
                                </select>
                              ) : (
                                <span
                                  className={`inline-block rounded px-2 py-0.5 text-[10px] font-bold ${
                                    isAuto
                                      ? 'bg-purple-100 text-purple-900'
                                      : isCmp
                                      ? 'bg-emerald-100 text-emerald-900'
                                      : isAppl
                                      ? 'bg-sky-100 text-sky-900'
                                      : 'bg-slate-100 text-slate-400'
                                  }`}
                                >
                                  {isAuto ? 'AUTO' : isCmp ? 'CMP' : isAppl ? 'APPL' : 'OFF'}
                                </span>
                              )}
                            </td>
                          );
                        })}

                        {/* Status: Inactive = off at all stages; Active = only the stages selected above */}
                        <td className="p-2.5 text-center whitespace-nowrap">
                          {canEdit ? (
                            <button
                              type="button"
                              onClick={() => {
                                resetNotices();
                                setCatalogDrawer({ kind: 'status', test: t, action: t.isActive ? 'DEACTIVATE' : 'ACTIVATE' });
                              }}
                              title={t.isActive ? 'Active: shown at the selected stages. Click to deactivate (off at all stages).' : 'Inactive: off at all stages. Click to activate.'}
                              className={`inline-flex min-h-8 items-center gap-1.5 rounded-full border px-2.5 py-1 text-[11px] font-bold transition ${
                                t.isActive
                                  ? 'border-emerald-300 bg-emerald-50 text-emerald-800 hover:bg-emerald-100'
                                  : 'border-slate-300 bg-slate-100 text-slate-600 hover:bg-slate-200'
                              }`}
                            >
                              <span className={`h-2 w-2 rounded-full ${t.isActive ? 'bg-emerald-500' : 'bg-slate-400'}`} />
                              {t.isActive ? 'Active' : 'Inactive'}
                            </button>
                          ) : (
                            <span className={`inline-block rounded-full px-2.5 py-0.5 text-[11px] font-bold ${t.isActive ? 'bg-emerald-50 text-emerald-800' : 'bg-slate-100 text-slate-500'}`}>
                              {t.isActive ? 'Active' : 'Inactive'}
                            </span>
                          )}
                        </td>

                        {/* Actions */}
                        {canEdit && (
                          <td className="sticky right-0 bg-white p-2.5 text-right whitespace-nowrap">
                            <button
                              type="button"
                              onClick={() => {
                                resetNotices();
                                setCatalogDrawer({ kind: 'edit', test: t });
                              }}
                              className="inline-flex min-h-8 items-center gap-1 rounded-lg border border-slate-300 bg-slate-100 px-2 py-1 text-xs font-bold text-slate-800 transition hover:bg-slate-200"
                            >
                              <Edit2 className="h-3 w-3" />
                              <span>Edit</span>
                            </button>
                          </td>
                        )}
                      </tr>
                    );
                  })
                )}
              </tbody>
            </table>
        </div>

        {/* Pagination */}
        <PaginationBar
          page={catalogPagination?.page ?? catalogPage}
          totalPages={catalogPagination?.totalPages ?? 1}
          totalRecords={catalogPagination?.totalRecords ?? catalogTests.length}
          noun="lab tests"
          disabled={catalogQuery.isFetching}
          onPageChange={setCatalogPage}
        />
      </div>

      {/* DRAWERS */}
      {(catalogDrawer?.kind === 'create' || catalogDrawer?.kind === 'edit') && (
        <LabTestFormDrawer
          key={catalogDrawer.kind === 'edit' ? catalogDrawer.test.id : 'new-test'}
          test={catalogDrawer.kind === 'edit' ? catalogDrawer.test : null}
          nextDisplayOrder={nextDisplayOrder}
          initialStage={catalogDrawer.kind === 'create' ? catalogDrawer.initialStage : undefined}
          onClose={() => setCatalogDrawer(null)}
          onSaved={(msg) => {
            setCatalogDrawer(null);
            setSuccessMsg(msg);
            void refreshAll();
          }}
        />
      )}

      {catalogDrawer?.kind === 'status' && (
        <LabTestStatusDrawer
          key={`status-${catalogDrawer.test.id}`}
          test={catalogDrawer.test}
          action={catalogDrawer.action}
          onClose={() => setCatalogDrawer(null)}
          onSaved={(msg) => {
            setCatalogDrawer(null);
            setSuccessMsg(msg);
            void refreshAll();
          }}
          onError={(msg) => {
            setCatalogDrawer(null);
            setActionError(msg);
          }}
        />
      )}
    </div>
  );
}

export const UnifiedStagePoliciesRulesWorkspace: React.FC<UnifiedStagePoliciesRulesWorkspaceProps> = (props) => {
  return (
    <Suspense
      fallback={
        <div className="flex items-center justify-center p-12 text-xs font-semibold text-slate-500">
          Loading Laboratory Workspace…
        </div>
      }
    >
      <WorkspaceInner {...props} />
    </Suspense>
  );
};
