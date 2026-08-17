// Stamp the revenue account codes from the JULY source invoices onto the
// generated August invoices' items AND the recurring templates' items (guru
// 2026-08-11: "make sure the accounting codes is all correct … refer to the
// july invoices and their codes … before we put to xero").
//  • Code source: the July invoice's priced line(s). If a source has more
//    than one distinct code on priced lines, it is FLAGGED, not guessed.
//  • Verifies every code exists in the org's ChartOfAccount.
//  • Prod: documents + templates. Dev: templates only (parity).
// Dry-run by default; --apply to write.
import * as path from 'path';
import * as fs from 'fs';
import { PrismaClient } from '@prisma/client';

const APPLY = process.argv.includes('--apply');
const ORG = '52e90ba8-bfbd-48b0-bb76-4f9667bf74f1';

async function run(envFile: string, doDocs: boolean) {
  const url = fs.readFileSync(path.resolve(__dirname, '..', envFile), 'utf8').match(/^DATABASE_URL="?([^"\n]+)"?/m)![1];
  const p = new PrismaClient({ datasources: { db: { url } } });
  console.log(`\n########## ${envFile} ##########`);
  try {
    const coa = new Set(
      (await p.chartOfAccount.findMany({ where: { organizationId: ORG }, select: { code: true } })).map((a) => a.code),
    );
    const tpls = await p.recurringInvoiceTemplate.findMany({
      where: { organizationId: ORG },
      select: { id: true, name: true, config: true, sourceDocumentId: true, lastRunDocumentId: true },
    });
    const byCode: Record<string, number> = {};
    const flagged: string[] = [];
    for (const t of tpls) {
      if (!t.sourceDocumentId) { flagged.push(`${t.name.slice(0, 50)} — no source doc`); continue; }
      const src = await p.document.findUnique({ where: { id: t.sourceDocumentId }, select: { name: true, config: true } });
      const priced = (((src?.config as any)?.items || []) as any[]).filter((i) => Number(i.unitPrice) > 0);
      const codes = [...new Set(priced.map((i) => i.accountCode).filter(Boolean).map(String))];
      if (codes.length !== 1) { flagged.push(`${t.name.slice(0, 50)} — source ${src?.name} has ${codes.length} distinct codes [${codes.join(',')}]`); continue; }
      const code = codes[0];
      if (!coa.has(code)) { flagged.push(`${t.name.slice(0, 50)} — code ${code} NOT IN ChartOfAccount`); continue; }
      byCode[code] = (byCode[code] || 0) + 1;

      if (APPLY) {
        // template items: stamp priced lines (all lines are candidates — the
        // imported templates hold one priced item each)
        const c: any = t.config || {};
        const items = (c.items || []).map((i: any) => (Number(i.unitPrice) > 0 ? { ...i, accountCode: code } : i));
        await p.recurringInvoiceTemplate.update({ where: { id: t.id }, data: { config: { ...c, items } } });
        // generated August invoice (prod only)
        if (doDocs && t.lastRunDocumentId) {
          const doc = await p.document.findUnique({ where: { id: t.lastRunDocumentId }, select: { id: true, config: true } });
          if (doc) {
            const dc: any = doc.config;
            const dItems = (dc.items || []).map((i: any) => (Number(i.unitPrice) > 0 ? { ...i, accountCode: code } : i));
            await p.document.update({ where: { id: doc.id }, data: { config: { ...dc, items: dItems } as any } });
          }
        }
      }
    }
    console.log('assignments by code:', JSON.stringify(byCode));
    console.log('flagged:', flagged.length);
    for (const f of flagged) console.log('  ⚠', f);
  } finally {
    await p.$disconnect();
  }
}

(async () => {
  await run('.env.production', true);
  await run('.env', false);
  console.log(APPLY ? '\nAPPLIED' : '\nDRY RUN — pass --apply');
})().catch((e) => { console.error(e); process.exit(1); });
