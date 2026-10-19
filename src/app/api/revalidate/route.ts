import { NextRequest, NextResponse } from 'next/server';
import { revalidatePath, revalidateTag } from 'next/cache';
import { getErrorMessage } from '@/lib/errors';
import { hasValidBearerSecret, requireRoles } from '@/backend/core/route-guards';

export async function POST(req: NextRequest) {
  // Super Admin session, or a server-to-server caller holding CRON_SECRET.
  if (!hasValidBearerSecret(req, 'CRON_SECRET')) {
    const guard = await requireRoles(req, ['SUPER_ADMIN']);
    if ('response' in guard) return guard.response;
  }

  try {
    const { path, tag } = await req.json();

    if (path) {
      if (typeof path !== 'string' || !path.startsWith('/')) {
        return NextResponse.json({ error: 'path must be a string starting with /' }, { status: 400 });
      }
      revalidatePath(path);
      return NextResponse.json({ revalidated: true, type: 'path', value: path });
    }

    if (tag) {
      if (typeof tag !== 'string') {
        return NextResponse.json({ error: 'tag must be a string' }, { status: 400 });
      }
      // Expire immediately (pre-Next-16 behaviour) rather than stale-while-revalidate.
      revalidateTag(tag, { expire: 0 });
      return NextResponse.json({ revalidated: true, type: 'tag', value: tag });
    }

    return NextResponse.json({ error: 'Missing path or tag parameter' }, { status: 400 });
  } catch (error) {
    return NextResponse.json({ error: 'Failed to revalidate cache', details: getErrorMessage(error) }, { status: 500 });
  }
}
