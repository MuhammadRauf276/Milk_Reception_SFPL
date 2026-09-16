import { NextResponse } from 'next/server';

export async function GET() {
  // Strict Double Gating:
  // 1. Environment check
  // 2. Explicit flag check
  const isDev = process.env.NODE_ENV !== 'production';
  const isFlagEnabled = process.env.NEXT_PUBLIC_ENABLE_DEV_LOGIN_PROFILES === 'true';

  if (!isDev || !isFlagEnabled) {
    return NextResponse.json({ error: 'Development profiles disabled' }, { status: 404 });
  }

  const profiles = [
    {
      group: 'OPERATORS',
      items: [
        { label: 'PHE Operator — Hasilpur', department: 'Milk Procurement (Hasilpur)', username: 'phe.operator', password: 'phe123' },
        { label: 'ZMCC Lab Attendant — Hasilpur', department: 'Milk Procurement (Hasilpur)', username: 'zmcc.operator', password: 'mpd123' },
        { label: 'ZMCC Lab Attendant — Jhang', department: 'Milk Procurement (Jhang)', username: 'zmcc.operator.jhang', password: 'mpd123' },
        { label: 'ZMCC Lab Attendant — Kabirwala', department: 'Milk Procurement (Kabirwala)', username: 'zmcc.operator.kabirwala', password: 'mpd123' },
        { label: 'MOT Operator', department: 'Milk Procurement (Hasilpur)', username: 'mot.driver', password: 'mot123' },
        { label: 'Security Gate Operator', department: 'Security', username: 'security.gate', password: 'security123' },
        { label: 'QA Lab Chemist', department: 'Quality Assurance Lab', username: 'qa.chemist', password: 'qa123' },
        { label: 'Weighbridge Operator — Shift 1', department: 'Production & Weighbridge', username: 'weighbridge.operator', password: 'weighbridge123' },
        { label: 'Weighbridge Operator — Shift 2', department: 'Production & Weighbridge', username: 'weighbridge.02', password: 'weighbridge123' },
        { label: 'Production Reception Operator', department: 'Plant Production & Silos', username: 'production.operator', password: 'production123' },
      ],
    },
    {
      group: 'MANAGERS',
      items: [
        { label: 'ZMCC / MPD Manager', department: 'Milk Procurement (Zone A)', username: 'zmcc.manager.north', password: 'zone123' },
        { label: 'Plant Contractor Manager — Al Khair', department: 'Milk Procurement (Al Khair)', username: 'contractor.manager.alkhair', password: 'contractor123' },
      ],
    },
    {
      group: 'ADMINISTRATION',
      items: [
        { label: 'Super Admin', department: 'System Administration', username: 'admin.superuser', password: 'admin123' },
        { label: 'MPD Head', department: 'Milk Procurement Directorate', username: 'mpd.head', password: 'mpdhead123' },
      ],
    },
    {
      group: 'WORKSPACE PENDING',
      items: [
        { label: 'Senior Executive Management', department: 'Executive Management', username: 'executive.management', password: 'exec123' },
        { label: 'Data Executive', department: 'Data & Analytics', username: 'data.executive', password: 'data123' },
        { label: 'Admin Head', department: 'Administration Directorate', username: 'admin.head', password: 'adminhead123' },
        { label: 'QA Head', department: 'Quality Assurance Directorate', username: 'qa.head', password: 'qahead123' },
        { label: 'Production Head', department: 'Production Directorate', username: 'production.head', password: 'prodhead123' },
        { label: 'Finance and Accounts', department: 'Finance & Accounts', username: 'finance.accounts', password: 'finance123' },
        { label: 'QA Manager', department: 'Quality Assurance Management', username: 'qa.manager', password: 'qamgr123' },
        { label: 'Wasim Sahib (Contractor Operator)', department: 'Milk Procurement - Contractor Operations', username: 'contractor.operator.alkhair', password: 'mpd123' },
        { label: 'Contractor Operator (Al Mehmood)', department: 'Milk Procurement - Contractor Operations', username: 'contractor.operator.almehmood', password: 'mpd123' },
      ],
    },
  ];

  return NextResponse.json({ profiles });
}
