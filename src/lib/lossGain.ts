/**
 * Loss and gain, one rule for the whole app.
 *
 * Signed difference = received minus sent (later stage minus earlier stage).
 * Negative is a loss, positive is a gain, zero is even.
 * A total over many records is the NET of the signed differences (gains offset losses).
 * Percent = net signed difference / total sent x 100, never an average of row percentages.
 */

/** Differences smaller than this (in litres) are shown as Even. */
const EVEN_LIMIT = 0.005;

export type LossGainKind = 'loss' | 'gain' | 'even';

/** Heading for any column or card that shows a signed difference. */
export const LOSS_GAIN_HEADING = 'Loss / Gain';
/** Excel and CSV column heading for the signed number, so totals add up. */
export const LOSS_GAIN_EXPORT_HEADER = 'Gain (+) / Loss (-) L';
export const LOSS_GAIN_EXPORT_PERCENT_HEADER = 'Gain (+) / Loss (-) %';

const round2 = (n: number) => Number(n.toFixed(2));

/** Received minus sent. Returns null when either side is missing. */
export function signedDifference(sent: number | null | undefined, received: number | null | undefined): number | null {
  if (sent == null || received == null || !Number.isFinite(sent) || !Number.isFinite(received)) return null;
  return round2(received - sent);
}

/** Net signed difference as a percent of the total sent. Zero when nothing was sent. */
export function signedPercent(netSigned: number | null | undefined, totalSent: number | null | undefined): number | null {
  if (netSigned == null || totalSent == null || !(totalSent > 0)) return null;
  return Number(((netSigned / totalSent) * 100).toFixed(4));
}

export function lossGainKind(signed: number | null | undefined, limit = EVEN_LIMIT): LossGainKind | null {
  if (signed == null || !Number.isFinite(signed)) return null;
  if (signed < -limit) return 'loss';
  if (signed > limit) return 'gain';
  return 'even';
}

const grouped = (n: number, digits: number) =>
  n.toLocaleString('en-US', { minimumFractionDigits: 0, maximumFractionDigits: digits });

/** "Loss 120 L", "Gain 35 L" or "Even". Empty string when there is no figure. */
export function formatLossGain(signed: number | null | undefined, unit = ' L', digits = 2): string {
  const kind = lossGainKind(signed);
  if (kind === null || signed == null) return '';
  if (kind === 'even') return 'Even';
  return `${kind === 'loss' ? 'Loss' : 'Gain'} ${grouped(Math.abs(signed), digits)}${unit}`;
}

/** Same as formatLossGain for a percent: "Loss 0.42%". */
export function formatLossGainPercent(signedPct: number | null | undefined, digits = 2): string {
  const kind = lossGainKind(signedPct, 0.00005);
  if (kind === null || signedPct == null) return '';
  const text = Math.abs(signedPct).toFixed(digits);
  if (kind === 'even' || Number(text) === 0) return 'Even';
  return `${kind === 'loss' ? 'Loss' : 'Gain'} ${text}%`;
}

/** Tailwind text colour: red for loss, green for gain, grey for even or unknown. */
export function lossGainClass(signed: number | null | undefined): string {
  const kind = lossGainKind(signed);
  if (kind === 'loss') return 'text-rose-700';
  if (kind === 'gain') return 'text-emerald-700';
  return 'text-muted-foreground';
}

/** The signed number for Excel or CSV (negative = loss), rounded to 2 decimals. Null stays empty. */
export function lossGainExportValue(signed: number | null | undefined): number | null {
  return signed == null || !Number.isFinite(signed) ? null : round2(signed);
}

export interface LossGainTotals {
  sent: number;
  received: number;
  /** Net of all signed differences: received minus sent. */
  net: number;
  grossLoss: number;
  grossGain: number;
  /** Net / sent x 100. Null when nothing was sent. */
  netPercent: number | null;
  records: number;
}

/**
 * Totals over many records. Each record is checked on its own so gross loss and gross gain are known,
 * but the headline is the net, never a sum of a loss-only field.
 */
export function totalLossGain(records: Array<{ sent: number | null | undefined; received: number | null | undefined }>): LossGainTotals {
  let sent = 0;
  let received = 0;
  let grossLoss = 0;
  let grossGain = 0;
  let count = 0;
  for (const r of records) {
    const diff = signedDifference(r.sent, r.received);
    if (diff === null) continue;
    count += 1;
    sent += Number(r.sent);
    received += Number(r.received);
    if (diff < 0) grossLoss += -diff;
    else grossGain += diff;
  }
  const net = round2(received - sent);
  return {
    sent: round2(sent),
    received: round2(received),
    net,
    grossLoss: round2(grossLoss),
    grossGain: round2(grossGain),
    netPercent: signedPercent(net, sent),
    records: count,
  };
}

// ---------------------------------------------------------------------------------------------------------
// Level figures. Sums are kept in whole hundredths of a litre, so a net always equals the sum of its parts
// exactly (no floating-point drift): Whole = MOT + Transit holds to the last digit.
// ---------------------------------------------------------------------------------------------------------

export const toCents = (n: number | null | undefined): number =>
  n == null || !Number.isFinite(n) ? 0 : Math.round(n * 100);
export const fromCents = (c: number): number => c / 100;

/** One stage pair, received minus sent. Percent is the net over what was sent (null when nothing was sent). */
export interface LossPair {
  sent: number;
  received: number;
  /** Net signed difference: received minus sent (negative = loss). */
  signed: number;
  percent: number | null;
  /** Each record's own loss added up (positive number), beside the net. */
  lossSum: number;
  /** Each record's own gain added up. */
  gainSum: number;
}

/** @13 TS is the main figure; gross sits beside it. */
export interface LossFigure {
  at13ts: LossPair;
  gross: LossPair;
  records: number;
  /** Records where an @13 TS figure is missing on either side. Gross is never substituted for it. */
  missing13ts: number;
}

export interface PairTotals {
  sent: number;
  received: number;
  loss: number;
  gain: number;
}

export function emptyPairTotals(): PairTotals {
  return { sent: 0, received: 0, loss: 0, gain: 0 };
}

/** Adds one record (in litres) to running totals kept in hundredths. */
export function addToPairTotals(t: PairTotals, sent: number | null | undefined, received: number | null | undefined): void {
  const s = toCents(sent);
  const r = toCents(received);
  t.sent += s;
  t.received += r;
  const d = r - s;
  if (d < 0) t.loss += -d;
  else t.gain += d;
}

/** Adds a whole pre-summed group (hundredths already) so a parent can be built from its children. */
export function mergePairTotals(into: PairTotals, from: PairTotals): void {
  into.sent += from.sent;
  into.received += from.received;
  into.loss += from.loss;
  into.gain += from.gain;
}

export function pairFromTotals(t: PairTotals): LossPair {
  const signedC = t.received - t.sent;
  const sent = fromCents(t.sent);
  const signed = fromCents(signedC);
  return {
    sent,
    received: fromCents(t.received),
    signed,
    percent: signedPercent(signed, sent),
    lossSum: fromCents(t.loss),
    gainSum: fromCents(t.gain),
  };
}

/** A pair built from a sent amount and a signed net (received = sent + signed), both in hundredths. */
export function pairFromSigned(sentCents: number, signedCents: number, lossCents = 0, gainCents = 0): LossPair {
  const sent = fromCents(sentCents);
  const signed = fromCents(signedCents);
  return {
    sent,
    received: fromCents(sentCents + signedCents),
    signed,
    percent: signedPercent(signed, sent),
    lossSum: fromCents(lossCents),
    gainSum: fromCents(gainCents),
  };
}

export interface FigureTotals {
  at13ts: PairTotals;
  gross: PairTotals;
  records: number;
  missing13ts: number;
}

export function emptyFigureTotals(): FigureTotals {
  return { at13ts: emptyPairTotals(), gross: emptyPairTotals(), records: 0, missing13ts: 0 };
}

/** One record: gross both sides, and @13 TS both sides (null = not recorded: counted missing, never taken from gross). */
export function addToFigureTotals(
  f: FigureTotals,
  rec: { sentGross: number | null | undefined; receivedGross: number | null | undefined; sent13ts: number | null | undefined; received13ts: number | null | undefined },
): void {
  addToPairTotals(f.gross, rec.sentGross, rec.receivedGross);
  addToPairTotals(f.at13ts, rec.sent13ts, rec.received13ts);
  f.records += 1;
  if (rec.sent13ts == null || rec.received13ts == null) f.missing13ts += 1;
}

export function mergeFigureTotals(into: FigureTotals, from: FigureTotals): void {
  mergePairTotals(into.gross, from.gross);
  mergePairTotals(into.at13ts, from.at13ts);
  into.records += from.records;
  into.missing13ts += from.missing13ts;
}

export function figureFromTotals(f: FigureTotals): LossFigure {
  return { at13ts: pairFromTotals(f.at13ts), gross: pairFromTotals(f.gross), records: f.records, missing13ts: f.missing13ts };
}
