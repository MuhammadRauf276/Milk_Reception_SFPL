import { NextResponse } from 'next/server';
import { getCurrentUser } from '@core/auth';
import { prisma } from '@core/db';

export async function GET() {
  const sessionUser = await getCurrentUser();
  if (!sessionUser) {
    return NextResponse.json({ user: null });
  }

  try {
    const dbUser = await prisma.user.findFirst({
      where: {
        OR: [
          { username: sessionUser.username },
          { id: BigInt(sessionUser.id) },
        ],
        is_active: true,
      },
      include: { procurement_source: true },
    });

    if (!dbUser) {
      return NextResponse.json({ user: sessionUser });
    }

    const user = {
      id: dbUser.id.toString(),
      username: dbUser.username,
      name: dbUser.full_name || dbUser.username,
      role: dbUser.role,
      department: dbUser.department || '',
      scope_type: dbUser.scope_type,
      procurement_source_id: dbUser.procurement_source_id ? dbUser.procurement_source_id.toString() : null,
      procurement_source: dbUser.procurement_source
        ? {
            id: dbUser.procurement_source.id.toString(),
            code: dbUser.procurement_source.code,
            name: dbUser.procurement_source.name,
            source_type: dbUser.procurement_source.source_type,
          }
        : null,
    };

    return NextResponse.json({ user });
  } catch (_err) {
    return NextResponse.json({ user: sessionUser });
  }
}
