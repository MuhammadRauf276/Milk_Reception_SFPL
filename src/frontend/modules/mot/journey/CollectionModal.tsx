'use client';

import React from 'react';
import type { User } from '@core/types';
import { Modal } from '@/components/ui/modal';
import { getRoleLabel } from '@/backend/core/roles/labels';
import { ShopCollectionWizard } from '../ShopCollectionWizard';
import type { useCollection } from './useCollection';
import type { CurrentJourney } from './types';

interface Props {
  collection: ReturnType<typeof useCollection>;
  currentUser: User;
  journey: CurrentJourney | null;
  isCovering: boolean;
  gpsBadge: React.ReactNode;
}

/** The collection wizard in a modal (kept as a modal: it is the main data-entry flow). */
export function CollectionModal({ collection: c, currentUser, journey, isCovering, gpsBadge }: Props) {
  const {
    activeStop, setActiveStop, shopRmrNumber, setShopRmrNumber, availableSources, selectedSourceId, setSelectedSourceId,
    quantity, setQuantity, unit, setUnit, lr, setLr, fat, setFat, notes, setNotes, shopPolicy, testValues, setTestValues,
    testPhotos, personDecision, setPersonDecision, decisionRemarks, setDecisionRemarks, collectionGps, formError,
    submittingCollection, livePreview, decisionPreview, decisionRows, handlePhotoTaken, handlePhotoRemoved,
    handleSaveDraft, handleRecordCollection,
  } = c;
  if (!activeStop) return null;

  return (
    <Modal
      onClose={() => setActiveStop(null)}
      title="Collection stop"
      preventClose={submittingCollection}
      className="max-w-lg overflow-hidden"
    >
              <ShopCollectionWizard
                key={activeStop.id}
                shopLabel={`${activeStop.shop_name || activeStop.shop?.shop_name || 'Shop'} (${activeStop.shop_code || activeStop.shop?.shop_code || ''})`}
                sequence={activeStop.planned_sequence}
                gpsStatus={collectionGps.status}
                gpsAccuracy={collectionGps.accuracy}
                gpsBadge={gpsBadge}
                formError={formError}
                rmrNumber={shopRmrNumber}
                onRmrNumberChange={setShopRmrNumber}
                sources={availableSources}
                selectedSourceId={selectedSourceId}
                onSourceChange={setSelectedSourceId}
                quantity={quantity}
                onQuantityChange={setQuantity}
                unit={unit}
                onUnitChange={setUnit}
                tests={{
                  policy: shopPolicy,
                  lr,
                  fat,
                  onLrChange: setLr,
                  onFatChange: setFat,
                  values: testValues,
                  onValueChange: (labTestId, patch) =>
                    setTestValues((prev) => ({
                      ...prev,
                      [labTestId]: { ...(prev[labTestId] ?? { value: '', text: '' }), ...patch },
                    })),
                  photos: testPhotos,
                  onPhotoTaken: (test, result) => void handlePhotoTaken(test, result),
                  onPhotoRemoved: handlePhotoRemoved,
                  stamp: {
                    employeeCode: currentUser.username,
                    roleLabel: getRoleLabel(currentUser.role),
                    actingAsLabel: isCovering ? getRoleLabel('MOT') : null,
                    vehicleNo: journey?.mot_vehicle?.vehicle_number || null,
                    tokenNo: shopRmrNumber || null,
                  },
                  disabled: submittingCollection,
                }}
                livePreview={livePreview}
                notes={notes}
                onNotesChange={setNotes}
                decision={{
                  tests: decisionRows,
                  decision: decisionPreview?.decision ?? null,
                  personDecision,
                  onPersonDecisionChange: setPersonDecision,
                  remarks: decisionRemarks,
                  onRemarksChange: setDecisionRemarks,
                  warnings: decisionPreview?.details.warnings ?? [],
                  approverLabel: 'Zonal Manager',
                  routeLabels: {
                    PROCEED: 'Submit & complete shop',
                    REJECT: 'Reject & complete shop',
                    SEND_TO_APPROVER: 'Send request to Zonal Manager',
                    DECIDE_NOW: 'Decide now',
                  },
                  onSubmit: () => void handleRecordCollection(),
                  submitting: submittingCollection,
                }}
                onSaveDraft={handleSaveDraft}
                onClose={() => setActiveStop(null)}
              />
    </Modal>
  );
}
