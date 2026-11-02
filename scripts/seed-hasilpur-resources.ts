import { prisma } from '../src/backend/core/db';

async function main() {
  const mpdHead = await prisma.user.findFirst({
    where: { username: 'mpd.head' },
    select: { id: true },
  });

  if (!mpdHead) {
    throw new Error('MPD Head user not found');
  }

  const mpdHeadId = mpdHead.id;
  console.log(`Using MPD Head user id: ${mpdHeadId}`);

  // 1. Add new vehicles for Hasilpur (zmcc_id: BigInt(1)) added by MPD Head
  const newVehicles = [
    { vehicle_number: 'HSL-7001', zmcc_id: BigInt(1), created_by: mpdHeadId, is_active: true },
    { vehicle_number: 'HSL-7002', zmcc_id: BigInt(1), created_by: mpdHeadId, is_active: true },
    { vehicle_number: 'HSL-7003', zmcc_id: BigInt(1), created_by: mpdHeadId, is_active: true },
    { vehicle_number: 'BWP-8801', zmcc_id: BigInt(1), created_by: mpdHeadId, is_active: true },
    { vehicle_number: 'BWP-8802', zmcc_id: BigInt(1), created_by: mpdHeadId, is_active: true },
  ];

  for (const v of newVehicles) {
    const existing = await prisma.motVehicle.findUnique({
      where: { vehicle_number: v.vehicle_number },
    });
    if (!existing) {
      const created = await prisma.motVehicle.create({ data: v });
      console.log(`Created vehicle: ${created.vehicle_number} (id: ${created.id})`);
    } else {
      console.log(`Vehicle already exists: ${existing.vehicle_number} (id: ${existing.id})`);
    }
  }

  // 2. Add new MOT escorts for Hasilpur (zmcc_id: 1n)
  const newMots = [
    {
      mot_code: 'MOT-HAS-006',
      name: 'Zahid Hussain',
      phone_number: '0304-5566778',
      cnic: '31201-1111111-1',
      zmcc_id: BigInt(1),
      created_by: mpdHeadId,
      is_active: true,
    },
    {
      mot_code: 'MOT-HAS-007',
      name: 'Farhan Akhtar',
      phone_number: '0305-6677889',
      cnic: '31201-2222222-2',
      zmcc_id: BigInt(1),
      created_by: mpdHeadId,
      is_active: true,
    },
    {
      mot_code: 'MOT-HAS-008',
      name: 'Hamza Javed',
      phone_number: '0306-7788990',
      cnic: '31201-3333333-3',
      zmcc_id: BigInt(1),
      created_by: mpdHeadId,
      is_active: true,
    },
    {
      mot_code: 'MOT-HAS-009',
      name: 'Noman Shah',
      phone_number: '0307-8899001',
      cnic: '31201-4444444-4',
      zmcc_id: BigInt(1),
      created_by: mpdHeadId,
      is_active: true,
    },
  ];

  for (const m of newMots) {
    const existing = await prisma.motProfile.findUnique({
      where: { mot_code: m.mot_code },
    });
    if (!existing) {
      const created = await prisma.motProfile.create({ data: m });
      console.log(`Created MOT escort: ${created.mot_code} - ${created.name} (id: ${created.id})`);
    } else {
      console.log(`MOT escort already exists: ${existing.mot_code} (id: ${existing.id})`);
    }
  }
}

main()
  .catch(console.error)
  .finally(async () => {
    await prisma.$disconnect();
  });
