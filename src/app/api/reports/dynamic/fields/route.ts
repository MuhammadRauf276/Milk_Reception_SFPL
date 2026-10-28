import { NextResponse } from 'next/server';
import { getCurrentUser } from '@/backend/core/auth';
import { canActAs } from '@/backend/core/roles/hierarchy';
import {
  DOMAIN_FIELD_MAP,
  SYSTEM_DEFAULT_TEMPLATES,
} from '@/backend/services/dynamicReportEngine';

export async function GET(req: Request) {
  try {
    const user = await getCurrentUser(req);
    if (!user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const isAuthorized =
      canActAs(user.role, 'ZMCC_MANAGER') ||
      user.role === 'HEAD_OF_MPD' ||
      user.role === 'SUPER_ADMIN' ||
      user.role === 'DATA_EXECUTIVE' ||
      user.role === 'EXECUTIVE_MANAGEMENT';

    if (!isAuthorized) {
      return NextResponse.json(
        { error: 'Forbidden. ZMCC Manager or executive authority required.' },
        { status: 403 }
      );
    }

    const domains = [
      { id: 'MOT_COLLECTIONS', label: 'MOT Route Collections', description: 'Collection stop telemetry, liters, fat, LR, and lab outcomes' },
      { id: 'HC_SUPPLIERS', label: 'Direct HC Local Suppliers', description: 'Local supplier intake, test results, tokens, and RMR slips' },
      { id: 'JOURNEY_RECONCILIATION', label: 'MOT Journey Reconciliation', description: 'Journey runs, planned vs visited stops, gate reception, and route loss' },
      { id: 'TANK_STORAGE', label: 'Silo Tank Inventory', description: 'Physical silo stock, capacity utilization, temperature, and CIP state' },
      { id: 'PLANT_TRANSIT', label: 'Plant Transit & Dispatches', description: 'Dispatched tankers, plant arrival volumes, and transit loss' },
      { id: 'QUALITY_SCREENING', label: 'Quality Lab Screening', description: 'Lab tests, fat/LR/SNF, adulteration strips, and rejection reasons' },
    ];

    return NextResponse.json({
      domains,
      fieldMap: DOMAIN_FIELD_MAP,
      defaultTemplates: SYSTEM_DEFAULT_TEMPLATES,
    });
  } catch (error: any) {
    return NextResponse.json(
      { error: error?.message || 'Failed to fetch dynamic report metadata' },
      { status: 500 }
    );
  }
}
