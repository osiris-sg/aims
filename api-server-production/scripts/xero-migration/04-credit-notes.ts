/**
 * Xero → AIMS migration · Stage 4 · Credit Notes (AR + AP)
 *
 * Pulls every Xero CreditNote and upserts into Document with type='CREDIT_NOTE'.
 * The credit-note Type (ACCRECCREDIT vs ACCPAYCREDIT) tells us whether it's
 * customer-side or supplier-side; we mirror the side in config.subtype.
 *
 * Convention (config JSON):
 *   { date, items, subtype: 'AR' | 'AP',
 *     customer | supplier: { id, name },
 *     xeroImported: true, xeroCreditNoteId, xeroCreditNoteNumber,
 *     xeroStatus, xeroSubtotal, xeroTax, xeroGross, xeroRemainingCredit }
 *
 * Run: npx ts-node scripts/xero-migration/04-credit-notes.ts
 */

import { PrismaClient, DocumentStatus, Prisma } from "@prisma/client";
import * as dotenv from "dotenv";
dotenv.config();

import { BIOFUEL_ORG_ID, getXeroTokens, xeroGet } from "./_common";

const prisma = new PrismaClient();

// Reuse the existing Invoice + Bill templates so AR credit notes look like
// invoices and AP credit notes look like bills in the UI.
const INVOICE_TEMPLATE_ID = "cc6d0035-993f-403f-8dd6-582ce8b10b0b";
const BILL_TEMPLATE_ID = "daa7a601-60f2-48da-9e3a-737ee6bf6987";

type XeroLine = {
  Description?: string;
  Quantity?: number;
  UnitAmount?: number;
  AccountCode?: string;
  TaxAmount?: number;
  LineAmount?: number;
  TaxType?: string;
};

type XeroCreditNote = {
  CreditNoteID: string;
  CreditNoteNumber?: string;
  Type: "ACCRECCREDIT" | "ACCPAYCREDIT";
  Reference?: string;
  Contact?: { ContactID: string; Name?: string };
  Date?: string;
  Status?: string;
  LineItems?: XeroLine[];
  SubTotal?: number;
  TotalTax?: number;
  Total?: number;
  RemainingCredit?: number;
  CurrencyCode?: string;
  HasAttachments?: boolean;
};

function parseXeroDate(s?: string): Date | null {
  if (!s) return null;
  const m = s.match(/\((\d+)/);
  return m ? new Date(parseInt(m[1], 10)) : null;
}

function mapStatus(s?: string): DocumentStatus {
  switch (s) {
    case "DRAFT":
    case "SUBMITTED":
      return "draft" as DocumentStatus;
    case "VOIDED":
    case "DELETED":
      return "cancelled" as DocumentStatus;
    default:
      return "confirmed" as DocumentStatus;
  }
}

async function fetchOne(tokens: any, id: string): Promise<XeroCreditNote | null> {
  const data = await xeroGet<{ CreditNotes: XeroCreditNote[] }>(tokens, `/CreditNotes/${id}`);
  return data.CreditNotes?.[0] || null;
}

async function importType(tokens: any, side: "AR" | "AP") {
  const xeroType = side === "AR" ? "ACCRECCREDIT" : "ACCPAYCREDIT";
  const tmplId = side === "AR" ? INVOICE_TEMPLATE_ID : BILL_TEMPLATE_ID;

  // Build contact → row lookup
  let contactLookup: Map<string, { id: string; name: string }>;
  if (side === "AR") {
    const rows = await prisma.customer.findMany({
      where: { organizationId: BIOFUEL_ORG_ID, xeroId: { not: null } },
      select: { id: true, name: true, xeroId: true },
    });
    contactLookup = new Map(rows.map((r) => [r.xeroId!, r]));
  } else {
    const rows = await prisma.supplier.findMany({
      where: { organizationId: BIOFUEL_ORG_ID, xeroId: { not: null } },
      select: { id: true, name: true, xeroId: true },
    });
    contactLookup = new Map(rows.map((r) => [r.xeroId!, r]));
  }
  console.log(`[Credit Notes ${side}] loaded ${contactLookup.size} contacts`);

  let page = 1, totalSeen = 0, created = 0, updated = 0, failed = 0;
  const startedAt = Date.now();

  while (true) {
    const list = await xeroGet<{ CreditNotes: XeroCreditNote[] }>(tokens, "/CreditNotes", {
      page,
      pageSize: 100,
      where: `Type=="${xeroType}"`,
      order: "Date ASC",
    });
    const notes = list.CreditNotes || [];
    if (notes.length === 0) break;
    totalSeen += notes.length;

    for (const summary of notes) {
      let cn: XeroCreditNote | null;
      try {
        cn = await fetchOne(tokens, summary.CreditNoteID);
      } catch (e: any) {
        failed++;
        console.warn(`  ⚠️  fetch ${summary.CreditNoteNumber}: ${e.message?.slice(0, 100)}`);
        continue;
      }
      if (!cn) continue;

      const cnNumber = cn.CreditNoteNumber?.trim() || `XERO-CN-${cn.CreditNoteID.slice(0, 8)}`;
      const date = parseXeroDate(cn.Date) || new Date();
      const contact = cn.Contact ? contactLookup.get(cn.Contact.ContactID) : null;

      const items = (cn.LineItems || []).map((li, idx) => ({
        lineNumber: idx + 1,
        description: li.Description || "",
        quantity: li.Quantity ?? 1,
        unitPrice: li.UnitAmount ?? 0,
        amount: li.LineAmount ?? 0,
        taxAmount: li.TaxAmount ?? 0,
        accountCode: li.AccountCode || null,
        taxType: li.TaxType || null,
      }));

      const config: any = {
        date: date.toISOString(),
        items,
        subtype: side,
        xeroImported: true,
        xeroCreditNoteId: cn.CreditNoteID,
        xeroCreditNoteNumber: cnNumber,
        xeroStatus: cn.Status,
        xeroReference: cn.Reference || null,
        xeroSubtotal: cn.SubTotal ?? 0,
        xeroTax: cn.TotalTax ?? 0,
        xeroGross: cn.Total ?? 0,
        xeroRemainingCredit: cn.RemainingCredit ?? 0,
        xeroHasAttachments: cn.HasAttachments === true,
        documentInfo: {
          currency: cn.CurrencyCode || "SGD",
          gstPercent: cn.SubTotal && cn.TotalTax ? Math.round((cn.TotalTax / cn.SubTotal) * 100) : 9,
        },
        xeroLastSyncAt: new Date().toISOString(),
      };
      if (side === "AR") {
        config.customer = contact ? { id: contact.id, name: contact.name } : { id: null, name: cn.Contact?.Name || "(unknown)" };
        config.customerId = contact?.id || null;
      } else {
        config.supplier = contact ? { id: contact.id, name: contact.name } : { id: null, name: cn.Contact?.Name || "(unknown)" };
        config.supplierId = contact?.id || null;
      }

      try {
        const existing = await prisma.document.findFirst({
          where: {
            organizationId: BIOFUEL_ORG_ID,
            type: "CREDIT_NOTE",
            OR: [
              { config: { path: ["xeroCreditNoteId"], equals: cn.CreditNoteID } },
              { name: cnNumber },
            ],
          },
          select: { id: true },
        });

        if (existing) {
          await prisma.document.update({
            where: { id: existing.id },
            data: {
              name: cnNumber,
              type: "CREDIT_NOTE",
              status: mapStatus(cn.Status),
              config: config as Prisma.InputJsonValue,
            },
          });
          updated++;
        } else {
          await prisma.document.create({
            data: {
              organizationId: BIOFUEL_ORG_ID,
              documentTemplateId: tmplId,
              name: cnNumber,
              type: "CREDIT_NOTE",
              status: mapStatus(cn.Status),
              config: config as Prisma.InputJsonValue,
            },
          });
          created++;
        }
      } catch (e: any) {
        failed++;
        if (failed <= 5) console.warn(`  ⚠️  upsert ${cnNumber}: ${e.message?.slice(0, 150)}`);
      }
    }

    const elapsed = Math.round((Date.now() - startedAt) / 1000);
    console.log(`[Credit Notes ${side}] page ${page} done · seen=${totalSeen} created=${created} updated=${updated} failed=${failed} · ${elapsed}s`);
    if (notes.length < 100) break;
    page++;
  }
  console.log(`[Credit Notes ${side}] ✓ done · ${totalSeen} seen, ${created} created, ${updated} updated, ${failed} failed`);
  return { side, totalSeen, created, updated, failed };
}

async function main() {
  console.log(`[Credit Notes] Biofuel org=${BIOFUEL_ORG_ID}`);
  const tokens = await getXeroTokens(prisma, BIOFUEL_ORG_ID);
  const ar = await importType(tokens, "AR");
  const ap = await importType(tokens, "AP");
  console.log("\n[Credit Notes] all done");
  console.log(`  AR: ${ar.totalSeen} seen, ${ar.created} created, ${ar.updated} updated`);
  console.log(`  AP: ${ap.totalSeen} seen, ${ap.created} created, ${ap.updated} updated`);
}

main()
  .catch((e) => { console.error(e); process.exit(1); })
  .finally(() => prisma.$disconnect());
