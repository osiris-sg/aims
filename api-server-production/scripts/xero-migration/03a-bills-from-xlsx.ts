/**
 * Xero → AIMS migration · Stage 3 (XLSX path) · Purchase Bills
 *
 * Imports Biofuel's full AP history from Xero's "Payable Invoice Detail"
 * XLSX report. Mirrors the existing import convention used for AR invoices:
 * one Document row per bill with type='BILL', supplier link via name match,
 * line items + xero metadata in config JSON.
 *
 * Row layout (Xero report export):
 *   Section header     → supplier name (col 0, others empty)
 *   Data row           → Date | Source | Reference | ItemCode | Description |
 *                        Qty | UnitPrice | Tax | Gross | InvoiceTotal | Status
 *   Total ... / blank  → ignore
 *
 * Multiple rows share the same Reference when a bill has multiple lines —
 * grouped here, aggregated into one Document.
 *
 * Idempotent: matched by (organizationId, type='BILL', config.xeroBillNumber).
 *
 * Run: npx ts-node scripts/xero-migration/03a-bills-from-xlsx.ts
 */

import { PrismaClient, DocumentStatus, Prisma } from "@prisma/client";
import * as xlsx from "xlsx";

const prisma = new PrismaClient();
const BIOFUEL_ORG_ID = "52e90ba8-bfbd-48b0-bb76-4f9667bf74f1";
const XLSX_PATH = "/Users/guru/Downloads/Biofuel_Industries_Pte_Ltd_-_Payable_Invoice_Detail.xlsx";

// Reuse the same Bill template seeded earlier (per guru's call to keep
// bills in the Document table). Falls back to creating one if missing.
let BILL_TEMPLATE_ID = "daa7a601-60f2-48da-9e3a-737ee6bf6987";

type DataRow = {
  date: string;
  source: string; // "Payable Invoice" | "Payable Credit Note"
  reference: string;
  itemCode: string;
  description: string;
  quantity: number;
  unitPrice: number;
  tax: number;
  gross: number;
  invoiceTotal: number;
  status: string; // Paid | Approved | Voided | Draft | Deleted
  supplierName: string;
};

const parseNum = (s: any): number => {
  if (s == null || s === "") return 0;
  return parseFloat(String(s).replace(/,/g, "")) || 0;
};

const parseDate = (s: string): Date | null => {
  if (!s) return null;
  const [d, mon, y] = s.split(/\s+/);
  if (!d || !mon || !y) return null;
  return new Date(`${mon} ${d} ${y} UTC`);
};

const mapStatus = (xeroStatus: string): DocumentStatus => {
  switch (xeroStatus) {
    case "Draft":
    case "Submitted":
      return "draft" as DocumentStatus;
    case "Voided":
    case "Deleted":
      return "cancelled" as DocumentStatus;
    case "Paid":
    case "Approved":
    case "Authorised":
    default:
      return "confirmed" as DocumentStatus;
  }
};

async function ensureBillTemplate() {
  const exists = await prisma.documentTemplate.findUnique({ where: { id: BILL_TEMPLATE_ID } });
  if (exists) return;
  const seeded = await prisma.documentTemplate.findFirst({
    where: { organizationId: BIOFUEL_ORG_ID, type: "BILL" },
  });
  if (seeded) {
    BILL_TEMPLATE_ID = seeded.id;
    return;
  }
  const created = await prisma.documentTemplate.create({
    data: {
      organizationId: BIOFUEL_ORG_ID,
      name: "Bill (Xero import)",
      type: "BILL",
      isActive: true,
      templateVariant: "Default",
      designName: "Default",
      description: "Auto-created for Xero AP bill imports",
      config: {
        tableColumnOrder: ["description", "quantity", "unitPrice", "taxAmount", "amount"],
        columnLabels: { description: "Description", quantity: "Qty", unitPrice: "Unit Price", taxAmount: "Tax", amount: "Amount" },
        formFields: [],
      } as any,
    },
  });
  BILL_TEMPLATE_ID = created.id;
  console.log(`  Created Bill template: ${BILL_TEMPLATE_ID}`);
}

function parseRows(): DataRow[] {
  const wb = xlsx.readFile(XLSX_PATH);
  const rows: any[][] = xlsx.utils.sheet_to_json(wb.Sheets[wb.SheetNames[0]], { header: 1, raw: false, defval: "" });

  const out: DataRow[] = [];
  let currentSupplier = "";

  for (const r of rows) {
    const c0 = String(r[0] || "").trim();
    if (!c0) continue;
    // Section header — supplier name
    if (!/^\d{1,2}\s\w{3}\s\d{4}$/.test(c0)) {
      if (c0.startsWith("Total ") || c0.startsWith("Payable") || c0.startsWith("Biofuel") ||
          c0.startsWith("For the") || c0 === "Invoice Date") continue;
      currentSupplier = c0;
      continue;
    }
    // Data row
    out.push({
      date: c0,
      source: String(r[1] || ""),
      reference: String(r[2] || "").trim(),
      itemCode: String(r[3] || ""),
      description: String(r[4] || ""),
      quantity: parseNum(r[5]),
      unitPrice: parseNum(r[6]),
      tax: parseNum(r[7]),
      gross: parseNum(r[8]),
      invoiceTotal: parseNum(r[9]),
      status: String(r[10] || ""),
      supplierName: currentSupplier,
    });
  }
  return out;
}

async function main() {
  console.log(`[AP Bills XLSX] reading ${XLSX_PATH}`);
  await ensureBillTemplate();

  const data = parseRows();
  console.log(`[AP Bills XLSX] parsed ${data.length} data rows`);

  // Build supplier lookup by name (case-insensitive)
  const suppliers = await prisma.supplier.findMany({
    where: { organizationId: BIOFUEL_ORG_ID },
    select: { id: true, name: true },
  });
  const supplierByName = new Map(suppliers.map((s) => [s.name.toLowerCase(), s]));
  console.log(`[AP Bills XLSX] loaded ${suppliers.length} suppliers`);

  // Group by (supplierName + reference) — that pair identifies a unique bill.
  type Bucket = { rows: DataRow[]; supplierName: string; reference: string };
  const buckets = new Map<string, Bucket>();
  let creditNoteRows = 0;
  for (const r of data) {
    // Only payable invoices for stage 3 — credit notes get their own stage.
    if (r.source === "Payable Credit Note") { creditNoteRows++; continue; }
    if (!r.reference) continue;
    const key = `${r.supplierName.toLowerCase()}||${r.reference}`;
    if (!buckets.has(key)) buckets.set(key, { rows: [], supplierName: r.supplierName, reference: r.reference });
    buckets.get(key)!.rows.push(r);
  }
  console.log(`[AP Bills XLSX] grouped into ${buckets.size} unique bills (skipped ${creditNoteRows} credit-note lines)`);

  // Track which suppliers are missing for diagnostic output
  const missingSuppliers = new Set<string>();

  let created = 0, updated = 0, failed = 0, skippedNoSupplier = 0;
  let i = 0;
  const total = buckets.size;
  const startedAt = Date.now();

  for (const [, bucket] of buckets) {
    i++;
    const supplier = supplierByName.get(bucket.supplierName.toLowerCase());
    if (!supplier) {
      missingSuppliers.add(bucket.supplierName);
      skippedNoSupplier++;
      continue;
    }
    // First row carries header-ish fields. Pick the earliest date as bill date.
    const first = bucket.rows[0];
    const dates = bucket.rows.map((r) => parseDate(r.date)).filter((d): d is Date => !!d);
    const billDate = dates.sort((a, b) => a.getTime() - b.getTime())[0] || new Date();
    const status = first.status; // Xero gives the same status across all lines of a bill
    const invoiceTotal = first.invoiceTotal;

    const subtotal = bucket.rows.reduce((s, r) => s + r.gross, 0);
    const taxTotal = bucket.rows.reduce((s, r) => s + r.tax, 0);

    const items = bucket.rows.map((r, idx) => ({
      lineNumber: idx + 1,
      description: r.description,
      quantity: r.quantity,
      unitPrice: r.unitPrice,
      amount: r.gross,
      taxAmount: r.tax,
      itemCode: r.itemCode || null,
    }));

    const isPaid = status === "Paid";
    const balance = isPaid ? 0 : invoiceTotal; // XLSX doesn't give per-bill outstanding, infer from status

    const config = {
      date: billDate.toISOString(),
      items,
      supplier: { id: supplier.id, name: supplier.name },
      supplierId: supplier.id,
      xeroImported: true,
      xeroBillNumber: bucket.reference,
      xeroStatus: status,
      xeroSubtotal: subtotal,
      xeroTax: taxTotal,
      xeroGross: invoiceTotal,
      xeroBalance: balance,
      xeroAmountPaid: isPaid ? invoiceTotal : 0,
      isPaid,
      documentInfo: {
        currency: "SGD",
        gstPercent: subtotal && taxTotal ? Math.round((taxTotal / subtotal) * 100) : 9,
      },
      xeroLastSyncAt: new Date().toISOString(),
      xeroSourceFile: "Payable Invoice Detail XLSX",
    };

    try {
      const existing = await prisma.document.findFirst({
        where: {
          organizationId: BIOFUEL_ORG_ID,
          type: "BILL",
          OR: [
            { config: { path: ["xeroBillNumber"], equals: bucket.reference } },
            { name: bucket.reference },
          ],
        },
        select: { id: true },
      });

      if (existing) {
        await prisma.document.update({
          where: { id: existing.id },
          data: {
            name: bucket.reference,
            type: "BILL",
            status: mapStatus(status),
            config: config as Prisma.InputJsonValue,
          },
        });
        updated++;
      } else {
        await prisma.document.create({
          data: {
            organizationId: BIOFUEL_ORG_ID,
            documentTemplateId: BILL_TEMPLATE_ID,
            name: bucket.reference,
            type: "BILL",
            status: mapStatus(status),
            config: config as Prisma.InputJsonValue,
          },
        });
        created++;
      }
    } catch (e: any) {
      failed++;
      if (failed <= 5) console.warn(`  ⚠️  ${bucket.supplierName} / ${bucket.reference}: ${e.message?.slice(0, 180)}`);
    }

    if (i % 250 === 0 || i === total) {
      const secs = Math.round((Date.now() - startedAt) / 1000);
      console.log(`  [${((i / total) * 100).toFixed(1)}%] ${i}/${total} · created=${created} updated=${updated} failed=${failed} · ${secs}s`);
    }
  }

  console.log("\n[AP Bills XLSX] ✓ done");
  console.log(`  Bills: created=${created} updated=${updated} failed=${failed} skipped-no-supplier=${skippedNoSupplier}`);
  if (missingSuppliers.size) {
    console.log(`\n  Suppliers in XLSX but missing from DB (${missingSuppliers.size}):`);
    [...missingSuppliers].slice(0, 10).forEach((n) => console.log(`    - ${n}`));
    if (missingSuppliers.size > 10) console.log(`    ... and ${missingSuppliers.size - 10} more`);
  }

  // Summary
  const billCount = await prisma.document.count({ where: { organizationId: BIOFUEL_ORG_ID, type: "BILL" } });
  console.log(`\n  Final BILL count in DB: ${billCount}`);
}

main()
  .catch((e) => { console.error(e); process.exit(1); })
  .finally(() => prisma.$disconnect());
