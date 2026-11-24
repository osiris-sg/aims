/**
 * GST switch with company move (WCT group, 2026-11-24). Pure rules; the database side is gst-switch.service.ts.
 *
 * Two sister companies of one group issue invoices: one GST registered (WCT (S): "GST invoice"), one not (BC Air:
 * "Non-GST invoice"). The toggle inside an invoice moves the invoice's WHOLE order (quotations, DOs, invoices, jobs,
 * service reports, links) to the other company:
 *  - drafts (and quotations / DOs) move: new numbers in the target company's sequences, "Previously <no.>" kept;
 *  - a confirmed invoice (posted, no payment) stays in the source company and is credited there by a full CREDIT NOTE
 *    (posted the normal way, matched to the invoice by a Manual Offset so the source AR goes down), and a matching
 *    DRAFT invoice is made in the target company with the target's GST setting (for review before confirm);
 *  - anything with a payment or an allocation (receipt, offset, credit note) blocks the move, nothing changes.
 *
 * Which companies: the switch is on for an org with enableWctOrders AND enableManualOrderFlow whose group (root +
 * children, Organization.parentOrgId) has exactly ONE other org with both flags: that org is the partner. The group's
 * ROOT company issues GST invoices, the child company non-GST invoices (WCT (S) root, BC Air child). No org id is
 * hard-coded; features.gstSwitchOff = true turns it off for an org. Every other org: off, nothing changes.
 */
import { computeDocumentTotals, stampDocumentMoney } from '../common/document-money';

export const GST_SWITCH_OFF_FLAG = 'gstSwitchOff';
export const INVOICE_TYPES = ['INVOICE', 'TI', 'TI2', 'TAX_INVOICE'];
export const QUOTATION_TYPES = ['QUOTATION', 'QO', 'QO1', 'QO2', 'QT'];
export const DO_TYPES = ['DELIVERY_ORDER', 'DO'];
export const CN_TYPES = ['CREDIT_NOTE', 'CN'];
export const DRAFT_STATUSES = ['draft', 'unconfirmed'];

export const isInvoiceType = (t: unknown) => INVOICE_TYPES.includes(String(t ?? '').toUpperCase());
export const isQuotationType = (t: unknown) => QUOTATION_TYPES.includes(String(t ?? '').toUpperCase());
export const isDoType = (t: unknown) => DO_TYPES.includes(String(t ?? '').toUpperCase());
export const isDraftStatus = (s: unknown) => DRAFT_STATUSES.includes(String(s ?? '').toLowerCase());

/** The numbering type of a document (what DocumentNumberFormat.documentType names). */
export function numberingTypeOf(type: unknown): 'QUOTATION' | 'DELIVERY_ORDER' | 'INVOICE' | null {
  if (isQuotationType(type)) return 'QUOTATION';
  if (isDoType(type)) return 'DELIVERY_ORDER';
  if (isInvoiceType(type)) return 'INVOICE';
  return null;
}

export interface SwitchOrg {
  id: string;
  name: string;
  parentOrgId: string | null;
  features: Record<string, unknown> | null;
}

const flagOn = (f: Record<string, unknown> | null | undefined, k: string) => f?.[k] === true || f?.[k] === 'true';
const eligible = (o: SwitchOrg) => flagOn(o.features, 'enableWctOrders') && flagOn(o.features, 'enableManualOrderFlow') && !flagOn(o.features, GST_SWITCH_OFF_FLAG);

export interface GstSwitchState {
  on: boolean;
  /** This company issues GST invoices. */
  gst: boolean;
  partner: { id: string; name: string } | null;
}

/** The switch for `orgId` from its group's orgs (root + children). Off unless exactly one eligible partner. */
export function gstSwitchStateOf(orgId: string, group: SwitchOrg[]): GstSwitchState {
  const me = group.find((o) => o.id === orgId);
  const off: GstSwitchState = { on: false, gst: true, partner: null };
  if (!me || !eligible(me)) return off;
  const partners = group.filter((o) => o.id !== orgId && eligible(o));
  if (partners.length !== 1) return off;
  const p = partners[0];
  // Same group only: one is the other's parent.
  const root = me.parentOrgId ? me.parentOrgId : me.id;
  if ((p.parentOrgId ? p.parentOrgId : p.id) !== root) return off;
  return { on: true, gst: !me.parentOrgId, partner: { id: p.id, name: p.name } };
}

const R2 = (n: number) => Math.round((n + Number.EPSILON) * 100) / 100;
const isDisplayRow = (l: any): boolean => !l || !!l.isGroupHeader || !!l.isTagGroup;

/** The invoice's config with the company's GST setting: 'Y' at gstPercent (default 9) or 'N'; totals and money re-stamped (unpaid). */
export function taxedInvoiceConfig(config: any, gst: boolean, gstPercent = 9): any {
  const c: any = { ...(config || {}) };
  const di: any = { ...(c.documentInfo || {}) };
  const ta = gst ? 'Y' : 'N';
  const own = Number(c.gstPercent ?? di.gstPercent);
  const pct = own > 0 ? own : gstPercent;
  const absorbTax = c.absorbTax ?? di.absorbTax ?? 'N';
  const items = (Array.isArray(c.items) ? c.items : []).filter((l: any) => !isDisplayRow(l));
  const discount = Number(c.discountAmount ?? di.discountAmount) || 0;
  const t = computeDocumentTotals(items, { gstPercent: pct, taxApplicable: ta, absorbTax }, { discountAmount: discount });
  const totals = { grossTotal: t.grossTotal, subTotal: t.subTotal, gstAmount: t.gstAmount, nettTotal: t.nettTotal };
  const out = { ...c, taxApplicable: ta, gstPercent: pct, ...totals, documentInfo: { ...di, taxApplicable: ta, gstPercent: pct, ...totals } };
  return stampDocumentMoney(out, { gross: t.nettTotal, outstanding: t.nettTotal, paid: 0 });
}

/** The GST reading of an invoice config: false only for taxApplicable 'N' / false. */
export function invoiceIsGst(config: any): boolean {
  const v = config?.taxApplicable ?? config?.documentInfo?.taxApplicable;
  return !(v === 'N' || v === false || v === 'n');
}

/** Keys never carried onto a re-issued invoice (identity, pay link, sends, sync, split, money stamps). */
const NOT_CARRIED = ['payToken', 'savedAt', 'savedBy', 'confirmedAt', 'sentAt', 'emailedAt', 'xeroInvoiceId', 'xeroSyncedAt', 'invoiceSplit', 'voided', 'voidedAt', 'voidedBy', 'voidReason', 'gstMove', 'locked', 'lockedAt', 'lockedBy'];

export interface MoveCtx {
  number: string;
  previousNumber: string | null;
  from: { id: string; name: string };
  to: { id: string; name: string; address?: string | null; phoneNumber?: string | null; registrationNumber?: string | null };
  customer: { id: string; name: string; customerCode: string | null } | null;
  /** Old number -> new number of every moved document (for links / source numbers / DO lists). */
  renames: Map<string, string>;
  orderNumber: string | null;
  at: string;
  by: string | null;
}

/** A document's config after the move: new number, the target customer, links renamed, "Previously <no.>". */
export function movedConfig(config: any, ctx: MoveCtx): any {
  const c: any = JSON.parse(JSON.stringify(config || {}));
  const ren = (v: any) => (typeof v === 'string' && ctx.renames.has(v) ? ctx.renames.get(v) : v);
  if (c.documentNumber !== undefined) c.documentNumber = ctx.number;
  if (c.documentInfo && typeof c.documentInfo === 'object' && c.documentInfo.documentNumber !== undefined) c.documentInfo.documentNumber = ctx.number;
  if (ctx.customer) {
    if (c.customerId !== undefined || !c.customer) c.customerId = ctx.customer.id;
    if (c.customer && typeof c.customer === 'object') {
      c.customer = { ...c.customer, id: ctx.customer.id, ...(c.customer.customerCode !== undefined ? { customerCode: ctx.customer.customerCode } : {}) };
    }
    if (c.customerCode !== undefined) c.customerCode = ctx.customer.customerCode;
  }
  if (c.orderNo !== undefined && ctx.orderNumber) c.orderNo = ctx.orderNumber;
  if (c.sourceDocumentNumber !== undefined) c.sourceDocumentNumber = ren(c.sourceDocumentNumber);
  if (Array.isArray(c.deliveryOrderNos)) c.deliveryOrderNos = c.deliveryOrderNos.map(ren);
  if (Array.isArray(c.linkedDocs)) c.linkedDocs = c.linkedDocs.map((l: any) => (l && typeof l === 'object' ? { ...l, name: ren(l.name) } : l));
  if (c.company && typeof c.company === 'object') c.company = { ...c.company, name: ctx.to.name, address: ctx.to.address ?? c.company.address, phoneNumber: ctx.to.phoneNumber ?? c.company.phoneNumber };
  if (c.gstRegNo !== undefined && ctx.to.registrationNumber) c.gstRegNo = ctx.to.registrationNumber;
  const prev = Array.isArray(c.movedFrom) ? c.movedFrom : c.movedFrom ? [c.movedFrom] : [];
  if (ctx.previousNumber) {
    c.previousNumber = ctx.previousNumber;
    c.movedFrom = [...prev, { orgId: ctx.from.id, orgName: ctx.from.name, number: ctx.previousNumber, at: ctx.at, by: ctx.by, reason: 'gst-switch' }];
  }
  return c;
}

/** The re-issued invoice (target company, draft) made from a credited confirmed invoice. */
export function reissuedInvoiceConfig(original: any, ctx: MoveCtx, gst: boolean, credit: { invoiceId: string; creditNoteId: string; creditNoteNumber: string }): any {
  const base: any = { ...(original || {}) };
  for (const k of NOT_CARRIED) delete base[k];
  const moved = movedConfig(base, ctx);
  const taxed = taxedInvoiceConfig(moved, gst);
  taxed.gstMove = {
    replaces: { id: credit.invoiceId, number: ctx.previousNumber, orgId: ctx.from.id, orgName: ctx.from.name },
    creditNote: { id: credit.creditNoteId, number: credit.creditNoteNumber, orgId: ctx.from.id },
  };
  return taxed;
}

/** The credit note (source company) that credits a confirmed invoice in full. */
export function creditNoteConfig(invoice: { id: string; name: string | null; config: any }, opts: { date: string; to: { id: string; name: string }; gstLabel: string }): any {
  const c: any = JSON.parse(JSON.stringify(invoice.config || {}));
  for (const k of [...NOT_CARRIED, 'orderId', 'orderNo', 'orderJobIds', 'orderBillsQuote', 'orderLinkedDoIds', 'deliveryOrderNos', 'linkedDocs', 'documentNumber', 'erpImport', 'previousNumber', 'movedFrom', 'referenceNo', 'remarks', 'internalRemarks']) delete c[k];
  const di: any = { ...(c.documentInfo || {}) };
  delete di.documentNumber;
  delete di.referenceNo;
  const reason = `Full credit of ${invoice.name ?? 'the invoice'}: re-issued by ${opts.to.name} as a ${opts.gstLabel}`;
  di.date = opts.date;
  const out = {
    ...c,
    date: opts.date,
    documentInfo: di,
    sourceDocumentId: invoice.id,
    sourceDocumentType: 'INVOICE',
    sourceDocumentNumber: invoice.name ?? undefined,
    invoiceNo: invoice.name ?? undefined,
    reason,
    remarks: reason,
    gstMove: { credits: { id: invoice.id, number: invoice.name }, toOrgId: opts.to.id, toOrgName: opts.to.name },
  };
  const gross = Number(out.nettTotal ?? di.nettTotal);
  return stampDocumentMoney(out, Number.isFinite(gross) ? { gross, outstanding: gross, paid: 0 } : {});
}

/** Order.linkedDocuments after the move: names renamed, credited invoices swapped for their re-issues, the credits recorded. */
export function orderLinksAfterMove(
  ld: any,
  opts: {
    renames: Map<string, string>;
    reissued: Array<{ oldId: string; oldName: string | null; newId: string; newName: string; creditNoteId: string; creditNoteName: string; templateId: string | null }>;
    from: { id: string; name: string };
    previousOrderNumber: string;
    at: string;
    templateOf: (oldTemplateId: string | null | undefined, kind: string) => string | null | undefined;
  },
): any {
  const out: any = ld && typeof ld === 'object' ? JSON.parse(JSON.stringify(ld)) : { po: [], do: [], invoice: [], salesOrder: [] };
  const swap = new Map(opts.reissued.map((r) => [r.oldId, r]));
  for (const kind of ['quotation', 'invoice', 'do', 'creditNote', 'salesOrder', 'po']) {
    if (!Array.isArray(out[kind])) continue;
    out[kind] = out[kind].map((e: any) => {
      if (!e || typeof e !== 'object') return e;
      const r = swap.get(e.id);
      if (r) return { ...e, id: r.newId, name: r.newName, ...(r.templateId ? { templateId: r.templateId } : {}), reissuedFrom: { id: r.oldId, name: r.oldName, orgId: opts.from.id } };
      const name = typeof e.name === 'string' && opts.renames.has(e.name) ? opts.renames.get(e.name) : e.name;
      const t = opts.templateOf(e.templateId, kind);
      const next: any = { ...e, name, ...(t ? { templateId: t } : {}) };
      if (typeof e.orderInvoiceId === 'string' && swap.has(e.orderInvoiceId)) next.orderInvoiceId = swap.get(e.orderInvoiceId)!.newId;
      return next;
    });
  }
  if (opts.reissued.length) {
    const prev = Array.isArray(out.crossOrgCredit) ? out.crossOrgCredit : [];
    out.crossOrgCredit = [
      ...prev,
      ...opts.reissued.map((r) => ({ orgId: opts.from.id, orgName: opts.from.name, invoiceId: r.oldId, invoiceName: r.oldName, creditNoteId: r.creditNoteId, creditNoteName: r.creditNoteName, reissuedId: r.newId, reissuedName: r.newName })),
    ];
  }
  const moved = Array.isArray(out.movedFrom) ? out.movedFrom : [];
  out.movedFrom = [...moved, { orgId: opts.from.id, orgName: opts.from.name, orderNumber: opts.previousOrderNumber, at: opts.at, reason: 'gst-switch' }];
  return out;
}

export interface UnitDoc {
  id: string;
  type: string;
  name: string | null;
  status: string;
  config: any;
}

export interface Blockers {
  payments: Set<string>;
  liveJournals: Set<string>;
  otherCredits: Set<string>;
}

/**
 * What the move does with each document, or why it can't run. Confirmed invoices are credited and re-issued
 * (unless already credited by an earlier attempt, config.gstMove.creditNote); everything else moves.
 */
export function planUnit(docs: UnitDoc[], b: Blockers): { blocked: string | null; move: UnitDoc[]; credit: UnitDoc[] } {
  const move: UnitDoc[] = [];
  const credit: UnitDoc[] = [];
  for (const d of docs) {
    const label = d.name || 'A document';
    const c = d.config || {};
    if (c.erpImport) return { blocked: `${label} is imported from the old system and can't be moved.`, move: [], credit: [] };
    const already = !!c.gstMove?.creditNote?.id;
    if (!already && b.payments.has(d.id)) return { blocked: `${label} has a payment or an allocation. Nothing was changed.`, move: [], credit: [] };
    if (!already && b.otherCredits.has(d.id)) return { blocked: `${label} has a credit note. Nothing was changed.`, move: [], credit: [] };
    if (isInvoiceType(d.type) && c.invoiceSplit && isDraftStatus(d.status)) return { blocked: `${label} is a split payment part. Undo the split first.`, move: [], credit: [] };
    const confirmedInvoice = isInvoiceType(d.type) && !isDraftStatus(d.status) && c.voided !== true;
    if (confirmedInvoice) {
      credit.push(d);
      continue;
    }
    if (b.liveJournals.has(d.id)) return { blocked: `${label} has a ledger entry and can't be moved.`, move: [], credit: [] };
    move.push(d);
  }
  return { blocked: null, move, credit };
}

/** "This moves ORDW202611-001 and its 4 documents to BC Air". */
export function moveHeadline(unitName: string, docCount: number, toName: string): string {
  return `This moves ${unitName} and its ${docCount} ${docCount === 1 ? 'document' : 'documents'} to ${toName}`;
}

/** UEN as compared (upper case, no spaces). */
export const uenKey = (v: unknown) => String(v ?? '').toUpperCase().replace(/\s+/g, '');
/** Customer name as compared (exact, trimmed, case kept as the brief says "exact name"; whitespace collapsed). */
export const nameKey = (v: unknown) => String(v ?? '').trim().replace(/\s+/g, ' ');

/** The target customer: UEN first, then exact name; null = create one. */
export function matchCustomer<T extends { id: string; name: string; uen?: string | null }>(src: { name: string; uen?: string | null }, targets: T[]): T | null {
  const u = uenKey(src.uen);
  if (u) {
    const byUen = targets.find((t) => uenKey(t.uen) === u);
    if (byUen) return byUen;
  }
  const n = nameKey(src.name);
  return targets.find((t) => nameKey(t.name) === n) ?? null;
}

export const r2 = R2;
