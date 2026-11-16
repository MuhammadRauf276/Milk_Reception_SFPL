import test from 'node:test';
import assert from 'node:assert/strict';
import {
  formatLossGain,
  formatLossGainPercent,
  lossGainClass,
  lossGainExportValue,
  lossGainKind,
  signedDifference,
  signedPercent,
  totalLossGain,
  LOSS_GAIN_EXPORT_HEADER,
} from '@/lib/lossGain';
import {
  calculateTier1RouteLoss,
  calculateTier2ZmccLoss,
  calculateTier3TransitLoss,
  calculateTier4TotalLoss,
} from '@/backend/services/lossCalculationService';
import { calculateLossGain, summarizeLossGain } from '@/backend/services/reconciliationService';

test('formatter: negative is Loss, positive is Gain, zero is Even', () => {
  assert.equal(formatLossGain(-120), 'Loss 120 L');
  assert.equal(formatLossGain(35), 'Gain 35 L');
  assert.equal(formatLossGain(0), 'Even');
  assert.equal(formatLossGain(-0.001), 'Even');
  assert.equal(formatLossGain(-1234.5), 'Loss 1,234.5 L');
  assert.equal(formatLossGain(null), '');
  assert.equal(formatLossGainPercent(-0.42), 'Loss 0.42%');
  assert.equal(formatLossGainPercent(1.5), 'Gain 1.50%');
  assert.equal(formatLossGainPercent(0), 'Even');
  assert.equal(formatLossGainPercent(0.0001), 'Even');
  assert.equal(lossGainKind(-5), 'loss');
  assert.equal(lossGainKind(5), 'gain');
  assert.equal(lossGainKind(0), 'even');
});

test('formatter colours: red for loss, green for gain, grey for even', () => {
  assert.match(lossGainClass(-1), /rose/);
  assert.match(lossGainClass(1), /emerald/);
  assert.match(lossGainClass(0), /muted/);
  assert.match(lossGainClass(null), /muted/);
});

test('export value is the signed number and the heading says Gain (+) / Loss (-)', () => {
  assert.equal(LOSS_GAIN_EXPORT_HEADER, 'Gain (+) / Loss (-) L');
  assert.equal(lossGainExportValue(-120.456), -120.46);
  assert.equal(lossGainExportValue(35), 35);
  assert.equal(lossGainExportValue(null), null);
});

test('signed difference is received minus sent', () => {
  assert.equal(signedDifference(1000, 880), -120);
  assert.equal(signedDifference(1000, 1035), 35);
  assert.equal(signedDifference(null, 5), null);
});

test('a group with one loss and one gain nets: gains offset losses', () => {
  const t = totalLossGain([
    { sent: 1000, received: 880 }, // loss 120
    { sent: 500, received: 535 }, // gain 35
  ]);
  assert.equal(t.net, -85);
  assert.equal(t.grossLoss, 120);
  assert.equal(t.grossGain, 35);
  assert.equal(t.sent, 1500);
  assert.equal(t.received, 1415);
  assert.equal(formatLossGain(t.net), 'Loss 85 L');
});

test('percent is net over total sent, never an average of row percentages', () => {
  const t = totalLossGain([
    { sent: 1000, received: 880 }, // -12%
    { sent: 500, received: 535 }, // +7%
  ]);
  // average of row percents would be -2.5; the right figure is -85 / 1500
  assert.equal(t.netPercent, Number(((-85 / 1500) * 100).toFixed(4)));
  assert.notEqual(t.netPercent, -2.5);
  assert.equal(signedPercent(-85, 1500), -5.6667);
  assert.equal(signedPercent(10, 0), null);
});

test('route aggregate: a gain is kept, not clamped to zero', () => {
  const r = calculateTier1RouteLoss({ shopGrossLiters: 1000, zmccArrivalGrossLiters: 1040, shopAt13tsLiters: 900, zmccArrivalAt13tsLiters: 930 });
  assert.equal(r.signedVarianceLiters, 40);
  assert.equal(r.gainLiters, 40);
  assert.equal(r.lossLiters, 0);
  assert.equal(r.signedVariancePercent, 4);
  assert.equal(r.signedVarianceAt13tsLiters, 30);
  assert.equal(r.signedVarianceAt13tsPercent, Number(((30 / 900) * 100).toFixed(4)));
});

test('transit aggregate: loss is negative, percent is net over dispatched, alert is loss only', () => {
  const loss = calculateTier3TransitLoss({ dispatchedGrossLiters: 10000, plantAcceptedGrossLiters: 9850, dispatchedAt13tsLiters: 9000, plantAcceptedAt13tsLiters: 8900 });
  assert.equal(loss.signedVarianceLiters, -150);
  assert.equal(loss.signedVariancePercent, -1.5);
  assert.equal(loss.isHighLoss, true);
  const gain = calculateTier3TransitLoss({ dispatchedGrossLiters: 10000, plantAcceptedGrossLiters: 10200 });
  assert.equal(gain.signedVarianceLiters, 200);
  assert.equal(gain.isHighLoss, false); // a gain never triggers the high loss alert
});

test('total over three tiers is the net: a gain in one tier offsets a loss in another', () => {
  const t1 = calculateTier1RouteLoss({ shopGrossLiters: 1000, zmccArrivalGrossLiters: 950, shopAt13tsLiters: 900, zmccArrivalAt13tsLiters: 860 }); // -50, -40
  const t2 = calculateTier2ZmccLoss({
    motInwardGrossLiters: 950, localInwardGrossLiters: 0, dispatchedGrossLiters: 940, startingTankStockLiters: 0, endingTankStockLiters: 10,
    motInwardAt13tsLiters: 860, dispatchedAt13tsLiters: 850, startingTankStockAt13tsLiters: 0, endingTankStockAt13tsLiters: 10,
  }); // accounted 950 vs inward 950 -> even
  const t3 = calculateTier3TransitLoss({ dispatchedGrossLiters: 940, plantAcceptedGrossLiters: 1000, dispatchedAt13tsLiters: 850, plantAcceptedAt13tsLiters: 900 }); // +60, +50
  const t4 = calculateTier4TotalLoss(t1, t2, t3);
  assert.equal(t4.signedVarianceLiters, 10);
  assert.equal(t4.gainLiters, 10);
  assert.equal(t4.lossLiters, 0);
  assert.equal(t4.signedVarianceAt13tsLiters, 10);
  assert.ok(t4.signedVariancePercent > 0);
});

test('reconciliation: calculateLossGain is signed and summaries net gain minus loss', () => {
  const loss = calculateLossGain(1000, 900);
  const gain = calculateLossGain(1000, 1020);
  assert.equal(loss.signedVariance, -100);
  assert.equal(loss.signedPercent, -10);
  assert.equal(gain.signedVariance, 20);
  assert.equal(gain.signedPercent, 2);
  const total = summarizeLossGain([
    { gross: loss, at13ts: loss },
    { gross: gain, at13ts: gain },
  ]);
  assert.equal(total.grossLoss, 100);
  assert.equal(total.grossGain, 20);
  assert.equal(total.grossNet, -80);
  assert.equal(total.at13tsNet, -80);
});
