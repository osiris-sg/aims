import { PrismaClient } from "@prisma/client";
import { PrismaNeon } from "@prisma/adapter-neon";
import { neonConfig } from "@neondatabase/serverless";
import * as fs from "fs";
import ws = require("ws");
neonConfig.webSocketConstructor = ws as unknown as typeof WebSocket;
const prod = new PrismaClient({ adapter: new PrismaNeon({ connectionString: fs.readFileSync(".env.production", "utf8").match(/^DATABASE_URL="?([^"\n]+)"?/m)![1] }) } as any);
const ORG = "52e90ba8-bfbd-48b0-bb76-4f9667bf74f1";
const LIST = `JP2606080024 JP2606080025 JP2605300031 JP2605300030 JP2605300029 JP2605300024 JP2605300022 JP2605300021 JP2605300020 JP2605300018 JP2605300016 JP2605300014 JP2605300013 JP2605300011 JP2605300010 JP2605300008 JP2605300007 JP2605210095 JP2605140108 JP2605140109 JP2605140024 JP2605140022 JP2605120135 JP2605120133 JP2605120060 JP2605120059 JP2605120058 JP2605120054 JP2605120053 JP2605120051 JP2605120049 JP2605120044 JP2605120043 JP2605120041 JP2605120040 JP2605120037 JP2605120036 JP2605120034 JP2605120032 JP2605110121 JP2605120030 JP2605120031 JP2605110122 JP2607170118`.split(/\s+/);
(async () => {
  const acctCache = new Map<string, string>();
  const codeOf = async (id: string) => {
    if (!acctCache.has(id)) {
      const a = await prod.chartOfAccount.findUnique({ where: { id }, select: { code: true } });
      acctCache.set(id, a?.code || "?");
    }
    return acctCache.get(id);
  };
  let on443 = 0, on442 = 0, refOk = 0, missing: string[] = [];
  const summary: Record<string, number> = {};
  for (const n of LIST) {
    const b = await prod.document.findFirst({ where: { organizationId: ORG, type: "BILL", name: n }, select: { config: true } });
    if (!b) { missing.push(n); continue; }
    const c: any = b.config || {};
    const code = c.lines?.[0]?.accountId ? await codeOf(c.lines[0].accountId) : c.lines?.[0]?.accountCode || "?";
    if (code === "443") on443++; else on442++;
    const ref = c.reference || "";
    if (ref === "BI202607106") refOk++;
    const key = `acct=${code} · ref=${ref.startsWith("BI202607106") ? "BI202607106" : ref.slice(0, 26) || "(none)"}`;
    summary[key] = (summary[key] || 0) + 1;
  }
  console.log(`of ${LIST.length}: on 443 = ${on443} · still 442 = ${on442} · ref=BI202607106 = ${refOk} · missing = ${missing.length} ${missing.join(",")}`);
  console.log("\nbreakdown:");
  Object.entries(summary).sort((a, b) => b[1] - a[1]).forEach(([k, v]) => console.log(`  ${v}× ${k}`));
  await prod.$disconnect();
})();
