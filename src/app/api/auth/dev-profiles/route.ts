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
        { label: 'MPD Operator — ZMCC Hasilpur', department: 'Milk Procurement (Hasilpur)', username: 'zmcc.operator', password: 'mpd123' },
        { label: 'MPD Operator — ZMCC Jhang', department: 'Milk Procurement (Jhang)', username: 'zmcc.operator.jhang', password: 'mpd123' },
        { label: 'MPD Operator — ZMCC Kabirwala', department: 'Milk Procurement (Kabirwala)', username: 'zmcc.operator.kabirwala', password: 'mpd123' },
        { label: 'MPD Operator — Contractor Al Khair', department: 'Milk Procurement (Al Khair)', username: 'contractor.operator.alkhair', password: 'mpd123' },
        { label: 'MPD Operator — Contractor Al Mehmood', department: 'Milk Procurement (Al Mehmood)', username: 'contractor.operator.almehmood', password: 'mpd123' },
        { label: 'Security Gate Operator', department: 'Security & Weighbridge', username: 'security.gate', password: 'security123' },
        { label: 'QA Lab Chemist', department: 'Quality Assurance Lab', username: 'qa.chemist', password: 'qa123' },
        { label: 'Weighbridge Operator — Shift 1', department: 'Production & Weighbridge', username: 'weighbridge.operator', password: 'weighbridge123' },
        { label: 'Weighbridge Operator — Shift 2', department: 'Production & Weighbridge', username: 'weighbridge.02', password: 'weighbridge123' },
        { label: 'Production Operator', department: 'Plant Production & Silos', username: 'production.operator', password: 'production123' },
      ],
    },
    {
      group: 'MANAGERS',
      items: [
        { label: 'ZMCC / MPD Manager', department: 'Milk Procurement (Zone A)', username: 'zmcc.manager.north', password: 'zone123' },
        { label: 'Security Manager', department: 'Security Management', username: 'security.head', password: 'sechead123' },
        { label: 'QA Department Manager', department: 'QA Management', username: 'qa.head', password: 'qahead123' },
        { label: 'Production Manager', department: 'Production Management', username: 'production.head', password: 'prodhead123' },
        { label: 'General Plant Manager', department: 'Plant Executive Directorate', username: 'general.plant.manager', password: 'plantmanager123' },
      ],
    },
    {
      group: 'ADMINISTRATION',
      items: [
        { label: 'Super Admin', department: 'System Administration', username: 'admin.superuser', password: 'admin123' },
        { label: 'Data Correction Officer', department: 'Plant Audit & Data Corrections', username: 'correction.officer', password: 'correct123' },
      ],
    },
  ];

  return NextResponse.json({ profiles });
}
