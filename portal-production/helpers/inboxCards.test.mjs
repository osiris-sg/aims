// Run: npm test (node --test, Node's built-in TypeScript stripping).
// Round W: the question cards' fixed labels (EN / JA), the result box per outcome, the thread timeline order,
// the "n left" counter, the collapsed header line.
import { test } from "node:test";
import assert from "node:assert/strict";
import { cardStatus, docPlainName, headerSummary, L, resultBox, threadResultLines, timeline, uiLangOf } from "../app/portal/shipments/_lib/inbox-cards.ts";

const file = (o) => ({ name: "22AA198GX06003.pdf", docType: "BUNDLE_LIST", docLabel: "Bundle list (NO.取りリスト)", status: "done", ownerKind: "shipment", ownerId: "s16-2", ref: "#16-2", stepId: "st9", stepNo: "9", stepTitle: "Bundle list", ...o });
const linked = (o) => ({ orderId: "o16", shipmentId: "s16-2", ref: "#16-2", label: "#16-2 · SUS 6005 20.4t · B/L 198GX06003", files: [], fields: [], linkOnly: true, ...o });

test("language follows the browser; labels exist in both", () => {
  assert.equal(uiLangOf("ja-JP"), "ja");
  assert.equal(uiLangOf("en-SG"), "en");
  assert.equal(uiLangOf(null), "en");
  // Round AB: no counts, no "Question 1 of 4", no "N questions left" — only "Show N more".
  assert.equal(L.en.showMore(3), "Show 3 more");
  assert.equal(L.ja.showMore(3), "他 3 件を表示");
  assert.equal(L.en.left, undefined);
  assert.equal(L.en.position, undefined);
  assert.equal(L.en.questionsDot, undefined);
  assert.equal(L.en.earlier(1), "1 earlier email");
});

test("result box: added (headline + clickable file lines with plain document names), link only, waiting, hidden, general", () => {
  const done = resultBox({ inboxState: "PROCESSED", linked: linked({ files: [file({}), file({ name: "22AA198GX06003.xls" })], linkOnly: false }), general: null, by: { outcome: "AUTO", name: null, at: null, autoLabel: "B/L 198GX06003" }, done: [] }, "en");
  assert.equal(done.tone, "done");
  assert.equal(done.headline, "✅ Added to #16-2 — SUS 6005 20.4t · B/L 198GX06003");
  assert.deepEqual(done.lines.map((l) => l.text), ["22AA198GX06003.pdf → Bundle list (NO.取りリスト), step 9", "22AA198GX06003.xls → Bundle list (NO.取りリスト), step 9"]);
  assert.ok(done.lines[0].href.startsWith("/portal/shipments/orders/o16?shipment=s16-2&step=st9&file="), done.lines[0].href); // round AF: the file name rides along so the order page highlights it
  const link = resultBox({ inboxState: "PROCESSED", linked: linked({ ref: "#15-1" }), general: null, by: { outcome: "AUTO", name: null, at: null, autoLabel: "thread" }, done: [] }, "en");
  assert.deepEqual(link, { tone: "link", headline: "🔗 Linked to #15-1 — no documents filed.", lines: [] });
  assert.equal(resultBox({ inboxState: "SUGGESTED", linked: linked({}), general: null, by: null, done: [] }, "en").headline, "⏳ Waiting for you");
  assert.equal(resultBox({ inboxState: "HIDDEN", linked: null, general: null, by: null, done: [] }, "ja").headline, "出荷の件ではない");
  assert.equal(resultBox({ inboxState: "PROCESSED", linked: null, general: { customerKey: "MITSUI_SOKO" }, by: { outcome: "AUTO", name: null, at: null, autoLabel: "general" }, done: [] }, "en").headline, "General — MITSUI_SOKO");
  assert.equal(docPlainName({ docType: "CI", docLabel: null }), "Commercial invoice (CI)");
  assert.equal(docPlainName({ docType: "XYZ", docLabel: "Org label" }), "Org label");
});

test("a thread whose emails went to different places: one line per email, oldest first; one place → no lines", () => {
  const when = (iso) => iso.slice(5, 16).replace("T", " ");
  const a = { id: "a", date: "2026-10-21T10:30:00.000Z", inboxState: "PROCESSED", linked: linked({ ref: "#15-1", orderId: "o15", shipmentId: "s15", files: [file({ ref: "#15-1", ownerId: "s15" }), file({ ref: "#15-1", ownerId: "s15" }), file({ ref: "#15-1", ownerId: "s15" })] }), general: null, by: null, done: [] };
  const b = { id: "b", date: "2026-10-21T11:00:00.000Z", inboxState: "PROCESSED", linked: linked({ files: [file({}), file({})] }), general: null, by: null, done: [] };
  const lines = threadResultLines([b, a], when, "en");
  assert.deepEqual(lines.map((l) => l.text), ["10-21 10:30 → #15-1 · Bundle list (NO.取りリスト) ×3", "10-21 11:00 → #16-2 · Bundle list (NO.取りリスト) ×2"]);
  assert.deepEqual(threadResultLines([a, { ...a, id: "c" }], when, "en"), []);
});

test("timeline: 1 → n oldest first, the newest marked Latest; 'n left' excludes the answered thread; card status = the question or the result", () => {
  const tl = timeline([{ id: "new", date: "2026-10-21T11:00:00.000Z" }, { id: "old", date: "2026-10-20T11:00:00.000Z" }]);
  assert.deepEqual(tl.map((x) => [x.n, x.m.id, x.latest]), [[1, "old", false], [2, "new", true]]);
  const msgs = (states) => states.map((inboxState, i) => ({ id: `m${i}`, inboxState }));
  assert.equal(msgs(["SUGGESTED"]).length, 1);
  assert.deepEqual(cardStatus({ question: { title: "Which shipment is this about?" }, messages: [], general: null }, "en"), { text: "Which shipment is this about?", tone: "wait" });
  assert.deepEqual(cardStatus({ question: null, messages: [{ inboxState: "PROCESSED", linked: linked({ ref: "#15-1" }), general: null, by: null, done: [] }], general: null }, "en"), { text: "🔗 Linked to #15-1 — no documents filed.", tone: "link" });
});

test("collapsed header: From 榎本若菜 (Mitsui Soko) · to Sayaka + 9 (and the Japanese)", () => {
  const h = { from: '"榎本若菜" <enomoto@mitsui-soko.co.jp>', to: "Sayaka <s@asiadealhub.com>, a@x.jp, b@x.jp", cc: "c@x.jp, d@x.jp, e@x.jp, f@x.jp, g@x.jp, h@x.jp, i@x.jp" };
  assert.equal(headerSummary(h, "Mitsui Soko", "en"), "From 榎本若菜 (Mitsui Soko) · to Sayaka + 9");
  assert.equal(headerSummary(h, "Mitsui Soko", "ja"), "榎本若菜 (Mitsui Soko) から · Sayaka +9 宛");
  assert.equal(headerSummary({ from: "ops@wanhai.com", to: "", cc: "" }, null, "en"), "From ops");
});

test("thread result: a link-only reply after a filed email still shows 'Added to #16-2' with every document; different places → one line per email", async () => {
  const { threadResult } = await import("../app/portal/shipments/_lib/inbox-cards.ts");
  const file = (o) => ({ name: "22AA198GX06003.pdf", docType: "BUNDLE_LIST", docLabel: "Bundle list (NO.取りリスト)", status: "done", ownerKind: "shipment", ownerId: "s16-2", ref: "#16-2", stepId: "st9", stepNo: "9", stepTitle: "Bundle list", ...o });
  const linked = (o) => ({ orderId: "o16", shipmentId: "s16-2", ref: "#16-2", label: "#16-2 · SUS 6005 20.4t · B/L 198GX06003", files: [], fields: [], linkOnly: true, ...o });
  const first = { id: "a", date: "2026-10-21T10:00:00.000Z", inboxState: "PROCESSED", linked: linked({ files: [file({}), file({ name: "22AA198GX06003.xls" })], linkOnly: false }), general: null, by: null, done: [] };
  const reply = { id: "b", date: "2026-10-21T11:00:00.000Z", inboxState: "PROCESSED", linked: linked({}), general: null, by: null, done: [] };
  const r = threadResult([reply, first], (iso) => iso.slice(11, 16), "en");
  assert.equal(r.tone, "done");
  assert.equal(r.headline, "✅ Added to #16-2 — SUS 6005 20.4t · B/L 198GX06003");
  assert.equal(r.lines.length, 2);
  assert.deepEqual(r.multi, []);
  const other = { ...reply, id: "c", linked: linked({ ref: "#15-1", orderId: "o15", shipmentId: "s15" }) };
  assert.equal(threadResult([other, first], (iso) => iso.slice(11, 16), "en").multi.length, 2);
});

// Round AA: the minimal card's one line, the dialog's likely options, the answer payload Confirm sends.
test("card line: From Company · date · subject (EN / JA), the sender's name when no company, the subject trimmed to 50", async () => {
  const { cardFromLine, trimSubject, whenCard } = await import("../app/portal/shipments/_lib/inbox-cards.ts");
  const m = { from: '"Rahul Sharma" <rahul@vedanta.co.in>', company: "Vedanta", date: "2026-10-22T05:31:00.000Z", subject: "RE: Request for Extension of Detention Free Time for Container MSKU1234567" };
  assert.equal(cardFromLine(m, "en"), `From Vedanta · 22 Oct 14:31 · ${m.subject.replace(/\s+/g, " ").trim()}`); // round AD: the subject in full, never "…"
  assert.equal(cardFromLine(m, "ja"), `Vedanta から · 10/22 14:31 · ${m.subject.replace(/\s+/g, " ").trim()}`);
  assert.equal(cardFromLine({ ...m, company: null, subject: "Short" }, "en"), "From Rahul Sharma · 22 Oct 14:31 · Short");
  assert.equal(cardFromLine({ from: "ops@wanhai.com", company: "", date: "2026-10-22T05:31:00.000Z", subject: null }, "ja"), "ops から · 10/22 14:31 · (no subject)");
});

test("round AB — the card list: company line, full subject, stored summary with the body's first line as the fallback", async () => {
  const { cardWhoLine, cardSummary, fullSubject, trimSubject, whenCard } = await import("../app/portal/shipments/_lib/inbox-cards.ts");
  const m = { from: "Rahul Sharma <rahul@vedanta.example>", company: "Vedanta", date: "2026-10-22T05:31:00.000Z", subject: "  RE: Request for   Extension of Detention Free Time for 198GX06003 / 198GX05781  " };
  assert.equal(cardWhoLine(m, "en"), "Vedanta · 22 Oct 14:31");
  assert.equal(cardWhoLine(m, "ja"), "Vedanta · 10/22 14:31");
  assert.equal(cardWhoLine({ ...m, company: null }, "en"), "Rahul Sharma · 22 Oct 14:31");
  assert.equal(fullSubject(m.subject), "RE: Request for Extension of Detention Free Time for 198GX06003 / 198GX05781");
  assert.equal(fullSubject(""), "(no subject)");
  assert.equal(cardSummary({ summary: " Asks to extend the free time for two containers. ", preview: "Dear Sayaka, please…" }), "Asks to extend the free time for two containers.");
  assert.equal(cardSummary({ summary: null, preview: "Dear Sayaka, please see the attached arrival notice." }), "Dear Sayaka, please see the attached arrival notice.");
  assert.equal(cardSummary({ summary: "", preview: "" }), null);
  assert.equal(cardSummary({ summary: "x".repeat(200), preview: "" }).length, 200); // round AD: never cut — the card wraps
  assert.equal(trimSubject("  a   b  "), "a b");
  assert.equal(trimSubject("x".repeat(50)), "x".repeat(50));
  assert.equal(trimSubject("x".repeat(51)), "x".repeat(51)); // round AD: never cut
  assert.equal(whenCard("2026-01-05T15:07:00.000Z", "ja"), "01/06 00:07");
  assert.equal(whenCard("2026-01-05T15:07:00.000Z", "en"), "6 Jan 00:07");
  assert.equal(whenCard(null, "en"), "");
});

test("likely options: the card's options in order, deduped by orderId:shipmentId (an order-level option stays)", async () => {
  const { likelyOptions } = await import("../app/portal/shipments/_lib/inbox-cards.ts");
  const o = (id, orderId, shipmentId) => ({ id, orderId, shipmentId, ref: `#${orderId}`, summary: id, why: "", suggested: false });
  const got = likelyOptions({ options: [o("a", "o18", "s2"), o("b", "o18", "s1"), o("c", "o18", "s2"), o("d", "o19", null), o("e", "o19", null)] });
  assert.deepEqual(got.map((x) => x.id), ["a", "b", "d"]);
  assert.deepEqual(likelyOptions(null), []);
  assert.deepEqual(likelyOptions({ options: [] }), []);
});

test("answer payload: several shipments → targets + the first as orderId/shipmentId; one → the same; not-shipment on a NEW_DEAL card → not_deal; later → later; nothing → null", async () => {
  const { answerFor } = await import("../app/portal/shipments/_lib/inbox-cards.ts");
  const many = answerFor({ kind: "shipments", targets: [{ orderId: "o18", shipmentId: "s2" }, { orderId: "o19", shipmentId: null }, { orderId: "o18", shipmentId: "s2" }] }, "WHICH");
  assert.deepEqual(many, { kind: "record", orderId: "o18", shipmentId: "s2", targets: [{ orderId: "o18", shipmentId: "s2" }, { orderId: "o19", shipmentId: null }] });
  const one = answerFor({ kind: "shipments", targets: [{ orderId: "o19", shipmentId: null }] }, "CONFIRM");
  assert.deepEqual(one, { kind: "record", orderId: "o19", shipmentId: null, targets: [{ orderId: "o19", shipmentId: null }] });
  assert.deepEqual(answerFor({ kind: "not_shipment" }, "NEW_DEAL"), { kind: "not_deal" });
  assert.deepEqual(answerFor({ kind: "not_shipment" }, "WHICH"), { kind: "not_shipment" });
  assert.deepEqual(answerFor({ kind: "later" }, "NEW_DEAL"), { kind: "later" });
  assert.equal(answerFor({ kind: "shipments", targets: [] }, "WHICH"), null);
  assert.equal(L.en.chooseShipment, "Choose shipment");
  assert.equal(L.ja.chooseShipment, "出荷を選ぶ");
  assert.equal(L.en.showFull, "Show full email");
  assert.equal(L.ja.showFull, "メール全文を表示");
  assert.equal(L.en.answer, "Answer");
  assert.equal(L.ja.answer, "回答する");
  assert.equal(L.en.confirm, "Confirm");
  assert.equal(L.ja.confirm, "確定");
});
