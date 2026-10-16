/**
 * Backfill the canonical GST-inclusive gross on docs that only carry nettTotal
 * (ingested invoices etc.): sets config.totalWithTax + legacy twin xeroGross
 * = round(nettTotal, 2) where BOTH are missing. Additive only — no other keys
 * touched, no GL effect. Root-cause fix shipped the same day (ingestion now
 * stamps via stampDocumentMoney); this closes the gap for pre-existing rows.
 *
 * Usage (from api-server-production/):
 *   npx ts-node --transpile-only scripts/backfill-ingested-gross.ts .env.production        # dry run
 *   npx ts-node --transpile-only scripts/backfill-ingested-gross.ts .env.production --apply
 */
import { PrismaClient } from "@prisma/client";
import { PrismaNeon } from "@prisma/adapter-neon";
import { neonConfig } from "@neondatabase/serverless";
import * as fs from "fs";
import ws = require("ws");
neonConfig.webSocketConstructor = ws as unknown as typeof WebSocket;

const ENV = process.argv[2] || ".env";
const APPLY = process.argv.includes("--apply");
const url = fs.readFileSync(ENV, "utf8").match(/^DATABASE_URL="?([^"\n]+)"?/m)![1];
const prisma = new PrismaClient({ adapter: new PrismaNeon({ connectionString: url }) } as any);

const WHERE = `
  config->>'totalWithTax' is null and config->>'xeroGross' is null
  and coalesce(nullif(config->>'nettTotal',''),'') <> ''
  and (config->>'nettTotal') ~ '^-?[0-9.]+$'
  and type in ('INVOICE','BILL','CREDIT_NOTE','DEBIT_NOTE')`;

(async () => {
  const rows: any[] = await prisma.$queryRawUnsafe(
    `select o.name org, d.type, count(*)::int n
       from "Document" d join "Organization" o on o.id = d."organizationId"
      where ${WHERE} group by 1,2 order by 3 desc`,
  );
  console.log(`[${ENV}] candidates:`, JSON.stringify(rows));
  const total = rows.reduce((s, r) => s + r.n, 0);
  if (!APPLY) {
    console.log(`DRY RUN — ${total} docs would be stamped. Re-run with --apply.`);
  } else {
    const n = await prisma.$executeRawUnsafe(
      `update "Document" set config = config || jsonb_build_object(
         'totalWithTax', round((config->>'nettTotal')::numeric, 2),
         'xeroGross',    round((config->>'nettTotal')::numeric, 2))
       where ${WHERE}`,
    );
    console.log(`APPLIED — ${n} docs stamped.`);
    const left: any[] = await prisma.$queryRawUnsafe(`select count(*)::int n from "Document" d where ${WHERE}`);
    console.log(`remaining candidates: ${left[0].n}`);
  }
  await prisma.$disconnect();
})().catch((e) => { console.error("FATAL", e?.message || e); process.exit(2); });
