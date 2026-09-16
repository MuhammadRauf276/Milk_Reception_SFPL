import { prisma } from '../src/backend/core/db';
import bcrypt from 'bcryptjs';

async function resetDevLoginPasswords() {
  if (process.env.NODE_ENV === 'production') {
    console.error('❌ ERROR: Development password reset CANNOT be executed in production environment!');
    process.exit(1);
  }

  console.log('🔧 EXPLICIT DEVELOPMENT PASSWORD RESET INITIATED...');

  const DEV_CREDENTIALS = [
    // Administration
    { username: 'admin.superuser', pass: 'admin123' },
    { username: 'mpd.head', pass: 'mpdhead123' },

    // Managers
    { username: 'zmcc.manager.north', pass: 'zone123' },
    { username: 'contractor.manager.alkhair', pass: 'contractor123' },

    // Operators
    { username: 'phe.operator', pass: 'phe123' },
    { username: 'zmcc.operator', pass: 'mpd123' },
    { username: 'zmcc.operator.jhang', pass: 'mpd123' },
    { username: 'zmcc.operator.kabirwala', pass: 'mpd123' },
    { username: 'mot.driver', pass: 'mot123' },
    { username: 'security.gate', pass: 'security123' },
    { username: 'qa.chemist', pass: 'qa123' },
    { username: 'weighbridge.operator', pass: 'weighbridge123' },
    { username: 'weighbridge.02', pass: 'weighbridge123' },
    { username: 'production.operator', pass: 'production123' },

    // Workspace Pending
    { username: 'executive.management', pass: 'exec123' },
    { username: 'data.executive', pass: 'data123' },
    { username: 'admin.head', pass: 'adminhead123' },
    { username: 'qa.head', pass: 'qahead123' },
    { username: 'production.head', pass: 'prodhead123' },
    { username: 'finance.accounts', pass: 'finance123' },
    { username: 'qa.manager', pass: 'qamgr123' },
    { username: 'contractor.operator.alkhair', pass: 'mpd123' },
    { username: 'contractor.operator.almehmood', pass: 'mpd123' },
  ];

  let count = 0;
  for (const item of DEV_CREDENTIALS) {
    const hash = await bcrypt.hash(item.pass, 10);
    const updated = await prisma.user.updateMany({
      where: { username: item.username, is_active: true },
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
