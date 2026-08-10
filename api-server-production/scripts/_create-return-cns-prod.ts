// Move the return-DO corrections from dev to PROD (guru approved 2026-08-11):
// CN against BI202607035, Obayashi July-period invoice, and the 3 annotated
// recurring templates. Numbers are re-minted with PROD counters, so the
// template annotations are rewritten to the prod numbers. Adds the missing
// RecurringInvoiceTemplate.nextRunNo column (additive) first.
import * as dotenv from 'dotenv';
import * as path from 'path';
import * as fs from 'fs';
import { PrismaClient } from '@prisma/client';

const devEnv = dotenv.parse(fs.readFileSync(path.resolve(__dirname, '..', '.env')));
const prodEnv = dotenv.parse(fs.readFileSync(path.resolve(__dirname, '..', '.env.production')));
const dev = new PrismaClient({ datasources: { db: { url: devEnv.DATABASE_URL } } });
const prod = new PrismaClient({ datasources: { db: { url: prodEnv.DATABASE_URL } } });

const ORG = '52e90ba8-bfbd-48b0-bb76-4f9667bf74f1'; // Biofuel (same id all envs)
const DEV_CN = 'CN202608-0002';
const DEV_INV = 'BI2026080121';
const DEV_TPL_IDS = [
  '2be6b66d-5305-411f-8665-b45834d38eec', // BI202607035 — TO DELETE
  'ecdc8c71-780d-42de-8f69-cdb9d9e94652', // BI202607037 — CN PENDING
  '83a0e6c0-bee4-4599-af26-e2fd98863c53', // BI202607012 — 4→3 tanks
];

const DOC_CODE: Record<string, string> = { INVOICE: 'INV', CREDIT_NOTE: 'CN' };

function fmtPattern(pattern: string, serial: number, date: Date, docCode = ''): string {
  const YYYY = String(date.getFullYear());
  const YY = YYYY.slice(2);
  const MM = String(date.getMonth() + 1).padStart(2, '0');
  const DD = String(date.getDate()).padStart(2, '0');
  return (pattern || '').replace(/\{([^}]+)\}/g, (_m, tok: string) => {
    if (/^#+$/.test(tok)) return String(serial).padStart(tok.length, '0');
    if (tok === 'DOC') return docCode;
    return tok.replace(/YYYY/g, YYYY).replace(/YY/g, YY).replace(/MM/g, MM).replace(/DD/g, DD);
  });
}

async function mintNumber(formatId: string, when: Date): Promise<string> {
  const format = await prod.documentNumberFormat.findUniqueOrThrow({ where: { id: formatId } });
  const docCode = DOC_CODE[format.documentType] || '';
  const serialToken = /\{(#+)\}/.exec(format.pattern);
  if (!serialToken) throw new Error('pattern has no serial token');
  const prefix = fmtPattern(format.pattern.slice(0, serialToken.index), 0, when, docCode);
  const suffix = fmtPattern(format.pattern.slice(serialToken.index + serialToken[0].length), 0, when, docCode);
  const existing = await prod.document.findMany({
    where: { organizationId: ORG, name: { startsWith: prefix } },
    select: { name: true },
  });
  let maxExisting = 0;
  for (const d of existing) {
    const name = d.name || '';
    if (suffix && !name.endsWith(suffix)) continue;
    const mid = name.slice(prefix.length, suffix ? name.length - suffix.length : undefined);
    if (/^\d+$/.test(mid)) maxExisting = Math.max(maxExisting, parseInt(mid, 10));
  }
  const claimed = await prod.$transaction(async (tx) => {
    const f = await tx.documentNumberFormat.findUniqueOrThrow({ where: { id: format.id } });
    const serial = Math.max(f.nextSerial, maxExisting + 1);
    await tx.documentNumberFormat.update({ where: { id: f.id }, data: { nextSerial: serial + 1 } });
    return serial;
  });
  return fmtPattern(format.pattern, claimed, when, docCode);
}

async function main() {
  const when = new Date();

  // 0. Additive column so nextRunNo (NTH counter) survives the move.
  await prod.$executeRawUnsafe(
    'ALTER TABLE "RecurringInvoiceTemplate" ADD COLUMN IF NOT EXISTS "nextRunNo" INTEGER NOT NULL DEFAULT 1',
  );
  console.log('nextRunNo column ensured on prod');

  // Prod format ids (labels verified by probe)
  const cnFmt = await prod.documentNumberFormat.findFirstOrThrow({
    where: { organizationId: ORG, documentType: 'CREDIT_NOTE', label: 'Default' },
  });
  const invFmt = await prod.documentNumberFormat.findFirstOrThrow({
    where: { organizationId: ORG, documentType: 'INVOICE', label: 'Rental/Sales' },
  });

  // 1. Copy the two documents with prod-minted numbers.
  const subst: Record<string, string> = {};
  for (const [devName, fmtId, type] of [
    [DEV_CN, cnFmt.id, 'CREDIT_NOTE'],
    [DEV_INV, invFmt.id, 'INVOICE'],
  ] as const) {
    const src = await dev.document.findFirstOrThrow({ where: { organizationId: ORG, name: devName } });
    const cfg: any = src.config;
    const dup = await prod.document.findFirst({
      where: { organizationId: ORG, type, config: { path: ['reference'], equals: cfg.reference } },
      select: { name: true },
    });
    if (dup) {
      console.log(`SKIP ${devName} — prod already has ${dup.name} with the same reference`);
      subst[devName] = dup.name!;
      continue;
    }
    const prodNo = await mintNumber(fmtId, when);
    subst[devName] = prodNo;
    const config = {
      ...cfg,
      documentNumber: prodNo,
      documentInfo: { ...(cfg.documentInfo || {}), documentNumber: prodNo },
    };
    const created = await prod.document.create({
      data: {
        organizationId: ORG,
        type,
        name: prodNo,
        status: 'unconfirmed',
        documentTemplateId: src.documentTemplateId,
        config,
      },
    });
    console.log(`Created ${type} ${prodNo} (${created.id}) in prod — net ${config.subTotal}, gross ${config.nettTotal}`);
  }

  // 2. Mirror the 3 annotated recurring templates (dev numbers → prod numbers).
  const swap = (s: string | null | undefined) =>
    (s || '').split(DEV_CN).join(subst[DEV_CN]).split(DEV_INV).join(subst[DEV_INV]);
  for (const id of DEV_TPL_IDS) {
    const t = await dev.recurringInvoiceTemplate.findUniqueOrThrow({ where: { id } });
    const srcDoc = await dev.document.findUniqueOrThrow({ where: { id: t.sourceDocumentId! }, select: { name: true } });
    const prodSrc = await prod.document.findFirstOrThrow({
      where: { organizationId: ORG, name: srcDoc.name!, type: 'INVOICE' },
      select: { id: true },
    });
    const exists = await prod.recurringInvoiceTemplate.findFirst({ where: { organizationId: ORG, sourceDocumentId: prodSrc.id } });
    if (exists) {
      console.log(`SKIP template for ${srcDoc.name} — already in prod (${exists.id})`);
      continue;
    }
    const cfg: any = t.config || {};
    const created = await prod.recurringInvoiceTemplate.create({
      data: {
        organizationId: ORG,
        name: swap(t.name),
        customerId: t.customerId,
        documentTemplateId: t.documentTemplateId,
        numberFormatId: invFmt.id,
        config: { ...cfg, reference: swap(cfg.reference) },
        frequency: t.frequency,
        nextRunDate: t.nextRunDate,
        endDate: t.endDate,
        autoSend: false,
        isActive: false,
        nextRunNo: t.nextRunNo,
        sourceDocumentId: prodSrc.id,
        createdBy: 'july-rentals-import',
      },
    });
    console.log(`Created prod template for ${srcDoc.name}: ${created.id} — "${created.name}" (nextRunNo ${created.nextRunNo}, next ${created.nextRunDate?.toISOString().slice(0, 10)})`);
  }
}

main()
  .catch((e) => { console.error(e); process.exit(1); })
  .finally(() => Promise.all([dev.$disconnect(), prod.$disconnect()]));
