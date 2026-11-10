/**
 * Round BP item 7 — Dashboard "Unpaid / 未払い・未入金" (Sayaka + Take): what ADH still has to pay and what customers
 * still owe ADH, with due dates, sorted by due date, totals per currency. Amounts only: no margin / profit (ADH Sales
 * sees this card).
 *
 * Round BQ — what counts as paid / owed (owner, 2026-11-10):
 *   · A payment step that is DONE is paid, with or without a proof file (step 1 deposit, step 6 CI balance, step 8
 *     import tax, step 12 logistics, the customer's receipt step). Completed orders never appear.
 *   · CI balance = CI amount − the deposit actually paid (step 1 done / recorded), on the order's first shipment.
 *   · Logistics: one row per actual invoice / bill (Mitsui Soko's 請求書 per shipment, its monthly A3279 bill shared by
 *     several shipments, carriers' debit notes), at the invoice's own total and due date — read from the filed PDF
 *     (TradeExtraction kind INVOICE, trade-invoice-read.ts). A re-issued invoice (same Mitsui Soko IM3Z… reference)
 *     replaces the earlier one.
 *   · To receive: AIMS-made invoices AND customer invoices filed as PDFs (Kato's 請求書). A 正誤差額 / 実費差分 that is
 *     paid with the next invoice is due on that invoice's date.
 *   · Import tax: the step 7 estimate (computed) until the import permit's actual is filed, then the actual.
 *   · Rows without a due date sort to the bottom under "No due date".
 * Every row carries its reason ("step 6 not done", "invoice 2FMEJAEF0204 · step 12 not done").
 *
 * Mark paid: a step row records the step's payment (as the step card); an invoice / bill row records an IN / OUT
 * payment allocated to that invoice (the Payments module's rows — retired for entry, still read everywhere), with the
 * proof filed on the step's proof slot.
 */
import { BadRequestException, Injectable, NotFoundException, Optional } from '@nestjs/common';
import { PrismaService } from '../common/prisma.service';
import { tradeToday, shipmentRef, depositOf } from './shipments.rules';
import { TradeActor } from './shipments.request';
import { TradeDueService } from './trade-due.service';
import { TradeStepsService } from './trade-steps.service';
import { generatedInvoiceTotal } from './trade-payments.service';
import { stepPaymentOf, STEP_PAYMENT, ACCOUNTS, PaymentAccount } from './trade-payments';
import { receiptNotTracked } from './trade-alerts';
import { TradeConfigService } from './trade-config.service';
import { TradeTaxInputsService } from './trade-tax-inputs';
import { estimate, ShipmentCosts } from './trade-estimator';
import { InvoiceFacts, isPayable } from './trade-invoice-read';
import { permitTotalFromFileName } from './trade-customs';

export type UnpaidKind = 'DEPOSIT' | 'CI' | 'IMPORT_TAX' | 'LOGISTICS' | 'INVOICE';
export interface UnpaidRow {
  key: string;
  side: 'pay' | 'receive';
  kind: UnpaidKind;
  ref: string;
  orderId: string | null;
  shipmentId: string | null;
  /** Every shipment the row is for (a monthly bill covers several). */
  shipmentIds: string[];
  counterparty: string | null;
  documentNo: string | null;
  /** Still owed (null = not known yet, e.g. no CI amount, invoice not read). */
  amount: number | null;
  currency: string;
  dueDate: string | null;
  /** Days until due (negative = overdue). */
  daysLeft: number | null;
  status: 'overdue' | 'due' | 'no date' | 'partly paid';
  /** Already recorded against it (partly paid). */
  paid: number;
  note: string | null;
  /** Why it is on the list ("step 6 not done", "invoice 2FMEJAEF0204 · step 12 not done (#15-1)"). */
  reason: string;
  /** The step whose proof slot takes the proof (and, for recordOn 'step', whose payment records it). */
  stepId: string | null;
  /** 'step' = the step's payment; 'allocation' = an IN / OUT payment allocated to the invoice / bill. */
  recordOn: 'step' | 'allocation';
  generatedDocId: string | null;
  /** The filed invoice / bill (PDF) the row is for. */
  fileId: string | null;
  proofDocType: string;
}

const day = (d: Date | string | null | undefined) => (d ? new Date(d).toISOString().slice(0, 10) : null);
const daysBetween = (from: string, to: string) => Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86_400_000);
const r2 = (n: number) => Math.round(n * 100) / 100;
const orderRef = (o: { orderNo?: number | null } | null | undefined) => (o?.orderNo ? `#${o.orderNo}` : '—');
const money = (n: number) => n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const OPEN_ORDER = { isTest: false, status: 'OPEN' as const };
const CUSTOMER_INVOICE_TYPES = ['INVOICE_1', 'INVOICE_2', 'INVOICE_SINGLE', 'INVOICE_ADJUSTMENT'];

/** Status + days left of a row (pure; tested). */
export function unpaidState(dueDate: string | null, today: string, paid: number): { daysLeft: number | null; status: UnpaidRow['status'] } {
  const daysLeft = dueDate ? daysBetween(today, dueDate) : null;
  const status = daysLeft !== null && daysLeft < 0 ? 'overdue' : paid > 0 ? 'partly paid' : dueDate ? 'due' : 'no date';
  return { daysLeft, status };
}

/** Rows by due date with the no-due-date rows at the bottom, then ref; totals per currency (pure; tested). */
export function sortAndTotal(rows: UnpaidRow[]): { rows: UnpaidRow[]; totals: Record<string, number> } {
  const sorted = [...rows].sort((a, b) => (a.dueDate ?? '9999').localeCompare(b.dueDate ?? '9999') || a.ref.localeCompare(b.ref, 'en', { numeric: true }));
  const totals: Record<string, number> = {};
  for (const r of sorted) if (r.amount !== null) totals[r.currency] = r2((totals[r.currency] ?? 0) + r.amount);
  return { rows: sorted, totals };
}

/** The deposit paid on an order: step 1 done / a recorded payment / the deposit paid date (pure; tested). */
export function depositPaidOf(o: { depositAmount?: unknown; piAmount?: unknown; depositPct?: unknown; depositPaidAt?: unknown }, step1: { status?: string | null; payment?: unknown } | null | undefined): number | null {
  const recorded = stepPaymentOf(step1?.payment)?.amount ?? null;
  if (recorded !== null && recorded > 0) return recorded;
  const paid = step1?.status === 'DONE' || !!o.depositPaidAt;
  if (!paid) return null;
  const dep = o.depositAmount !== null && o.depositAmount !== undefined ? Number(o.depositAmount) : depositOf(o.piAmount as any, (o.depositPct as any) ?? 10);
  return dep && dep > 0 ? dep : null;
}

/**
 * Filed invoices → one entry per real invoice (pure; tested): payable kinds only, a re-issue with the same reference
 * replaces the earlier one (latest issue date, then newest file), the same issuer + number filed twice counts once.
 */
export function distinctInvoices<T extends { fileId: string; part: number; createdAt: string; facts: InvoiceFacts | null }>(files: T[]): T[] {
  const keep = new Map<string, T>();
  const newer = (a: T, b: T) => ((a.facts?.issueDate ?? '') > (b.facts?.issueDate ?? '') || ((a.facts?.issueDate ?? '') === (b.facts?.issueDate ?? '') && a.createdAt > b.createdAt) ? a : b);
  for (const f of files) {
    if (f.facts && !isPayable(f.facts)) continue;
    const key = !f.facts ? `file:${f.fileId}` : f.facts.reference ? `${f.facts.issuer}|ref:${f.facts.reference}` : f.facts.invoiceNo ? `${f.facts.issuer}|no:${f.facts.invoiceNo}` : `file:${f.fileId}:${f.part}`;
    const had = keep.get(key);
    keep.set(key, had ? newer(f, had) : f);
  }
  return [...keep.values()];
}

/** A filed file's invoices as list entries: one per invoice in it (a file not read yet = one entry without facts). */
export function invoiceEntries<F extends { id: string; createdAt: Date | string }>(f: F, invoices: InvoiceFacts[] | null | undefined) {
  const createdAt = new Date(f.createdAt).toISOString();
  if (!invoices) return [{ ...f, fileId: f.id, part: 0, parts: 1, createdAt, facts: null as InvoiceFacts | null }];
  return invoices.map((facts, part) => ({ ...f, fileId: f.id, part, parts: invoices.length, createdAt, facts: facts as InvoiceFacts | null }));
}

/**
 * A bill file covering several shipments (Mitsui Soko's monthly A3279 bill: trucking + storage) is ONE shared row:
 * its payable invoices merged — numbers joined, totals added, the earliest due date (pure; tested).
 */
export function mergeSharedBill(invoices: InvoiceFacts[] | null | undefined, shipments: number): InvoiceFacts[] | null | undefined {
  if (!invoices || shipments < 2) return invoices;
  const pay = invoices.filter((f) => isPayable(f));
  if (pay.length < 2) return invoices;
  const totals = pay.map((f) => f.total);
  const dues = pay.map((f) => f.dueDate).filter((d): d is string => !!d).sort();
  const merged: InvoiceFacts = {
    ...pay[0],
    invoiceNo: pay.map((f) => f.invoiceNo ?? '?').join(' + '),
    reference: null,
    total: totals.every((t) => t !== null) ? r2((totals as number[]).reduce((a, b) => a + b, 0)) : null,
    dueDate: dues[0] ?? null,
  };
  return [merged, ...invoices.filter((f) => !isPayable(f))];
}

/** A remittance / receipt filed on the same shipment for the same amount = that invoice is paid (pure; tested). */
export function paidByRemittance(inv: InvoiceFacts | null, remits: InvoiceFacts[]): InvoiceFacts | null {
  if (!inv || inv.total === null) return null;
  return remits.find((r) => r.total !== null && Math.abs(r.total - (inv.total as number)) < 0.5 && (!r.currency || !inv.currency || r.currency === inv.currency)) ?? null;
}

/** A 正誤差額 / 実費差分 paid "with the next invoice": the earliest due date among the customer's other open invoices issued on or after it (pure; tested). */
export function dueWithNext(issueDate: string | null, others: Array<{ dueDate: string | null; issueDate: string | null; documentNo: string | null }>): { dueDate: string | null; with: string | null } {
  const next = others.filter((o) => o.dueDate && (!issueDate || !o.issueDate || o.issueDate >= issueDate)).sort((a, b) => (a.dueDate as string).localeCompare(b.dueDate as string))[0];
  return next ? { dueDate: next.dueDate, with: next.documentNo } : { dueDate: null, with: null };
}

@Injectable()
export class TradeUnpaidService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly due: TradeDueService,
    private readonly steps: TradeStepsService,
    @Optional() private readonly config?: TradeConfigService,
    @Optional() private readonly taxInputs?: TradeTaxInputsService,
  ) {}

  /** The stored invoice reads (latest DONE INVOICE extraction per file); `override` = reads made in memory (dry run). */
  private async invoiceFacts(organizationId: string, fileIds: string[], override?: Map<string, InvoiceFacts[] | null>) {
    const out = new Map<string, InvoiceFacts[] | null>();
    const missing = fileIds.filter((id) => !override?.has(id));
    for (const id of fileIds) if (override?.has(id)) out.set(id, override.get(id) ?? null);
    if (missing.length) {
      const rows: any[] = await this.prisma.tradeExtraction.findMany({ where: { organizationId, kind: 'INVOICE', status: 'DONE', fileId: { in: missing } }, orderBy: { createdAt: 'desc' }, select: { fileId: true, result: true } });
      for (const r of rows) if (!out.has(r.fileId)) out.set(r.fileId, ((r.result as any)?.invoices as InvoiceFacts[]) ?? null);
    }
    return out;
  }

  /** Step 7's import tax: the permit's actual once filed, else the estimate (as the step card computes it). */
  private async importTaxOf(organizationId: string, sh: any): Promise<{ amount: number | null; source: 'actual' | 'estimate' | null; permitFiled?: boolean }> {
    const c = (sh.costs ?? {}) as ShipmentCosts & Record<string, unknown>;
    if (typeof c.importTaxActual === 'number') return { amount: c.importTaxActual, source: 'actual' };
    // The import permit filed but its total not carried to the shipment yet: the permit's read, else its file name ("JPY 1,234,500").
    const permit: any = await this.prisma.tradeExtraction
      .findFirst({ where: { organizationId, kind: 'IMPORT_PERMIT', status: 'DONE', OR: [{ shipmentId: sh.id }, { file: { links: { some: { shipmentId: sh.id, hiddenAt: null } } } }] }, orderBy: { createdAt: 'desc' }, select: { result: true } })
      .catch(() => null);
    const fromRead = Number((permit?.result as any)?.permit?.total);
    if (Number.isFinite(fromRead) && fromRead > 0) return { amount: fromRead, source: 'actual' };
    const files: any[] = await this.prisma.tradeFile
      .findMany({ where: { organizationId, docType: 'IMPORT_PERMIT', links: { some: { shipmentId: sh.id, hiddenAt: null } } }, select: { fileName: true } })
      .catch(() => []);
    const fromName = files.map((f) => permitTotalFromFileName(f.fileName)).find((n) => n !== null) ?? null;
    if (fromName !== null) return { amount: fromName, source: 'actual' };
    const permitFiled = files.length > 0;
    if (!this.config) return { amount: null, source: null, permitFiled };
    try {
      const settings = await this.config.getSettings(organizationId);
      const profile = await this.config.profileOf(organizationId, sh.order?.customerId ?? null);
      const clearance = (typeof c.clearanceDate === 'string' && c.clearanceDate) || (sh.eta ? new Date(sh.eta).toISOString().slice(0, 10) : null);
      const ctx = this.taxInputs
        ? {
            cif: await this.taxInputs.cifFor(organizationId, sh.id, sh.netWeightMt === null ? null : Number(sh.netWeightMt)).catch(() => null),
            rate: await this.taxInputs.usdRateFor(clearance).catch(() => null),
          }
        : {};
      const est = estimate(sh, c, settings.estimatorRates, profile, ctx).importTax.estimate;
      return { amount: est, source: est === null ? null : 'estimate', permitFiled };
    } catch {
      return { amount: null, source: null, permitFiled };
    }
  }

  async list(organizationId: string, today = tradeToday(), opts: { invoiceFacts?: Map<string, InvoiceFacts[] | null> } = {}) {
    // Step due dates exactly as the step cards show them (rules + dates set by hand).
    const open = await this.due.openItems(organizationId, today).catch(() => [] as Awaited<ReturnType<TradeDueService['openItems']>>);
    const dueOf = new Map(open.map((i) => [i.stepId, i.due]));
    const row = (r: Omit<UnpaidRow, 'daysLeft' | 'status'>): UnpaidRow => ({ ...r, ...unpaidState(r.dueDate, today, r.paid) });
    const pay: UnpaidRow[] = [];
    const receive: UnpaidRow[] = [];

    // Allocations already recorded (correction invoices, vendor bills marked paid here).
    const allocs: Array<{ targetType: string; targetId: string | null; amount: unknown }> = await this.prisma.tradePaymentAllocation.findMany({
      where: { organizationId, targetType: { in: ['INVOICE', 'VENDOR_INVOICE'] } },
      select: { targetType: true, targetId: true, targetLabel: true, amount: true },
    });
    const allocated = new Map<string, number>();
    for (const a of allocs as Array<{ targetId: string | null; targetLabel?: string | null; amount: unknown }>) {
      if (!a.targetId) continue;
      allocated.set(a.targetId, r2((allocated.get(a.targetId) ?? 0) + Number(a.amount)));
      if (a.targetLabel) allocated.set(`${a.targetId}|${a.targetLabel}`, r2((allocated.get(`${a.targetId}|${a.targetLabel}`) ?? 0) + Number(a.amount)));
    }
    // A file holding several invoices: each is paid by the allocations labelled with its own number.
    const paidOn = (fileId: string, parts: number, label: string | null) => (parts > 1 ? (allocated.get(`${fileId}|${label}`) ?? 0) : (allocated.get(fileId) ?? 0));

    // ── To pay: steps 1 / 6 / 8 — open (not DONE), no payment recorded, on open orders ──
    const steps: any[] = await this.prisma.tradeStep.findMany({
      where: {
        organizationId,
        code: { in: ['PI_PAYMENT', 'CI_PAYMENT', 'TAX_FUNDS'] },
        notApplicable: false,
        status: { not: 'DONE' },
        OR: [{ orderId: { not: null }, order: OPEN_ORDER }, { shipmentId: { not: null }, shipment: { status: 'OPEN', order: OPEN_ORDER } }],
      },
      select: {
        id: true,
        code: true,
        status: true,
        payment: true,
        order: { select: { id: true, orderNo: true, piNo: true, piDate: true, piAmount: true, depositPct: true, depositAmount: true, depositDueDate: true, depositPaidAt: true, currency: true, supplier: { select: { name: true } } } },
        shipment: {
          select: {
            id: true,
            seqNo: true,
            ciNumber: true,
            ciAmount: true,
            currency: true,
            costs: true,
            eta: true,
            netWeightMt: true,
            grossWeightMt: true,
            containerCount: true,
            order: {
              select: {
                id: true,
                orderNo: true,
                customerId: true,
                depositAmount: true,
                piAmount: true,
                depositPct: true,
                depositPaidAt: true,
                supplier: { select: { name: true } },
                steps: { where: { code: 'PI_PAYMENT' }, select: { status: true, payment: true } },
                shipments: { where: { status: { not: 'CANCELLED' } }, orderBy: { seqNo: 'asc' }, select: { id: true } },
              },
            },
            fileLinks: { where: { hiddenAt: null, file: { docType: 'CI_PAYMENT_PROOF' } }, select: { id: true } },
            steps: { where: { code: 'IMPORT_PERMIT' }, select: { notApplicable: true } },
          },
        },
      },
    });
    for (const s of steps) {
      if (stepPaymentOf(s.payment)) continue;
      const spec = STEP_PAYMENT[s.code];
      const dueDate = dueOf.get(s.id) ?? null;
      const notDone = (n: string) => `step ${n} not done${s.status === 'IN_PROGRESS' ? ' (in progress)' : ''}`;
      if (s.code === 'PI_PAYMENT' && s.order) {
        const o = s.order;
        if (o.depositPaidAt || (!o.piNo && o.depositAmount === null)) continue; // paid outside the step / no PI yet
        const amount = o.depositAmount !== null ? Number(o.depositAmount) : depositOf(o.piAmount, o.depositPct ?? 10);
        pay.push(
          row({ key: `step:${s.id}`, side: 'pay', kind: 'DEPOSIT', ref: orderRef(o), orderId: o.id, shipmentId: null, shipmentIds: [], counterparty: o.supplier?.name ?? null, documentNo: o.piNo ? `PI ${o.piNo}` : null, amount, currency: o.currency ?? 'USD', dueDate: dueDate ?? day(o.depositDueDate), paid: 0, note: 'PI deposit', reason: notDone('1'), stepId: s.id, recordOn: 'step', generatedDocId: null, fileId: null, proofDocType: spec.proofDocType }),
        );
      } else if (s.code === 'CI_PAYMENT' && s.shipment) {
        const sh = s.shipment;
        const o = sh.order;
        // The deposit comes off the order's first shipment's CI — only once it is actually paid (step 1 done / recorded).
        const first = o?.shipments?.[0]?.id === sh.id;
        const depPaid = first && o ? depositPaidOf(o, o.steps?.[0]) : null;
        const amount = sh.ciAmount === null ? null : r2(Math.max(0, Number(sh.ciAmount) - (depPaid ?? 0)));
        const note = sh.ciAmount === null ? 'CI amount not in yet' : depPaid ? `CI ${money(Number(sh.ciAmount))} − deposit paid ${money(depPaid)}` : first && (o?.depositAmount !== null || o?.piAmount !== null) ? 'full CI (deposit not paid yet)' : 'CI balance';
        const proof = sh.fileLinks?.length ? ' · a CI payment proof is filed — check step 6' : '';
        pay.push(
          row({ key: `step:${s.id}`, side: 'pay', kind: 'CI', ref: shipmentRef(o?.orderNo, sh.seqNo), orderId: o?.id ?? null, shipmentId: sh.id, shipmentIds: [sh.id], counterparty: o?.supplier?.name ?? null, documentNo: sh.ciNumber ? `CI ${sh.ciNumber}` : null, amount, currency: sh.currency ?? 'USD', dueDate, paid: 0, note, reason: notDone('6') + proof, stepId: s.id, recordOn: 'step', generatedDocId: null, fileId: null, proofDocType: spec.proofDocType }),
        );
      } else if (s.code === 'TAX_FUNDS' && s.shipment) {
        const sh = s.shipment;
        // No import permit for this customer (Houei: Thailand) = no Japanese import tax to fund.
        if (sh.steps?.[0]?.notApplicable) continue;
        const tax = await this.importTaxOf(organizationId, sh);
        pay.push(
          row({
            key: `step:${s.id}`,
            side: 'pay',
            kind: 'IMPORT_TAX',
            ref: shipmentRef(sh.order?.orderNo, sh.seqNo),
            orderId: sh.order?.id ?? null,
            shipmentId: sh.id,
            shipmentIds: [sh.id],
            counterparty: 'Customs (税関)',
            documentNo: null,
            amount: tax.amount,
            currency: 'JPY',
            dueDate,
            paid: 0,
            note: tax.source === 'actual' ? 'import permit (actual)' : tax.permitFiled ? 'import permit filed — its total is not read yet (step 10)' : tax.source === 'estimate' ? 'estimate (step 7)' : 'no estimate yet (needs the CIF and FX on step 7)',
            reason: notDone('8'),
            stepId: s.id,
            recordOn: 'step',
            generatedDocId: null,
            fileId: null,
            proofDocType: spec.proofDocType,
          }),
        );
      }
    }

    // ── To pay: logistics — one row per real invoice / bill filed on the shipments (step 12) ──
    const vendorFiles: any[] = await this.prisma.tradeFile.findMany({
      where: { organizationId, docType: 'VENDOR_INVOICE', links: { some: { hiddenAt: null, shipment: { status: { not: 'CANCELLED' }, order: OPEN_ORDER } } } },
      select: {
        id: true,
        fileName: true,
        createdAt: true,
        links: {
          where: { hiddenAt: null, shipmentId: { not: null } },
          select: { shipment: { select: { id: true, seqNo: true, status: true, order: { select: { id: true, orderNo: true, status: true, isTest: true } }, steps: { where: { code: 'LOGISTICS_PAYMENT' }, select: { id: true, status: true, notApplicable: true } } } } },
        },
      },
    });
    const vFacts = await this.invoiceFacts(organizationId, vendorFiles.map((f) => f.id), opts.invoiceFacts);
    const entries = vendorFiles.flatMap((f) => invoiceEntries(f, mergeSharedBill(vFacts.get(f.id), f.links.length)));
    // Remittance advices / receipts filed as vendor invoices, by shipment: they settle the invoice of the same amount.
    const remitsBy = new Map<string, InvoiceFacts[]>();
    for (const e of entries) {
      if (!e.facts || isPayable(e.facts) || !['remittance', 'receipt'].includes(e.facts.docKind)) continue;
      for (const l of e.links) if (l.shipment) remitsBy.set(l.shipment.id, [...(remitsBy.get(l.shipment.id) ?? []), e.facts]);
    }
    const vendor = distinctInvoices(entries);
    for (const f of vendor) {
      const ships = f.links.map((l: any) => l.shipment).filter((s: any) => s && s.order?.status === 'OPEN' && !s.order?.isTest);
      if (paidByRemittance(f.facts, ships.flatMap((s: any) => remitsBy.get(s.id) ?? []))) continue;
      if (!ships.length) continue;
      const s12 = ships.map((s: any) => ({ ship: s, step: s.steps?.[0] ?? null }));
      // Step 12 done (or N/A) on every shipment the bill covers = paid.
      const openSteps = s12.filter((x: any) => x.step && !x.step.notApplicable && x.step.status !== 'DONE');
      if (!openSteps.length) continue;
      const facts = f.facts;
      const paid = paidOn(f.fileId, f.parts, facts?.invoiceNo ?? null);
      const total = facts?.total ?? null;
      if (total !== null && paid >= total - 0.5) continue;
      const refs = ships.map((s: any) => shipmentRef(s.order?.orderNo, s.seqNo));
      const docNo = facts?.invoiceNo ?? null;
      pay.push(
        row({
          key: f.parts > 1 ? `file:${f.fileId}:${f.part}` : `file:${f.fileId}`,
          side: 'pay',
          kind: 'LOGISTICS',
          ref: refs.join(', '),
          orderId: ships[0].order?.id ?? null,
          shipmentId: ships.length === 1 ? ships[0].id : null,
          shipmentIds: ships.map((s: any) => s.id),
          counterparty: facts?.issuer ?? null,
          documentNo: docNo ?? f.fileName.slice(0, 60),
          amount: total === null ? null : r2(total - paid),
          currency: facts?.currency ?? 'JPY',
          dueDate: facts?.dueDate ?? null,
          paid,
          note: facts ? (ships.length > 1 ? `shared bill (${ships.length} shipments)` : null) : 'invoice not read yet',
          reason: `${docNo ? `invoice ${docNo} · ` : ''}step 12 not done (${openSteps.map((x: any) => shipmentRef(x.ship.order?.orderNo, x.ship.seqNo)).join(', ')})`,
          stepId: openSteps.length === 1 ? openSteps[0].step.id : null,
          recordOn: 'allocation',
          generatedDocId: null,
          fileId: f.fileId,
          proofDocType: 'PAYMENT_PROOF',
        }),
      );
    }

    // ── To receive: customer invoices (AIMS-made + filed PDFs) minus what is recorded ──
    const invs: any[] = await this.prisma.tradeGeneratedDoc.findMany({
      where: { organizationId, status: 'FINAL', docType: { in: CUSTOMER_INVOICE_TYPES } },
      select: {
        id: true,
        docType: true,
        number: true,
        header: true,
        rows: true,
        orderId: true,
        shipmentId: true,
        finalFileId: true,
        order: { select: { id: true, orderNo: true, status: true, isTest: true, customer: { select: { name: true } } } },
        shipment: { select: { seqNo: true, orderId: true, order: { select: { id: true, orderNo: true, status: true, isTest: true, customer: { select: { name: true } } } } } },
      },
    });
    const custFiles: any[] = await this.prisma.tradeFile.findMany({
      where: {
        organizationId,
        docType: { in: CUSTOMER_INVOICE_TYPES },
        source: { not: 'GENERATED' },
        links: { some: { hiddenAt: null, OR: [{ order: OPEN_ORDER }, { shipment: { order: OPEN_ORDER } }] } },
      },
      select: {
        id: true,
        docType: true,
        fileName: true,
        createdAt: true,
        links: {
          where: { hiddenAt: null },
          select: { shipmentId: true, order: { select: { id: true, orderNo: true, status: true, isTest: true, customer: { select: { id: true, name: true } } } }, shipment: { select: { seqNo: true, order: { select: { id: true, orderNo: true, status: true, isTest: true, customer: { select: { id: true, name: true } } } } } } },
        },
      },
    });
    const genFileIds = new Set(invs.map((g) => g.finalFileId).filter(Boolean));
    const genNumbers = new Set(invs.map((g) => g.number).filter(Boolean));
    const cFacts = await this.invoiceFacts(organizationId, custFiles.map((f) => f.id), opts.invoiceFacts);
    const orderIds = [...new Set([...invs.map((g) => g.orderId ?? g.shipment?.orderId), ...custFiles.flatMap((f) => f.links.map((l: any) => l.order?.id ?? l.shipment?.order?.id))].filter(Boolean))] as string[];
    const receipts: any[] = orderIds.length
      ? await this.prisma.tradeStep.findMany({ where: { organizationId, orderId: { in: orderIds }, code: { in: ['INVOICE_1', 'INVOICE_2'] } }, select: { id: true, orderId: true, code: true, status: true, payment: true, skipReason: true, notApplicable: true, requiredDocTypes: true } })
      : [];
    // The step that records an invoice's receipt: the one that requires its document (Kato: step 2), else by kind.
    const receiptStep = (orderId: string | null, docType: string) => {
      if (docType === 'INVOICE_ADJUSTMENT') return null;
      const own = receipts.filter((r) => r.orderId === orderId && !r.notApplicable);
      return own.find((r) => (r.requiredDocTypes ?? []).includes(docType)) ?? own.find((r) => r.code === (docType === 'INVOICE_1' ? 'INVOICE_1' : 'INVOICE_2')) ?? null;
    };
    const stepNo = (code: string) => (code === 'INVOICE_1' ? '2' : '11');
    const kindLabel = (docType: string, variant?: string) => (docType === 'INVOICE_1' ? 'Invoice #1' : docType === 'INVOICE_2' ? 'Invoice #2' : docType === 'INVOICE_ADJUSTMENT' ? (variant === 'actuals' ? '実費差分' : '正誤差額') : 'Invoice');
    type Pending = { row: Omit<UnpaidRow, 'daysLeft' | 'status'>; issueDate: string | null; withNext: boolean; customer: string | null };
    const pending: Pending[] = [];
    const addReceive = (x: { key: string; docType: string; variant?: string; number: string | null; total: number; currency: string; dueDate: string | null; issueDate: string | null; withNext: boolean; order: any; shipmentId: string | null; shipmentSeq: number | null; generatedDocId: string | null; fileId: string | null; source: string }) => {
      const order = x.order;
      if (!order || order.isTest || order.status !== 'OPEN') return; // completed orders never appear
      if (!(x.total > 0)) return; // credits are settled against the next invoice
      const step = receiptStep(order.id, x.docType);
      if (step?.status === 'DONE') return; // the customer's payment step is done = received
      const paid = r2((stepPaymentOf(step?.payment)?.amount ?? 0) + (allocated.get(x.generatedDocId ?? x.fileId ?? '') ?? 0));
      if (receiptNotTracked({ orderStatus: order.status ?? null, stepSkipReason: step?.skipReason ?? null, paid })) return;
      const left = r2(x.total - paid);
      if (left <= 0.005) return;
      const docNo = `${kindLabel(x.docType, x.variant)} ${x.number ?? ''}`.trim();
      pending.push({
        issueDate: x.issueDate,
        withNext: x.withNext,
        customer: order.customer?.name ?? null,
        row: {
          key: x.key,
          side: 'receive',
          kind: 'INVOICE',
          ref: x.shipmentSeq !== null ? shipmentRef(order.orderNo, x.shipmentSeq) : orderRef(order),
          orderId: order.id,
          shipmentId: x.shipmentId,
          shipmentIds: x.shipmentId ? [x.shipmentId] : [],
          counterparty: order.customer?.name ?? null,
          documentNo: docNo,
          amount: left,
          currency: x.currency,
          dueDate: x.dueDate,
          paid,
          note: x.source,
          reason: step ? `step ${stepNo(step.code)} not done (no receipt recorded)` : 'no receipt recorded',
          stepId: step?.id ?? null,
          recordOn: step ? 'step' : 'allocation',
          generatedDocId: x.generatedDocId,
          fileId: x.fileId,
          proofDocType: 'PAYMENT_PROOF',
        },
      });
    };
    for (const g of invs) {
      const h = (g.header ?? {}) as Record<string, any>;
      const variant = h.variant as string | undefined;
      addReceive({
        key: `doc:${g.id}`,
        docType: g.docType,
        variant,
        number: g.number,
        total: generatedInvoiceTotal(g),
        currency: h.currency ?? 'USD',
        dueDate: variant === 'correction' || variant === 'actuals' ? null : day(h.dueDate),
        issueDate: day(h.issueDate ?? h.date ?? null),
        withNext: variant === 'correction' || variant === 'actuals',
        order: g.order ?? g.shipment?.order ?? null,
        shipmentId: g.shipmentId ?? null,
        shipmentSeq: g.shipment && !g.orderId ? g.shipment.seqNo : null,
        generatedDocId: g.id,
        fileId: g.finalFileId ?? null,
        source: 'AIMS invoice',
      });
    }
    for (const e of custFiles.flatMap((f) => invoiceEntries(f, cFacts.get(f.id)))) {
      const f = e;
      if (genFileIds.has(f.id)) continue;
      const facts = e.facts;
      if (facts && (!isPayable(facts) || (facts.invoiceNo && genNumbers.has(facts.invoiceNo)))) continue;
      const l = f.links.find((x: any) => x.order) ?? f.links.find((x: any) => x.shipment) ?? null;
      const order = l?.order ?? l?.shipment?.order ?? null;
      if (!facts) {
        // Not read yet: listed without an amount so it is not missed.
        if (!order || order.isTest || order.status !== 'OPEN') continue;
        const step = receiptStep(order.id, f.docType);
        if (step?.status === 'DONE') continue;
        pending.push({
          issueDate: null,
          withNext: false,
          customer: order.customer?.name ?? null,
          row: { key: `file:${f.id}`, side: 'receive', kind: 'INVOICE', ref: orderRef(order), orderId: order.id, shipmentId: null, shipmentIds: [], counterparty: order.customer?.name ?? null, documentNo: f.fileName.slice(0, 60), amount: null, currency: 'USD', dueDate: null, paid: 0, note: 'invoice not read yet', reason: step ? `step ${stepNo(step.code)} not done` : 'no receipt recorded', stepId: step?.id ?? null, recordOn: step ? 'step' : 'allocation', generatedDocId: null, fileId: f.id, proofDocType: 'PAYMENT_PROOF' },
        });
        continue;
      }
      addReceive({
        key: e.parts > 1 ? `file:${f.id}:${e.part}` : `file:${f.id}`,
        docType: f.docType,
        variant: f.docType === 'INVOICE_ADJUSTMENT' ? (/実費/.test(f.fileName) ? 'actuals' : 'correction') : undefined,
        number: facts.invoiceNo,
        total: facts.total ?? 0,
        currency: facts.currency ?? 'USD',
        dueDate: facts.dueDate,
        issueDate: facts.issueDate,
        withNext: facts.dueWithNext,
        order,
        shipmentId: l?.shipmentId ?? null,
        shipmentSeq: l && !l.order && l.shipment ? l.shipment.seqNo : null,
        generatedDocId: null,
        fileId: f.id,
        source: 'filed PDF',
      });
    }
    // "Pay with the next invoice": due on the customer's next open invoice.
    for (const p of pending) {
      if (p.withNext && !p.row.dueDate) {
        const others = pending.filter((o) => o !== p && !o.withNext && o.customer === p.customer).map((o) => ({ dueDate: o.row.dueDate, issueDate: o.issueDate, documentNo: o.row.documentNo }));
        const nx = dueWithNext(p.issueDate, others);
        p.row.dueDate = nx.dueDate;
        p.row.note = nx.with ? `paid with ${nx.with}` : 'paid with the next invoice';
      }
      receive.push(row(p.row));
    }

    const p = sortAndTotal(pay);
    const r = sortAndTotal(receive);
    return { today, pay: p.rows, payTotals: p.totals, receive: r.rows, receiveTotals: r.totals };
  }

  /**
   * Mark paid: { key, paidAt, amount?, account?, proofFileId? } — a step row records the step's payment (as the step
   * card); an invoice / bill row records an IN (customer) / OUT (vendor) payment allocated to it. Returns what was recorded.
   */
  async markPaid(organizationId: string, body: { key?: string; paidAt?: string; amount?: unknown; account?: string; proofFileId?: string | null }, actor: TradeActor) {
    const list = await this.list(organizationId);
    const r = [...list.pay, ...list.receive].find((x) => x.key === body.key);
    if (!r) throw new NotFoundException('That item is no longer unpaid');
    const paidAt = String(body.paidAt ?? '');
    if (!/^\d{4}-\d{2}-\d{2}$/.test(paidAt)) throw new BadRequestException('Enter the date it was paid (YYYY-MM-DD)');
    const amount = body.amount === undefined || body.amount === null || body.amount === '' ? r.amount : Number(body.amount);
    if (amount === null || !Number.isFinite(amount) || amount <= 0) throw new BadRequestException('Enter the amount paid');
    const account = (ACCOUNTS as string[]).includes(String(body.account)) ? (body.account as PaymentAccount) : 'OTHER';
    if (r.recordOn === 'step' && r.stepId) {
      await this.steps.setPayment(organizationId, r.stepId, { payment: { amount, currency: r.currency, paidAt, account, proofFileId: body.proofFileId ?? null } });
      return { key: r.key, recorded: 'step', stepId: r.stepId, amount, currency: r.currency, paidAt, account, ref: r.ref, documentNo: r.documentNo, counterparty: r.counterparty };
    }
    const targetId = r.generatedDocId ?? r.fileId;
    if (targetId) {
      if (body.proofFileId) {
        const f = await this.prisma.tradeFile.findFirst({ where: { id: body.proofFileId, organizationId }, select: { id: true } });
        if (!f) throw new BadRequestException('Proof file not found');
      }
      const out = r.side === 'pay';
      const pmt = await this.prisma.tradePayment.create({
        data: {
          organizationId,
          direction: out ? 'OUT' : 'IN',
          paidAt: new Date(paidAt),
          amount,
          currency: r.currency,
          account,
          counterpartyType: out ? 'LOGISTICS' : 'CUSTOMER',
          counterpartyName: r.counterparty,
          reference: r.documentNo,
          notes: 'Marked paid on the Dashboard (Unpaid)',
          proofFileId: body.proofFileId ?? null,
          createdById: actor.id ?? null,
          createdByName: actor.name ?? null,
          allocations: { create: [{ organizationId, targetType: out ? 'VENDOR_INVOICE' : 'INVOICE', targetId, targetLabel: r.documentNo, amount, orderId: r.orderId, shipmentId: r.shipmentId ?? r.shipmentIds[0] ?? null }] },
        },
        select: { id: true },
      });
      return { key: r.key, recorded: 'payment', paymentId: pmt.id, amount, currency: r.currency, paidAt, account, ref: r.ref, documentNo: r.documentNo, counterparty: r.counterparty };
    }
    throw new BadRequestException('This item has nothing to record the payment on');
  }
}
