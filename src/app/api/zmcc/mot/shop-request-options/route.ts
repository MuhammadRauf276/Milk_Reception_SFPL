import { NextResponse } from 'next/server';
import { prisma } from '@/backend/core/db';
import { isInMotScope, resolveMotAuth } from '@/backend/services/motService';

/** The lists the Mobile Tester's new shop form chooses from. */
export async function GET(req: Request) {
  const { auth, errorResponse } = await resolveMotAuth(req, 'READ_CURRENT_JOURNEY');
  if (errorResponse) {
    return NextResponse.json({ error: errorResponse.error }, { status: errorResponse.status });
  }

  const routeParam = new URL(req.url).searchParams.get('route_id') ?? '';
  if (!/^\d+$/.test(routeParam)) {
    return NextResponse.json({ error: 'Valid route_id is required.' }, { status: 400 });
  }

  try {
    const route = await prisma.zmccRoute.findUnique({ where: { id: BigInt(routeParam) }, select: { zmcc_id: true } });
    if (!route) return NextResponse.json({ error: 'Route not found.' }, { status: 404 });
    if (!isInMotScope(auth!, route.zmcc_id)) {
      return NextResponse.json({ error: 'Forbidden. Route belongs to another ZMCC.' }, { status: 403 });
    }

    const [areas, chillers, routes] = await Promise.all([
      // Areas belong to the ZMCC. The areas this route already passes through come first.
      prisma.zmccArea.findMany({
        where: { zmcc_id: route.zmcc_id, is_active: true },
        orderBy: { name: 'asc' },
        select: {
          id: true,
          name: true,
          area_code: true,
          _count: {
            select: {
              shops: {
                where: { OR: [{ route_id: BigInt(routeParam) }, { route_links: { some: { route_id: BigInt(routeParam) } } }] },
              },
            },
          },
        },
      }),
      prisma.chillerOwnership.findMany({
        where: { is_active: true },
        orderBy: { name: 'asc' },
        select: { id: true, name: true },
      }),
      prisma.zmccRoute.findMany({
        where: { zmcc_id: route.zmcc_id, is_active: true },
        orderBy: { name: 'asc' },
        select: { id: true, name: true, route_code: true },
      }),
    ]);

    return NextResponse.json({
      areas: [...areas]
        .sort((a, b) => Number(b._count.shops > 0) - Number(a._count.shops > 0))
        .map((a) => ({ id: a.id.toString(), name: a.name, area_code: a.area_code })),
      chillers: chillers.map((c) => ({ id: c.id.toString(), name: c.name })),
      routes: routes.map((r) => ({ id: r.id.toString(), name: r.name, route_code: r.route_code })),
    });
  } catch (err) {
    console.error('GET /api/zmcc/mot/shop-request-options error:', err);
    return NextResponse.json({ error: 'Failed to load the shop form lists.' }, { status: 500 });
  }
}
