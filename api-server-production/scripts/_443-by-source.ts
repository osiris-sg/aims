import { PrismaClient } from "@prisma/client";
import { PrismaNeon } from "@prisma/adapter-neon";
import { neonConfig } from "@neondatabase/serverless";
import * as fs from "fs";
import * as os from "os";
import ws = require("ws");
neonConfig.webSocketConstructor = ws as unknown as typeof WebSocket;
const prod = new PrismaClient({ adapter: new PrismaNeon({ connectionString: fs.readFileSync(".env.production", "utf8").match(/^DATABASE_URL="?([^"\n]+)"?/m)![1] }) } as any);
const ORG = "52e90ba8-bfbd-48b0-bb76-4f9667bf74f1";
(async () => {
  const cachePath = `${os.homedir()}/.aims-xero-cache/xero-journals-cache-${ORG}.ndjson`;
  const bySource = new Map<string, { type: string; net: number; ref: string }>();
  for (const line of fs.readFileSync(cachePath, "utf8").split("\n")) {
    if (!line.trim()) continue;
    const j = JSON.parse(line);
    for (const l of j.JournalLines || []) {
      if (l.AccountCode !== "443") continue;
      const cur = bySource.get(j.SourceID) || { type: j.SourceType, net: 0, ref: (j.Reference || "").slice(0, 40) };
      cur.net = Math.round((cur.net + l.NetAmount) * 100) / 100;
      bySource.set(j.SourceID, cur);
    }
  }
  // resolve each source to an AIMS doc
  const docs = await prod.document.findMany({ where: { organizationId: ORG, type: { in: ["BILL", "INVOICE", "CREDIT_NOTE"] } }, select: { name: true, type: true, config: true } });
  const byXeroId = new Map<string, string>();
  for (const d of docs) {
    const c: any = d.config || {};
    for (const k of ["xeroBillId", "xeroInvoiceId", "xeroCreditNoteId"]) if (c[k]) byXeroId.set(c[k], `${d.type} ${d.name}`);
  }
  let total = 0;
  const unresolved: Array<[string, any]> = [];
  const netsByDoc = new Map<string, number>();
  for (const [sid, v] of bySource) {
    total += v.net;
    const doc = byXeroId.get(sid);
    if (!doc) { unresolved.push([sid, v]); continue; }
    netsByDoc.set(doc, Math.round(((netsByDoc.get(doc) || 0) + v.net) * 100) / 100);
  }
  console.log(`443 total from cache: ${total.toFixed(2)}`);
  console.log("\nsources NOT matching any AIMS doc:");
  unresolved.forEach(([sid, v]) => console.log(`  ${v.type} $${v.net.toFixed(2)} ref="${v.ref}" sourceId=${sid.slice(0, 8)}`));
  console.log("\nresolved docs with nonzero net (|net| listing suppressed for exact bill-invoice pairs):");
  const invNets = [...netsByDoc.entries()].filter(([d]) => d.startsWith("INVOICE") || d.startsWith("CREDIT"));
  invNets.sort((a, b) => a[1] - b[1]).slice(0, 12).forEach(([d, n]) => console.log(`  ${n.toFixed(2).padStart(9)}  ${d}`));
  await prod.$disconnect();
})();
