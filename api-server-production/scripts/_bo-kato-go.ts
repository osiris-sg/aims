/**
 * Round BO — Kato invoiced on step 2 + ADH's Nov invoices filed (DRY RUN by default; --apply needs the owner's go).
 *   1. Kato's profile: singleInvoiceStep = INVOICE_1 (step 2), customsFlatJpy = 93,000 (通関 課税対象外), the due rule
 *      "2 days after step 3b" moved from step 11 to step 2, and the 通関 備考 block as on ADH's 202611 invoices. Saved
 *      through TradeConfigService.updateSettings, so open orders' steps re-sync (orders already invoiced on step 11 keep
 *      step 2 off: "Invoiced on step 11").
 *   2. docDefaults.qmjpByQuarter["2026-4Q"] = 255 (Q4 MJP on the 202611 invoices) — only if missing.
 *   3. Doc type INVOICE_ADJUSTMENT (正誤差額・実費差分) + on steps 2 / 11 as optional (template and open steps).
 *   4. Files: 202611_01 (6063, Dec) → #28 step 2; 202611_02 (6005, Dec) → #27 step 2 (uploaded, INVOICE_SINGLE, with
 *      番号 / 発行日 / amount / 期限 in the notes, which the YYYYMM_NN series reads); the correction 202610_004 already
 *      in AIMS on #22 as OTHER → INVOICE_ADJUSTMENT + notes. Nothing else on the orders changes (#28's premium 285 vs
 *      260 billed and its empty net weight are only reported).
 * Logged (ActionLog, actor "System creation", script name). Re-runnable: a step already in place is reported, not redone.
 * Usage: DBURL=<prod url> TENANCY_MODE= npx ts-node -r tsconfig-paths/register --transpile-only scripts/_bo-kato-go.ts --pdfs=<dir> [--apply]
 */
import { PrismaClient } from '@prisma/client';
import { S3Client, PutObjectCommand } from '@aws-sdk/client-s3';
import { createHash, randomUUID } from 'crypto';
import * as fs from 'fs';
import * as path from 'path';
import { TradeConfigService } from '../src/shipments/trade-config.service';
import { sanitizeFileName } from '../src/shipments/shipments.rules';

const ADH = '056ed6da-42d3-438e-895b-84bb4df47a4c';
const KATO = 'a4ccfa28-9f64-468e-a943-e96ce8f8c3a0';
const APPLY = process.argv.includes('--apply');
const PDF_DIR = (process.argv.find((a) => a.startsWith('--pdfs=')) ?? '').slice(7);

/** The 通関、車輸送料 / 通関 備考 on ADH's 202611_01 / _02 (as printed). */
const KATO_REMARKS = [
  ' 商　品：アルミビレット',
  ' 荷　姿：バンドル',
  ' 保管倉庫：三井倉庫',
  ' 取扱港　：名古屋港',
  ' 保管条件：野積保管',
  ' 業務範囲：名古屋港到着後CY通関、ドレージ、 デバン入出庫、NO.取り作業(傷チェック)、保管(野積)、貴社指定場所（車上渡し)への配送まで',
  ' 作業備考：コンテナ単位での保管指定あり',
  '',
  '※保管料、船社立替実費追加',
  '※10tw車、時間指定なし',
].join('\n');

const FILES = [
  { match: /202612納入_6063/, orderNo: 28, no: '202611_01', issued: '2026-11-09', usd: '162,205.08', due: '2026-11-16' },
  { match: /202612納入_6005/, orderNo: 27, no: '202611_02', issued: '2026-11-09', usd: '165,661.77', due: '2026-11-16' },
];
const CORRECTION = { orderNo: 22, fileName: '(正誤差額)_請求書_加藤軽金属様_11月納入6063材40.271Tビレットプレミアム差.pdf', no: '202610_004', issued: '2026-10-08', usd: '1,107.44', note: '12月納入分請求書と合算 (202610_003 との差額: Billet Premium 235 → 260)' };
const notesOf = (f: { no: string; issued: string; usd: string; due?: string }, extra?: string) => `番号 ${f.no} · 発行日 ${f.issued} · US$${f.usd}${f.due ? ` · 支払期限 ${f.due}` : ''}${extra ? ` · ${extra}` : ''} (ADH's own invoice, filed round BO)`;

let writes = 0;
const plan = (s: string) => {
  writes++;
  console.log(`  ${APPLY ? '[apply]' : '[dry]'} ${s}`);
};

async function main() {
  const p = new PrismaClient({ datasources: { db: { url: process.env.DBURL } } });
  const config = new TradeConfigService(p as any);
  const log = (action: string, resource: string, resourceId: string, details: Record<string, unknown>) =>
    p.actionLog.create({ data: { actorType: 'SYSTEM', actorId: 'system:round-bo-kato-go', actorName: 'System creation', organizationId: ADH, channel: 'script', action, resource, resourceId, details: { script: 'scripts/_bo-kato-go.ts', go: 'owner, round BO', ...details } as any } });

  // ── 1. Kato's profile ──
  console.log('── 1. Kato profile ──');
  const ts: any = await p.tradeSetting.findUnique({ where: { organizationId: ADH }, select: { customerProfiles: true, docDefaults: true } });
  const cur = (ts.customerProfiles ?? {})[KATO];
  const rules = { ...(cur.dueRules ?? {}) };
  const moveRule = rules.INVOICE_2 && !rules.INVOICE_1;
  const next = {
    ...cur,
    singleInvoiceStep: 'INVOICE_1',
    customsFlatJpy: cur.customsFlatJpy ?? 93000,
    invoiceRemarks: KATO_REMARKS,
    dueRules: moveRule ? Object.fromEntries([...Object.entries(rules).filter(([k]) => k !== 'INVOICE_2'), ['INVOICE_1', rules.INVOICE_2]]) : rules,
  };
  const changed: string[] = [];
  if (cur.singleInvoiceStep !== 'INVOICE_1') changed.push(`invoice step: ${cur.singleInvoiceStep ?? 'step 11'} → step 2 (INVOICE_1)`);
  if (cur.customsFlatJpy === undefined) changed.push('通関 (課税対象外) estimate: estimator (B/L fee + AN) → ¥93,000');
  if (moveRule) changed.push(`due rule ${JSON.stringify(rules.INVOICE_2)}: step 11 → step 2`);
  if ((cur.invoiceRemarks ?? '') !== KATO_REMARKS) changed.push(`通関 備考 block:\n      - ${String(cur.invoiceRemarks ?? '').split('\n').join('\n      - ')}\n      + ${KATO_REMARKS.split('\n').join('\n      + ')}`);
  if (!changed.length) console.log('  already set');
  for (const c of changed) plan(c);
  // Step impact (what applyProfile will do): open orders' step 2.
  const orders: any[] = await p.tradeOrder.findMany({
    where: { organizationId: ADH, customerId: KATO, status: 'OPEN', isTest: false },
    orderBy: { orderNo: 'asc' },
    select: { orderNo: true, grade: true, deliveryMonth: true, steps: { where: { code: { in: ['INVOICE_1', 'INVOICE_2'] } }, select: { code: true, status: true, notApplicable: true } }, shipments: { select: { steps: { where: { code: 'SHIPPING_DOCS' }, select: { status: true, completedAt: true } } } } },
  });
  for (const o of orders) {
    const s11 = o.steps.find((s: any) => s.code === 'INVOICE_2');
    const s2 = o.steps.find((s: any) => s.code === 'INVOICE_1');
    const docs = o.shipments.flatMap((s: any) => s.steps);
    const done = docs.length && docs.every((x: any) => x.status === 'DONE') ? docs.map((x: any) => x.completedAt?.toISOString().slice(0, 10)).sort().pop() : null;
    const after = s11?.status === 'DONE' ? 'stays off — "Invoiced on step 11"' : `ON: "Issue and send invoices" (needs the single invoice), due ${done ? `${done} + 2 days` : 'when step 3b is done + 2 days'}`;
    console.log(`  #${o.orderNo} ${o.grade} (deliv ${o.deliveryMonth}): step 11 ${s11?.status}; step 2 ${s2?.notApplicable ? 'N/A' : s2?.status} → ${after}`);
  }
  if (APPLY && changed.length) {
    await config.updateSettings(ADH, { customerProfiles: { [KATO]: next } } as any);
    await log('UPDATE', 'CustomerProfile', KATO, { name: 'Kato', changes: changed });
  }

  // ── 2. Q4 MJP ──
  console.log('── 2. QMJP 2026-4Q ──');
  const q = ts.docDefaults?.qmjpByQuarter ?? {};
  if (q['2026-4Q'] !== undefined) console.log(`  set (${q['2026-4Q']})`);
  else {
    plan('qmjpByQuarter["2026-4Q"]: — → 255');
    if (APPLY) {
      await config.updateSettings(ADH, { docDefaults: { qmjpByQuarter: { ...q, '2026-4Q': 255 } } } as any);
      await log('UPDATE', 'TradeSetting.docDefaults', ADH, { key: 'qmjpByQuarter', add: { '2026-4Q': 255 } });
    }
  }

  // ── 3. Doc type + step optional types ──
  console.log('── 3. Doc type INVOICE_ADJUSTMENT ──');
  const dt = await p.tradeDocType.findFirst({ where: { organizationId: ADH, code: 'INVOICE_ADJUSTMENT' } });
  if (dt) console.log('  doc type exists');
  else {
    const ref: any = await p.tradeDocType.findFirst({ where: { organizationId: ADH, code: 'INVOICE_SINGLE' } });
    plan('create doc type INVOICE_ADJUSTMENT "Correction / actual-cost invoice (正誤差額・実費差分)" (INVOICES)');
    if (APPLY) {
      const { id: _i, createdAt: _c, updatedAt: _u, ...base } = ref;
      const row = await p.tradeDocType.create({ data: { ...base, code: 'INVOICE_ADJUSTMENT', label: 'Correction / actual-cost invoice (正誤差額・実費差分)', sortOrder: (ref.sortOrder ?? 0) + 1 } });
      await log('CREATE', 'TradeDocType', row.id, { code: 'INVOICE_ADJUSTMENT' });
    }
  }
  for (const code of ['INVOICE_1', 'INVOICE_2']) {
    const tpl: any = await p.tradeStepTemplate.findFirst({ where: { organizationId: ADH, scope: 'ORDER', code } });
    const want = tpl && !tpl.optionalDocTypes.includes('INVOICE_ADJUSTMENT') ? [...tpl.optionalDocTypes.filter((x: string) => x !== 'OTHER'), 'INVOICE_ADJUSTMENT', 'OTHER'] : null;
    if (!want) {
      console.log(`  step ${code}: already optional`);
      continue;
    }
    const open = await p.tradeStep.count({ where: { organizationId: ADH, code, status: { not: 'DONE' } } });
    plan(`step ${code === 'INVOICE_1' ? '2' : '11'}: optional doc types + INVOICE_ADJUSTMENT (template + ${open} open step(s))`);
    if (APPLY) {
      await p.tradeStepTemplate.update({ where: { id: tpl.id }, data: { optionalDocTypes: want } });
      const steps: any[] = await p.tradeStep.findMany({ where: { organizationId: ADH, code, status: { not: 'DONE' } }, select: { id: true, optionalDocTypes: true } });
      for (const s of steps) if (!s.optionalDocTypes.includes('INVOICE_ADJUSTMENT')) await p.tradeStep.update({ where: { id: s.id }, data: { optionalDocTypes: [...s.optionalDocTypes.filter((x: string) => x !== 'OTHER'), 'INVOICE_ADJUSTMENT', 'OTHER'] } });
      await log('UPDATE', 'TradeStepTemplate', tpl.id, { code, add: 'INVOICE_ADJUSTMENT', openSteps: steps.length });
    }
  }

  // ── 4. Files ──
  console.log('── 4. File the invoices ──');
  const s3 = new S3Client({ region: process.env.AWS_REGION || 'ap-southeast-1' });
  for (const f of FILES) {
    const name = PDF_DIR ? fs.readdirSync(PDF_DIR).find((n) => f.match.test(n)) : undefined;
    const o: any = await p.tradeOrder.findFirst({ where: { organizationId: ADH, orderNo: f.orderNo }, select: { id: true, clientPremium: true, steps: { where: { code: 'INVOICE_1' }, select: { id: true } }, shipments: { select: { seqNo: true, netWeightMt: true } } } });
    if (!name) {
      console.log(`  ${f.no}: PDF not found in --pdfs`);
      continue;
    }
    const buf = fs.readFileSync(path.join(PDF_DIR, name));
    const sha = createHash('sha256').update(buf).digest('hex');
    const have = await p.tradeFile.findFirst({ where: { organizationId: ADH, sha256: sha }, select: { id: true } });
    const facts = `premium in AIMS ${o.clientPremium}${f.orderNo === 28 ? ' (PDF bills 260 — check)' : ''}; net weight ${o.shipments.map((s: any) => `#${f.orderNo}-${s.seqNo} ${s.netWeightMt ?? 'empty (CI: 40.271)'}`).join(', ')}`;
    if (have) {
      console.log(`  ${f.no} already filed (${name})`);
      continue;
    }
    plan(`${name} → #${f.orderNo} step 2 as INVOICE_SINGLE; notes "${notesOf(f)}" — ${facts}`);
    if (APPLY) {
      const id = randomUUID();
      const key = `shipments/${ADH}/${new Date().getUTCFullYear()}/${id}_${sanitizeFileName(name)}`;
      await s3.send(new PutObjectCommand({ Bucket: process.env.RESOURCE_BUCKET || 'aims-osiris', Key: key, Body: buf, ContentType: 'application/pdf' }));
      const docRef = await config.docRefFor(p as any, ADH, { orderId: o.id } as any, 'INVOICE_SINGLE');
      await p.tradeFile.create({
        data: { id, organizationId: ADH, docType: 'INVOICE_SINGLE', s3Key: key, fileName: name, mimeType: 'application/pdf', sizeBytes: buf.length, uploadedById: 'system:round-bo-kato-go', uploadedByName: 'System creation', notes: notesOf(f), docRef, source: 'UPLOAD', sha256: sha, links: { create: { organizationId: ADH, orderId: o.id, stepId: o.steps[0]?.id ?? null } } },
      });
      await log('CREATE', 'TradeFile', id, { fileName: name, order: `#${f.orderNo}`, step: 2, notes: notesOf(f) });
    }
  }
  const corr: any = await p.tradeFile.findFirst({ where: { organizationId: ADH, fileName: CORRECTION.fileName }, select: { id: true, docType: true, notes: true } });
  if (!corr) console.log('  correction 202610_004 not found in AIMS');
  else if (corr.docType === 'INVOICE_ADJUSTMENT') console.log('  correction 202610_004 already INVOICE_ADJUSTMENT');
  else {
    const notes = `${notesOf(CORRECTION, CORRECTION.note)}${corr.notes ? `\n${corr.notes}` : ''}`;
    plan(`${CORRECTION.fileName} (on #22): doc type ${corr.docType} → INVOICE_ADJUSTMENT; notes + "${notesOf(CORRECTION, CORRECTION.note)}"`);
    if (APPLY) {
      await p.tradeFile.update({ where: { id: corr.id }, data: { docType: 'INVOICE_ADJUSTMENT', notes } });
      await log('UPDATE', 'TradeFile', corr.id, { docType: { from: corr.docType, to: 'INVOICE_ADJUSTMENT' }, notes: notesOf(CORRECTION, CORRECTION.note) });
    }
  }
  console.log(`\n${APPLY ? 'Applied' : 'DRY RUN —'} ${writes} write(s)${APPLY ? '' : ' planned; nothing written (add --apply after the go)'}`);
  await p.$disconnect();
}

main().catch((e) => {
  console.error(String(e?.message ?? e).slice(0, 400));
  process.exit(1);
});
