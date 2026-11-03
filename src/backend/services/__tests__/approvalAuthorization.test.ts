import test from 'node:test';
import assert from 'node:assert/strict';
import { canDecideApproval } from '../escalation/approvalMatrix';

test('approval authority: FINANCE_ACCOUNTS and ADMIN_HEAD cannot decide Stage 1 shop exceptions', () => {
  const item = {
    approvalType: 'STAGE_1_SHOP_EXCEPTION' as const,
    submittedByUserId: 'user-mot-1',
    submitterRole: 'MOT',
    zmccId: 'zmcc-101',
  };

  const financeCheck = canDecideApproval(
    { userId: 'user-fin-1', role: 'FINANCE_ACCOUNTS' },
    item
  );
  assert.equal(financeCheck.allowed, false, 'Finance cannot decide Stage 1 shop exceptions');
  assert.match(financeCheck.disabledReason || '', /Requires.*Zonal Manager/i);

  const adminHeadCheck = canDecideApproval(
    { userId: 'user-adm-1', role: 'ADMIN_HEAD' },
    item
  );
  assert.equal(adminHeadCheck.allowed, false, 'Admin Head cannot decide Stage 1 shop exceptions');
  assert.match(adminHeadCheck.disabledReason || '', /Requires.*Zonal Manager/i);
});

test('approval authority: FINANCE_ACCOUNTS and ADMIN_HEAD cannot decide Stage 2 lab portion exceptions', () => {
  const item = {
    approvalType: 'STAGE_2_PORTION_EXCEPTION' as const,
    submittedByUserId: 'user-lab-1',
    submitterRole: 'ZMCC_LAB_ATTENDANT',
    zmccId: 'zmcc-101',
  };

  const financeCheck = canDecideApproval(
    { userId: 'user-fin-1', role: 'FINANCE_ACCOUNTS' },
    item
  );
  assert.equal(financeCheck.allowed, false, 'Finance cannot decide Stage 2 portion exceptions');

  const adminHeadCheck = canDecideApproval(
    { userId: 'user-adm-1', role: 'ADMIN_HEAD' },
    item
  );
  assert.equal(adminHeadCheck.allowed, false, 'Admin Head cannot decide Stage 2 portion exceptions');
});

test('approval authority: Authorized roles can decide within their domain and scope', () => {
  const stage1Item = {
    approvalType: 'STAGE_1_SHOP_EXCEPTION' as const,
    submittedByUserId: 'user-mot-1',
    submitterRole: 'MOT',
    zmccId: 'zmcc-101',
  };

  // ZMCC Manager for the same ZMCC can decide
  const zmccManagerCheck = canDecideApproval(
    { userId: 'user-zm-1', role: 'ZMCC_MANAGER', procurementSourceId: 'zmcc-101' },
    stage1Item
  );
  assert.equal(zmccManagerCheck.allowed, true, 'ZMCC Manager for same ZMCC can decide');

  // ZMCC Manager for a different ZMCC cannot decide
  const otherZmccManagerCheck = canDecideApproval(
    { userId: 'user-zm-2', role: 'ZMCC_MANAGER', procurementSourceId: 'zmcc-999' },
    stage1Item
  );
  assert.equal(otherZmccManagerCheck.allowed, false, 'ZMCC Manager for different ZMCC cannot decide');

  // Super Admin can decide
  const superAdminCheck = canDecideApproval(
    { userId: 'user-sa-1', role: 'SUPER_ADMIN' },
    stage1Item
  );
  assert.equal(superAdminCheck.allowed, true, 'Super Admin can decide');
});

test('approval authority: DATA_EXECUTIVE is the right hand of Super Admin and can decide at every stage', () => {
  const stage1Item = {
    approvalType: 'STAGE_1_SHOP_EXCEPTION' as const,
    submittedByUserId: 'user-mot-1',
    submitterRole: 'MOT',
    zmccId: 'zmcc-101',
  };
  const dataExecCheck = canDecideApproval({ userId: 'user-de-1', role: 'DATA_EXECUTIVE' }, stage1Item);
  assert.equal(dataExecCheck.allowed, true, 'Data Executive can decide Stage 1');

  const stage4Item = {
    approvalType: 'STAGE_4_PORTION_EXCEPTION' as const,
    submittedByUserId: 'user-qae-1',
    submitterRole: 'QA_LAB_ATTENDANT',
  };
  const dataExecStage4Check = canDecideApproval({ userId: 'user-de-1', role: 'DATA_EXECUTIVE' }, stage4Item);
  assert.equal(dataExecStage4Check.allowed, true, 'Data Executive can decide Stage 4');
});
