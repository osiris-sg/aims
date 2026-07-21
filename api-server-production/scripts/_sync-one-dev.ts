/** Server-side equivalent of the "Sync to Xero" button for one dev invoice:
 *  builds the same payload documents.service.syncToXero builds, POSTs it to
 *  Xero via the migration helpers, and stamps the linkage back. */
import { Prisma } from '@prisma/client';
import { createScriptPrisma, BIOFUEL_ORG_ID, getXeroTokens, XERO_API } from './xero-migration/_common';
const prisma = createScriptPrisma();
const NAME = process.argv[2];
const R = (n: number) => Math.round(n * 100) / 100;
async function main() {
  // pick: named invoice, or newest native one WITH a customer
  const doc = NAME
    ? await prisma.document.findFirst({ where: { organizationId: BIOFUEL_ORG_ID, type: 'INVOICE', name: NAME } })
    : (await prisma.$queryRawUnsafe<any[]>(
        `SELECT * FROM "Document" WHERE "organizationId" = $1 AND type = 'INVOICE'
         AND (config->>'xeroInvoiceId') IS NULL AND (config->>'xeroImported') IS DISTINCT FROM 'true'
         AND (config->'customer'->>'name' IS NOT NULL OR config->>'customerName' IS NOT NULL)
         ORDER BY "createdAt" DESC LIMIT 1`, BIOFUEL_ORG_ID))[0];
  if (!doc) { console.log('no suitable native invoice found'); return; }
  const c: any = doc.config || {};
  const items: any[] = Array.isArray(c.items) ? c.items : [];
  const contactName = c.customer?.name || c.customerName;
  console.log(`syncing: ${doc.name} customer="${contactName}" items=${items.length} nett=${c.nettTotal}`);
  if (!contactName || !items.length) { console.log('unsuitable (no contact/items)'); return; }

  const setting = await prisma.accountingSetting.findUnique({ where: { organizationId: BIOFUEL_ORG_ID }, select: { salesTaxInclusive: true } });
  const totalTax = Number(c.gstAmount ?? 0) || 0;
  const lineAmountTypes = totalTax === 0 ? 'NoTax' : (c.taxInclusive === 'Y' || setting?.salesTaxInclusive) ? 'Inclusive' : 'Exclusive';
  const mappings = await prisma.xeroAccountMapping.findMany({ where: { organizationId: BIOFUEL_ORG_ID } , select: { aimsAccountCode: true, xeroAccountCode: true }});
  const codeMap = new Map(mappings.filter(m => m.aimsAccountCode && m.xeroAccountCode).map(m => [m.aimsAccountCode as string, m.xeroAccountCode as string]));

  const tokens = await getXeroTokens(prisma, BIOFUEL_ORG_ID);
  // contact
  const q = encodeURIComponent(`Name="${contactName.replace(/"/g, '')}"`);
  const found = await fetch(`${XERO_API}/Contacts?where=${q}`, { headers: { Authorization: `Bearer ${tokens.accessToken}`, 'Xero-Tenant-Id': tokens.tenantId, Accept: 'application/json' } }).then(r => r.json());
  let contactID = found.Contacts?.[0]?.ContactID;
  if (!contactID) {
    const created = await fetch(`${XERO_API}/Contacts`, { method: 'POST', headers: { Authorization: `Bearer ${tokens.accessToken}`, 'Xero-Tenant-Id': tokens.tenantId, Accept: 'application/json', 'Content-Type': 'application/json' }, body: JSON.stringify({ Contacts: [{ Name: contactName }] }) }).then(r => r.json());
    contactID = created.Contacts?.[0]?.ContactID;
  }
  console.log('contact:', contactID);

  const payload = {
    Invoices: [{
      Type: 'ACCREC',
      Contact: { ContactID: contactID },
      Date: (c.date || new Date().toISOString()).split('T')[0],
      DueDate: c.dueDate ? String(c.dueDate).split('T')[0] : undefined,
      InvoiceNumber: doc.name,
      Reference: c.reference || c.poNo || undefined,
      Status: 'DRAFT',
      LineAmountTypes: lineAmountTypes,
      LineItems: items.map((it: any) => ({
        Description: it.description || '(no description)',
        Quantity: Number(it.quantity) || 1,
        UnitAmount: Number(it.unitPrice ?? it.amount) || 0,
        AccountCode: it.accountCode ? (codeMap.get(String(it.accountCode)) || String(it.accountCode)) : undefined,
        TaxAmount: it.taxAmount !== undefined && it.taxAmount !== null ? Number(it.taxAmount) : undefined,
      })),
    }],
  };
  const res = await fetch(`${XERO_API}/Invoices`, { method: 'POST', headers: { Authorization: `Bearer ${tokens.accessToken}`, 'Xero-Tenant-Id': tokens.tenantId, Accept: 'application/json', 'Content-Type': 'application/json' }, body: JSON.stringify(payload) });
  const body = await res.json();
  if (!res.ok || body.Invoices?.[0]?.HasErrors) {
    console.log('XERO REJECTED:', JSON.stringify(body.Elements?.[0]?.ValidationErrors || body, null, 1).slice(0, 800));
    return;
  }
  const inv = body.Invoices[0];
  console.log(`✓ CREATED in Xero: ${inv.InvoiceNumber} id=${inv.InvoiceID} status=${inv.Status} total=${inv.Total} tax=${inv.TotalTax} (lineAmountTypes=${lineAmountTypes})`);
  await prisma.document.update({ where: { id: doc.id }, data: { config: { ...c, xeroInvoiceId: inv.InvoiceID, xeroStatus: String(inv.Status), xeroSyncedAt: new Date().toISOString(), xeroSyncedBy: 'claude-dev-test' } as unknown as Prisma.InputJsonValue } });
  console.log('✓ linkage stamped in AIMS');
}
main().catch(e => { console.error('FATAL', e?.message || e); process.exit(1); }).finally(() => prisma.$disconnect());
