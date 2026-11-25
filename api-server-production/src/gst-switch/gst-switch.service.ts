/**
 * GST switch with company move (WCT group, 2026-11-24): the database side. Rules in gst-switch.ts.
 *
 *   GET  /gst-switch/:invoiceId           the toggle's state (on, which company, GST or not)
 *   GET  /gst-switch/:invoiceId/preview   what a switch would do (documents, credit notes) or why it can't
 *   POST /gst-switch/:invoiceId/move      do it ({ gst: true | false })
 *
 * Order of work (so a failure never leaves half a move):
 *   1. every check (payments, allocations, credit notes, ledger entries, imported, split parts, membership);
 *   2. per confirmed invoice, in the SOURCE company: a full credit note (createBasicDocument + the normal CN
 *      posting, repostGlForDocument) and a Manual Offset of the invoice against it (ReceiptsService.createOffset),
 *      then the invoice is marked (config.gstMove.creditNote), so a retry never credits it twice;
 *   3. ONE transaction: the customer (matched or created), the order (new ORDW / ORDB number), every quotation /
 *      DO / draft invoice (new numbers in the target's sequences, "Previously <no.>"), the re-issued draft invoices,
 *      jobs, service reports, links, embeddings, price history;
 *   4. order status refresh, document history and Activity Log rows in both companies.
 * Journals are never moved or deleted; the DB guard triggers stay as they are.
 */
import { srNumberOf } from '../maintenance-reports/sr-number';
import { invoiceSplitOf, retaxedSplitTotals } from '../documents/invoice-split';
import { stampDocumentMoney } from '../common/document-money';
import { HttpException, HttpStatus, Injectable } from '@nestjs/common';
import { randomUUID } from 'crypto';
import { PrismaService } from '../common/prisma.service';
import { DocumentsService, DocumentActor } from '../documents/documents.service';
import { ReceiptsService } from '../receipts/receipts.service';
import { ActionLogService } from '../action-log/action-log.service';
import { DocumentNumberingService } from '../document-numbering/document-numbering.service';
import { legacySerialName } from '../document-numbering/locked-number';
import { amountPaidOf, owedOf } from '../common/document-money';
import { tenancyOn } from '../common/tenancy/tenant-context';
import { memberOrgIds } from '../organizations/org-group';
import { gstSwitchFor } from './gst-switch-state';
import { isImportedOrder } from '../orders/imported-orders';
import { ensureOrderNumberFormat, issueOrderNumberInTx, refreshOrderStatus } from '../orders/wct-orders';
import { withSplitPartIds } from '../documents/invoice-split';
import { storedFileValues } from '../common/storage-sign';
import { orgOfKey } from '../common/storage-keys';
import { normalizeStoredKey } from '../files/files.service';
import { groupOrgIds } from '../organizations/org-group';
import {
  CN_TYPES,
  creditNoteConfig,
  fileMoveOf,
  GstSwitchState,
  invoiceIsGst,
  isDoType,
  isDraftStatus,
  isInvoiceType,
  isQuotationType,
  matchCustomer,
  MoveCtx,
  movedConfig,
  moveHeadline,
  movedPartNumber,
  numberingTypeOf,
  orderLinksAfterMove,
  planUnit,
  recordFileKeys,
  reissuedInvoiceConfig,
  splitAfterMove,
  splitOf,
  taxedInvoiceConfig,
  taxedQuotationConfig,
  UnitDoc,
} from './gst-switch';

const bad = (m: string) => new HttpException(m, HttpStatus.BAD_REQUEST);
const SOFT_DELETED = 'DELETED';
const DOC_SELECT = { id: true, type: true, name: true, status: true, config: true, documentTemplateId: true } as const;
const gstLabel = (gst: boolean) => (gst ? 'GST invoice' : 'Non-GST invoice');
const TYPE_LABEL = (t: string) => (isQuotationType(t) ? 'Quotation' : isDoType(t) ? 'DO' : isInvoiceType(t) ? 'Invoice' : t);

interface Unit {
  order: any | null;
  docs: UnitDoc[];
  jobs: Array<{ id: string; deliveryNumber: number; orderInvoiceId: string | null }>;
  reports: Array<{ id: string; reportNumber: number | null; serviceData: any; invoiceDocumentId: string | null }>;
  sourceCustomer: { id: string; name: string; uen: string | null; email: string | null; phone: string | null; address: string | null; gstRegNo: string | null; customerCode: string | null } | null;
}

/** A moved report row's label: a real service report, or a DO sign-off / job start record (UAT 2026-11-25). */
export const reportRowLabel = (kind: unknown): string =>
  kind === 'DO_ACK' || kind === 'DO_INSTALL' ? 'DO sign-off' : kind === 'DO_START' ? 'Job start record' : 'Service report';

/**
 * Moved split parts (UAT 2026-11-25): each group's parts re-taxed together; returns only the parts whose totals change.
 * Pure: [id, config] pairs in, the re-stamped configs out.
 */
export function splitGroupRetax(entries: Array<[string, any]>, tax: { gstPercent: number; taxApplicable: 'Y' | 'N' }): Array<{ id: string; config: any }> {
  const groups = new Map<string, Array<[string, any]>>();
  for (const [id, cfg] of entries) {
    const sp = invoiceSplitOf(cfg);
    if (sp) groups.set(sp.groupId, [...(groups.get(sp.groupId) ?? []), [id, cfg]]);
  }
  const out: Array<{ id: string; config: any }> = [];
  for (const parts of groups.values()) {
    if (parts.length < 2) continue;
    parts.sort((a, b) => Number(invoiceSplitOf(a[1])!.part) - Number(invoiceSplitOf(b[1])!.part));
    const totals = retaxedSplitTotals(parts.map((p) => p[1]), { ...tax, absorbTax: 'N' });
    parts.forEach(([id, cfg], i) => {
      const t = totals[i];
      if (t.gstAmount === cfg.gstAmount && t.nettTotal === cfg.nettTotal && t.subTotal === cfg.subTotal) return;
      const sums = { subTotal: t.subTotal, gstAmount: t.gstAmount, nettTotal: t.nettTotal };
      const next = { ...cfg, ...sums, documentInfo: { ...(cfg.documentInfo || {}), ...sums } };
      out.push({ id, config: stampDocumentMoney(next, { gross: t.nettTotal, outstanding: t.nettTotal, paid: 0 }) });
    });
  }
  return out;
}

@Injectable()
export class GstSwitchService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly documents: DocumentsService,
    private readonly receipts: ReceiptsService,
    private readonly actionLog: ActionLogService,
  ) {}

  private get db(): any {
    return this.prisma as any;
  }

  async switchState(orgId: string): Promise<GstSwitchState> {
    return gstSwitchFor(this.db, orgId);
  }

  private async invoiceOf(invoiceId: string, orgId: string) {
    const inv = await this.db.document.findFirst({ where: { id: invoiceId, organizationId: orgId }, select: { id: true, type: true, name: true, status: true, config: true, documentTemplateId: true } });
    if (!inv || !isInvoiceType(inv.type)) throw new HttpException('Invoice not found', HttpStatus.NOT_FOUND);
    return inv;
  }

  /** The toggle: on / off, this company's GST setting, the invoice's own setting, the partner. */
  async state(invoiceId: string, orgId: string) {
    const inv = await this.invoiceOf(invoiceId, orgId);
    const s = await this.switchState(orgId);
    return { on: s.on, companyGst: s.gst, invoiceGst: invoiceIsGst(inv.config), partner: s.partner, previousNumber: (inv.config as any)?.previousNumber ?? null };
  }

  /** The invoice's order (or the invoice alone) with every document, job and service report on it. */
  private async loadUnit(orgId: string, inv: any): Promise<Unit> {
    // A split part (2026-11-25): its order is the order of any part of its split.
    const parts = await this.splitPartsOf(orgId, [inv]);
    const orderId = [inv, ...parts].map((d: any) => d.config?.orderId).find((x: any) => typeof x === 'string' && x) ?? null;
    const order = orderId ? await this.db.order.findFirst({ where: { id: orderId, organizationId: orgId } }) : null;
    const ids = new Set<string>([inv.id]);
    if (order) {
      if (order.sourceQuotationId) ids.add(order.sourceQuotationId);
      const ld: any = order.linkedDocuments || {};
      for (const k of ['quotation', 'do', 'invoice']) for (const e of Array.isArray(ld[k]) ? ld[k] : []) if (e?.id && !e.imported) ids.add(e.id);
      const onOrder: Array<{ id: string }> = await this.db.$queryRawUnsafe(`SELECT id::text AS id FROM "Document" WHERE "organizationId" = $1 AND config->>'orderId' = $2`, orgId, order.id);
      for (const r of onOrder) ids.add(r.id);
    }
    const found = await this.db.document.findMany({ where: { id: { in: [...ids] }, organizationId: orgId }, select: DOC_SELECT });
    // Split payment parts (2026-11-25): every part of a split among them moves with the order, even one not on it.
    const rows = [...found, ...(await this.splitPartsOf(orgId, found))];
    const docs: UnitDoc[] = rows.filter((d: any) => String(d.type).toUpperCase() !== SOFT_DELETED && (isQuotationType(d.type) || isDoType(d.type) || isInvoiceType(d.type)));
    const jobs = order ? await this.db.delivery.findMany({ where: { organizationId: orgId, orderId: order.id }, select: { id: true, deliveryNumber: true, orderInvoiceId: true }, orderBy: { deliveryNumber: 'asc' } }) : [];
    const docIds = docs.map((d) => d.id);
    const reportIds = new Set<string>();
    for (const a of Array.isArray(order?.attachments) ? order.attachments : []) if (a?.reportId) reportIds.add(a.reportId);
    const or: any[] = [{ documentId: { in: docIds } }, { invoiceDocumentId: { in: docIds } }];
    if (jobs.length) or.push({ deliveryId: { in: jobs.map((j: any) => j.id) } });
    if (reportIds.size) or.push({ id: { in: [...reportIds] } });
    if (order) or.push({ serviceData: { path: ['orderId'], equals: order.id } });
    const reports = await this.db.maintenanceServiceReport.findMany({ where: { organizationId: orgId, OR: or }, select: { id: true, reportNumber: true, serviceData: true, invoiceDocumentId: true, kind: true }, orderBy: { reportNumber: 'asc' } });
    const customerId = order?.customerId || inv.config?.customerId || inv.config?.customer?.id || null;
    const sourceCustomer = customerId
      ? await this.db.customer.findFirst({ where: { id: customerId, organizationId: orgId }, select: { id: true, name: true, uen: true, email: true, phone: true, address: true, gstRegNo: true, customerCode: true } })
      : null;
    return { order, docs, jobs, reports, sourceCustomer };
  }

  /** Every other part of the splits among `docs` (part 1 lists them in partIds; a part names part 1 as groupId), to a fixed point. */
  private async splitPartsOf(orgId: string, docs: any[]): Promise<any[]> {
    const seen = new Set<string>(docs.map((d) => d.id));
    const out: any[] = [];
    let frontier = docs;
    for (let round = 0; round < 3 && frontier.length; round++) {
      const want = withSplitPartIds([...seen], frontier).filter((x) => !seen.has(x));
      if (!want.length) break;
      want.forEach((x) => seen.add(x));
      frontier = await this.db.document.findMany({ where: { id: { in: want }, organizationId: orgId }, select: DOC_SELECT });
      out.push(...frontier);
    }
    return out;
  }

  /** Payments / allocations, live ledger entries, other credit notes, per document id. */
  private async blockersOf(orgId: string, docs: UnitDoc[]) {
    const ids = docs.map((d) => d.id);
    const [pays, jes, cns] = await Promise.all([
      this.db.payment.findMany({ where: { organizationId: orgId, documentId: { in: ids } }, select: { documentId: true } }),
      this.db.journalEntry.findMany({ where: { organizationId: orgId, sourceDocumentId: { in: ids }, status: { not: 'VOID' } }, select: { sourceDocumentId: true } }),
      this.db.document.findMany({ where: { organizationId: orgId, type: { in: CN_TYPES } }, select: { id: true, config: true } }).then((rows: any[]) =>
        rows.filter((r) => ids.includes(r.config?.sourceDocumentId) && r.config?.voided !== true && !r.config?.gstMove?.credits),
      ),
    ]);
    const payments = new Set<string>(pays.map((p: any) => p.documentId));
    for (const d of docs) if ((amountPaidOf(d.config) ?? 0) > 0) payments.add(d.id);
    return { payments, liveJournals: new Set<string>(jes.map((j: any) => j.sourceDocumentId)), otherCredits: new Set<string>(cns.map((c: any) => c.config.sourceDocumentId)) };
  }

  private async prepare(invoiceId: string, orgId: string, wantGst: boolean) {
    const inv = await this.invoiceOf(invoiceId, orgId);
    const state = await this.switchState(orgId);
    if (!state.on || !state.partner) throw bad('The GST switch is not available for this company.');
    if (state.gst === wantGst) return { inv, state, same: true as const };
    const unit = await this.loadUnit(orgId, inv);
    if (unit.order && isImportedOrder(unit.order)) throw bad(`${unit.order.orderNumber} is an imported order and can't be moved.`);
    const sc = unit.jobs.length ? await this.db.deliverySiteClockJob.count({ where: { deliveryId: { in: unit.jobs.map((j) => j.id) } } }) : 0;
    if (sc > 0) throw bad('A job on this order is synced to SiteClock and can not be moved.');
    const plan = planUnit(unit.docs, await this.blockersOf(orgId, unit.docs));
    return { inv, state, same: false as const, unit, plan };
  }

  /** What the switch would do (for the confirm pop-up). */
  async preview(invoiceId: string, orgId: string, wantGst: boolean) {
    const p = await this.prepare(invoiceId, orgId, wantGst);
    if (p.same) return { same: true, blocked: null, headline: null, documents: [], creditNotes: [], to: null };
    const { unit, plan, state } = p;
    const unitName = unit.order?.orderNumber ?? p.inv.name ?? 'This invoice';
    const docCount = unit.docs.length + unit.jobs.length + unit.reports.length;
    const order = (t: string) => (isQuotationType(t) ? 0 : isDoType(t) ? 1 : 2);
    const documents = [
      ...[...unit.docs]
        .sort((a, b) => order(a.type) - order(b.type) || String(a.name).localeCompare(String(b.name)))
        .map((d) => {
          const sp = isInvoiceType(d.type) ? splitOf(d.config) : null;
          return { id: d.id, kind: sp ? `Invoice (part ${sp.part} of ${sp.of})` : TYPE_LABEL(d.type), name: d.name, status: d.status, action: plan.credit.some((c) => c.id === d.id) ? 'credit' : 'move' };
        }),
      ...unit.jobs.map((j) => ({ id: j.id, kind: 'Job', name: `#${j.deliveryNumber}`, status: null, action: 'move' })),
      // UAT 25 Nov: the DOs' sign-off / start records are MaintenanceServiceReport rows too; name them as such.
      ...unit.reports.map((r: any) => {
        const label = reportRowLabel(r.kind);
        return { id: r.id, kind: label, name: srNumberOf(r.serviceData) ?? (r.reportNumber ? `#${String(r.reportNumber).padStart(6, '0')}` : label), status: null, action: 'move' };
      }),
    ];
    const creditNotes = plan.credit.map((d) => ({ invoiceId: d.id, invoice: d.name, amount: owedOf(d.config), already: !!d.config?.gstMove?.creditNote?.id }));
    return {
      same: false,
      blocked: plan.blocked,
      headline: moveHeadline(unitName, docCount, state.partner!.name),
      to: state.partner,
      toGst: wantGst,
      documents,
      creditNotes,
    };
  }

  private async nextNumber(tx: any, orgId: string, type: 'QUOTATION' | 'DELIVERY_ORDER' | 'INVOICE', templateId: string | null, when: Date, org: any): Promise<string> {
    await tx.$executeRawUnsafe('SELECT pg_advisory_xact_lock(hashtext($1))', `doc-number:${orgId}:${type}`);
    const numbering = new DocumentNumberingService(this.db);
    const n = await numbering.issueNumberLocked(orgId, type, null, when, tx);
    if (n) return n;
    const tpl = templateId ? await tx.documentTemplate.findUnique({ where: { id: templateId }, select: { templateVariant: true } }) : null;
    const custom = (org?.customDocumentTypes as Record<string, string> | null) || null;
    const prefix = `${tpl?.templateVariant || custom?.[type] || type}${when.getFullYear()}${String(when.getMonth() + 1).padStart(2, '0')}-`;
    return legacySerialName(tx, orgId, prefix);
  }

  /** Switch the invoice to GST / non-GST: move the order to the partner company (see the top of this file). */
  async move(invoiceId: string, orgId: string, wantGst: boolean, actor: DocumentActor & { isAdmin?: boolean }) {
    if (tenancyOn()) throw bad('The GST switch is not available in this environment.');
    const p = await this.prepare(invoiceId, orgId, wantGst);
    if (p.same) {
      // Same company: only the invoice's own setting (a draft) follows the company.
      if (isDraftStatus(p.inv.status) && invoiceIsGst(p.inv.config) !== wantGst) {
        await this.db.document.update({ where: { id: p.inv.id }, data: { config: taxedInvoiceConfig(p.inv.config, wantGst) } });
      }
      return { moved: false, invoiceId: p.inv.id, orgId };
    }
    const { unit, plan, state } = p;
    if (plan.blocked) throw bad(plan.blocked);
    const target = state.partner!;
    if (!actor.isAdmin) {
      const member = await memberOrgIds(this.db, actor.id, [target.id]);
      if (!member.has(target.id)) throw bad(`You do not have access to ${target.name}.`);
    }
    const [src, dst, dstUi] = await Promise.all([
      this.db.organization.findUnique({ where: { id: orgId }, select: { id: true, name: true } }),
      this.db.organization.findUnique({ where: { id: target.id }, select: { id: true, name: true, address: true, phoneNumber: true, registrationNumber: true, customDocumentTypes: true, taxRate: true } }),
      this.db.organizationUIConfig.findUnique({ where: { organizationId: target.id }, select: { features: true } }),
    ]);
    const from = { id: src.id, name: src.name ?? '' };
    const to = { id: dst.id, name: dst.name ?? '', address: dst.address, phoneNumber: dst.phoneNumber, registrationNumber: dst.registrationNumber };
    const at = new Date();
    const atIso = at.toISOString();
    const today = atIso.slice(0, 10);
    const by = actor.name || actor.email || actor.id || null;

    // Templates of the target company, per kind.
    const tplOf: Record<string, string> = {};
    for (const k of ['QUOTATION', 'DELIVERY_ORDER', 'INVOICE']) tplOf[k] = await this.documents.resolveTemplateIdForType(k, target.id);

    // The target customer (UEN, then exact name; created in the transaction when missing).
    const srcCust = unit.sourceCustomer;
    let dstCust: any = null;
    if (srcCust) {
      const cands = await this.db.customer.findMany({
        where: { organizationId: target.id, OR: [...(srcCust.uen ? [{ uen: { equals: srcCust.uen, mode: 'insensitive' } }] : []), { name: srcCust.name.trim() }] },
        select: { id: true, name: true, uen: true, customerCode: true },
      });
      dstCust = matchCustomer(srcCust, cands);
    }

    // ── 2. credit notes in the source company ──
    const credited: Array<{ inv: UnitDoc; cnId: string; cnName: string }> = [];
    for (const d of plan.credit) {
      const done = d.config?.gstMove?.creditNote;
      if (done?.id) {
        credited.push({ inv: d, cnId: done.id, cnName: done.number });
        continue;
      }
      const amount = owedOf(d.config);
      const cnTemplate = await this.documents.resolveTemplateIdForType('CREDIT_NOTE', orgId);
      const cfg = creditNoteConfig({ id: d.id, name: d.name, config: d.config }, { date: today, to: target, gstLabel: gstLabel(wantGst) });
      const cn: any = await this.documents.createBasicDocument(cnTemplate, 'CREDIT_NOTE', orgId, cfg, undefined, actor, undefined, { lockedNumber: true, keepGstMove: true });
      const saved = await this.db.document.update({ where: { id: cn.id }, data: { status: 'confirmed' }, select: { id: true, name: true, config: true } });
      await this.documents.repostGlForDocument(orgId, saved.id, 'CREDIT_NOTE', saved.config, saved.name, actor);
      const je = await this.db.journalEntry.count({ where: { organizationId: orgId, sourceDocumentId: saved.id, status: { not: 'VOID' } } });
      if (!je) throw bad(`Credit note ${saved.name} could not be posted. Nothing else was changed; it is a draft in ${from.name}.`);
      const custId = d.config?.customerId || d.config?.customer?.id;
      if (amount > 0 && custId) {
        await this.receipts.createOffset(orgId, { customerId: custId, date: today, remarks: `${saved.name} credits ${d.name} (moved to ${target.name})`, debits: [{ documentId: d.id, amount }], credits: [{ documentId: saved.id, amount }] } as any, actor);
      }
      const fresh = await this.db.document.findFirst({ where: { id: d.id, organizationId: orgId }, select: { config: true } });
      const marked = { ...(fresh?.config || {}), gstMove: { creditNote: { id: saved.id, number: saved.name }, toOrgId: target.id, toOrgName: target.name } };
      await this.db.document.update({ where: { id: d.id }, data: { config: marked } });
      d.config = marked;
      credited.push({ inv: d, cnId: saved.id, cnName: saved.name });
      this.actionLog.log({ actorType: 'USER', actorId: actor.id || 'unknown', actorName: actor.name, actorEmail: actor.email, organizationId: orgId, channel: 'portal', action: 'CREDIT', resource: 'document', resourceId: saved.id, details: { gstSwitch: true, creditNote: saved.name, credits: d.name, amount, movedTo: target.name } });
    }

    // A3 files (2026-11-25): the moved records' own files, re-registered to the target in the transaction below.
    const fileKeys = await this.fileKeysOf(orgId, unit, plan.move.map((d) => d.id));

    // ── 3. one transaction: the move ──
    const formatId = unit.order ? (await ensureOrderNumberFormat(this.db, target.id)).id : null;
    const result = await this.db.$transaction(
      async (tx: any) => {
        if (srcCust && !dstCust) {
          const code = await this.freeCustomerCode(tx, target.id, srcCust);
          const emailTaken = srcCust.email ? await tx.customer.count({ where: { organizationId: target.id, email: srcCust.email } }) : 0;
          dstCust = await tx.customer.create({
            data: { organizationId: target.id, name: srcCust.name, uen: srcCust.uen, email: emailTaken ? null : srcCust.email, phone: srcCust.phone, address: srcCust.address, gstRegNo: srcCust.gstRegNo, customerCode: code },
            select: { id: true, name: true, uen: true, customerCode: true },
          });
        }
        const customer = dstCust ? { id: dstCust.id, name: dstCust.name, customerCode: dstCust.customerCode ?? null } : null;

        // Order number first, then every document's new number (rows renamed at once so the next scan sees them).
        let orderNumber: string | null = null;
        if (unit.order) orderNumber = await issueOrderNumberInTx(this.db, tx, target.id, formatId!, at);
        const renames = new Map<string, string>();
        const newNames = new Map<string, string>();
        const kindRank = (t: string) => (isQuotationType(t) ? 0 : isDoType(t) ? 1 : 2);
        // Split payment parts (2026-11-25): ONE new invoice number per split group, the parts are <number>-1..-n.
        const splitBase = new Map<string, string>();
        const partName = async (d: UnitDoc): Promise<string | null> => {
          const sp = isInvoiceType(d.type) ? splitOf(d.config) : null;
          if (!sp) return null;
          if (!splitBase.has(sp.groupId)) splitBase.set(sp.groupId, await this.nextNumber(tx, target.id, 'INVOICE', tplOf.INVOICE, at, dst));
          return movedPartNumber(splitBase.get(sp.groupId)!, Number(sp.part));
        };
        for (const d of [...plan.move].sort((a, b) => kindRank(a.type) - kindRank(b.type))) {
          const nt = numberingTypeOf(d.type)!;
          const n = (await partName(d)) ?? (await this.nextNumber(tx, target.id, nt, tplOf[nt], at, dst));
          await tx.document.update({ where: { id: d.id }, data: { name: n, organizationId: target.id, documentTemplateId: tplOf[nt], projectId: null } });
          if (d.name) renames.set(d.name, n);
          newNames.set(d.id, n);
        }
        if (unit.order) renames.set(unit.order.orderNumber, orderNumber!);
        // Re-issued invoices (target, draft) for the credited ones.
        const reissued: Array<{ oldId: string; oldName: string | null; newId: string; newName: string; creditNoteId: string; creditNoteName: string; templateId: string | null }> = [];
        for (const c of credited) {
          const n = (await partName(c.inv)) ?? (await this.nextNumber(tx, target.id, 'INVOICE', tplOf.INVOICE, at, dst));
          const id = randomUUID();
          await tx.document.create({ data: { id, type: 'INVOICE', name: n, organizationId: target.id, documentTemplateId: tplOf.INVOICE, status: 'draft', revisionNumber: 0, config: {} } });
          reissued.push({ oldId: c.inv.id, oldName: c.inv.name, newId: id, newName: n, creditNoteId: c.cnId, creditNoteName: c.cnName, templateId: tplOf.INVOICE });
        }
        const swap = new Map(reissued.map((r) => [r.oldId, r.newId]));
        const ctxFor = (number: string, previousNumber: string | null): MoveCtx => ({ number, previousNumber, from, to, customer, renames, orderNumber, at: atIso, by });
        const remap = (c: any) => {
          if (typeof c?.orderInvoiceId === 'string' && swap.has(c.orderInvoiceId)) c.orderInvoiceId = swap.get(c.orderInvoiceId);
          return c;
        };
        // A split part keeps its split: ids follow the re-issues, the group's new base number, part 1's Undo-split
        // snapshot renumbered and re-taxed (gst-switch.ts splitAfterMove).
        const rate = Number(dst.taxRate) || 9;
        const keepSplit = (cfg: any) =>
          splitAfterMove(cfg, {
            swap,
            baseOf: (g) => splitBase.get(g),
            restoreConfig: (rc, base) => taxedInvoiceConfig(movedConfig(rc, ctxFor(base, String(rc?.documentNumber ?? rc?.documentInfo?.documentNumber ?? '') || null)), wantGst, rate),
          });
        // Configs of the moved documents.
        const movedInvoiceCfg = new Map<string, any>();
        for (const d of plan.move) {
          let cfg = remap(movedConfig(d.config, ctxFor(newNames.get(d.id)!, d.name)));
          if (isInvoiceType(d.type)) cfg = keepSplit(taxedInvoiceConfig(cfg, wantGst, rate));
          else if (isQuotationType(d.type)) cfg = taxedQuotationConfig(cfg, wantGst, Number(dst.taxRate) || 9);
          if (isInvoiceType(d.type)) movedInvoiceCfg.set(d.id, cfg);
          await tx.document.update({ where: { id: d.id }, data: { config: cfg } });
        }
        // UAT 2026-11-25: a split group is re-taxed together (invoice-split.ts retaxedSplitTotals), so the parts' GST
        // still adds up to the unsplit GST; the last part takes the leftover cent.
        for (const fixed of splitGroupRetax([...movedInvoiceCfg.entries()], { gstPercent: rate, taxApplicable: wantGst ? 'Y' : 'N' })) {
          await tx.document.update({ where: { id: fixed.id }, data: { config: fixed.config } });
        }
        for (const r of reissued) {
          const c = credited.find((x) => x.inv.id === r.oldId)!;
          let cfg = remap(reissuedInvoiceConfig(c.inv.config, ctxFor(r.newName, c.inv.name), wantGst, { invoiceId: r.oldId, creditNoteId: r.creditNoteId, creditNoteNumber: r.creditNoteName }));
          const sp = splitOf(c.inv.config);
          if (sp) cfg = keepSplit({ ...cfg, invoiceSplit: sp });
          if (unit.order) cfg.orderId = unit.order.id;
          await tx.document.update({ where: { id: r.newId }, data: { config: cfg } });
          // The credited invoice and its credit note point at the re-issue (source company rows; money untouched).
          const o = await tx.document.findUnique({ where: { id: r.oldId }, select: { config: true } });
          await tx.document.update({ where: { id: r.oldId }, data: { config: { ...(o?.config || {}), gstMove: { ...((o?.config as any)?.gstMove || {}), reissued: { id: r.newId, number: r.newName, orgId: target.id, orgName: target.name } } } } });
          const cn = await tx.document.findUnique({ where: { id: r.creditNoteId }, select: { config: true } });
          await tx.document.update({ where: { id: r.creditNoteId }, data: { config: { ...(cn?.config || {}), gstMove: { ...((cn?.config as any)?.gstMove || {}), reissued: { id: r.newId, number: r.newName, orgId: target.id, orgName: target.name } } } } });
        }
        // The order.
        if (unit.order) {
          const templateOf = (_old: string | null | undefined, kind: string) => (kind === 'quotation' ? tplOf.QUOTATION : kind === 'do' ? tplOf.DELIVERY_ORDER : kind === 'invoice' ? tplOf.INVOICE : null);
          const ld = orderLinksAfterMove(unit.order.linkedDocuments, { renames, reissued, from, previousOrderNumber: unit.order.orderNumber, at: atIso, templateOf });
          await tx.order.update({
            where: { id: unit.order.id },
            data: {
              organizationId: target.id,
              orderNumber: orderNumber!,
              customerId: customer?.id ?? unit.order.customerId,
              linkedDocuments: ld,
              ...(unit.order.invoiceDocumentId && swap.has(unit.order.invoiceDocumentId) ? { invoiceDocumentId: swap.get(unit.order.invoiceDocumentId) } : {}),
            },
          });
        }
        // Jobs: next job numbers in the target.
        if (unit.jobs.length) {
          const max = await tx.delivery.aggregate({ where: { organizationId: target.id }, _max: { deliveryNumber: true } });
          let next = (max?._max?.deliveryNumber ?? 0) + 1;
          for (const j of unit.jobs) {
            await tx.delivery.update({
              where: { id: j.id },
              data: { organizationId: target.id, deliveryNumber: next++, projectId: null, ...(customer ? { customerId: customer.id } : {}), ...(j.orderInvoiceId && swap.has(j.orderInvoiceId) ? { orderInvoiceId: swap.get(j.orderInvoiceId) } : {}) },
            });
          }
          await tx.jobPhoto.updateMany({ where: { deliveryId: { in: unit.jobs.map((j) => j.id) } }, data: { organizationId: target.id } });
        }
        // Service reports: next report numbers; the brand follows the target company.
        if (unit.reports.length) {
          const max = await tx.maintenanceServiceReport.aggregate({ where: { organizationId: target.id }, _max: { reportNumber: true } });
          let next = (max?._max?.reportNumber ?? 0) + 1;
          const brand = (dstUi?.features as any)?.serviceReportTemplate;
          for (const r of unit.reports) {
            const sd: any = { ...(r.serviceData || {}) };
            if (brand) sd.brand = brand;
            else delete sd.brand;
            if (typeof sd.doNumber === 'string' && renames.has(sd.doNumber)) sd.doNumber = renames.get(sd.doNumber);
            if (r.reportNumber) sd.previousReportNumber = r.reportNumber;
            await tx.maintenanceServiceReport.update({
              where: { id: r.id },
              data: { organizationId: target.id, reportNumber: r.reportNumber ? next++ : null, serviceData: sd, ...(r.invoiceDocumentId && swap.has(r.invoiceDocumentId) ? { invoiceDocumentId: swap.get(r.invoiceDocumentId) } : {}) },
            });
          }
          await tx.$executeRawUnsafe(`UPDATE "ServiceReportSignLink" SET "organizationId" = $1 WHERE "organizationId" = $2 AND "reportIds" && $3::text[]`, target.id, orgId, unit.reports.map((r) => r.id));
        }
        const files = await this.moveFiles(tx, fileKeys, orgId, target.id, `moved with ${unit.order?.orderNumber ?? p.inv.name ?? 'an invoice'} to ${target.name} (GST switch)`);
        const movedIds = plan.move.map((d) => d.id);
        if (movedIds.length) {
          await tx.documentEmbedding.updateMany({ where: { documentId: { in: movedIds } }, data: { organizationId: target.id, ...(customer ? { customerId: customer.id } : {}) } });
          await tx.priceHistory.updateMany({ where: { documentId: { in: movedIds } }, data: { organizationId: target.id, ...(customer ? { customerId: customer.id } : {}) } });
        }
        return { orderNumber, newNames, reissued, customer, files };
      },
      { timeout: 60000, maxWait: 15000 },
    );

    // ── 4. status, history, Activity Log ──
    if (unit.order) await refreshOrderStatus(this.db, target.id, unit.order.id);
    const rows: Array<{ id: string; kind: string; from: string | null; to: string }> = [
      ...(unit.order ? [{ id: unit.order.id, kind: 'order', from: unit.order.orderNumber, to: result.orderNumber! }] : []),
      ...plan.move.map((d) => ({ id: d.id, kind: TYPE_LABEL(d.type), from: d.name, to: result.newNames.get(d.id)! })),
      ...result.reissued.map((r) => ({ id: r.newId, kind: 'Invoice (re-issued)', from: r.oldName, to: r.newName })),
    ];
    for (const r of rows) {
      const details = { gstSwitch: true, kind: r.kind, oldNumber: r.from, newNumber: r.to, fromOrg: from.name, toOrg: target.name, toGst: wantGst, ...(r.kind === 'order' || !unit.order ? { files: result.files } : {}) };
      for (const oid of [orgId, target.id]) {
        this.actionLog.log({ actorType: 'USER', actorId: actor.id || 'unknown', actorName: actor.name, actorEmail: actor.email, organizationId: oid, channel: 'portal', action: 'MOVE', resource: r.kind === 'order' ? 'order' : 'document', resourceId: r.id, details });
      }
      if (r.kind !== 'order') {
        void this.documents.logMoveHistory({ documentId: r.id, organizationId: target.id, documentName: r.to, actor, detail: r.from ? `Moved from ${from.name} (previously ${r.from}) to ${target.name} as ${r.to} (${gstLabel(wantGst)})` : `Made in ${target.name} as ${r.to}` });
      }
    }
    for (const c of credited) {
      void this.documents.logMoveHistory({ documentId: c.inv.id, organizationId: orgId, documentName: c.inv.name ?? undefined, actor, detail: `Credited in full by ${c.cnName}; re-issued by ${target.name} as ${result.reissued.find((r) => r.oldId === c.inv.id)?.newName}` });
    }
    // Where the person lands: the switched invoice in the target company.
    const landing = result.reissued.find((r) => r.oldId === p.inv.id)?.newId ?? p.inv.id;
    return {
      moved: true,
      to: target,
      orderId: unit.order?.id ?? null,
      orderNumber: result.orderNumber,
      invoiceId: landing,
      templateId: tplOf.INVOICE,
      renamed: rows,
      creditNotes: credited.map((c) => ({ invoice: c.inv.name, creditNote: c.cnName })),
      files: result.files,
    };
  }

  /**
   * The S3 keys of the moved records' own files: the moved documents (config + attachments), the order (its
   * attachments: uploaded completed DOs, service report files), the jobs (stamped DO photos), their job photos and
   * every moved service report (photos, files). Company-wide files are left out (gst-switch.ts recordFileKeys).
   */
  private async fileKeysOf(orgId: string, unit: Unit, movedDocIds: string[]): Promise<string[]> {
    const jobIds = unit.jobs.map((j) => j.id);
    const [docs, jobs, photos, reports] = await Promise.all([
      movedDocIds.length ? this.db.document.findMany({ where: { id: { in: movedDocIds }, organizationId: orgId } }) : [],
      jobIds.length ? this.db.delivery.findMany({ where: { id: { in: jobIds }, organizationId: orgId } }) : [],
      jobIds.length ? this.db.jobPhoto.findMany({ where: { deliveryId: { in: jobIds } }, select: { fileKey: true, thumbKey: true } }) : [],
      unit.reports.length ? this.db.maintenanceServiceReport.findMany({ where: { id: { in: unit.reports.map((r) => r.id) }, organizationId: orgId } }) : [],
    ]);
    const values = [
      ...storedFileValues([docs, unit.order, jobs, reports], 20000),
      ...(photos as any[]).flatMap((p) => [p.fileKey, p.thumbKey]),
    ];
    return recordFileKeys(values.map((v) => normalizeStoredKey(v)));
  }

  /** Re-register the keys from `from` to `to` in the StoredFile registry (the keys themselves never change). */
  private async moveFiles(tx: any, keys: string[], from: string, to: string, note: string): Promise<{ moved: number; shared: number }> {
    if (!keys.length) return { moved: 0, shared: 0 };
    const rows: any[] = await tx.storedFile.findMany({ where: { key: { in: keys } }, select: { key: true, organizationId: true, quarantined: true, sharedOrgIds: true } });
    const byKey = new Map(rows.map((r) => [r.key, r]));
    let moved = 0;
    let shared = 0;
    for (const key of keys) {
      const row = byKey.get(key) ?? null;
      const { op } = fileMoveOf(key, row, orgOfKey(key), from, to);
      if (op === 'update') {
        await tx.storedFile.update({ where: { key }, data: { organizationId: to, note } });
        moved++;
      } else if (op === 'create') {
        await tx.storedFile.create({ data: { key, organizationId: to, source: 'gst-switch', note } });
        moved++;
      } else if (op === 'share') {
        await tx.storedFile.update({ where: { key }, data: { sharedOrgIds: [...(row.sharedOrgIds ?? []), to] } });
        shared++;
      }
    }
    return { moved, shared };
  }

  /**
   * A7 (2026-11-25): a document opened in a company it was moved OUT of by the GST switch. With access to where it
   * is now (active membership + role, or a platform admin): its link there. Without: only where to go back to (the
   * same type's list in the current company) and "<no.> moved to <company>". Never changes anyone's access.
   */
  async whereMoved(documentId: string, orgId: string, viewer: { userId?: string | null; isAdmin?: boolean }) {
    const none = { moved: false as const };
    try {
      const doc = await this.db.document.findFirst({ where: { id: documentId }, select: { id: true, type: true, name: true, organizationId: true, documentTemplateId: true, config: true } });
      if (!doc || doc.organizationId === orgId) return none;
      const hist: any[] = Array.isArray(doc.config?.movedFrom) ? doc.config.movedFrom : doc.config?.movedFrom ? [doc.config.movedFrom] : [];
      const fromHere = [...hist].reverse().find((h) => h?.orgId === orgId && h?.reason === 'gst-switch');
      if (!fromHere) return none;
      if (!(await groupOrgIds(this.db, orgId)).includes(doc.organizationId)) return none;
      const org = await this.db.organization.findUnique({ where: { id: doc.organizationId }, select: { id: true, name: true } });
      const canOpen = !!viewer.isAdmin || (await memberOrgIds(this.db, viewer.userId ?? null, [doc.organizationId])).has(doc.organizationId);
      const listPath = isQuotationType(doc.type) ? '/portal/sales/quotations' : isDoType(doc.type) ? '/portal/sales/delivery-orders' : '/portal/sales/invoices';
      const number = String(fromHere.number || doc.name || 'This document');
      return {
        moved: true as const,
        number,
        to: { id: doc.organizationId, name: org?.name ?? '' },
        canOpen,
        listPath,
        message: `${number} moved to ${org?.name ?? 'another company'}`,
        ...(canOpen && doc.documentTemplateId ? { path: `/portal/documents/${doc.type}/${doc.documentTemplateId}/${doc.id}`, newNumber: doc.name } : {}),
      };
    } catch {
      return none;
    }
  }

  /** The source customer's code when free in the target, else the next C<letter><n>. */
  private async freeCustomerCode(tx: any, orgId: string, src: { name: string; customerCode: string | null }): Promise<string | null> {
    if (src.customerCode && !(await tx.customer.count({ where: { organizationId: orgId, customerCode: src.customerCode } }))) return src.customerCode;
    const letter = src.name?.normalize('NFD').toUpperCase().match(/[A-Z0-9]/)?.[0] || 'X';
    const prefix = `C${letter}`;
    const rows: Array<{ customerCode: string | null }> = await tx.customer.findMany({ where: { organizationId: orgId, customerCode: { startsWith: prefix } }, select: { customerCode: true } });
    let max = 0;
    for (const r of rows) {
      const m = r.customerCode?.slice(prefix.length).match(/^(\d+)$/);
      if (m) max = Math.max(max, parseInt(m[1], 10));
    }
    return `${prefix}${String(max + 1).padStart(3, '0')}`;
  }
}
