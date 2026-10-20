import 'dotenv/config';
import { prisma } from '../src/backend/core/db';
import { writeAuditLog } from '../src/backend/core/audit';

interface UserMigrationSummaryRow {
  id: string;
  username: string;
  fullName: string;
  currentRole: string;
  newRole: 'QA_LAB_ATTENDANT' | 'QA_HEAD';
  status: 'PENDING_MIGRATION' | 'MIGRATED';
}

export async function runRetiredRoleMigration(argv: string[] = process.argv.slice(2)) {
  const isApply = argv.includes('--apply');
  const isDryRun = argv.includes('--dry-run') || !isApply;

  const promoteUsernames = new Set<string>();
  for (const arg of argv) {
    if (arg.startsWith('--promote-to-qa-head=')) {
      const val = arg.slice('--promote-to-qa-head='.length).trim();
      val
        .split(',')
        .map((s) => s.trim().toLowerCase())
        .filter(Boolean)
        .forEach((u) => promoteUsernames.add(u));
    }
  }

  console.log('\n================================================================');
  console.log(`RETIRED ROLE MIGRATION SCRIPT (QA_MANAGER -> QA_LAB_ATTENDANT / QA_HEAD)`);
  console.log(`MODE: ${isApply ? 'APPLY (Live DB Mutation)' : 'DRY RUN (Read Only)'}`);
  if (promoteUsernames.size > 0) {
    console.log(`PROMOTE TO QA_HEAD USERNAMES: ${Array.from(promoteUsernames).join(', ')}`);
  }
  console.log('================================================================\n');

  // Find all active users with role QA_MANAGER
  const activeQaManagers = await prisma.user.findMany({
    where: {
      role: 'QA_MANAGER',
      is_active: true,
    },
    orderBy: { id: 'asc' },
  });

  if (activeQaManagers.length === 0) {
    console.log('No active users found with role QA_MANAGER. Nothing to migrate.\n');
    return {
      migratedCount: 0,
      mode: isApply ? 'apply' : 'dry-run',
      users: [],
    };
  }

  const plannedChanges: UserMigrationSummaryRow[] = activeQaManagers.map((user) => {
    const isPromoted =
      promoteUsernames.has(user.username.toLowerCase()) ||
      (user.email && promoteUsernames.has(user.email.toLowerCase()));
    const newRole: 'QA_LAB_ATTENDANT' | 'QA_HEAD' = isPromoted ? 'QA_HEAD' : 'QA_LAB_ATTENDANT';

    return {
      id: user.id.toString(),
      username: user.username,
      fullName: user.full_name || '',
      currentRole: user.role,
      newRole,
      status: isApply ? 'MIGRATED' : 'PENDING_MIGRATION',
    };
  });

  if (isDryRun) {
    console.log(`\n=== MIGRATION PREVIEW (DRY RUN) ===`);
    console.table(plannedChanges);
    console.log(`\n[DRY RUN] Found ${activeQaManagers.length} active user(s) to migrate.`);
    console.log(`To apply these migrations to the database, run:`);
    console.log(`  npx tsx scripts/migrate-retired-roles.ts --apply\n`);
    return {
      migratedCount: activeQaManagers.length,
      mode: 'dry-run',
      users: plannedChanges,
    };
  }

  // Live Apply: update each user and write an audit log entry inside a transaction
  console.log(`Applying migrations for ${activeQaManagers.length} user(s)...`);

  await prisma.$transaction(async (tx) => {
    for (const change of plannedChanges) {
      const userId = BigInt(change.id);

      // 1. Update user role
      await tx.user.update({
        where: { id: userId },
        data: { role: change.newRole },
      });

      // 2. Record audit log entry
      await writeAuditLog(tx, {
        tableName: 'users',
        recordId: userId,
        action: 'USER_ROLE_RETIRED_MIGRATION',
        oldValues: { role: 'QA_MANAGER' },
        newValues: { role: change.newRole },
        actor: {
          userId: null,
          actorRole: 'SYSTEM_MIGRATION',
          performedAsRole: 'SYSTEM_MIGRATION',
          isDelegated: false,
        },
      });
    }
  });

  console.log(`\n=== MIGRATION EXECUTION SUMMARY (APPLIED) ===`);
  console.table(plannedChanges);
  console.log(`\n[APPLY] Successfully migrated ${plannedChanges.length} user(s).`);
  console.log(`Audit log records with action "USER_ROLE_RETIRED_MIGRATION" written for all modified accounts.\n`);

  return {
    migratedCount: plannedChanges.length,
    mode: 'apply',
    users: plannedChanges,
  };
}

if (require.main === module) {
  runRetiredRoleMigration()
    .catch((err) => {
      console.error('\n[FATAL ERROR] Migration failed:', err);
      process.exit(1);
    })
    .finally(async () => {
      await prisma.$disconnect();
    });
}
