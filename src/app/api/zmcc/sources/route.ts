import { NextResponse } from 'next/server';
import { resolveZmccAuth } from '@/backend/services/zmccMasterDataService';
import { prisma } from '@core/db';

export async function GET(req: Request) {
  const { auth, errorResponse } = await resolveZmccAuth(req, 'READ');
  if (errorResponse) {
    return NextResponse.json({ error: errorResponse.error }, { status: errorResponse.status });
  }

  try {
    if (auth!.isSuperAdmin) {
      const zmccs = await prisma.procurementSource.findMany({
        where: { source_type: 'ZMCC', is_active: true },
        orderBy: { name: 'asc' },
        select: { id: true, code: true, name: true, is_active: true },
      });
      return NextResponse.json({
        zmccs: zmccs.map((z) => ({
          id: z.id.toString(),
          code: z.code,
          name: z.name,
          is_active: z.is_active,
        })),
      });
    } else {
      const zmcc = await prisma.procurementSource.findUnique({
        where: { id: auth!.effectiveZmccId! },
        select: { id: true, code: true, name: true, is_active: true },
      });
      return NextResponse.json({
        zmccs: zmcc
          ? [
              {
                id: zmcc.id.toString(),
                code: zmcc.code,
                name: zmcc.name,
                is_active: zmcc.is_active,
              },
            ]
          : [],
      });
    }
  } catch (_err) {
    return NextResponse.json({ error: 'Failed to fetch ZMCC sources.' }, { status: 500 });
  }
}
