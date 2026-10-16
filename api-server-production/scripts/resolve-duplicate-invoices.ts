/**
 * Resolve the four Xero invoices claimed by two AIMS documents each
 * (guru 2026-10-02). The sync maps xeroInvoiceId -> document, so with two
 * claimants one is updated and the other is frozen forever — which is how
 * BI202609085 sat at DRAFT while Xero had it AUTHORISED.
 *
 * Two of the pairs also DOUBLE-COUNT in AR: both sides carry the same
 * outstanding balance ($708.50 and $96,166.13), overstating AR by $96,874.63.
 *
 * The loser is voided, not deleted: config.voided = true (which every AR/SOA
 * reader already honours), balance zeroed, status 'draft' — the same shape the
 * balance sync gives a voided Xero invoice — and its xeroInvoiceId cleared so
 * it stops competing for the Xero record. The row stays for audit.
 */
import { PrismaClient } from "@prisma/client";
import { PrismaNeon } from "@prisma/adapter-neon";
import { neonConfig } from "@neondatabase/serverless";
import * as fs from "fs"; import ws = require("ws");
neonConfig.webSocketConstructor = ws as unknown as typeof WebSocket;
const prisma = new PrismaClient({ adapter: new PrismaNeon({ connectionString: fs.readFileSync(".env.production","utf8").match(/^DATABASE_URL="?([^"\n]+)"?/m)![1] }) } as any);
const ORG = "52e90ba8-bfbd-48b0-bb76-4f9667bf74f1";
const APPLY = process.argv.includes("--apply");

// keeper id prefix, loser id prefix, why
const PAIRS: Array<{ keep: string; lose: string; why: string }> = [
  { keep: "95f57f0f", lose: "4484c88d", why: "keeper matches Xero (PAID); loser is the stale draft" },
  { keep: "04b051e6", lose: "627e73ff", why: "keeper BI202609085 is the original and holds the posted journal; loser is a re-entry" },
  { keep: "3b942cb7", lose: "01688af8", why: "keeper BI202609045 has the real number and the journal; loser kept its 'xxx' placeholder" },
  { keep: "d02601a9", lose: "30c61633", why: "keeper has 8 journals; loser is the importer's '(318b)' duplicate" },
];

(async () => {
  const docs = await prisma.document.findMany({ where: { organizationId: ORG, type: "INVOICE" }, select: { id: true, name: true, status: true, config: true } });
  const find = (p: string) => docs.find((d) => d.id.startsWith(p));
  let freed = 0;
  for (const pr of PAIRS) {
    const keep = find(pr.keep), lose = find(pr.lose);
    if (!keep || !lose) { console.log(`  ✗ pair ${pr.keep}/${pr.lose}: not found`); continue; }
    const kc: any = keep.config || {}, lc: any = lose.config || {};
    const owed = Number(lc.outstandingBalance ?? lc.xeroBalance ?? 0) || 0;
    freed += owed;
    console.log(`\n${APPLY ? "" : "[dry] "}keep ${keep.name} [${keep.status}]   void ${lose.name} [${lose.status}]`);
    console.log(`      ${pr.why}`);
    if (owed) console.log(`      removes ${owed.toFixed(2)} of double-counted AR`);
    // carry over a customer the keeper is missing
    const carryCustomer = !kc.customerId && lc.customerId;
    if (carryCustomer) console.log(`      carrying customerId across (keeper had none)`);
    if (!APPLY) continue;
    if (carryCustomer) await prisma.document.update({ where: { id: keep.id }, data: { config: { ...kc, customerId: lc.customerId, customerName: lc.customerName ?? kc.customerName } as any } });
    const { xeroInvoiceId, xeroInvoiceNumber, ...rest } = lc;
    await prisma.document.update({
      where: { id: lose.id },
      data: {
        status: "draft" as any,
        config: { ...rest, voided: true, outstandingBalance: 0, xeroBalance: 0, paymentStatus: "draft",
                  supersededBy: keep.name, supersededAt: new Date().toISOString(),
                  supersedeReason: pr.why } as any,
      },
    });
    await prisma.actionLog.create({ data: {
      actorType: "SYSTEM", actorId: "system:resolve-duplicate-invoices", actorName: "System creation",
      organizationId: ORG, channel: "cron", action: "VOID", resource: "documents", resourceId: lose.id,
      details: { note: `duplicate of ${keep.name}; Xero link released`, voided: lose.name, keeper: keep.name, arRemoved: owed },
    } });
  }
  console.log(`\n${APPLY ? "voided" : "would void"} ${PAIRS.length} duplicate(s) · AR double-count removed ${freed.toFixed(2)}`);
  process.exit(0);
})();
