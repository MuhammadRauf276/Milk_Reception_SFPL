const { PrismaClient } = require('@prisma/client');
const { PrismaPg } = require('@prisma/adapter-pg');

const prisma = new PrismaClient({
  adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL }),
});

async function main() {
  console.log('Seeding authentic presentation operational data for Hasilpur...');

  // 1. Clean up legacy milk source names if any
  await prisma.zmccMilkSource.updateMany({
    where: { erp_code: '181' },
    data: { erp_code: 'MS-HAS-02', name: 'Hasilpur Dairy Farmers Association' },
  });
  await prisma.zmccMilkSource.updateMany({
    where: { erp_code: '789' },
    data: { erp_code: 'MS-HAS-03', name: 'Chak 124 Chilling Center Supply' },
  });
  console.log('Sanitized milk sources');

  // 2. Fetch required master IDs
  const zmcc = await prisma.procurementSource.findUnique({ where: { code: 'ZMCC-HASILPUR' } });
  if (!zmcc) throw new Error('ZMCC-HASILPUR procurement source not found');

  const route1 = await prisma.zmccRoute.findFirst({ where: { route_code: 'RT-HAS-001' } });
  const route2 = await prisma.zmccRoute.findFirst({ where: { route_code: 'RT-HAS-002' } });
  if (!route1 || !route2) throw new Error('Routes RT-HAS-001 or RT-HAS-002 not found');

  const area1 = await prisma.zmccArea.findFirst({ where: { area_code: 'AR-HAS-01' } });
  const area2 = await prisma.zmccArea.findFirst({ where: { area_code: 'AR-HAS-02' } });
  if (!area1 || !area2) throw new Error('Areas AR-HAS-01 or AR-HAS-02 not found');

  // Milk sources are independent (name + ERP code) and assigned to the ZMCC; shops have no source.
  const dataExecutive =
    (await prisma.user.findFirst({ where: { role: 'DATA_EXECUTIVE', is_active: true } })) ||
    (await prisma.user.findFirst({ where: { role: 'SUPER_ADMIN', is_active: true } }));
  if (!dataExecutive) throw new Error('Data Executive (or Super Admin) user not found');

  const milkSource1 = await prisma.zmccMilkSource.upsert({
    where: { erp_code: 'MS-HAS-01' },
    update: { is_active: true },
    create: { erp_code: 'MS-HAS-01', name: 'Hasilpur Farmers Group', is_active: true, created_by: dataExecutive.id },
  });
  for (const code of ['MS-HAS-01', 'MS-HAS-02', 'MS-HAS-03']) {
    const src = await prisma.zmccMilkSource.findUnique({ where: { erp_code: code } });
    if (!src) continue;
    await prisma.milkSourceZmccVisibility.upsert({
      where: { milk_source_id_zmcc_id: { milk_source_id: src.id, zmcc_id: zmcc.id } },
      update: { is_active: true },
      create: { milk_source_id: src.id, zmcc_id: zmcc.id, is_active: true },
    });
  }

  const chillerShakarganj = await prisma.chillerOwnership.findFirst({ where: { ownership_code: 'SHAKARGANJ' } });
  const chillerSelf = await prisma.chillerOwnership.findFirst({ where: { ownership_code: 'SELF' } });
  const chillerNestle = await prisma.chillerOwnership.findFirst({ where: { ownership_code: 'NESTLE' } });
  const chillerEngro = await prisma.chillerOwnership.findFirst({ where: { ownership_code: 'ENGRO' } });
  const chillerHaleeb = await prisma.chillerOwnership.findFirst({ where: { ownership_code: 'HALEEB' } });

  const zmccManager = await prisma.user.findFirst({ where: { username: 'zmcc.manager.north' } });
  const pheUser = await prisma.user.findFirst({ where: { username: 'phe.operator' } });
  const motUser = await prisma.user.findFirst({ where: { username: 'mot.driver' } });
  if (!zmccManager || !pheUser || !motUser) throw new Error('Standard users not found');

  // 3. Link MOT Profile to mot.driver User
  const motProfile = await prisma.motProfile.findFirst({ where: { mot_code: 'MOT-HAS-001' } });
  if (!motProfile) throw new Error('MOT Profile MOT-HAS-001 not found');

  await prisma.motProfile.update({
    where: { id: motProfile.id },
    data: {
      user_id: motUser.id,
      name: 'Muhammad Tariq',
      phone_number: '03176826604',
      cnic: '31202-1234568-1',
    },
  });
  console.log(`Linked MC Profile ${motProfile.mot_code} to user ${motUser.username} (id: ${motUser.id})`);

  // 4. Upsert Authentic Shops in Hasilpur
  const shopsToSeed = [
    // Existing: SHP-000001 (Al-Madina Milk Center), SHP-000002 (Chaudhry Bashir Dairy Shop)
    {
      shop_code: 'SHP-000003',
      shop_name: 'Bismillah Dairy Collection Center',
      owner_name: 'Muhammad Aslam',
      phone_number: '03176826604',
      cnic: '31202-3456789-3',
      area_id: area1.id,
      route_id: route1.id,
      chiller_id: chillerShakarganj?.id || 1n,
      lat: 29.7025,
      lon: 72.5582,
      approval_status: 'ACTIVE',
    },
    {
      shop_code: 'SHP-000004',
      shop_name: 'Gulzar-e-Madina Milk Shop',
      owner_name: 'Malik Gulzar Ahmad',
      phone_number: '03176826604',
      cnic: '31202-4567890-4',
      area_id: area1.id,
      route_id: route1.id,
      chiller_id: chillerSelf?.id || 1n,
      lat: 29.7088,
      lon: 72.5635,
      approval_status: 'ACTIVE',
    },
    {
      shop_code: 'SHP-000005',
      shop_name: 'Subhan Allah Dairy Farm',
      owner_name: 'Mian Tariq Mehmood',
      phone_number: '03176826604',
      cnic: '31202-5678901-5',
      area_id: area1.id,
      route_id: route1.id,
      chiller_id: chillerShakarganj?.id || 1n,
      lat: 29.7142,
      lon: 72.5698,
      approval_status: 'ACTIVE',
    },
    {
      shop_code: 'SHP-000006',
      shop_name: 'Kisan Milk Point',
      owner_name: 'Chaudhry Manzoor Hussain',
      phone_number: '03176826604',
      cnic: '31202-6789012-6',
      area_id: area1.id,
      route_id: route1.id,
      chiller_id: chillerEngro?.id || 1n,
      lat: 29.7195,
      lon: 72.5742,
      approval_status: 'ACTIVE',
    },
    {
      shop_code: 'SHP-000007',
      shop_name: 'Madni Chilling Center',
      owner_name: 'Haji Abdul Rehman',
      phone_number: '03176826604',
      cnic: '31202-7891234-7',
      area_id: area1.id,
      route_id: route1.id,
      chiller_id: chillerShakarganj?.id || 1n,
      lat: 29.7240,
      lon: 72.5810,
      approval_status: 'ACTIVE',
    },
    {
      shop_code: 'SHP-000008',
      shop_name: 'Ittehad Dairy Collection',
      owner_name: 'Rana Liaqat Ali',
      phone_number: '03176826604',
      cnic: '31202-7890123-7',
      area_id: area2.id,
      route_id: route2.id,
      chiller_id: chillerShakarganj?.id || 1n,
      lat: 29.7110,
      lon: 72.5420,
      approval_status: 'ACTIVE',
    },
    {
      shop_code: 'SHP-000009',
      shop_name: 'Pak Dairy Center Chak 124',
      owner_name: 'Hafiz Muhammad Saeed',
      phone_number: '03176826604',
      cnic: '31202-8901234-8',
      area_id: area2.id,
      route_id: route2.id,
      chiller_id: chillerHaleeb?.id || 1n,
      lat: 29.7180,
      lon: 72.5360,
      approval_status: 'ACTIVE',
    },
    {
      shop_code: 'SHP-000010',
      shop_name: 'Dastgir Cattle & Milk Center',
      owner_name: 'Syed Dastgir Shah',
      phone_number: '03176826604',
      cnic: '31202-9012345-9',
      area_id: area2.id,
      route_id: route2.id,
      chiller_id: chillerSelf?.id || 1n,
      lat: 29.7255,
      lon: 72.5290,
      approval_status: 'ACTIVE',
    },
    // Also 2 Pending Shop Requests for presentation of the approval workflow
    {
      shop_code: 'SHP-000011',
      shop_name: 'Rehmat-e-Shireen Milk Point',
      owner_name: 'Chaudhry Rehmat Ali',
      phone_number: '03176826604',
      cnic: '31202-1122334-1',
      area_id: area1.id,
      route_id: route1.id,
      chiller_id: chillerSelf?.id || 1n,
      lat: 29.7280,
      lon: 72.5850,
      approval_status: 'PENDING_APPROVAL',
    },
    {
      shop_code: 'SHP-000012',
      shop_name: 'Anwar Dairy Collection Point',
      owner_name: 'Mian Anwar Ul Haq',
      phone_number: '03176826604',
      cnic: '31202-4455667-2',
      area_id: area2.id,
      route_id: route2.id,
      chiller_id: chillerShakarganj?.id || 1n,
      lat: 29.7310,
      lon: 72.5210,
      approval_status: 'PENDING_APPROVAL',
    },
  ];

  for (const s of shopsToSeed) {
    const existing = await prisma.zmccShop.findUnique({ where: { shop_code: s.shop_code } });
    if (!existing) {
      await prisma.zmccShop.create({
        data: {
          shop_code: s.shop_code,
          shop_name: s.shop_name,
          owner_name: s.owner_name,
          phone_number: s.phone_number,
          cnic: s.cnic,
          area_id: s.area_id,
          route_id: s.route_id,
          zmcc_id: zmcc.id,
          chiller_ownership_id: s.chiller_id,
          latitude: s.lat,
          longitude: s.lon,
          is_active: true,
          approval_status: s.approval_status,
          geotag_status: 'VERIFIED',
          created_by: zmccManager.id,
        },
      });
      console.log(`Created shop ${s.shop_code} (${s.shop_name}) [${s.approval_status}]`);
    } else {
      await prisma.zmccShop.update({
        where: { id: existing.id },
        data: {
          shop_name: s.shop_name,
          owner_name: s.owner_name,
          phone_number: s.phone_number,
          latitude: s.lat,
          longitude: s.lon,
          approval_status: s.approval_status,
          geotag_status: 'VERIFIED',
        },
      });
    }
  }

  // 5. Complete yesterday's journey 24 so that MOT has only one active journey today
  await prisma.motJourney.updateMany({
    where: {
      status: 'COLLECTING',
      journey_number: 'MJ-20261006-0001',
    },
    data: {
      status: 'COMPLETED',
      ended_at: new Date('2026-10-06T18:30:00.000Z'),
    },
  });

  // 6. Check or create today's active journey for MOT-HAS-001 (Muhammad Tariq)
  // Vehicles are registered by the Data Executive only.
  const vehicle =
    (await prisma.motVehicle.findFirst({ where: { vehicle_number: 'BWP-5522' } })) ||
    (await prisma.motVehicle.create({
      data: { vehicle_number: 'BWP-5522', zmcc_id: zmcc.id, is_active: true, created_by: dataExecutive.id },
    }));

  const todayStr = '2026-10-07';
  const journeyNumber = `MJ-20261007-0001`;

  let activeJourney = await prisma.motJourney.findUnique({
    where: { journey_number: journeyNumber },
  });

  if (!activeJourney) {
    activeJourney = await prisma.motJourney.create({
      data: {
        journey_number: journeyNumber,
        operational_date: new Date(`${todayStr}T00:00:00.000Z`),
        zmcc_id: zmcc.id,
        route_id: route1.id,
        mot_profile_id: motProfile.id,
        mot_vehicle_id: vehicle.id,
        status: 'COLLECTING',
        assigned_by: zmccManager.id,
        assigned_at: new Date(`${todayStr}T06:30:00.000Z`),
        assignment_latitude: 29.6980,
        assignment_longitude: 72.5540,
        assignment_gps_accuracy: 5.0,
        started_at: new Date(`${todayStr}T07:00:00.000Z`),
        start_latitude: 29.6980,
        start_longitude: 72.5540,
        first_mot_gps_at: new Date(`${todayStr}T07:15:00.000Z`),
        first_mot_latitude: 29.6985,
        first_mot_longitude: 72.5545,
        first_mot_gps_accuracy: 4.2,
        idempotency_key: `JOURNEY:${journeyNumber}`,
      },
    });
    console.log(`Created Active Journey ${journeyNumber} for MOT Muhammad Tariq on Route RT-HAS-001`);
  } else {
    activeJourney = await prisma.motJourney.update({
      where: { id: activeJourney.id },
      data: {
        status: 'COLLECTING',
        mot_profile_id: motProfile.id,
        mot_vehicle_id: vehicle.id,
        route_id: route1.id,
      },
    });
    console.log(`Updated Active Journey ${journeyNumber}`);
  }

  // 7. Seed Planned Route Stops on Route RT-HAS-001
  const route1Shops = await prisma.zmccShop.findMany({
    where: {
      route_id: route1.id,
      approval_status: 'ACTIVE',
      shop_code: { in: ['SHP-000001', 'SHP-000003', 'SHP-000004', 'SHP-000005', 'SHP-000006', 'SHP-000007'] },
    },
    orderBy: { shop_code: 'asc' },
  });

  const stopConfig = [
    { code: 'SHP-000001', seq: 1, status: 'VISITED', arrived: '07:20:00', completed: '07:35:00', qty: 145.0, lr: 28.5, fat: 3.9, rmr: '005101' },
    { code: 'SHP-000003', seq: 2, status: 'VISITED', arrived: '07:50:00', completed: '08:05:00', qty: 210.0, lr: 29.0, fat: 4.1, rmr: '005102' },
    { code: 'SHP-000004', seq: 3, status: 'PENDING' },
    { code: 'SHP-000005', seq: 4, status: 'PENDING' },
    { code: 'SHP-000006', seq: 5, status: 'PENDING' },
    { code: 'SHP-000007', seq: 6, status: 'PENDING' },
  ];

  for (const cfg of stopConfig) {
    const shop = route1Shops.find(s => s.shop_code === cfg.code);
    if (!shop) continue;

    let stop = await prisma.motJourneyStop.findUnique({
      where: {
        journey_id_shop_id: {
          journey_id: activeJourney.id,
          shop_id: shop.id,
        },
      },
    });

    const stopData = {
      planned_sequence: cfg.seq,
      status: cfg.status,
      shop_code_snapshot: shop.shop_code,
      shop_name_snapshot: shop.shop_name,
      owner_name_snapshot: shop.owner_name,
      phone_number_snapshot: shop.phone_number,
      area_code_snapshot: area1.area_code,
      area_name_snapshot: area1.name,
      planned_latitude_snapshot: shop.latitude,
      planned_longitude_snapshot: shop.longitude,
      arrived_at: cfg.arrived ? new Date(`${todayStr}T${cfg.arrived}.000Z`) : null,
      completed_at: cfg.completed ? new Date(`${todayStr}T${cfg.completed}.000Z`) : null,
    };

    if (!stop) {
      stop = await prisma.motJourneyStop.create({
        data: {
          journey_id: activeJourney.id,
          shop_id: shop.id,
          ...stopData,
        },
      });
      console.log(`Created Stop #${cfg.seq} for ${shop.shop_name} (${cfg.status})`);
    } else {
      stop = await prisma.motJourneyStop.update({
        where: { id: stop.id },
        data: stopData,
      });
    }

    // If Visited, add collection record & SMS
    if (cfg.status === 'VISITED' && cfg.qty && cfg.lr && cfg.fat) {
      const existingCollection = await prisma.motShopCollection.findUnique({
        where: { journey_stop_id: stop.id },
      });

      const density = 1.0295;
      const snf = 8.52;
      const ts = Number((snf + cfg.fat).toFixed(2));
      const at13ts = Number(((cfg.qty * ts) / 13.0).toFixed(2));
      const colNum = `MC-${todayStr.replace(/-/g, '')}-${String(cfg.seq).padStart(4, '0')}`;

      if (!existingCollection) {
        const collection = await prisma.motShopCollection.create({
          data: {
            collection_number: colNum,
            journey_id: activeJourney.id,
            journey_stop_id: stop.id,
            shop_id: shop.id,
            zmcc_id: zmcc.id,
            route_id: route1.id,
            mot_profile_id: motProfile.id,
            mot_vehicle_id: vehicle.id,
            operational_date: new Date(`${todayStr}T00:00:00.000Z`),
            client_event_id: `evt-col-${cfg.seq}-${todayStr}`,
            quantity_value: cfg.qty,
            quantity_unit: 'LITER',
            gross_liters: cfg.qty,
            density: density,
            lr: cfg.lr,
            fat: cfg.fat,
            snf: snf,
            ts: ts,
            at_13ts_liters: at13ts,
            calculation_version: '1.0',
            collection_latitude: shop.latitude || 29.7000,
            collection_longitude: shop.longitude || 72.5550,
            collection_gps_accuracy: 3.5,
            device_collected_at: new Date(`${todayStr}T${cfg.completed}.000Z`),
            submitted_by_user_id: motUser.id,
            milk_source_id: milkSource1.id,
            milk_source_code_snapshot: milkSource1.erp_code,
            milk_source_name_snapshot: milkSource1.name,
            shop_rmr_number: cfg.rmr,
            collection_notes: 'Morning collection verified and tested on portable lactometer.',
          },
        });

        await prisma.motCollectionSmsOutbox.create({
          data: {
            collection_id: collection.id,
            recipient_phone: shop.phone_number,
            message_body: `Shakarganj Milk Reception: Collected ${cfg.qty.toFixed(1)} L (LR: ${cfg.lr.toFixed(1)}, Fat: ${cfg.fat.toFixed(1)}%) from ${shop.shop_name} on ${todayStr}. RMR: ${cfg.rmr}`,
            status: 'SENT',
            sent_at: new Date(`${todayStr}T${cfg.completed}.000Z`),
          },
        });
        console.log(`Created Collection ${colNum} (${cfg.qty} L) & SMS Outbox for ${shop.shop_name}`);
      }
    }
  }

  // 8. Insert Live GPS Tracking Breadcrumbs
  const breadcrumbs = [
    { time: '07:05:00', lat: 29.6980, lon: 72.5540, key: 'gps-01' },
    { time: '07:20:00', lat: 29.6974, lon: 72.5539, key: 'gps-02' },
    { time: '07:40:00', lat: 29.7001, lon: 72.5560, key: 'gps-03' },
    { time: '07:50:00', lat: 29.7025, lon: 72.5582, key: 'gps-04' },
    { time: '08:15:00', lat: 29.7055, lon: 72.5608, key: 'gps-05' },
    { time: '08:25:00', lat: 29.7072, lon: 72.5622, key: 'gps-06' },
  ];

  for (const b of breadcrumbs) {
    const existing = await prisma.motJourneyLocation.findUnique({
      where: { idempotency_key: `GPS:${journeyNumber}:${b.key}` },
    });
    if (!existing) {
      await prisma.motJourneyLocation.create({
        data: {
          journey_id: activeJourney.id,
          recorded_by_user_id: motUser.id,
          source_type: 'MOT_DEVICE',
          latitude: b.lat,
          longitude: b.lon,
          gps_accuracy: 4.0,
          device_recorded_at: new Date(`${todayStr}T${b.time}.000Z`),
          idempotency_key: `GPS:${journeyNumber}:${b.key}`,
        },
      });
    }
  }
  console.log(`Inserted ${breadcrumbs.length} GPS breadcrumb locations for journey live map`);

  console.log('✅ ALL PRESENTATION DATA SEEDED SUCCESSFULLY!');
}

main()
  .catch((e) => {
    console.error('Error seeding presentation data:', e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
