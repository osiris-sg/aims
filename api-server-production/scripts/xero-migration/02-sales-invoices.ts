/**
 * Xero → AIMS migration · Stage 2 · Sales Invoices (ACCREC / AR)
 *
 * Pulls every Xero ACCREC Invoice for Biofuel with full line-item detail and
 * upserts into the Document table (type=INVOICE).
 *
 * Background: a previous import (Apr 2026) put ~1,796 invoices in but didn't
 * store the Xero InvoiceID, so re-syncing is awkward. This script:
 *   • Matches existing rows by `config.xeroInvoiceNumber` (their convention)
 *   • Stamps `config.xeroInvoiceId` (UUID) on EVERY row for future clean syncs
 *   • Adds the ~600 invoices missing from the old import
 *   • Refreshes line items + totals + status so anything edited in Xero
 *     since Apr 2026 lands fresh
 *
 * Resilience: re-runnable. If interrupted, picks up where it left off because
 * every row is upsert-by-invoice-number.
 *
 * Run: npx ts-node scripts/xero-migration/02-sales-invoices.ts
 */

import { PrismaClient, DocumentStatus, Prisma } from "@prisma/client";
import * as dotenv from "dotenv";
dotenv.config();

import { BIOFUEL_ORG_ID, getXeroTokens, xeroGet } from "./_common";

const prisma = new PrismaClient();

// The template the previous import used. Verified to exist + belong to Biofuel.
const INVOICE_TEMPLATE_ID = "cc6d0035-993f-403f-8dd6-582ce8b10b0b";

type XeroLineItem = {
  LineItemID?: string;
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
  Type: "ACCREC" | "ACCPAY";
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
  AmountCredited?: number;
  CurrencyCode?: string;
  HasAttachments?: boolean;
};

// Xero date format: "/Date(1620000000000+0000)/"
function parseXeroDate(s?: string): Date | null {
  if (!s) return null;
  const m = s.match(/\((\d+)/);
  if (!m) return null;
  return new Date(parseInt(m[1], 10));
}

function mapStatus(xeroStatus?: string): DocumentStatus {
  switch (xeroStatus) {
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

async function fetchInvoiceWithLines(tokens: any, invoiceId: string): Promise<XeroInvoice | null> {
  const data = await xeroGet<{ Invoices: XeroInvoice[] }>(tokens, `/Invoices/${invoiceId}`);
  return data.Invoices?.[0] || null;
}

async function main() {
  console.log(`[Sales Invoices] Biofuel org=${BIOFUEL_ORG_ID}`);
  const tokens = await getXeroTokens(prisma, BIOFUEL_ORG_ID);

  // Build customer lookup by Xero ContactID → Customer.id
  const customers = await prisma.customer.findMany({
    where: { organizationId: BIOFUEL_ORG_ID, xeroId: { not: null } },
    select: { id: true, name: true, xeroId: true },
  });
  const customerByXeroId = new Map(customers.map((c) => [c.xeroId!, c]));
  console.log(`[Sales Invoices] loaded ${customers.length} customers with xeroId`);

  let page = 1;
  let totalSeen = 0,
    created = 0,
    updated = 0,
    skipped = 0,
    failed = 0;
  const startedAt = Date.now();

  while (true) {
    // List page returns invoices WITHOUT line items. We grab summaries first
    // (fast, 100/page) then re-fetch each individually with line items.
    const list = await xeroGet<{ Invoices: XeroInvoice[] }>(tokens, "/Invoices", {
      page,
      pageSize: 100,
      where: 'Type=="ACCREC"',
      order: "Date ASC",
    });
    const invs = list.Invoices || [];
    if (invs.length === 0) break;
    totalSeen += invs.length;

    for (const summary of invs) {
      // Fetch the full invoice with line items.
      let inv: XeroInvoice | null;
      try {
        inv = await fetchInvoiceWithLines(tokens, summary.InvoiceID);
      } catch (e: any) {
        console.warn(`  ⚠️  fetch failed ${summary.InvoiceNumber}: ${e.message?.slice(0, 100)}`);
        failed++;
        continue;
      }
      if (!inv) {
        skipped++;
        continue;
      }

      const invoiceNumber = inv.InvoiceNumber?.trim() || `XERO-${inv.InvoiceID.slice(0, 8)}`;
      const date = parseXeroDate(inv.Date) || new Date();
      const dueDate = parseXeroDate(inv.DueDate);
      const customer = inv.Contact ? customerByXeroId.get(inv.Contact.ContactID) : null;

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
        customer: customer ? { id: customer.id, name: customer.name } : { id: null, name: inv.Contact?.Name || "(unknown)" },
        customerId: customer?.id || null,
        // Xero metadata — primary source of truth
        xeroImported: true,
        xeroInvoiceId: inv.InvoiceID, // ← the critical missing piece from the old import
        xeroInvoiceNumber: invoiceNumber,
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
          // Approximate GST percent from totals (SG GST stepped 7% → 8% → 9%)
          gstPercent: inv.SubTotal && inv.TotalTax ? Math.round((inv.TotalTax / inv.SubTotal) * 100) : 9,
        },
        xeroLastSyncAt: new Date().toISOString(),
      };

      try {
        // Match by (name, organizationId, documentTemplateId) per the unique
        // constraint @@unique([name, organizationId, documentTemplateId])
        const existing = await prisma.document.findFirst({
          where: {
            organizationId: BIOFUEL_ORG_ID,
            type: "INVOICE",
            OR: [
              { name: invoiceNumber },
              { config: { path: ["xeroInvoiceId"], equals: inv.InvoiceID } },
            ],
          },
          select: { id: true, documentTemplateId: true },
        });

        if (existing) {
          await prisma.document.update({
            where: { id: existing.id },
            data: {
              name: invoiceNumber,
              type: "INVOICE",
              status: mapStatus(inv.Status),
              config: config as unknown as Prisma.InputJsonValue,
            },
          });
          updated++;
        } else {
          await prisma.document.create({
            data: {
              organizationId: BIOFUEL_ORG_ID,
              documentTemplateId: INVOICE_TEMPLATE_ID,
              name: invoiceNumber,
              type: "INVOICE",
              status: mapStatus(inv.Status),
              config: config as unknown as Prisma.InputJsonValue,
            },
          });
          created++;
        }
      } catch (e: any) {
        failed++;
        if (failed <= 5) console.warn(`  ⚠️  upsert ${invoiceNumber}: ${e.message?.slice(0, 180)}`);
      }
    }

    const elapsed = Math.round((Date.now() - startedAt) / 1000);
    console.log(`[Sales Invoices] page ${page} done · seen=${totalSeen} created=${created} updated=${updated} failed=${failed} · ${elapsed}s`);

    if (invs.length < 100) break;
    page++;
  }

  console.log("\n[Sales Invoices] ✓ done");
  console.log(`  Total Xero invoices: ${totalSeen}`);
  console.log(`  Created: ${created}  Updated: ${updated}  Skipped: ${skipped}  Failed: ${failed}`);
}

main()
  .catch((e) => { console.error(e); process.exit(1); })
  .finally(() => prisma.$disconnect());
