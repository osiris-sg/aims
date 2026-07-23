import { PrismaClient } from "@prisma/client";
import { PrismaNeon } from "@prisma/adapter-neon";
import { neonConfig } from "@neondatabase/serverless";
import * as fs from "fs";
import ws = require("ws");
neonConfig.webSocketConstructor = ws as unknown as typeof WebSocket;
const prod = new PrismaClient({ adapter: new PrismaNeon({ connectionString: fs.readFileSync(".env.production", "utf8").match(/^DATABASE_URL="?([^"\n]+)"?/m)![1] }) } as any);
const ORG = "52e90ba8-bfbd-48b0-bb76-4f9667bf74f1";
(async () => {
  const rows: any[] = await prod.$queryRaw`
    SELECT id, name, type, config FROM "Document"
    WHERE "organizationId"=${ORG} AND name LIKE 'BIPL-JPSG-INV%' AND type IN ('INVOICE','CREDIT_NOTE')`;
  let fixed = 0;
  for (const r of rows) {
    const c: any = r.config || {};
    const items = (c.items || []).map((it: any) => ({ ...it, itemCode: "SV025", isService: true, accountCode: "443" }));
    if (!c.items?.length || (c.items || []).every((it: any) => it.itemCode === "SV025")) continue;
    await prod.document.update({ where: { id: r.id }, data: { config: { ...c, items } } });
    fixed++;
  }
  console.log(`stamped SV025 on ${fixed} of ${rows.length} JPSG docs`);
  await prod.$disconnect();
})();
