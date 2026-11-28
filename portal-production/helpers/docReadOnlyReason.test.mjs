// node --experimental-strip-types --test helpers/docReadOnlyReason.test.mjs
import { test } from "node:test";
import assert from "node:assert/strict";
import { docReadOnlyReason } from "./docReadOnlyReason.ts";

test("nothing locked = no reason", () => {
  assert.equal(docReadOnlyReason({}), null);
  assert.equal(docReadOnlyReason({ confirmed: false, paid: false }), null);
});

test("confirmed names who and when, and offers Edit only to those allowed", () => {
  const r = docReadOnlyReason({ confirmed: true, confirmedBy: "Amy Yap", confirmedAt: "2026-09-09T02:15:00.000Z", canEdit: true });
  assert.equal(r.kind, "confirmed");
  assert.match(r.title, /^Confirmed by Amy Yap on 09\/09\/2026/);
  assert.equal(r.action, "edit");
  const noName = docReadOnlyReason({ confirmed: true, canEdit: false });
  assert.equal(noName.title, "Confirmed.");
  assert.equal(noName.action, undefined);
});

test("the strongest reason wins: voided > external > record lock > period lock > paid > signed > confirmed", () => {
  const all = { voided: true, externalReason: "x", recordLocked: true, periodLocked: true, paid: true, signed: true, confirmed: true };
  assert.equal(docReadOnlyReason(all).kind, "voided");
  assert.equal(docReadOnlyReason({ ...all, voided: false }).kind, "external");
  assert.equal(docReadOnlyReason({ externalReason: "A posting with no document behind it." }).title, "A posting with no document behind it.");
  assert.equal(docReadOnlyReason({ ...all, voided: false, externalReason: null }).kind, "recordLocked");
  assert.equal(docReadOnlyReason({ recordLocked: false, periodLocked: true, paid: true, confirmed: true }).kind, "periodLocked");
  assert.equal(docReadOnlyReason({ paid: true, signed: true, confirmed: true }).kind, "paid");
  assert.equal(docReadOnlyReason({ signed: true, confirmed: true }).kind, "signed");
});

test("paid lists the receipts and links to them; the lock actions follow the viewer's rights", () => {
  const paid = docReadOnlyReason({ paid: true, settledRefs: ["MO-000001", ""] });
  assert.equal(paid.title, "Paid on MO-000001.");
  assert.equal(paid.action, "offsets");
  assert.equal(docReadOnlyReason({ paid: true }).action, undefined);
  assert.equal(docReadOnlyReason({ recordLocked: true, recordLockedBy: "Jo", canUnlock: true }).action, "unlock");
  assert.equal(docReadOnlyReason({ recordLocked: true, canUnlock: false }).action, undefined);
  assert.equal(docReadOnlyReason({ periodLocked: true, lockDayLabel: "30/09/2026", canMoveLockDate: true }).action, "lockDates");
  assert.match(docReadOnlyReason({ periodLocked: true, lockDayLabel: "30/09/2026" }).title, /lock date 30\/09\/2026/);
});

test("one line only: no reason carries an explanatory sentence", () => {
  for (const r of [docReadOnlyReason({ confirmed: true }), docReadOnlyReason({ paid: true }), docReadOnlyReason({ voided: true })]) {
    assert.equal("detail" in r, false);
    assert.ok(r.title.length < 60, r.title);
  }
});
