// Rolls not-yet-invoiced July 2026 rentals into DRAFT August invoices (AIMS ONLY — no Xero).
// Desc/ref transforms: period dates +1 month, ordinal "Nth mth" -> N+1th. Flags anomalies for review.
import { PrismaClient } from "@prisma/client";
import { PrismaNeon } from "@prisma/adapter-neon";
import { neonConfig } from "@neondatabase/serverless";
import * as fs from "fs";
import ws = require("ws");
neonConfig.webSocketConstructor = ws as unknown as typeof WebSocket;
const prod = new PrismaClient({ adapter: new PrismaNeon({ connectionString: fs.readFileSync(".env.production", "utf8").match(/^DATABASE_URL="?([^"\n]+)"?/m)![1] }) } as any);
const ORG = "52e90ba8-bfbd-48b0-bb76-4f9667bf74f1";
const DRY = process.argv.includes("--dry");

const ALREADY = new Set(["BI202607009","BI202607010","BI202607112","BI202607113","BI202607038","BI202607033","BI202607034"]);
const SKIP: Record<string, string> = {
  BI202607069: "July invoice itself is still DRAFT in Xero (KTC $54,718) — roll only once July is issued",
  BI202607073: "May-period trailing arrears (Nishio) — no monthly pattern to roll",
};

const suffix = (n: number) => { const t = n % 100; if (t >= 11 && t <= 13) return "th"; return ["th","st","nd","rd"][n % 10] || "th"; };
const bumpOrdinals = (s: string) => s.replace(/(\d+)(st|nd|rd|th)(\s*)(mth|month)/gi, (_m, n, _sf, sp, w) => { const v = parseInt(n, 10) + 1; return `${v}${suffix(v)}${sp}${w}`; });
function bumpDates(s: string, june: boolean): string {
  return s.split("\n").map(line => {
    if (/dated/i.test(line)) return line; // quotation/DO "dated dd/mm/yyyy" stays
    if (june) return line.replace(/30\/06\/2026/g, "31/07/2026").replace(/(\b\d{2})\/06\/2026/g, "$1/07/2026");
    return line.replace(/(\b\d{2})\/07\/2026/g, "$1/08/2026");
  }).join("\n");
}

(async () => {
  const july = JSON.parse(fs.readFileSync("scripts/_july-rentals.json", "utf8"));
  const roll = july.filter((j: any) => !ALREADY.has(j.invoice));
  let nextNum = 59;
  const report: any[] = [];
  for (const j of roll.sort((a: any, b: any) => a.invoice.localeCompare(b.invoice))) {
    if (SKIP[j.invoice]) { report.push({ from: j.invoice, customer: j.customer, action: "SKIPPED", note: SKIP[j.invoice] }); continue; }
    const src = await prod.document.findFirst({ where: { organizationId: ORG, name: j.invoice } });
    if (!src) { report.push({ from: j.invoice, action: "SKIPPED", note: "source doc not found" }); continue; }
    const c: any = src.config;
    const june = /\/06\/2026/.test(j.period || "");
    const flags: string[] = [];
    const rawDesc = (c.items || []).map((it: any) => it.description || "").join("\n");
    if (/pro-?rat/i.test(rawDesc)) flags.push("July was PRO-RATED — August amount likely needs updating to full month");
    if (/deposit/i.test(rawDesc)) flags.push("July had a DEPOSIT line — probably remove for August");
    if (/1st\s*mth/i.test(rawDesc)) flags.push("July was 1st month — verify start date / full-month rate");

    const items = (c.items || []).map((it: any, i: number) => ({
      id: 1791000000000 + nextNum * 100 + i,
      description: bumpOrdinals(bumpDates(it.description || "", june)),
      quantity: it.quantity ?? 1,
      unitPrice: it.unitPrice ?? 0,
      amount: it.amount ?? 0,
      itemCode: it.itemCode || "",
      isService: true,
      accountCode: it.accountCode || null,
      taxType: it.taxType || null,
      taxAmount: it.taxAmount ?? 0,
    }));
    const subTotal = items.reduce((s: number, it: any) => s + (Number(it.amount) || 0), 0);
    const gstAmount = Math.round(items.reduce((s: number, it: any) => s + (Number(it.taxAmount) || 0), 0) * 100) / 100;
    const grossTotal = Math.round((subTotal + gstAmount) * 100) / 100;
    if (Math.abs(grossTotal - (c.xeroGross ?? j.total)) > 0.05) flags.push(`total ${grossTotal} ≠ July gross ${c.xeroGross ?? j.total} — check lines`);

    const newNo = `BI202608${String(nextNum).padStart(3, "0")}`;
    const refBody = (c.xeroReference || "").replace(j.invoice, "").replace(/^\s*\(|\)\s*$/g, "").trim();
    const referenceNo = refBody ? bumpOrdinals(bumpDates(refBody, june)) : "";
    const config: any = {
      date: "2026-08-01T00:00:00.000Z",
      dueDate: "2026-08-31T00:00:00.000Z",
      documentNumber: newNo,
      referenceNo,
      customerId: c.customer?.id || c.customerId || "",
      customerName: c.customer?.name || j.customer,
      currency: c.documentInfo?.currency || "SGD",
      gstPercent: c.documentInfo?.gstPercent ?? 9,
      taxApplicable: gstAmount > 0 ? "Y" : "N",
      items, subTotal, gstAmount, grossTotal, nettTotal: grossTotal,
      remarks: "",
      rolledFrom: j.invoice,
      provisionalNumber: true,
      rollFlags: flags,
    };
    if (!DRY) await prod.document.create({ data: { organizationId: ORG, type: "INVOICE", name: newNo, status: "draft" as any, documentTemplateId: src.documentTemplateId, config } });
    report.push({ from: j.invoice, to: newNo, customer: j.customer, total: grossTotal, flags });
    nextNum++;
  }
  fs.writeFileSync("scripts/_aug-roll-report.json", JSON.stringify(report, null, 1));
  const created = report.filter(r => r.to);
  console.log(`${DRY ? "[DRY] would create" : "created"} ${created.length} drafts, ${report.length - created.length} skipped, $${created.reduce((s, r) => s + r.total, 0).toFixed(2)} total`);
  for (const r of report) console.log(`${r.from} → ${r.to || "SKIP"} $${r.total ?? ""} ${r.flags?.length ? "⚑ " + r.flags.join(" | ") : ""}${r.note ? "· " + r.note : ""}`);
  process.exit(0);
})();
