import { PrismaClient } from "@prisma/client";
import { PrismaNeon } from "@prisma/adapter-neon";
import { neonConfig } from "@neondatabase/serverless";
import * as fs from "fs";
import ws = require("ws");
neonConfig.webSocketConstructor = ws as unknown as typeof WebSocket;
const prod = new PrismaClient({ adapter: new PrismaNeon({ connectionString: fs.readFileSync(".env.production", "utf8").match(/^DATABASE_URL="?([^"\n]+)"?/m)![1] }) } as any);
const ORG = "52e90ba8-bfbd-48b0-bb76-4f9667bf74f1";
(async () => {
  const logs: any[] = await prod.$queryRaw`
    SELECT "createdAt", subject, status, "attachmentCount", reason
    FROM "EmailIngestLog" WHERE "organizationId"=${ORG}
    ORDER BY "createdAt"`;
  console.log(`total ingestion emails logged: ${logs.length}`);
  const byStatus: Record<string, number> = {};
  logs.forEach(l => (byStatus[l.status] = (byStatus[l.status] || 0) + 1));
  console.log("by status:", JSON.stringify(byStatus));
  // pass-related emails: subject or reason mentions invoice/bill patterns
  let passEmails = 0;
  const pairs: Array<{ at: string; subject: string; invoice: string | null; bills: string[] }> = [];
  for (const l of logs) {
    const text = `${l.subject || ""} ${l.reason || ""}`;
    const inv = text.match(/(BIPL-JPSG-INV-[\d-]+|JPINV-\d+-[0-9A-F]+|BI\d{9})/i)?.[1] || null;
    const bills = [...new Set([...(l.reason || "").matchAll(/(JP26\d{8})/g)].map(m => m[1]))];
    if (inv || bills.length) {
      passEmails++;
      pairs.push({ at: l.createdAt.toISOString().slice(0, 16), subject: (l.subject || "").slice(0, 60), invoice: inv, bills });
    }
  }
  console.log(`pass-related emails: ${passEmails}`);
  fs.writeFileSync("scripts/_email-pairs.json", JSON.stringify(pairs, null, 1));
  // failures & ignores worth surfacing
  const bad = logs.filter(l => l.status !== "PARSED");
  console.log(`\nnon-PARSED emails: ${bad.length}`);
  bad.slice(-10).forEach(l => console.log(`  ${l.createdAt.toISOString().slice(0, 16)} [${l.status}] att=${l.attachmentCount} "${(l.subject || "").slice(0, 55)}" ${(l.reason || "").slice(0, 60)}`));
  await prod.$disconnect();
})();
