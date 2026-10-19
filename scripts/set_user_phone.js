const { PrismaClient } = require('@prisma/client');
const { PrismaPg } = require('@prisma/adapter-pg');

const prisma = new PrismaClient({
  adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL }),
});

async function main() {
  const targetNumber = '03176826604';
  console.log(`Setting all development phone numbers to exclusively: ${targetNumber}...`);

  // 1. Update all ZMCC Shops
  const shops = await prisma.zmccShop.updateMany({
    data: { phone_number: targetNumber },
  });
  console.log(`Updated ${shops.count} shops with phone number: ${targetNumber}`);

  // 2. Update all MOT Journey Stops snapshots
  const stops = await prisma.motJourneyStop.updateMany({
    data: { phone_number_snapshot: targetNumber },
  });
  console.log(`Updated ${stops.count} journey stop snapshots with phone number: ${targetNumber}`);

  // 3. Update all SMS Outbox recipient phones
  const smsRecords = await prisma.motCollectionSmsOutbox.updateMany({
    data: { recipient_phone: targetNumber },
  });
  console.log(`Updated ${smsRecords.count} SMS outbox records with recipient phone: ${targetNumber}`);

  // 4. Update all Local Suppliers
  const suppliers = await prisma.zmccLocalSupplier.updateMany({
    data: { phone: targetNumber },
  });
  console.log(`Updated ${suppliers.count} local suppliers with phone: ${targetNumber}`);

  // 5. Update MOT Profiles
  const profiles = await prisma.motProfile.updateMany({
    data: { phone_number: targetNumber },
  });
  console.log(`Updated ${profiles.count} MOT profiles with phone: ${targetNumber}`);

  console.log('✅ ALL PHONE NUMBERS IN DATABASE SUCCESSFULLY SET TO 03176826604!');
}

main()
  .catch((e) => {
    console.error('Error updating phone numbers:', e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
