/**
 * Xero → AIMS migration · Stage 3 · Purchase Bills (ACCPAY / AP)
 *
 * Pulls every Xero ACCPAY Invoice (vendor bill) and upserts into Document with
 * type='BILL'. Mirrors stage 2's pattern so all document types share one table.
 *
 * Convention (config JSON):
 *   { date, dueDate, items: [...], supplier: { id, name },
 *     xeroImported: true, xeroBillId, xeroBillNumber,
 *     xeroStatus, xeroSubtotal, xeroTax, xeroGross, xeroBalance, ... }
 *
 * Idempotent: matched by xeroBillId in config (UUID, unique per Xero record)
 * OR by name=bill-number as fallback for any pre-existing rows.
 *
 * Run: npx ts-node scripts/xero-migration/03-purchase-bills.ts
 */

import { PrismaClient, DocumentStatus, Prisma } from "@prisma/client";
import * as dotenv from "dotenv";
dotenv.config();

import { BIOFUEL_ORG_ID, getXeroTokens, xeroGet } from "./_common";

const prisma = new PrismaClient();

// Bill template seeded by _seed-bill-template.ts
const BILL_TEMPLATE_ID = "daa7a601-60f2-48da-9e3a-737ee6bf6987";

type XeroLineItem = {
  Description?: string;
  Quantity?: number;
  UnitAmount?: number;
  ItemCode?: string;
  AccountCode?: string;
  TaxType?: string;
  TaxAmount?: number;
  LineAmount?: number;
  DiscountRate?: number;
};

type XeroInvoice = {
  InvoiceID: string;
  InvoiceNumber?: string;
  Reference?: string;
  Contact?: { ContactID: string; Name?: string };
  Date?: string;
  DueDate?: string;
  Status?: string;
  LineItems?: XeroLineItem[];
  SubTotal?: number;
  TotalTax?: number;
  Total?: number;
  AmountDue?: number;
  AmountPaid?: number;
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
    case "AUTHORISED":
    case "PAID":
      return "confirmed" as DocumentStatus;
    case "VOIDED":
    case "DELETED":
      return "cancelled" as DocumentStatus;
    default:
      return "confirmed" as DocumentStatus;
  }
}

async function fetchOne(tokens: any, id: string): Promise<XeroInvoice | null> {
  const data = await xeroGet<{ Invoices: XeroInvoice[] }>(tokens, `/Invoices/${id}`);
  return data.Invoices?.[0] || null;
}

async function main() {
  console.log(`[Purchase Bills] Biofuel org=${BIOFUEL_ORG_ID}`);
  const tokens = await getXeroTokens(prisma, BIOFUEL_ORG_ID);

  const suppliers = await prisma.supplier.findMany({
    where: { organizationId: BIOFUEL_ORG_ID, xeroId: { not: null } },
    select: { id: true, name: true, xeroId: true },
  });
  const supplierByXeroId = new Map(suppliers.map((s) => [s.xeroId!, s]));
  console.log(`[Purchase Bills] loaded ${suppliers.length} suppliers with xeroId`);

  let page = 1;
  let totalSeen = 0, created = 0, updated = 0, skipped = 0, failed = 0;
  const startedAt = Date.now();

  while (true) {
    const list = await xeroGet<{ Invoices: XeroInvoice[] }>(tokens, "/Invoices", {
      page,
      pageSize: 100,
      where: 'Type=="ACCPAY"',
      order: "Date ASC",
    });
    const invs = list.Invoices || [];
    if (invs.length === 0) break;
    totalSeen += invs.length;

    for (const summary of invs) {
      let inv: XeroInvoice | null;
      try {
        inv = await fetchOne(tokens, summary.InvoiceID);
      } catch (e: any) {
        console.warn(`  ⚠️  fetch ${summary.InvoiceNumber}: ${e.message?.slice(0, 100)}`);
        failed++;
        continue;
      }
      if (!inv) { skipped++; continue; }

      const billNumber = inv.InvoiceNumber?.trim() || `XERO-${inv.InvoiceID.slice(0, 8)}`;
      const date = parseXeroDate(inv.Date) || new Date();
      const dueDate = parseXeroDate(inv.DueDate);
      const supplier = inv.Contact ? supplierByXeroId.get(inv.Contact.ContactID) : null;

      const items = (inv.LineItems || []).map((li, idx) => ({
        lineNumber: idx + 1,
        description: li.Description || "",
        quantity: li.Quantity ?? 1,
        unitPrice: li.UnitAmount ?? 0,
        amount: li.LineAmount ?? 0,
        taxAmount: li.TaxAmount ?? 0,
        accountCode: li.AccountCode || null,
        itemCode: li.ItemCode || null,
        taxType: li.TaxType || null,
        discount: li.DiscountRate ?? 0,
      }));

      const config = {
        date: date.toISOString(),
        dueDate: dueDate?.toISOString() || null,
        items,
        supplier: supplier ? { id: supplier.id, name: supplier.name } : { id: null, name: inv.Contact?.Name || "(unknown)" },
        supplierId: supplier?.id || null,
        xeroImported: true,
        xeroBillId: inv.InvoiceID,
        xeroBillNumber: billNumber,
        xeroStatus: inv.Status,
        xeroReference: inv.Reference || null,
        xeroSubtotal: inv.SubTotal ?? 0,
        xeroTax: inv.TotalTax ?? 0,
        xeroGross: inv.Total ?? 0,
        xeroBalance: inv.AmountDue ?? 0,
        xeroAmountPaid: inv.AmountPaid ?? 0,
        xeroHasAttachments: inv.HasAttachments === true,
        documentInfo: {
          currency: inv.CurrencyCode || "SGD",
          gstPercent: inv.SubTotal && inv.TotalTax ? Math.round((inv.TotalTax / inv.SubTotal) * 100) : 9,
        },
        xeroLastSyncAt: new Date().toISOString(),
      };

      try {
        const existing = await prisma.document.findFirst({
          where: {
            organizationId: BIOFUEL_ORG_ID,
            type: "BILL",
            OR: [
              { config: { path: ["xeroBillId"], equals: inv.InvoiceID } },
              { name: billNumber },
            ],
          },
          select: { id: true },
        });

        if (existing) {
          await prisma.document.update({
            where: { id: existing.id },
            data: {
              name: billNumber,
              type: "BILL",
              status: mapStatus(inv.Status),
              config: config as unknown as Prisma.InputJsonValue,
            },
          });
          updated++;
        } else {
          await prisma.document.create({
            data: {
              organizationId: BIOFUEL_ORG_ID,
              documentTemplateId: BILL_TEMPLATE_ID,
              name: billNumber,
              type: "BILL",
              status: mapStatus(inv.Status),
              config: config as unknown as Prisma.InputJsonValue,
            },
          });
          created++;
        }
      } catch (e: any) {
        failed++;
        if (failed <= 5) console.warn(`  ⚠️  upsert ${billNumber}: ${e.message?.slice(0, 180)}`);
      }
    }

    const elapsed = Math.round((Date.now() - startedAt) / 1000);
    console.log(`[Purchase Bills] page ${page} done · seen=${totalSeen} created=${created} updated=${updated} failed=${failed} · ${elapsed}s`);

    if (invs.length < 100) break;
    page++;
  }

  console.log("\n[Purchase Bills] ✓ done");
  console.log(`  Total: ${totalSeen}  Created: ${created}  Updated: ${updated}  Skipped: ${skipped}  Failed: ${failed}`);
}

main()
  .catch((e) => { console.error(e); process.exit(1); })
  .finally(() => prisma.$disconnect());
