/**
 * Verify prod invoice docs whose Xero id is unknown to dev's fresh mirror:
 * if Xero returns 404 (draft deleted in Xero), delete the stale AIMS row.
 * If Xero still has it (e.g. VOIDED), keep and report.
 */
import { PrismaClient } from "@prisma/client";
import { PrismaNeon } from "@prisma/adapter-neon";
import { neonConfig } from "@neondatabase/serverless";
import * as fs from "fs";
import ws = require("ws");
import { getXeroTokens, xeroGet } from "./xero-migration/_common";
neonConfig.webSocketConstructor = ws as unknown as typeof WebSocket;
const client = (f: string) => new PrismaClient({ adapter: new PrismaNeon({ connectionString: fs.readFileSync(f, "utf8").match(/^DATABASE_URL="?([^"\n]+)"?/m)![1] }) } as any);
const dev = client(".env"), prod = client(".env.production");
const ORG = "52e90ba8-bfbd-48b0-bb76-4f9667bf74f1";
(async () => {
  const tokens = await getXeroTokens(prod, ORG);
  const devIds: any[] = await dev.$queryRaw`
    SELECT COALESCE(config->>'xeroInvoiceId', config->>'xeroBillId', config->>'xeroCreditNoteId') AS xid
    FROM "Document" WHERE "organizationId"=${ORG} AND type IN ('INVOICE','BILL','CREDIT_NOTE')`;
  const devSet = new Set(devIds.map(r => r.xid).filter(Boolean));
  const cand: any[] = await prod.$queryRaw`
    SELECT id, name, type, status, COALESCE(config->>'xeroInvoiceId', config->>'xeroCreditNoteId') AS xid
    FROM "Document" WHERE "organizationId"=${ORG} AND type IN ('INVOICE','CREDIT_NOTE')
      AND COALESCE(config->>'xeroInvoiceId', config->>'xeroCreditNoteId') IS NOT NULL`;
  const ghosts = cand.filter(r => !devSet.has(r.xid));
  console.log(`candidates (xid unknown to dev mirror): ${ghosts.length}`);
  let deleted = 0, kept = 0;
  for (const g of ghosts) {
    let inXero = true, status = "";
    try {
      const r = await xeroGet<any>(tokens, `/Invoices/${g.xid}`, {});
      status = r?.Invoices?.[0]?.Status || "?";
    } catch (e: any) {
      if (/404/.test(e?.message || "")) inXero = false; else throw e;
    }
    if (!inXero) {
      const ids = [g.id];
      await prod.documentItem.deleteMany({ where: { documentId: { in: ids } } });
      await prod.documentEmbedding.deleteMany({ where: { documentId: { in: ids } } }).catch(() => null);
      await prod.timelineItem.deleteMany({ where: { documentId: { in: ids } } }).catch(() => null);
      await prod.document.updateMany({ where: { baseDocumentId: g.id }, data: { baseDocumentId: null } });
      await prod.document.delete({ where: { id: g.id } });
      console.log(`  ✂ deleted ghost ${g.type} ${g.name} (${g.status}) — gone from Xero`);
      deleted++;
    } else {
      console.log(`  = kept ${g.type} ${g.name} — still in Xero as ${status}`);
      kept++;
    }
  }
  console.log(`ghosts deleted=${deleted} kept=${kept}`);
  await dev.$disconnect(); await prod.$disconnect();
})();
