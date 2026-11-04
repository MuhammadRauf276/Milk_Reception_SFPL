const MOT_ROLES = ['MOT', 'MOT_OPERATOR'];
const MAX_CODE_LENGTH = 50;

interface UnlinkedMotUser {
  id: bigint;
  username: string | null;
  full_name: string | null;
  procurement_source_id: bigint | null;
}

export interface MotProfileSyncDb {
  user: { findMany(args: unknown): Promise<UnlinkedMotUser[]> };
  motProfile: {
    findUnique(args: { where: { mot_code: string } }): Promise<unknown>;
    create(args: { data: Record<string, unknown> }): Promise<unknown>;
  };
}

/**
 * Mobile Tester lists read mot_profile, but creating a user makes only a user. This gives each active Mobile Tester
 * bound to a ZMCC the profile they need, so they appear without another step. The user form has no phone or CNIC, so
 * those start as placeholders, and can be corrected on the Mobile Tester profile. One user's failure never stops the
 * others or the list.
 */
export async function ensureMotProfilesForUsers(db: MotProfileSyncDb, sourceId?: bigint | null): Promise<void> {
  const users = await db.user.findMany({
    where: {
      role: { in: MOT_ROLES },
      is_active: true,
      mot_profile: null,
      procurement_source_id: sourceId ?? { not: null },
      procurement_source: { source_type: 'ZMCC' },
    },
    select: { id: true, username: true, full_name: true, procurement_source_id: true },
  });

  for (const user of users) {
    if (user.procurement_source_id === null) continue;
    try {
      const base = (user.username || `MOT-${user.id}`).trim().toUpperCase().slice(0, MAX_CODE_LENGTH);
      // A code can already belong to someone else, and that must not keep this user off the list.
      const taken = await db.motProfile.findUnique({ where: { mot_code: base } });
      const suffix = `-${user.id}`;
      const mot_code = taken ? `${base.slice(0, MAX_CODE_LENGTH - suffix.length)}${suffix}` : base;
      await db.motProfile.create({
        data: {
          mot_code,
          name: user.full_name || user.username || mot_code,
          phone_number: `0300-${String(user.id).padStart(7, '0')}`,
          cnic: `35201-${String(user.id).padStart(7, '0')}-1`,
          zmcc_id: user.procurement_source_id,
          user_id: user.id,
          is_active: true,
          created_by: user.id,
        },
      });
    } catch (err) {
      console.warn('Could not create a Mobile Tester profile for user', String(user.id), err);
    }
  }
}
