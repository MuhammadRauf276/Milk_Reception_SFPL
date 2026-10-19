import { NextResponse } from 'next/server';
import { assertProductionSafety } from '@/lib/startupGuards';

export async function GET() {
  try {
    assertProductionSafety();
  } catch (error) {
    // Fail closed: a bad production config must never expose dev logins.
    console.error(error instanceof Error ? error.message : error);
    return NextResponse.json({ error: 'Not found' }, { status: 404 });
  }

  // Development-only. Fails CLOSED: disabled unless NODE_ENV is not 'production'
  // AND NEXT_PUBLIC_ENABLE_DEV_LOGIN_PROFILES is exactly 'true'.
  const devProfilesEnabled =
    process.env.NODE_ENV !== 'production' && process.env.NEXT_PUBLIC_ENABLE_DEV_LOGIN_PROFILES === 'true';
  if (!devProfilesEnabled) {
    return NextResponse.json({ error: 'Not found' }, { status: 404 });
  }

  const profiles = [
    {
      group: 'OPERATORS',
      items: [
        { label: 'PHE Operator (Hasilpur)', department: 'Milk Procurement (Hasilpur)', username: 'phe.operator', password: 'phe123' },
        { label: 'MDO (Hasilpur)', department: 'Milk Procurement (Hasilpur)', username: 'mdo.hasilpur', password: 'mdo123' },
        { label: 'MDO (Jhang)', department: 'Milk Procurement (Jhang)', username: 'mdo.jhang', password: 'mdo123' },
        { label: 'ZMCC Lab Attendant (Hasilpur)', department: 'Milk Procurement (Hasilpur)', username: 'zmcc.operator', password: 'mpd123' },
        { label: 'ZMCC Lab Attendant (Jhang)', department: 'Milk Procurement (Jhang)', username: 'zmcc.operator.jhang', password: 'mpd123' },
        { label: 'ZMCC Lab Attendant (Kabirwala)', department: 'Milk Procurement (Kabirwala)', username: 'zmcc.operator.kabirwala', password: 'mpd123' },
        { label: 'Mobile Tester (MOT)', department: 'Milk Procurement (Hasilpur)', username: 'mot.driver', password: 'mot123' },
        { label: 'Security Gate Operator', department: 'Security', username: 'security.gate', password: 'security123' },
        { label: 'QAE, Reception Lab', department: 'Quality Assurance Lab', username: 'qa.chemist', password: 'qa123' },
        { label: 'Weighbridge Operator (Shift 1)', department: 'Production & Weighbridge', username: 'weighbridge.operator', password: 'weighbridge123' },
        { label: 'Weighbridge Operator (Shift 2)', department: 'Production & Weighbridge', username: 'weighbridge.02', password: 'weighbridge123' },
        { label: 'Production Reception Operator', department: 'Plant Production & Silos', username: 'production.operator', password: 'production123' },
      ],
    },
    {
      group: 'MANAGERS & HEADS',
      items: [
        { label: 'ZMCC Manager (Hasilpur)', department: 'Milk Procurement (Hasilpur)', username: 'zmcc.manager.hasilpur', password: 'zone123' },
        { label: 'ZMCC Manager (Jhang)', department: 'Milk Procurement (Jhang)', username: 'zmcc.manager.jhang', password: 'zone123' },
        { label: 'Plant Contractor Manager (Al Khair)', department: 'Milk Procurement (Al Khair)', username: 'contractor.manager.alkhair', password: 'contractor123' },
        { label: 'MPD Head', department: 'Milk Procurement Directorate', username: 'mpd.head', password: 'mpdhead123' },
        { label: 'AVP, QA Reception Lab', department: 'Quality Assurance Directorate', username: 'qa.head', password: 'qahead123' },
        { label: 'Manager, QA Reception Lab', department: 'Quality Assurance Management', username: 'qa.manager', password: 'qamgr123' },
        { label: 'Production Head', department: 'Production Directorate', username: 'production.head', password: 'prodhead123' },
        { label: 'Admin Head', department: 'Administration Directorate', username: 'admin.head', password: 'adminhead123' },
      ],
    },
    {
      group: 'DIRECTORATE & GOVERNANCE',
      items: [
        { label: 'Super Admin', department: 'System Administration', username: 'admin.superuser', password: 'admin123' },
        { label: 'Data Executive', department: 'Data & Analytics', username: 'data.executive', password: 'data123' },
        { label: 'Senior Executive Management', department: 'Executive Management', username: 'executive.management', password: 'exec123' },
        { label: 'Finance and Accounts', department: 'Finance & Accounts', username: 'finance.accounts', password: 'finance123' },
      ],
    },
    {
      group: 'CONTRACTORS',
      items: [
        { label: 'Contractor Operator (Al Khair)', department: 'Milk Procurement - Contractor Operations', username: 'contractor.operator.alkhair', password: 'mpd123' },
        { label: 'Contractor Operator (Al Mehmood)', department: 'Milk Procurement - Contractor Operations', username: 'contractor.operator.almehmood', password: 'mpd123' },
      ],
    },
  ];

  return NextResponse.json({ profiles });
}
