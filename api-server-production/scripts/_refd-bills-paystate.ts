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
    select: { id: true, name: true, config: true },
  });
  const refd = bills.filter(b => ((b.config as any)?.reference || "").startsWith("BIPL-JPSG"));
  let paidEve = 0, paidDennis = 0, unpaid = 0, sums = { eve: 0, dennis: 0, unpaid: 0 };
  for (const b of refd) {
    const c: any = b.config || {};
    const pay = await prod.billPayment.findFirst({ where: { organizationId: ORG, billId: b.id }, select: { reference: true, amount: true } });
    if (!pay) { unpaid++; sums.unpaid += Number(c.totalAmount || 0); continue; }
    if ((pay.reference || "").includes("Eve")) { paidEve++; sums.eve += Number(pay.amount); }
    else { paidDennis++; sums.dennis += Number(pay.amount); }
  }
  console.log(`ref'd bills: ${refd.length}`);
  console.log(`paid from Petty Cash - Eve: ${paidEve} ($${sums.eve.toFixed(2)})`);
  console.log(`paid from Petty Cash - Dennis: ${paidDennis} ($${sums.dennis.toFixed(2)})`);
  console.log(`unpaid: ${unpaid} ($${sums.unpaid.toFixed(2)})`);
  await prod.$disconnect();
})();
