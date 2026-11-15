'use client';

import { useAutoClearMessage } from '@/frontend/hooks/useAutoClearMessage';
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
} from 'lucide-react';
import { User } from '@core/types';
import { fadeSlide } from '@/components/motion/presets';
import { fetchJson } from '@/lib/query/fetchJson';
import { getErrorMessage } from '@/lib/errors';
import { useDebouncedValue } from './shared/useDebouncedValue';
import { PaginationBar } from './shared/PaginationBar';
import { useListPageSize } from '@/components/ui/pagination';
import {
  LabTestFormDrawer,
  LabTestStatusDrawer,
  type LabTest,
} from './lab-tests/LabTestDrawers';
import { Button } from '@/components/ui/button';
import { DataFilters, FilterToggle } from '@/components/ui/data-filters';
import { SkeletonTable } from '@/components/ui/loaders';
import { TableWrapper } from '@/components/ui/table-wrapper';
import { type TestPointCode, TEST_POINT_LABELS, normalizeTestMode } from '@/types/test-point-policy';
import { ErrorPopup } from '@/components/ui/error-popup';

const ROW_PAGE_SIZE = 35;
const LAB_TESTS_API = '/api/super-admin/lab-tests';
const STAGE_API = '/api/super-admin/stage-policies-rules';

export const STAGE_FILTERS = [
  { id: 'ALL', label: 'Master Matrix (All Stages)', unit: 'All Tests', desc: 'Unified 30-Test Matrix across all 6 stages' },
  { id: 'MOT_SHOP', label: 'Mobile Tester shop', unit: 'Liters (L)', desc: 'Shop Intake · Can Rejection on Failure' },
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
  { code: 'MOT_SHOP', shortLabel: 'Mobile Tester shop' },
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
  useAutoClearMessage(successMsg, setSuccessMsg);

  // Drawers
  const [catalogDrawer, setCatalogDrawer] = useState<CatalogDrawer>(null);

  const debouncedCatalogSearch = useDebouncedValue(catalogSearch.trim(), 300);
  const pageSize = useListPageSize(25);

  // User permission
  const role = currentUser?.role?.trim() || '';
  const isRoleEditor = role === 'SUPER_ADMIN';
  const canEdit = !forceReadOnly && isRoleEditor;

  // Master Catalog Query
  const catalogQueryKey = useMemo(
    () => ['super-admin', 'lab-tests', { q: debouncedCatalogSearch, status: catalogStatus, stage: stageFilter, page: catalogPage, pageSize }],
    [debouncedCatalogSearch, catalogStatus, stageFilter, catalogPage, pageSize]
  );

  const catalogQuery = useQuery({
    queryKey: catalogQueryKey,
    queryFn: ({ signal }) => {
      const params = new URLSearchParams({
        page: String(catalogPage),
        pageSize: String(pageSize),
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
    <div className="w-full max-w-full space-y-4 overflow-x-clip">
      {/* Error & Success Alerts */}
      <ErrorPopup message={displayError} />
      <AnimatePresence initial={false}>
        {successMsg && (
          <motion.div
            key="ok"
            variants={fadeSlide}
            initial="initial"
            animate="animate"
            exit="exit"
            role="status"
            className="flex items-center gap-2 rounded-2xl border border-border bg-card p-4 text-xs font-semibold text-emerald-900"
          >
            <CheckCircle2 className="h-4 w-4 shrink-0 text-emerald-600" />
            <span>{successMsg}</span>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Unified Master Catalog Workspace */}
      <div className="overflow-hidden rounded-2xl border border-border bg-card shadow-2xs">
        {/* Master Matrix Workspace Header */}
        <div className="border-b border-border bg-subtle p-3 sm:px-4 sm:py-4">
          <div className="flex min-w-0 flex-wrap items-center justify-between gap-2">
            <div className="min-w-0">
              <h2 className="text-base font-semibold text-foreground">Master test matrix (all 6 stages)</h2>
              <p className="text-xs text-muted-foreground">
                Test rules at each stage
              </p>
            </div>
            <div className="flex items-center gap-2 rounded-lg border border-border bg-card px-3 py-1 text-xs font-medium text-secondary-foreground">
              <span className="inline-block h-2 w-2 rounded-full bg-emerald-500"></span>
              <span>All 6 stages active</span>
            </div>
          </div>
        </div>

        {/* Toolbar: Search, Status Filter & Add Lab Test */}
        <div className="space-y-3 border-b border-border bg-subtle p-3 sm:px-4 sm:py-3">
          <div className="flex min-w-0 flex-wrap items-center justify-between gap-3">
            <div className="flex items-center gap-2">
              <span className="text-sm font-semibold text-foreground">
                Master matrix
              </span>
              <span className="rounded-md border border-border bg-card px-2 py-0.5 text-xs font-medium tabular-nums text-secondary-foreground">
                {catalogPagination?.totalRecords ?? catalogTests.length} tests
              </span>
            </div>
            {canEdit && (
              <Button onClick={() => setCatalogDrawer({ kind: 'create' })}>
                <Plus />
                Add test
              </Button>
            )}
          </div>

          {/* Search & Status Filters */}
          <DataFilters
            search={catalogSearch}
            onSearchChange={(v) => {
              setCatalogSearch(v);
              setCatalogPage(1);
            }}
            searchPlaceholder="Search tests"
          >
            <FilterToggle
              label="Status filter"
              options={STATUS_FILTER_OPTIONS}
              value={catalogStatus}
              onChange={(v) => {
                setCatalogStatus(v);
                setCatalogPage(1);
              }}
            />
          </DataFilters>
        </div>

        {/* Master Catalog Table: Master Matrix (All 6 Stages Side-by-Side) */}
        <TableWrapper>
            <table className="w-full min-w-[1330px] text-left text-xs">
              <thead className="border-b border-border bg-subtle text-secondary-foreground">
                <tr>
                  <th className="w-10 p-3 text-center font-semibold">#</th>
                  <th className="p-3 font-semibold">Code</th>
                  <th className="p-3 font-semibold">Test name</th>
                  <th className="p-3 font-semibold">Category</th>
                  <th className="p-3 font-semibold text-emerald-800">Pass range</th>
                  <th className="p-3 font-semibold text-amber-800">Warning hold</th>
                  <th className="p-3 font-semibold text-rose-800">Fail reject</th>
                  {MATRIX_STAGES.map((ms) => (
                    <th key={ms.code} className="p-2 text-center font-semibold">
                      {ms.shortLabel}
                    </th>
                  ))}
                  <th className="p-2 text-center font-semibold">Status</th>
                  {canEdit && <th className="sticky right-0 bg-muted p-2 text-right font-semibold">Actions</th>}
                </tr>
              </thead>
              <tbody className="divide-y divide-border font-medium">
                {catalogQuery.isPending ? (
                  <tr>
                    <td colSpan={15} className="p-4">
                      <SkeletonTable rows={8} />
                    </td>
                  </tr>
                ) : catalogTests.length === 0 ? (
                  <tr>
                    <td colSpan={15} className="p-8 text-center text-muted-foreground">
                      No tests found.
                    </td>
                  </tr>
                ) : (
                  catalogTests.map((t) => {
                    const isMonitoring = t.category === 'MONITORING';
                    const stageModes = t.stageModes || {};

                    return (
                      <tr key={t.id} className={`transition-colors hover:bg-subtle ${t.isActive ? '' : 'bg-subtle text-muted-foreground'}`}>
                        <td className="p-3 text-center font-semibold tabular-nums text-muted-foreground">
                          {t.displayOrder}
                        </td>
                        <td className="p-3 font-mono font-semibold text-foreground tabular-nums">
                          {t.testCode}
                        </td>
                        <td className="p-3 font-semibold text-foreground min-w-[8rem]">
                          <div>{t.testName}</div>
                          {t.unit && <span className="text-xs text-muted-foreground font-normal">({t.unit})</span>}
                        </td>
                        <td className="p-3">
                          {isMonitoring ? (
                            <span className="inline-block rounded border border-border bg-muted px-2 py-0.5 text-xs font-medium text-secondary-foreground" title="Recorded for yield and pricing. Never rejects milk.">
                              Monitoring Norm
                            </span>
                          ) : (
                            <span className="inline-block rounded border border-border bg-muted px-2 py-0.5 text-xs font-medium text-secondary-foreground">
                              Complete SOP
                            </span>
                          )}
                        </td>
                        <td className="p-3 font-semibold text-emerald-800 tabular-nums whitespace-nowrap">
                          <span className="inline-flex items-center rounded-md bg-emerald-50 px-2 py-0.5 text-xs font-semibold text-emerald-800 border border-emerald-200 shadow-2xs">
                            {t.passRangeText || '—'}
                          </span>
                        </td>
                        <td className="p-3 font-semibold text-amber-800 tabular-nums whitespace-nowrap">
                          {t.warningHoldText && t.warningHoldText !== '—' ? (
                            <span className="inline-flex items-center rounded-md bg-amber-50 px-2 py-0.5 text-xs font-semibold text-amber-800 border border-amber-200 shadow-2xs">
                              {t.warningHoldText}
                            </span>
                          ) : (
                            <span className="text-xs text-muted-foreground font-normal">None (strict)</span>
                          )}
                        </td>
                        <td className="p-3 font-semibold text-rose-800 tabular-nums whitespace-nowrap">
                          {isMonitoring ? (
                            <span className="inline-flex items-center rounded-md border border-border bg-muted px-2 py-0.5 text-xs font-medium text-secondary-foreground">
                              None (norm)
                            </span>
                          ) : t.failRejectText && t.failRejectText !== '—' ? (
                            <span className="inline-flex items-center rounded-md bg-rose-50 px-2 py-0.5 text-xs font-semibold text-rose-800 border border-rose-200 shadow-2xs">
                              {t.failRejectText}
                            </span>
                          ) : (
                            <span className="text-xs text-muted-foreground font-normal">—</span>
                          )}
                        </td>

                        {/* 6 Stage Matrix Columns */}
                        {MATRIX_STAGES.map((ms) => {
                          // An inactive test is off at every stage; its stage settings come back when it is made active again.
                          const rawMode = t.isActive ? stageModes[ms.code] || 'OFF' : 'OFF';
                          const currentMode = normalizeTestMode(rawMode);
                          const isAuto = currentMode === 'AUTO' || t.resultType === 'CALCULATED';
                          const isCmp = currentMode === 'COMPULSORY';
                          const isAppl = currentMode === 'OPTIONAL';

                          return (
                            <td key={ms.code} className="p-2 text-center">
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
                                  className={`min-h-11 rounded-lg px-2 text-xs font-semibold transition-colors focus:outline-hidden ${
                                    isAuto
                                      ? 'bg-muted text-foreground border border-border'
                                      : isCmp
                                      ? 'bg-emerald-100 text-emerald-900 border border-emerald-300'
                                      : isAppl
                                      ? 'bg-sky-100 text-sky-900 border border-sky-300'
                                      : 'bg-muted text-muted-foreground border border-border'
                                  }`}
                                  title={`${TEST_POINT_LABELS[ms.code]}: change mode`}
                                >
                                  <option value="COMPULSORY">CMP</option>
                                  <option value="OPTIONAL">APPL</option>
                                  <option value="OFF">OFF</option>
                                  {isAuto && <option value="AUTO">AUTO</option>}
                                </select>
                              ) : (
                                <span
                                  className={`inline-block rounded px-2 py-0.5 text-xs font-semibold ${
                                    isAuto
                                      ? 'bg-muted text-foreground'
                                      : isCmp
                                      ? 'bg-emerald-100 text-emerald-900'
                                      : isAppl
                                      ? 'bg-sky-100 text-sky-900'
                                      : 'bg-muted text-muted-foreground'
                                  }`}
                                >
                                  {isAuto ? 'AUTO' : isCmp ? 'CMP' : isAppl ? 'APPL' : 'OFF'}
                                </span>
                              )}
                            </td>
                          );
                        })}

                        {/* Status: Inactive = off at all stages; Active = only the stages selected above */}
                        <td className="p-3 text-center">
                          {canEdit ? (
                            <button
                              type="button"
                              onClick={() => {
                                resetNotices();
                                setCatalogDrawer({ kind: 'status', test: t, action: t.isActive ? 'DEACTIVATE' : 'ACTIVATE' });
                              }}
                              title={t.isActive ? 'Active: shown at the selected stages. Click to deactivate (off at all stages).' : 'Inactive: off at all stages. Click to activate.'}
                              className={`inline-flex min-h-11 items-center gap-2 rounded-full border px-3 text-xs font-medium transition-colors ${
                                t.isActive
                                  ? 'border-emerald-300 bg-emerald-50 text-emerald-800 hover:bg-emerald-100'
                                  : 'border-border-strong bg-muted text-secondary-foreground hover:bg-muted/80'
                              }`}
                            >
                              <span className={`h-2 w-2 rounded-full ${t.isActive ? 'bg-emerald-500' : 'bg-border-strong'}`} />
                              {t.isActive ? 'Active' : 'Inactive'}
                            </button>
                          ) : (
                            <span className={`inline-block rounded-md px-3 py-0.5 text-xs font-semibold ${t.isActive ? 'bg-emerald-50 text-emerald-800' : 'bg-muted text-muted-foreground'}`}>
                              {t.isActive ? 'Active' : 'Inactive'}
                            </span>
                          )}
                        </td>

                        {/* Actions */}
                        {canEdit && (
                          <td className="sticky right-0 bg-card p-3 text-right whitespace-nowrap">
                            <Button
                              variant="outline"
                              size="sm"
                              onClick={() => {
                                resetNotices();
                                setCatalogDrawer({ kind: 'edit', test: t });
                              }}
                            >
                              <Edit2 />
                              Edit
                            </Button>
                          </td>
                        )}
                      </tr>
                    );
                  })
                )}
              </tbody>
            </table>
        </TableWrapper>

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
      fallback={<SkeletonTable rows={8} />}
    >
      <WorkspaceInner {...props} />
    </Suspense>
  );
};
