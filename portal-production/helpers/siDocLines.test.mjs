// Round BF (2026-11-05): the 出庫・納入依頼書 product lines + where the SI screens are wired.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { docLines } from "./siDocLines.ts";

const read = (p) => readFileSync(new URL(`../${p}`, import.meta.url), "utf8");

test("JA line, its (EN) line, …, then the size", () => {
  assert.deepEqual(docLines({ docNameJa: "ハイスピード\nビレット", docNameEn: "High speed\nbillet", docSize: "152×5800" }), ["ハイスピード", "(High speed)", "ビレット", "(billet)", "152×5800"]);
  assert.deepEqual(docLines({ docNameJa: "ハイスピード / ビレット", docNameEn: "", docSize: "" }), ["ハイスピード", "ビレット"]);
  assert.deepEqual(docLines({ docNameJa: "", docNameEn: "", docSize: "152×5800" }), []);
});

test("SI editor, Products, Document formats and step cards are wired", () => {
  const editor = read("app/portal/trade-documents/generated/[id]/page.tsx");
  assert.match(editor, /downloadGeneratedXlsx/);
  assert.match(editor, /data-tour="si-download-xlsx"/);
  // Round BG: the delivery rows moved to SiDeliveries — the billet cell is still several lines.
  assert.match(read("app/portal/trade-documents/generated/_forms/LogisticsDocForms.tsx"), /<SiDeliveries/);
  assert.match(read("app/portal/trade-documents/generated/_forms/SiDeliveries.tsx"), /fullWidth multiline value=\{r\.billet/);
  assert.match(read("app/portal/shipments/clients/_components/ProductsPanel.tsx"), /data-tour="client-product-docname"/);
  assert.match(read("app/portal/shipments/clients/_components/DocumentFormatsPanel.tsx"), /f\.docType === "SHIPPING_INSTRUCTIONS" && <SiSettings/);
  assert.match(read("app/portal/shipments/_components/StepCards.tsx"), /docType === "SHIPPING_INSTRUCTIONS" && \(/);
});
