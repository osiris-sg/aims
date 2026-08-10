// Create recurring-invoice templates from the July 2026 rental invoices sheet
// (guru 2026-08-07). SAFETY: every template is created INACTIVE (draft) with
// autoSend=false — guru reviews + activates each; nothing fires by itself.
import * as dotenv from 'dotenv';
import * as path from 'path';
import * as fs from 'fs';
const PROD = process.argv.includes('--prod');
dotenv.config({ path: path.resolve(__dirname, '..', PROD ? '.env.production' : '.env'), override: true });
import { PrismaClient } from '@prisma/client';
const p = new PrismaClient({ datasources: { db: { url: process.env.DATABASE_URL } } });
const APPLY = process.argv.includes('--apply');
const ORG = '52e90ba8-bfbd-48b0-bb76-4f9667bf74f1';
const R2 = (n: number) => Math.round(n * 100) / 100;
const norm = (x: string) => x.toLowerCase().replace(/pte|ltd|private|limited|\(s\)|\./g, ' ').replace(/[^a-z0-9 ]/g, ' ').replace(/\s+/g, ' ').trim();

function tokenize(text: string, arrears: boolean): string {
  let t = text;
  t = t.replace(/01\/(\d{2})\/(\d{4})\s*(?:to|-|–)\s*(\d{2})\/(\d{2})\/(\d{4})/gi, (m, m1, y1, d2, m2, y2) => {
    const last = new Date(Number(y2), Number(m2), 0).getDate();
    if (m1 === m2 && y1 === y2 && Number(d2) === last) {
      return arrears ? '{PREV MONTH START} to {PREV MONTH END}' : '{MONTH START} to {MONTH END}';
    }
    return m;
  });
  t = t.replace(/(\d{1,3})(?:st|nd|rd|th)(\s+mth)/gi, '{NTH}$2');
  t = t.replace(/\bJuly\s+2026\b/gi, arrears ? '{MONTH YEAR}' : '{MONTH YEAR}');
  t = t.replace(/\bJune\s+2026\b/gi, '{PREV MONTH YEAR}');
  return t;
}

async function main() {
  const rows: any[] = JSON.parse(fs.readFileSync('/private/tmp/claude-501/-Users-guru-Documents-GitHub-aims/412415e1-ee3c-4c60-8a8b-ca1a1aaa9761/scratchpad/july-rentals.json', 'utf8'));
  // Format ids differ per env — resolve the Rental/Sales variant by label.
  const RENTAL_SALES_FMT = (await p.documentNumberFormat.findFirstOrThrow({
    where: { organizationId: ORG, documentType: 'INVOICE', label: 'Rental/Sales' },
  })).id;
  const customers = await p.customer.findMany({ where: { organizationId: ORG }, select: { id: true, name: true } });
  // Names get annotated after import ("Recurring — BI202607035 [TO DELETE …]"),
  // so dedupe by prefix, not exact name.
  const existingNames = (await p.recurringInvoiceTemplate.findMany({ where: { organizationId: ORG }, select: { name: true } })).map((t) => t.name);
  const fallbackTemplate = 'cc6d0035-993f-403f-8dd6-582ce8b10b0b';

  let created = 0;
  const skipped: string[] = [];
  const noCust: string[] = [];
  for (const r of rows) {
    const name = `Recurring — ${r.inv}`;
    if (existingNames.some((n) => n.startsWith(name))) { skipped.push(r.inv); continue; }
    const cn = norm(r.customer);
    const cust = customers.find((c) => norm(c.name) === cn) || customers.find((c) => norm(c.name).startsWith(cn) || cn.startsWith(norm(c.name)));
    if (!cust) { noCust.push(`${r.inv}: ${r.customer}`); continue; }

    const seed = await p.document.findFirst({ where: { organizationId: ORG, name: r.inv }, select: { id: true, documentTemplateId: true, projectId: true, projectDeploymentId: true } });
    const arrears = /arrears/i.test(r.group);
    const nth = (r.ref + ' ' + r.desc + ' ' + r.contract).match(/(\d{1,3})(?:st|nd|rd|th)\s+mth/i);
    const julyN = nth ? parseInt(nth[1], 10) : null;
    const augDone = /Invoiced in August/i.test(r.augStatus);
    const nextRunNo = julyN != null ? julyN + (augDone ? 2 : 1) : 1;
    const nextRunDate = augDone ? new Date('2026-09-01T09:00:00+08:00') : new Date();

    let ref = String(r.ref || '').replace(new RegExp(`^${r.inv}\\s*`), '').replace(/\s*Supersede.*$/i, '').trim();
    ref = tokenize(ref, arrears);
    const desc = tokenize(String(r.desc || '').replace(/^This Tax Invoice supersede[^\n]*\n?/i, '').trim(), arrears);
    const net = R2(r.amount / 1.09);

    console.log(`${APPLY ? '+' : '·'} ${r.inv} → ${cust.name.slice(0, 30)} | net ${net} | nth ${julyN ?? '-'}→${nextRunNo} | ${augDone ? 'SEP start' : 'now start'}${seed ? '' : ' | NO SEED DOC'}`);
    if (APPLY) {
      await p.recurringInvoiceTemplate.create({
        data: {
          organizationId: ORG,
          name,
          customerId: cust.id,
          documentTemplateId: seed?.documentTemplateId || fallbackTemplate,
          numberFormatId: RENTAL_SALES_FMT,
          config: {
            ...(ref ? { reference: ref } : {}),
            items: [{ itemCode: '', description: desc, quantity: 1, unitPrice: net, amount: net }],
            notes: '',
          },
          frequency: 'MONTHLY',
          nextRunDate,
          autoSend: false,
          isActive: false, // DRAFT — review + activate manually
          nextRunNo,
          projectId: seed?.projectId || null,
          projectDeploymentId: seed?.projectDeploymentId || null,
          sourceDocumentId: seed?.id || null,
          createdBy: 'july-rentals-import',
        },
      });
    }
    created++;
  }
  console.log(`\n${APPLY ? 'created' : 'would create'}=${created} skipped-existing=${skipped.length} no-customer=${noCust.length}`);
  for (const x of noCust) console.log('  ✗', x);
}
main().catch((e) => { console.error(e); process.exit(1); }).finally(() => p.$disconnect());
