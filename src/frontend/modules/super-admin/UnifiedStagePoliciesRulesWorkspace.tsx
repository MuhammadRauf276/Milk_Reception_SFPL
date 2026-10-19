'use client';

import React, { useEffect, useState, useCallback } from 'react';
import {
  CheckCircle2,
  Edit2,
  Plus,
  ShieldAlert,
  Lock,
  X,
  Sliders,
  Camera,
} from 'lucide-react';
import { User } from '@core/types';

export interface LabTestOption {
  value: string;
  label: string;
  isPassing?: boolean | null;
}

export interface UnifiedStageItem {
  labTest: {
    id: string;
    testCode: string;
    testName: string;
    resultType: string;
    unit: string | null;
    isActive: boolean;
    displayOrder: number;
    isPhotoRequired?: boolean;
    resultOptions?: LabTestOption[] | null;
  };
  policy: {
    id: string;
    isActive: boolean;
    isRequired: boolean;
    isPhotoRequired?: boolean;
    displayOrder: number;
    updatedAt: string;
  } | null;
  rule: {
    id: string;
    version: number;
    ruleCategory: 'RELEASE' | 'MONITORING';
    ruleTypeLabel: 'Must Pass' | 'Warning Only';
    minValue: number | null;
    maxValue: number | null;
    warningOffset?: number | null;
    acceptableOption: string | null;
    effectiveFrom: string;
  } | null;
}

const STAGE_TABS = [
  { id: 'GLOBAL_DEFAULT', label: '0. Global Master Specs', subtitle: 'Universal Standard Limits (Fallback)' },
  { id: 'MOT_SHOP', label: '1. MOT Shop', subtitle: 'Village Shop Milk Collection' },
  { id: 'ZMCC_LAB_MOT', label: '2. ZMCC MOT', subtitle: 'ZMCC Intake: MOT Routes' },
  { id: 'ZMCC_LAB_LOCAL_SUPPLIER', label: '3. ZMCC Local Supplier', subtitle: 'ZMCC Intake: Local Suppliers' },
  { id: 'DISPATCH', label: '4. Dispatch', subtitle: 'Tanker Dispatch to Plant' },
  { id: 'PLANT_QA', label: '5. Plant QA', subtitle: 'Plant Reception Laboratory' },
] as const;

export interface UnifiedStagePoliciesRulesWorkspaceProps {
  currentUser?: User | null;
  defaultTestingPoint?: string;
  allowedStages?: string[];
  forceReadOnly?: boolean;
}

export const UnifiedStagePoliciesRulesWorkspace: React.FC<UnifiedStagePoliciesRulesWorkspaceProps> = ({
  currentUser,
  defaultTestingPoint = 'PLANT_QA',
  allowedStages,
  forceReadOnly = false,
}) => {
  const visibleTabs = allowedStages
    ? STAGE_TABS.filter((t) => allowedStages.includes(t.id))
    : STAGE_TABS;

  const [selectedStage, setSelectedStage] = useState<string>(
    visibleTabs.some((t) => t.id === defaultTestingPoint)
      ? defaultTestingPoint
      : visibleTabs[0]?.id || 'PLANT_QA'
  );

  const [items, setItems] = useState<UnifiedStageItem[]>([]);
  const [canEditServer, setCanEditServer] = useState<boolean>(false);
  const [loading, setLoading] = useState<boolean>(true);
  const [error, setError] = useState<string | null>(null);
  const [successMsg, setSuccessMsg] = useState<string | null>(null);

  const [editingItem, setEditingItem] = useState<UnifiedStageItem | null>(null);
  const [formActive, setFormActive] = useState<boolean>(true);
  const [formRequired, setFormRequired] = useState<boolean>(true);
  const [formPhotoRequired, setFormPhotoRequired] = useState<boolean>(false);
  const [formOrder, setFormOrder] = useState<number>(1);
  const [formRuleCategory, setFormRuleCategory] = useState<'RELEASE' | 'MONITORING'>('RELEASE');
  const [formMin, setFormMin] = useState<string>('');
  const [formMax, setFormMax] = useState<string>('');
  const [formWarningOffset, setFormWarningOffset] = useState<string>('');
  const [formAcceptableOption, setFormAcceptableOption] = useState<string>('PASS');
  const [formReason, setFormReason] = useState<string>('');
  const [modalError, setModalError] = useState<string | null>(null);
  const [isSaving, setIsSaving] = useState<boolean>(false);

  const role = currentUser?.role?.trim() || '';
  const isRoleEditor = ['SUPER_ADMIN', 'DATA_EXECUTIVE'].includes(role);
  const canEdit = !forceReadOnly && (canEditServer || isRoleEditor);

  const loadStageData = useCallback(async (stage: string) => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`/api/super-admin/stage-policies-rules?testingPoint=${encodeURIComponent(stage)}`, {
        cache: 'no-store',
      });
      const data = await res.json();
      if (res.ok) {
        setItems(data.items || []);
        setCanEditServer(Boolean(data.canEdit));
      } else {
        setError(data.error || 'Failed to load stage test policies and rules.');
      }
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Network error loading stage policies.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadStageData(selectedStage);
  }, [selectedStage, loadStageData]);

  const openConfigModal = (item: UnifiedStageItem) => {
    if (!canEdit) return;
    setEditingItem(item);
    setModalError(null);

    const activeStageCount = items.filter((i) => i.policy?.isActive).length;
    setFormActive(item.policy ? item.policy.isActive : true);
    setFormRequired(item.policy ? item.policy.isRequired : true);
    setFormPhotoRequired(Boolean(item.policy?.isPhotoRequired ?? item.labTest.isPhotoRequired));
    setFormOrder(item.policy?.displayOrder ?? (activeStageCount + 1));
    setFormRuleCategory(item.rule?.ruleCategory === 'MONITORING' ? 'MONITORING' : 'RELEASE');
    setFormMin(item.rule?.minValue !== null && item.rule?.minValue !== undefined ? String(item.rule.minValue) : '');
    setFormMax(item.rule?.maxValue !== null && item.rule?.maxValue !== undefined ? String(item.rule.maxValue) : '');
    setFormWarningOffset(
      item.rule?.warningOffset !== null && item.rule?.warningOffset !== undefined ? String(item.rule.warningOffset) : ''
    );

    const options = Array.isArray(item.labTest.resultOptions) ? item.labTest.resultOptions : [];
    const defaultOpt =
      item.rule?.acceptableOption ||
      options.find((o) => o.isPassing === true)?.value ||
      options[0]?.value ||
      'PASS';
    setFormAcceptableOption(defaultOpt);
    setFormReason(`Updated ${item.labTest.testName} rule at ${selectedStage}`);
  };

  const closeConfigModal = () => {
    if (isSaving) return;
    setEditingItem(null);
    setModalError(null);
  };

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!editingItem || isSaving) return;

    setModalError(null);
    setSuccessMsg(null);

    const isNumeric =
      editingItem.labTest.resultType === 'NUMERIC' || editingItem.labTest.resultType === 'CALCULATED';

    if (isNumeric) {
      if (formMin.trim() !== '' && formMax.trim() !== '' && Number(formMin) > Number(formMax)) {
        setModalError('Minimum limit cannot be greater than Maximum limit.');
        return;
      }
    }

    setIsSaving(true);
    try {
      const res = await fetch('/api/super-admin/stage-policies-rules', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          labTestId: editingItem.labTest.id,
          testingPoint: selectedStage,
          isActive: formActive,
          isRequired: formRequired,
          isPhotoRequired: formPhotoRequired,
          displayOrder: Number(formOrder) || 1,
          ruleCategory: formRuleCategory,
          minValue: isNumeric && formMin.trim() !== '' ? Number(formMin) : null,
          maxValue: isNumeric && formMax.trim() !== '' ? Number(formMax) : null,
          warningOffset: isNumeric && formWarningOffset.trim() !== '' ? Number(formWarningOffset) : null,
          acceptableOption: !isNumeric ? formAcceptableOption : null,
          reason: formReason.trim() || `Configured ${editingItem.labTest.testName}`,
        }),
      });

      const data = await res.json();
      if (!res.ok) {
        setModalError(data.error || 'Failed to save stage policy and rule.');
      } else {
        setSuccessMsg(`Saved ${editingItem.labTest.testCode} (${editingItem.labTest.testName}) for ${selectedStage}.`);
        setEditingItem(null);
        await loadStageData(selectedStage);
      }
    } catch (err: unknown) {
      setModalError(err instanceof Error ? err.message : 'Network error saving rule.');
    } finally {
      setIsSaving(false);
    }
  };

  const activeTabInfo = STAGE_TABS.find((t) => t.id === selectedStage) || STAGE_TABS[0];

  const getQualitativeOptions = (item: UnifiedStageItem): LabTestOption[] => {
    if (Array.isArray(item.labTest.resultOptions) && item.labTest.resultOptions.length > 0) {
      return item.labTest.resultOptions;
    }
    return [
      { value: 'PASS', label: 'Pass', isPassing: true },
      { value: 'FAIL', label: 'Fail', isPassing: false },
      { value: 'NEGATIVE', label: 'Negative', isPassing: true },
      { value: 'POSITIVE', label: 'Positive', isPassing: false },
      { value: 'NORMAL', label: 'Normal', isPassing: true },
      { value: 'ABNORMAL', label: 'Abnormal', isPassing: false },
    ];
  };

  return (
    <div className="space-y-5">
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 bg-white p-5 rounded-xl border border-slate-200 shadow-xs">
        <div>
          <div className="flex items-center gap-2">
            <Sliders className="w-5 h-5 text-primary" />
            <h1 className="text-lg font-bold text-slate-900">
              Stage test policies
            </h1>
          </div>
        </div>

        {!canEdit && (
          <div className="inline-flex items-center gap-2 px-3 py-1.5 rounded-lg bg-amber-50 border border-amber-200 text-amber-900 text-xs font-semibold">
            <Lock className="w-3.5 h-3.5 text-amber-700" />
            <span>Read-Only View (Super Admin &amp; Data Executive Authorized Only)</span>
          </div>
        )}
      </div>

      <div className="flex flex-wrap gap-2 bg-slate-100 p-1.5 rounded-xl border border-slate-200">
        {visibleTabs.map((tab) => {
          const isSelected = tab.id === selectedStage;
          return (
            <button
              key={tab.id}
              type="button"
              onClick={() => {
                setSelectedStage(tab.id);
                setSuccessMsg(null);
              }}
              className={`px-3.5 py-2 rounded-lg text-xs font-bold transition-all ${
                isSelected
                  ? 'bg-primary text-white shadow-xs'
                  : 'bg-white text-slate-700 hover:bg-slate-50 border border-slate-200/80'
              }`}
            >
              {tab.label}
            </button>
          );
        })}
      </div>

      {error && (
        <div className="p-3.5 bg-rose-50 border border-rose-200 rounded-xl text-rose-800 text-xs font-semibold flex items-center gap-2">
          <ShieldAlert className="w-4 h-4 text-rose-600 shrink-0" />
          <span>{error}</span>
        </div>
      )}

      {successMsg && (
        <div className="p-3.5 bg-emerald-50 border border-emerald-200 rounded-xl text-emerald-900 text-xs font-semibold flex items-center gap-2">
          <CheckCircle2 className="w-4 h-4 text-emerald-600 shrink-0" />
          <span>{successMsg}</span>
        </div>
      )}

      <div className="bg-white rounded-xl border border-slate-200 shadow-xs overflow-hidden">
        <div className="px-4 py-3 bg-slate-50 border-b border-slate-200 flex items-center justify-between">
          <div>
            <span className="text-xs font-bold text-slate-800">{activeTabInfo.label}: </span>
            <span className="text-xs font-medium text-slate-600">{activeTabInfo.subtitle}</span>
          </div>
          <span className="text-xs font-semibold text-slate-500 tabular-nums">
            Active Tests on Form: {items.filter((i) => i.policy?.isActive).length} / {items.length}
          </span>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full text-left text-xs">
            <thead className="bg-slate-100/80 text-slate-700 border-b border-slate-200">
              <tr>
                <th className="p-3 font-bold w-14">Order</th>
                <th className="p-3 font-bold">Test Code &amp; Name</th>
                <th className="p-3 font-bold">Type</th>
                <th className="p-3 font-bold">Show on Form</th>
                <th className="p-3 font-bold">Mandatory</th>
                <th className="p-3 font-bold">Rule Type</th>
                <th className="p-3 font-bold">Passing Limit</th>
                <th className="p-3 font-bold">Warning Offset</th>
                <th className="p-3 font-bold">Photo Req</th>
                {canEdit && <th className="p-3 font-bold text-right">Action</th>}
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-200/70">
              {loading ? (
                <tr>
                  <td colSpan={canEdit ? 10 : 9} className="p-8 text-center text-slate-400 font-semibold">
                    Loading stage test policies and rules…
                  </td>
                </tr>
              ) : items.length === 0 ? (
                <tr>
                  <td colSpan={canEdit ? 10 : 9} className="p-8 text-center text-slate-400 font-semibold">
                    No master lab tests found. Create tests in Lab Test Master first.
                  </td>
                </tr>
              ) : (
                items.map((item) => {
                  const isAssignedAndActive = Boolean(item.policy?.isActive);
                  const isNumeric =
                    item.labTest.resultType === 'NUMERIC' || item.labTest.resultType === 'CALCULATED';
                  const ruleType = item.rule?.ruleCategory === 'MONITORING' ? 'Warning Only' : 'Must Pass';
                  const hasPhotoReq = Boolean(item.policy?.isPhotoRequired ?? item.labTest.isPhotoRequired);

                  let limitDisplay = 'Not Set';
                  if (item.rule) {
                    if (isNumeric) {
                      const minStr = item.rule.minValue !== null ? String(item.rule.minValue) : '-∞';
                      const maxStr = item.rule.maxValue !== null ? String(item.rule.maxValue) : '+∞';
                      const unitStr = item.labTest.unit ? ` ${item.labTest.unit}` : '';
                      limitDisplay = `${minStr} to ${maxStr}${unitStr}`;
                    } else {
                      limitDisplay = item.rule.acceptableOption || 'PASS';
                    }
                  }

                  return (
                    <tr
                      key={item.labTest.id}
                      className={isAssignedAndActive ? 'bg-white hover:bg-slate-50/80' : 'bg-slate-50/40 text-slate-400 hover:bg-slate-50'}
                    >
                      <td className="p-3 font-bold tabular-nums">
                        {isAssignedAndActive ? `#${item.policy?.displayOrder ?? 1}` : '—'}
                      </td>
                      <td className="p-3">
                        <div className="font-bold text-slate-900">{item.labTest.testName}</div>
                        <div className="text-[11px] font-mono text-slate-500">
                          {item.labTest.testCode}
                          {item.labTest.unit ? ` · Unit: ${item.labTest.unit}` : ''}
                        </div>
                      </td>
                      <td className="p-3">
                        <span className="px-2 py-0.5 rounded bg-slate-100 text-slate-700 font-semibold text-[11px]">
                          {isNumeric ? 'NUMERIC' : 'QUALITATIVE'}
                        </span>
                      </td>
                      <td className="p-3">
                        {isAssignedAndActive ? (
                          <span className="inline-flex items-center px-2 py-0.5 rounded-full bg-emerald-100 text-emerald-900 font-bold text-[11px]">
                            Active
                          </span>
                        ) : (
                          <span className="inline-flex items-center px-2 py-0.5 rounded-full bg-slate-200 text-slate-600 font-semibold text-[11px]">
                            Hidden
                          </span>
                        )}
                      </td>
                      <td className="p-3">
                        {isAssignedAndActive ? (
                          item.policy?.isRequired ? (
                            <span className="inline-flex items-center px-2 py-0.5 rounded bg-emerald-50 border border-emerald-200 text-emerald-800 font-bold text-[11px]">
                              Required
                            </span>
                          ) : (
                            <span className="inline-flex items-center px-2 py-0.5 rounded bg-slate-100 text-slate-600 font-semibold text-[11px]">
                              Optional
                            </span>
                          )
                        ) : (
                          <span>—</span>
                        )}
                      </td>
                      <td className="p-3">
                        {item.rule ? (
                          ruleType === 'Must Pass' ? (
                            <span className="inline-flex items-center px-2.5 py-0.5 rounded-md bg-rose-100 border border-rose-300 text-rose-900 font-bold text-[11px]">
                              Must Pass
                            </span>
                          ) : (
                            <span className="inline-flex items-center px-2.5 py-0.5 rounded-md bg-amber-100 border border-amber-300 text-amber-900 font-bold text-[11px]">
                              Warning Only
                            </span>
                          )
                        ) : (
                          <span className="text-slate-400">No Rule</span>
                        )}
                      </td>
                      <td className="p-3 font-bold text-slate-800 tabular-nums">
                        {item.rule ? (
                          isNumeric ? (
                            <span>{limitDisplay}</span>
                          ) : (
                            <span className="px-2 py-0.5 rounded bg-emerald-100 text-emerald-900 font-bold">
                              [ {limitDisplay} ]
                            </span>
                          )
                        ) : (
                          <span className="text-slate-400 font-normal">—</span>
                        )}
                      </td>
                      <td className="p-3 font-mono text-[11px] tabular-nums text-slate-700">
                        {item.rule?.warningOffset !== null && item.rule?.warningOffset !== undefined ? (
                          <span className="px-2 py-0.5 rounded bg-amber-50 border border-amber-200 text-amber-900 font-bold">
                            &plusmn; {item.rule.warningOffset}
                          </span>
                        ) : (
                          <span className="text-slate-400">—</span>
                        )}
                      </td>
                      <td className="p-3">
                        {hasPhotoReq ? (
                          <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-slate-100 border border-slate-200 text-slate-700 font-bold text-[11px]">
                            <Camera className="w-3 h-3 text-slate-600" />
                            <span>Photo Req</span>
                          </span>
                        ) : (
                          <span className="text-slate-400">—</span>
                        )}
                      </td>
                      {canEdit && (
                        <td className="p-3 text-right">
                          <button
                            type="button"
                            onClick={() => openConfigModal(item)}
                            className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-bold transition-colors ${
                              isAssignedAndActive
                                ? 'bg-slate-100 text-slate-800 hover:bg-slate-200 border border-slate-300'
                                : 'bg-primary text-white hover:bg-primary-hover'
                            }`}
                          >
                            {isAssignedAndActive ? (
                              <>
                                <Edit2 className="w-3.5 h-3.5" />
                                <span>Edit Rule</span>
                              </>
                            ) : (
                              <>
                                <Plus className="w-3.5 h-3.5" />
                                <span>Assign &amp; Set Rule</span>
                              </>
                            )}
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
      </div>

      {editingItem && canEdit && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/60 p-4">
          <div className="bg-white rounded-2xl border border-slate-200 shadow-xl max-w-lg w-full overflow-hidden">
            <div className="px-5 py-4 bg-slate-900 text-white flex items-center justify-between">
              <div>
                <h2 className="text-sm font-bold">
                  Rules: {activeTabInfo.label}
                </h2>
                <p className="text-[11px] text-slate-300 mt-0.5">
                  {editingItem.labTest.testCode} · {editingItem.labTest.testName}
                </p>
              </div>
              <button
                type="button"
                onClick={closeConfigModal}
                className="text-slate-300 hover:text-white p-1"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <form onSubmit={handleSave} className="p-5 space-y-4 text-xs">
              {modalError && (
                <div className="p-3 bg-rose-50 border border-rose-200 rounded-lg text-rose-800 font-semibold">
                  {modalError}
                </div>
              )}

              <div className="grid grid-cols-2 gap-3 bg-slate-50 p-3.5 rounded-xl border border-slate-200">
                <div>
                  <label className="block font-bold text-slate-700 mb-1.5">Show on Stage Form</label>
                  <div className="flex gap-2">
                    <button
                      type="button"
                      onClick={() => setFormActive(true)}
                      className={`flex-1 py-1.5 px-2.5 rounded-lg font-bold border ${
                        formActive
                          ? 'bg-emerald-600 text-white border-emerald-600'
                          : 'bg-white text-slate-700 border-slate-300'
                      }`}
                    >
                      Active
                    </button>
                    <button
                      type="button"
                      onClick={() => setFormActive(false)}
                      className={`flex-1 py-1.5 px-2.5 rounded-lg font-bold border ${
                        !formActive
                          ? 'bg-slate-700 text-white border-slate-700'
                          : 'bg-white text-slate-700 border-slate-300'
                      }`}
                    >
                      Hidden
                    </button>
                  </div>
                </div>

                <div>
                  <label className="block font-bold text-slate-700 mb-1.5">Mandatory Entry</label>
                  <div className="flex gap-2">
                    <button
                      type="button"
                      onClick={() => setFormRequired(true)}
                      className={`flex-1 py-1.5 px-2.5 rounded-lg font-bold border ${
                        formRequired
                          ? 'bg-primary text-white border-primary'
                          : 'bg-white text-slate-700 border-slate-300'
                      }`}
                    >
                      Required
                    </button>
                    <button
                      type="button"
                      onClick={() => setFormRequired(false)}
                      className={`flex-1 py-1.5 px-2.5 rounded-lg font-bold border ${
                        !formRequired
                          ? 'bg-slate-700 text-white border-slate-700'
                          : 'bg-white text-slate-700 border-slate-300'
                      }`}
                    >
                      Optional
                    </button>
                  </div>
                </div>

                <div className="col-span-2 pt-1 border-t border-slate-200/80 flex items-center justify-between gap-3">
                  <div>
                    <label className="block font-bold text-slate-700 mb-1">
                      Display Order on Screen
                    </label>
                    <input
                      type="number"
                      min={1}
                      max={999}
                      value={formOrder}
                      onChange={(e) => setFormOrder(Number(e.target.value))}
                      className="w-24 px-3 py-1.5 rounded-lg border border-slate-300 font-bold text-slate-900"
                    />
                  </div>

                  <div className="flex-1 text-right">
                    <label className="block font-bold text-slate-700 mb-1">
                      Photo Evidence Required
                    </label>
                    <button
                      type="button"
                      onClick={() => setFormPhotoRequired((prev) => !prev)}
                      className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg font-bold border transition-colors ${
                        formPhotoRequired
                          ? 'bg-primary text-white border-primary'
                          : 'bg-white text-slate-600 border-slate-300 hover:bg-slate-100'
                      }`}
                    >
                      <Camera className="w-3.5 h-3.5" />
                      <span>{formPhotoRequired ? 'Photo Required' : 'No Photo'}</span>
                    </button>
                  </div>
                </div>
              </div>

              <div className="bg-slate-50 p-3.5 rounded-xl border border-slate-200">
                <label className="block font-bold text-slate-800 mb-2">
                  Rule Type (2-Word Selection)
                </label>
                <div className="grid grid-cols-2 gap-3">
                  <button
                    type="button"
                    onClick={() => setFormRuleCategory('RELEASE')}
                    className={`p-3 rounded-xl border text-left transition-all ${
                      formRuleCategory === 'RELEASE'
                        ? 'bg-rose-600 text-white border-rose-700 shadow-xs'
                        : 'bg-white text-slate-800 border-slate-300 hover:bg-rose-50/40'
                    }`}
                  >
                    <div className="font-extrabold text-sm">Must Pass</div>
                    <div className={`text-[11px] mt-0.5 ${formRuleCategory === 'RELEASE' ? 'text-rose-100' : 'text-slate-500'}`}>
                      Blocks Chemist &amp; Sends to Manager
                    </div>
                  </button>

                  <button
                    type="button"
                    onClick={() => setFormRuleCategory('MONITORING')}
                    className={`p-3 rounded-xl border text-left transition-all ${
                      formRuleCategory === 'MONITORING'
                        ? 'bg-amber-500 text-slate-950 border-amber-600 shadow-xs'
                        : 'bg-white text-slate-800 border-slate-300 hover:bg-amber-50/40'
                    }`}
                  >
                    <div className="font-extrabold text-sm">Warning Only</div>
                    <div className={`text-[11px] mt-0.5 ${formRuleCategory === 'MONITORING' ? 'text-slate-900' : 'text-slate-500'}`}>
                      Shows Yellow Alert (No Block)
                    </div>
                  </button>
                </div>
              </div>

              <div className="bg-slate-50 p-3.5 rounded-xl border border-slate-200">
                {editingItem.labTest.resultType === 'NUMERIC' ||
                editingItem.labTest.resultType === 'CALCULATED' ? (
                  <div className="space-y-3">
                    <div>
                      <label className="block font-bold text-slate-800 mb-2">
                        Passing Numeric Range {editingItem.labTest.unit ? `(${editingItem.labTest.unit})` : ''}
                      </label>
                      <div className="grid grid-cols-2 gap-3">
                        <div>
                          <span className="block text-[11px] font-semibold text-slate-600 mb-1">
                            Minimum Allowable Limit
                          </span>
                          <input
                            type="number"
                            step="any"
                            placeholder="e.g. 27.0"
                            value={formMin}
                            onChange={(e) => setFormMin(e.target.value)}
                            className="w-full px-3 py-2 rounded-lg border border-slate-300 font-bold text-slate-900 bg-white"
                          />
                        </div>
                        <div>
                          <span className="block text-[11px] font-semibold text-slate-600 mb-1">
                            Maximum Allowable Limit
                          </span>
                          <input
                            type="number"
                            step="any"
                            placeholder="e.g. 32.0"
                            value={formMax}
                            onChange={(e) => setFormMax(e.target.value)}
                            className="w-full px-3 py-2 rounded-lg border border-slate-300 font-bold text-slate-900 bg-white"
                          />
                        </div>
                      </div>
                    </div>

                    <div className="pt-2 border-t border-slate-200">
                      <label className="block font-bold text-slate-800 mb-1">
                        Warning Tolerance Offset (&plusmn; Margin)
                      </label>
                      <input
                        type="number"
                        step="any"
                        placeholder="e.g. 0.20"
                        value={formWarningOffset}
                        onChange={(e) => setFormWarningOffset(e.target.value)}
                        className="w-40 px-3 py-2 rounded-lg border border-slate-300 font-bold text-slate-900 bg-white"
                      />
                    </div>
                  </div>
                ) : (
                  <div>
                    <label className="block font-bold text-slate-800 mb-2">
                      Select Acceptable Option Pill (Passing Result)
                    </label>
                    <div className="flex flex-wrap gap-2">
                      {getQualitativeOptions(editingItem).map((opt) => {
                        const selected = formAcceptableOption.toUpperCase() === opt.value.toUpperCase();
                        return (
                          <button
                            key={opt.value}
                            type="button"
                            onClick={() => setFormAcceptableOption(opt.value)}
                            className={`px-3.5 py-2 rounded-lg font-bold border transition-all ${
                              selected
                                ? 'bg-emerald-600 text-white border-emerald-700 shadow-xs'
                                : 'bg-white text-slate-700 border-slate-300 hover:bg-slate-100'
                            }`}
                          >
                            {selected ? 'Check ' : ''}{opt.label} ({opt.value})
                          </button>
                        );
                      })}
                    </div>
                  </div>
                )}
              </div>

              <div className="flex items-center justify-end gap-2 pt-2">
                <button
                  type="button"
                  onClick={closeConfigModal}
                  className="px-4 py-2 rounded-lg border border-slate-300 text-slate-700 font-bold hover:bg-slate-100"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={isSaving}
                  className="px-5 py-2 rounded-lg bg-primary text-white font-bold hover:bg-primary-hover disabled:opacity-50"
                >
                  {isSaving ? 'Saving…' : 'Save Rule & Policy'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
};
