import { PrismaClient } from "@prisma/client";
import { PrismaNeon } from "@prisma/adapter-neon";
import { neonConfig } from "@neondatabase/serverless";
import * as fs from "fs";
import ws = require("ws");
neonConfig.webSocketConstructor = ws as unknown as typeof WebSocket;
const prod = new PrismaClient({ adapter: new PrismaNeon({ connectionString: fs.readFileSync(".env.production", "utf8").match(/^DATABASE_URL="?([^"\n]+)"?/m)![1] }) } as any);
const ORG = "52e90ba8-bfbd-48b0-bb76-4f9667bf74f1";
const PAIRS: Array<{ at: string; invoice: string | null; bills: string[] }> = JSON.parse(fs.readFileSync("scripts/_email-pairs.json", "utf8"));
(async () => {
  const expectedRef = new Map<string, string>();
  for (const p of PAIRS) if (p.invoice && p.bills.length) for (const b of p.bills) expectedRef.set(b, p.invoice);
  let ok = 0, consolidated = 0, missingBills: string[] = [], toStamp: Array<{ bill: string; ref: string }> = [];
  for (const [bill, invName] of expectedRef) {
    const bd = await prod.document.findFirst({ where: { organizationId: ORG, type: "BILL", name: bill }, select: { config: true } });
    if (!bd) { missingBills.push(bill); continue; }
    const ref = ((bd.config as any).reference || "") as string;
    if (/^(BIPL-JPSG-INV|JPINV-|BI\d)/.test(ref)) {
      const target = await prod.document.findFirst({ where: { organizationId: ORG, type: "INVOICE", name: ref }, select: { id: true } });
      if (target) { if (ref === invName) ok++; else consolidated++; }
      else toStamp.push({ bill, ref: invName }); // ref points nowhere → restamp to email's invoice
    } else {
      toStamp.push({ bill, ref: invName }); // employer/empty ref → stamp
    }
  }
  console.log(`exact match: ${ok} · superseded by consolidation (fine): ${consolidated} · to stamp: ${toStamp.length} · bills missing from AIMS: ${missingBills.length}`);
  missingBills.forEach(m => console.log(`  missing: ${m} (expected ${expectedRef.get(m)})`));
  for (const t of toStamp) {
    const inv = await prod.document.findFirst({ where: { organizationId: ORG, type: "INVOICE", name: t.ref }, select: { id: true } });
    if (!inv) { console.log(`  skip ${t.bill}: email invoice ${t.ref} not in AIMS either`); continue; }
    const b = await prod.document.findFirst({ where: { organizationId: ORG, type: "BILL", name: t.bill }, select: { id: true, config: true } });
    const c: any = b!.config || {};
    await prod.document.update({ where: { id: b!.id }, data: { config: { ...c, reference: t.ref } } });
    console.log(`  stamped ${t.bill} → ${t.ref}`);
  }
  await prod.$disconnect();
})();
