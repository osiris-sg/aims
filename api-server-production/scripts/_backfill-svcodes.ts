// Backfill itemCode on Xero-imported mirrors from the account→SV-code map.
// Only fills BLANK itemCodes; existing codes are never overwritten.
import { PrismaClient } from "@prisma/client";
import { PrismaNeon } from "@prisma/adapter-neon";
import { neonConfig } from "@neondatabase/serverless";
import * as fs from "fs";
import ws = require("ws");
neonConfig.webSocketConstructor = ws as unknown as typeof WebSocket;
const prisma = new PrismaClient({ adapter: new PrismaNeon({ connectionString: fs.readFileSync(".env.production", "utf8").match(/^DATABASE_URL="?([^"\n]+)"?/m)![1] }) } as any);
const ORG = "52e90ba8-bfbd-48b0-bb76-4f9667bf74f1";
const DRY = process.argv.includes("--dry");
const SV: Record<string, string> = { "200":"SV001","201":"SV002","202":"SV003","203":"SV004","207":"SV006","209":"SV007","210":"SV008","211":"SV009","212":"SV010","213":"SV011","214":"SV012","216":"SV013","222":"SV014","223":"SV015","225":"SV016","226":"SV017","260":"SV018","261":"SV019","262":"SV020","263":"SV021","264":"SV022","270":"SV023","271":"SV024","443":"SV025" };
const svFor = (acct: string | null, desc: string) => !acct ? null : acct === "206" ? (/install/i.test(desc || "") ? "IS" : "SV005") : SV[acct] || null;
(async () => {
  const docs = await prisma.document.findMany({ where: { organizationId: ORG, type: { in: ["INVOICE", "BILL", "CREDIT_NOTE"] } }, select: { id: true, name: true, type: true, config: true } });
  let docsChanged = 0, linesFilled = 0;
  const byCode: Record<string, number> = {};
  for (const d of docs) {
    const c: any = d.config;
    const items: any[] = c?.items || [];
    let dirty = false;
    for (const it of items) {
      if (it.itemCode) continue;
      const code = svFor(it.accountCode, it.description || "");
      if (!code) continue;
      it.itemCode = code; dirty = true; linesFilled++;
      byCode[code] = (byCode[code] || 0) + 1;
    }
    if (dirty) {
      docsChanged++;
      if (!DRY) await prisma.document.update({ where: { id: d.id }, data: { config: { ...c, items } } });
    }
  }
  console.log(`${DRY ? "[DRY] would update" : "updated"} ${docsChanged} docs, ${linesFilled} lines coded`);
  console.log("by code:", JSON.stringify(byCode));
  process.exit(0);
})();
