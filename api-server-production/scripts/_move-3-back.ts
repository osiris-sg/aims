import { PrismaClient } from "@prisma/client";
import { PrismaNeon } from "@prisma/adapter-neon";
import { neonConfig } from "@neondatabase/serverless";
import * as fs from "fs";
import ws = require("ws");
neonConfig.webSocketConstructor = ws as unknown as typeof WebSocket;
const prod = new PrismaClient({ adapter: new PrismaNeon({ connectionString: fs.readFileSync(".env.production", "utf8").match(/^DATABASE_URL="?([^"\n]+)"?/m)![1] }) } as any);
const ORG = "52e90ba8-bfbd-48b0-bb76-4f9667bf74f1";
const REF = "BIPL-JPSG-INV-20260715-0090";
(async () => {
  for (const n of ["JP2607150049", "JP2607150050", "JP2607150051"]) {
    const b = await prod.document.findFirst({ where: { organizationId: ORG, type: "BILL", name: n }, select: { id: true, config: true } });
    const c: any = b!.config || {};
    await prod.document.update({ where: { id: b!.id }, data: { config: { ...c, reference: REF } } });
    console.log(`${n} → ${REF}`);
  }
  // verify final tallies
  for (const ref of ["BIPL-JPSG-INV-20260630-0001", REF]) {
    const bills = await prod.document.findMany({ where: { organizationId: ORG, type: "BILL", config: { path: ["reference"], equals: ref } }, select: { config: true } });
    const sum = bills.reduce((s, x) => s + Number((x.config as any).totalAmount || 0), 0);
    console.log(`${ref}: ${bills.length} bills, cost $${sum.toFixed(2)}`);
  }
  await prod.$disconnect();
})();
