import test from 'node:test';
import assert from 'node:assert/strict';
import { planRenumberAfterRemoval, portionLabelForIndex, renumberByPosition } from '../portion-numbering';

test('labels come from list position', () => {
  assert.equal(portionLabelForIndex(0, 2), 'Portion 1');
  assert.equal(portionLabelForIndex(1, 2), 'Portion 2');
  assert.equal(portionLabelForIndex(0, 1, true), 'Composite Sample');
  assert.equal(portionLabelForIndex(0, 2, true), 'Portion 1');
});

test('unsaved list renumbers after remove and add', () => {
  const list = [{ portionNumber: 1, k: 'a' }, { portionNumber: 2, k: 'b' }];
  const afterRemove = renumberByPosition(list.filter((p) => p.k !== 'a'));
  assert.deepEqual(afterRemove, [{ portionNumber: 1, k: 'b' }]);
  const afterAdd = renumberByPosition([...afterRemove, { portionNumber: 0, k: 'c' }]);
  assert.deepEqual(afterAdd.map((p) => p.portionNumber), [1, 2]);
});

test('removing first of two pending saved portions moves the other to 1', () => {
  const plan = planRenumberAfterRemoval(
    [{ id: 'a', portionNumber: 1, locked: false }, { id: 'b', portionNumber: 2, locked: false }],
    'a',
  );
  assert.deepEqual(plan, { renumbered: true, updates: [{ id: 'b', portionNumber: 1 }] });
});

test('updates are lowest first so each lands on a free number', () => {
  const plan = planRenumberAfterRemoval(
    [1, 2, 3, 4].map((n) => ({ id: `p${n}`, portionNumber: n, locked: false })),
    'p2',
  );
  assert.deepEqual(plan.updates, [{ id: 'p3', portionNumber: 2 }, { id: 'p4', portionNumber: 3 }]);
});

test('a decided portion after the gap keeps all numbers', () => {
  const plan = planRenumberAfterRemoval(
    [{ id: 'a', portionNumber: 1, locked: false }, { id: 'b', portionNumber: 2, locked: true }],
    'a',
  );
  assert.deepEqual(plan, { renumbered: false, updates: [] });
});

test('removing the last portion changes nothing', () => {
  const plan = planRenumberAfterRemoval(
    [{ id: 'a', portionNumber: 1, locked: true }, { id: 'b', portionNumber: 2, locked: false }],
    'b',
  );
  assert.deepEqual(plan, { renumbered: false, updates: [] });
});
