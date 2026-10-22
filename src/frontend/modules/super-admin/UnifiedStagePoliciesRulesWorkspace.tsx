'use client';

import React, { Suspense, useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { AnimatePresence, motion } from 'framer-motion';
import { useSearchParams } from 'next/navigation';
import {
  CheckCircle2,
  Edit2,
  Plus,
  ShieldAlert,
  Lock,
  Sliders,
  Camera,
  Check,
  Search,
  FlaskConical,
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

const ROW_PAGE_SIZE = 25;
const LAB_TESTS_API = '/api/super-admin/lab-tests';
const STAGE_API = '/api/super-admin/stage-policies-rules';

export const STAGE_FILTERS = [
  { id: 'ALL', label: 'All Tests', unit: 'Various', desc: 'Complete enterprise catalog' },
  { id: 'MOT_SHOP', label: '1. MOT Shop', unit: 'Liters (L)', desc: 'Shop Intake · Can Rejection on Failure' },
  { id: 'ZMCC_LAB_MC', label: '2. ZMCC MC', unit: 'kg', desc: 'Route Milk · Chilled Silo vs Rejected Tank' },
  { id: 'ZMCC_LAB_HC', label: '3. ZMCC HC', unit: 'kg', desc: 'Direct Supplier (HC) Deliveries' },
  { id: 'DISPATCH', label: '4. Dispatch', unit: 'kg', desc: 'Tanker Dispatch · 0–4.5°C & Seals' },
  { id: 'PLANT_QA', label: '5. Plant QA', unit: 'kg', desc: 'Plant Reception · Zero-Tolerance Adulteration Reject' },
] as const;

export const STAGE_NAME_MAP: Record<string, string> = {
  MOT_SHOP: 'MOT Shop',
  ZMCC_LAB_MC: 'ZMCC MC',
  ZMCC_LAB_HC: 'ZMCC HC',
  DISPATCH: 'Dispatch',
  PLANT_QA: 'Plant QA',
};

const STATUS_FILTER_OPTIONS = [
  { value: '', label: 'All Status' },
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

  const [stageFilter, setStageFilter] = useState<string>(initialStage);
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

  // Master Catalog Query (with stage, status, search, and pagination)
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

  // 1-Click Toggle Requirement (Compulsory vs Optional)
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

  // 1-Click Toggle Photo Requirement
  const togglePhotoMutation = useMutation({
    mutationFn: ({ test, targetPhoto }: { test: LabTest; targetPhoto: boolean }) => {
      if (stageFilter && stageFilter !== 'ALL') {
        return postStage({
          action: 'togglePhoto',
          testingPoint: stageFilter,
          labTestId: test.id,
          isPhotoRequired: targetPhoto,
        });
      }
      return fetchJson(`/api/super-admin/lab-tests/${test.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ isPhotoRequired: targetPhoto }),
      });
    },
    onSuccess: async (_d, { test, targetPhoto }) => {
      setSuccessMsg(
        targetPhoto
          ? `Camera photo required for "${test.testName}"${stageFilter !== 'ALL' ? ` at ${STAGE_NAME_MAP[stageFilter] || stageFilter}` : ''}.`
          : `Photo requirement disabled for "${test.testName}"${stageFilter !== 'ALL' ? ` at ${STAGE_NAME_MAP[stageFilter] || stageFilter}` : ''}.`
      );
      await refreshAll();
    },
    onError: (err) => setActionError(getErrorMessage(err) || 'Failed to update photo requirement.'),
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
      {/* Header Banner */}
      <div className="flex flex-col gap-3 rounded-xl border border-slate-200 bg-white p-4 shadow-xs sm:flex-row sm:items-center sm:justify-between">
        <div>
          <div className="flex items-center gap-2">
            <FlaskConical className="h-5 w-5 text-primary" />
            <h1 className="text-lg font-bold text-slate-900">Master Laboratory Tests &amp; Stage Policies</h1>
          </div>
          <p className="mt-1 text-xs text-slate-500">
            One unified master catalog to manage tests, stage assignments, compulsory enforcement, photo evidence, and SOP acceptance limits.
          </p>
        </div>
        {!canEdit && (
          <div className="inline-flex items-center gap-2 rounded-lg border border-amber-200 bg-amber-50 px-3 py-1.5 text-xs font-semibold text-amber-900">
            <Lock className="h-3.5 w-3.5 text-amber-700" />
            <span>Read-Only View</span>
          </div>
        )}
      </div>

      {/* Error & Success Alerts */}
      {displayError && (
        <div role="alert" className="flex items-center gap-2 rounded-xl border border-rose-200 bg-rose-50 p-3.5 text-xs font-semibold text-rose-800">
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
            className="flex items-center gap-2 rounded-xl border border-emerald-200 bg-emerald-50 p-3.5 text-xs font-semibold text-emerald-900"
          >
            <CheckCircle2 className="h-4 w-4 shrink-0 text-emerald-600" />
            <span>{successMsg}</span>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Unified Master Catalog Workspace */}
      <div className="overflow-hidden rounded-xl border border-slate-200 bg-white shadow-xs">
        {/* Stage Filter Pills Bar (Quick 1-Click Filtering Without Navigation Clutter) */}
        <div className="border-b border-slate-200 bg-slate-100/90 p-2.5">
          <div className="flex flex-wrap items-center gap-1.5">
            <span className="text-[11px] font-bold text-slate-500 uppercase tracking-wider mr-1">Filter by Stage:</span>
            {STAGE_FILTERS.map((s) => {
              const isSelected = stageFilter === s.id;
              return (
                <button
                  key={s.id}
                  type="button"
                  onClick={() => {
                    setStageFilter(s.id);
                    setCatalogPage(1);
                    resetNotices();
                  }}
                  className={`flex min-h-9 items-center gap-1.5 rounded-lg px-3 text-xs font-bold transition-all ${
                    isSelected
                      ? 'bg-primary text-white shadow-xs'
                      : 'border border-slate-200 bg-white text-slate-700 hover:bg-slate-50'
                  }`}
                >
                  <span>{s.label}</span>
                </button>
              );
            })}
          </div>

          {/* Active Stage Context Info */}
          {stageFilter !== 'ALL' && 'unit' in activeStageInfo && (
            <div className="mt-2 flex flex-wrap items-center gap-2 rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-xs text-slate-700">
              <span className="font-bold text-slate-900">{activeStageInfo.label}:</span>
              <span className="rounded bg-slate-100 px-2 py-0.5 font-bold text-slate-800">Operating Unit: {activeStageInfo.unit}</span>
              <span className="text-slate-500">· {activeStageInfo.desc}</span>
            </div>
          )}
        </div>

        {/* Toolbar: Search, Status Filter & Add Lab Test */}
        <div className="space-y-3 border-b border-slate-200 bg-slate-50 p-3 sm:px-4 sm:py-3">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <div className="flex items-center gap-2">
              <span className="text-sm font-bold text-slate-900">
                {stageFilter === 'ALL' ? 'Master Lab Tests' : `${activeStageInfo.label} Tests`}
              </span>
              <span className="rounded-full border border-slate-200 bg-white px-2 py-0.5 text-xs font-semibold tabular-nums text-slate-700">
                {catalogPagination?.totalRecords ?? catalogTests.length} tests
              </span>
            </div>
            {canEdit && (
              <button
                type="button"
                onClick={() => setCatalogDrawer({ kind: 'create', initialStage: stageFilter !== 'ALL' ? stageFilter : undefined })}
                className="inline-flex min-h-11 items-center gap-1.5 rounded-lg bg-primary px-4 text-xs font-bold text-white shadow-xs transition-colors hover:bg-primary-hover"
              >
                <Plus className="h-4 w-4" />
                <span>Add Lab Test</span>
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
                placeholder="Search test name or test code…"
                aria-label="Search lab tests"
                className="h-11 w-full rounded-xl border border-border-strong bg-white pl-9 pr-3 text-sm focus:outline-hidden focus:border-primary"
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
                  className={`h-11 rounded-xl border px-3 text-xs font-semibold transition-colors ${
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

        {/* Master Catalog Table */}
        <div className="w-full overflow-x-auto">
          <table className="w-full min-w-[850px] text-left text-xs">
            <thead className="border-b border-slate-200 bg-slate-100/80 text-slate-700">
              <tr>
                <th className="w-12 p-3 text-center font-bold">#</th>
                <th className="p-3 font-bold">Test Code</th>
                <th className="p-3 font-bold">Test Name</th>
                <th className="p-3 font-bold">Type &amp; Choices</th>
                <th className="p-3 font-bold">Unit</th>
                <th className="p-3 font-bold">Assigned Stages</th>
                <th className="p-3 font-bold">Requirement</th>
                <th className="p-3 font-bold">Photo Evidence</th>
                <th className="p-3 font-bold">SOP Passing Standard</th>
                <th className="p-3 font-bold">Status</th>
                {canEdit && <th className="p-3 text-right font-bold">Actions</th>}
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-200/70 font-medium">
              {catalogQuery.isPending ? (
                <tr>
                  <td colSpan={11} className="p-8 text-center font-semibold text-slate-400">
                    Loading laboratory tests…
                  </td>
                </tr>
              ) : catalogTests.length === 0 ? (
                <tr>
                  <td colSpan={11} className="p-8 text-center text-slate-400">
                    No laboratory tests match your search criteria.
                  </td>
                </tr>
              ) : (
                catalogTests.map((t) => {
                  const stages = t.assignedStages || [];
                  const isNumeric = t.resultType === 'NUMERIC' || t.resultType === 'CALCULATED';

                  let passingDisplay = '—';
                  if (isNumeric) {
                    if (t.minValue !== null && t.minValue !== undefined && t.maxValue !== null && t.maxValue !== undefined) {
                      passingDisplay = `${t.minValue} to ${t.maxValue}${t.unit ? ` ${t.unit}` : ''}`;
                    } else if (t.minValue !== null && t.minValue !== undefined) {
                      passingDisplay = `≥ ${t.minValue}${t.unit ? ` ${t.unit}` : ''}`;
                    } else if (t.maxValue !== null && t.maxValue !== undefined) {
                      passingDisplay = `≤ ${t.maxValue}${t.unit ? ` ${t.unit}` : ''}`;
                    }
                  } else if (t.acceptableOption) {
                    passingDisplay = t.acceptableOption;
                  }

                  return (
                    <tr key={t.id} className="transition-colors hover:bg-slate-50">
                      <td className="p-3 text-center font-semibold tabular-nums text-slate-400">
                        {t.displayOrder}
                      </td>
                      <td className="p-3 font-mono font-bold text-slate-900 tabular-nums">
                        {t.testCode}
                      </td>
                      <td className="p-3 font-bold text-slate-900">
                        {t.testName}
                      </td>
                      <td className="p-3">
                        <div className="space-y-1">
                          <span
                            className={`inline-flex items-center gap-1 rounded px-2 py-0.5 text-xs font-semibold ${
                              t.resultType === 'NUMERIC'
                                ? 'bg-blue-100 text-blue-900'
                                : t.resultType === 'POSITIVE_NEGATIVE'
                                ? 'bg-emerald-100 text-emerald-900'
                                : t.resultType === 'OK_NOT_OK'
                                ? 'border border-slate-200 bg-slate-100 text-slate-800'
                                : t.resultType === 'QUALITATIVE'
                                ? 'bg-amber-100 text-amber-900'
                                : 'bg-slate-100 text-slate-700'
                            }`}
                          >
                            <span>{t.resultType}</span>
                            {t.historicalResultsCount > 0 && (
                              <span title="Result type locked due to historical test records">
                                <Lock className="h-3 w-3 text-slate-500" />
                              </span>
                            )}
                          </span>

                          {Array.isArray(t.resultOptions) && t.resultOptions.length > 0 && (
                            <div className="flex flex-wrap gap-1 pt-0.5">
                              {t.resultOptions.map((opt) => {
                                const isPass = opt.outcome === 'PASS' || opt.isPassing === true;
                                const isWarn = opt.outcome === 'WARNING';
                                const isFail = opt.outcome === 'FAIL' || opt.isPassing === false;
                                return (
                                  <span
                                    key={opt.value}
                                    className={`rounded border px-1.5 py-0.5 text-[10px] font-semibold tabular-nums ${
                                      isPass
                                        ? 'border-emerald-300 bg-emerald-50 text-emerald-800'
                                        : isWarn
                                        ? 'border-amber-300 bg-amber-50 text-amber-800'
                                        : isFail
                                        ? 'border-rose-300 bg-rose-50 text-rose-800'
                                        : 'border-slate-300 bg-slate-50 text-slate-700'
                                    }`}
                                  >
                                    {opt.label || opt.value} ({isPass ? 'Pass' : isWarn ? 'Warn' : isFail ? 'Fail' : 'Neutral'})
                                  </span>
                                );
                              })}
                            </div>
                          )}
                        </div>
                      </td>
                      <td className="p-3 tabular-nums text-slate-600">{t.unit || '—'}</td>

                      {/* Assigned Operational Stages */}
                      <td className="p-3">
                        {stages.length === 0 ? (
                          <span className="text-[11px] italic text-slate-400">Unassigned (Catalog only)</span>
                        ) : (
                          <div className="flex flex-wrap gap-1">
                            {stages.map((st) => (
                              <button
                                key={st}
                                type="button"
                                onClick={() => {
                                  setStageFilter(st);
                                  setCatalogPage(1);
                                  resetNotices();
                                }}
                                className="inline-flex items-center gap-1 rounded-full border border-primary/20 bg-primary/10 px-2 py-0.5 text-[10px] font-bold text-primary transition hover:bg-primary hover:text-white"
                                title={`Click to filter by ${STAGE_NAME_MAP[st] || st}`}
                              >
                                <span>{STAGE_NAME_MAP[st] || st}</span>
                              </button>
                            ))}
                          </div>
                        )}
                      </td>

                      {/* 1-Click Interactive Requirement Toggle */}
                      <td className="p-3">
                        <button
                          type="button"
                          disabled={!canEdit || toggleRequiredMutation.isPending}
                          onClick={() => {
                            resetNotices();
                            toggleRequiredMutation.mutate({
                              test: t,
                              targetRequired: !t.isRequired,
                            });
                          }}
                          className={`inline-flex min-h-8 items-center gap-1.5 rounded-lg border px-2.5 py-1 text-[11px] font-bold transition shadow-2xs ${
                            t.isRequired
                              ? 'border-blue-300 bg-blue-100 text-blue-900 hover:bg-blue-200'
                              : 'border-slate-300 bg-slate-100 text-slate-600 hover:bg-slate-200 hover:text-slate-900'
                          } ${!canEdit ? 'cursor-default' : 'cursor-pointer'}`}
                          title={
                            canEdit
                              ? t.isRequired
                                ? 'Compulsory test (mandatory). Click to make Optional.'
                                : 'Optional test. Click to make Compulsory (mandatory).'
                              : undefined
                          }
                        >
                          <span className={`inline-block size-2 rounded-full ${t.isRequired ? 'bg-blue-600' : 'bg-slate-400'}`} />
                          <span>{t.isRequired ? 'Compulsory' : 'Optional'}</span>
                        </button>
                      </td>

                      {/* 1-Click Interactive Photo Requirement Toggle */}
                      <td className="p-3">
                        <button
                          type="button"
                          disabled={!canEdit || togglePhotoMutation.isPending}
                          onClick={() => {
                            resetNotices();
                            togglePhotoMutation.mutate({
                              test: t,
                              targetPhoto: !t.isPhotoRequired,
                            });
                          }}
                          className={`inline-flex min-h-8 items-center gap-1 rounded-lg border px-2.5 py-1 text-[11px] font-semibold transition shadow-2xs ${
                            t.isPhotoRequired
                              ? 'border-sky-300 bg-sky-100 text-sky-900 hover:bg-sky-200'
                              : 'border-slate-200 bg-white text-slate-500 hover:bg-slate-100'
                          } ${!canEdit ? 'cursor-default' : 'cursor-pointer'}`}
                          title={
                            canEdit
                              ? t.isPhotoRequired
                                ? 'Camera photo evidence required. Click to remove photo requirement.'
                                : 'No photo required. Click to enforce camera photo evidence.'
                              : undefined
                          }
                        >
                          <Camera className={`h-3.5 w-3.5 ${t.isPhotoRequired ? 'text-sky-700' : 'text-slate-400'}`} />
                          <span>{t.isPhotoRequired ? 'Photo Req' : 'No Photo'}</span>
                        </button>
                      </td>

                      {/* SOP Passing Standard Limits */}
                      <td className="p-3 font-bold tabular-nums text-slate-800">
                        {passingDisplay !== '—' ? (
                          isNumeric ? (
                            <span>{passingDisplay}</span>
                          ) : (
                            <span className="rounded bg-emerald-100 px-2 py-0.5 text-[11px] font-bold text-emerald-900">
                              [ {passingDisplay} ]
                            </span>
                          )
                        ) : (
                          <span className="text-[11px] font-normal italic text-slate-400">Record Only</span>
                        )}
                      </td>

                      {/* Status */}
                      <td className="p-3">
                        <button
                          type="button"
                          disabled={!canEdit || toggleActiveMutation.isPending}
                          onClick={() => {
                            resetNotices();
                            toggleActiveMutation.mutate({ test: t, targetActive: !t.isActive });
                          }}
                          className={`inline-flex min-h-8 items-center gap-1 rounded-lg border px-2.5 py-1 text-[11px] font-bold transition shadow-2xs ${
                            t.isActive
                              ? 'border-emerald-300 bg-emerald-100 text-emerald-900 hover:bg-rose-100 hover:text-rose-900'
                              : 'border-slate-300 bg-slate-200 text-slate-600 hover:bg-emerald-100 hover:text-emerald-900'
                          } ${!canEdit ? 'cursor-default' : 'cursor-pointer'}`}
                          title={canEdit ? (t.isActive ? 'Active. Click to deactivate.' : 'Inactive. Click to activate.') : undefined}
                        >
                          <Check className="h-3 w-3" />
                          <span>{t.isActive ? 'Active' : 'Inactive'}</span>
                        </button>
                      </td>

                      {/* Actions */}
                      {canEdit && (
                        <td className="p-3 text-right whitespace-nowrap">
                          <button
                            type="button"
                            onClick={() => {
                              resetNotices();
                              setCatalogDrawer({ kind: 'edit', test: t });
                            }}
                            className="inline-flex min-h-8 items-center gap-1 rounded-lg border border-slate-300 bg-slate-100 px-2.5 py-1 text-xs font-bold text-slate-800 transition hover:bg-slate-200"
                          >
                            <Edit2 className="h-3.5 w-3.5" />
                            <span>Edit Test &amp; Stages</span>
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
