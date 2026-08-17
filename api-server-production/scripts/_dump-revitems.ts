import { PrismaClient } from "@prisma/client";
import { PrismaNeon } from "@prisma/adapter-neon";
import { neonConfig } from "@neondatabase/serverless";
import * as fs from "fs";
import ws = require("ws");
neonConfig.webSocketConstructor = ws as unknown as typeof WebSocket;
const prisma = new PrismaClient({ adapter: new PrismaNeon({ connectionString: fs.readFileSync(".env.production", "utf8").match(/^DATABASE_URL="?([^"\n]+)"?/m)![1] }) } as any);
const ORG = "52e90ba8-bfbd-48b0-bb76-4f9667bf74f1";
(async () => {
  const items = await prisma.revenueItem.findMany({ where: { organizationId: ORG, isActive: true }, select: { code: true, name: true, type: true, accountCode: true }, orderBy: { accountCode: "asc" } });
  console.log(`${items.length} active revenue items:`);
  for (const r of items) console.log(`  ${(r.accountCode || "—").padEnd(6)} ${(r.code || "—").padEnd(14)} [${r.type}] ${r.name?.slice(0, 60)}`);
  const byAcct: Record<string, number> = {};
  for (const r of items) if (r.accountCode) byAcct[r.accountCode] = (byAcct[r.accountCode] || 0) + 1;
  console.log("\naccounts with exactly ONE item (unambiguous):", Object.entries(byAcct).filter(([, n]) => n === 1).map(([c]) => c).join(", "));
  console.log("accounts with MULTIPLE items (need description match):", Object.entries(byAcct).filter(([, n]) => n > 1).map(([c, n]) => `${c}(${n})`).join(", "));
  process.exit(0);
})();
