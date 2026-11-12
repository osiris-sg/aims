// Run: npm test. 2026-11-13: WCT "Send for signature" reuses CIEL's dialog; sign page title for unnumbered quotes.
import { test } from "node:test";
import assert from "node:assert/strict";
import { SIGN_LINK_WORDING, usesCielSignFlow } from "./signLinkWording.ts";
import { signPageTitle } from "./signPage.ts";

test("CIEL dialog wording is exactly what it was", () => {
  const c = SIGN_LINK_WORDING.ciel;
  assert.equal(
    c.intro,
    "The client opens this link (no login), reads the quotation exactly as the PDF, draws their signature and accepts the T&Cs. On signing, the quotation is confirmed, a project is created and management is notified.",
  );
  assert.equal(c.footer, "Any edit you make after sharing is what the client sees when they open the link — the page always renders the latest saved version.");
  assert.equal(c.copyFailed, "Copy failed — select the link and copy it manually");
  assert.equal(c.signed, "The quotation is confirmed and linked to its project.");
  assert.equal(c.message("Chi Sian", "Q-1", 38600, "https://x/sign/t"), "Hi Chi Sian, please review and sign your renovation quotation Q-1 (S$ 38,600.00) here: https://x/sign/t");
});

test("WCT wording: owner's intro, no em-dashes anywhere", () => {
  const w = SIGN_LINK_WORDING.wct;
  assert.equal(w.intro, "On signing, the quotation is confirmed, an order is created and the office is notified.");
  for (const s of [w.intro, w.footer, w.copyFailed, w.signed, w.message("A", "QO1", 10, "u"), w.message("A", "QO1", 0, "u")]) assert.ok(!s.includes("—"), s);
  assert.equal(w.message("Acme", "QO202611-0024", 1090, "https://x/sign/t"), "Hi Acme, please review and sign quotation QO202611-0024 (S$ 1,090.00) here: https://x/sign/t");
});

test("every e-sign org's quotation takes CIEL's button + dialog, whatever its other modules", () => {
  // Widened 2026-11-13: it was the WCT group only (e-sign AND WCT orders).
  // Chong Aik has e-sign and no orders, and must still get the toolbar button.
  assert.equal(usesCielSignFlow({ isQuotation: true, eSign: true }), true);
  assert.equal(usesCielSignFlow({ isQuotation: true, eSign: false }), false);
  assert.equal(usesCielSignFlow({ isQuotation: false, eSign: true }), false);
});

test("sign page title: draft quotes read (draft), numbered ones unchanged", () => {
  assert.equal(signPageTitle(false, null), "Quotation (draft)");
  assert.equal(signPageTitle(false, ""), "Quotation (draft)");
  assert.equal(signPageTitle(false, undefined), "Quotation (draft)");
  assert.equal(signPageTitle(false, "CT-2026-031"), "Quotation CT-2026-031");
  assert.equal(signPageTitle(true, "VO-3"), "Variation order VO-3");
  assert.equal(signPageTitle(true, null), "Variation order (draft)");
});
