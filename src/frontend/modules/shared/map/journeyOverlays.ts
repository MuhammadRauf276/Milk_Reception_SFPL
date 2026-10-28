import {
  computeDwells,
  haversineM,
  toMs,
  type LiveMapMarker,
  type LiveMapPin,
  type LiveMapRoute,
  type LiveMapRoutePoint,
} from './mapTypes';

/** The parts of GET /api/zmcc/mot/journeys/:id/map that the map overlays need. */
export interface JourneyOverlayData {
  journey: {
    id: string;
    journey_number: string;
    status: string;
    started_at: string;
    ended_at?: string | null;
    zmcc: { name: string } | null;
    start_point: { latitude: number; longitude: number };
  };
  stops: Array<{
    id: string;
    planned_sequence: number;
    status: string;
    shop_name: string;
    shop_code: string;
    owner_name: string;
    planned_latitude: number | null;
    planned_longitude: number | null;
    collection: {
      gross_liters: number;
      lr: number;
      fat: number;
      collection_latitude?: number | null;
      collection_longitude?: number | null;
      device_collected_at?: string | null;
      milk_source_name_snapshot?: string | null;
      entered_by?: string | null;
    } | null;
  }>;
  gps_trail: Array<{
    latitude: number;
    longitude: number;
    device_recorded_at: string;
    source_type?: string;
  }>;
}

const hhmm = (v: string | number | Date | null | undefined) => {
  const t = toMs(v);
  return t === null ? '' : new Date(t).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
};

type Stop = JourneyOverlayData['stops'][number];
/** Shop position: planned coordinates, else where the form was entered. */
function stopPoint(s: Stop): LiveMapRoutePoint | null {
  if (s.planned_latitude != null && s.planned_longitude != null) {
    return { latitude: s.planned_latitude, longitude: s.planned_longitude };
  }
  const c = s.collection;
  if (c && c.collection_latitude != null && c.collection_longitude != null) {
    return { latitude: c.collection_latitude, longitude: c.collection_longitude };
  }
  return null;
}

export const JOURNEY_COLORS = ['#2563eb', '#db2777', '#ea580c', '#0d9488', '#7c3aed', '#ca8a04'];

/** Planned route (dashed), travelled trail, ZMCC / form / dwell / end markers and numbered stop pins for one journey. */
export function buildJourneyOverlays(data: JourneyOverlayData, color: string) {
  const { journey, stops, gps_trail } = data;
  const group = journey.id;
  const active = !['COMPLETED', 'CANCELLED', 'CLOSED'].includes(journey.status);
  const origin = { latitude: journey.start_point.latitude, longitude: journey.start_point.longitude };

  const trail: LiveMapRoutePoint[] = [...gps_trail]
    .sort((a, b) => Date.parse(a.device_recorded_at) - Date.parse(b.device_recorded_at))
    .map((g) => ({ latitude: g.latitude, longitude: g.longitude, recordedAt: g.device_recorded_at }));

  const ordered = [...stops].sort((a, b) => a.planned_sequence - b.planned_sequence);
  const planned: LiveMapRoutePoint[] = [origin];
  for (const s of ordered) {
    const at = stopPoint(s);
    if (at) planned.push(at);
  }
  planned.push(origin);

  const routes: LiveMapRoute[] = [];
  if (planned.length > 2) routes.push({ id: 'plan-' + group, points: planned, color, planned: true, group });
  if (trail.length > 0) routes.push({ id: 'trail-' + group, points: trail, color, group });

  const markers: LiveMapMarker[] = [
    {
      id: 'zmcc-' + group,
      kind: 'zmcc',
      latitude: origin.latitude,
      longitude: origin.longitude,
      label: journey.zmcc?.name ?? 'ZMCC',
      lines: [
        'Start: ' + hhmm(journey.started_at),
        ...(journey.ended_at ? ['End: ' + hhmm(journey.ended_at)] : []),
      ],
      group,
    },
  ];

  for (const s of ordered) {
    const c = s.collection;
    if (!c || c.collection_latitude == null || c.collection_longitude == null) continue;
    markers.push({
      id: 'form-' + s.id,
      kind: 'form',
      latitude: c.collection_latitude,
      longitude: c.collection_longitude,
      label: s.shop_name,
      lines: [
        `Litres: ${c.gross_liters}`,
        `LR ${c.lr} / Fat ${c.fat}%`,
        ...(c.milk_source_name_snapshot ? ['Source: ' + c.milk_source_name_snapshot] : []),
        ...(c.device_collected_at ? ['Time: ' + hhmm(c.device_collected_at)] : []),
        ...(c.entered_by ? ['By: ' + c.entered_by] : []),
      ],
      group,
    });
  }

  computeDwells(trail).forEach((d, i) => {
    if (haversineM(d, origin) < 100) return; // time at the ZMCC itself is not a stop
    const mins = Math.round(d.durationMs / 60_000);
    markers.push({
      id: `dwell-${group}-${i}`,
      kind: 'dwell',
      latitude: d.latitude,
      longitude: d.longitude,
      label: `${mins} min stop`,
      lines: [`${hhmm(d.startMs)} - ${hhmm(d.startMs + d.durationMs)}`],
      group,
    });
  });

  const last = trail[trail.length - 1];
  if (!active && last && haversineM(last, origin) > 150) {
    markers.push({
      id: 'end-' + group,
      kind: 'end',
      latitude: last.latitude,
      longitude: last.longitude,
      label: 'End',
      lines: [hhmm(last.recordedAt)],
      group,
    });
  }

  const pins: LiveMapPin[] = ordered
    .filter((s) => stopPoint(s) !== null)
    .map((s) => ({
      id: s.id,
      label: s.shop_name,
      latitude: (stopPoint(s) as LiveMapRoutePoint).latitude,
      longitude: (stopPoint(s) as LiveMapRoutePoint).longitude,
      sequence: s.planned_sequence,
      status:
        s.status === 'VISITED'
          ? 'visited'
          : s.status === 'REJECTED'
            ? 'rejected'
            : active && s.status !== 'SKIPPED'
              ? 'pending'
              : 'notVisited',
      detail: s.collection ? s.collection.gross_liters + ' L' : s.owner_name,
      group,
    }));

  return { routes, markers, pins, trail };
}
