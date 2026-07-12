// Import the ops "Pass application tracker.xlsx" (JP PASS TRACKER sheet) into
// PassTrackerEntry for one org. Re-runnable: upserts by (org, invoiceNumber).
//
// Usage:
//   npx tsx scripts/import-jp-pass-tracker.ts "<path to .xlsx>" <organizationId>
//
// Email ingestion uses these rows to code incoming Jurong Port bills:
// company ~ BIOFUEL → 442 (own expense), anything else → 105 (contra).
import { PrismaClient } from '@prisma/client';
import * as XLSX from 'xlsx';

const prisma = new PrismaClient();

async function main() {
  const [xlsxPath, organizationId] = process.argv.slice(2);
  if (!xlsxPath || !organizationId) {
    console.error('Usage: npx tsx scripts/import-jp-pass-tracker.ts "<path to .xlsx>" <organizationId>');
    process.exit(1);
  }

  const org = await prisma.organization.findUnique({ where: { id: organizationId }, select: { id: true, name: true } });
  if (!org) throw new Error(`Organization ${organizationId} not found`);

  const wb = XLSX.readFile(xlsxPath);
  const sheetName = wb.SheetNames.find((n) => /pass tracker/i.test(n)) || wb.SheetNames[0];
  const rows: any[][] = XLSX.utils.sheet_to_json(wb.Sheets[sheetName], { header: 1 });
  if (rows.length < 2) throw new Error(`Sheet "${sheetName}" has no data rows`);

  // Column indexes by header name (headers have inconsistent trailing spaces).
  const headers = (rows[0] as any[]).map((h) => String(h ?? '').trim().toUpperCase());
  const col = (name: string) => headers.findIndex((h) => h === name);
  const iInvoice = col('INVOICE NUMBER');
  const iCompany = col('COMPANY WHO APPLIED');
  const iWpCompany = col('WP COMPANY');
  const iName = col('NAME');
  const iAmount = col('INVOICE AMOUNT');
  if (iInvoice < 0) throw new Error(`Sheet "${sheetName}": no "INVOICE NUMBER" column (headers: ${headers.join(', ')})`);

  let imported = 0;
  let skipped = 0;
  for (const row of rows.slice(1)) {
    const invoiceNumber = String(row[iInvoice] ?? '').trim().toUpperCase();
    if (!invoiceNumber) {
      skipped++;
      continue;
    }
    const amountRaw = iAmount >= 0 ? Number(row[iAmount]) : NaN;
    await prisma.passTrackerEntry.upsert({
      where: { organizationId_invoiceNumber: { organizationId, invoiceNumber } },
      update: {
        company: iCompany >= 0 ? String(row[iCompany] ?? '').trim() || null : null,
        wpCompany: iWpCompany >= 0 ? String(row[iWpCompany] ?? '').trim() || null : null,
        personName: iName >= 0 ? String(row[iName] ?? '').trim() || null : null,
        amount: Number.isFinite(amountRaw) ? amountRaw : null,
        raw: row as any,
      },
      create: {
        organizationId,
        invoiceNumber,
        company: iCompany >= 0 ? String(row[iCompany] ?? '').trim() || null : null,
        wpCompany: iWpCompany >= 0 ? String(row[iWpCompany] ?? '').trim() || null : null,
        personName: iName >= 0 ? String(row[iName] ?? '').trim() || null : null,
        amount: Number.isFinite(amountRaw) ? amountRaw : null,
        raw: row as any,
      },
    });
    imported++;
  }

  console.log(`Org "${org.name}": sheet "${sheetName}" — upserted ${imported} entries, skipped ${skipped} rows without invoice number.`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
