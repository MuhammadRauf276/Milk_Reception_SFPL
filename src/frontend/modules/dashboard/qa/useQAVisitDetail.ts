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

const EMPTY_TEST_INPUTS: Record<string, TestInputState> = {};

/**
 * Loaded detail of the visit under test: portions, per-test inputs, seal / photo / decision maps and the
 * derived accountability metrics used by the testing form.
 */
export function useQAVisitDetail(selectedTestingVisitId: string | null) {
  const toast = useToast();

  const [visitDetail, setVisitDetail] = useState<VisitDetail | null>(null);
  const [activePortionIndex, setActivePortionIndex] = useState<number>(0);

  // Per-test form state: portionId → testId → TestInputState
  const [testInputsByPortion, setTestInputsByPortion] = useState<Record<string, Record<string, TestInputState>>>({});
  const [enteredSealMap, setEnteredSealMap] = useState<Record<string, string>>({});
  const [photoStatesMap, setPhotoStatesMap] = useState<Record<string, Record<string, string>>>({});
  const [personDecisionMap, setPersonDecisionMap] = useState<Record<string, PersonDecision | null>>({});
  const [decisionRemarksMap, setDecisionRemarksMap] = useState<Record<string, string>>({});
  const [savedPortionsMap, setSavedPortionsMap] = useState<Record<string, boolean>>({});

  const activePortion = visitDetail?.portions?.[activePortionIndex] ?? null;
  const testInputs = useMemo(
    () => (activePortion?.id ? (testInputsByPortion[activePortion.id] ?? EMPTY_TEST_INPUTS) : EMPTY_TEST_INPUTS),
    [activePortion?.id, testInputsByPortion]
  );

  const [isRefreshingVisit, setIsLoadingVisit] = useState(false);
  // Visit whose detail request last settled; a different selection means it is still loading.
  const [loadedVisitId, setLoadedVisitId] = useState<string | null>(null);
  const isLoadingVisit = isRefreshingVisit || (selectedTestingVisitId !== null && loadedVisitId !== selectedTestingVisitId);

  // Clearing / switching the visit under test clears previous vehicle's client draft maps.
  useEffect(() => {
    setActivePortionIndex(0);
    setTestInputsByPortion({});
    setEnteredSealMap({});
    setPhotoStatesMap({});
    setPersonDecisionMap({});
    setDecisionRemarksMap({});
    setSavedPortionsMap({});
    if (!selectedTestingVisitId) {
      setVisitDetail(null);
      setLoadedVisitId(null);
    }
  }, [selectedTestingVisitId]);

  const buildInputsForPortion = (portion: VisitDetailPortion, plantTests: LabTestDef[]): Record<string, TestInputState> => {
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

    return inputs;
  };

  const syncAllPortionsFromVisit = (visit: VisitDetail, overwrite = false) => {
    const plantTests = visit.active_plant_tests || [];
    setTestInputsByPortion((prev) => {
      const next: Record<string, Record<string, TestInputState>> = {};
      for (const p of visit.portions) {
        const shouldKeepExisting =
          !overwrite &&
          prev[p.id] &&
          p.plant_decision !== 'ACCEPTED' &&
          p.plant_decision !== 'REJECTED';
        next[p.id] = shouldKeepExisting ? prev[p.id] : buildInputsForPortion(p, plantTests);
      }
      return next;
    });

    setEnteredSealMap((prev) => {
      const next = { ...prev };
      for (const p of visit.portions) {
        if (p.plant_seal_number_entered && (overwrite || !next[p.id])) {
          next[p.id] = p.plant_seal_number_entered;
        }
      }
      return next;
    });

    setPhotoStatesMap((prev) => {
      const next = { ...prev };
      for (const p of visit.portions) {
        const portionPhotos: Record<string, string> = {};
        p.plant_results?.forEach((pr: SavedPlantResult & { photo_url?: string; photoUrl?: string }) => {
          const pUrl = pr.photoUrl || pr.photo_url;
          if (pUrl) portionPhotos[pr.testId] = pUrl;
        });
        if (Object.keys(portionPhotos).length > 0) {
          next[p.id] = { ...portionPhotos, ...(overwrite ? {} : next[p.id] ?? {}) };
        }
      }
      return next;
    });
  };

  const populateInputsForPortion = (portion: VisitDetailPortion, plantTests: LabTestDef[], overwrite = false) => {
    setTestInputsByPortion((prev) => {
      const existing = !overwrite ? prev[portion.id] : undefined;
      if (existing && Object.keys(existing).length > 0) return prev;
      return { ...prev, [portion.id]: buildInputsForPortion(portion, plantTests) };
    });
    if (portion.plant_seal_number_entered) {
      setEnteredSealMap((prev) => ({
        ...prev,
        [portion.id]: (!overwrite && prev[portion.id]) ? prev[portion.id] : portion.plant_seal_number_entered!,
      }));
    }
    const portionPhotos: Record<string, string> = {};
    portion.plant_results?.forEach((pr: SavedPlantResult & { photo_url?: string; photoUrl?: string }) => {
      const pUrl = pr.photoUrl || pr.photo_url;
      if (pUrl) portionPhotos[pr.testId] = pUrl;
    });
    if (Object.keys(portionPhotos).length > 0) {
      setPhotoStatesMap((prev) => ({
        ...prev,
        [portion.id]: overwrite ? portionPhotos : { ...portionPhotos, ...(prev[portion.id] ?? {}) },
      }));
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
      syncAllPortionsFromVisit(data.visit, true);
      if (data.visit?.portions && data.visit.portions.length > 0) {
        const idx = Math.min(activePortionIndex, data.visit.portions.length - 1);
        populateInputsForPortion(data.visit.portions[idx], data.visit.active_plant_tests || [], true);
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
      syncAllPortionsFromVisit(visit, true);
      if (visit.portions && visit.portions.length > 0) {
        populateInputsForPortion(visit.portions[0], visit.active_plant_tests || [], true);
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
    populateInputsForPortion(visitDetail.portions[index], visitDetail.active_plant_tests || [], false);
  };

  const updateActivePortionTestInput = (
    testId: string,
    patch: Partial<TestInputState>,
    defaults: TestInputState
  ) => {
    const portionId = activePortion?.id;
    if (!portionId) return;
    setTestInputsByPortion((prev) => {
      const curMap = prev[portionId] || {};
      return {
        ...prev,
        [portionId]: {
          ...curMap,
          [testId]: {
            ...(curMap[testId] || defaults),
            ...patch,
          },
        },
      };
    });
  };

  const handleTestPerformanceStatusChange = (testId: string, status: TestPerformanceStatus) => {
    updateActivePortionTestInput(
      testId,
      { performanceStatus: status },
      { performanceStatus: status, numericValue: '', textValue: '', notPerformedReason: '' }
    );
  };

  const handleTestNumericChange = (testId: string, val: string) => {
    updateActivePortionTestInput(
      testId,
      { numericValue: val },
      { performanceStatus: 'PERFORMED', notPerformedReason: '', numericValue: val, textValue: '' }
    );
  };

  const handleTestTextChange = (testId: string, val: string) => {
    updateActivePortionTestInput(
      testId,
      { textValue: val },
      { performanceStatus: 'PERFORMED', notPerformedReason: '', numericValue: '', textValue: val }
    );
  };

  const handleTestReasonChange = (testId: string, val: string) => {
    updateActivePortionTestInput(
      testId,
      { notPerformedReason: val },
      { performanceStatus: 'NOT_PERFORMED', numericValue: '', textValue: '', notPerformedReason: val }
    );
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
      setTestInputsByPortion((prevMap) => {
        let base = prevMap[draftPortionId];
        if (!base) {
          const targetPortion = visitDetail?.portions.find((p) => p.id === draftPortionId);
          if (!targetPortion) return prevMap;
          base = buildInputsForPortion(targetPortion, visitDetail?.active_plant_tests || []);
        }
        const next = { ...base };
        for (const testId of Object.keys(base)) {
          const cur = base[testId];
          next[testId] = {
            performanceStatus: (remote.values[`s:${testId}`] as TestPerformanceStatus) || cur.performanceStatus,
            notPerformedReason: take(cur.notPerformedReason, remote.values[`r:${testId}`]),
            numericValue: take(cur.numericValue, remote.values[`n:${testId}`]),
            textValue: take(cur.textValue, remote.values[`t:${testId}`]),
          };
        }
        return { ...prevMap, [draftPortionId]: next };
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
    testInputsByPortion,
    setTestInputsByPortion,
    enteredSealMap,
    setEnteredSealMap,
    photoStatesMap,
    setPhotoStatesMap,
    personDecisionMap,
    setPersonDecisionMap,
    decisionRemarksMap,
    setDecisionRemarksMap,
    savedPortionsMap,
    setSavedPortionsMap,
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
