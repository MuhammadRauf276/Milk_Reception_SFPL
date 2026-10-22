import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { isCorrectionAuthority } from '../../core/roles/capabilities';
import { buildAuditLogData } from '../../core/audit';

// Correcting saved records is non-delegable (Phase 3): only Data Executive and Super Admin.
// The service files import the database at load time, so their guards are checked from source.
const SERVICES_DIR = join(process.cwd(), 'src', 'backend', 'services');

function source(rel: string): string {
  return readFileSync(join(SERVICES_DIR, rel), 'utf8').replace(/\r\n/g, '\n');
}

/** The body of `action === '<action>'` in a stage resolver. */
function actionBlock(src: string, action: string): string {
  let start = src.indexOf(`action === '${action}'`);
  if (start < 0) {
    start = src.indexOf(`} else if (action === '${action}') {`);
  }
  assert.ok(start >= 0, `resolver branch for ${action} not found`);
  // The branch ends at the next closing brace at resolver indentation.
  const end = src.indexOf('\n  }', start);
  assert.ok(end > start, `end of ${action} branch not found`);
  return src.slice(start, end);
}

test('correction authority: Data Executive and Super Admin only', () => {
  assert.equal(isCorrectionAuthority('SUPER_ADMIN'), true);
  assert.equal(isCorrectionAuthority('DATA_EXECUTIVE'), true);
  assert.equal(isCorrectionAuthority('ZMCC_MANAGER'), false);
  assert.equal(isCorrectionAuthority('QA_MANAGER'), false);
  assert.equal(isCorrectionAuthority('HEAD_OF_MPD'), false);
  assert.equal(isCorrectionAuthority('PHE_OPERATOR'), false);
  assert.equal(isCorrectionAuthority(''), false);
});

test('ZMCC arrival and gate exit corrections use the correction authority', () => {
  const src = source('zmccArrival/zmccArrivalCore.ts');
  for (const action of ['CORRECT_ARRIVAL', 'CORRECT_EXIT']) {
    const block = actionBlock(src, action);
    assert.match(block, /if \(!isCorrectionAuthority\(role\)\)/, action);
    assert.doesNotMatch(block, /isZmccManager/, action);
  }
});

test('ZMCC lab session and MOT collection corrections use the correction authority', () => {
  assert.ok(source('zmccLabService.ts').includes("action === 'CORRECT_SESSION' && !isCorrectionAuthority(role)"));
  assert.ok(source('mot/motCore.ts').includes("action === 'CORRECT_COLLECTION' && !isCorrectionAuthority(role)"));
});

test('applying or rejecting a correction request checks the correction authority', () => {
  const src = source('correctionGovernanceService.ts');
  for (const fn of ['rejectCorrectionRequest', 'applyCorrectionRequest']) {
    const start = src.indexOf(`export async function ${fn}(`);
    assert.ok(start >= 0, fn);
    const head = src.slice(start, src.indexOf('findUnique', start));
    assert.match(head, /if \(!isCorrectionAuthority\(reviewerUser\.role\)\)/, fn);
  }
});

test('audit rows from a plain user id + role fill actor and performed-as roles', () => {
  const data = buildAuditLogData({
    tableName: 'zmcc_mot_arrival',
    recordId: BigInt(7),
    action: 'ZMCC_MOT_ARRIVAL_CORRECTED',
    oldValues: null,
    newValues: { a: 1 },
    actor: { userId: BigInt(3), actorRole: 'DATA_EXECUTIVE' },
  });
  assert.equal(data.user_id, BigInt(3));
  assert.equal(data.actor_role, 'DATA_EXECUTIVE');
  assert.equal(data.performed_as_role, 'DATA_EXECUTIVE');
  assert.equal(data.is_delegated, false);

  const noRole = buildAuditLogData({
    tableName: 't', recordId: BigInt(1), action: 'X', actor: { userId: BigInt(1), actorRole: null },
  });
  assert.equal(noRole.actor_role, null);
  assert.equal(noRole.old_values, undefined);
});
