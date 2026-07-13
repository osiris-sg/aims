// Backfill documentInfo.taxCode (+ gstPercent) on imported docs from the
// per-line Xero taxType the migration captured. Doc-level code = dominant
// mapped line type by |amount|. Docs with only NONE/out-of-scope/null lines
// are left untouched (report shows them as "No GST").
// Usage: npx ts-node scripts/backfill-tax-codes.ts [--apply]
import { PrismaClient } from '@prisma/client';
const p = new PrismaClient();
const ORG = '52e90ba8-bfbd-48b0-bb76-4f9667bf74f1';
const APPLY = process.argv.includes('--apply');

// Era-specific codes: 1/4 = current 9%, 8/9 = 2023's 8%, 10/11 = pre-2023 7%.
const MAP: Record<string, { code: string; rate: number }> = {
  TAX001: { code: '1', rate: 9 },
  OUTPUTY24: { code: '1', rate: 9 },
  OUTPUTY23: { code: '8', rate: 8 },
  OUTPUT: { code: '10', rate: 7 },
  TAX002: { code: '4', rate: 9 },
  INPUTY24: { code: '4', rate: 9 },
  INPUTY23: { code: '9', rate: 8 },
  INPUT: { code: '11', rate: 7 },
  ZERORATEDOUTPUT: { code: '2', rate: 0 },
  ZERORATEDINPUT: { code: '5', rate: 0 },
  EXEMPTOUTPUT: { code: '3', rate: 0 },
  EXEMPTINPUT: { code: '6', rate: 0 },
};

// Outside-the-return types → 12 (purchases) / 13 (supplies). Only used when a
// doc has NO in-scope lines; NONE follows the document's direction.
const scopeCode = (taxType: string, isSales: boolean): { code: string; rate: number } | null => {
  if (taxType === 'OPINPUT') return { code: '12', rate: 0 };
  if (taxType === 'OSOUTPUT') return { code: '13', rate: 0 };
  if (taxType === 'NONE') return { code: isSales ? '13' : '12', rate: 0 };
  return null;
};

async function main() {
  const docs = await p.document.findMany({
    where: { organizationId: ORG, type: { in: ['INVOICE', 'BILL', 'CREDIT_NOTE', 'DEBIT_NOTE'] } },
    select: { id: true, type: true, config: true },
  });
  let stamped = 0, restamped = 0, alreadyCorrect = 0, skippedNoMap = 0;
  const byCode = new Map<string, number>();
  for (const d of docs) {
    const cfg: any = d.config || {};
    const isSales = d.type === 'INVOICE' || (d.type === 'CREDIT_NOTE' && !!(cfg.customer || cfg.customerId));
    const weights = new Map<string, number>();
    const scopeWeights = new Map<string, number>();
    for (const it of cfg.items || []) {
      const amt = Math.abs(Number(it.amount) || 0);
      const m = it.taxType ? MAP[it.taxType] : null;
      if (m) { const k = `${m.code}:${m.rate}`; weights.set(k, (weights.get(k) || 0) + amt); continue; }
      const s = it.taxType ? scopeCode(it.taxType, isSales) : null;
      if (s) { const k = `${s.code}:${s.rate}`; scopeWeights.set(k, (scopeWeights.get(k) || 0) + amt); }
    }
    // In-scope lines decide the doc code; out-of-scope (12/13) only when the
    // doc has nothing in scope. Docs with neither (null taxType — manual or
    // ingested) are left alone.
    const pool = weights.size ? weights : scopeWeights;
    if (!pool.size) { skippedNoMap++; continue; }
    const [winner] = [...pool.entries()].sort((a, b) => b[1] - a[1])[0];
    const [code, rate] = winner.split(':');
    const existing = cfg?.documentInfo?.taxCode;
    if (existing === code) { alreadyCorrect++; continue; }
    byCode.set(winner, (byCode.get(winner) || 0) + 1);
    if (APPLY) {
      await p.document.update({
        where: { id: d.id },
        data: { config: { ...cfg, documentInfo: { ...(cfg.documentInfo || {}), taxCode: code, gstPercent: Number(rate) } } },
      });
    }
    if (existing) restamped++; else stamped++;
  }
  console.log(`${APPLY ? 'APPLIED' : 'DRY RUN'}: stamp=${stamped} restamp-old-mapping=${restamped} already-correct=${alreadyCorrect} no-mappable-lines=${skippedNoMap} of ${docs.length} docs`);
  console.log([...byCode.entries()].sort((a, b) => b[1] - a[1]).map(([k, v]) => `  code:rate ${k} -> ${v} docs`).join('\n'));
}
main().catch((e) => { console.error(e); process.exit(1); }).finally(() => p.$disconnect());
