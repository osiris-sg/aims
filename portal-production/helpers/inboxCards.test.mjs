// Run: npm test (node --test, Node's built-in TypeScript stripping).
// Round W: the question cards' fixed labels (EN / JA), the result box per outcome, the thread timeline order,
// the "n left" counter, the collapsed header line.
import { test } from "node:test";
import assert from "node:assert/strict";
import { cardStatus, docPlainName, headerSummary, L, leftCount, resultBox, threadResultLines, timeline, uiLangOf } from "../app/portal/shipments/_lib/inbox-cards.ts";

const file = (o) => ({ name: "22AA198GX06003.pdf", docType: "BUNDLE_LIST", docLabel: "Bundle list (NO.取りリスト)", status: "done", ownerKind: "shipment", ownerId: "s16-2", ref: "#16-2", stepId: "st9", stepNo: "9", stepTitle: "Bundle list", ...o });
const linked = (o) => ({ orderId: "o16", shipmentId: "s16-2", ref: "#16-2", label: "#16-2 · SUS 6005 20.4t · B/L 198GX06003", files: [], fields: [], linkOnly: true, ...o });

test("language follows the browser; labels exist in both", () => {
  assert.equal(uiLangOf("ja-JP"), "ja");
  assert.equal(uiLangOf("en-SG"), "en");
  assert.equal(uiLangOf(null), "en");
  assert.equal(L.en.left(3), "3 left");
  assert.equal(L.ja.left(3), "残り 3 件");
  assert.equal(L.en.earlier(1), "1 earlier email");
});

test("result box: added (headline + clickable file lines with plain document names), link only, waiting, hidden, general", () => {
  const done = resultBox({ inboxState: "PROCESSED", linked: linked({ files: [file({}), file({ name: "22AA198GX06003.xls" })], linkOnly: false }), general: null, by: { outcome: "AUTO", name: null, at: null, autoLabel: "B/L 198GX06003" }, done: [] }, "en");
  assert.equal(done.tone, "done");
  assert.equal(done.headline, "✅ Added to #16-2 — SUS 6005 20.4t · B/L 198GX06003");
  assert.deepEqual(done.lines.map((l) => l.text), ["22AA198GX06003.pdf → Bundle list (NO.取りリスト), step 9", "22AA198GX06003.xls → Bundle list (NO.取りリスト), step 9"]);
  assert.equal(done.lines[0].href, "/portal/shipments/orders/o16?shipment=s16-2&step=st9");
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
  assert.equal(leftCount([{ id: "t1" }, { id: "t2" }, { id: "t3" }], "t2"), 2);
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
