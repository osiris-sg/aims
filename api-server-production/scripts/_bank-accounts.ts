import { PrismaClient } from "@prisma/client";
import { PrismaNeon } from "@prisma/adapter-neon";
import { neonConfig } from "@neondatabase/serverless";
import * as fs from "fs";
import ws = require("ws");
neonConfig.webSocketConstructor = ws as unknown as typeof WebSocket;
const prisma = new PrismaClient({ adapter: new PrismaNeon({ connectionString: fs.readFileSync(".env.production", "utf8").match(/^DATABASE_URL="?([^"\n]+)"?/m)![1] }) } as any);
const ORG = "52e90ba8-bfbd-48b0-bb76-4f9667bf74f1";
(async () => {
  const banks = await prisma.chartOfAccount.findMany({ where: { organizationId: ORG, accountType: "BANK" }, select: { id: true, code: true, name: true } });
  console.log(`${banks.length} BANK accounts in AIMS CoA:`);
  for (const b of banks) console.log(`  ${b.code}  ${b.name}`);
  const imports = await prisma.bankStatementImport.count({ where: { organizationId: ORG } });
  const lines = await prisma.bankStatementLine.count({ where: { organizationId: ORG } });
  console.log(`existing bank-rec data: ${imports} imports, ${lines} lines`);
  process.exit(0);
})();
