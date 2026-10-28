import { NextResponse } from 'next/server';
import { assertProductionSafety } from '@/lib/startupGuards';
import { prisma } from '@core/db';

export interface DevItem {
  label: string;
  department: string;
  username: string;
  password?: string;
}

export interface DevGroup {
  group: string;
  items: DevItem[];
}

function getDevPasswordForRole(role: string): string {
  switch (role) {
    case 'MOT':
      return 'mot123';
    case 'MDO':
      return 'mdo123';
    case 'PHE_OPERATOR':
      return 'phe123';
    case 'ZMCC_LAB_ATTENDANT':
    case 'CONTRACTOR_OPERATOR':
      return 'mpd123';
    case 'ZMCC_MANAGER':
      return 'zone123';
    case 'CONTRACTOR_MANAGER':
      return 'contractor123';
    case 'QA_LAB_ATTENDANT':
      return 'qa123';
    case 'QA_HEAD':
      return 'qahead123';
    case 'HEAD_OF_MPD':
      return 'mpdhead123';
    case 'DATA_EXECUTIVE':
    case 'DATA_ANALYST':
      return 'data123';
    case 'EXECUTIVE_MANAGEMENT':
      return 'exec123';
    case 'FINANCE_ACCOUNTS':
      return 'finance123';
    case 'PRODUCTION_HEAD':
      return 'prodhead123';
    case 'ADMIN_HEAD':
      return 'adminhead123';
    case 'WEIGHBRIDGE_OPERATOR':
      return 'weighbridge123';
    case 'PRODUCTION_RECEPTION_OPERATOR':
      return 'production123';
    case 'SECURITY_OPERATOR':
      return 'security123';
    default:
      return 'admin123';
  }
}

function getGroupForRole(role: string): string {
  switch (role) {
    case 'SUPER_ADMIN':
    case 'DATA_EXECUTIVE':
    case 'DATA_ANALYST':
    case 'EXECUTIVE_MANAGEMENT':
    case 'FINANCE_ACCOUNTS':
      return 'Directorate';
    case 'HEAD_OF_MPD':
    case 'ZMCC_MANAGER':
    case 'QA_HEAD':
    case 'PRODUCTION_HEAD':
    case 'ADMIN_HEAD':
    case 'CONTRACTOR_MANAGER':
      return 'Managers';
    case 'PHE_OPERATOR':
    case 'MDO':
    case 'ZMCC_LAB_ATTENDANT':
    case 'MOT':
    case 'QA_LAB_ATTENDANT':
    case 'WEIGHBRIDGE_OPERATOR':
    case 'PRODUCTION_RECEPTION_OPERATOR':
    case 'SECURITY_OPERATOR':
      return 'FIELD & PLANT OPERATORS';
    case 'CONTRACTOR_OPERATOR':
      return 'CONTRACTORS';
    default:
      return 'FIELD & PLANT OPERATORS';
  }
}

function formatLabel(user: { role: string; full_name?: string | null; username: string; procurement_source?: { name: string } | null }): string {
  const sourceName = user.procurement_source?.name?.replace(/^(ZMCC|Zone)\s*/i, '').trim();
  switch (user.role) {
    case 'SUPER_ADMIN':
      return 'Super Admin';
    case 'DATA_EXECUTIVE':
    case 'DATA_ANALYST':
      return 'Data Executive';
    case 'EXECUTIVE_MANAGEMENT':
      return 'Executive';
    case 'FINANCE_ACCOUNTS':
      return 'Finance';
    case 'HEAD_OF_MPD':
      return 'MPD Head';
    case 'QA_HEAD':
      return 'QA Head';
    case 'PRODUCTION_HEAD':
      return 'Production Head';
    case 'ADMIN_HEAD':
      return 'Admin Head';
    case 'ZMCC_MANAGER':
      return sourceName ? `ZMCC Mgr, ${sourceName}` : 'ZMCC Manager';
    case 'CONTRACTOR_MANAGER':
      return sourceName ? `Contractor Mgr, ${sourceName}` : 'Contractor Manager';
    case 'PHE_OPERATOR':
      return sourceName ? `PHE, ${sourceName}` : 'PHE';
    case 'MDO':
      return sourceName ? `MDO, ${sourceName}` : (user.full_name || 'MDO');
    case 'ZMCC_LAB_ATTENDANT':
      return sourceName ? `ZMCC Lab, ${sourceName}` : 'ZMCC Lab';
    case 'MOT':
      return user.full_name ? `Mobile Tester · ${user.full_name}` : 'Mobile Tester';
    case 'QA_LAB_ATTENDANT':
      return 'QAE';
    case 'WEIGHBRIDGE_OPERATOR':
      return user.full_name || 'Weighbridge Operator';
    case 'PRODUCTION_RECEPTION_OPERATOR':
      return 'Production Operator';
    case 'SECURITY_OPERATOR':
      return 'Gate Operator';
    case 'CONTRACTOR_OPERATOR':
      return sourceName ? `Contractor, ${sourceName}` : (user.full_name || 'Contractor Operator');
    default:
      return user.full_name || user.username;
  }
}

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

  try {
    const users = await prisma.user.findMany({
      where: { is_active: true },
      include: {
        procurement_source: { select: { name: true, code: true } },
      },
      orderBy: [
        { role: 'asc' },
        { full_name: 'asc' },
        { username: 'asc' },
      ],
    });

    const groupOrder = ['Directorate', 'Managers', 'FIELD & PLANT OPERATORS', 'CONTRACTORS'];
    const groupsMap: Record<string, DevItem[]> = {
      Directorate: [],
      Managers: [],
      'FIELD & PLANT OPERATORS': [],
      CONTRACTORS: [],
    };

    // Filter out email-style duplicates (e.g. qa.head@... when qa.head exists)
    // and alias duplicates (e.g. zmcc.manager.north when zmcc.manager.hasilpur exists, mdo when mdo.hasilpur exists)
    const ignoredUsernames = new Set([
      'qa.head@shakarganj.com.pk',
      'qa.reception@shakarganj.com.pk',
      'zmcc.manager.north',
      'mdo',
      'qa.manager', // retired
    ]);

    for (const u of users) {
      if (ignoredUsernames.has(u.username)) continue;

      const groupName = getGroupForRole(u.role);
      if (!groupsMap[groupName]) {
        groupsMap[groupName] = [];
      }

      groupsMap[groupName].push({
        label: formatLabel(u),
        department: u.department || u.procurement_source?.name || 'Operations',
        username: u.username,
        password: getDevPasswordForRole(u.role),
      });
    }

    const profiles: DevGroup[] = groupOrder
      .filter((g) => groupsMap[g] && groupsMap[g].length > 0)
      .map((group) => ({
        group,
        items: groupsMap[group],
      }));

    return NextResponse.json({ profiles });
  } catch (err) {
    console.error('[API_DEV_PROFILES_ERROR]', err);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
