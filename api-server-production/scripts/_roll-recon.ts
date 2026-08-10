import { PrismaClient } from "@prisma/client";
import { PrismaNeon } from "@prisma/adapter-neon";
import { neonConfig } from "@neondatabase/serverless";
import * as fs from "fs";
import ws = require("ws");
neonConfig.webSocketConstructor = ws as unknown as typeof WebSocket;
const prod = new PrismaClient({ adapter: new PrismaNeon({ connectionString: fs.readFileSync(".env.production", "utf8").match(/^DATABASE_URL="?([^"\n]+)"?/m)![1] }) } as any);
const ORG = "52e90ba8-bfbd-48b0-bb76-4f9667bf74f1";
(async () => {
  // 1. highest BI202608 number in AIMS
  const augDocs = await prod.document.findMany({ where: { organizationId: ORG, name: { startsWith: "BI202608" } }, select: { name: true } });
  const nums = augDocs.map(d => parseInt(d.name.replace("BI202608", ""), 10)).filter(n => !isNaN(n));
  console.log("BI202608 numbers used:", nums.sort((a, b) => a - b).join(","), "| max:", Math.max(...nums));

  // 2. do July mirrors have line amounts?
  const july = JSON.parse(fs.readFileSync("scripts/_july-rentals.json", "utf8"));
  let zero = 0, withAmt = 0;
  for (const j of july) {
    const d = await prod.document.findFirst({ where: { organizationId: ORG, name: j.invoice }, select: { config: true } });
    const items: any[] = (d?.config as any)?.items || [];
    const sum = items.reduce((s, it) => s + (Number(it.amount) || 0), 0);
    if (sum > 0.01) withAmt++; else zero++;
  }
  console.log(`July mirrors: ${withAmt} with line amounts, ${zero} with zero-amount items`);

  // 3. shape of an AIMS-born (editor-safe) invoice — most recent non-xeroImported INVOICE anywhere
  const born = await prod.document.findMany({ where: { type: "INVOICE" }, orderBy: { createdAt: "desc" }, take: 40, select: { name: true, organizationId: true, config: true, createdAt: true } });
  const sample = born.find(b => !(b.config as any)?.xeroImported && ((b.config as any)?.items || []).length && !(b.config as any)?.ingestSource);
  if (sample) {
    console.log("\nAIMS-born sample:", sample.name, sample.organizationId === ORG ? "(Biofuel)" : "(other org)", sample.createdAt);
    const c: any = sample.config;
    console.log("top-level keys:", Object.keys(c).join(","));
    console.log("documentInfo:", JSON.stringify(c.documentInfo)?.slice(0, 400));
    console.log("item0:", JSON.stringify((c.items || [])[0])?.slice(0, 300));
    console.log("customer:", JSON.stringify(c.customer)?.slice(0, 200));
  } else console.log("no AIMS-born invoice in last 40");
  process.exit(0);
})();
