const { PrismaClient } = require('@prisma/client');
const { PrismaPg } = require('@prisma/adapter-pg');
const bcrypt = require('bcryptjs');

const prisma = new PrismaClient({
  adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL }),
});

async function main() {
  const usersToTest = ['zmcc.manager.hasilpur', 'zmcc.manager.jhang'];

  for (const username of usersToTest) {
    const user = await prisma.user.findFirst({
      where: { username },
      include: { procurement_source: true },
    });

    if (!user) {
      console.error(`❌ User ${username} NOT FOUND in database!`);
      continue;
    }

    const isPassValid = await bcrypt.compare('zone123', user.password_hash);
    console.log(`User: ${user.username}`);
    console.log(`  - Full Name: ${user.full_name}`);
    console.log(`  - Role: ${user.role}`);
    console.log(`  - Scope: ${user.scope_type} -> ${user.procurement_source ? `${user.procurement_source.name} (${user.procurement_source.code})` : 'None'}`);
    console.log(`  - Password 'zone123' valid: ${isPassValid ? '✅ YES' : '❌ NO'}`);
    console.log(`  - Active: ${user.is_active ? '✅ YES' : '❌ NO'}`);
  }
}

main().catch(console.error).finally(() => prisma.$disconnect());
