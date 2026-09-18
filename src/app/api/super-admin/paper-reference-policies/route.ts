import { NextResponse } from 'next/server';
import { getCurrentUser } from '@core/auth';
import { prisma } from '@core/db';
import { z } from 'zod';
import { PaperReferenceService } from '@/backend/services/paperReferenceService';
import { PaperReferenceType, PaperPolicyMode } from '@prisma/client';

const updatePolicySchema = z.object({
  referenceType: z.enum(['SHOP_RMR', 'RAW_MILK_TOKEN', 'RAW_MILK_DISPATCH_NOTE']),
  policyMode: z.enum(['REQUIRED', 'OPTIONAL', 'DISABLED']),
  allowDuplicates: z.boolean(),
  reason: z.string().trim().min(3, 'A substantive reason of at least 3 characters is required.'),
});

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

  const allowedRoles = ['SUPER_ADMIN'];
  if (!dbUser || !allowedRoles.includes(dbUser.role)) {
    return NextResponse.json({ error: 'Unauthorized. Super Admin role required.' }, { status: 403 });
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

export async function PUT(req: Request) {
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

  const allowedRoles = ['SUPER_ADMIN'];
  if (!dbUser || !allowedRoles.includes(dbUser.role)) {
    return NextResponse.json(
      { error: 'Unauthorized. Super Admin role is strictly required to modify paper reference policies.' },
      { status: 403 }
    );
  }

  try {
    const body = await req.json();
    const validated = updatePolicySchema.parse(body);

    const updated = await PaperReferenceService.updatePolicy({
      referenceType: validated.referenceType as PaperReferenceType,
      policyMode: validated.policyMode as PaperPolicyMode,
      allowDuplicates: validated.allowDuplicates,
      updatedByUserId: dbUser.id,
      reason: validated.reason,
    });

    return NextResponse.json({
      success: true,
      policy: {
        id: updated.id.toString(),
        referenceType: updated.reference_type,
        policyMode: updated.policy_mode,
        allowDuplicates: updated.allow_duplicates,
        duplicateScope: updated.duplicate_scope,
        updatedAt: updated.updated_at.toISOString(),
      },
    });
  } catch (error: any) {
    if (error?.name === 'ZodError' || error?.issues) {
      const msg = error.issues?.[0]?.message || error.errors?.[0]?.message || error.message || 'Validation failed';
      return NextResponse.json({ error: msg }, { status: 400 });
    }
    console.error('Error updating paper reference policy:', error);
    return NextResponse.json({ error: error.message || 'Failed to update paper reference policy' }, { status: 400 });
  }
}
