import { PrismaClient } from "@prisma/client";
import { PrismaNeon } from "@prisma/adapter-neon";
import { neonConfig } from "@neondatabase/serverless";
import * as fs from "fs";
import ws = require("ws");
neonConfig.webSocketConstructor = ws as unknown as typeof WebSocket;
const prod = new PrismaClient({ adapter: new PrismaNeon({ connectionString: fs.readFileSync(".env.production", "utf8").match(/^DATABASE_URL="?([^"\n]+)"?/m)![1] }) } as any);
const ORG = "52e90ba8-bfbd-48b0-bb76-4f9667bf74f1";
const NAMES = "JP2606240089 JP2605120049 JP2605300021 JP2604300060 JP2605010015 JP2605010020 JP2605010016 JP2605040079 JP2605040088 JP2605050025 JP2605050022 JP2605050027 JP2605050023 JP2605110122 JP2605120037 JP2605120060 JP2605140022".split(" ");
(async () => {
  for (const n of NAMES) {
    const b = await prod.document.findFirst({ where: { organizationId: ORG, type: "BILL", name: n }, select: { id: true, config: true } });
    const c: any = b!.config || {};
    const bp = await prod.billPayment.findFirst({ where: { organizationId: ORG, billId: b!.id }, select: { amount: true } });
    console.log(`${n}: aims total=${c.totalAmount} paid=${c.amountPaid} · BillPayment=${bp?.amount ?? "NONE"} · ref=${(c.reference || "").slice(0, 30)}`);
  }
  await prod.$disconnect();
})();
