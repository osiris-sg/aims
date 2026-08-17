// Split the 4 Capital Cranes dual-code rentals (July bills revenue across
// 214 equipment + 213 DB box, each net of 8% discount) so the generated
// August invoices + templates carry the same per-code amounts (guru
// 2026-08-11, follow-up to _stamp-account-codes.ts which flagged them).
// Item 1 keeps the full narrative description with the 214 net; a second
// priced line carries the DB-box net on 213 (desc lifted from July).
// Prod: template + generated doc. Dev: template only. --apply to write.
import * as path from 'path';
import * as fs from 'fs';
import { PrismaClient } from '@prisma/client';

const APPLY = process.argv.includes('--apply');
const ORG = '52e90ba8-bfbd-48b0-bb76-4f9667bf74f1';
const SOURCES = ['BI202607025', 'BI202607026', 'BI202607027', 'BI202607029'];
const R2 = (n: number) => Math.round(n * 100) / 100;

async function run(envFile: string, doDocs: boolean) {
  const url = fs.readFileSync(path.resolve(__dirname, '..', envFile), 'utf8').match(/^DATABASE_URL="?([^"\n]+)"?/m)![1];
  const p = new PrismaClient({ datasources: { db: { url } } });
  console.log(`\n########## ${envFile} ##########`);
  try {
    for (const srcName of SOURCES) {
      const src = await p.document.findFirst({ where: { organizationId: ORG, name: srcName, type: 'INVOICE' }, select: { id: true, config: true } });
      if (!src) { console.log(`${srcName}: source not found`); continue; }
      const sc: any = src.config;
      // net per account code across ALL lines (discount lines are negative)
      const byCode = new Map<string, number>();
      let boxDesc = '';
      for (const it of sc.items || []) {
        const amt = Number(it.amount) || 0;
        if (!amt || !it.accountCode) continue;
        byCode.set(String(it.accountCode), R2((byCode.get(String(it.accountCode)) || 0) + amt));
        if (String(it.accountCode) === '213' && amt > 0) boxDesc = (it.description || '').trim();
      }
      const net214 = byCode.get('214') || 0;
      const net213 = byCode.get('213') || 0;
      const tpl = await p.recurringInvoiceTemplate.findFirst({ where: { organizationId: ORG, sourceDocumentId: src.id } });
      if (!tpl) { console.log(`${srcName}: no template`); continue; }
      const tc: any = tpl.config || {};
      const main = (tc.items || []).find((i: any) => Number(i.unitPrice) > 0);
      const tplTotal = R2(Number(main?.unitPrice) || 0);
      if (R2(net214 + net213) !== tplTotal) {
        console.log(`${srcName}: ⚠ split ${net214}+${net213}=${R2(net214 + net213)} ≠ template ${tplTotal} — SKIPPED`);
        continue;
      }
      const box = {
        itemCode: '', quantity: 1, unitPrice: net213, amount: net213, accountCode: '213',
        description: `${boxDesc.replace(/^\d+\)\.?\s*/, '')} — net of 8% discount`,
      };
      console.log(`${srcName}: 214→${net214} | 213→${net213} ("${box.description.slice(0, 50)}")`);
      if (!APPLY) continue;
      // template: main line becomes the 214 net, add the 213 box line
      const tplItems = (tc.items || []).map((i: any) =>
        Number(i.unitPrice) > 0 ? { ...i, unitPrice: net214, amount: net214, accountCode: '214' } : i,
      );
      tplItems.push(box);
      await p.recurringInvoiceTemplate.update({ where: { id: tpl.id }, data: { config: { ...tc, items: tplItems } } });
      // generated August doc (prod only)
      if (doDocs && tpl.lastRunDocumentId) {
        const doc = await p.document.findUnique({ where: { id: tpl.lastRunDocumentId }, select: { id: true, name: true, config: true } });
        if (doc) {
          const dc: any = doc.config;
          const items = (dc.items || []).map((i: any) =>
            Number(i.unitPrice) > 0
              ? { ...i, unitPrice: net214, amount: net214, accountCode: '214', taxAmount: R2(net214 * 0.09), tax: 9 }
              : i,
          );
          items.push({ ...box, taxAmount: R2(net213 * 0.09), tax: 9, lineNumber: items.length + 1 });
          const subTotal = R2(items.reduce((s: number, i: any) => s + (Number(i.amount) || 0), 0));
          const gstAmount = R2(items.reduce((s: number, i: any) => s + (Number(i.taxAmount) || 0), 0));
          if (subTotal !== R2(Number(dc.subTotal))) { console.log(`  ⚠ ${doc.name}: subTotal drift ${subTotal} vs ${dc.subTotal} — doc NOT updated`); continue; }
          await p.document.update({
            where: { id: doc.id },
            data: { config: { ...dc, items, subTotal, gstAmount, nettTotal: R2(subTotal + gstAmount) } as any },
          });
          console.log(`  ${doc.name} updated (subTotal ${subTotal}, gst ${gstAmount})`);
        }
      }
    }
  } finally {
    await p.$disconnect();
  }
}

(async () => {
  await run('.env.production', true);
  await run('.env', false);
  console.log(APPLY ? '\nAPPLIED' : '\nDRY RUN — pass --apply');
})().catch((e) => { console.error(e); process.exit(1); });
