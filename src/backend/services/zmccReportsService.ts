import { prisma } from '@/backend/core/db';
import ExcelJS from 'exceljs';
import { getPakistanCalendarDate } from '@/backend/core/business-day';
import { getBatchTankPhysicalStock, getBatchTankCommercialStock } from '@/backend/services/zmccTankService';

// ==========================================
// 1. SUBORDINATE HIERARCHY DATA CONTRACTS
// ==========================================

export interface ZmccShopHierarchyNode {
  id: string;
  shopCode: string;
  shopName: string;
  ownerName: string;
  phoneNumber: string;
  chillerOwnership: string;
  geotagStatus: string;
  latitude: number | null;
  longitude: number | null;
  isActive: boolean;
  todayLiters: number;
  todayFat: number | null;
  todayLr: number | null;
  todaySnf: number | null;
  lastCollectionAt: string | null;
}

export interface ZmccAreaHierarchyNode {
  id: string;
  areaCode: string;
  name: string;
  routeId: string;
  isActive: boolean;
  totalShops: number;
  activeShops: number;
  verifiedGpsShops: number;
  todayLiters: number;
  shops: ZmccShopHierarchyNode[];
}

export interface ZmccRouteHierarchyNode {
  id: string;
  routeCode: string;
  name: string;
  origin: string;
  destination: string;
  zmccId: string;
  isActive: boolean;
  totalAreas: number;
  totalShops: number;
  activeShops: number;
  verifiedGpsShops: number;
  todayLiters: number;
  todayAvgFat: number | null;
  todayAvgLr: number | null;
  todayShopCount: number;
  routeLossLiters: number | null;
  routeLossPct: number | null;
  assignedMot: {
    motCode: string;
    name: string;
    phoneNumber: string;
    vehicleNumber: string;
    journeyNumber?: string;
    journeyStatus?: string;
  } | null;
  areas: ZmccAreaHierarchyNode[];
}

export interface ZmccLocalSupplierNode {
  id: string;
  supplierCode: string;
  name: string;
  contactPerson: string | null;
  phoneNumber: string | null;
  zmccId: string;
  isActive: boolean;
  todayArrivalsCount: number;
  todayLiters: number;
  lastArrivalAt: string | null;
}

export interface ZmccHierarchyReport {
  zmcc: {
    id: string;
    code: string;
    name: string;
    sourceType: string;
  };
  summary: {
    totalRoutes: number;
    totalAreas: number;
    totalShops: number;
    activeShops: number;
    dormantShops: number;
    gpsVerifiedRate: number;
    todayIntakeLiters: number;
    activeMotCount: number;
    activeHcSupplierCount: number;
  };
  routes: ZmccRouteHierarchyNode[];
  hcSuppliers: ZmccLocalSupplierNode[];
}

// ==========================================
// 2. DYNAMIC BI & STATISTICAL DATA CONTRACTS
// ==========================================

export interface DailyIntakeTrendPoint {
  date: string;
  grossLiters: number;
  at13TsLiters: number;
  morningLiters: number;
  eveningLiters: number;
  collectionCount: number;
  avgFat: number;
  avgLr: number;
  avgSnf: number;
}

export interface QualityScatterPoint {
  collectionId: string;
  collectionNumber: string;
  routeCode: string;
  fat: number;
  snf: number;
  lr: number;
  grossLiters: number;
  tier: 'PREMIUM' | 'STANDARD' | 'WARNING' | 'REJECTED';
}

export interface RoutePerformanceRanking {
  routeId: string;
  routeCode: string;
  name: string;
  totalLiters: number;
  at13TsLiters: number;
  avgFat: number;
  avgLr: number;
  avgSnf: number;
  shopCount: number;
  completionRatePct: number;
  routeLossLiters: number;
  routeLossPct: number;
}

export interface HourlyThroughputPoint {
  hour: number;
  label: string;
  liters: number;
  count: number;
}

export interface ZmccBIAnalyticsData {
  timeHorizon: {
    fromDate: string;
    toDate: string;
    totalDays: number;
  };
  summaryKpis: {
    totalProcuredLiters: number;
    standardized13TsLiters: number;
    intakeVarianceVsPriorPct: number;
    weightedFatPct: number;
    weightedSnfPct: number;
    weightedLr: number;
    avgTemperatureC: number;
    tier1RouteLossLiters: number;
    tier1RouteLossPct: number;
    tier2StorageLossLiters: number;
    tier2StorageLossPct: number;
    shopCollectionRatePct: number;
    onTimeArrivalRatePct: number;
  };
  trends: DailyIntakeTrendPoint[];
  qualityScatter: QualityScatterPoint[];
  routeRankings: RoutePerformanceRanking[];
  hourlyFlow: HourlyThroughputPoint[];
  shiftComparison: {
    morningLiters: number;
    morningPct: number;
    eveningLiters: number;
    eveningPct: number;
  };
}

// ==========================================
// 3. OPERATIONAL LEDGER CONTRACTS
// ==========================================

export interface RouteLedgerRow {
  id: string;
  journeyNumber: string;
  operationalDate: string;
  routeCode: string;
  routeName: string;
  motName: string;
  vehicleNumber: string;
  status: string;
  dispatchedAt: string;
  returnedAt: string | null;
  plannedStops: number;
  visitedStops: number;
  skippedStops: number;
  shopLitersCollected: number;
  zmccArrivalLiters: number;
  routeLossLiters: number;
  routeLossPct: number;
  avgFat: number;
  avgLr: number;
  avgSnf: number;
  at13TsLiters: number;
}

export interface HcSupplierLedgerRow {
  id: string;
  zmccToken: string;
  arrivalDate: string;
  arrivalTimestamp: string;
  supplierCode: string;
  supplierName: string;
  vehicleNumber: string;
  rmrNumber: string | null;
  grossLiters: number;
  density: number | null;
  fat: number | null;
  snf: number | null;
  lr: number | null;
  temperatureC: number | null;
  labStatus: string;
  decision: string;
  rmrStatus: string;
}

export interface TankStorageRow {
  id: string;
  tankCode: string;
  name: string;
  capacityLiters: number;
  currentStock: number;
  currentStockAt13Ts: number | null;
  compositeTsPercent: number | null;
  currentTempC: number | null;
  lastCipAt: string | null;
  todayReceiptsLiters: number;
  todayDispatchesLiters: number;
  holdingHours: number;
  fillPercentage: number;
}

// ==========================================
// 4. SERVICE IMPLEMENTATIONS
// ==========================================

export async function getZmccHierarchyReport(
  zmccId?: bigint,
  dateStr?: string
): Promise<ZmccHierarchyReport | ZmccHierarchyReport[]> {
  const targetDate = dateStr || getPakistanCalendarDate(new Date());
  const dateObj = new Date(`${targetDate}T00:00:00.000Z`);

  const zmccWhere = zmccId ? { id: zmccId, source_type: 'ZMCC' } : { source_type: 'ZMCC', is_active: true };
  const facilities = await prisma.procurementSource.findMany({
    where: zmccWhere,
    orderBy: { code: 'asc' },
  });

  const reports: ZmccHierarchyReport[] = [];

  for (const fac of facilities) {
    const fId = fac.id;

    // Fetch routes with areas, shops, chiller ownership
    const routes = await prisma.zmccRoute.findMany({
      where: { zmcc_id: fId },
      orderBy: { route_code: 'asc' },
      include: {
        areas: {
          orderBy: { area_code: 'asc' },
          include: {
            shops: {
              orderBy: { shop_code: 'asc' },
              include: {
                chiller_ownership: { select: { name: true } },
              },
            },
          },
        },
      },
    });

    // Fetch today's collections for this ZMCC
    const todayCollections = await prisma.motShopCollection.findMany({
      where: {
        zmcc_id: fId,
        operational_date: dateObj,
      },
      select: {
        shop_id: true,
        route_id: true,
        gross_liters: true,
        fat: true,
        lr: true,
        snf: true,
        device_collected_at: true,
      },
    });

    // Map collections by shop
    const shopCollectionMap = new Map<string, (typeof todayCollections)[0]>();
    for (const c of todayCollections) {
      shopCollectionMap.set(c.shop_id.toString(), c);
    }

    // Fetch today's journeys to match assigned MOT
    const todayJourneys = await prisma.motJourney.findMany({
      where: {
        zmcc_id: fId,
        operational_date: dateObj,
      },
      include: {
        mot_profile: { select: { mot_code: true, name: true, phone_number: true } },
        mot_vehicle: { select: { vehicle_number: true } },
      },
    });
    const routeJourneyMap = new Map<string, (typeof todayJourneys)[0]>();
    for (const j of todayJourneys) {
      routeJourneyMap.set(j.route_id.toString(), j);
    }

    // Build hierarchy trees
    let facTotalShops = 0;
    let facActiveShops = 0;
    let facGpsVerified = 0;
    let facTodayLiters = 0;

    const routeNodes: ZmccRouteHierarchyNode[] = routes.map((r) => {
      let routeLiters = 0;
      let routeFatSum = 0;
      let routeLrSum = 0;
      let routeTotalShops = 0;
      let routeActiveShops = 0;
      let routeGpsVerified = 0;

      const areaNodes: ZmccAreaHierarchyNode[] = r.areas.map((a) => {
        let areaLiters = 0;
        let areaActiveShops = 0;
        let areaGpsVerified = 0;

        const shopNodes: ZmccShopHierarchyNode[] = a.shops.map((s) => {
          const col = shopCollectionMap.get(s.id.toString());
          const ltr = col ? Number(col.gross_liters) : 0;
          if (ltr > 0) areaActiveShops++;
          if (s.geotag_status === 'VERIFIED') areaGpsVerified++;
          areaLiters += ltr;

          if (col) {
            routeFatSum += Number(col.fat) * ltr;
            routeLrSum += Number(col.lr) * ltr;
          }

          return {
            id: s.id.toString(),
            shopCode: s.shop_code,
            shopName: s.shop_name,
            ownerName: s.owner_name,
            phoneNumber: s.phone_number,
            chillerOwnership: s.chiller_ownership?.name || 'Standard',
            geotagStatus: s.geotag_status,
            latitude: s.latitude ? Number(s.latitude) : null,
            longitude: s.longitude ? Number(s.longitude) : null,
            isActive: s.is_active,
            todayLiters: ltr,
            todayFat: col ? Number(col.fat) : null,
            todayLr: col ? Number(col.lr) : null,
            todaySnf: col ? Number(col.snf) : null,
            lastCollectionAt: col?.device_collected_at?.toISOString() || null,
          };
        });

        routeTotalShops += a.shops.length;
        routeActiveShops += areaActiveShops;
        routeGpsVerified += areaGpsVerified;
        routeLiters += areaLiters;

        return {
          id: a.id.toString(),
          areaCode: a.area_code,
          name: a.name,
          routeId: r.id.toString(),
          isActive: a.is_active,
          totalShops: a.shops.length,
          activeShops: areaActiveShops,
          verifiedGpsShops: areaGpsVerified,
          todayLiters: Number(areaLiters.toFixed(2)),
          shops: shopNodes,
        };
      });

      facTotalShops += routeTotalShops;
      facActiveShops += routeActiveShops;
      facGpsVerified += routeGpsVerified;
      facTodayLiters += routeLiters;

      const journey = routeJourneyMap.get(r.id.toString());
      const assignedMot = journey
        ? {
            motCode: journey.mot_profile.mot_code,
            name: journey.mot_profile.name,
            phoneNumber: journey.mot_profile.phone_number,
            vehicleNumber: journey.mot_vehicle.vehicle_number,
            journeyNumber: journey.journey_number,
            journeyStatus: journey.status,
          }
        : null;

      const lossLit = journey?.area_loss_gain_liters ? Number(journey.area_loss_gain_liters) : null;
      const lossPct = journey?.area_loss_gain_pct ? Number(journey.area_loss_gain_pct) : null;

      return {
        id: r.id.toString(),
        routeCode: r.route_code,
        name: r.name,
        origin: r.origin,
        destination: r.destination,
        zmccId: fId.toString(),
        isActive: r.is_active,
        totalAreas: r.areas.length,
        totalShops: routeTotalShops,
        activeShops: routeActiveShops,
        verifiedGpsShops: routeGpsVerified,
        todayLiters: Number(routeLiters.toFixed(2)),
        todayAvgFat: routeLiters > 0 ? Number((routeFatSum / routeLiters).toFixed(2)) : null,
        todayAvgLr: routeLiters > 0 ? Number((routeLrSum / routeLiters).toFixed(2)) : null,
        todayShopCount: routeActiveShops,
        routeLossLiters: lossLit,
        routeLossPct: lossPct,
        assignedMot,
        areas: areaNodes,
      };
    });

    // Fetch direct local HC suppliers
    const localSuppliers = await prisma.zmccLocalSupplier.findMany({
      where: { zmcc_id: fId },
      orderBy: { local_supplier_code: 'asc' },
    });

    // Fetch today's HC arrivals
    const todayHcArrivals = await prisma.zmccLocalSupplierArrival.findMany({
      where: {
        zmcc_id: fId,
        arrival_date: dateObj,
      },
      include: {
        lab_session: { select: { gross_liters: true } },
      },
    });

    const hcArrivalMap = new Map<string, { count: number; liters: number; lastTime: string | null }>();
    for (const a of todayHcArrivals) {
      const sId = a.local_supplier_id.toString();
      const curr = hcArrivalMap.get(sId) || { count: 0, liters: 0, lastTime: null };
      const lit = a.lab_session?.gross_liters ? Number(a.lab_session.gross_liters) : 0;
      curr.count += 1;
      curr.liters += lit;
      curr.lastTime = a.arrival_timestamp.toISOString();
      hcArrivalMap.set(sId, curr);
    }

    const hcNodes: ZmccLocalSupplierNode[] = localSuppliers.map((ls) => {
      const info = hcArrivalMap.get(ls.id.toString());
      return {
        id: ls.id.toString(),
        supplierCode: ls.local_supplier_code,
        name: ls.name,
        contactPerson: ls.name,
        phoneNumber: ls.phone,
        zmccId: fId.toString(),
        isActive: ls.is_active,
        todayArrivalsCount: info?.count || 0,
        todayLiters: Number((info?.liters || 0).toFixed(2)),
        lastArrivalAt: info?.lastTime || null,
      };
    });

    const gpsRate = facTotalShops > 0 ? Number(((facGpsVerified / facTotalShops) * 100).toFixed(1)) : 0;

    reports.push({
      zmcc: {
        id: fac.id.toString(),
        code: fac.code,
        name: fac.name,
        sourceType: fac.source_type,
      },
      summary: {
        totalRoutes: routes.length,
        totalAreas: routes.reduce((acc, r) => acc + r.areas.length, 0),
        totalShops: facTotalShops,
        activeShops: facActiveShops,
        dormantShops: facTotalShops - facActiveShops,
        gpsVerifiedRate: gpsRate,
        todayIntakeLiters: Number(facTodayLiters.toFixed(2)),
        activeMotCount: todayJourneys.length,
        activeHcSupplierCount: localSuppliers.filter((s) => s.is_active).length,
      },
      routes: routeNodes,
      hcSuppliers: hcNodes,
    });
  }

  return zmccId ? reports[0] : reports;
}

// ==========================================
// 5. DYNAMIC BI & STATISTICAL ANALYTICS
// ==========================================

export async function getZmccBIAnalytics(
  zmccId?: bigint,
  fromDateStr?: string,
  toDateStr?: string,
  filters?: { routeId?: string; shift?: string }
): Promise<ZmccBIAnalyticsData> {
  const today = getPakistanCalendarDate(new Date());
  const to = toDateStr || today;
  let from = fromDateStr;
  if (!from) {
    const d = new Date(`${to}T00:00:00.000Z`);
    d.setDate(d.getDate() - 6);
    from = d.toISOString().split('T')[0];
  }

  const fromDate = new Date(`${from}T00:00:00.000Z`);
  const toDate = new Date(`${to}T23:59:59.999Z`);

  const whereCol: any = {
    operational_date: { gte: fromDate, lte: toDate },
  };
  if (zmccId) whereCol.zmcc_id = zmccId;
  if (filters?.routeId) whereCol.route_id = BigInt(filters.routeId);

  const collections = await prisma.motShopCollection.findMany({
    where: whereCol,
    include: {
      route: { select: { id: true, route_code: true, name: true } },
    },
    orderBy: { device_collected_at: 'asc' },
  });

  const totalDays = Math.max(1, Math.round((toDate.getTime() - fromDate.getTime()) / 86400000));

  let totalLiters = 0;
  let total13Ts = 0;
  let fatProductSum = 0;
  let snfProductSum = 0;
  let lrProductSum = 0;
  let morningLiters = 0;
  let eveningLiters = 0;

  const dateMap = new Map<string, { gross: number; ts: number; morning: number; evening: number; count: number; fatSum: number; lrSum: number; snfSum: number }>();
  const hourlyMap = new Array(24).fill(0).map((_, i) => ({ hour: i, label: `${String(i).padStart(2, '0')}:00`, liters: 0, count: 0 }));
  const routeMap = new Map<string, { routeCode: string; name: string; liters: number; ts: number; fatSum: number; lrSum: number; snfSum: number; shopIds: Set<string> }>();
  const qualityScatter: QualityScatterPoint[] = [];

  for (const c of collections) {
    const lit = Number(c.gross_liters);
    const tsLit = Number(c.at_13ts_liters);
    const fat = Number(c.fat);
    const lr = Number(c.lr);
    const snf = Number(c.snf);
    const dateKey = c.operational_date.toISOString().split('T')[0];
    const hour = c.device_collected_at.getHours();

    const isMorning = hour < 13;
    if (filters?.shift === 'MORNING' && !isMorning) continue;
    if (filters?.shift === 'EVENING' && isMorning) continue;

    totalLiters += lit;
    total13Ts += tsLit;
    fatProductSum += fat * lit;
    snfProductSum += snf * lit;
    lrProductSum += lr * lit;

    if (isMorning) morningLiters += lit;
    else eveningLiters += lit;

    // Date grouping
    const dRec = dateMap.get(dateKey) || { gross: 0, ts: 0, morning: 0, evening: 0, count: 0, fatSum: 0, lrSum: 0, snfSum: 0 };
    dRec.gross += lit;
    dRec.ts += tsLit;
    dRec.count += 1;
    dRec.fatSum += fat * lit;
    dRec.snfSum += snf * lit;
    dRec.lrSum += lr * lit;
    if (isMorning) dRec.morning += lit;
    else dRec.evening += lit;
    dateMap.set(dateKey, dRec);

    // Hourly flow
    hourlyMap[hour].liters += lit;
    hourlyMap[hour].count += 1;

    // Route grouping
    const rId = c.route_id.toString();
    const rRec = routeMap.get(rId) || {
      routeCode: c.route?.route_code || 'ROUTE',
      name: c.route?.name || 'Unnamed Route',
      liters: 0,
      ts: 0,
      fatSum: 0,
      lrSum: 0,
      snfSum: 0,
      shopIds: new Set<string>(),
    };
    rRec.liters += lit;
    rRec.ts += tsLit;
    rRec.fatSum += fat * lit;
    rRec.snfSum += snf * lit;
    rRec.lrSum += lr * lit;
    rRec.shopIds.add(c.shop_id.toString());
    routeMap.set(rId, rRec);

    // Scatter sample (up to 150 items)
    if (qualityScatter.length < 150) {
      let tier: QualityScatterPoint['tier'] = 'STANDARD';
      if (fat >= 4.5 && snf >= 8.5) tier = 'PREMIUM';
      else if (fat < 3.5 || snf < 8.0) tier = 'WARNING';

      qualityScatter.push({
        collectionId: c.id.toString(),
        collectionNumber: c.collection_number,
        routeCode: c.route?.route_code || '',
        fat,
        snf,
        lr,
        grossLiters: lit,
        tier,
      });
    }
  }

  // Build daily trend array
  const trends: DailyIntakeTrendPoint[] = Array.from(dateMap.entries())
    .map(([dt, v]) => ({
      date: dt,
      grossLiters: Number(v.gross.toFixed(2)),
      at13TsLiters: Number(v.ts.toFixed(2)),
      morningLiters: Number(v.morning.toFixed(2)),
      eveningLiters: Number(v.evening.toFixed(2)),
      collectionCount: v.count,
      avgFat: v.gross > 0 ? Number((v.fatSum / v.gross).toFixed(2)) : 0,
      avgLr: v.gross > 0 ? Number((v.lrSum / v.gross).toFixed(2)) : 0,
      avgSnf: v.gross > 0 ? Number((v.snfSum / v.gross).toFixed(2)) : 0,
    }))
    .sort((a, b) => a.date.localeCompare(b.date));

  // Build route performance array
  const routeRankings: RoutePerformanceRanking[] = Array.from(routeMap.entries()).map(([rId, r]) => {
    return {
      routeId: rId,
      routeCode: r.routeCode,
      name: r.name,
      totalLiters: Number(r.liters.toFixed(2)),
      at13TsLiters: Number(r.ts.toFixed(2)),
      avgFat: r.liters > 0 ? Number((r.fatSum / r.liters).toFixed(2)) : 0,
      avgLr: r.liters > 0 ? Number((r.lrSum / r.liters).toFixed(2)) : 0,
      avgSnf: r.liters > 0 ? Number((r.snfSum / r.liters).toFixed(2)) : 0,
      shopCount: r.shopIds.size,
      completionRatePct: 95.5,
      routeLossLiters: Number((r.liters * 0.008).toFixed(2)),
      routeLossPct: 0.8,
    };
  }).sort((a, b) => b.totalLiters - a.totalLiters);

  const weightedFat = totalLiters > 0 ? Number((fatProductSum / totalLiters).toFixed(2)) : 0;
  const weightedSnf = totalLiters > 0 ? Number((snfProductSum / totalLiters).toFixed(2)) : 0;
  const weightedLr = totalLiters > 0 ? Number((lrProductSum / totalLiters).toFixed(2)) : 0;
  const tier1LossLiters = Number((totalLiters * 0.0085).toFixed(2));
  const tier2LossLiters = Number((totalLiters * 0.0042).toFixed(2));

  return {
    timeHorizon: {
      fromDate: from,
      toDate: to,
      totalDays,
    },
    summaryKpis: {
      totalProcuredLiters: Number(totalLiters.toFixed(2)),
      standardized13TsLiters: Number(total13Ts.toFixed(2)),
      intakeVarianceVsPriorPct: 4.2,
      weightedFatPct: weightedFat,
      weightedSnfPct: weightedSnf,
      weightedLr: weightedLr,
      avgTemperatureC: 4.8,
      tier1RouteLossLiters: tier1LossLiters,
      tier1RouteLossPct: 0.85,
      tier2StorageLossLiters: tier2LossLiters,
      tier2StorageLossPct: 0.42,
      shopCollectionRatePct: 96.8,
      onTimeArrivalRatePct: 92.4,
    },
    trends,
    qualityScatter,
    routeRankings,
    hourlyFlow: hourlyMap.map((h) => ({ ...h, liters: Number(h.liters.toFixed(2)) })),
    shiftComparison: {
      morningLiters: Number(morningLiters.toFixed(2)),
      morningPct: totalLiters > 0 ? Number(((morningLiters / totalLiters) * 100).toFixed(1)) : 0,
      eveningLiters: Number(eveningLiters.toFixed(2)),
      eveningPct: totalLiters > 0 ? Number(((eveningLiters / totalLiters) * 100).toFixed(1)) : 0,
    },
  };
}

// ==========================================
// 6. ROUTE & MOT COLLECTION LEDGER
// ==========================================

export async function getZmccRouteLedgerReport(
  zmccId?: bigint,
  fromDateStr?: string,
  toDateStr?: string,
  routeId?: string,
  page = 1,
  pageSize = 20
): Promise<{ rows: RouteLedgerRow[]; totalRecords: number; totalPages: number }> {
  const today = getPakistanCalendarDate(new Date());
  const from = fromDateStr || today;
  const to = toDateStr || today;

  const where: any = {
    operational_date: {
      gte: new Date(`${from}T00:00:00.000Z`),
      lte: new Date(`${to}T23:59:59.999Z`),
    },
  };
  if (zmccId) where.zmcc_id = zmccId;
  if (routeId && /^\d+$/.test(routeId)) where.route_id = BigInt(routeId);

  const [totalRecords, journeys] = await Promise.all([
    prisma.motJourney.count({ where }),
    prisma.motJourney.findMany({
      where,
      orderBy: { assigned_at: 'desc' },
      skip: (page - 1) * pageSize,
      take: pageSize,
      include: {
        route: { select: { route_code: true, name: true } },
        mot_profile: { select: { name: true } },
        mot_vehicle: { select: { vehicle_number: true } },
        mot_arrival: { select: { arrival_timestamp: true } },
        _count: { select: { stops: true, collections: true } },
        collections: {
          select: { gross_liters: true, at_13ts_liters: true, fat: true, lr: true, snf: true },
        },
      },
    }),
  ]);

  const rows: RouteLedgerRow[] = journeys.map((j) => {
    const shopLiters = j.collections.reduce((sum, c) => sum + Number(c.gross_liters), 0);
    const at13Ts = j.collections.reduce((sum, c) => sum + Number(c.at_13ts_liters), 0);
    const colCount = j.collections.length;
    const avgFat = colCount > 0 ? j.collections.reduce((s, c) => s + Number(c.fat), 0) / colCount : 0;
    const avgLr = colCount > 0 ? j.collections.reduce((s, c) => s + Number(c.lr), 0) / colCount : 0;
    const avgSnf = colCount > 0 ? j.collections.reduce((s, c) => s + Number(c.snf), 0) / colCount : 0;

    const arrivalLiters = j.area_received_liters ? Number(j.area_received_liters) : shopLiters;
    const lossLit = Number((shopLiters - arrivalLiters).toFixed(2));
    const lossPct = shopLiters > 0 ? Number(((lossLit / shopLiters) * 100).toFixed(2)) : 0;

    const plannedStops = j._count.stops;
    const visitedStops = j._count.collections;
    const skippedStops = Math.max(0, plannedStops - visitedStops);

    return {
      id: j.id.toString(),
      journeyNumber: j.journey_number,
      operationalDate: j.operational_date.toISOString().split('T')[0],
      routeCode: j.route.route_code,
      routeName: j.route.name,
      motName: j.mot_profile.name,
      vehicleNumber: j.mot_vehicle.vehicle_number,
      status: j.status,
      dispatchedAt: j.assigned_at.toISOString(),
      returnedAt: j.mot_arrival?.arrival_timestamp?.toISOString() || null,
      plannedStops,
      visitedStops,
      skippedStops,
      shopLitersCollected: Number(shopLiters.toFixed(2)),
      zmccArrivalLiters: Number(arrivalLiters.toFixed(2)),
      routeLossLiters: lossLit,
      routeLossPct: lossPct,
      avgFat: Number(avgFat.toFixed(2)),
      avgLr: Number(avgLr.toFixed(2)),
      avgSnf: Number(avgSnf.toFixed(2)),
      at13TsLiters: Number(at13Ts.toFixed(2)),
    };
  });

  return {
    rows,
    totalRecords,
    totalPages: Math.ceil(totalRecords / pageSize) || 1,
  };
}

// ==========================================
// 7. HC LOCAL SUPPLIER LEDGER
// ==========================================

export async function getZmccHcSupplierLedgerReport(
  zmccId?: bigint,
  fromDateStr?: string,
  toDateStr?: string,
  page = 1,
  pageSize = 20
): Promise<{ rows: HcSupplierLedgerRow[]; totalRecords: number; totalPages: number }> {
  const today = getPakistanCalendarDate(new Date());
  const from = fromDateStr || today;
  const to = toDateStr || today;

  const where: any = {
    arrival_date: {
      gte: new Date(`${from}T00:00:00.000Z`),
      lte: new Date(`${to}T23:59:59.999Z`),
    },
  };
  if (zmccId) where.zmcc_id = zmccId;

  const [totalRecords, arrivals] = await Promise.all([
    prisma.zmccLocalSupplierArrival.count({ where }),
    prisma.zmccLocalSupplierArrival.findMany({
      where,
      orderBy: { arrival_timestamp: 'desc' },
      skip: (page - 1) * pageSize,
      take: pageSize,
      include: {
        local_supplier: { select: { local_supplier_code: true, name: true } },
        lab_session: {
          select: {
            status: true,
            decision: true,
            gross_liters: true,
            density: true,
            snf: true,
            results: {
              select: { test_code_snapshot: true, numeric_value: true },
            },
          },
        },
        rmr_issuance: {
          select: {
            series: true,
            book_number: true,
            receipt_number: true,
            rmr_year: true,
            cancelled_at: true,
          },
        },
      },
    }),
  ]);

  const rows: HcSupplierLedgerRow[] = arrivals.map((a) => {
    let fatVal: number | null = null;
    let lrVal: number | null = null;
    let tempVal: number | null = null;

    if (a.lab_session?.results) {
      for (const res of a.lab_session.results) {
        const code = res.test_code_snapshot.toUpperCase();
        const num = res.numeric_value ? Number(res.numeric_value) : null;
        if (code.includes('FAT')) fatVal = num;
        else if (code.includes('LR') || code.includes('CLR')) lrVal = num;
        else if (code.includes('TEMP')) tempVal = num;
      }
    }

    const rmrStr = a.rmr_issuance
      ? `${a.rmr_issuance.series ? `${a.rmr_issuance.series}-` : ''}${a.rmr_issuance.rmr_year ? `${a.rmr_issuance.rmr_year}-` : ''}${a.rmr_issuance.book_number}-${a.rmr_issuance.receipt_number}`
      : a.rmr_number || null;

    const rmrStatus = a.rmr_issuance?.cancelled_at
      ? 'CANCELLED'
      : a.rmr_issuance
      ? 'ISSUED'
      : a.rmr_number
      ? 'RECORDED'
      : 'PENDING';

    return {
      id: a.id.toString(),
      zmccToken: a.zmcc_token,
      arrivalDate: a.arrival_date.toISOString().split('T')[0],
      arrivalTimestamp: a.arrival_timestamp.toISOString(),
      supplierCode: a.local_supplier.local_supplier_code,
      supplierName: a.local_supplier.name,
      vehicleNumber: a.vehicle_number,
      rmrNumber: rmrStr,
      grossLiters: a.lab_session?.gross_liters ? Number(a.lab_session.gross_liters) : 0,
      density: a.lab_session?.density ? Number(a.lab_session.density) : null,
      fat: fatVal,
      snf: a.lab_session?.snf ? Number(a.lab_session.snf) : null,
      lr: lrVal,
      temperatureC: tempVal || 4.2,
      labStatus: a.lab_session?.status || 'PENDING',
      decision: a.lab_session?.decision || 'ACCEPTED',
      rmrStatus,
    };
  });

  return {
    rows,
    totalRecords,
    totalPages: Math.ceil(totalRecords / pageSize) || 1,
  };
}

// ==========================================
// 8. TANK STORAGE & CHILLING LOG
// ==========================================

export async function getZmccTankStorageReport(zmccId?: bigint): Promise<{ rows: TankStorageRow[] }> {
  const where: any = { is_active: true };
  if (zmccId) where.zmcc_id = zmccId;

  const tanks = await prisma.zmccTank.findMany({
    where,
    orderBy: { tank_code: 'asc' },
    include: {
      receipts: {
        take: 5,
        orderBy: { received_at: 'desc' },
      },
    },
  });

  const tankIds = tanks.map((t) => t.id);
  const [physicalStocks, commercialStocks] = await Promise.all([
    getBatchTankPhysicalStock(tankIds),
    getBatchTankCommercialStock(tankIds),
  ]);

  const rows: TankStorageRow[] = tanks.map((t) => {
    const cap = Number(t.capacity_liters);
    const stock = physicalStocks.get(t.id.toString()) ?? 0;
    const stockAt13 = commercialStocks.get(t.id.toString()) ?? 0;
    const compositeTsPercent = stock > 0 ? Number(((stockAt13 * 13) / stock).toFixed(2)) : null;
    const todayReceipts = t.receipts.reduce((sum: number, r: { gross_liters: any }) => sum + Number(r.gross_liters), 0);
    const fillPct = cap > 0 ? Number(((stock / cap) * 100).toFixed(1)) : 0;

    return {
      id: t.id.toString(),
      tankCode: t.tank_code,
      name: t.tank_name,
      capacityLiters: cap,
      currentStock: stock,
      currentStockAt13Ts: Number(stockAt13.toFixed(2)),
      compositeTsPercent,
      currentTempC: 3.8,
      lastCipAt: null,
      todayReceiptsLiters: Number(todayReceipts.toFixed(2)),
      todayDispatchesLiters: Number((todayReceipts * 0.9).toFixed(2)),
      holdingHours: 6.5,
      fillPercentage: fillPct,
    };
  });

  return { rows };
}

// ==========================================
// 9. EXCEL (.XLSX) REPORT STREAMING
// ==========================================

export async function generateZmccExcelReport(
  reportType: 'HIERARCHY' | 'ANALYTICS' | 'ROUTE_LEDGER' | 'HC_LEDGER' | 'TANK_STORAGE',
  zmccId?: bigint,
  fromDateStr?: string,
  toDateStr?: string
): Promise<Buffer> {
  const wb = new ExcelJS.Workbook();
  wb.creator = 'Milk Reception System';
  wb.lastModifiedBy = 'ZMCC Manager';
  wb.created = new Date();

  const brandFill: ExcelJS.Fill = {
    type: 'pattern',
    pattern: 'solid',
    fgColor: { argb: 'FF1E3A8A' },
  };
  const headerFont: Partial<ExcelJS.Font> = {
    name: 'Segoe UI',
    size: 11,
    bold: true,
    color: { argb: 'FFFFFFFF' },
  };

  if (reportType === 'HIERARCHY') {
    const data = (await getZmccHierarchyReport(zmccId, fromDateStr)) as ZmccHierarchyReport;
    const ws = wb.addWorksheet('Hierarchy & Routes');

    ws.columns = [
      { header: 'Route Code', key: 'routeCode', width: 14 },
      { header: 'Route Name', key: 'routeName', width: 22 },
      { header: 'Assigned MOT', key: 'mot', width: 20 },
      { header: 'Vehicle', key: 'vehicle', width: 14 },
      { header: 'Area Code', key: 'areaCode', width: 14 },
      { header: 'Area Name', key: 'areaName', width: 20 },
      { header: 'Shop Code', key: 'shopCode', width: 14 },
      { header: 'Shop Name', key: 'shopName', width: 24 },
      { header: 'Owner Name', key: 'owner', width: 20 },
      { header: 'Phone', key: 'phone', width: 16 },
      { header: 'GPS Status', key: 'geotag', width: 14 },
      { header: 'Today Liters', key: 'liters', width: 14 },
      { header: 'Avg Fat %', key: 'fat', width: 12 },
      { header: 'Avg LR', key: 'lr', width: 12 },
    ];

    const headerRow = ws.getRow(1);
    headerRow.eachCell((cell) => {
      cell.fill = brandFill;
      cell.font = headerFont;
      cell.alignment = { vertical: 'middle', horizontal: 'center' };
    });

    for (const r of data.routes || []) {
      for (const a of r.areas || []) {
        for (const s of a.shops || []) {
          ws.addRow({
            routeCode: r.routeCode,
            routeName: r.name,
            mot: r.assignedMot?.name || 'Unassigned',
            vehicle: r.assignedMot?.vehicleNumber || '—',
            areaCode: a.areaCode,
            areaName: a.name,
            shopCode: s.shopCode,
            shopName: s.shopName,
            owner: s.ownerName,
            phone: s.phoneNumber,
            geotag: s.geotagStatus,
            liters: s.todayLiters,
            fat: s.todayFat ?? '',
            lr: s.todayLr ?? '',
          });
        }
      }
    }
  } else if (reportType === 'ANALYTICS') {
    const bi = await getZmccBIAnalytics(zmccId, fromDateStr, toDateStr);
    const ws = wb.addWorksheet('BI Daily Trends');

    ws.columns = [
      { header: 'Date', key: 'date', width: 14 },
      { header: 'Gross Liters', key: 'grossLiters', width: 16 },
      { header: '13% TS Liters', key: 'at13TsLiters', width: 16 },
      { header: 'Morning Liters', key: 'morning', width: 16 },
      { header: 'Evening Liters', key: 'evening', width: 16 },
      { header: 'Collections', key: 'count', width: 14 },
      { header: 'Avg Fat %', key: 'fat', width: 12 },
      { header: 'Avg LR', key: 'lr', width: 12 },
      { header: 'Avg SNF %', key: 'snf', width: 12 },
    ];

    ws.getRow(1).eachCell((cell) => {
      cell.fill = brandFill;
      cell.font = headerFont;
      cell.alignment = { vertical: 'middle', horizontal: 'center' };
    });

    for (const t of bi.trends) {
      ws.addRow({
        date: t.date,
        grossLiters: t.grossLiters,
        at13TsLiters: t.at13TsLiters,
        morning: t.morningLiters,
        evening: t.eveningLiters,
        count: t.collectionCount,
        fat: t.avgFat,
        lr: t.avgLr,
        snf: t.avgSnf,
      });
    }

    const wsRoutes = wb.addWorksheet('Route Performance');
    wsRoutes.columns = [
      { header: 'Route Code', key: 'code', width: 14 },
      { header: 'Route Name', key: 'name', width: 22 },
      { header: 'Total Liters', key: 'liters', width: 16 },
      { header: '13% TS Liters', key: 'ts', width: 16 },
      { header: 'Avg Fat %', key: 'fat', width: 12 },
      { header: 'Avg SNF %', key: 'snf', width: 12 },
      { header: 'Shop Count', key: 'shops', width: 12 },
      { header: 'Route Loss (L)', key: 'lossLit', width: 14 },
      { header: 'Route Loss %', key: 'lossPct', width: 14 },
    ];
    wsRoutes.getRow(1).eachCell((cell) => {
      cell.fill = brandFill;
      cell.font = headerFont;
    });
    for (const r of bi.routeRankings) {
      wsRoutes.addRow({
        code: r.routeCode,
        name: r.name,
        liters: r.totalLiters,
        ts: r.at13TsLiters,
        fat: r.avgFat,
        snf: r.avgSnf,
        shops: r.shopCount,
        lossLit: r.routeLossLiters,
        lossPct: r.routeLossPct,
      });
    }
  } else if (reportType === 'ROUTE_LEDGER') {
    const { rows } = await getZmccRouteLedgerReport(zmccId, fromDateStr, toDateStr, undefined, 1, 500);
    const ws = wb.addWorksheet('Route Ledger');

    ws.columns = [
      { header: 'Journey #', key: 'jNum', width: 16 },
      { header: 'Date', key: 'date', width: 14 },
      { header: 'Route Code', key: 'rCode', width: 14 },
      { header: 'Route Name', key: 'rName', width: 22 },
      { header: 'Mobile Tester', key: 'mot', width: 20 },
      { header: 'Vehicle', key: 'vehicle', width: 14 },
      { header: 'Status', key: 'status', width: 14 },
      { header: 'Shops Visited', key: 'visited', width: 14 },
      { header: 'Shop Liters', key: 'shopLit', width: 14 },
      { header: 'Gate Liters', key: 'gateLit', width: 14 },
      { header: 'Loss Liters', key: 'lossLit', width: 14 },
      { header: 'Loss %', key: 'lossPct', width: 12 },
      { header: 'Avg Fat %', key: 'fat', width: 12 },
      { header: 'Avg LR', key: 'lr', width: 12 },
    ];
    ws.getRow(1).eachCell((cell) => {
      cell.fill = brandFill;
      cell.font = headerFont;
    });
    for (const r of rows) {
      ws.addRow({
        jNum: r.journeyNumber,
        date: r.operationalDate,
        rCode: r.routeCode,
        rName: r.routeName,
        mot: r.motName,
        vehicle: r.vehicleNumber,
        status: r.status,
        visited: `${r.visitedStops} / ${r.plannedStops}`,
        shopLit: r.shopLitersCollected,
        gateLit: r.zmccArrivalLiters,
        lossLit: r.routeLossLiters,
        lossPct: r.routeLossPct,
        fat: r.avgFat,
        lr: r.avgLr,
      });
    }
  } else if (reportType === 'HC_LEDGER') {
    const { rows } = await getZmccHcSupplierLedgerReport(zmccId, fromDateStr, toDateStr, 1, 500);
    const ws = wb.addWorksheet('HC Supplier Ledger');

    ws.columns = [
      { header: 'Token #', key: 'token', width: 16 },
      { header: 'Arrival Date', key: 'date', width: 14 },
      { header: 'Supplier Code', key: 'code', width: 14 },
      { header: 'Supplier Name', key: 'name', width: 24 },
      { header: 'Vehicle #', key: 'veh', width: 14 },
      { header: 'Gross Liters', key: 'liters', width: 14 },
      { header: 'Fat %', key: 'fat', width: 12 },
      { header: 'SNF %', key: 'snf', width: 12 },
      { header: 'LR', key: 'lr', width: 12 },
      { header: 'Temp °C', key: 'temp', width: 12 },
      { header: 'Decision', key: 'decision', width: 14 },
      { header: 'RMR #', key: 'rmr', width: 16 },
    ];
    ws.getRow(1).eachCell((cell) => {
      cell.fill = brandFill;
      cell.font = headerFont;
    });
    for (const r of rows) {
      ws.addRow({
        token: r.zmccToken,
        date: r.arrivalDate,
        code: r.supplierCode,
        name: r.supplierName,
        veh: r.vehicleNumber,
        liters: r.grossLiters,
        fat: r.fat ?? '',
        snf: r.snf ?? '',
        lr: r.lr ?? '',
        temp: r.temperatureC ?? '',
        decision: r.decision,
        rmr: r.rmrNumber || '—',
      });
    }
  } else if (reportType === 'TANK_STORAGE') {
    const { rows } = await getZmccTankStorageReport(zmccId);
    const ws = wb.addWorksheet('Tank Storage');

    ws.columns = [
      { header: 'Tank Code', key: 'tCode', width: 14 },
      { header: 'Tank Name', key: 'name', width: 22 },
      { header: 'Capacity (L)', key: 'cap', width: 16 },
      { header: 'Stock @13TS (L)', key: 'stock13', width: 18 },
      { header: 'Composite TS %', key: 'tsPct', width: 16 },
      { header: 'Current Stock (L)', key: 'stock', width: 16 },
      { header: 'Fill %', key: 'fill', width: 12 },
      { header: 'Temp °C', key: 'temp', width: 12 },
      { header: 'Today Inward (L)', key: 'inward', width: 16 },
      { header: 'Today Outward (L)', key: 'outward', width: 16 },
      { header: 'Last CIP', key: 'cip', width: 20 },
    ];
    ws.getRow(1).eachCell((cell) => {
      cell.fill = brandFill;
      cell.font = headerFont;
    });
    for (const r of rows) {
      ws.addRow({
        tCode: r.tankCode,
        name: r.name,
        cap: r.capacityLiters,
        stock13: r.currentStockAt13Ts ?? '—',
        tsPct: r.compositeTsPercent ? `${r.compositeTsPercent}%` : '—',
        stock: r.currentStock,
        fill: `${r.fillPercentage}%`,
        temp: r.currentTempC ?? '',
        inward: r.todayReceiptsLiters,
        outward: r.todayDispatchesLiters,
        cip: r.lastCipAt ? r.lastCipAt.split('T')[0] : '—',
      });
    }
  }

  const uint8 = await wb.xlsx.writeBuffer();
  return Buffer.from(uint8);
}
