import { PrismaClient } from "@prisma/client";
import { PrismaNeon } from "@prisma/adapter-neon";
import { neonConfig } from "@neondatabase/serverless";
import * as fs from "fs";
import ws = require("ws");
neonConfig.webSocketConstructor = ws as unknown as typeof WebSocket;
const prod = new PrismaClient({ adapter: new PrismaNeon({ connectionString: fs.readFileSync(".env.production", "utf8").match(/^DATABASE_URL="?([^"\n]+)"?/m)![1] }) } as any);
const ORG = "52e90ba8-bfbd-48b0-bb76-4f9667bf74f1";
(async () => {
  // credits actually posted into 443, per invoice
  const crRows: any[] = await prod.$queryRaw`
    SELECT j.reference AS ref, SUM(l."credit") AS cr
    FROM "JournalEntry" j JOIN "JournalEntryLine" l ON l."journalEntryId"=j.id
    JOIN "ChartOfAccount" c ON c.id=l."accountId"
    WHERE j."organizationId"=${ORG} AND c."code"='443' AND l."credit" > 0
    GROUP BY 1`;
  const credits = new Map<string, number>();
  for (const r of crRows) {
    const k = (r.ref || "").match(/(BIPL-JPSG-INV-[\d-]+|JPINV-[0-9A-F-]+|BI\d{9})/i)?.[1] || r.ref;
    credits.set(k, (credits.get(k) || 0) + Number(r.cr));
  }
  // all bills by ref
  const bills = await prod.document.findMany({ where: { organizationId: ORG, type: "BILL", name: { startsWith: "JP26" } }, select: { name: true, config: true } });
  const billAgg = new Map<string, { posted: number; draft: number; n: number }>();
  for (const b of bills) {
    const c: any = b.config || {};
    const r = c.reference || "";
    if (!/^(BIPL-JPSG-INV|JPINV-|BI\d)/.test(r)) continue;
    const cur = billAgg.get(r) || { posted: 0, draft: 0, n: 0 };
    const t = Number(c.totalAmount || 0);
    if ((c.xeroStatus || "DRAFT") === "DRAFT") cur.draft += t; else cur.posted += t;
    cur.n++;
    billAgg.set(r, cur);
  }
  // CNs by their credited invoice
  const cns = await prod.document.findMany({ where: { organizationId: ORG, type: "CREDIT_NOTE", name: { startsWith: "BIPL" } }, select: { name: true, config: true } });
  const cnAgg = new Map<string, { amt: number; status: string }>();
  for (const cn of cns) {
    const c: any = cn.config || {};
    const target = c.documentInfo?.reference;
    if (!target) continue;
    cnAgg.set(target, { amt: Number(c.totals?.total ?? 0), status: c.xeroStatus || "DRAFT" });
  }
  console.log("invoice · 443 credit · linked bills (posted+draft) · CN refund · residual-after-everything");
  let residualSum = 0;
  for (const [inv, cr] of [...credits.entries()].sort((a, b) => b[1] - a[1])) {
    const b = billAgg.get(inv) || { posted: 0, draft: 0, n: 0 };
    const cn = cnAgg.get(inv);
    const residual = cr - b.posted - b.draft - (cn?.amt || 0);
    residualSum += residual;
    if (Math.abs(residual) > 0.005 || cn)
      console.log(`${inv.padEnd(30)} CR ${String(cr.toFixed(2)).padStart(8)} · bills ${String((b.posted + b.draft).toFixed(2)).padStart(8)} (${b.n}) · CN ${cn ? cn.amt.toFixed(2) + "/" + cn.status : "—"} · residual ${residual.toFixed(2)}`);
  }
  console.log(`\nTOTAL unexplained residual across invoices: $${residualSum.toFixed(2)}`);
  await prod.$disconnect();
})();
