import { PrismaClient } from "@prisma/client";
import { PrismaNeon } from "@prisma/adapter-neon";
import { neonConfig } from "@neondatabase/serverless";
import * as fs from "fs";
import ws = require("ws");
neonConfig.webSocketConstructor = ws as unknown as typeof WebSocket;
const prod = new PrismaClient({ adapter: new PrismaNeon({ connectionString: fs.readFileSync(".env.production", "utf8").match(/^DATABASE_URL="?([^"\n]+)"?/m)![1] }) } as any);
const ORG = "52e90ba8-bfbd-48b0-bb76-4f9667bf74f1";
const LIST = `JP2604100055 JP2604150047 JP2604150059 JP2604150065 JP2604150119 JP2604150121 JP2604150122 JP2604150125 JP2604160066 JP2604200077 JP2604240090 JP2604250007 JP2604270072 JP2604270078 JP2604270110 JP2604270111 JP2604270115 JP2604270116 JP2604270117 JP2604270118 JP2604270178 JP2604270179 JP2604270180 JP2604270181 JP2604270182 JP2604270184 JP2604290130 JP2604300017 JP2605020017 JP2605020021 JP2605020025 JP2605020026 JP2605020028 JP2605020030 JP2605160024 JP2605160026 JP2606010011 JP2606230023`.split(/\s+/);
(async () => {
  const petty: any[] = await prod.$queryRaw`
    SELECT code, name, "accountType" FROM "ChartOfAccount"
    WHERE "organizationId"=${ORG} AND (name ILIKE '%petty%' OR name ILIKE '%cash%')
    ORDER BY code`;
  console.table(petty);
  const bills = await prod.document.findMany({
    where: { organizationId: ORG, type: "BILL", name: { in: LIST } },
    select: { name: true, config: true },
  });
  for (const b of bills.sort((a, c) => a.name.localeCompare(c.name))) {
    const c: any = b.config || {};
    const sponsor = ((c.lines || [])[0]?.description || "").match(/Sponsor:\s*(.+)$/m)?.[1]?.trim() || "?";
    const employer = (c.reference || "").match(/\((.+)\)$/)?.[1] || "?";
    console.log(`${b.name} $${c.totalAmount} paid=${c.amountPaid ?? 0} status=${c.billStatus} sponsor=${sponsor.slice(0,28).padEnd(28)} employer=${employer.slice(0,30)}`);
  }
  await prod.$disconnect();
})();
