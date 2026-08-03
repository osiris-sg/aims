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
  const bySource = new Map<string, Array<{ acct: string; net: number }>>();
  for (const line of fs.readFileSync(cachePath, "utf8").split("\n")) {
    if (!line.trim()) continue;
    const j = JSON.parse(line);
    if (j.SourceType !== "ACCPAY") continue;
    for (const l of j.JournalLines || []) {
      if (!["442", "443"].includes(l.AccountCode)) continue;
      const arr = bySource.get(j.SourceID) || [];
      arr.push({ acct: l.AccountCode, net: l.NetAmount });
      bySource.set(j.SourceID, arr);
    }
  }
  const bills = await prod.document.findMany({ where: { organizationId: ORG, type: "BILL", name: { startsWith: "JP26" } }, select: { name: true, config: true } });
  let on442 = 0;
  for (const b of bills) {
    const c: any = b.config || {};
    if (!/^(BIPL-JPSG-INV|JPINV-|BI\d)/.test(c.reference || "") || !c.xeroBillId) continue;
    const lines = bySource.get(c.xeroBillId) || [];
    const net442 = lines.filter(l => l.acct === "442").reduce((s, l) => s + l.net, 0);
    if (Math.abs(net442) > 0.005) { on442 += net442; console.log(`  ${b.name}: net $${net442.toFixed(2)} still in 442 (ref ${(c.reference || "").slice(0, 30)})`); }
  }
  console.log(`TOTAL ref'd bill cost still in 442: $${on442.toFixed(2)}`);
  await prod.$disconnect();
})();
