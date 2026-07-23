import { PrismaClient } from "@prisma/client";
import { PrismaNeon } from "@prisma/adapter-neon";
import { neonConfig } from "@neondatabase/serverless";
import * as fs from "fs";
import ws = require("ws");
neonConfig.webSocketConstructor = ws as unknown as typeof WebSocket;
const client = (f: string) => new PrismaClient({ adapter: new PrismaNeon({ connectionString: fs.readFileSync(f, "utf8").match(/^DATABASE_URL="?([^"\n]+)"?/m)![1] }) } as any);
const dev = client(".env"), prod = client(".env.production");
const ORG = "52e90ba8-bfbd-48b0-bb76-4f9667bf74f1";

async function snap(p: PrismaClient, label: string) {
  const docs: any[] = await p.$queryRaw`
    SELECT type, status, COUNT(*)::int AS n,
      COUNT(*) FILTER (WHERE config->>'xeroInvoiceId' IS NOT NULL OR config->>'xeroBillId' IS NOT NULL OR config->>'xeroCreditNoteId' IS NOT NULL)::int AS with_xero_id
    FROM "Document" WHERE "organizationId" = ${ORG}
    GROUP BY 1,2 ORDER BY 1,2`;
  const je: any[] = await p.$queryRaw`
    SELECT COALESCE("postedBy",'(null)') AS src, COUNT(*)::int AS n, MAX("entryDate")::date AS last
    FROM "JournalEntry" WHERE "organizationId" = ${ORG} GROUP BY 1 ORDER BY 2 DESC`;
  const [tb]: any[] = await p.$queryRaw`
    SELECT ROUND(SUM(l."debit"-l."credit")::numeric,2) AS net, COUNT(*)::int AS lines
    FROM "JournalEntryLine" l JOIN "JournalEntry" j ON j.id=l."journalEntryId" WHERE j."organizationId"=${ORG}`;
  const [misc]: any[] = await p.$queryRaw`
    SELECT
      (SELECT COUNT(*)::int FROM "Customer" WHERE "organizationId"=${ORG}) AS customers,
      (SELECT COUNT(*)::int FROM "Customer" WHERE "organizationId"=${ORG} AND "xeroId" IS NOT NULL) AS cust_xero,
      (SELECT COUNT(*)::int FROM "Supplier" WHERE "organizationId"=${ORG}) AS suppliers,
      (SELECT COUNT(*)::int FROM "ChartOfAccount" WHERE "organizationId"=${ORG}) AS coa,
      (SELECT COUNT(*)::int FROM "BankStatementImport" WHERE "organizationId"=${ORG}) AS bank_imports,
      (SELECT COUNT(*)::int FROM "Payment" WHERE "organizationId"=${ORG}) AS payments,
      (SELECT COUNT(*)::int FROM "ImportInvoice" WHERE "organizationId"=${ORG}) AS import_invoices`;
  console.log(`\n======== ${label} ========`);
  console.table(docs);
  console.table(je);
  console.log(`trial balance net=${tb.net} lines=${tb.lines}`);
  console.table([misc]);
  return { docs, je, tb, misc };
}

(async () => {
  await snap(dev, "DEV");
  await snap(prod, "PROD");

  // GL per-account diff (dev = Xero truth)
  const bal = async (p: PrismaClient) => {
    const rows: any[] = await p.$queryRaw`
      SELECT c."code" AS code, MAX(c."name") AS name, ROUND(SUM(l."debit"-l."credit")::numeric,2) AS net
      FROM "JournalEntryLine" l JOIN "JournalEntry" j ON j.id=l."journalEntryId"
      JOIN "ChartOfAccount" c ON c.id=l."accountId"
      WHERE j."organizationId"=${ORG} GROUP BY 1`;
    return new Map(rows.map(r => [r.code, r]));
  };
  const d = await bal(dev), pr = await bal(prod);
  const codes = [...new Set([...d.keys(), ...pr.keys()])].sort();
  const diffs: any[] = [];
  for (const c of codes) {
    const dn = Number(d.get(c)?.net || 0), pn = Number(pr.get(c)?.net || 0);
    if (Math.abs(dn - pn) > 0.01) diffs.push({ code: c, name: (d.get(c)?.name || pr.get(c)?.name || "").slice(0, 30), dev: dn, prod: pn, diff: Math.round((dn - pn) * 100) / 100 });
  }
  diffs.sort((a, b) => Math.abs(b.diff) - Math.abs(a.diff));
  console.log(`\n======== GL PER-ACCOUNT DIFF (dev − prod), ${diffs.length} accounts differ ========`);
  console.table(diffs.slice(0, 30));

  // doc overlap by xero id
  const ids = async (p: PrismaClient) => {
    const rows: any[] = await p.$queryRaw`
      SELECT type, COALESCE(config->>'xeroInvoiceId', config->>'xeroBillId', config->>'xeroCreditNoteId') AS xid, name
      FROM "Document" WHERE "organizationId"=${ORG} AND type IN ('INVOICE','BILL','CREDIT_NOTE')`;
    return rows;
  };
  const dd = await ids(dev), pp = await ids(prod);
  const dSet = new Set(dd.filter(r => r.xid).map(r => r.xid));
  const pSet = new Set(pp.filter(r => r.xid).map(r => r.xid));
  const devOnly = dd.filter(r => r.xid && !pSet.has(r.xid));
  const prodOnly = pp.filter(r => r.xid && !dSet.has(r.xid));
  const prodNoXid = pp.filter(r => !r.xid);
  console.log(`\nGL docs — dev-only (in Xero, missing from prod): ${devOnly.length}; prod-only (has xeroId dev lacks): ${prodOnly.length}; prod docs WITHOUT any xero id: ${prodNoXid.length}`);
  const byType = (arr: any[]) => Object.entries(arr.reduce((m: any, r) => ((m[r.type] = (m[r.type] || 0) + 1), m), {}));
  console.log("dev-only by type:", byType(devOnly), "| prod-only by type:", byType(prodOnly), "| prod-no-xid by type:", byType(prodNoXid));
  console.log("sample prod-no-xid:", prodNoXid.slice(0, 12).map(r => r.name));
  console.log("sample dev-only:", devOnly.slice(0, 8).map(r => r.name));
  await dev.$disconnect(); await prod.$disconnect();
})();
