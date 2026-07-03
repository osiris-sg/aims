/**
 * Import Biofuel invoices from the Xero "Receivable Invoice Detail" export
 * (grouped by customer). Adds missing invoices (with customer), refreshes
 * payment status on existing ones (merge — preserves any connected logic).
 *
 * Run: npx ts-node scripts/import-invoices-detail-xlsx.ts
 */
import * as XLSX from 'xlsx';
import { PrismaClient, Prisma } from '@prisma/client';

const prisma = new PrismaClient();
const ORG = '52e90ba8-bfbd-48b0-bb76-4f9667bf74f1';
const INVOICE_TEMPLATE_ID = 'cc6d0035-993f-403f-8dd6-582ce8b10b0b';
const FILE = '/Users/guru/Downloads/Biofuel_Industries_Pte_Ltd_-_Receivable_Invoice_Detail (1).xlsx';

const num = (s: any) => parseFloat(String(s ?? '').replace(/,/g, '')) || 0;
const norm = (s: string) => (s || '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').replace(/\s+/g, ' ').trim();
const R = (n: number) => Math.round(n * 100) / 100;

function parseXlsx() {
  const wb = XLSX.readFile(FILE);
  const rows: any[][] = XLSX.utils.sheet_to_json(wb.Sheets[wb.SheetNames[0]], { header: 1, raw: false, defval: '' });
  const byNumber = new Map<string, any>();
  let customer = '';
  for (let i = 5; i < rows.length; i++) {
    const r = rows[i];
    const c0 = String(r[0] || '').trim();
    const src = String(r[2] || '').trim();
    if (src === 'Receivable Invoice') {
      const number = c0;
      if (!number) continue;
      let inv = byNumber.get(number);
      if (!inv) {
        inv = { number, customer, date: String(r[1] || '').trim(), reference: String(r[3] || '').trim(), status: String(r[12] || '').trim(), lines: [] };
        byNumber.set(number, inv);
      }
      inv.lines.push({
        description: String(r[5] || '').replace(/\r/g, '').trim(),
        quantity: num(r[6]), unitPrice: num(r[7]), discount: num(r[8]),
        taxAmount: num(r[9]), gross: num(r[10]),
      });
      if (!inv.status) inv.status = String(r[12] || '').trim();
    } else if (c0 && !c0.startsWith('Total')) {
      customer = c0; // customer group header
    }
  }
  return [...byNumber.values()];
}

// Xero status → AIMS document status
function mapStatus(x: string): string {
  switch (x) {
    case 'Paid': return 'paid';
    case 'Approved': case 'Authorised': return 'pending_payment';
    case 'Voided': case 'Deleted': return 'draft'; // no void/cancelled enum — flagged via config.xeroStatus/voided
    case 'Draft': case 'Submitted': return 'draft';
    default: return 'confirmed';
  }
}

function parseDate(s: string): string | null {
  const d = new Date(s);
  return isNaN(d.getTime()) ? null : d.toISOString();
}

async function main() {
  const invs = parseXlsx();
  console.log(`parsed ${invs.length} invoices from Excel`);

  // Customer lookup (normalized name → id), plus a cache for created ones.
  const customers = await prisma.customer.findMany({ where: { organizationId: ORG }, select: { id: true, name: true } });
  const custByNorm = new Map(customers.map((c) => [norm(c.name), c.id]));
  let custCreated = 0;
  async function resolveCustomer(name: string): Promise<{ id: string | null; name: string }> {
    const n = norm(name);
    if (!n) return { id: null, name: name || '(unknown)' };
    if (custByNorm.has(n)) return { id: custByNorm.get(n)!, name };
    const c = await prisma.customer.create({ data: { organizationId: ORG, name: name.trim() } });
    custByNorm.set(n, c.id);
    custCreated++;
    return { id: c.id, name };
  }

  // Existing invoices by name → { id, config }.
  const existing = await prisma.document.findMany({ where: { organizationId: ORG, type: 'INVOICE' }, select: { id: true, name: true, config: true } });
  const existingByName = new Map(existing.map((d) => [d.name, d]));

  let created = 0, updated = 0, failed = 0;
  const statusCount: Record<string, number> = {};

  for (const inv of invs) {
    try {
      const gross = R(inv.lines.reduce((s: number, l: any) => s + l.gross, 0));
      const tax = R(inv.lines.reduce((s: number, l: any) => s + l.taxAmount, 0));
      const net = R(gross - tax);
      const isVoid = inv.status === 'Voided' || inv.status === 'Deleted';
      const status = mapStatus(inv.status);
      const key = isVoid ? 'voided' : status;
      statusCount[key] = (statusCount[key] || 0) + 1;
      const paid = inv.status === 'Paid';
      const balance = isVoid || paid ? 0 : gross;
      const amountPaid = paid ? gross : 0;

      const ex = existingByName.get(inv.number);
      if (ex) {
        // Refresh payment status + payment fields; MERGE config (preserve connected logic).
        const prev = (ex.config as any) || {};
        const config = {
          ...prev,
          xeroStatus: inv.status,
          xeroBalance: balance,
          xeroAmountPaid: amountPaid,
          voided: isVoid,
          paymentStatus: status,
          paymentStatusSource: 'xero-invoice-detail',
          xeroLastSyncAt: new Date().toISOString(),
        };
        await prisma.document.update({ where: { id: ex.id }, data: { status: status as any, config: config as Prisma.InputJsonValue } });
        updated++;
      } else {
        const customer = await resolveCustomer(inv.customer);
        const items = inv.lines.map((l: any, idx: number) => ({
          lineNumber: idx + 1, description: l.description, quantity: l.quantity, unitPrice: l.unitPrice,
          amount: R(l.gross - l.taxAmount), taxAmount: l.taxAmount, discount: l.discount,
        }));
        const config = {
          date: parseDate(inv.date) || new Date().toISOString(),
          dueDate: null,
          items,
          customer: { id: customer.id, name: customer.name },
          customerId: customer.id,
          subtotal: net, taxAmount: tax, totalAmount: gross,
          xeroImported: true,
          xeroInvoiceNumber: inv.number,
          xeroReference: inv.reference || null,
          xeroStatus: inv.status,
          xeroGross: gross, xeroBalance: balance, xeroAmountPaid: amountPaid, voided: isVoid,
          paymentStatus: status, paymentStatusSource: 'xero-invoice-detail',
          documentInfo: { currency: 'SGD', gstPercent: net ? Math.round((tax / net) * 100) : 9 },
          source: 'xero-invoice-detail-xlsx',
          xeroLastSyncAt: new Date().toISOString(),
        };
        await prisma.document.create({
          data: { organizationId: ORG, documentTemplateId: INVOICE_TEMPLATE_ID, name: inv.number, type: 'INVOICE', status: status as any, config: config as Prisma.InputJsonValue },
        });
        created++;
      }
    } catch (e: any) {
      failed++;
      if (failed <= 10) console.log(`  fail "${inv.number}": ${e.message?.slice(0, 140)}`);
    }
  }

  console.log(`\ndone. created=${created} updated=${updated} customersCreated=${custCreated} failed=${failed}`);
  console.log('status breakdown:', statusCount);
  const total = await prisma.document.count({ where: { organizationId: ORG, type: 'INVOICE' } });
  console.log(`AIMS invoices now: ${total}`);

  // AR approximation from invoice status (Approved = full gross outstanding).
  const unpaid = await prisma.document.findMany({ where: { organizationId: ORG, type: 'INVOICE', status: 'pending_payment' }, select: { config: true } });
  let ar = 0;
  for (const d of unpaid) ar += Number((d.config as any)?.xeroBalance || 0);
  console.log(`\nAIMS AR (sum of unpaid-invoice gross): ${R(ar).toFixed(2)}   (Xero AR 610 = 10,988,868 — expect a gap: partial payments + credit notes not in this export)`);
}
main().catch((e) => console.log('ERR', e.message)).finally(() => prisma.$disconnect());
