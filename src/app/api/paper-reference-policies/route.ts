import { NextResponse } from 'next/server';
import { getCurrentUser } from '@core/auth';
import { prisma } from '@core/db';
import { PaperReferenceService } from '@/backend/services/paperReferenceService';

export async function GET(req: Request) {
  const authUser = await getCurrentUser(req);
  if (!authUser) {
    return NextResponse.json({ error: 'Unauthorized. Authentication required.' }, { status: 401 });
  }

  const dbUser = await prisma.user.findFirst({
    where: {
      OR: [
        { username: authUser.username },
        { username: authUser.id },
      ],
      is_active: true,
    },
  });

  if (!dbUser) {
    return NextResponse.json({ error: 'Unauthorized. Active user account required.' }, { status: 403 });
  }

  try {
    const policies = await PaperReferenceService.getAllPolicies();
    const serialized = policies.map((p) => ({
      id: p.id.toString(),
      referenceType: p.reference_type,
      policyMode: p.policy_mode,
      allowDuplicates: p.allow_duplicates,
      duplicateScope: p.duplicate_scope,
      updatedAt: p.updated_at.toISOString(),
    }));

    return NextResponse.json({
      success: true,
      policies: serialized,
    });
  } catch (error: any) {
    console.error('Error fetching paper reference policies:', error);
    return NextResponse.json({ error: 'Failed to fetch paper reference policies' }, { status: 500 });
  }
}
