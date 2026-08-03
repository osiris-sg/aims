import { PrismaClient } from "@prisma/client";
import { PrismaNeon } from "@prisma/adapter-neon";
import { neonConfig } from "@neondatabase/serverless";
import * as fs from "fs";
import ws = require("ws");
neonConfig.webSocketConstructor = ws as unknown as typeof WebSocket;
const prod = new PrismaClient({ adapter: new PrismaNeon({ connectionString: fs.readFileSync(".env.production", "utf8").match(/^DATABASE_URL="?([^"\n]+)"?/m)![1] }) } as any);
const ORG = "52e90ba8-bfbd-48b0-bb76-4f9667bf74f1";
(async () => {
  const d = await prod.document.findFirst({
    where: { organizationId: ORG, type: "INVOICE", name: "BI202607065 (c295)" },
    select: { id: true, config: true },
  });
  const c: any = d!.config || {};
  const { voided, ...clean } = c;
  const taken = await prod.document.findFirst({ where: { organizationId: ORG, type: "INVOICE", name: "BI202607065" }, select: { id: true } });
  await prod.document.update({
    where: { id: d!.id },
    data: {
      name: taken ? "BI202607065 (c295)" : "BI202607065",
      status: "pending_payment",
      config: { ...clean, xeroStatus: "AUTHORISED", xeroBalance: 5450, xeroAmountPaid: 0, xeroGross: 5450 },
    },
  });
  console.log(`fixed: ${taken ? "kept suffixed name" : "renamed to BI202607065"}, un-voided, AUTHORISED $5,450 due`);
  await prod.$disconnect();
})();
