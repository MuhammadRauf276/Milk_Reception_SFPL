import { MilkProcessLog, StageDurations } from './types';

function timeToMinutes(timeStr?: string | null): number | null {
  if (!timeStr) return null;
  const parts = timeStr.split(':');
  if (parts.length < 2) return null;
  const hours = parseInt(parts[0], 10);
  const minutes = parseInt(parts[1], 10);
  if (isNaN(hours) || isNaN(minutes)) return null;
  return hours * 60 + minutes;
}

function formatMinutes(mins: number): string {
  if (mins < 0) mins += 1440;
  const h = Math.floor(mins / 60);
  const m = mins % 60;
  if (h > 0) return `${h}h ${m}m`;
  return `${m} mins`;
}

export function calculateStageDurations(log: MilkProcessLog): StageDurations {
  const igp = timeToMinutes(log.igp_time);
  const sampStart = timeToMinutes(log.sampling_time_start);
  const sampEnd = timeToMinutes(log.sampling_time_end);
  const weight1 = timeToMinutes(log.first_weight_time);
  const recepStart = timeToMinutes(log.reception_start_time);
  const recepEnd = timeToMinutes(log.reception_end_time);
  const gateOut = timeToMinutes(log.out_from_gate_time);

  const durations: StageDurations = {};

  if (igp !== null && sampStart !== null) {
    durations.waitingForSampling = formatMinutes(sampStart - igp);
  }

  if (sampStart !== null && sampEnd !== null) {
    durations.samplingDuration = formatMinutes(sampEnd - sampStart);
  }

  if (sampEnd !== null && weight1 !== null) {
    durations.waitingForFirstWeight = formatMinutes(weight1 - sampEnd);
  }

  if (weight1 !== null && recepStart !== null) {
    durations.waitingForReception = formatMinutes(recepStart - weight1);
  }

  if (recepStart !== null && recepEnd !== null) {
    durations.unloadingDuration = formatMinutes(recepEnd - recepStart);
  }

  if (igp !== null && gateOut !== null) {
    durations.totalGateToGateTime = formatMinutes(gateOut - igp);
  }

  return durations;
}

export interface LiveWaitStatus {
  label: string;
  minutes: number;
  displayText: string;
  isBottleneck: boolean;
}

export function getLiveWaitStatus(log: MilkProcessLog, now: Date = new Date()): LiveWaitStatus {
  const nowMinutes = now.getHours() * 60 + now.getMinutes();

  let startMinutes: number | null = null;
  let label = "Stage Duration";

  switch (log.status) {
    case 'Dispatched':
      startMinutes = timeToMinutes(log.zonal_contractor_dispatch_time);
      label = "En-Route";
      break;

    case 'Token Issued':
      startMinutes = timeToMinutes(log.igp_time);
      label = "Waiting in Queue";
      break;

    case 'Sampling':
      startMinutes = timeToMinutes(log.sampling_time_start) || timeToMinutes(log.igp_time);
      label = "Testing in Lab";
      break;

    case 'First Weight':
      startMinutes = timeToMinutes(log.sampling_time_end) || timeToMinutes(log.first_weight_time);
      label = "At Weighbridge";
      break;

    case 'Silo Reception':
      startMinutes = timeToMinutes(log.first_weight_time) || timeToMinutes(log.reception_start_time);
      label = "Unloading at Silo";
      break;

    default:
      startMinutes = null;
      label = "Completed";
      break;
  }

  if (startMinutes === null) {
    const startTime = new Date(log.updated_at || log.created_at).getTime();
    const diffMs = now.getTime() - startTime;
    const mins = Math.max(1, Math.floor(diffMs / 60000));
    return {
      label,
      minutes: mins,
      displayText: `${label}: ${formatMinutes(mins)}`,
      isBottleneck: mins > 30
    };
  }

  let mins = nowMinutes - startMinutes;
  if (mins < 0) mins += 1440;

  return {
    label,
    minutes: mins,
    displayText: `${label}: ${formatMinutes(mins)}`,
    isBottleneck: mins > 30
  };
}
