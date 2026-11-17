/**
 * Split invoice / Undo split (features.enableInvoiceSplit): the database side.
 * The math and texts live in invoice-split.ts. DocumentsService calls these
 * with its Prisma and its history logger; the HTTP routes are
 * POST /documents/:id/split-invoice and POST /documents/:id/undo-split
 * (Activity Log chips SPLIT / UNDO_SPLIT).
 *
 * Safety:
 *  - only a draft / unconfirmed invoice with no payment, no live GL entry, not
 *    imported (config.erpImport), not synced to Xero and not already split;
 *  - only where postInvoicesOnConfirm is on, so no draft part is ever in the GL
 *    (each part posts on confirm / send through the existing path);
 *  - the numbering counter is never touched: parts are <number>-1..-n;
 *  - Undo split deletes parts 2..n only while every part is a draft with no
 *    payment and NO journal at all (live or void), so aims_doc_delete_guard
 *    never fires and no void journal is left pointing at a deleted document.
 */
import { HttpException, HttpStatus } from '@nestjs/common';
import { randomUUID } from 'crypto';
import { amountPaidOf, grossOf } from '../common/document-money';
import { isErpImported } from '../common/erp-import';
import { DRAFT_INVOICE_STATUSES, POST_INVOICES_ON_CONFIRM_FLAG } from '../common/org-features';
import { refreshOrderStatus } from '../orders/wct-orders';
import {
  dominantLineAccount,
  INVOICE_SPLIT_FLAG,
  invoiceSplitOf,
  mergedBackConfig,
  partConfig,
  planInvoiceSplit,
  restoreSnapshotOf,
  splitBaseOf,
  splitPartNumber,
  SplitPlan,
  SplitPlanError,
} from './invoice-split';

type Actor = { id?: string; name?: string; email?: string };
type LogFn = (e: { documentId: string; organizationId: string; action: 'CREATED' | 'EDITED' | 'DELETED'; detail: string; documentName?: string; actor?: Actor }) => Promise<void> | void;

const INVOICE_TYPES = ['INVOICE', 'TI', 'TI2'];
const bad = (m: string) => new HttpException(m, HttpStatus.BAD_REQUEST);
const isDraft = (s: unknown) => DRAFT_INVOICE_STATUSES.includes(String(s ?? '').toLowerCase());

async function features(prisma: any, organizationId: string): Promise<Record<string, unknown>> {
  const ui = await prisma.organizationUIConfig.findUnique({ where: { organizationId }, select: { features: true } });
  return ((ui?.features as any) || {}) as Record<string, unknown>;
}

/** Split is on for the org, and drafts stay out of the GL (postInvoicesOnConfirm). */
export async function assertSplitAllowed(prisma: any, organizationId: string) {
  const f = await features(prisma, organizationId);
  if (f[INVOICE_SPLIT_FLAG] !== true) throw bad('Split payment is not enabled for this organisation.');
  if (f[POST_INVOICES_ON_CONFIRM_FLAG] !== true) throw bad('Split payment needs invoices that post to the ledger on confirm.');
}

/** Why this invoice can't be split / merged back right now (null = it can). Money and GL checks. */
async function blockers(prisma: any, organizationId: string, docs: Array<{ id: string; name: string | null; status: string; config: any }>, opts: { anyJournal: (id: string) => boolean }) {
  for (const d of docs) {
    const label = d.name || 'This invoice';
    if (!isDraft(d.status)) return `${label} is no longer a draft.`;
    if (isErpImported(d.config)) return `${label} is imported.`;
    if (d.config?.xeroInvoiceId) return `${label} is synced to Xero.`;
    if ((amountPaidOf(d.config) ?? 0) > 0) return `${label} has a payment.`;
  }
  const ids = docs.map((d) => d.id);
  const pays = await prisma.payment.count({ where: { organizationId, documentId: { in: ids } } });
  if (pays > 0) return 'A payment is recorded on this invoice.';
  const journals = await prisma.journalEntry.findMany({ where: { organizationId, sourceDocumentId: { in: ids } }, select: { sourceDocumentId: true, status: true } });
  const hit = journals.find((j: any) => j.status !== 'VOID' || opts.anyJournal(j.sourceDocumentId));
  if (hit) return 'This invoice has a ledger entry.';
  return null;
}

/** Order.linkedDocuments.invoice after a split (rename part 1, add the parts) or an undo (drop them, rename back). */
export function orderLinksAfter(ld: any, change: { renameId: string; renameTo: string; add?: Array<{ id: string; name: string }>; removeIds?: string[] }) {
  const out: any = ld && typeof ld === 'object' ? { ...ld } : { po: [], do: [], invoice: [], salesOrder: [] };
  const list: any[] = (Array.isArray(out.invoice) ? out.invoice : []).filter((x: any) => !(change.removeIds ?? []).includes(x?.id)).map((x: any) => (x?.id === change.renameId ? { ...x, name: change.renameTo } : x));
  for (const a of change.add ?? []) if (!list.some((x) => x?.id === a.id)) list.push({ id: a.id, name: a.name, splitPart: true });
  out.invoice = list;
  return out;
}

export async function splitInvoice(prisma: any, organizationId: string, documentId: string, plan: SplitPlan, actor: Actor | undefined, log: LogFn) {
  await assertSplitAllowed(prisma, organizationId);
  const doc = await prisma.document.findFirst({ where: { id: documentId, organizationId } });
  if (!doc) throw new HttpException('Invoice not found', HttpStatus.NOT_FOUND);
  if (!INVOICE_TYPES.includes(String(doc.type).toUpperCase())) throw bad('Only an invoice can be split.');
  if (invoiceSplitOf(doc.config)) throw bad(`${doc.name || 'This invoice'} is already split.`);
  const baseNumber = String(doc.name ?? '').trim();
  if (!baseNumber) throw bad('Save the invoice with its number first.');
  const why = await blockers(prisma, organizationId, [doc], { anyJournal: () => false });
  if (why) throw bad(why);
  const cfg: any = doc.config || {};
  const stored = grossOf(cfg);
  const { nettTotal } = splitBaseOf(cfg);
  if (stored !== null && Math.abs(stored - nettTotal) > 0.01) throw bad('The invoice total does not match its lines. Save the invoice first.');

  let planned;
  try {
    planned = planInvoiceSplit(cfg, plan);
  } catch (e: any) {
    if (e instanceof SplitPlanError) throw bad(e.message);
    throw e;
  }
  const n = planned.parts.length;
  const names = planned.parts.map((p) => splitPartNumber(baseNumber, p.part));
  const taken = await prisma.document.findFirst({ where: { organizationId, name: { in: names }, NOT: { id: doc.id } }, select: { name: true } });
  if (taken) throw bad(`${taken.name} is already used by another document.`);
  const ids = [doc.id, ...planned.parts.slice(1).map(() => randomUUID())];
  const account = dominantLineAccount(cfg.items) as Record<string, string>;
  const ctx = (i: number) => ({ number: names[i], groupId: doc.id, of: n, baseNumber, mode: plan.mode, account });

  const first = {
    ...partConfig(cfg, planned.parts[0], ctx(0)),
  };
  first.invoiceSplit = {
    ...first.invoiceSplit,
    partIds: ids,
    plan: { mode: plan.mode, parts: plan.parts.map(Number), ...(plan.mode === 'deposit' ? { deposit: plan.deposit ?? null } : {}) },
    contractValue: planned.contractValue,
    restore: restoreSnapshotOf(cfg),
    at: new Date().toISOString(),
    by: actor?.name || actor?.email || actor?.id || null,
  };
  // Part 1 keeps what is only the original's: the jobs it bills, its payment link.
  for (const k of ['orderJobIds', 'payToken', 'savedAt', 'savedBy']) if (cfg[k] !== undefined) first[k] = cfg[k];

  await prisma.$transaction(async (tx: any) => {
    await tx.$executeRawUnsafe('SELECT pg_advisory_xact_lock(hashtext($1))', `invoice-split:${doc.id}`);
    const now = await tx.document.findFirst({ where: { id: doc.id, organizationId }, select: { status: true, name: true, config: true } });
    if (!now || !isDraft(now.status) || now.name !== baseNumber || invoiceSplitOf(now.config)) throw bad('The invoice changed meanwhile. Reload and try again.');
    await tx.document.update({ where: { id: doc.id }, data: { name: names[0], config: first, version: { increment: 1 } } });
    for (let i = 1; i < n; i++) {
      await tx.document.create({
        data: {
          id: ids[i],
          organizationId,
          documentTemplateId: doc.documentTemplateId,
          type: doc.type,
          name: names[i],
          status: doc.status,
          projectId: doc.projectId ?? null,
          config: partConfig(cfg, planned.parts[i], ctx(i)),
        },
      });
    }
    if (cfg.orderId) {
      const order = await tx.order.findFirst({ where: { id: cfg.orderId, organizationId }, select: { id: true, linkedDocuments: true } });
      if (order) {
        const linked = orderLinksAfter(order.linkedDocuments, { renameId: doc.id, renameTo: names[0], add: ids.slice(1).map((id, i) => ({ id, name: names[i + 1] })) });
        // An invoice not yet on the order's list (it bills a DO / job): list it too, so the order sees every part.
        if (!linked.invoice.some((x: any) => x?.id === doc.id)) {
          linked.invoice.unshift({ id: doc.id, name: names[0] });
          first.invoiceSplit.addedToOrder = true;
          await tx.document.update({ where: { id: doc.id }, data: { config: first } });
        }
        await tx.order.update({ where: { id: order.id }, data: { linkedDocuments: linked } });
      }
    }
  });

  const summary = planned.parts.map((p, i) => `${names[i]} ${p.totals.nettTotal.toFixed(2)}`).join(', ');
  await log({ documentId: doc.id, organizationId, action: 'EDITED', detail: `Split into ${n} invoices: ${summary}`, documentName: names[0], actor });
  for (let i = 1; i < n; i++) await log({ documentId: ids[i], organizationId, action: 'CREATED', detail: `${names[i]} created by splitting ${baseNumber}`, documentName: names[i], actor });
  if (cfg.orderId) await refreshOrderStatus(prisma, organizationId, cfg.orderId);
  return {
    baseNumber,
    parts: planned.parts.map((p, i) => ({ id: ids[i], name: names[i], description: p.description, subTotal: p.totals.subTotal, gstAmount: p.totals.gstAmount, total: p.totals.nettTotal })),
  };
}

export async function undoInvoiceSplit(prisma: any, organizationId: string, documentId: string, actor: Actor | undefined, log: LogFn) {
  await assertSplitAllowed(prisma, organizationId);
  const doc = await prisma.document.findFirst({ where: { id: documentId, organizationId }, select: { id: true, config: true } });
  if (!doc) throw new HttpException('Invoice not found', HttpStatus.NOT_FOUND);
  const s = invoiceSplitOf(doc.config);
  if (!s) throw bad('This invoice is not split.');
  const first = await prisma.document.findFirst({ where: { id: s.groupId, organizationId } });
  const fs = invoiceSplitOf(first?.config);
  if (!first || !fs?.partIds?.length || !(fs as any).restore) throw bad('The first part of this split is missing, so it cannot be merged back.');
  const parts = await prisma.document.findMany({ where: { organizationId, id: { in: fs.partIds } }, select: { id: true, name: true, status: true, config: true } });
  const others = parts.filter((p: any) => p.id !== first.id);
  const why = await blockers(prisma, organizationId, [first, ...others], { anyJournal: (id) => id !== first.id });
  if (why) throw bad(why.replace('This invoice has', 'A part has').replace('this invoice', 'a part'));
  const baseNumber = fs.baseNumber;
  const clash = await prisma.document.findFirst({ where: { organizationId, name: baseNumber, documentTemplateId: first.documentTemplateId, NOT: { id: { in: fs.partIds } } }, select: { id: true } });
  if (clash) throw bad(`${baseNumber} is used by another document, so the parts cannot be merged back.`);
  const cfg: any = first.config || {};
  const merged = mergedBackConfig(cfg, (fs as any).restore);

  await prisma.$transaction(async (tx: any) => {
    await tx.$executeRawUnsafe('SELECT pg_advisory_xact_lock(hashtext($1))', `invoice-split:${first.id}`);
    const live = await tx.document.findMany({ where: { organizationId, id: { in: fs.partIds } }, select: { id: true, status: true } });
    if (live.some((d: any) => !isDraft(d.status))) throw bad('A part is no longer a draft. Reload and try again.');
    if (others.length) await tx.document.deleteMany({ where: { organizationId, id: { in: others.map((p: any) => p.id) } } });
    await tx.document.update({ where: { id: first.id }, data: { name: baseNumber, config: merged, version: { increment: 1 } } });
    if (cfg.orderId) {
      const order = await tx.order.findFirst({ where: { id: cfg.orderId, organizationId }, select: { id: true, linkedDocuments: true } });
      if (order) await tx.order.update({ where: { id: order.id }, data: { linkedDocuments: orderLinksAfter(order.linkedDocuments, { renameId: first.id, renameTo: baseNumber, removeIds: [...others.map((p: any) => p.id), ...((fs as any).addedToOrder ? [first.id] : [])] }) } });
    }
  });

  await log({ documentId: first.id, organizationId, action: 'EDITED', detail: `Split undone: ${parts.map((p: any) => p.name).join(', ')} merged back into ${baseNumber}`, documentName: baseNumber, actor });
  for (const p of others) await log({ documentId: p.id, organizationId, action: 'DELETED', detail: `${p.name} removed (split undone, merged back into ${baseNumber})`, documentName: p.name ?? undefined, actor });
  if (cfg.orderId) await refreshOrderStatus(prisma, organizationId, cfg.orderId);
  return { id: first.id, name: baseNumber, removed: others.map((p: any) => p.name) };
}
