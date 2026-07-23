import { PrismaClient } from "@prisma/client";
import { PrismaNeon } from "@prisma/adapter-neon";
import { neonConfig } from "@neondatabase/serverless";
import * as fs from "fs";
import ws = require("ws");
neonConfig.webSocketConstructor = ws as unknown as typeof WebSocket;
const prod = new PrismaClient({ adapter: new PrismaNeon({ connectionString: fs.readFileSync(".env.production", "utf8").match(/^DATABASE_URL="?([^"\n]+)"?/m)![1] }) } as any);
const ORG = "52e90ba8-bfbd-48b0-bb76-4f9667bf74f1";
(async () => {
  const bills = await prod.document.findMany({
    where: { organizationId: ORG, type: "BILL", name: { startsWith: "JP26" } },
    select: { name: true, config: true },
  });
  let refd = 0, noRef = 0, employerFound = 0, employerMissing: string[] = [];
  const employers = new Map<string, number>();
  for (const b of bills) {
    const c: any = b.config || {};
    if ((c.reference || "").startsWith("BIPL-JPSG")) { refd++; continue; }
    noRef++;
    const txt = [(c.items || []).map((i: any) => i.description).join("\n"), (c.lines || []).map((i: any) => i.description).join("\n")].join("\n");
    const m = txt.match(/Employer:\s*([^\n]+)/i);
    if (m) { employerFound++; employers.set(m[1].trim(), (employers.get(m[1].trim()) || 0) + 1); }
    else employerMissing.push(b.name);
  }
  console.log(`JP bills: ${bills.length} · with invoice ref: ${refd} · without: ${noRef} · employer extractable: ${employerFound} · missing: ${employerMissing.length}`);
  console.log("\nemployers:", [...employers.entries()].sort((a, b) => b[1] - a[1]).slice(0, 10));
  console.log("\nsample missing:", employerMissing.slice(0, 8));
  await prod.$disconnect();
})();
