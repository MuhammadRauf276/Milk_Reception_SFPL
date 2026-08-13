import { prisma } from '../src/backend/core/db';
import bcrypt from 'bcryptjs';

async function resetDevLoginPasswords() {
  if (process.env.NODE_ENV === 'production') {
    console.error('❌ ERROR: Development password reset CANNOT be executed in production environment!');
    process.exit(1);
  }

  console.log('🔧 EXPLICIT DEVELOPMENT PASSWORD RESET INITIATED...');

  const DEV_CREDENTIALS = [
    { username: 'admin.superuser', pass: 'admin123' },
    { username: 'super.admin', pass: 'admin123' },
    { username: 'zmcc.operator', pass: 'mpd123' },
    { username: 'zmcc.manager.north', pass: 'zone123' },
    { username: 'security.gate', pass: 'security123' },
    { username: 'security.head', pass: 'sechead123' },
    { username: 'qa.chemist', pass: 'qa123' },
    { username: 'qa.head', pass: 'qahead123' },
    { username: 'weighbridge.operator', pass: 'weighbridge123' },
    { username: 'weighbridge.02', pass: 'weighbridge123' },
    { username: 'production.operator', pass: 'production123' },
    { username: 'production.head', pass: 'prodhead123' },
    { username: 'general.plant.manager', pass: 'plantmanager123' },
    { username: 'correction.officer', pass: 'correct123' },
  ];

  let count = 0;
  for (const item of DEV_CREDENTIALS) {
    const hash = await bcrypt.hash(item.pass, 10);
    const updated = await prisma.user.updateMany({
      where: { username: item.username },
      data: { password_hash: hash },
    });
    if (updated.count > 0) {
      count++;
    }
  }

  console.log(`✅ Successfully reset development passwords for ${count} system accounts!`);
  await prisma.$disconnect();
}

resetDevLoginPasswords();
