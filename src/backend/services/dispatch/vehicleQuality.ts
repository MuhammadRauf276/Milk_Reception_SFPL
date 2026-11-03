// Whole-vehicle LR / Fat for a dispatch (pure). The server-computed values (from the lab results found by stored LR / Fat
// role) always win; client-sent vehicle LR / Fat are only a fallback when the server has no test values.
export interface VehicleQualityInput {
  serverWeightedLr: number;
  serverWeightedFat: number;
  /** LR / Fat of the only portion, when the vehicle has a single portion. */
  singlePortionLr: number | null;
  singlePortionFat: number | null;
  clientLr: Array<number | null | undefined>;
  clientFat: Array<number | null | undefined>;
}

export function pickVehicleLrFat(i: VehicleQualityInput): { lr: number | null; fat: number | null } {
  const clientLr = i.clientLr.find((v) => typeof v === 'number' && !isNaN(v) && v > 0);
  const clientFat = i.clientFat.find((v) => typeof v === 'number' && !isNaN(v) && v >= 0);
  let lr: number | null = null;
  if (i.serverWeightedLr > 0) lr = i.serverWeightedLr;
  else if (i.singlePortionLr !== null && i.singlePortionLr > 0) lr = i.singlePortionLr;
  else if (clientLr !== undefined) lr = Number(clientLr);
  let fat: number | null = null;
  if (i.serverWeightedFat > 0) fat = i.serverWeightedFat;
  else if (i.singlePortionFat !== null && i.singlePortionFat >= 0) fat = i.singlePortionFat;
  else if (clientFat !== undefined) fat = Number(clientFat);
  return { lr, fat };
}
