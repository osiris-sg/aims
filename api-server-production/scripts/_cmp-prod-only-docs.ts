import { PrismaClient } from "@prisma/client";
import { PrismaNeon } from "@prisma/adapter-neon";
import { neonConfig } from "@neondatabase/serverless";
import * as fs from "fs";
import ws = require("ws");
neonConfig.webSocketConstructor = ws as unknown as typeof WebSocket;
const client = (f: string) => new PrismaClient({ adapter: new PrismaNeon({ connectionString: fs.readFileSync(f, "utf8").match(/^DATABASE_URL="?([^"\n]+)"?/m)![1] }) } as any);
const dev = client(".env"), prod = client(".env.production");
const ORG = "52e90ba8-bfbd-48b0-bb76-4f9667bf74f1";
(async () => {
  const devDocs: any[] = await dev.$queryRaw`
    SELECT name, COALESCE(config->>'xeroInvoiceId', config->>'xeroBillId', config->>'xeroCreditNoteId') AS xid
    FROM "Document" WHERE "organizationId"=${ORG} AND type IN ('INVOICE','CREDIT_NOTE')`;
  const devNames = new Set(devDocs.map(r => r.name));
  const devXids = new Set(devDocs.filter(r => r.xid).map(r => r.xid));
  const prodDocs: any[] = await prod.$queryRaw`
    SELECT type, name, status, "createdAt"::date AS created,
      COALESCE(config->>'xeroInvoiceId', config->>'xeroCreditNoteId') AS xid,
      config->>'inboundChannel' AS channel,
      COALESCE(config->'totals'->>'total', config->>'nettTotal') AS total
    FROM "Document" WHERE "organizationId"=${ORG} AND type IN ('INVOICE','CREDIT_NOTE')
    ORDER BY type, name`;
  const only = prodDocs.filter(r => !devNames.has(r.name) && !(r.xid && devXids.has(r.xid)));
  console.log(`prod invoices/CNs NOT in dev: ${only.length}`);
  for (const r of only)
    console.log(`${r.type.padEnd(12)} ${String(r.name).padEnd(34)} ${String(r.status).padEnd(16)} created=${r.created} xid=${r.xid ? "yes" : "no "} ch=${r.channel || "-"} total=${r.total ?? "?"}`);
  await dev.$disconnect(); await prod.$disconnect();
})();
