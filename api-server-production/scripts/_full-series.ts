import { createScriptPrisma, BIOFUEL_ORG_ID as ORG, getXeroTokens, xeroGet } from "./xero-migration/_common";
import * as fs from "fs";
(async () => {
  const tokens = await getXeroTokens(null as any, ORG);
  const rentalNums = new Set(JSON.parse(fs.readFileSync("scripts/_aug-state.json", "utf8")).map((r: any) => r.xeroNum));
  const probes: string[] = [];
  for (let n = 1; n <= 126; n++) probes.push(`BI202608${String(n).padStart(3, "0")}`);
  const out: any[] = [];
  for (let i = 0; i < probes.length; i += 40) {
    const r: any = await xeroGet(tokens, "/Invoices", { InvoiceNumbers: probes.slice(i, i + 40).join(","), summaryOnly: "true" } as any);
    for (const inv of r.Invoices || []) {
      if (inv.Status === "DELETED") continue;
      out.push({ n: inv.InvoiceNumber, c: inv.Contact?.Name || "", t: inv.Total, s: inv.Status, rental: rentalNums.has(inv.InvoiceNumber) });
    }
  }
  out.sort((a, b) => a.n.localeCompare(b.n));
  for (const o of out) console.log(`${o.n.slice(-3)} | ${o.rental ? "RENTAL" : "other "} | ${o.s.padEnd(10)} | ${String(o.t).padStart(10)} | ${o.c.slice(0, 40)}`);
  console.log(`\n${out.length} invoices · rentals: ${out.filter(o => o.rental).length}`);
  process.exit(0);
})().catch(e => { console.error("FATAL", e?.message || e); process.exit(1); });
