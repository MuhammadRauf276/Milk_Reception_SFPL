'use client';

import { useState, useEffect, useMemo, useEffectEvent } from 'react';
import { fetchJson } from '@/lib/query/fetchJson';
import { apiClient } from '@/frontend/lib/apiClient';
import { useToast } from '@/frontend/context/ToastContext';
import { useServerDraft } from '@/frontend/hooks/useServerDraft';
import { getErrorMessage } from '@/lib/errors';
import type { PersonDecision } from '@/types/stage1-decision';
import {
  TestPerformanceStatus,
  LabTestDef,
  SavedPlantResult,
  VisitDetailPortion,
  VisitDetail,
  TestInputState,
} from './QATestingSection';

/**
 * Loaded detail of the visit under test: portions, per-test inputs, seal / photo / decision maps and the
 * derived accountability metrics used by the testing form.
 */
export function useQAVisitDetail(selectedTestingVisitId: string | null) {
  const toast = useToast();

  const [visitDetail, setVisitDetail] = useState<VisitDetail | null>(null);
  const [activePortionIndex, setActivePortionIndex] = useState<number>(0);

  // Per-test form state: testId → TestInputState
  const [testInputs, setTestInputs] = useState<Record<string, TestInputState>>({});
  const [enteredSealMap, setEnteredSealMap] = useState<Record<string, string>>({});
  const [photoStatesMap, setPhotoStatesMap] = useState<Record<string, Record<string, string>>>({});
  const [personDecisionMap, setPersonDecisionMap] = useState<Record<string, PersonDecision | null>>({});
  const [decisionRemarksMap, setDecisionRemarksMap] = useState<Record<string, string>>({});

  const [isRefreshingVisit, setIsLoadingVisit] = useState(false);
  // Visit whose detail request last settled; a different selection means it is still loading.
  const [loadedVisitId, setLoadedVisitId] = useState<string | null>(null);
  const isLoadingVisit = isRefreshingVisit || (selectedTestingVisitId !== null && loadedVisitId !== selectedTestingVisitId);

  // Clearing the visit under test clears its detail.
  const [trackedTestingVisitId, setTrackedTestingVisitId] = useState(selectedTestingVisitId);
  if (trackedTestingVisitId !== selectedTestingVisitId) {
    setTrackedTestingVisitId(selectedTestingVisitId);
    if (!selectedTestingVisitId) setVisitDetail(null);
  }

  const populateInputsForPortion = (portion: VisitDetailPortion, plantTests: LabTestDef[]) => {
    const inputs: Record<string, TestInputState> = {};

    plantTests.forEach((test) => {
      const existing = portion.plant_results.find((pr) => pr.testId === test.id);
      if (existing) {
        inputs[test.id] = {
          performanceStatus: (existing.performanceStatus as TestPerformanceStatus) || 'PERFORMED',
          notPerformedReason: existing.notPerformedReason || '',
          numericValue: existing.numericValue !== null && existing.numericValue !== undefined ? String(existing.numericValue) : '',
          textValue: existing.textValue || '',
        };
      } else {
        inputs[test.id] = {
          performanceStatus: 'PERFORMED',
          notPerformedReason: '',
          numericValue: '',
          textValue: '',
        };
      }
    });

    setTestInputs(inputs);
    if (portion.plant_seal_number_entered) {
      setEnteredSealMap((prev) => ({ ...prev, [portion.id]: portion.plant_seal_number_entered! }));
    }
    const portionPhotos: Record<string, string> = {};
    portion.plant_results?.forEach((pr: SavedPlantResult & { photo_url?: string; photoUrl?: string }) => {
      const pUrl = pr.photoUrl || pr.photo_url;
      if (pUrl) portionPhotos[pr.testId] = pUrl;
    });
    if (Object.keys(portionPhotos).length > 0) {
      setPhotoStatesMap((prev) => ({ ...prev, [portion.id]: portionPhotos }));
    }
  };

  const fetchVisitDetail = async (visitId: string) => {
    setIsLoadingVisit(true);
    try {
      const data = await apiClient.get<{ visit?: VisitDetail }>(`/api/qa/vehicle-visits/${visitId}`, {
        timeoutMs: 15_000,
      });

      if (!data || !data.visit) throw new Error('Failed to fetch visit detail');

      setVisitDetail(data.visit);
      if (data.visit?.portions && data.visit.portions.length > activePortionIndex) {
        populateInputsForPortion(data.visit.portions[activePortionIndex], data.visit.active_plant_tests || []);
      }
    } catch (err) {
      toast.showError(getErrorMessage(err), 'Failed to Load Visit');
    } finally {
      setIsLoadingVisit(false);
    }
  };

  const applyLoadedVisit = useEffectEvent((visit: VisitDetail | null | undefined) => {
    if (visit) {
      setVisitDetail(visit);
      if (visit.portions && visit.portions.length > 0) {
        populateInputsForPortion(visit.portions[0], visit.active_plant_tests || []);
      }
    } else {
      setVisitDetail(null);
    }
  });

  // Load the selected in-testing visit and prefill its first portion's inputs.
  useEffect(() => {
    if (!selectedTestingVisitId) return;
    const controller = new AbortController();
    fetchJson<{ visit?: VisitDetail | null }>(`/api/qa/vehicle-visits/${selectedTestingVisitId}`, { signal: controller.signal })
      .then((data) => {
        applyLoadedVisit(data.visit);
      })
      .catch((err) => {
        if (!controller.signal.aborted) toast.showError(getErrorMessage(err), 'Failed to Load Visit');
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoadedVisitId(selectedTestingVisitId);
      });

    return () => {
      controller.abort();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedTestingVisitId]);

  const handleSelectPortion = (index: number) => {
    if (!visitDetail || !visitDetail.portions[index]) return;
    setActivePortionIndex(index);
    populateInputsForPortion(visitDetail.portions[index], visitDetail.active_plant_tests || []);
  };

  const handleTestPerformanceStatusChange = (testId: string, status: TestPerformanceStatus) => {
    setTestInputs((prev) => ({
      ...prev,
      [testId]: {
        ...(prev[testId] || { numericValue: '', textValue: '', notPerformedReason: '' }),
        performanceStatus: status,
      },
    }));
  };

  const handleTestNumericChange = (testId: string, val: string) => {
    setTestInputs((prev) => ({
      ...prev,
      [testId]: {
        ...(prev[testId] || { performanceStatus: 'PERFORMED', notPerformedReason: '', textValue: '' }),
        numericValue: val,
      },
    }));
  };

  const handleTestTextChange = (testId: string, val: string) => {
    setTestInputs((prev) => ({
      ...prev,
      [testId]: {
        ...(prev[testId] || { performanceStatus: 'PERFORMED', notPerformedReason: '', numericValue: '' }),
        textValue: val,
      },
    }));
  };

  const handleTestReasonChange = (testId: string, val: string) => {
    setTestInputs((prev) => ({
      ...prev,
      [testId]: {
        ...(prev[testId] || { performanceStatus: 'NOT_PERFORMED', numericValue: '', textValue: '' }),
        notPerformedReason: val,
      },
    }));
  };

  // ─── Derived accountability metrics ────────────────────────────────────────
  const requiredManualPlantTests = useMemo(
    () => (visitDetail?.active_plant_tests || []).filter((t) => t.isRequired && t.resultType !== 'CALCULATED'),
    [visitDetail]
  );

  // PERFORMED: has a valid value entered
  const performedCount = useMemo(() => {
    return requiredManualPlantTests.filter((t) => {
      const state = testInputs[t.id];
      if (!state) return false;
      if (t.resultType === 'NUMERIC') return state.numericValue !== '' && !isNaN(Number(state.numericValue));
      return Boolean(state.textValue && state.textValue.trim() !== '');
    }).length;
  }, [requiredManualPlantTests, testInputs]);

  // UNRESOLVED / PENDING: required tests that are not yet entered
  const unresolvedCount = useMemo(() => {
    return Math.max(0, requiredManualPlantTests.length - performedCount);
  }, [requiredManualPlantTests.length, performedCount]);

  const notPerformedCount = unresolvedCount;

  const canAccept = performedCount === requiredManualPlantTests.length;

  const hasFailingTests = useMemo(() => {
    const currentPortion = visitDetail?.portions?.[activePortionIndex];
    if (!currentPortion) return false;
    if (currentPortion.plant_results?.some((r) => r.isPassed === false)) return true;
    for (const test of requiredManualPlantTests) {
      const input = testInputs[test.id];
      if (!input) continue;
      if (test.resultType === 'NUMERIC') {
        const num = input.numericValue !== '' && !isNaN(Number(input.numericValue)) ? Number(input.numericValue) : null;
        if (num !== null && test.rule) {
          if ((test.rule.min != null && num < test.rule.min) || (test.rule.max != null && num > test.rule.max)) {
            return true;
          }
        }
      } else if (input.textValue && test.resultOptions) {
        const opt = test.resultOptions.find((o) => o.value === input.textValue);
        if (opt && opt.isPassing === false) return true;
      }
    }
    return false;
  }, [visitDetail, activePortionIndex, requiredManualPlantTests, testInputs]);

  // Format dispatch quantity display — never crash on null
  const formatDispatchQty = (portion: VisitDetailPortion | null): string => {
    if (!portion) return '—';
    const val = portion.dispatch_quantity_value;
    const unit = portion.dispatch_quantity_unit;
    if (val === null || val === undefined || !unit) return '—';
    return `${Number(val).toLocaleString()} ${unit}`;
  };

  // Active portion scoped accessors
  const activePortion = visitDetail?.portions?.[activePortionIndex] ?? null;

  // Private server draft of the open portion: the same login continues on any device. Never a result.
  const draftPortionId = activePortion?.id ?? null;
  const draftContent = useMemo(() => {
    const values: Record<string, string> = {};
    for (const [testId, st] of Object.entries(testInputs)) {
      values[`n:${testId}`] = st.numericValue;
      values[`t:${testId}`] = st.textValue;
      values[`r:${testId}`] = st.notPerformedReason;
      if (st.performanceStatus !== 'PERFORMED') values[`s:${testId}`] = st.performanceStatus;
    }
    if (draftPortionId) values.seal = enteredSealMap[draftPortionId] ?? '';
    const photos: Record<string, string> = {};
    for (const [testId, url] of Object.entries(draftPortionId ? photoStatesMap[draftPortionId] ?? {} : {})) {
      if (url && !url.startsWith('data:') && url.length <= 2000) photos[testId] = url;
    }
    return { values, photos, remarks: draftPortionId ? decisionRemarksMap[draftPortionId] ?? '' : '' };
  }, [testInputs, enteredSealMap, photoStatesMap, decisionRemarksMap, draftPortionId]);
  const serverDraft = useServerDraft({
    formType: 'PLANT_QA',
    scopeId: visitDetail?.id ?? null,
    portionKey: draftPortionId,
    content: draftContent,
    onRemote: (remote, reason) => {
      if (!draftPortionId) return;
      // Opening: fill only what is still empty. Another device saved: its typed values win, nothing typed here is blanked.
      const take = (local: string | undefined, incoming: string | undefined) =>
        incoming && incoming.trim() !== '' && (reason === 'stale' || !local || local.trim() === '') ? incoming : local ?? '';
      setTestInputs((prev) => {
        const next = { ...prev };
        for (const testId of Object.keys(prev)) {
          const cur = prev[testId];
          next[testId] = {
            performanceStatus: (remote.values[`s:${testId}`] as TestPerformanceStatus) || cur.performanceStatus,
            notPerformedReason: take(cur.notPerformedReason, remote.values[`r:${testId}`]),
            numericValue: take(cur.numericValue, remote.values[`n:${testId}`]),
            textValue: take(cur.textValue, remote.values[`t:${testId}`]),
          };
        }
        return next;
      });
      if (remote.values.seal) {
        setEnteredSealMap((prev) => ({ ...prev, [draftPortionId]: take(prev[draftPortionId], remote.values.seal) }));
      }
      if (Object.keys(remote.photos).length > 0) {
        setPhotoStatesMap((prev) => ({ ...prev, [draftPortionId]: { ...remote.photos, ...(prev[draftPortionId] ?? {}) } }));
      }
      if (remote.remarks) {
        setDecisionRemarksMap((prev) => ({ ...prev, [draftPortionId]: take(prev[draftPortionId], remote.remarks) }));
      }
    },
  });
  // Once the open portion is decided its draft is no longer needed: stop saving and remove the phone's copy.
  const portionDecided = activePortion?.plant_decision === 'ACCEPTED' || activePortion?.plant_decision === 'REJECTED';
  useEffect(() => {
    if (portionDecided) serverDraft.discard();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [portionDecided, draftPortionId]);

  return {
    visitDetail,
    setVisitDetail,
    activePortionIndex,
    setActivePortionIndex,
    activePortion,
    testInputs,
    enteredSealMap,
    setEnteredSealMap,
    photoStatesMap,
    setPhotoStatesMap,
    personDecisionMap,
    setPersonDecisionMap,
    decisionRemarksMap,
    setDecisionRemarksMap,
    isLoadingVisit,
    populateInputsForPortion,
    fetchVisitDetail,
    handleSelectPortion,
    handleTestPerformanceStatusChange,
    handleTestNumericChange,
    handleTestTextChange,
    handleTestReasonChange,
    requiredManualPlantTests,
    performedCount,
    notPerformedCount,
    unresolvedCount,
    canAccept,
    hasFailingTests,
    formatDispatchQty,
  };
}

export type QAVisitDetailState = ReturnType<typeof useQAVisitDetail>;
