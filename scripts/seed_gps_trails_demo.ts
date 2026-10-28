/**
 * Idempotent GPS trail demo seed for the MOT maps (DEVELOPMENT ONLY).
 *
 * 1. Every finished MotJourney gets a road-following trail: ZMCC -> shop 1 -> shop 2 -> ... -> back to the ZMCC.
 *    Road geometry comes from the public OSRM demo server at generation time (falls back to interpolated points with
 *    road-like jitter, with a warning). One GPS point every ~100-200 m, 5-12 min dwell (speed 0) at each shop, one journey
 *    gets a signal gap followed by was_offline points.
 *    Earlier demo trails (idempotency_key "DEMO-GPS-<journeyId>-<n>") are DELETED and rebuilt on every run.
 *    Journeys that have real MOT_DEVICE points are left alone.
 * 2. Each ZMCC has ONE exact location (constants below); the journey start/assignment point and ASSIGNING_USER point
 *    are set to it.
 * 3. Each existing MotShopCollection is placed at its shop's exact coordinates, with device_collected_at inside the time
 *    the trail dwells there (stop arrived_at / completed_at follow the same dwell).
 * 4. Two ACTIVE journeys (journey_number "DEMO-GPS-LIVE-A/B") for free Hasilpur vehicles: A = live (last fix 2 min ago),
 *    B = stale (last fix 38 min ago, parked at shop 1). Re-running refreshes their timestamps relative to "now".
 *
 * scripts/reset_demo_operational_data.ts wipes journeys, stops and locations (including these).
 *
 * Run:  ALLOW_DEMO_RESET=true npx tsx scripts/seed_gps_trails_demo.ts
 *       (PowerShell:  $env:ALLOW_DEMO_RESET='true'; npx tsx scripts/seed_gps_trails_demo.ts)
 * Needs internet for OSRM (https://router.project-osrm.org); works without it using the fallback.
 */
import 'dotenv/config';
import { prisma } from '../src/backend/core/db';

type LatLng = { lat: number; lng: number };

/** Exact ZMCC / chilling-centre locations (town centres). Keyed by a fragment of the procurement source code. */
const ZMCC_HASILPUR: LatLng = { lat: 29.6974, lng: 72.5539 };
const ZMCC_JHANG: LatLng = { lat: 31.2698, lng: 72.3169 };
const ZMCC_KABIRWALA: LatLng = { lat: 30.4042, lng: 71.8647 };
const ZMCC_BY_CODE: Array<[string, LatLng]> = [
  ['HASILPUR', ZMCC_HASILPUR],
  ['JHANG', ZMCC_JHANG],
  ['KABIRWALA', ZMCC_KABIRWALA],
];
const zmccLocation = (code: string | null | undefined, fallback: LatLng): LatLng => {
  const up = (code ?? '').toUpperCase();
  return ZMCC_BY_CODE.find(([k]) => up.includes(k))?.[1] ?? fallback;
};

const OSRM = 'https://router.project-osrm.org/route/v1/driving';
const M_PER_DEG_LAT = 111_320;
const MAX_SHOP_DISTANCE_M = 25_000;
const rand = (a: number, b: number) => a + Math.random() * (b - a);
const r7 = (n: number) => Math.round(n * 1e7) / 1e7;
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

const mPerDegLng = (lat: number) => M_PER_DEG_LAT * Math.cos((lat * Math.PI) / 180);
function distM(a: LatLng, b: LatLng) {
  const dy = (b.lat - a.lat) * M_PER_DEG_LAT;
  const dx = (b.lng - a.lng) * mPerDegLng(a.lat);
  return Math.sqrt(dx * dx + dy * dy);
}
function bearing(a: LatLng, b: LatLng) {
  const dy = (b.lat - a.lat) * M_PER_DEG_LAT;
  const dx = (b.lng - a.lng) * mPerDegLng(a.lat);
  return (((Math.atan2(dx, dy) * 180) / Math.PI) + 360) % 360;
}
const jitter = (p: LatLng, metres: number): LatLng => ({
  lat: p.lat + rand(-metres, metres) / M_PER_DEG_LAT,
  lng: p.lng + rand(-metres, metres) / mPerDegLng(p.lat),
});

// ------------------------------------------------------------------------------------------------ road geometry

interface Geometry {
  coords: LatLng[];
  /** For each waypoint, the index in coords that is closest to it (non-decreasing). */
  snap: number[];
  road: boolean;
}

let osrmFailures = 0;
async function fetchRoadGeometry(waypoints: LatLng[]): Promise<Geometry | null> {
  if (osrmFailures >= 3) return null; // server unreachable: stop hammering it
  const path = waypoints.map((w) => `${w.lng.toFixed(6)},${w.lat.toFixed(6)}`).join(';');
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      await sleep(1100); // be polite to the public demo server
      const res = await fetch(`${OSRM}/${path}?overview=full&geometries=geojson`, { signal: AbortSignal.timeout(20_000) });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const json = (await res.json()) as {
        code: string;
        routes?: Array<{ geometry: { coordinates: [number, number][] } }>;
        waypoints?: Array<{ location: [number, number] }>;
      };
      const line = json.routes?.[0]?.geometry.coordinates;
      if (json.code !== 'Ok' || !line || line.length < 2 || !json.waypoints) throw new Error(`code ${json.code}`);
      const coords = line.map(([lng, lat]) => ({ lat, lng }));
      const snap: number[] = [];
      let from = 0;
      for (const w of json.waypoints) {
        const target = { lat: w.location[1], lng: w.location[0] };
        let best = from;
        let bestD = Infinity;
        for (let i = from; i < coords.length; i++) {
          const d = distM(coords[i], target);
          if (d < bestD) {
            bestD = d;
            best = i;
          }
        }
        snap.push(best);
        from = best;
      }
      osrmFailures = 0;
      return { coords, snap, road: true };
    } catch (e) {
      console.warn(`  ! OSRM attempt ${attempt + 1} failed: ${e instanceof Error ? e.message : e}`);
    }
  }
  osrmFailures++;
  return null;
}

/** Fallback: straight legs with a gentle wobble so they look like a road, not a ruler line. */
function fallbackGeometry(waypoints: LatLng[]): Geometry {
  const coords: LatLng[] = [waypoints[0]];
  const snap: number[] = [0];
  for (let w = 1; w < waypoints.length; w++) {
    const a = waypoints[w - 1];
    const b = waypoints[w];
    const total = distM(a, b);
    const phase = rand(0, Math.PI * 2);
    const amp = Math.min(60, total * 0.03);
    const dxM = (b.lng - a.lng) * mPerDegLng(a.lat);
    const dyM = (b.lat - a.lat) * M_PER_DEG_LAT;
    const len = Math.sqrt(dxM * dxM + dyM * dyM) || 1;
    const px = -dyM / len;
    const py = dxM / len;
    const n = Math.max(2, Math.round(total / 120));
    for (let k = 1; k < n; k++) {
      const t = k / n;
      const wob = Math.sin(t * Math.PI * 4 + phase) * amp * Math.sin(t * Math.PI) + rand(-4, 4);
      coords.push({
        lat: a.lat + (b.lat - a.lat) * t + (py * wob) / M_PER_DEG_LAT,
        lng: a.lng + (b.lng - a.lng) * t + (px * wob) / mPerDegLng(a.lat),
      });
    }
    coords.push(b);
    snap.push(coords.length - 1);
  }
  return { coords, snap, road: false };
}

async function geometryFor(waypoints: LatLng[]): Promise<Geometry> {
  const road = await fetchRoadGeometry(waypoints);
  if (road) return road;
  console.warn('  ! WARNING: no OSRM road geometry, using interpolated points with jitter');
  return fallbackGeometry(waypoints);
}

/** Resample a polyline into points every `lo`-`hi` metres (always ends on the last vertex). */
function resample(line: LatLng[], lo = 100, hi = 200): LatLng[] {
  const out: LatLng[] = [];
  let next = rand(lo, hi);
  let acc = 0;
  for (let i = 1; i < line.length; i++) {
    const a = line[i - 1];
    const b = line[i];
    const seg = distM(a, b);
    while (acc + seg >= next && seg > 0) {
      const t = (next - acc) / seg;
      out.push({ lat: a.lat + (b.lat - a.lat) * t, lng: a.lng + (b.lng - a.lng) * t });
      next += rand(lo, hi);
    }
    acc += seg;
  }
  out.push(line[line.length - 1]);
  return out;
}

// ------------------------------------------------------------------------------------------------ timeline

interface RelFix {
  p: LatLng;
  t: number; // seconds since journey start
  speed: number;
  heading: number;
  dwell: boolean;
}
interface Dwell {
  waypoint: number; // index into the waypoint list (1..n)
  startT: number;
  endT: number;
}
interface Plan {
  fixes: RelFix[];
  dwells: Dwell[];
  travelSec: number;
  dwellSec: number;
}

/**
 * waypoints: origin, shop1, ..., (origin). Dwells at every waypoint except index 0 and (when returnsHome) the last one.
 * travelFactor stretches / shrinks the travel time.
 */
function planTrail(waypoints: LatLng[], geo: Geometry, returnsHome: boolean, travelFactor: number, dwellScale: number): Plan {
  const fixes: RelFix[] = [];
  const dwells: Dwell[] = [];
  let t = rand(20, 60);
  let travelSec = 0;
  let dwellSec = 0;
  let heading = 0;
  let last = waypoints[0];
  fixes.push({ p: waypoints[0], t, speed: 0, heading, dwell: true });

  for (let w = 1; w < waypoints.length; w++) {
    const i0 = geo.snap[w - 1];
    const i1 = Math.max(geo.snap[w], i0 + 1);
    const cruise = rand(8, 13);
    const seg = geo.coords.slice(i0, i1 + 1);
    const samples = resample([last, ...seg], 100, 200);
    const exact = waypoints[w];
    if (distM(samples[samples.length - 1], exact) > 3) samples.push(exact);
    else samples[samples.length - 1] = exact;
    const total = samples.reduce((s, p, i) => s + (i === 0 ? distM(last, p) : distM(samples[i - 1], p)), 0) || 1;
    let run = 0;
    let prev = last;
    for (const p of samples) {
      const d = distM(prev, p);
      run += d;
      const edge = Math.min(run, total - run);
      const slow = edge < 250 ? 0.45 + (edge / 250) * 0.55 : 1;
      const speed = Math.max(1.5, cruise * slow * rand(0.8, 1.2));
      const dt = (d / speed) * travelFactor;
      t += dt;
      travelSec += dt;
      if (d > 5) heading = bearing(prev, p);
      fixes.push({
        p: p === exact ? exact : jitter(p, 2.5),
        t,
        speed: Math.round(speed * 100) / 100,
        heading,
        dwell: false,
      });
      prev = p;
    }
    last = exact;

    const isLast = w === waypoints.length - 1;
    if (!isLast || !returnsHome) {
      const dwellLen = rand(5, 12) * 60 * dwellScale;
      const startT = t;
      const n = Math.max(2, Math.round(dwellLen / 80));
      for (let k = 1; k <= n; k++) {
        fixes.push({ p: k === n ? exact : jitter(exact, 2), t: startT + (dwellLen * k) / n, speed: 0, heading, dwell: true });
      }
      t = startT + dwellLen;
      dwellSec += dwellLen;
      dwells.push({ waypoint: w, startT, endT: t });
    }
  }
  return { fixes, dwells, travelSec, dwellSec };
}

// ------------------------------------------------------------------------------------------------ db helpers

type DbFix = {
  lat: number;
  lng: number;
  at: Date;
  speed: number;
  heading: number;
  accuracy: number;
  offline: boolean;
  battery: number;
};

function toDbFixes(plan: Plan, startAt: Date, battery: number, gapAfterIdx = -1, gapSec = 0): DbFix[] {
  const out: DbFix[] = [];
  const n = plan.fixes.length;
  let offlineLeft = 0;
  plan.fixes.forEach((f, i) => {
    let extra = 0;
    if (gapAfterIdx >= 0 && i >= gapAfterIdx) extra = gapSec;
    if (gapAfterIdx >= 0 && i === gapAfterIdx) offlineLeft = 5;
    out.push({
      lat: r7(f.p.lat),
      lng: r7(f.p.lng),
      at: new Date(startAt.getTime() + (f.t + extra) * 1000),
      speed: f.speed,
      heading: Math.round(f.heading * 100) / 100,
      accuracy: Math.round(rand(5, 20) * 100) / 100,
      offline: offlineLeft > 0,
      battery: Math.max(15, Math.round(battery - ((battery * 0.3) * i) / Math.max(1, n - 1))),
    });
    if (offlineLeft > 0) offlineLeft--;
  });
  return out;
}

async function writeFixes(journeyId: bigint, keyBase: string, fixes: DbFix[], userId: bigint | null) {
  const data = fixes.map((f, i) => ({
    journey_id: journeyId,
    recorded_by_user_id: userId,
    source_type: 'MOT_DEVICE',
    latitude: f.lat,
    longitude: f.lng,
    gps_accuracy: f.accuracy,
    device_recorded_at: f.at,
    server_received_at: f.offline ? new Date(f.at.getTime() + 12 * 60_000) : new Date(f.at.getTime() + 2000),
    idempotency_key: `${keyBase}-${i + 1}`,
    speed_mps: f.speed,
    heading_deg: f.heading,
    battery_pct: f.battery,
    was_offline: f.offline,
    provider: 'WEB',
  }));
  const res = await prisma.motJourneyLocation.createMany({ data, skipDuplicates: true });
  return res.count;
}

async function main() {
  console.log('RUNNING GPS TRAIL DEMO SEED (DEVELOPMENT ONLY)');
  if (process.env.NODE_ENV === 'production') {
    console.error('CRITICAL SAFETY ABORT: Cannot seed demo data in PRODUCTION environment!');
    process.exit(1);
  }
  if ((process.env.ALLOW_DEMO_RESET || '').trim() !== 'true') {
    console.error('CRITICAL SAFETY ABORT: ALLOW_DEMO_RESET=true is required!');
    process.exit(1);
  }

  const hasilpur = await prisma.procurementSource.findUnique({ where: { code: 'ZMCC-HASILPUR' } });
  if (!hasilpur) throw new Error('ZMCC-HASILPUR procurement source not found.');

  // Demo shops without a usable position get a real village location around Hasilpur.
  const VILLAGE_SPOTS: LatLng[] = [
    { lat: 29.7112, lng: 72.5421 }, { lat: 29.7186, lng: 72.5364 }, { lat: 29.7255, lng: 72.5291 },
    { lat: 29.7310, lng: 72.5214 }, { lat: 29.7398, lng: 72.5122 }, { lat: 29.6851, lng: 72.5632 },
    { lat: 29.6762, lng: 72.5718 }, { lat: 29.7020, lng: 72.5853 }, { lat: 29.7155, lng: 72.5990 },
    { lat: 29.6670, lng: 72.5390 }, { lat: 29.6588, lng: 72.5265 }, { lat: 29.7480, lng: 72.5480 },
  ];
  const hasilpurShops = await prisma.zmccShop.findMany({ where: { zmcc_id: hasilpur.id }, orderBy: { id: 'asc' } });
  let spot = 0;
  for (const s of hasilpurShops) {
    const ok = s.latitude != null && s.longitude != null &&
      distM({ lat: 29.6974, lng: 72.5539 }, { lat: Number(s.latitude), lng: Number(s.longitude) }) < 15_000;
    if (ok) continue;
    const p = VILLAGE_SPOTS[spot++ % VILLAGE_SPOTS.length];
    await prisma.zmccShop.update({ where: { id: s.id }, data: { latitude: p.lat, longitude: p.lng } });
  }

  // ---------------------------------------------------------------- 1. road trails for finished journeys
  const journeys = await prisma.motJourney.findMany({
    where: { NOT: { journey_number: { startsWith: 'DEMO-GPS-LIVE-' } } },
    include: {
      zmcc: { select: { code: true } },
      stops: { orderBy: { planned_sequence: 'asc' }, include: { collection: true } },
    },
    orderBy: { id: 'asc' },
  });

  let trailJourneys = 0;
  let trailPoints = 0;
  let placed = 0;
  let gapDone = false;
  let roadCount = 0;
  for (const j of journeys) {
    if (!j.ended_at) continue;
    const realPoints = await prisma.motJourneyLocation.count({
      where: { journey_id: j.id, source_type: 'MOT_DEVICE', NOT: { idempotency_key: { startsWith: 'DEMO-GPS-' } } },
    });
    if (realPoints > 0) continue; // real device data: never touch

    const fallbackOrigin: LatLng = { lat: Number(j.start_latitude), lng: Number(j.start_longitude) };
    const origin = zmccLocation(j.zmcc?.code, fallbackOrigin);

    // waypoints: only stops the vehicle actually went to
    const visits: Array<{ stop: (typeof j.stops)[number]; at: LatLng }> = [];
    for (const stop of j.stops) {
      if (stop.status === 'SKIPPED' || (stop.status === 'PENDING' && !stop.collection)) continue;
      let c: LatLng | null = null;
      if (stop.planned_latitude_snapshot != null && stop.planned_longitude_snapshot != null) {
        c = { lat: Number(stop.planned_latitude_snapshot), lng: Number(stop.planned_longitude_snapshot) };
      } else {
        const shop = await prisma.zmccShop.findUnique({ where: { id: stop.shop_id } });
        if (shop?.latitude != null && shop.longitude != null) c = { lat: Number(shop.latitude), lng: Number(shop.longitude) };
      }
      if (c && distM(origin, c) < MAX_SHOP_DISTANCE_M) visits.push({ stop, at: c });
    }
    if (visits.length === 0) {
      console.warn(`  ! journey ${j.journey_number}: no usable shop coordinates, skipped`);
      continue;
    }

    // REPLACE earlier demo trail
    await prisma.motJourneyLocation.deleteMany({
      where: { journey_id: j.id, idempotency_key: { startsWith: `DEMO-GPS-${j.id}-` } },
    });

    // ONE exact ZMCC location for the journey
    await prisma.motJourney.update({
      where: { id: j.id },
      data: { start_latitude: origin.lat, start_longitude: origin.lng, assignment_latitude: origin.lat, assignment_longitude: origin.lng },
    });
    await prisma.motJourneyLocation.updateMany({
      where: { journey_id: j.id, source_type: 'ASSIGNING_USER' },
      data: { latitude: origin.lat, longitude: origin.lng },
    });

    const waypoints: LatLng[] = [origin, ...visits.map((v) => v.at), origin];
    const geo = await geometryFor(waypoints);
    if (geo.road) roadCount++;

    // fit the plan into started_at..ended_at
    const windowSec = (j.ended_at.getTime() - j.started_at.getTime()) / 1000;
    const durMin = windowSec / 60;
    const withGap = !gapDone && durMin >= 45;
    const gapSec = withGap ? rand(11, 16) * 60 : 0;
    const target = Math.max(120, windowSec * 0.94 - gapSec);
    let plan = planTrail(waypoints, geo, true, 1, 1);
    for (let pass = 0; pass < 3; pass++) {
      const total = plan.travelSec + plan.dwellSec;
      if (total <= target * 1.02 && total >= target * 0.8) break;
      // shrink/stretch travel first; if still too long squeeze dwells (not below ~5 min each)
      const room = target - plan.dwellSec;
      const travelFactor = room > plan.travelSec * 0.4 ? room / plan.travelSec : 0.4;
      const dwellScale = room > plan.travelSec * 0.4 ? 1 : Math.max(0.45, (target - plan.travelSec * 0.4) / plan.dwellSec);
      plan = planTrail(waypoints, geo, true, Math.max(0.3, Math.min(3, travelFactor)), dwellScale);
    }
    // hard clamp so nothing falls outside the journey window
    const maxT = Math.max(...plan.fixes.map((f) => f.t));
    if (maxT + gapSec > windowSec - 20) {
      const k = (windowSec - 20 - gapSec) / maxT;
      plan.fixes.forEach((f) => (f.t *= k));
      plan.dwells.forEach((d) => {
        d.startT *= k;
        d.endT *= k;
      });
    }
    const gapIdx = withGap ? Math.floor(plan.fixes.length * 0.45) : -1;
    // keep a gap away from dwell fixes
    let gi = gapIdx;
    while (gi > 0 && gi < plan.fixes.length - 1 && plan.fixes[gi].dwell) gi++;
    if (withGap) gapDone = true;

    const fixes = toDbFixes(plan, j.started_at, rand(88, 98), withGap ? gi : -1, gapSec);
    trailPoints += await writeFixes(j.id, `DEMO-GPS-${j.id}`, fixes, null);
    trailJourneys++;

    // collections + stops sit at the shop where the trail dwells
    const shift = (t: number, idx: number) => t + (withGap && idx >= gi ? gapSec : 0);
    for (const d of plan.dwells) {
      const v = visits[d.waypoint - 1];
      if (!v) continue;
      const firstIdxAfter = plan.fixes.findIndex((f) => f.t >= d.startT);
      const arrive = new Date(j.started_at.getTime() + shift(d.startT, firstIdxAfter) * 1000);
      const leave = new Date(j.started_at.getTime() + shift(d.endT, firstIdxAfter) * 1000);
      if (v.stop.collection) {
        const when = new Date(arrive.getTime() + (leave.getTime() - arrive.getTime()) * rand(0.4, 0.7));
        await prisma.motShopCollection.update({
          where: { id: v.stop.collection.id },
          data: {
            collection_latitude: v.at.lat,
            collection_longitude: v.at.lng,
            collection_gps_accuracy: Math.round(rand(6, 15) * 100) / 100,
            device_collected_at: when,
          },
        });
        placed++;
      }
      await prisma.motJourneyStop.update({
        where: { id: v.stop.id },
        data: { arrived_at: arrive, completed_at: leave },
      });
    }
  }
  console.log(
    `Trails: ${trailPoints} points on ${trailJourneys} journeys (${roadCount} road-following via OSRM${
      gapDone ? ', one with a >10 min signal gap' : ''
    }); ${placed} collections placed at their shops.`,
  );

  // ---------------------------------------------------------------- 2. two active journeys
  const now = new Date();
  const busy = await prisma.motJourney.findMany({
    where: { zmcc_id: hasilpur.id, status: { in: ['COLLECTING', 'RETURNING'] }, NOT: { journey_number: { startsWith: 'DEMO-GPS-LIVE-' } } },
    select: { mot_vehicle_id: true, mot_profile_id: true },
  });
  const busyVehicles = new Set(busy.map((b) => b.mot_vehicle_id.toString()));
  const busyProfiles = new Set(busy.map((b) => b.mot_profile_id.toString()));
  const vehicles = (await prisma.motVehicle.findMany({ where: { zmcc_id: hasilpur.id, is_active: true }, orderBy: { id: 'asc' } })).filter(
    (v) => !busyVehicles.has(v.id.toString()),
  );
  const profiles = (await prisma.motProfile.findMany({ where: { zmcc_id: hasilpur.id, is_active: true }, orderBy: { id: 'asc' } })).filter(
    (p) => !busyProfiles.has(p.id.toString()),
  );
  const assigner =
    (await prisma.user.findFirst({ where: { is_active: true, role: { in: ['ZMCC_MANAGER', 'DATA_EXECUTIVE'] } }, orderBy: { id: 'asc' } })) ??
    (await prisma.user.findFirst({ where: { is_active: true }, orderBy: { id: 'asc' } }));
  const route =
    (await prisma.zmccRoute.findUnique({ where: { route_code: 'DEMO-SCN-RT-HAS-01' } })) ??
    (await prisma.zmccRoute.findFirst({ where: { zmcc_id: hasilpur.id, is_active: true }, orderBy: { id: 'asc' } }));
  const shops = route
    ? await prisma.zmccShop.findMany({
        where: { zmcc_id: hasilpur.id, is_active: true, latitude: { not: null }, longitude: { not: null } },
        include: { area: true },
        orderBy: { id: 'asc' },
      })
    : [];
  const goodRouteShops = shops.filter((s) => distM(ZMCC_HASILPUR, { lat: Number(s.latitude), lng: Number(s.longitude) }) < MAX_SHOP_DISTANCE_M);

  if (!assigner || !route || goodRouteShops.length < 3) {
    console.warn('! Live journeys skipped: need an active user, a Hasilpur route and >= 3 geotagged shops within 25 km.');
  } else {
    const specs = [
      { tag: 'A', ageMin: 2, parked: false, shopOffset: 0, battery: 72 },
      { tag: 'B', ageMin: 38, parked: true, shopOffset: 1, battery: 41 },
    ];
    for (let i = 0; i < specs.length; i++) {
      const sp = specs[i];
      const number = `DEMO-GPS-LIVE-${sp.tag}`;
      const existing = await prisma.motJourney.findUnique({ where: { journey_number: number }, include: { stops: { orderBy: { planned_sequence: 'asc' } } } });

      // shops: from the existing stops (refresh) or a fresh pick
      const picked = existing
        ? null
        : [0, 1, 2].map((n) => goodRouteShops[(sp.shopOffset + n) % goodRouteShops.length]);
      const shopPts: LatLng[] = existing
        ? existing.stops
            .filter((s) => s.planned_latitude_snapshot != null && s.planned_longitude_snapshot != null)
            .map((s) => ({ lat: Number(s.planned_latitude_snapshot), lng: Number(s.planned_longitude_snapshot) }))
        : picked!.map((s) => ({ lat: Number(s.latitude), lng: Number(s.longitude) }));
      if (shopPts.length < 2) {
        console.warn(`  ! ${number}: needs >= 2 geotagged stops, skipped`);
        continue;
      }

      const vehicle = existing ? null : vehicles[i];
      const profile = existing ? null : profiles[i];
      if (!existing && (!vehicle || !profile)) {
        console.warn(`  ! ${number} skipped: no free vehicle/profile at Hasilpur`);
        continue;
      }

      // ZMCC -> shop1 (dwell) -> shop2 ; the trail is cut where the vehicle is "now"
      const waypoints = [ZMCC_HASILPUR, shopPts[0], shopPts[1]];
      const geo = await geometryFor(waypoints);
      const plan = planTrail(waypoints, geo, false, 1, 1);
      const d1 = plan.dwells[0];
      const cut = sp.parked ? d1.startT + (d1.endT - d1.startT) * 0.6 : d1.endT + (plan.dwells[1].startT - d1.endT) * 0.5;
      const kept = plan.fixes.filter((f) => f.t <= cut);
      const lastRel = kept[kept.length - 1];
      const lastFixAt = new Date(now.getTime() - sp.ageMin * 60_000);
      const startedAt = new Date(lastFixAt.getTime() - lastRel.t * 1000 - 20_000);
      const fixes = toDbFixes({ ...plan, fixes: kept }, startedAt, sp.battery + 15);
      fixes[fixes.length - 1].at = lastFixAt;
      fixes[fixes.length - 1].speed = sp.parked ? 0 : fixes[fixes.length - 1].speed || 9.4;
      const opDate = new Date(`${new Date(now.getTime() + 5 * 3600_000).toISOString().slice(0, 10)}T00:00:00.000Z`);

      let journeyId: bigint;
      if (existing) {
        journeyId = existing.id;
        await prisma.motJourneyLocation.deleteMany({ where: { journey_id: journeyId, idempotency_key: { startsWith: `DEMO-GPS-${journeyId}-` } } });
        await prisma.motJourney.update({
          where: { id: journeyId },
          data: {
            operational_date: opDate,
            assigned_at: startedAt,
            started_at: startedAt,
            start_latitude: ZMCC_HASILPUR.lat,
            start_longitude: ZMCC_HASILPUR.lng,
            assignment_latitude: ZMCC_HASILPUR.lat,
            assignment_longitude: ZMCC_HASILPUR.lng,
          },
        });
        await prisma.motJourneyLocation.updateMany({
          where: { journey_id: journeyId, source_type: 'ASSIGNING_USER' },
          data: { latitude: ZMCC_HASILPUR.lat, longitude: ZMCC_HASILPUR.lng, device_recorded_at: startedAt, server_received_at: startedAt },
        });
      } else {
        const created = await prisma.$transaction(async (tx) => {
          const journey = await tx.motJourney.create({
            data: {
              journey_number: number,
              operational_date: opDate,
              zmcc_id: hasilpur.id,
              route_id: route.id,
              mot_profile_id: profile!.id,
              mot_vehicle_id: vehicle!.id,
              status: 'COLLECTING',
              assigned_by: assigner.id,
              assigned_at: startedAt,
              assignment_latitude: ZMCC_HASILPUR.lat,
              assignment_longitude: ZMCC_HASILPUR.lng,
              assignment_gps_accuracy: 8,
              started_at: startedAt,
              start_latitude: ZMCC_HASILPUR.lat,
              start_longitude: ZMCC_HASILPUR.lng,
              idempotency_key: `DEMO-GPS-LIVE-${sp.tag}-journey`,
            },
          });
          await tx.motJourneyLocation.create({
            data: {
              journey_id: journey.id,
              recorded_by_user_id: assigner.id,
              source_type: 'ASSIGNING_USER',
              latitude: ZMCC_HASILPUR.lat,
              longitude: ZMCC_HASILPUR.lng,
              gps_accuracy: 8,
              device_recorded_at: startedAt,
              server_received_at: startedAt,
              idempotency_key: `DEMO-GPS-LIVE-${sp.tag}-journey-loc-0`,
            },
          });
          await tx.motJourneyStop.createMany({
            data: picked!.map((s, idx) => ({
              journey_id: journey.id,
              shop_id: s.id,
              planned_sequence: idx + 1,
              status: 'PENDING',
              shop_code_snapshot: s.shop_code,
              shop_name_snapshot: s.shop_name,
              owner_name_snapshot: s.owner_name,
              phone_number_snapshot: s.phone_number,
              area_code_snapshot: s.area.area_code,
              area_name_snapshot: s.area.name,
              planned_latitude_snapshot: s.latitude,
              planned_longitude_snapshot: s.longitude,
            })),
          });
          return journey;
        });
        journeyId = created.id;
      }
      const n = await writeFixes(journeyId, `DEMO-GPS-${journeyId}`, fixes, null);
      console.log(`  ${existing ? '~' : '+'} ${number}: ${n} points, last fix ${sp.ageMin} min ago${geo.road ? ' (road)' : ' (fallback)'}`);
    }
  }
  console.log('Cleanup: ALLOW_DEMO_RESET=true npx tsx scripts/reset_demo_operational_data.ts');
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error('Fatal error during GPS trail seeding:', err);
    process.exit(1);
  });
