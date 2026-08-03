import { PrismaClient } from "@prisma/client";
import { PrismaNeon } from "@prisma/adapter-neon";
import { neonConfig } from "@neondatabase/serverless";
import * as fs from "fs";
import ws = require("ws");
neonConfig.webSocketConstructor = ws as unknown as typeof WebSocket;
const prod = new PrismaClient({ adapter: new PrismaNeon({ connectionString: fs.readFileSync(".env.production", "utf8").match(/^DATABASE_URL="?([^"\n]+)"?/m)![1] }) } as any);
const ORG = "52e90ba8-bfbd-48b0-bb76-4f9667bf74f1";
const LIST = `JP2606080024 JP2606080025 JP2605300031 JP2605300030 JP2605300029 JP2605300024 JP2605300022 JP2605300021 JP2605300020 JP2605300018 JP2605300016 JP2605300014 JP2605300013 JP2605300011 JP2605300010 JP2605300008 JP2605300007 JP2605210095 JP2605140108 JP2605140109 JP2605140024 JP2605140022 JP2605120135 JP2605120133 JP2605120060 JP2605120059 JP2605120058 JP2605120054 JP2605120053 JP2605120051 JP2605120049 JP2605120044 JP2605120043 JP2605120041 JP2605120040 JP2605120037 JP2605120036 JP2605120034 JP2605120032 JP2605110121 JP2605120030 JP2605120031 JP2605110122`.split(/\s+/);
const REF = "BI202607106";
(async () => {
  const a443 = await prod.chartOfAccount.findFirst({ where: { organizationId: ORG, code: "443" }, select: { id: true } });
  if (!a443) throw new Error("443 not found");
  let done = 0, sum = 0;
  for (const n of LIST) {
    const b = await prod.document.findFirst({ where: { organizationId: ORG, type: "BILL", name: n }, select: { id: true, config: true } });
    if (!b) { console.log(`x ${n} missing`); continue; }
    const c: any = b.config || {};
    const lines = (c.lines || []).map((l: any) => ({ ...l, accountId: a443.id, accountCode: "443" }));
    await prod.document.update({ where: { id: b.id }, data: { config: { ...c, lines, reference: REF } } });
    done++; sum += Number(c.totalAmount || 0);
  }
  console.log(`AIMS: ${done}/${LIST.length} bills → account 443, reference ${REF} · total $${sum.toFixed(2)}`);
  await prod.$disconnect();
})();
