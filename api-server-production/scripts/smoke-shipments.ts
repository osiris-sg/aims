/**
 * Smoke test for the Shipments module, run through the service layer against
 * the DEV database (refuses prod and staging hosts). Creates a throwaway
 * contract + shipment for the ADH org, exercises the step / file / in-app
 * invoice-link rules, then deletes everything it created (including the S3
 * object and the throwaway invoice Document).
 *
 *   TS_NODE_TRANSPILE_ONLY=1 npx ts-node -r tsconfig-paths/register scripts/smoke-shipments.ts            # dry run
 *   TS_NODE_TRANSPILE_ONLY=1 npx ts-node -r tsconfig-paths/register scripts/smoke-shipments.ts --apply    # execute + clean up
 *   TS_NODE_TRANSPILE_ONLY=1 npx ts-node -r tsconfig-paths/register scripts/smoke-shipments.ts --cleanup  # leftovers only
 * (tsconfig-paths: the in-app invoice path runs the real DocumentsService, whose imports use "src/…".)
 *
 * Uses DATABASE_URL / TENANCY_MODE / AWS_* from .env. The upload writes one
 * small PDF under shipments/{orgId}/ in the resource bucket and deletes it.
 * SMOKE_API_URL (default http://localhost:4040) is probed to prove the removed
 * skip route is gone ("Cannot POST" vs the auth guard on a live route).
 */
import 'dotenv/config';
import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { NestFactory } from '@nestjs/core';
import configuration from '../config/configuration';
import { ActionLogModule } from '../src/action-log/action-log.module';
import { PushModule } from '../src/push/push.module';
import { ShipmentsModule } from '../src/shipments/shipments.module';
import { PrismaService } from '../src/common/prisma.service';
import { S3Service } from '../src/common/services/s3.service';
import { runAsOrg } from '../src/common/tenancy/tenant-context';
import { ContractsService } from '../src/shipments/contracts.service';
import { OrdersService } from '../src/shipments/orders.service';
import { SupplierOrdersService } from '../src/shipments/supplier-orders.service';
import { TradePaymentsService } from '../src/shipments/trade-payments.service';
import { ShipmentsService } from '../src/shipments/shipments.service';
import { TradeConfigService } from '../src/shipments/trade-config.service';
import { TradeDocumentsService } from '../src/shipments/trade-documents.service';
import { TradeGeneratedService } from '../src/shipments/trade-generated.service';
import { TradeFilesService } from '../src/shipments/trade-files.service';
import { TradeThumbsService } from '../src/shipments/trade-thumbs.service';
import { TradeStepsService } from '../src/shipments/trade-steps.service';
import { TradeExtractService } from '../src/shipments/trade-extract.service';
import * as XLSX from 'xlsx';
import { defaultLmeMonth, invoiceTotals, roundTo, toInvoiceLines, unitPriceOf } from '../src/shipments/trade-invoice';
import { TradeHubService } from '../src/shipments/trade-hub.service';
import { jpParty } from '../src/shipments/trade-generated.service';
import { backfillDocRefs } from './backfill-doc-refs';

const ORG_ID = process.env.SMOKE_ORG_ID || '222c6494-96ae-42d0-9283-1b5eabf47b42'; // Asia Deal Hub Japan LLC (dev)
const CONTRACT_NO = 'TEST-454003422';
/** The smoke order: year 2099 keeps it apart from real order numbers (document IDs "99-<no>-…"). */
const ORDER_YEAR = 2099;
const KATO_CONTRACT_NO = 'TEST-454003598';
const BL_NUMBER = 'TEST-198GX04630';
const INVOICE_PREFIX = 'SMOKE-INV-';
const API_URL = process.env.SMOKE_API_URL || 'http://localhost:4040';
const APPLY = process.argv.includes('--apply');
const CLEANUP_ONLY = process.argv.includes('--cleanup');
const actor = { id: 'smoke-shipments', name: 'Shipments smoke test' };

// A minimal valid one-page PDF.
/** The 出庫・納入依頼書 宛先 as the service defaults it (Document settings → 宛先, else 三井倉庫 株式会社 御中). */
const siAddresseeOf = (d: any) => d?.siAddressee ?? (d?.siWarehouseTo || d?.siTo ? `${d.siWarehouseTo ?? d.siTo} 御中` : '三井倉庫 株式会社 御中');
/** A COA .XLS in Vedanta's tab-delimited export (the summary: casts with weights + chemistry). */
const COA_TSV = Buffer.from(['Cast No\tNo of Bundle\tNet Wt\tFe\tSi\tMg', 'SMK1001\t1\t2.549\t0.12\t0.45\t0.55', ''].join('\r\n'));
const DUMMY_PDF = Buffer.from(
  '%PDF-1.4\n1 0 obj<</Type/Catalog/Pages 2 0 R>>endobj\n2 0 obj<</Type/Pages/Kids[3 0 R]/Count 1>>endobj\n' +
    '3 0 obj<</Type/Page/Parent 2 0 R/MediaBox[0 0 200 200]>>endobj\ntrailer<</Root 1 0 R>>\n%%EOF\n',
);

/**
 * Just enough of the app for TradeGeneratedService and its real Documents /
 * Templates services (invoice create + confirm, numbering) — no ScheduleModule,
 * so no cron job starts.
 */
@Module({ imports: [ConfigModule.forRoot({ load: [configuration], isGlobal: true }), ActionLogModule, PushModule, ShipmentsModule] })
class SmokeModule {}

const results: Array<{ check: string; ok: boolean; detail: string }> = [];
const pass = (check: string, detail = '') => results.push({ check, ok: true, detail });
const fail = (check: string, detail = '') => results.push({ check, ok: false, detail });

async function expectReject(check: string, fn: () => Promise<unknown>, pattern?: RegExp) {
  try {
    await fn();
    fail(check, 'succeeded but should have been refused');
  } catch (e) {
    const msg = (e as Error)?.message || String(e);
    if (pattern && !pattern.test(msg)) fail(check, `refused with an unexpected message: ${msg}`);
    else pass(check, `refused: ${msg}`);
  }
}

async function expectOk<T>(check: string, fn: () => Promise<T>): Promise<T | null> {
  try {
    const r = await fn();
    pass(check);
    return r;
  } catch (e) {
    fail(check, (e as Error)?.message || String(e));
    return null;
  }
}

function guardHost() {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error('DATABASE_URL is not set');
  const host = new URL(url).host;
  console.log(`host: ${host}`);
  if (host.includes('ep-icy-moon')) throw new Error('Refusing to run against PROD (ep-icy-moon)');
  if (host.includes('ep-odd-truth')) throw new Error('Refusing to run against STAGING (ep-odd-truth)');
  if (!host.includes('ep-steep-truth')) throw new Error(`Refusing: ${host} is not the known DEV host (ep-steep-truth)`);
}

async function main() {
  guardHost();
  console.log(`org:  ${ORG_ID}`);
  console.log(`mode: ${CLEANUP_ONLY ? 'CLEANUP' : APPLY ? 'APPLY' : 'DRY RUN'}\n`);

  const prisma = new PrismaService();
  const s3 = new S3Service(new ConfigService());
  const config = new TradeConfigService(prisma);
  const shipments = new ShipmentsService(prisma, config);
  const contracts = new ContractsService(prisma, config, shipments);
  const orders = new OrdersService(prisma, config, shipments);
  const steps = new TradeStepsService(prisma, config);
  const thumbs = new TradeThumbsService(prisma, s3);
  const files = new TradeFilesService(prisma, s3, config, thumbs);
  const docs = new TradeDocumentsService(prisma, config, files);
  const appCtx = APPLY || CLEANUP_ONLY ? await NestFactory.createApplicationContext(SmokeModule, { logger: ['error'] }) : null;
  const gen = appCtx ? appCtx.get(TradeGeneratedService) : (null as unknown as TradeGeneratedService);
  // Mock extraction path: canned model replies (no AI call, no cost); the rest
  // — upload, zod validation, drafts, linking, checks — is the real code.
  const replies: unknown[] = [];
  const fakeExtractor = {
    extractStructured: async () => ({ data: replies.shift(), model: 'mock', inputTokens: 0, outputTokens: 0 }),
  };
  const extract = new TradeExtractService(prisma, s3, files, fakeExtractor as any);
  const pdfFile = (name: string) => ({ originalname: name, mimetype: 'application/pdf', size: DUMMY_PDF.length, buffer: DUMMY_PDF }) as Express.Multer.File;

  await runAsOrg(ORG_ID, async () => {
    const leftover = await prisma.contract.findFirst({ where: { organizationId: ORG_ID, contractNo: CONTRACT_NO }, select: { id: true } });
    const leftoverShip =
      (await prisma.shipment.findFirst({ where: { organizationId: ORG_ID, blNumber: BL_NUMBER }, select: { id: true } })) ??
      (await prisma.tradeOrder.findFirst({ where: { organizationId: ORG_ID, year: ORDER_YEAR }, select: { id: true } }));
    if (CLEANUP_ONLY) {
      await cleanup(prisma, s3, leftover?.id ?? null);
      return;
    }
    if (leftover || leftoverShip) {
      throw new Error(`Leftovers from an earlier run exist (${CONTRACT_NO} / ${BL_NUMBER}) — run with --cleanup first`);
    }

    const fmt = await prisma.documentNumberFormat.findFirst({ where: { organizationId: ORG_ID, documentType: 'INVOICE' }, select: { id: true, nextSerial: true, lastResetKey: true } });
    numberingBefore = fmt ? { ...fmt, invoices: await prisma.document.count({ where: { organizationId: ORG_ID, type: 'INVOICE' } }) } : null;
    const customer = await prisma.customer.findFirst({
      where: { organizationId: ORG_ID, name: { startsWith: 'SUS' } },
      select: { id: true, name: true, jpName: true, jpAddress: true, jpContact: true },
    });
    const supplier = await prisma.supplier.findFirst({ where: { organizationId: ORG_ID, name: { startsWith: 'Vedanta' } }, select: { id: true, name: true } });
    if (!customer || !supplier) throw new Error('SUS customer / Vedanta supplier not found — run setup-adh-org.ts first');
    console.log(`customer: ${customer.name} [${customer.id}]`);
    console.log(`supplier: ${supplier.name} [${supplier.id}]\n`);

    const plan = [
      `read a PI (mock model) → draft; create contract ${CONTRACT_NO} (Vedanta → SUS) with the PI linked to "1. Set up PI payment"`,
      '  with 2 product lines (6005 203MM 50 MT, 6063 152MM 30 MT) → consignee/notify from org defaults, deposit 10 %',
      'create a shipment without a line on a 2-line contract → expect refused',
      `create shipment ${BL_NUMBER} on line 2 → commodity/size/delivery month prefilled, current step "1. Approve B/L draft"`,
      'remove the shipped product line                → expect refused',
      'complete BL_DRAFT_APPROVAL with no file          → expect refused',
      'upload dummy PDF as BL_DRAFT for that step       → expect ok',
      'complete BL_DRAFT_APPROVAL                       → expect ok; current step → 2, list filter by current step',
      'unlink the BL_DRAFT file                         → expect refused',
      'complete INVOICE_1 (contract) with nothing       → expect refused',
      `create a throwaway INVOICE Document (${INVOICE_PREFIX}…) and link it as INVOICE_1 → expect ok`,
      'complete INVOICE_1 while the invoice is a draft  → expect refused (only confirmed counts)',
      'confirm the invoice, complete INVOICE_1          → expect ok',
      'upload a tab-delimited PL (Vedanta format) as PL → create Customer PL from it → finalize (PDF) → requirement met',
      'edit-again the Customer PL                       → expect ok (step not done), PDF removed',
      'upload the same PL as a real .xlsx (title rows above the header) → Customer PL rows identical to the text file',
      'unlink the invoice while INVOICE_1 is DONE       → expect refused',
      'no skip: service method gone, POST /trade-steps/:id/skip not routed',
      'complete the shipment                            → expect refused (other steps open), ADH step numbers in the message',
      're-check the uploaded B/L draft (mock model)     → Tax ID missing; acknowledge',
      'read a 2nd B/L draft → shipment on the 6005 line, PDF linked to "3a. Approve B/L draft (Vedanta)"; delete it',
      'cancelled Fill from PI → source PDF + extraction discarded; a saved PI cannot be discarded',
      'in-app documents (Customer PL / COA, SG→JP IV/PL, shipping instructions, Invoice #2 on the shipment; Invoice #1 on the contract):',
      '  create blank → download draft PDF (no watermark) → finalize → step requirement met → download final PDF',
      '  invoices: Sales invoice created + confirmed (ADH-INV-…); Invoice #1 edit again → unconfirmed → finalize again (same number)',
      '  Invoices tab view: Sales invoice → its 請求書 (final PDF, editor, contract / shipment links)',
      'clean up: reopen steps, unlink invoice, delete invoice Document, file (+S3), shipment, contract',
    ];
    if (!APPLY) {
      console.log('Plan (dry run, nothing written):');
      plan.forEach((p, i) => console.log(`  ${i + 1}. ${p}`));
      console.log('\nRe-run with --apply to execute.');
      return;
    }

    let contractId: string | null = null;
    const settingsNow = await config.getSettings(ORG_ID);
    try {
      // ── Fill from PI (mocked read) ────────────────────────────────────────
      replies.push({
        contractNo: CONTRACT_NO,
        piNumber: 'SMOKE-PI-1',
        piDate: '30/06/2026',
        supplierName: 'VEDANTA ALUMINIUM METAL LIMITED',
        termsOfDelivery: 'CIF YOKOHAMA, JAPAN',
        paymentTerms: '10% Adv with 5 business days',
        shipmentMonth: '2026-07',
        tolerance: '+/-5%',
        currency: 'USD',
        totalAmount: '100,000.00',
        amountPayable: 10000,
        lines: [{ description: 'ALUMINIUM BILLET ALLOY 6005V1-C 8 INCH', sizeRaw: '8 INCH', quantityMt: 50, premium: 513.5 }],
      });
      const piX = await expectOk('read a PI (mock model) → contract draft', () => extract.extract(ORG_ID, 'PI', { file: pdfFile('SMOKE-PI.pdf') }, actor));
      const piDraft = (piX?.result as any)?.draft;
      (piX?.status === 'DONE' && piDraft?.contractNo === CONTRACT_NO && piDraft.supplierId === supplier.id && piDraft.destinationPort === 'Yokohama' && piDraft.lines[0].sizeSpec === '203 MM (8 INCH)'
        ? pass
        : fail)('PI draft: contract no., Vedanta matched, port, 8 INCH → 203 MM', JSON.stringify(piDraft ?? piX?.error));
      const contract = await expectOk('create contract (from the PI draft)', () =>
        contracts.create(
          ORG_ID,
          {
            piFileId: piX?.fileId,
            contractNo: CONTRACT_NO,
            supplierId: supplier.id,
            customerId: customer.id,
            shipmentMonth: '2026-07',
            deliveryMonth: '2026-09',
            piAmount: 100000,
            lines: [
              { grade: '6005', product: 'Aluminium Billet', sizeSpec: '203MM', quantityMt: 50 },
              { grade: '6063', product: 'Aluminium Billet', sizeSpec: '152MM', quantityMt: 30 },
            ],
          },
          actor,
        ),
      );
      if (!contract) return;
      contractId = contract.id;
      // Since orders the contract is the yearly LTC master: no steps, no shipment of its own.
      (contract.steps.length === 0 && contract.shipments.length === 0 ? pass : fail)('contract (LTC) has no steps and no shipment of its own', `${contract.steps.length} step(s), ${contract.shipments.length} shipment(s)`);
      const settings = await config.getSettings(ORG_ID);
      (contract.lines.length === 2 && contract.linesSummary === '6005 · 50 MT, 6063 · 30 MT' ? pass : fail)('2 product lines saved, list summary', String(contract.linesSummary));
      // The order (the deal): PI, deposit, steps 0 / 1 / 2 / 13; the shipments under it.
      const nextNo = await orders.nextOrderNo(ORG_ID, ORDER_YEAR);
      const order0 = await expectOk('create the order (contract picked: parties + premiums default from its 6063 line)', () =>
        orders.create(
          ORG_ID,
          { year: ORDER_YEAR, contractId: contract.id, shipMonth: '2026-07', deliveryMonth: '2026-09', grade: '6063', qtyMt: 30, piNo: 'SMOKE-PI-1', piDate: '2026-06-30', piAmount: 100000, piFileId: piX?.fileId },
          actor,
        ),
      );
      if (!order0) return;
      let order: any = order0;
      (order.orderNo === nextNo && order.label === `#${nextNo}` && order.customerId === customer.id && order.supplierId === supplier.id && order.size === '152MM' ? pass : fail)(
        'order: next free number, customer / supplier / size from the contract',
        `${order.label} ${order.size}`,
      );
      // Round E: steps 0 / 1 live on the supplier order the order made for itself (1:1 until a declaration shares one).
      (JSON.stringify(order.steps.map((x: any) => x.code)) === JSON.stringify(['INVOICE_1', 'XERO_HANDOFF']) ? pass : fail)(
        'order (customer side) steps 2 / 13 snapshotted',
        order.steps.map((x: any) => `${x.displayNo}.${x.code}`).join(', '),
      );
      (order.supplierOrder && JSON.stringify(order.supplierOrder.steps.map((x: any) => x.code)) === JSON.stringify(['CHECK_CONTRACT', 'PI_PAYMENT']) && order.supplierOrder.piNo === 'SMOKE-PI-1' && order.supplierOrder.label === 'PI SMOKE-PI-1' ? pass : fail)(
        'supplier order auto-created with the PI: steps 0 / 1',
        order.supplierOrder ? `${order.supplierOrder.label}: ${order.supplierOrder.steps.map((x: any) => `${x.displayNo}.${x.code}`).join(', ')}` : 'none',
      );
      (settings.defaultConsignee && order.consignee === settings.defaultConsignee && order.notifyParty === settings.defaultNotifyParty ? pass : fail)(
        'consignee / notify party default from the contract / org trade settings',
        String(order.consignee).split('\n')[0],
      );
      (Number(order.depositAmount) === 10000 ? pass : fail)('deposit = PI amount × 10 %', String(order.depositAmount));
      (order.currentStep?.label === '1. Set up PI payment' && order.supplierOrder?.steps.find((x: any) => x.code === 'CHECK_CONTRACT')?.status === 'DONE' ? pass : fail)(
        'contract picked → supplier-side step 0 completes by itself, step 1 is current',
        order.currentStep?.label ?? 'none',
      );
      order = await orders.update(ORG_ID, order.id, { clientPremium: 230, supplierPremium: 205 }, actor);
      (order.depositDueDays === 3 && order.depositDueUnit === 'BUSINESS' && order.depositDueDate === '2026-07-03' ? pass : fail)(
        'deposit due defaults to 3 business days (PI 30/06/2026 → 03/07/2026)',
        `${order.depositDueDays} ${order.depositDueUnit} ${order.depositDueDate}`,
      );
      {
        const due = contracts.depositDue('2026-06-30', '3', 'BUSINESS');
        (due.dueDate === '2026-07-03' ? pass : fail)('deposit due date: PI 30/06/2026 + 3 business days = 03/07/2026', String(due.dueDate));
      }
      (order.shipments.length === 0 ? pass : fail)('a new order has no shipment until "Add shipment"', `${order.shipments.length}`);
      // Cancelled Fill from PI: the unsaved PDF (+ its extraction) goes; a saved one is refused.
      replies.push({ contractNo: 'SMOKE-CANCELLED', lines: [] });
      const cancelled = await expectOk('read a PI that is then cancelled (mock model)', () => extract.extract(ORG_ID, 'PI', { file: pdfFile('SMOKE-PI-CANCEL.pdf') }, actor));
      if (cancelled) {
        await expectOk('discard the cancelled PI', () => extract.discardSource(ORG_ID, cancelled.fileId, actor));
        const left = (await prisma.tradeFile.count({ where: { id: cancelled.fileId } })) + (await prisma.tradeExtraction.count({ where: { fileId: cancelled.fileId } }));
        (left === 0 ? pass : fail)('cancelled PI: file + extraction removed', `${left} row(s) left`);
      }
      if (piX?.fileId) await expectReject('discard the PI saved with the order', () => extract.discardSource(ORG_ID, piX.fileId, actor), /attached to a contract or shipment/);
      const piStep = order.supplierOrder?.steps.find((s: any) => s.code === 'PI_PAYMENT');
      const piLink = order.supplierOrder?.fileLinks.find((l: any) => l.file.id === piX?.fileId);
      (piLink && piLink.file.docType === 'PI' && piLink.stepId === piStep?.id ? pass : fail)(
        'PI file linked to the supplier order as PI on "1. Set up PI payment"',
        piLink ? `step ${piLink.stepId}` : 'not linked',
      );

      {
        // "Add shipment": no form — the B/L comes on its step 2; the product line follows the order's grade.
        const added: any = await expectOk('Add shipment (#n-1, B/L pending)', () => orders.addShipment(ORG_ID, order.id, {}, actor));
        (added && added.ref === `#${order.orderNo}-1` && added.contractLineId === contract.lines[1].id && added.blNumber === null && added.steps.length === 12 ? pass : fail)(
          'added shipment: #n-1, B/L pending, line of the order\'s grade, 12 steps',
          added ? `${added.ref} ${added.blNumber} ${added.steps.length}` : 'none',
        );
        const s2 = added?.steps.find((x: any) => x.code === 'BL_DRAFT_APPROVAL');
        (s2?.status === 'IN_PROGRESS' && JSON.stringify(s2.requiredFields) === JSON.stringify(['blNumber']) ? pass : fail)('shipment step 2 is current and needs the B/L no.', `${s2?.status} ${JSON.stringify(s2?.requiredFields)}`);
        const deal = await orders.getById(ORG_ID, order.id);
        (deal.shipments.length === 1 ? pass : fail)('order page lists the shipment', `${deal.shipments.length}`);
        await expectReject('complete the order while its shipments are open', () => orders.complete(ORG_ID, order.id), /complete its shipment\(s\) first/);
        if (added) await expectOk('delete the added shipment', () => shipments.remove(ORG_ID, added.id));
      }
      const line2 = contract.lines[1];
      const shipment = await expectOk('Add shipment with its B/L (line of the order\'s grade)', () => orders.addShipment(ORG_ID, order.id, { blNumber: BL_NUMBER, totalPieces: 600 }, actor));
      if (!shipment) return;
      (shipment.contractLineId === line2.id && shipment.commodity === 'Aluminium Billet 6063' && shipment.sizeSpec === '152MM' && shipment.deliveryMonth === '2026-09' && shipment.orderId === order.id ? pass : fail)(
        'commodity / size / delivery month from the order',
        `${shipment.commodity} / ${shipment.sizeSpec} / ${shipment.deliveryMonth}`,
      );
      (shipment.currentStep?.label === '3a. Approve B/L draft (Vedanta)' ? pass : fail)('shipment current step uses the ADH number + new title', shipment.currentStep?.label ?? 'none');
      const an = shipment.steps.find((s) => s.code === 'AN_INSTRUCTIONS');
      (an && JSON.stringify(an.requiredDocTypes) === JSON.stringify(['ARRIVAL_NOTICE', 'SHIPPING_INSTRUCTIONS', 'TELEX_RELEASE', 'DELIVERY_SCHEDULE']) ? pass : fail)(
        'arrival-notice step needs 4 documents',
        an?.requiredDocTypes.join(', '),
      );
      await expectReject(
        'remove a product line a shipment ships',
        () => contracts.update(ORG_ID, contract.id, { lines: [{ id: contract.lines[0].id, grade: '6005', quantityMt: 50 }] }),
        /shipment\(s\) TEST-198GX04630 ship it/,
      );
      (shipment.customer?.id === customer.id ? pass : fail)('shipment customer defaults to the order customer', shipment.customer?.name ?? 'none');
      (shipment.steps.length === 12 && !shipment.steps.some((x: any) => x.code === 'XERO_HANDOFF') ? pass : fail)('shipment steps snapshotted (13 is on the order now)', `${shipment.steps.length} steps`);

      await expectReject('duplicate B/L number refused', () => orders.addShipment(ORG_ID, order.id, { blNumber: BL_NUMBER }, actor), /already used/);

      const blStep = shipment.steps.find((s) => s.code === 'BL_DRAFT_APPROVAL');
      const sendStep = shipment.steps.find((s) => s.code === 'SEND_DOCS_SCHEDULE');
      if (!blStep || !sendStep) {
        fail('find BL_DRAFT_APPROVAL / SEND_DOCS_SCHEDULE steps', shipment.steps.map((s) => s.code).join(', '));
        return;
      }

      await expectReject('complete BL_DRAFT_APPROVAL without a file', () => steps.complete(ORG_ID, blStep.id, actor), /B\/L draft/);

      const uploaded = await expectOk('upload BL_DRAFT PDF', () =>
        files.upload(
          ORG_ID,
          { originalname: 'smoke-bl-draft.pdf', mimetype: 'application/pdf', size: DUMMY_PDF.length, buffer: DUMMY_PDF } as Express.Multer.File,
          { docType: 'BL_DRAFT', shipmentIds: [shipment.id], stepId: blStep.id },
          actor,
        ),
      );
      if (!uploaded) return;
      const link = uploaded.links.find((l) => l.shipmentId === shipment.id);
      (link?.stepId === blStep.id ? pass : fail)('file linked to the shipment and tagged with the step');

      const url = await expectOk('signed URL', () => files.getUrl(ORG_ID, uploaded.id));
      if (url && !url.url.includes(`shipments/${ORG_ID}/`)) fail('signed URL key prefix', url.url);

      // Auto-complete: the B/L no. was set when the shipment was created, so the draft completes step 3a.
      ((uploaded as any).completedSteps?.includes('3a. Approve B/L draft (Vedanta)') ? pass : fail)('auto-complete: the upload completes step 3a (reported for the toast)', JSON.stringify((uploaded as any).completedSteps));
      const done = (await shipments.getById(ORG_ID, shipment.id)).steps.find((x: any) => x.id === blStep.id) as any;
      (done?.status === 'DONE' && done.completedAt && done.updatedByName === actor.name ? pass : fail)('step is DONE with completedAt and who', `${done?.status} ${done?.updatedByName}`);
      await expectReject('"Mark done" on an already-done step', () => steps.complete(ORG_ID, blStep.id, actor), /already done/);
      ((uploaded as any).hasThumb === true ? pass : fail)('upload made a first-page thumbnail', String((uploaded as any).hasThumb));
      {
        const t = await expectOk('thumbnail signed URL', () => files.thumbUrl(ORG_ID, uploaded.id));
        (t?.url && t.url.includes(`shipments/${ORG_ID}/`) && t.url.includes('.thumb.png') ? pass : fail)('thumbnail stored next to the file', t?.url ? 'ok' : 'none');
      }
      if (done) {
        const page = await shipments.list(ORG_ID, { currentStep: 'SHIPPING_DOCS' });
        const row = page.items.find((r: any) => r.id === shipment.id);
        (row?.currentStep?.label === '3b. Receive shipping documents' ? pass : fail)('current step advances; list filter by current step', row?.currentStep?.label ?? 'not in filtered list');
      }

      if (link) {
        await expectReject('unlink the BL_DRAFT file while the step is DONE', () => files.removeLink(ORG_ID, uploaded.id, link.id), new RegExp(blStep.title.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
      }
      await expectReject('delete the BL_DRAFT file while the step is DONE', () => files.remove(ORG_ID, uploaded.id), new RegExp(blStep.title.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));

      // ── In-app invoice satisfies a step (TradeDocumentLink) ──────────────
      const inv1 = order.steps.find((s: any) => s.code === 'INVOICE_1');
      let invoiceId: string | null = null;
      if (!inv1) fail('find INVOICE_1 order step', order.steps.map((s: any) => s.code).join(', '));
      else {
        await expectReject('complete INVOICE_1 with no file or invoice', () => steps.complete(ORG_ID, inv1.id, actor), /Invoice #1/);
        const invoice = await expectOk('create throwaway INVOICE Document', () =>
          prisma.document.create({
            data: {
              organizationId: ORG_ID,
              type: 'INVOICE',
              name: `${INVOICE_PREFIX}${Date.now()}`,
              documentTemplateId: 'smoke-shipments',
              status: 'unconfirmed',
              config: { customer: { id: customer.id, name: customer.name }, customerId: customer.id, currency: 'USD', referenceNo: CONTRACT_NO, nettTotal: 1234.5 },
            },
            select: { id: true, name: true },
          }),
        );
        if (invoice) {
          invoiceId = invoice.id;
          const linked = await expectOk('link the invoice as INVOICE_1 via the step', () => docs.link(ORG_ID, { documentId: invoice.id, docType: 'INVOICE_1', stepId: inv1.id }));
          const dl = linked?.find((l) => l.orderId === order.id);
          (dl && dl.stepId === inv1.id && !dl.satisfies && dl.state === 'draft' && dl.document?.number === invoice.name ? pass : fail)(
            'draft invoice linked to the order, tagged with the step, not counting yet',
            dl ? `${dl.document?.number} · ${dl.state} · ${dl.document?.currency} ${dl.document?.total}` : 'no link',
          );
          await expectReject('complete INVOICE_1 while the invoice is a draft', () => steps.complete(ORG_ID, inv1.id, actor), /Invoice #1/);
          await expectOk('confirm the throwaway invoice', () => prisma.document.update({ where: { id: invoice.id, organizationId: ORG_ID }, data: { status: 'confirmed' } }));
          const detail: any = await orders.getById(ORG_ID, order.id);
          const req = detail.steps.find((s: any) => s.id === inv1.id)?.requirements?.[0];
          (req?.satisfied && req.documents === 1 ? pass : fail)('order detail: INVOICE_1 requirement met by 1 document', JSON.stringify(req));
          const inv1Done = await expectOk('complete INVOICE_1 with the linked invoice', () => steps.complete(ORG_ID, inv1.id, actor));
          if (inv1Done) (inv1Done.status === 'DONE' ? pass : fail)('INVOICE_1 is DONE', inv1Done.status);
          if (dl) await expectReject('unlink the invoice while INVOICE_1 is DONE', () => docs.unlink(ORG_ID, dl.id), /Invoice #1/);
          await expectOk('reopen INVOICE_1', () => steps.reopen(ORG_ID, inv1.id, actor));
          if (dl) await expectOk('unlink the invoice once reopened', () => docs.unlink(ORG_ID, dl.id));
        }
      }

      // ── In-app Customer PL from a supplier PL spreadsheet ─────────────────
      const PL_TEXT = [
        'Sl. No.\tBatch\tNet Wt.\tGross Wt.\tContainer ID',
        '   1 \tSMK1001\t         2.549 \t         2.559 \tSMKU0000001',
        '   2 \tSMK1002\t         2.548 \t         2.558 \tSMKU0000001',
        '     \t          \t         5.097 \t         5.117 \tSub Total',
        '',
      ].join('\r\n');
      const plFile = await expectOk('upload a tab-delimited PL.XLS (Vedanta format) as PL', () =>
        files.upload(
          ORG_ID,
          { originalname: 'SMOKE-PL.XLS', mimetype: 'application/vnd.ms-excel', size: Buffer.byteLength(PL_TEXT), buffer: Buffer.from(PL_TEXT) } as Express.Multer.File,
          { docType: 'PL', shipmentIds: [shipment.id] },
          actor,
        ),
      );
      if (plFile) {
        const srcs = await gen.sources(ORG_ID, shipment.id, 'CUSTOMER_PL');
        (srcs.some((f) => f.id === plFile.id) ? pass : fail)('the PL spreadsheet is offered as a Customer PL source', `${srcs.length} source(s)`);
        const draftPl = await expectOk('create Customer PL from it', () => gen.createFromSource(ORG_ID, shipment.id, 'CUSTOMER_PL', plFile.id, actor));
        if (draftPl) {
          const rows = draftPl.rows as any[];
          (rows.length === 2 && rows[0].batch === 'SMK1001' && rows[1].netMt === 2.548 && !draftPl.importNotes.length ? pass : fail)(
            'rows parsed (Sub Total skipped, totals match)',
            `${rows.length} rows; notes ${JSON.stringify(draftPl.importNotes)}`,
          );
          const addressee = (await config.profileOf(ORG_ID, customer.id)).docAddressee;
          ((draftPl.header as any).to?.name === (addressee || customer.jpName || customer.name) ? pass : fail)(
            'header addressed to the shipment customer (its profile 宛先, else its Japanese legal name)',
            (draftPl.header as any).to?.name,
          );
          ((draftPl.header as any).pieces === 600 ? pass : fail)("pieces = the shipment's Total pieces (600), not computed", String((draftPl.header as any).pieces));
          const fin = await expectOk('finalize Customer PL (Puppeteer PDF → TradeFile)', () => gen.finalize(ORG_ID, draftPl.id, actor));
          if (fin) {
            (fin.status === 'FINAL' && fin.finalFileId ? pass : fail)('Customer PL is FINAL with its PDF', `${fin.number}`);
            const sd = await shipments.getById(ORG_ID, shipment.id);
            const cd = sd.steps.find((s) => s.code === 'CUSTOMER_DOCS');
            const req = cd?.requirements?.find((r) => r.docType === 'CUSTOMER_PL');
            (req?.satisfied && req.files === 1 ? pass : fail)('CUSTOMER_PL requirement met by the finalized PDF', JSON.stringify(req));
            const reverted = await expectOk('edit again (step not done)', () => gen.revert(ORG_ID, draftPl.id));
            if (reverted) (reverted.status === 'DRAFT' && !reverted.finalFileId ? pass : fail)('back to DRAFT, PDF removed');
          }
          await expectOk('delete the Customer PL draft', () => gen.remove(ORG_ID, draftPl.id));
        }
        await expectOk('delete the PL spreadsheet (DB + S3)', () => files.remove(ORG_ID, plFile.id));

        // Same packing list as a real Excel workbook, header below a title block.
        const wb = XLSX.utils.book_new();
        XLSX.utils.book_append_sheet(
          wb,
          XLSX.utils.aoa_to_sheet([
            ['SUPPLIER PACKING LIST'],
            [],
            ['SL. NO.', 'batch', 'NET WT', 'Gross Wt.', 'Container ID'],
            [1, 'SMK1001', 2.549, 2.559, 'SMKU0000001'],
            [2, 'SMK1002', 2.548, 2.558, 'SMKU0000001'],
            ['', '', 5.097, 5.117, 'Sub Total'],
          ]),
          'PL',
        );
        const xlsxBuf: Buffer = XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' });
        const xlsxFile = await expectOk('upload the same PL as a real .xlsx', () =>
          files.upload(
            ORG_ID,
            { originalname: 'SMOKE-PL.xlsx', mimetype: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', size: xlsxBuf.length, buffer: xlsxBuf } as Express.Multer.File,
            { docType: 'PL', shipmentIds: [shipment.id] },
            actor,
          ),
        );
        if (xlsxFile) {
          const fromXlsx = await expectOk('create Customer PL from the .xlsx', () => gen.createFromSource(ORG_ID, shipment.id, 'CUSTOMER_PL', xlsxFile.id, actor));
          if (fromXlsx && draftPl) {
            const same = JSON.stringify(fromXlsx.rows) === JSON.stringify(draftPl.rows);
            (same && !fromXlsx.importNotes.length ? pass : fail)(
              '.xlsx rows identical to the tab-delimited file (Sub Total skipped, totals match)',
              same ? `${(fromXlsx.rows as any[]).length} rows` : `${JSON.stringify(fromXlsx.rows)} vs ${JSON.stringify(draftPl.rows)}`,
            );
            await expectOk('delete the .xlsx Customer PL draft', () => gen.remove(ORG_ID, fromXlsx.id));
          }
          await expectOk('delete the .xlsx spreadsheet (DB + S3)', () => files.remove(ORG_ID, xlsxFile.id));
        }
      }

      // ── Customer COA (納品書兼分析試験成績報告書) from Vedanta's per-bundle COA.XLS ──
      {
        const dd: any = settingsNow.docDefaults ?? {};
        const COA_TEXT = [
          'Batch\tCast No\tMaterial\tNet Wt\tGross WT\tLength\tSize\tFE\tSI\tTI\tMN\tMG\tZN\tPB\tCU\tCR\tAL\tOTTOT\tSR\tULT\tZR\tCD\t',
          'SMK100101\tSMK1001\tB60630108 \t2.548\t2.558 \t5800 \t8" \t0.1500 \t0.4600 \t0.0170 \t0.0270 \t0.4810 \t0.0050 \t0.0010 \t0.0005 \t0.0010 \t98.830 \t0.0300 \t \t \t0.0080 \t \t',
          'SMK100102\tSMK1001\tB60630108 \t2.550\t2.560 \t5800 \t8" \t0.1700 \t0.4600 \t0.0170 \t0.0270 \t0.4810 \t0.0050 \t0.0010 \t0.0005 \t0.0010 \t98.850 \t0.0300 \t \t \t0.0080 \t \t',
          'SMK200201\tSMK2002\tB60630108 \t2.549\t2.559 \t5800 \t8" \t0.1500 \t0.4600 \t0.0130 \t0.0240 \t0.4780 \t0.0059 \t0.0009 \t0.0013 \t0.0012 \t98.840 \t0.0300 \t \t \t0.0090 \t \t',
        ].join('\r\n');
        const coaFile = await expectOk('upload a per-bundle COA.XLS (Vedanta format) as COA', () =>
          files.upload(
            ORG_ID,
            { originalname: 'SMOKE-COA.XLS', mimetype: 'application/vnd.ms-excel', size: Buffer.byteLength(COA_TEXT), buffer: Buffer.from(COA_TEXT) } as Express.Multer.File,
            { docType: 'COA', shipmentIds: [shipment.id] },
            actor,
          ),
        );
        const coaPdf = await expectOk('upload a PDF without a COA table as COA', () =>
          files.upload(
            ORG_ID,
            { originalname: 'SMOKE-COA.pdf', mimetype: 'application/pdf', size: DUMMY_PDF.length, buffer: DUMMY_PDF } as Express.Multer.File,
            { docType: 'COA', shipmentIds: [shipment.id] },
            actor,
          ),
        );
        if (coaFile && coaPdf) {
          const srcs = await gen.sources(ORG_ID, shipment.id, 'CUSTOMER_COA');
          (srcs.some((f) => f.id === coaFile.id) && srcs.some((f) => f.id === coaPdf.id) ? pass : fail)('COA spreadsheet and COA PDF are both offered as sources', `${srcs.length} source(s)`);
          const draftCoa = await expectOk('create Customer COA from the COA.XLS', () => gen.createFromSource(ORG_ID, shipment.id, 'CUSTOMER_COA', coaFile.id, actor));
          if (draftCoa) {
            const rows = draftCoa.rows as any[];
            const h: any = draftCoa.header;
            (rows.length === 2 && rows[0].batch === 'SMK1001' && rows[0].bundles === 2 && rows[0].fe === '0.1600' && rows[0].netwt === 5.098 && rows[1].bundles === 1 ? pass : fail)(
              'COA: one row per cast (2 casts from 3 bundles), FE averaged, bundles counted, net summed',
              JSON.stringify(rows.map((r) => [r.batch, r.bundles, r.fe, r.netwt])),
            );
            (h.layout === 'jp' &&
              h.title === '納品書兼分析試験成績報告書' &&
              h.productLine === 'ALUMINIUM BILLET 6063' &&
              h.issuer?.name === (dd.customerDocIssuerName ?? h.issuer?.name) &&
              h.piecesPerBundle === (dd.customerCoaPiecesPerBundle ?? null) &&
              h.vendor === (dd.customerCoaVendor ?? '')
              ? pass
              : fail)('COA header: 納品書兼分析試験成績報告書, 品種, issuer, 1BD本数, ベンダー from the org settings', `${h.productLine} / ${h.issuer?.name} / ${h.piecesPerBundle} / ${h.vendor}`);
            const html = await gen.previewHtml('CUSTOMER_COA', draftCoa.header, draftCoa.columns, draftCoa.rows, true);
            (['品種', 'バンドル数', 'トータル本数', '分析試験成績', 'ベンダー', 'OTTOT'].every((t) => html.includes(t)) ? pass : fail)("COA preview prints ADH's labels");
            await expectOk('delete the Customer COA draft', () => gen.remove(ORG_ID, draftCoa.id));
          }
          await expectReject('create Customer COA from a PDF without a COA table', () => gen.createFromSource(ORG_ID, shipment.id, 'CUSTOMER_COA', coaPdf.id, actor), /No COA table/);
        }
        if (coaFile) await expectOk('delete the COA.XLS (DB + S3)', () => files.remove(ORG_ID, coaFile.id));
        if (coaPdf) await expectOk('delete the COA PDF (DB + S3)', () => files.remove(ORG_ID, coaPdf.id));
      }

      // ── Skip is gone ───────────────────────────────────────────────────────
      ((steps as any).skip === undefined ? pass : fail)('TradeStepsService has no skip()');
      try {
        // Unauthenticated: a routed path stops at the auth guard, an unrouted one
        // gets Nest's "Cannot POST …" (the exception filter may not keep 404).
        const said = async (path: string) => {
          const r = await fetch(`${API_URL}${path}`, { method: 'POST' });
          return `${r.status} ${String((await r.json().catch(() => ({})))?.message ?? '')}`;
        };
        const probe = await said(`/trade-steps/${sendStep.id}/skip`);
        const live = await said(`/trade-steps/${sendStep.id}/complete`);
        (/Cannot POST/.test(probe) && !/Cannot POST/.test(live) ? pass : fail)('POST /trade-steps/:id/skip is not routed', `skip → ${probe}; complete → ${live}`);
      } catch (e) {
        fail('POST /trade-steps/:id/skip is not routed', `API not reachable at ${API_URL}: ${(e as Error).message}`);
      }

      {
        const md: any = await expectOk('"Mark done" on 5. Send documents & ask schedule (nothing to upload)', () => steps.complete(ORG_ID, sendStep.id, actor));
        (md?.status === 'DONE' ? pass : fail)('step 5 is DONE by hand', md?.status);
        await expectOk('reopen step 5', () => steps.reopen(ORG_ID, sendStep.id, actor));
      }
      await expectReject(
        'complete the shipment with steps still open (ADH numbers in the message)',
        () => shipments.complete(ORG_ID, shipment.id),
        /not done: 3b\. Receive shipping documents, 4\. Create customer documents/,
      );

      // ── B/L draft read (mocked) ───────────────────────────────────────────
      const blReply = (blNumber: string, grade: string) => ({
        blNumber,
        shippingLine: 'WAN HAI LINES LTD.',
        vessel: 'SMOKE VESSEL',
        voyageNo: '211E',
        etd: '2026-07-21',
        portOfLoading: 'VISAKHAPATNAM PORT, INDIA',
        portOfDischarge: 'YOKOHAMA, JAPAN',
        netWeight: 30112,
        grossWeight: 30250,
        weightUnit: 'KG',
        totalBundles: 12,
        totalPieces: 96,
        hsCode: '7601.20',
        countryOfOrigin: 'INDIA',
        commodity: `ALUMINIUM BILLET ALLOY ${grade}`,
        grade,
        sizeSpec: '203 MM X 5800 MM',
        containers: [{ containerNo: 'SMKU0000001', sealNo: 'S1', packages: 12, grossKg: 30250 }],
        // The org default minus its Tax ID line, as Vedanta's B/L prints it.
        consigneeText: (settingsNow.defaultConsignee ?? '')
          .split('\n')
          .filter((l) => !/^Tax ID/i.test(l))
          .join('\n'),
        notifyPartyText: settingsNow.defaultNotifyParty,
      });
      // a) "Extract / re-check" on the B/L draft uploaded for step 2 of the first shipment.
      replies.push(blReply(BL_NUMBER, '6063'));
      const recheck = await expectOk('re-check an uploaded B/L draft against its shipment (mock model)', () =>
        extract.extract(ORG_ID, 'BL_DRAFT', { fileId: uploaded.id, shipmentId: shipment.id }, actor),
      );
      const consignee = (recheck?.checks as any[] | null)?.find((c) => c.key === 'consignee');
      (consignee?.detail?.startsWith('Tax ID') && consignee.detail.includes('missing on B/L') ? pass : fail)('consignee check: Tax ID missing on the B/L', consignee?.detail);
      const shown = (await shipments.getById(ORG_ID, shipment.id)).blCheck;
      (shown && shown.issueCount > 0 && !shown.acknowledgedAt ? pass : fail)('shipment detail carries the B/L check', shown ? `${shown.issueCount} issue(s)` : 'none');
      const acked = await expectOk('acknowledge the B/L check', () => extract.acknowledge(ORG_ID, shown!.extractionId, actor));
      (acked?.acknowledgedAt && acked.acknowledgedByName === actor.name ? pass : fail)('acknowledged with who/when', acked?.acknowledgedByName ?? 'no');

      // b) Fill from B/L draft → a second shipment, saved with the PDF linked to step 2.
      const BL2 = 'TEST-198GX04631';
      replies.push(blReply(BL2, '6005'));
      const blX = await expectOk('read a B/L draft for a new shipment (mock model)', () => extract.extract(ORG_ID, 'BL_DRAFT', { file: pdfFile('SMOKE-BL2.pdf'), contractId: contract.id }, actor));
      const blRes = blX?.result as any;
      (blRes?.contractLineId === contract.lines[0].id && blRes.draft.netWeightMt === 30.112 && blRes.draft.containerCount === 1 ? pass : fail)(
        'B/L draft: line picked by grade 6005, KG → MT, container count',
        JSON.stringify({ line: blRes?.contractLineId, net: blRes?.draft?.netWeightMt }),
      );
      const ship2 = await expectOk('create shipment from the B/L draft', () =>
        orders.addShipment(ORG_ID, order.id, { contractLineId: blRes.contractLineId, blDraftFileId: blX!.fileId, blNumber: blRes.draft.blNumber, netWeightMt: blRes.draft.netWeightMt }, actor),
      );
      if (ship2) {
        const step2 = ship2.steps.find((s) => s.code === 'BL_DRAFT_APPROVAL');
        const link = ship2.fileLinks.find((l) => l.file.id === blX!.fileId);
        (link?.stepId === step2?.id && step2?.requirements?.[0]?.satisfied ? pass : fail)(
          'B/L draft linked to "3a. Approve B/L draft (Vedanta)" (requirement met)',
          JSON.stringify(step2?.requirements),
        );
        (ship2.blCheck?.extractionId === blX!.id ? pass : fail)('its B/L check is shown on the new shipment', ship2.blCheck ? `${ship2.blCheck.issueCount} issue(s)` : 'none');
        await expectOk('delete the second shipment', () => shipments.remove(ORG_ID, ship2.id));
        await expectOk('delete its B/L draft file (DB + S3, extraction rows cascade)', () => files.remove(ORG_ID, blX!.fileId));
      }
      // ── In-app documents: create blank → draft PDF → finalize → step satisfied ──
      const requirement = async (docType: string, owner: { shipmentId?: string; orderId?: string }) => {
        const rec: any = owner.shipmentId ? await shipments.getById(ORG_ID, owner.shipmentId) : await orders.getById(ORG_ID, owner.orderId!);
        const step = rec.steps.find((st: any) => st.requiredDocTypes.includes(docType));
        return { step, req: step?.requirements?.find((r: any) => r.docType === docType) };
      };
      const inApp = async (docType: string, owner: { shipmentId?: string; orderId?: string }) => {
        const g: any = await expectOk(`${docType}: create blank (prefilled)`, () => gen.createBlank(ORG_ID, { docType, ...owner }, actor));
        if (!g) return null;
        // Prefills: ADH's layouts and the org's document settings.
        const dd: any = settingsNow.docDefaults ?? {};
        const h0: any = g.header;
        const r0: any = (g.rows as any[])[0];
        if (docType === 'CUSTOMER_PL' || docType === 'CUSTOMER_COA')
          (h0.layout === 'jp' &&
            h0.toSuffix === '御中' &&
            h0.issuer?.name === (dd.customerDocIssuerName ?? h0.issuer?.name) &&
            h0.formLabel === (docType === 'CUSTOMER_PL' ? dd.customerPlFormLabel : dd.customerCoaFormLabel)
            ? pass
            : fail)(`${docType}: ADH Japanese layout (様式, 御中, issuer ${h0.issuer?.name})`, `${h0.title} / ${h0.formLabel}`);
        if (docType === 'CUSTOMER_PL' || docType === 'CUSTOMER_COA') {
          const want = jpParty({ name: customer.name, address: null, jpName: customer.jpName, jpAddress: customer.jpAddress, jpContact: customer.jpContact, docAddressee: (await config.profileOf(ORG_ID, customer.id)).docAddressee });
          (h0.to?.name === want.name && (h0.to?.address ?? null) === want.address && (h0.to?.contact ?? null) === want.contact ? pass : fail)(
            `${docType}: addressed to the customer's Japanese legal name + address + contact`,
            `${h0.to?.name} / ${h0.to?.address ?? '—'} / ${h0.to?.contact ?? '—'}`,
          );
        }
        if (docType === 'CUSTOMER_COA') (h0.analysisDate === '' ? pass : fail)('CUSTOMER_COA: analysis date is not defaulted to today (no dated COA PDF on the shipment)', String(h0.analysisDate));
        if (docType === 'SGJP_IV_PL')
          (h0.layout === 2 &&
            /^ADH\d{8}$/.test(h0.invoiceNo) &&
            h0.sellerBlock &&
            h0.consigneeBlock &&
            h0.shipperBlock &&
            (g.rows as any[]).length === 1 &&
            /Alloy 6063/.test(r0.goods) &&
            r0.terms === 'CIF'
            ? pass
            : fail)('SGJP_IV_PL: ADH layout — invoice no. ADH+yyyymmdd, Shipper / Consignee / Seller blocks, one item "… Alloy 6063 …" CIF', `${h0.invoiceNo} / ${r0.goods}`);
        if (docType === 'SHIPPING_INSTRUCTIONS') {
          const prof = (settingsNow.customerProfiles as any)?.[customer.id]?.deliveryProfile;
          const site = prof ?? (dd.deliveryProfiles ?? []).find((p: any) => customer.name.toLowerCase().includes(String(p.customerName).toLowerCase()));
          (h0.layout === 2 &&
            h0.title === '出庫・納入依頼書' &&
            h0.toName === siAddresseeOf(dd) &&
            h0.carrier === (dd.siCarrier ?? '') &&
            (!site || (r0.destination === site.siteName && h0.remarks.startsWith('指定荷卸し場→')))
            ? pass
            : fail)('SHIPPING_INSTRUCTIONS: 出庫・納入依頼書 to the warehouse, delivery profile → 納入先 + 備考', `${h0.toName} / ${r0.destination} / ${String(h0.remarks).split('\n')[0]}`);
        }
        if (docType === 'INVOICE_1' || docType === 'INVOICE_2') {
          (h0.toName === (customer.jpName || customer.name) ? pass : fail)(`${docType}: 請求書 addressed to the Japanese legal name (name only)`, h0.toName);
          const c: any = await orders.getById(ORG_ID, order.id);
          const want = defaultLmeMonth(docType, c.shipMonth);
          (h0.lmeMonth === want ? pass : fail)(
            `${docType}: LME month from the order's ship month (${docType === 'INVOICE_1' ? 'month before' : 'the month'}), never today`,
            `${h0.lmeMonth || '(blank)'} vs ${want || '(blank)'}; ship month ${c.shipMonth ?? '—'}`,
          );
        }
        if (docType === 'INVOICE_1') {
          const bankId = dd.defaultBankId ?? dd.banks?.[0]?.id ?? null;
          (h0.bankId === bankId && h0.showSeal === true && (!bankId || h0.bankBlock === dd.banks.find((b: any) => b.id === bankId)?.block) ? pass : fail)(
            'INVOICE_1: default bank account and seal on',
            `${h0.bankId}`,
          );
          const seal = await gen.sealFor(ORG_ID);
          (!seal || (await gen.previewHtml(docType, h0, [], g.rows, true, seal)).includes('class="seal"') ? pass : fail)(
            'INVOICE_1: the org seal prints beside the From block',
            seal ? 'seal set' : 'no seal in the settings',
          );
        }
        if (docType === 'INVOICE_2') {
          const rs = g.rows as any[];
          (h0.variant === 'final' && rs.length === 4 && rs[2].taxable === false && rs[3].unit === '式' && rs[3].quantity === 1 && typeof h0.invoice1Amount === 'number' ? pass : fail)(
            'INVOICE_2: final price + 通関、車輸送料 + 通関 (課税対象外) + 他諸掛 (1 式 = net × 40 USD/MT), １回目の金額 from Invoice #1',
            `${rs.length} lines, 1回目 ${h0.invoice1Amount}`,
          );
          (unitPriceOf(rs[0]) === null ? pass : fail)('INVOICE_2: no unit price until the LME is typed (not QMJP + premium)', String(unitPriceOf(rs[0])));
        }
        // Round 13: a blank Customer PL / COA / SI can't be finalized (the prod run finalized an empty COA).
        if (docType === 'CUSTOMER_PL' || docType === 'CUSTOMER_COA' || docType === 'SHIPPING_INSTRUCTIONS') {
          if (docType === 'CUSTOMER_COA') await gen.update(ORG_ID, g.id, { header: { ...g.header, analysisDate: '2026-07-22' } });
          await expectReject(`${docType}: finalize the blank document → refused, saying what is missing`, () => gen.finalize(ORG_ID, g.id, actor), /Can't finalize: .*(rows|row|bundle)/);
          if (docType === 'CUSTOMER_COA') await gen.update(ORG_ID, g.id, { header: g.header });
        }
        // What a user would type.
        let header = g.header;
        let rows = g.rows as any[];
        if (docType === 'CUSTOMER_PL') rows = [{ no: 1, batch: 'SMK1', container: 'SMKU0000001', netMt: 2.5, grossMt: 2.51 }];
        if (docType === 'CUSTOMER_COA') rows = [{ batch: 'SMK1', fe: '0.1500', bundles: 1, netwt: 2.5 }];
        if (docType === 'SGJP_IV_PL') rows = [{ ...rows[0], lme: 3155.98, qmjp: 395, premium: 230, quantity: 30.112, netMt: 30.112, grossMt: 30.2, bundles: 12, pieces: 60 }];
        if (docType === 'SHIPPING_INSTRUCTIONS') rows = [{ ...rows[0], shipDate: '2026-09-07', deliveryDate: '2026-09-08', bundles: 12 }];
        if (docType === 'INVOICE_1') rows = rows.map((l, i) => ({ ...l, lme: 3458.64, qmjp: 351.5, premium: i === 0 ? 190 : 230 }));
        if (docType === 'INVOICE_2')
          rows = [
            { ...rows[0], lme: 3155.98, qmjp: 395, premium: 230, quantity: 30.112 },
            { ...rows[1], unitPrice: 1650.4 },
            { ...rows[2], unitPrice: 74.21 },
            { ...rows[3], quantity: 1, unitPrice: 1204.48 }, // 他諸掛 = ROUNDDOWN(30.112 × 40, 2)
          ];
        await gen.update(ORG_ID, g.id, { header, rows });
        if (docType === 'CUSTOMER_PL') {
          await expectReject('CUSTOMER_PL: save a 5-digit year (72026) → refused', () => gen.update(ORG_ID, g.id, { header: { ...header, date: '72026-07-22' } }), /2000 and 2100/);
        }
        if (docType === 'CUSTOMER_COA') {
          await expectReject('CUSTOMER_COA: finalize without an analysis date → refused', () => gen.finalize(ORG_ID, g.id, actor), /analysis date/);
          header = { ...header, analysisDate: '2026-07-22' };
          await gen.update(ORG_ID, g.id, { header });
        }
        const draftPdf = await expectOk(`${docType}: download draft PDF`, () => gen.pdfFor(ORG_ID, g.id));
        const watermarked = (await gen.previewHtml(docType, header, g.columns, rows, true)).includes('class="wm"');
        (draftPdf && draftPdf.buffer.subarray(0, 4).toString() === '%PDF' && draftPdf.fileName.endsWith('-DRAFT.pdf') && !watermarked ? pass : fail)(
          `${docType}: draft PDF is a PDF, no DRAFT watermark`,
          `${draftPdf?.fileName} ${draftPdf ? Math.round(draftPdf.buffer.length / 1024) : 0} KB`,
        );
        const before = await requirement(docType, owner);
        const fin: any = await expectOk(`${docType}: finalize`, () => gen.finalize(ORG_ID, g.id, actor));
        if (!fin) return null;
        const after = await requirement(docType, owner);
        (!before.req?.satisfied && after.req?.satisfied ? pass : fail)(
          `${docType}: step "${after.step?.displayNo}. ${after.step?.title}" requirement met by the finalized document`,
          JSON.stringify(after.req),
        );
        const finalPdf = await gen.pdfFor(ORG_ID, g.id);
        (finalPdf.buffer.subarray(0, 4).toString() === '%PDF' && !finalPdf.fileName.includes('DRAFT') ? pass : fail)(`${docType}: Download PDF returns the stored final PDF`, finalPdf.fileName);
        if (fin.documentId) {
          const d = await prisma.document.findFirst({ where: { id: fin.documentId }, select: { name: true, status: true, type: true } });
          (d && d.type === 'INVOICE' && /^ADH-INV-\d{4}-\d{4}$/.test(d.name ?? '') && !['draft', 'unconfirmed'].includes(d.status) ? pass : fail)(
            `${docType}: Sales invoice created + confirmed with ADH numbering`,
            `${d?.name} ${d?.status}`,
          );
          if (docType === 'INVOICE_2') {
            const cfg: any = (await prisma.document.findFirst({ where: { id: fin.documentId }, select: { config: true } }))?.config;
            const t = invoiceTotals(toInvoiceLines(rows), header.taxRate, header.fxRate);
            const diff = roundTo(t.total - Number(header.invoice1Amount ?? 0), 2);
            (Number(cfg?.nettTotal) === diff && cfg?.items?.some((i: any) => String(i.description).startsWith('１回目の金額')) ? pass : fail)(
              'INVOICE_2: the Sales invoice is the ２回目の金額 (差額) — Invoice #1 deducted',
              `nettTotal ${cfg?.nettTotal} vs 合計 ${t.total} − 1回目 ${header.invoice1Amount} = ${diff}`,
            );
          }
        }
        return fin;
      };
      for (const dt of ['CUSTOMER_PL', 'CUSTOMER_COA', 'SGJP_IV_PL', 'SHIPPING_INSTRUCTIONS']) await inApp(dt, { shipmentId: shipment.id });
      {
        const due = await expectOk('請求書 due date endpoint', () => gen.dueDateFor(ORG_ID, '2026-10-05'));
        const days = Number((settingsNow.docDefaults as any)?.invoiceDueBusinessDays ?? 7);
        (days !== 7 || due?.dueDate === '2026-10-15' ? pass : fail)('due date = 7 JP business days (5 Oct 2026 → 15 Oct, Sports Day skipped)', `${due?.dueDate} (${days} days)`);
        await expectReject('due date for a 5-digit year → refused', () => gen.dueDateFor(ORG_ID, '72026-10-05'), /YYYY-MM-DD/);
        // Documents hub: Customer = the contract customer, Recipient = the warehouse; chip counts follow the Source filter.
        const hubSvc = new TradeHubService(prisma, config);
        const mine = await hubSvc.list(ORG_ID, { shipmentId: shipment.id, pageSize: '100' });
        const si = mine.items.find((r) => r.docType === 'SHIPPING_INSTRUCTIONS');
        (si && si.customerName === customer.name && si.recipient === siAddresseeOf(settingsNow.docDefaults as any) ? pass : fail)(
          'hub: SI row — Customer is the contract customer, Recipient the warehouse',
          `${si?.customerName} / ${si?.recipient}`,
        );
        const inApp2 = await hubSvc.list(ORG_ID, { shipmentId: shipment.id, source: 'IN_APP', pageSize: '100' });
        const sum = Object.values(inApp2.categoryCounts).reduce((a, b) => a + b, 0);
        (inApp2.allCount === inApp2.total && sum === inApp2.total && inApp2.items.every((r) => r.source === 'IN_APP') ? pass : fail)(
          'hub: category chip counts follow the Source filter',
          `all ${inApp2.allCount}, chips ${JSON.stringify(inApp2.categoryCounts)}, rows ${inApp2.total} (unfiltered ${mine.total})`,
        );
      }
      // Split arrival (先着 / 後着): a second SG→JP invoice on the same shipment needs its own number.
      {
        const sg2: any = await expectOk('SGJP_IV_PL: create a second one (split arrival)', () => gen.createBlank(ORG_ID, { docType: 'SGJP_IV_PL', shipmentId: shipment.id }, actor));
        if (sg2) {
          await gen.update(ORG_ID, sg2.id, { rows: [{ ...(sg2.rows as any[])[0], lme: 3249.63, qmjp: 395, premium: 230, quantity: 20.414, netMt: 20.414, bundles: 8, pieces: 40 }] });
          await expectReject('SGJP_IV_PL: finalize the second with the same invoice no.', () => gen.finalize(ORG_ID, sg2.id, actor), /already numbered/);
          await gen.update(ORG_ID, sg2.id, { header: { ...sg2.header, invoiceNo: `${sg2.header.invoiceNo}-2` } });
          const f2: any = await expectOk('SGJP_IV_PL: finalize the second with its own invoice no.', () => gen.finalize(ORG_ID, sg2.id, actor));
          const finals = await prisma.tradeGeneratedDoc.count({ where: { organizationId: ORG_ID, shipmentId: shipment.id, docType: 'SGJP_IV_PL', status: 'FINAL' } });
          (f2?.number === `${sg2.header.invoiceNo}-2` && finals === 2 ? pass : fail)('SGJP_IV_PL: two final SG→JP invoices on the shipment', `${finals} final, ${f2?.number}`);
        }
      }
      const inv1Doc: any = await inApp('INVOICE_1', { orderId: order.id });
      if (inv1Doc) {
        // Finalizing completed step 2 by itself, so "Edit again" needs the step reopened first.
        const inv1Step = (await orders.getById(ORG_ID, order.id)).steps.find((x: any) => x.code === 'INVOICE_1') as any;
        (inv1Step?.status === 'DONE' ? pass : fail)('INVOICE_1: finalize auto-completed "2. Issue and send Invoice #1"', inv1Step?.status);
        await expectReject('INVOICE_1: edit again while the step is done', () => gen.revert(ORG_ID, inv1Doc.id), /reopen/);
        if (inv1Step) await expectOk('INVOICE_1: reopen the step', () => steps.reopen(ORG_ID, inv1Step.id, actor));
        const rev: any = await expectOk('INVOICE_1: edit again (step reopened)', () => gen.revert(ORG_ID, inv1Doc.id));
        const d1 = await prisma.document.findFirst({ where: { id: inv1Doc.documentId }, select: { status: true } });
        (rev?.status === 'DRAFT' && d1?.status === 'unconfirmed' ? pass : fail)('INVOICE_1: back to draft, Sales invoice unconfirmed (stops counting)', d1?.status);
        const again: any = await expectOk('INVOICE_1: finalize again', () => gen.finalize(ORG_ID, inv1Doc.id, actor));
        {
          const hubRow = (await new TradeHubService(prisma, config).list(ORG_ID, { orderId: order.id, source: 'IN_APP', pageSize: '100' })).items.find((r) => r.id === inv1Doc.id);
          (hubRow && hubRow.links.some((l) => l.orderId === order.id) && hubRow.customerName === customer.name && hubRow.recipient === null ? pass : fail)(
            'hub: Invoice #1 row linked to its order, Customer = the customer, no Recipient',
            hubRow ? `${hubRow.links.map((l) => l.ref).join(',')} / ${hubRow.customerName}` : 'missing',
          );
        }
        (again?.number === inv1Doc.number ? pass : fail)('INVOICE_1: keeps its invoice number', `${inv1Doc.number} → ${again?.number}`);
        {
          const st = (await orders.getById(ORG_ID, order.id)).steps.find((x: any) => x.code === 'INVOICE_1') as any;
          (st?.status === 'DONE' && !st.holdOpen ? pass : fail)('INVOICE_1: finalizing again completes the reopened step (its document changed)', `${st?.status} hold=${st?.holdOpen}`);
        }
        // Invoice #2 after Invoice #1 is final: its １回目の金額 is what Invoice #1 billed the order, tax incl.
        const inv2Doc: any = await inApp('INVOICE_2', { shipmentId: shipment.id });
        if (inv2Doc) {
          const src = again ?? inv1Doc;
          const expected = invoiceTotals(toInvoiceLines(src.rows), Number((src.header as any).taxRate ?? 10), null).total;
          (Number((inv2Doc.header as any).invoice1Amount) === expected ? pass : fail)('INVOICE_2: １回目の金額 = the order\'s Invoice #1 total (tax incl.)', `${(inv2Doc.header as any).invoice1Amount} vs ${expected}`);
          (JSON.stringify(inv2Doc.coversShipmentIds) === JSON.stringify([shipment.id]) ? pass : fail)('INVOICE_2: covers its shipment', JSON.stringify(inv2Doc.coversShipmentIds));
          const cfg2: any = (await prisma.document.findFirst({ where: { id: inv2Doc.documentId }, select: { config: true } }))?.config;
          (cfg2?.tradeCovers === `#${order.orderNo}-${shipment.seqNo}` ? pass : fail)('Invoices tab "Covers": the Sales invoice says which shipment it bills', String(cfg2?.tradeCovers));
        }
        // Invoices tab → View: the Sales invoice resolves to its 請求書 (PDF + editor + contract link).
        const view: any = await expectOk('INVOICE_1: Invoices tab view resolves the 請求書 by Sales invoice', () => gen.byDocument(ORG_ID, inv1Doc.documentId));
        const cfg: any = (await prisma.document.findFirst({ where: { id: inv1Doc.documentId }, select: { config: true } }))?.config;
        (view?.id === inv1Doc.id && view.status === 'FINAL' && view.finalFileId && view.orders.some((o: any) => o.id === order.id) && cfg?.tradeGeneratedDocId === inv1Doc.id && cfg?.tradeCovers === `#${order.orderNo}` ? pass : fail)(
          'INVOICE_1: the list row carries tradeGeneratedDocId + Covers "#n"; the view has the final PDF and the order link',
          `${view?.number} orders=${view?.orders?.map((o: any) => o.label).join(',')} covers=${cfg?.tradeCovers}`,
        );
        const ship2Doc = await prisma.tradeGeneratedDoc.findFirst({ where: { organizationId: ORG_ID, shipmentId: shipment.id, docType: 'INVOICE_2' }, select: { documentId: true } });
        if (ship2Doc?.documentId) {
          const v2: any = await gen.byDocument(ORG_ID, ship2Doc.documentId);
          (v2.shipments.some((x: any) => x.id === shipment.id) && v2.orders.some((o: any) => o.id === order.id) ? pass : fail)(
            "INVOICE_2: the view links its shipment and that shipment's order",
            `${v2.number}`,
          );
        }
      }
      // ── Round 5–12: document IDs, hub search, COA pick, finalize block, A/N read ──
      {
        const seq = (await prisma.shipment.findFirst({ where: { id: shipment.id }, select: { seqNo: true } }))?.seqNo;
        // New format: "{yy}-{order no}-{shipment no}-{TYPE}" on a shipment, "{yy}-{order no}-{TYPE}" on the order.
        const P = `${String(ORDER_YEAR % 100).padStart(2, '0')}-${order.orderNo}`;
        (seq === 1 ? pass : fail)('doc IDs: shipments numbered within the order (the deleted #n-1 freed its number)', `${BL_NUMBER}=#${order.orderNo}-${seq}`);
        const blFile = await prisma.tradeFile.findFirst({ where: { id: uploaded.id }, select: { docRef: true } });
        (blFile?.docRef === `${P}-${seq}-BLD` ? pass : fail)('doc IDs: an uploaded B/L draft → {yy}-{order}-{shipment}-BLD', String(blFile?.docRef));
        if (piX?.fileId) {
          const pi = await prisma.tradeFile.findFirst({ where: { id: piX.fileId }, select: { docRef: true } });
          const so = await prisma.supplierOrder.findFirst({ where: { id: order.supplierOrderId }, select: { soNo: true } });
          (pi?.docRef === `${String(ORDER_YEAR % 100).padStart(2, '0')}-S${so?.soNo}-PI` ? pass : fail)('doc IDs: the PI on the supplier order → {yy}-S{n}-PI', String(pi?.docRef));
        }
        const gens = await prisma.tradeGeneratedDoc.findMany({ where: { organizationId: ORG_ID, OR: [{ shipmentId: shipment.id }, { orderId: order.id }] }, orderBy: { createdAt: 'asc' }, select: { docType: true, docRef: true, finalFileId: true } });
        const want: Record<string, string> = { CUSTOMER_PL: `${P}-${seq}-CPL`, CUSTOMER_COA: `${P}-${seq}-CCOA`, SHIPPING_INSTRUCTIONS: `${P}-${seq}-SI`, INVOICE_2: `${P}-${seq}-INV2`, INVOICE_1: `${P}-INV1` };
        const bad = gens.filter((g) => want[g.docType] && g.docRef !== want[g.docType]);
        const sgjp = gens.filter((g) => g.docType === 'SGJP_IV_PL').map((g) => g.docRef);
        (gens.length && !bad.length && sgjp[0] === `${P}-${seq}-SGJP` && sgjp[1] === `${P}-${seq}-SGJP-2` ? pass : fail)(
          'doc IDs: in-app documents (…-CPL, -CCOA, -SI, -INV2 on the shipment, -INV1 on the order; a second SG→JP → -SGJP-2)',
          gens.map((g) => g.docRef).join(', '),
        );
        const finalPdfs = await prisma.tradeFile.findMany({ where: { id: { in: gens.map((g) => g.finalFileId).filter(Boolean) as string[] } }, select: { id: true, docRef: true } });
        (finalPdfs.length && finalPdfs.every((f: any) => gens.some((g) => g.finalFileId === f.id && g.docRef === f.docRef)) ? pass : fail)('doc IDs: a finalized PDF carries its in-app document\'s ID', `${finalPdfs.length} PDF(s)`);
        const hubHit = await new TradeHubService(prisma, config).list(ORG_ID, { q: `${P}-${seq}-CPL`, pageSize: '20' });
        (hubHit.items.length >= 1 && hubHit.items.every((r) => r.docRef?.startsWith(`${P}-${seq}-CPL`)) ? pass : fail)('doc IDs: Documents hub search finds a document by its ID', `${hubHit.items.length} row(s)`);
        const fileHit = await files.list(ORG_ID, { q: `${P}-${seq}-BLD` } as any);
        (fileHit.items.some((f: any) => f.id === uploaded.id) ? pass : fail)('doc IDs: Files search finds a file by its ID', `${fileHit.items.length} row(s)`);
        const nullBefore = await prisma.tradeFile.count({ where: { organizationId: ORG_ID, docRef: null } });
        const dry = await expectOk('doc IDs: backfill dry run', () => backfillDocRefs(prisma, config, ORG_ID, false));
        const nullAfter = await prisma.tradeFile.count({ where: { organizationId: ORG_ID, docRef: null } });
        (dry && nullBefore === nullAfter ? pass : fail)('doc IDs: the dry run writes nothing', `${dry?.files ?? '?'} file(s) / ${dry?.generated ?? '?'} doc(s) would be numbered; untouched ${nullBefore} = ${nullAfter}`);

        // COA source auto-pick: the .XLS (summary) beats a PDF that is no summary.
        const coaXls = await expectOk('COA: upload a COA .XLS (tab-delimited)', () =>
          files.upload(ORG_ID, { originalname: 'COA.XLS', mimetype: 'application/vnd.ms-excel', size: COA_TSV.length, buffer: COA_TSV } as Express.Multer.File, { docType: 'COA', shipmentIds: [shipment.id] }, actor),
        );
        const coaPdf = await expectOk('COA: upload a COA PDF', () => files.upload(ORG_ID, pdfFile('COA_9000000000.pdf'), { docType: 'COA', shipmentIds: [shipment.id] }, actor));
        const srcs: any[] = (await expectOk('COA: ranked sources', () => gen.sources(ORG_ID, shipment.id, 'CUSTOMER_COA'))) ?? [];
        (srcs[0]?.id === coaXls?.id && srcs[0]?.best && /COA summary/.test(srcs[0]?.label) && srcs.some((x) => x.id === coaPdf?.id && !x.best) ? pass : fail)(
          'COA: the summary spreadsheet is picked first and labelled; the PDF goes under "Use a different file"',
          srcs.map((x) => `${x.fileName}: ${x.label}${x.best ? ' (best)' : ''}`).join(' | '),
        );
        for (const f of [coaXls, coaPdf]) if (f) await files.remove(ORG_ID, f.id);

        // Finalize block: an SG→JP invoice without its LME (and so a US$0 total) is refused, naming what is missing.
        const sg3: any = await expectOk('finalize block: create a third SG→JP invoice', () => gen.createBlank(ORG_ID, { docType: 'SGJP_IV_PL', shipmentId: shipment.id }, actor));
        if (sg3) {
          // Round 13: QMJP by quarter — the SG→JP takes the shipment month's quarter from the org table (2026-07 → 3Q).
          const q3 = (settingsNow.docDefaults as any)?.qmjpByQuarter?.['2026-3Q'];
          const prefilled = (sg3.rows as any[])[0]?.qmjp;
          (q3 === undefined || Number(prefilled) === Number(q3) ? pass : fail)('QMJP by quarter: SG→JP prefills the shipment month\'s quarter (2026-3Q), not Invoice #1\'s', `${prefilled} vs table ${q3 ?? '(no table on this org)'}`);
          await gen.update(ORG_ID, sg3.id, { rows: [{ ...(sg3.rows as any[])[0], lme: null, unitPrice: null, quantity: 10 }] });
          await expectReject('finalize block: SG→JP with no LME / US$0 total → refused, listing what is missing', () => gen.finalize(ORG_ID, sg3.id, actor), /Can't finalize: .*(LME|unit price).*US\$0\.00/);
          await gen.remove(ORG_ID, sg3.id);
        }

        // Round 13: Replace keeps the document ID; bulk classification (mocked model for the PDF, columns for the sheet).
        {
          const before = await prisma.tradeFile.findFirst({ where: { id: uploaded.id }, select: { docRef: true } });
          const rep: any = await expectOk('Replace: upload a replacement B/L draft', () =>
            files.upload(ORG_ID, pdfFile('BLD-replacement.pdf'), { docType: 'BL_DRAFT', shipmentIds: [shipment.id], replacesFileId: uploaded.id } as any, actor),
          );
          (rep && rep.docRef === before?.docRef ? pass : fail)('Replace keeps the document ID (no -2 counter)', `${before?.docRef} → ${rep?.docRef}`);
          if (rep) await files.remove(ORG_ID, rep.id);
          const step3 = ['BL', 'CI', 'PL', 'COA', 'COO', 'INSURANCE', 'OTHER'];
          replies.push({ docType: 'COO', variant: null, confidence: 0.93, reason: 'Certificate of origin' });
          const c1: any = await expectOk('bulk sort: classify a PDF (mock model)', () => extract.classify(ORG_ID, pdfFile('COO_9000000000.pdf'), step3));
          const c2: any = await expectOk('bulk sort: classify a spreadsheet', () =>
            extract.classify(ORG_ID, { originalname: 'COA.XLS', mimetype: 'application/vnd.ms-excel', size: COA_TSV.length, buffer: COA_TSV } as Express.Multer.File, step3),
          );
          (c1?.docType === 'COO' && c1.source === 'name+ai' && c2?.docType === 'COA' && c2.variant === 'COA summary' && c2.source === 'sheet' ? pass : fail)(
            'bulk sort: name + AI agree on the COO; COA.XLS sorted by its columns as the COA summary',
            `${c1?.docType}/${c1?.source} · ${c2?.docType}/${c2?.variant}/${c2?.source}`,
          );
        }

        // Arrival notice (mocked model reply): the draft and only the blank shipment fields are offered.
        replies.push({ blNumber: BL_NUMBER, vessel: 'WAN HAI 366', voyageNo: 'E049', eta: '2026-09-04', cyTerminal: 'BC鈴江', grossWeightKg: 307004, netWeightKg: 305804, totalBundles: 120, totalPieces: 600, containers: [{ containerNo: 'TEST1234567', sealNo: 'S1', size: '20SD86' }], charges: [{ code: 'THC', amount: 232800, currency: 'JPY', collect: true }] });
        const an: any = await expectOk('A/N: read an arrival notice dropped on its row (mock model)', () => extract.extract(ORG_ID, 'AN', { file: pdfFile('AN-smoke.pdf'), shipmentId: shipment.id }, actor));
        const cur: any = await prisma.shipment.findFirst({ where: { id: shipment.id } });
        const fill = an?.result?.fill ?? {};
        const offeredOnlyBlank = Object.keys(fill).every((k) => cur[k] === null || cur[k] === undefined || cur[k] === '');
        (an?.status === 'DONE' && an.result.draft.containerCount === 1 && an.result.draft.chargesCollect[0]?.amount === 232800 && offeredOnlyBlank && !an.result.blMismatch ? pass : fail)(
          'A/N: draft read (vessel, ETA, containers, charges collect); only blank fields offered',
          `fill ${JSON.stringify(fill)}`,
        );
        if (an?.fileId) {
          const anFile = await prisma.tradeFile.findFirst({ where: { id: an.fileId }, select: { docType: true, docRef: true } });
          (anFile?.docType === 'ARRIVAL_NOTICE' && anFile.docRef === `${P}-${seq}-AN` ? pass : fail)('A/N: stored as ARRIVAL_NOTICE with its doc ID', `${anFile?.docType} ${anFile?.docRef}`);
          await prisma.tradeExtraction.deleteMany({ where: { fileId: an.fileId } });
          await files.remove(ORG_ID, an.fileId);
        }
      }
      if (invoiceId) await expectOk('delete the throwaway invoice Document', () => prisma.document.delete({ where: { id: invoiceId!, organizationId: ORG_ID } }));
      // After the throwaway invoice is gone, so the INVOICE counter can go back to 1.
      await expectOk('remove the in-app documents, their PDFs and Sales invoices', () => purgeInApp(prisma, s3, order.id, [shipment.id]));
      // ── Auto-complete: the last step completes the shipment, the last shipment the deal; tabs ──
      {
        const others = await prisma.shipment.findMany({ where: { orderId: order.id, id: { not: shipment.id }, status: 'OPEN' }, select: { id: true } });
        await prisma.shipment.updateMany({ where: { id: { in: others.map((o: any) => o.id) } }, data: { status: 'CANCELLED' } });
        await prisma.tradeStep.updateMany({ where: { orderId: order.id, code: { not: 'XERO_HANDOFF' } }, data: { status: 'DONE', holdOpen: false } });
        await prisma.tradeStep.updateMany({ where: { shipmentId: shipment.id, code: { not: 'TAX_FUNDS' } }, data: { status: 'DONE', holdOpen: false } });
        const last = await prisma.tradeStep.findFirst({ where: { shipmentId: shipment.id, code: 'TAX_FUNDS' }, select: { id: true } });
        const xero = await prisma.tradeStep.findFirst({ where: { orderId: order.id, code: 'XERO_HANDOFF' }, select: { id: true } });
        const pendingBefore = await orders.list(ORG_ID, { bucket: 'pending', q: `#${order.orderNo}` } as any);
        (pendingBefore.items.some((x: any) => x.id === order.id) ? pass : fail)('Orders tabs: an open order is under Pending', JSON.stringify(pendingBefore.counts));
        if (last) await expectOk('auto-complete: "Mark done" on the shipment\'s last open step (8. import-tax funds)', () => steps.complete(ORG_ID, last.id, actor));
        const sNow = await prisma.shipment.findFirst({ where: { id: shipment.id }, select: { status: true } });
        const oMid = await prisma.tradeOrder.findFirst({ where: { id: order.id }, select: { status: true } });
        (sNow?.status === 'COMPLETED' ? pass : fail)('auto-complete: all steps done → the shipment completes', String(sNow?.status));
        (oMid?.status === 'OPEN' ? pass : fail)('the order stays open while its step 13 is open', String(oMid?.status));
        if (xero) await expectOk('auto-complete: "Mark done" 13. Prepare data for Xero reconciliation', () => steps.complete(ORG_ID, xero.id, actor));
        const oNow0 = await prisma.tradeOrder.findFirst({ where: { id: order.id }, select: { status: true } });
        (oNow0?.status === 'COMPLETED' ? pass : fail)('auto-complete: order steps done + every shipment complete → the order completes', String(oNow0?.status));
        const done = await orders.list(ORG_ID, { bucket: 'completed', q: `#${order.orderNo}` } as any);
        (done.items.some((x: any) => x.id === order.id && x.shipments.some((sh: any) => sh.id === shipment.id && sh.ref === `#${order.orderNo}-${shipment.seqNo}`)) ? pass : fail)(
          'Orders tabs: the completed order moves to Completed; its row lists the shipment #n-k',
          JSON.stringify(done.counts),
        );
      }
      await expectReject('delete the contract while it has an order', () => contracts.remove(ORG_ID, contract.id), /order/);

      // Reopening a shipment whose order is COMPLETED reopens the order too.
      await prisma.shipment.update({ where: { id: shipment.id }, data: { status: 'COMPLETED' } });
      const reopened: any = await expectOk('reopen the shipment under a completed order', () => shipments.reopen(ORG_ID, shipment.id));
      const oNow = await prisma.tradeOrder.findFirst({ where: { id: order.id }, select: { status: true } });
      (reopened?.status === 'OPEN' && reopened?.reopenedContract === `#${order.orderNo}` && oNow?.status === 'OPEN' ? pass : fail)(
        'the completed order is reopened with it (reported for the toast)',
        `shipment ${reopened?.status}, order ${oNow?.status}, reopened ${reopened?.reopenedContract}`,
      );

      // Cleanup path through the services: reopen the step, then the file may go.
      await expectOk('reopen BL_DRAFT_APPROVAL', () => steps.reopen(ORG_ID, blStep.id, actor));
      // Steps that completed themselves earlier lost their documents in the purge above: reopen them too.
      for (const st of (await shipments.getById(ORG_ID, shipment.id)).steps.filter((x: any) => x.status === 'DONE')) await steps.reopen(ORG_ID, st.id, actor);
      await expectOk('delete the file (DB + S3)', () => files.remove(ORG_ID, uploaded.id));
      await expectOk('delete the shipment', () => shipments.remove(ORG_ID, shipment.id));
      for (const st of ((await orders.getById(ORG_ID, order.id)).steps as any[]).filter((x: any) => x.status === 'DONE')) await steps.reopen(ORG_ID, st.id, actor).catch(() => undefined);
      if (piX?.fileId) await prisma.tradeFileLink.deleteMany({ where: { organizationId: ORG_ID, fileId: piX.fileId, orderId: order.id } });
      await expectOk('delete the order', () => orders.remove(ORG_ID, order.id));
      await expectOk('delete the contract', () => contracts.remove(ORG_ID, contract.id));
      if (piX?.fileId) await expectOk('delete the PI file (DB + S3)', () => files.remove(ORG_ID, piX.fileId));
      contractId = null;

      // ── Orders round: two shipments on one Invoice #2, Kato SINGLE flow, estimator, reconciliation ──
      await orderCases({ prisma, s3, config, orders, contracts, shipments, steps, files, gen, customer, supplier });

      // ── Round E: declaration → supplier + customer orders; one payment over two PIs ──
      await roundECases({ prisma, s3, orders, contracts, supplierOrders: new SupplierOrdersService(prisma, config, orders), payments: new TradePaymentsService(prisma), customer, supplier });
    } finally {
      if (contractId) {
        console.log('\n⚠ Run stopped early — removing what it created');
        await cleanup(prisma, s3, contractId);
      }
    }
  });

  if (results.length) {
    console.log('\nResults:');
    for (const r of results) console.log(`  ${r.ok ? '✅' : '❌'} ${r.check}${r.detail ? ` — ${r.detail}` : ''}`);
    const failed = results.filter((r) => !r.ok).length;
    console.log(`\n${results.length - failed}/${results.length} checks passed`);
    if (failed) process.exitCode = 1;
  }
}

/**
 * Orders round (2026-10): an order with 2 shipments → one Invoice #2 covering
 * both (step 11 done on each); a Kato (SINGLE billing) order — Invoice #1 N/A,
 * import permit not sent, INVOICE_SINGLE only once the B/L and CI are in, the
 * sample's figures (40.825 t, FX 159 → US$176,050.94); the estimator on a
 * shipment; the step 13 reconciliation (profit = d − a − b − c).
 */
async function orderCases(x: any) {
  const { prisma, config, orders, contracts, shipments, steps, files, gen, customer, supplier } = x;
  const pdf = (name: string) => ({ originalname: name, mimetype: 'application/pdf', size: DUMMY_PDF.length, buffer: DUMMY_PDF }) as Express.Multer.File;
  // A: SUS, two B/Ls under one order, one Invoice #2.
  const cA: any = await expectOk('orders: contract (LTC) for the two-shipment order', () =>
    contracts.create(ORG_ID, { contractNo: CONTRACT_NO, supplierId: supplier.id, customerId: customer.id, lines: [{ grade: '6063', product: 'Aluminium Billet', sizeSpec: '203 MM X 5800 MM', quantityMt: 300, billetPremium: 230 }] }, actor),
  );
  if (!cA) return;
  const oA: any = await expectOk('orders: order with client premium from the contract line', () => orders.create(ORG_ID, { year: ORDER_YEAR, contractId: cA.id, shipMonth: '2026-07', deliveryMonth: '2026-09', grade: '6063', qtyMt: 300 }, actor));
  if (!oA) return;
  (Number(oA.clientPremium) === 230 ? pass : fail)('orders: client premium defaults from the contract line (230)', String(oA.clientPremium));
  const a: any = await expectOk('orders: shipment #n-1', () => orders.addShipment(ORG_ID, oA.id, { blNumber: 'TEST-SM-A', netWeightMt: 262.45, grossWeightMt: 263.48 }, actor));
  const b: any = await expectOk('orders: shipment #n-2', () => orders.addShipment(ORG_ID, oA.id, { blNumber: 'TEST-SM-B', netWeightMt: 40.775, grossWeightMt: 41.0 }, actor));
  if (!a || !b) return;
  (a.ref === `#${oA.orderNo}-1` && b.ref === `#${oA.orderNo}-2` ? pass : fail)('orders: shipments numbered #n-1, #n-2', `${a.ref}, ${b.ref}`);
  // Estimator on #n-1 (262.45 MT net / 263.48 gross): customs ¥808,346, 13 trucks → ¥1,401,400.
  {
    const est: any = (await shipments.update(ORG_ID, a.id, { costs: { thc: 540000, docFee: 6000, equipmentFee: 27000, cifUsd: 1156238.8, fxRate: 159 } } as any, actor)).estimate;
    (est?.customs === 808346 && est.trucks === 13 && est.trucking === 13 * 107800 && est.customsTotal === 808346 + 11800 + 573000 && est.importTax.estimate === 18386700 ? pass : fail)(
      'estimator: #9-1 numbers — customs ¥808,346, 13 trucks, est. 通関・車輸送, import tax ¥18,386,700 at 159.00',
      JSON.stringify({ customs: est?.customs, trucks: est?.trucks, trucking: est?.trucking, total: est?.customsTotal, tax: est?.importTax?.estimate }),
    );
  }
  const inv2: any = await expectOk('Invoice #2 covering #n-1 + #n-2', () => gen.createBlank(ORG_ID, { docType: 'INVOICE_2', shipmentId: a.id, coversShipmentIds: [a.id, b.id] }, actor));
  if (inv2) {
    const rows = inv2.rows as any[];
    (JSON.stringify(inv2.coversShipmentIds) === JSON.stringify([a.id, b.id]) && rows.length === 5 && rows[0].quantity === 262.45 && rows[1].quantity === 40.775 && Number(rows[0].premium) === 230 ? pass : fail)(
      'Invoice #2: a final-price line per covered shipment + the three cost lines',
      `${rows.length} lines; qty ${rows[0].quantity} + ${rows[1].quantity}`,
    );
    const priced = rows.map((l: any, i: number) => (i < 2 ? { ...l, lme: 3155.98 } : i === 2 ? { ...l, unitPrice: 1650.4 } : i === 3 ? { ...l, unitPrice: 74.21 } : { ...l, unitPrice: roundTo(303.225 * 40, 2) }));
    await gen.update(ORG_ID, inv2.id, { rows: priced });
    const fin: any = await expectOk('Invoice #2 (two shipments): finalize', () => gen.finalize(ORG_ID, inv2.id, actor));
    if (fin) {
      const sa: any = await shipments.getById(ORG_ID, a.id);
      const sb: any = await shipments.getById(ORG_ID, b.id);
      const done = (sh: any) => sh.steps.find((st: any) => st.code === 'INVOICE_2')?.status;
      (done(sa) === 'DONE' && done(sb) === 'DONE' ? pass : fail)('finalizing the Invoice #2 completes step 11 on BOTH covered shipments', `${done(sa)} / ${done(sb)}`);
      const cfg: any = (await prisma.document.findFirst({ where: { id: fin.documentId }, select: { config: true } }))?.config;
      (cfg?.tradeCovers === `#${oA.orderNo}-1, #${oA.orderNo}-2` ? pass : fail)('Invoices tab "Covers": #n-1, #n-2', String(cfg?.tradeCovers));
      const uninvoiced = await shipments.list(ORG_ID, { uninvoiced: 'true', customerId: customer.id, pageSize: '100' } as any);
      (!uninvoiced.items.some((x: any) => x.id === a.id || x.id === b.id) ? pass : fail)('covered shipments drop out of the "not yet invoiced" picker', `${uninvoiced.items.length} left`);
      await expectReject('a second Invoice #2 for an already invoiced shipment is refused', () => gen.createBlank(ORG_ID, { docType: 'INVOICE_2', shipmentId: b.id }, actor), /Already invoiced/);
      // Step 13: profit = d − a − b − c on this order's own documents.
      const rec0: any = await orders.updateReconciliation(ORG_ID, oA.id, { piPaid: 120958.5, ciPaid: 1027635.21, otherCostsUsd: 1000 });
      const tot = invoiceTotals(toInvoiceLines(priced), Number(fin.header?.taxRate ?? 10), null, 'final').total;
      (rec0.d === tot && rec0.profit === roundTo(tot - 120958.5 - 1027635.21 - 1000, 2) ? pass : fail)('reconciliation: d = the Invoice #2 total, profit = d − a − b − c', `d ${rec0.d} profit ${rec0.profit}`);
      // Back to draft so the covered steps can be cleaned.
      for (const sh of [sa, sb]) {
        const st = sh.steps.find((y: any) => y.code === 'INVOICE_2');
        if (st) await steps.reopen(ORG_ID, st.id, actor);
      }
    }
  }
  // B: Kato — SINGLE billing.
  const kato = await prisma.customer.findFirst({ where: { organizationId: ORG_ID, name: { startsWith: 'Kato' } }, select: { id: true, name: true } });
  const profile = kato ? await config.profileOf(ORG_ID, kato.id) : null;
  if (!kato || profile?.billingMode !== 'SINGLE') {
    fail('Kato SINGLE flow', 'Kato customer / SINGLE profile missing — run setup-adh-org.ts');
  } else {
    const cK: any = await expectOk('Kato: contract 454003598-like (6005, premium 285)', () =>
      contracts.create(ORG_ID, { contractNo: KATO_CONTRACT_NO, supplierId: supplier.id, customerId: kato.id, lines: [{ grade: '6005', product: 'Aluminium Billet', sizeSpec: '203 MM X 5800 MM', quantityMt: 40, billetPremium: 285 }] }, actor),
    );
    const oK: any = cK ? await expectOk('Kato: order (Sep 26 → Nov 26, 6005 40 MT)', () => orders.create(ORG_ID, { year: ORDER_YEAR, contractId: cK.id, shipMonth: '2026-07', deliveryMonth: '2026-11', grade: '6005', qtyMt: 40 }, actor)) : null;
    if (oK) {
      const inv1 = oK.steps.find((st: any) => st.code === 'INVOICE_1');
      (inv1?.notApplicable && oK.progress.total === 3 ? pass : fail)('Kato: step 2 Invoice #1 is N/A (customer profile) and not counted', `${inv1?.notApplicable} ${JSON.stringify(oK.progress)}`);
      const k: any = await expectOk('Kato: shipment #n-1', () => orders.addShipment(ORG_ID, oK.id, { blNumber: 'TEST-SM-K', netWeightMt: 40.825, grossWeightMt: 41.2 }, actor));
      if (k) {
        const s11 = k.steps.find((st: any) => st.code === 'INVOICE_2');
        const s10 = k.steps.find((st: any) => st.code === 'IMPORT_PERMIT');
        (s11?.title === 'Issue invoice (single)' && JSON.stringify(s11.requiredDocTypes) === '["INVOICE_SINGLE"]' && s10?.subtasks?.[0]?.na === true ? pass : fail)(
          'Kato: step 11 issues INVOICE_SINGLE; step 10 "send to customer" is N/A',
          `${s11?.title} ${JSON.stringify(s11?.requiredDocTypes)} ${JSON.stringify(s10?.subtasks)}`,
        );
        await expectReject('Kato: single invoice before the B/L and CI are in → refused', () => gen.createBlank(ORG_ID, { docType: 'INVOICE_SINGLE', shipmentId: k.id }, actor), /B\/L and CI/);
        await files.upload(ORG_ID, pdf('KATO-BL.pdf'), { docType: 'BL', shipmentIds: [k.id] }, actor);
        await files.upload(ORG_ID, pdf('KATO-CI.pdf'), { docType: 'CI', shipmentIds: [k.id] }, actor);
        await shipments.update(ORG_ID, k.id, { costs: { thc: 78000 } } as any, actor);
        const g: any = await expectOk('Kato: create the single invoice (no import permit needed)', () => gen.createBlank(ORG_ID, { docType: 'INVOICE_SINGLE', shipmentId: k.id }, actor));
        if (g) {
          const rs = g.rows as any[];
          (rs.length === 4 && rs[1].jpyAmount === 206062.5 && rs[2].jpyAmount === 89800 && rs[3].unitPrice === 40 && Number(rs[0].premium) === 285 && Number(rs[0].qmjp) === 395 ? pass : fail)(
            'INVOICE_SINGLE prefill: 通関、車輸送料 ¥206,062.5 (40.825 × 2,300 + 4 trucks × 26,000 + 40.825 × 200), 通関 ¥89,800, 他諸掛 40/MT, premium 285, QMJP 3Q 395',
            JSON.stringify(rs.map((l) => l.jpyAmount ?? l.unitPrice ?? l.premium)),
          );
          (/\d{4}-\d{2}-\d{2}/.test(g.header.dueDate) && g.header.subject.includes('6005') ? pass : fail)('INVOICE_SINGLE header: 件名, due date (5 business days)', `${g.header.subject} / ${g.header.dueDate}`);
          await gen.update(ORG_ID, g.id, { header: { ...g.header, fxRate: 159 }, rows: [{ ...rs[0], lme: 3155.98 }, ...rs.slice(1)] });
          const fin: any = await expectOk('Kato: finalize the single invoice', () => gen.finalize(ORG_ID, g.id, actor));
          if (fin) {
            const cfg: any = (await prisma.document.findFirst({ where: { id: fin.documentId }, select: { config: true } }))?.config;
            (Number(cfg?.nettTotal) === 176050.94 ? pass : fail)('INVOICE_SINGLE total US$176,050.94 (the Kato sample)', String(cfg?.nettTotal));
            const sk: any = await shipments.getById(ORG_ID, k.id);
            (sk.steps.find((st: any) => st.code === 'INVOICE_2')?.status === 'DONE' ? pass : fail)('Kato: step 11 done by the single invoice', '');
            const st = sk.steps.find((y: any) => y.code === 'INVOICE_2');
            if (st) await steps.reopen(ORG_ID, st.id, actor);
          }
        }
        const cpl: any = await files.upload(ORG_ID, pdf('PACKING_LIST_CONTAINER_TEST.pdf'), { docType: 'PL', shipmentIds: [k.id] }, actor);
        const pl: any = await expectOk('Kato: Customer PL uses the Kato template (container-PL page as the body)', () => gen.createBlank(ORG_ID, { docType: 'CUSTOMER_PL', shipmentId: k.id }, actor));
        (pl?.templateKey === 'CUSTOMER_PL_KATO' && pl.header.bodyMode === 'attach' && pl.header.attachFileId === cpl?.id ? pass : fail)('Kato: CUSTOMER_PL_KATO, body = the container PL page', `${pl?.templateKey} ${pl?.header?.bodyMode}`);
        if (pl) {
          const html = await gen.previewHtml('CUSTOMER_PL', pl.header, pl.columns, pl.rows, true, null, ORG_ID);
          (/<img src="data:image\/png;base64,/.test(html) ? pass : fail)('Kato: the PL page is rendered into the 計量検収票 frame', html.includes('frame') ? 'frame' : 'no frame');
        }
      }
    }
  }
  // Clean up this round (documents, files, shipments, orders, contracts).
  await expectOk('orders round: clean up (documents, files, shipments, orders, contracts)', () => cleanup(prisma, x.s3, null));
}

/**
 * Round E (2026-10): the monthly declaration — two rows on one contract → two
 * supplier orders, each with one customer order (ship = the month, delivery
 * +2, premiums from the contract's schedule); one OUT payment split over the
 * two PIs marks both deposits paid and shows on each order's cash view.
 */
async function roundECases(x: any) {
  const { prisma, orders, contracts, supplierOrders, payments, customer, supplier } = x;
  const c: any = await expectOk('round E: contract with a premium schedule', () =>
    contracts.create(
      ORG_ID,
      {
        contractNo: CONTRACT_NO,
        supplierId: supplier.id,
        customerId: customer.id,
        grade: '6063',
        premiumSchedule: [{ from: '2026-06', to: null, supplierPremium: 205, clientPremium: 230, upcharge: null }],
        lines: [{ grade: '6063', product: 'Aluminium Billet', sizeSpec: '203 MM X 5800 MM', quantityMt: 3600, billetPremium: 230 }],
      },
      actor,
    ),
  );
  if (!c) return;
  const decl: any = await expectOk('round E: declare Aug — two rows (300 t, 40 t)', () =>
    supplierOrders.declare(
      ORG_ID,
      {
        month: '2026-08',
        year: ORDER_YEAR,
        qpBasis: "Average LME of MOSS (Aug'26)",
        rows: [
          { customerId: customer.id, contractId: c.id, qtyMt: 300, piNo: 'SMOKE-PI-E1' },
          { customerId: customer.id, contractId: c.id, qtyMt: 40, piNo: 'SMOKE-PI-E2' },
        ],
      },
      actor,
    ),
  );
  if (!decl) return;
  const made: any[] = await prisma.tradeOrder.findMany({
    where: { organizationId: ORG_ID, id: { in: decl.created.map((r: any) => r.orderId) } },
    select: { id: true, supplierOrderId: true, shipMonth: true, deliveryMonth: true, qtyMt: true, clientPremium: true, supplierPremium: true, supplierOrder: { select: { declarationMonth: true, piNo: true, year: true } } },
    orderBy: { orderNo: 'asc' },
  });
  (made.length === 2 && made.every((o, i) => o.supplierOrderId === decl.created[i].supplierOrderId && o.supplierOrder.year === ORDER_YEAR && o.supplierOrder.declarationMonth === '2026-08') ? pass : fail)(
    'declaration: one supplier order + one customer order per row, linked',
    made.map((o) => `${o.supplierOrder?.piNo} → ${o.id.slice(0, 8)}`).join(', '),
  );
  (made.every((o) => o.shipMonth === '2026-08' && o.deliveryMonth === '2026-10' && Number(o.clientPremium) === 230 && Number(o.supplierPremium) === 205) ? pass : fail)(
    'declaration: ship = Aug, delivery = Oct (+2), premiums from the schedule (230 / 205)',
    made.map((o) => `${o.shipMonth}/${o.deliveryMonth} ${o.clientPremium}/${o.supplierPremium}`).join(', '),
  );
  await expectReject(
    'declaration: a bad row creates nothing',
    () => supplierOrders.declare(ORG_ID, { month: '2026-08', year: ORDER_YEAR, rows: [{ customerId: customer.id, contractId: c.id, qtyMt: 10 }, { customerId: customer.id, contractId: '00000000-0000-0000-0000-000000000000', qtyMt: 10 }] }, actor),
    /Row 2: contract not found/,
  );
  const soCount = await prisma.supplierOrder.count({ where: { organizationId: ORG_ID, year: ORDER_YEAR } });
  (soCount === 2 ? pass : fail)('declaration: the refused one left no supplier order behind', `${soCount}`);
  const [so1, so2] = decl.created.map((r: any) => r.supplierOrderId);
  const pay: any = await expectOk('round E: one OUT payment over the two PIs (USD 44,358.72 + 112,186.80)', () =>
    payments.create(
      ORG_ID,
      {
        direction: 'OUT',
        paidAt: '2026-08-05',
        amount: 156545.52,
        currency: 'USD',
        account: 'WISE',
        allocations: [
          { targetType: 'PI', targetId: so1, amount: 44358.72 },
          { targetType: 'PI', targetId: so2, amount: 112186.8 },
        ],
      },
      actor,
    ),
  );
  if (pay) {
    const paid = await prisma.supplierOrder.findMany({ where: { id: { in: [so1, so2] } }, select: { depositPaidAt: true } });
    (paid.every((s: any) => s.depositPaidAt?.toISOString().slice(0, 10) === '2026-08-05') ? pass : fail)('payment: both PI deposits marked paid on 05/08/2026', paid.map((s: any) => s.depositPaidAt?.toISOString().slice(0, 10)).join(', '));
    const cash: any = await payments.forOrder(ORG_ID, made[0].id);
    (JSON.stringify(cash).includes('44358.72') ? pass : fail)("payment: the first order's cash view shows its PI part", JSON.stringify(cash).slice(0, 160));
    await expectReject(
      'payment: allocations over the amount are refused',
      () => payments.update(ORG_ID, pay.id, { amount: 100 }),
      /more than the payment/,
    );
    await expectOk('round E: delete the payment', () => payments.remove(ORG_ID, pay.id));
  }
  for (const o of made) await expectOk('round E: delete the order', () => orders.remove(ORG_ID, o.id));
  for (const id of [so1, so2]) await expectOk('round E: delete the supplier order', () => supplierOrders.remove(ORG_ID, id));
  await expectOk('round E: delete the contract', () => contracts.remove(ORG_ID, c.id));
}

/** Remove the smoke contract, its shipments, their steps/links, and the files (DB + S3) only they used. */
/**
 * In-app documents of the smoke records: the Sales invoices behind ADH 請求書
 * (plus their audit / timeline rows and links), every PDF the smoke actor
 * stored on these records (DB + S3), and the INVOICE counter back to where it
 * was before the run (the org may keep real / demo invoices — the smoke must
 * not leave a gap in their numbering), else to 1 when no invoice is left.
 */
async function purgeInApp(prisma: any, s3: S3Service, orderId: string | null, shipmentIds: string[]) {
  const owners = [...(orderId ? [{ orderId }] : []), ...shipmentIds.map((shipmentId) => ({ shipmentId }))];
  if (!owners.length) return;
  const generated = await prisma.tradeGeneratedDoc.findMany({ where: { organizationId: ORG_ID, OR: owners }, select: { id: true, documentId: true } });
  const docIds = generated.map((g: { documentId: string | null }) => g.documentId).filter(Boolean) as string[];
  if (docIds.length) {
    for (const m of ['timelineItem', 'documentItem', 'priceHistory']) await prisma[m]?.deleteMany({ where: { documentId: { in: docIds } } }).catch(() => undefined);
    await prisma.auditLog.deleteMany({ where: { resourceId: { in: docIds } } }).catch(() => undefined);
    await prisma.tradeDocumentLink.deleteMany({ where: { organizationId: ORG_ID, documentId: { in: docIds } } });
    await prisma.document.deleteMany({ where: { organizationId: ORG_ID, id: { in: docIds } } });
  }
  await prisma.tradeGeneratedDoc.deleteMany({ where: { organizationId: ORG_ID, OR: owners } });
  const links = await prisma.tradeFileLink.findMany({ where: { organizationId: ORG_ID, OR: owners }, select: { fileId: true } });
  const pdfs = await prisma.tradeFile.findMany({
    where: { organizationId: ORG_ID, id: { in: links.map((l: { fileId: string }) => l.fileId) }, uploadedById: actor.id, notes: 'Created in-app' },
    select: { id: true, s3Key: true },
  });
  for (const f of pdfs) {
    await prisma.tradeFile.delete({ where: { id: f.id } });
    await s3.deleteFile(f.s3Key).catch(() => undefined);
  }
  const left = await prisma.document.count({ where: { organizationId: ORG_ID, type: 'INVOICE' } });
  if (numberingBefore && left === numberingBefore.invoices) {
    await prisma.documentNumberFormat.update({ where: { id: numberingBefore.id }, data: { nextSerial: numberingBefore.nextSerial, lastResetKey: numberingBefore.lastResetKey } });
  } else if (!left) {
    await prisma.documentNumberFormat.updateMany({ where: { organizationId: ORG_ID, documentType: 'INVOICE' }, data: { nextSerial: 1, lastResetKey: null } });
  }
}

/** The INVOICE counter + invoice count before the run (restored by purgeInApp). */
let numberingBefore: { id: string; nextSerial: number; lastResetKey: string | null; invoices: number } | null = null;

async function cleanup(prisma: any, s3: S3Service, contractId: string | null) {
  const contract = contractId ? { id: contractId } : await prisma.contract.findFirst({ where: { organizationId: ORG_ID, contractNo: CONTRACT_NO }, select: { id: true } });
  const smokeOrders: Array<{ id: string }> = await prisma.tradeOrder.findMany({ where: { organizationId: ORG_ID, year: ORDER_YEAR }, select: { id: true } });
  const orderIds = smokeOrders.map((o) => o.id);
  const ships = await prisma.shipment.findMany({
    where: { organizationId: ORG_ID, OR: [{ blNumber: { startsWith: 'TEST-' } }, { orderId: { in: orderIds } }, ...(contract ? [{ contractId: contract.id }] : [])] },
    select: { id: true },
  });
  const shipIds = ships.map((s: { id: string }) => s.id);
  for (const oid of orderIds) await purgeInApp(prisma, s3, oid, []);
  await purgeInApp(prisma, s3, null, shipIds);
  const links = await prisma.tradeFileLink.findMany({
    where: { organizationId: ORG_ID, OR: [{ shipmentId: { in: shipIds } }, { orderId: { in: orderIds } }, ...(contract ? [{ contractId: contract.id }] : [])] },
    select: { fileId: true },
  });
  const fileIds = [...new Set(links.map((l: { fileId: string }) => l.fileId))];
  // The smoke's files on its records, plus any of its files left unlinked by an aborted run.
  const smokeFiles = await prisma.tradeFile.findMany({
    where: { organizationId: ORG_ID, uploadedById: actor.id, OR: [{ id: { in: fileIds } }, { links: { none: {} } }] },
    select: { id: true, s3Key: true, thumbKey: true },
  });
  for (const f of smokeFiles) {
    await prisma.tradeExtraction.deleteMany({ where: { organizationId: ORG_ID, fileId: f.id } });
    await prisma.tradeFile.delete({ where: { id: f.id, organizationId: ORG_ID } });
    await s3.deleteFile(f.s3Key).catch((e: Error) => console.warn(`  S3 delete failed for ${f.s3Key}: ${e.message}`));
    if (f.thumbKey) await s3.deleteFile(f.thumbKey).catch(() => undefined);
  }
  if (shipIds.length) await prisma.shipment.deleteMany({ where: { organizationId: ORG_ID, id: { in: shipIds } } });
  if (orderIds.length) await prisma.tradeOrder.deleteMany({ where: { organizationId: ORG_ID, id: { in: orderIds } } });
  // Round E: the supplier orders the smoke orders made (same year), with their files / payments / alerts.
  const sos: Array<{ id: string }> = await prisma.supplierOrder.findMany({ where: { organizationId: ORG_ID, year: ORDER_YEAR }, select: { id: true } });
  if (sos.length) {
    const soIds = sos.map((x) => x.id);
    const soLinks = await prisma.tradeFileLink.findMany({ where: { organizationId: ORG_ID, supplierOrderId: { in: soIds } }, select: { fileId: true } });
    const soFiles = await prisma.tradeFile.findMany({ where: { organizationId: ORG_ID, uploadedById: actor.id, id: { in: soLinks.map((l: { fileId: string }) => l.fileId) } }, select: { id: true, s3Key: true } });
    for (const f of soFiles) {
      await prisma.tradeExtraction.deleteMany({ where: { organizationId: ORG_ID, fileId: f.id } });
      await prisma.tradeFile.delete({ where: { id: f.id } });
      await s3.deleteFile(f.s3Key).catch(() => undefined);
    }
    await prisma.supplierOrder.deleteMany({ where: { organizationId: ORG_ID, id: { in: soIds } } });
  }
  if (contract) await prisma.contract.deleteMany({ where: { organizationId: ORG_ID, id: contract.id } });
  const kato = await prisma.contract.findFirst({ where: { organizationId: ORG_ID, contractNo: KATO_CONTRACT_NO }, select: { id: true } });
  if (kato) await prisma.contract.deleteMany({ where: { organizationId: ORG_ID, id: kato.id } });
  // Document links cascade with the contract/shipment; the throwaway invoices go by name.
  const invoices = await prisma.document.deleteMany({ where: { organizationId: ORG_ID, name: { startsWith: INVOICE_PREFIX } } });
  console.log(`  cleanup: ${smokeFiles.length} file(s), ${shipIds.length} shipment(s), ${contract ? 1 : 0} contract, ${invoices.count} invoice document(s) removed`);
}

main()
  .catch((e) => {
    console.error(`\n❌ ${e?.message || e}`);
    process.exitCode = 1;
  })
  .finally(() => setTimeout(() => process.exit(), 100));
