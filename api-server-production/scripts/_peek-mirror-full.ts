import { PrismaClient } from "@prisma/client";
import { PrismaNeon } from "@prisma/adapter-neon";
import { neonConfig } from "@neondatabase/serverless";
import * as fs from "fs";
import ws = require("ws");
neonConfig.webSocketConstructor = ws as unknown as typeof WebSocket;
const prod = new PrismaClient({ adapter: new PrismaNeon({ connectionString: fs.readFileSync(".env.production", "utf8").match(/^DATABASE_URL="?([^"\n]+)"?/m)![1] }) } as any);
const ORG = "52e90ba8-bfbd-48b0-bb76-4f9667bf74f1";
(async () => {
  const d = await prod.document.findFirst({ where: { organizationId: ORG, name: "BI202607031" }, select: { documentTemplateId: true, status: true, config: true } });
  const c: any = d!.config;
  console.log("templateId:", d!.documentTemplateId, "| status:", d!.status);
  console.log("top keys:", Object.keys(c).join(","));
  for (const k of ["date","dueDate","total","totalTax","subTotal","currency","customer","xeroStatus"])
    console.log(" ", k, "=", JSON.stringify(c[k])?.slice(0, 160));
  const items: any[] = c.items || [];
  console.log("items:", items.length);
  for (const it of items) console.log("   ", JSON.stringify({ q: it.quantity, up: it.unitPrice, amt: it.amount, tax: it.taxAmount, acct: it.accountCode, taxType: it.taxType, desc: (it.description || "").slice(0, 60) }));
  process.exit(0);
})();
