import type { PendingPhotoMeta } from '@/frontend/modules/pwa/syncQueueCore';
import type { MotShopPolicySnapshot } from '@/types/stage1-decision';
import type { MotTestPhoto, MotTestValue } from '../MotShopTestsStep';
import { decisionWord, type CurrentJourney, type StopDetail } from './types';
import type { CompletedReceipt } from './useCollection';

export type TestResultPayload = { lab_test_id: string; value?: number | null; text_value?: string | null };

/** Test readings to send: LR and Fat from the main fields, the rest from the entered values. */
export function buildTestResults(
  policy: MotShopPolicySnapshot | null,
  testValues: Record<string, MotTestValue>,
  lrNum: number,
  fatNum: number
): TestResultPayload[] {
  const testResults: TestResultPayload[] = [];
  for (const t of policy?.tests ?? []) {
    if (t.testMode === 'OFF') continue;
    if (t.isLr) testResults.push({ lab_test_id: t.labTestId, value: lrNum });
    else if (t.isFat) testResults.push({ lab_test_id: t.labTestId, value: fatNum });
    else {
      const v = testValues[t.labTestId];
      if (!v) continue;
      const num = v.value.trim() !== '' && Number.isFinite(Number(v.value)) ? Number(v.value) : null;
      const text = v.text.trim() || null;
      if (num !== null || text !== null) testResults.push({ lab_test_id: t.labTestId, value: num, text_value: text });
    }
  }
  return testResults;
}

export function buildPhotoMeta(
  photoEntries: Array<[string, MotTestPhoto]>,
  policyVersion: number | null,
  requestedAs: string | null
): Array<{ captureId: string; meta: PendingPhotoMeta }> {
  return photoEntries.map(([labTestId, p]) => ({
    captureId: p.captureId,
    meta: {
      captureId: p.captureId,
      sha256: p.sha256,
      testingPoint: 'MOT_SHOP',
      entityType: 'mot_shop_collection',
      entityId: null,
      labTestId,
      photoKind: 'TEST_RESULT',
      deviceCapturedAt: p.capturedAt,
      latitude: p.gps?.lat ?? null,
      longitude: p.gps?.lng ?? null,
      gpsAccuracyM: p.gps?.accuracyM ?? null,
      wasOffline: typeof navigator !== 'undefined' ? !navigator.onLine : false,
      width: p.width,
      height: p.height,
      policyVersion,
      requestedAs,
    },
  })) as Array<{ captureId: string; meta: PendingPhotoMeta }>;
}

/** WhatsApp receipt for an accepted collection. */
export function buildReceipt(args: {
  stop: StopDetail;
  journey: CurrentJourney;
  preview: { grossLiters: number; at13TsLiters: number; snf: number; totalSolids: number };
  lr: number;
  fat: number;
  finalDecision: string;
}): CompletedReceipt {
  const { stop, journey, preview, lr, fat, finalDecision } = args;
  const shopDisplayName = stop.shop_name || stop.shop?.shop_name || 'Shop';
  const rawPhone = stop.phone_number || stop.shop?.contact_number || '';
  const digits = rawPhone.replace(/\D/g, '');
  const intlPhone = digits
    ? digits.startsWith('92')
      ? digits
      : digits.startsWith('0')
        ? `92${digits.slice(1)}`
        : `92${digits}`
    : '';

  const receiptMsg = `*SFPL Milk Collection Receipt*\nShop: ${shopDisplayName}\nJourney: #${journey.journey_number}\nVehicle: ${journey.mot_vehicle?.vehicle_number || 'SFPL-MOT'}\nGross: ${preview.grossLiters.toFixed(2)} L\nLR: ${lr.toFixed(1)} | Fat: ${fat.toFixed(1)}%\nSNF: ${preview.snf.toFixed(2)}% | Total Solids: ${preview.totalSolids.toFixed(2)}%\n@13TS: ${preview.at13TsLiters.toFixed(2)} L\nStatus: ${decisionWord(finalDecision)}\nTime: ${new Date().toLocaleTimeString()} PKT`;

  return {
    shopName: shopDisplayName,
    phone: rawPhone,
    whatsappUrl: intlPhone ? `https://wa.me/${intlPhone}?text=${encodeURIComponent(receiptMsg)}` : '',
    grossLiters: preview.grossLiters,
    at13tsLiters: preview.at13TsLiters,
    lr,
    fat,
  };
}
