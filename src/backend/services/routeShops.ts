import { Prisma } from '@prisma/client';

/**
 * One rule for "the shops of a route": shops whose home route it is, plus shops
 * linked to it through zmcc_route_shop. Use this in every shop-of-route query.
 */
export function shopsOnRouteWhere(routeId: bigint): Prisma.ZmccShopWhereInput {
  return { OR: [{ route_id: routeId }, { route_links: { some: { route_id: routeId } } }] };
}

/** Route ids a shop is listed on, home route first, no repeats. */
export function allRouteIdsOfShop(shop: { route_id: bigint; route_links?: Array<{ route_id: bigint }> }): bigint[] {
  const seen = new Set<string>([shop.route_id.toString()]);
  const ids = [shop.route_id];
  for (const link of shop.route_links ?? []) {
    const key = link.route_id.toString();
    if (seen.has(key)) continue;
    seen.add(key);
    ids.push(link.route_id);
  }
  return ids;
}

type RouteShopTx = Pick<Prisma.TransactionClient, 'zmccRoute' | 'zmccRouteShop'>;

/**
 * Checks the extra routes (all must exist and belong to the shop's ZMCC) and returns them
 * de-duplicated without the home route. Returns an error text when a route is not allowed.
 */
export async function resolveExtraRoutes(
  db: Pick<Prisma.TransactionClient, 'zmccRoute'>,
  extraRouteIds: unknown,
  homeRouteId: bigint,
  zmccId: bigint
): Promise<{ ok: true; ids: bigint[] } | { ok: false; error: string }> {
  if (extraRouteIds == null) return { ok: true, ids: [] };
  if (!Array.isArray(extraRouteIds)) return { ok: false, error: 'Extra routes must be a list.' };
  const ids: bigint[] = [];
  const seen = new Set<string>([homeRouteId.toString()]);
  for (const raw of extraRouteIds) {
    const text = String(raw ?? '').trim();
    if (!/^\d+$/.test(text)) return { ok: false, error: 'Invalid route selected.' };
    if (seen.has(text)) continue;
    seen.add(text);
    ids.push(BigInt(text));
  }
  if (ids.length === 0) return { ok: true, ids };
  const routes = await db.zmccRoute.findMany({ where: { id: { in: ids } }, select: { id: true, zmcc_id: true, is_active: true } });
  if (routes.length !== ids.length) return { ok: false, error: 'A selected route was not found.' };
  if (routes.some((r) => r.zmcc_id !== zmccId)) return { ok: false, error: 'All routes must belong to the shop\'s ZMCC.' };
  if (routes.some((r) => !r.is_active)) return { ok: false, error: 'A selected route is inactive.' };
  return { ok: true, ids };
}

/** Replaces the shop's extra routes with the given ones (never the home route). */
export async function replaceShopExtraRoutes(
  tx: RouteShopTx,
  shopId: bigint,
  extraRouteIds: bigint[],
  actorUserId: bigint | null
): Promise<void> {
  await tx.zmccRouteShop.deleteMany({ where: { shop_id: shopId, route_id: { notIn: extraRouteIds } } });
  if (extraRouteIds.length === 0) return;
  await tx.zmccRouteShop.createMany({
    data: extraRouteIds.map((route_id) => ({ route_id, shop_id: shopId, created_by: actorUserId })),
    skipDuplicates: true,
  });
}
