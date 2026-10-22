import { test } from 'node:test';
import assert from 'node:assert/strict';
import { canActAs } from '../hierarchy';

test('QA hierarchy authorization: AVP-QA can act as QA Reception Lab', () => {
  // AVP-QA (QA_HEAD) is parent of QAE Reception Lab (QA_LAB_ATTENDANT)
  assert.equal(canActAs('QA_HEAD', 'QA_LAB_ATTENDANT'), true);

  // Data Executive and Super Admin are higher ancestors
  assert.equal(canActAs('DATA_EXECUTIVE', 'QA_LAB_ATTENDANT'), true);
  assert.equal(canActAs('SUPER_ADMIN', 'QA_LAB_ATTENDANT'), true);

  // Self is always allowed
  assert.equal(canActAs('QA_LAB_ATTENDANT', 'QA_LAB_ATTENDANT'), true);

  // Unrelated branches and lower roles are blocked
  assert.equal(canActAs('SECURITY_OPERATOR', 'QA_LAB_ATTENDANT'), false);
  assert.equal(canActAs('PHE_OPERATOR', 'QA_LAB_ATTENDANT'), false);
  assert.equal(canActAs('WEIGHBRIDGE_OPERATOR', 'QA_LAB_ATTENDANT'), false);
  assert.equal(canActAs('PRODUCTION_HEAD', 'QA_LAB_ATTENDANT'), false);
  assert.equal(canActAs('CONTRACTOR_MANAGER', 'QA_LAB_ATTENDANT'), false);
});

test('QA superior decider check: QA_HEAD and above have override authority', () => {
  const isSuperior = (role: string) => role === 'SUPER_ADMIN' || canActAs(role, 'QA_HEAD');

  assert.equal(isSuperior('SUPER_ADMIN'), true);
  assert.equal(isSuperior('DATA_EXECUTIVE'), true);
  assert.equal(isSuperior('QA_HEAD'), true);
  assert.equal(isSuperior('QA_LAB_ATTENDANT'), false);
  assert.equal(isSuperior('PHE_OPERATOR'), false);
});
