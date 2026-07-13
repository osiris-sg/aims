import { PrismaClient } from '@prisma/client';
const p = new PrismaClient();
const ORG = '52e90ba8-bfbd-48b0-bb76-4f9667bf74f1';
const MAPPED = new Set(['TAX001','OUTPUTY24','OUTPUTY23','OUTPUT','TAX002','INPUTY24','INPUTY23','INPUT','ZERORATEDOUTPUT','ZERORATEDINPUT','EXEMPTOUTPUT','EXEMPTINPUT']);
async function main() {
  const docs = await p.document.findMany({
    where: { organizationId: ORG, type: { in: ['INVOICE', 'BILL', 'CREDIT_NOTE', 'DEBIT_NOTE'] } },
    select: { id: true, type: true, config: true, createdAt: true },
  });
  const reasons = new Map<string, number>();
  const samples = new Map<string, string[]>();
  let totalGross = 0;
  for (const d of docs) {
    const cfg: any = d.config || {};
    const items: any[] = cfg.items || [];
    if (items.some((it) => it.taxType && MAPPED.has(it.taxType))) continue; // will be stamped
    // classify why untouched
    const types = [...new Set(items.map((it) => it.taxType ?? '(null)'))];
    let reason: string;
    if (!items.length) reason = 'no line items at all';
    else if (types.every((t) => t === '(null)')) reason = cfg.source === 'ingestion' || cfg.ingestBatchId ? 'ingested batch (null taxType)' : 'null taxType lines';
    else reason = `only unmapped types: ${types.filter((t) => t !== '(null)').join(',')}`;
    reasons.set(reason, (reasons.get(reason) || 0) + 1);
    const label = `${d.type} ${cfg.documentInfo?.invoiceNumber ?? cfg.invoiceNumber ?? cfg.documentNumber ?? d.id.slice(0, 8)} (${cfg.customer?.name ?? cfg.customerName ?? cfg.supplier?.name ?? cfg.supplierName ?? '?'}) $${cfg.xeroGross ?? cfg.nettTotal ?? '?'}`;
    const s = samples.get(reason) || [];
    if (s.length < 4) { s.push(label); samples.set(reason, s); }
    totalGross += Number(cfg.xeroGross) || 0;
  }
  for (const [r, n] of [...reasons.entries()].sort((a, b) => b[1] - a[1])) {
    console.log(`\n${n} docs — ${r}`);
    for (const s of samples.get(r) || []) console.log(`   e.g. ${s}`);
  }
  console.log(`\ntotal gross of untouched: ${totalGross.toFixed(2)}`);
}
main().catch((e) => console.error(e.message)).finally(() => p.$disconnect());
