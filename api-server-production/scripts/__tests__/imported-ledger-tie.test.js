// verify-accounting-invariants.ts check 5c (owner 2026-11-25): ABSS entries under one number added up on the control account.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { importedLedgerTie, isImportedLedger, perOrg, beforeOpening } = require('../lib/imported-ledger-tie');

test('a split sale ties once every entry under the number is added up (I-011984: 1,635 then -817.50 = 817.50)', () => {
  assert.deepEqual(importedLedgerTie({ side: 'AR', docGross: 817.5, controlNet: 1635 - 817.5 }), { ok: true, diff: 0 });
});
test('a customer swap nets to the invoice (AR +972 on the new card, the original entry +972, the swap -972)', () => {
  assert.equal(importedLedgerTie({ side: 'AR', docGross: 972, controlNet: 972 + 972 - 972 }).ok, true);
});
test('a purchase ties on the AP side (credit)', () => {
  assert.equal(importedLedgerTie({ side: 'AP', docGross: 500, controlNet: -500 }).ok, true);
});
test('ABSS and the ERP really differ: still flagged, with the difference', () => {
  assert.deepEqual(importedLedgerTie({ side: 'AR', docGross: 25833, controlNet: 11052.6 }), { ok: false, diff: -14780.4 });
});
test('only abss-gl journals are imported-ledger; xero-import and native are not', () => {
  assert.equal(isImportedLedger('abss-gl:wct-abss-2026-11-23'), true);
  assert.equal(isImportedLedger('xero-import'), false);
  assert.equal(isImportedLedger(null), false);
});
test('per-org counts', () => {
  assert.equal(perOrg([{ org: 'b' }, { org: 'a' }, { org: 'b' }]), 'b 2, a 1');
});

test('a document dated before the ledger opens is skipped (its sale is in the opening balance)', () => {
  assert.equal(beforeOpening('2023-08-14', '2024-01-01'), true);
  assert.equal(beforeOpening('2024-01-01', '2024-01-01'), false);
  assert.equal(beforeOpening('14/08/2023', '2024-01-01'), false); // not ISO: not skipped, checked
  assert.equal(beforeOpening(null, '2024-01-01'), false);
});

test('within S$1 ties (ABSS rounding: 0.11, 0.80, 1.00); over S$1 warns', () => {
  for (const d of [0.11, 0.8, 1.0, -0.8]) assert.equal(importedLedgerTie({ side: 'AR', docGross: 100, controlNet: 100 + d }).ok, true);
  assert.deepEqual(importedLedgerTie({ side: 'AR', docGross: 100, controlNet: 101.01 }), { ok: false, diff: 1.01 });
  assert.equal(importedLedgerTie({ side: 'AP', docGross: 100, controlNet: -101.5 }).ok, false);
});

test('a $1 placeholder ABSS booked nothing for still warns (not rounding)', () => {
  assert.deepEqual(importedLedgerTie({ side: 'AR', docGross: 1, controlNet: 0 }), { ok: false, diff: -1 });
});
