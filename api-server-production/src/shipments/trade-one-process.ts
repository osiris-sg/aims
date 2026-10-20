/**
 * One order process (2026-10, round H — owner feedback): no separate supplier
 * / customer processes. The data move, run by scripts/setup-adh-org.ts (dry
 * run first; safe to re-run — every part skips what is already done):
 *
 *  1. foldSupplierOrders — each SupplierOrder's PI fields (PI no. / date /
 *     amount, deposit %, deposit amount / paid on, supplier premium) are
 *     copied back onto its order(s), and its steps 0 / 1 and their file links
 *     are re-pointed to the order (an order sharing a supplier order gets
 *     copies). The SupplierOrder rows stay, unused.
 *  2. moveInvoice2ToOrder — step 11 (Invoice #2 / single invoice) becomes an
 *     order step: each order gets one (DONE when every live shipment's step
 *     11 was done); the shipments' step-11 rows stay, marked N/A ("Moved to
 *     the order").
 *  3. copyPaymentsToSteps — a retired Payment with exactly one allocation for
 *     its whole amount is copied onto its step's payment fields (amount, date,
 *     account, proof); the rest stay as they are (hidden).
 *
 * Nothing is deleted.
 */
import { orderLabel } from './shipments.rules';
import { oneToOne } from './trade-payments';

type Db = any; // eslint-disable-line @typescript-eslint/no-explicit-any
type Write = (step: string, msg: string) => void;

export interface OrderStepSpec {
  code: string;
  displayNo: string;
  title: string;
  sortOrder: number;
  requiredDocTypes: string[];
  optionalDocTypes?: string[];
  requiredFields?: string[];
}

/** The PI fields copied back from a supplier order (the supplier order wins where it has a value). */
export const PI_FIELDS = ['piNo', 'piDate', 'piAmount', 'depositPct', 'depositAmount', 'depositPaidAt', 'supplierPremium'] as const;

const norm = (v: unknown) => (v === null || v === undefined ? null : v instanceof Date ? v.toISOString() : typeof v === 'object' ? String(v) : String(v));
const same = (a: unknown, b: unknown) => {
  const x = norm(a);
  const y = norm(b);
  if (x === null || y === null) return x === y;
  return Number.isFinite(Number(x)) && Number.isFinite(Number(y)) ? Number(x) === Number(y) : x === y;
};

/** The order fields a supplier order would change: its non-null PI fields that differ. */
export function piFieldsToCopy(so: Record<string, unknown>, order: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const f of PI_FIELDS) if (so[f] !== null && so[f] !== undefined && !same(so[f], order[f])) out[f] = so[f];
  return out;
}

const show = (v: unknown) => (v instanceof Date ? v.toISOString().slice(0, 10) : v === null || v === undefined ? '—' : String(v));

export async function foldSupplierOrders(
  db: Db,
  organizationId: string,
  opts: { apply: boolean; templates: OrderStepSpec[]; noPiSupplierIds: Set<string>; write: Write },
): Promise<{ orders: number; piFields: number; steps: number; copies: number; fileLinks: number; added: number }> {
  const r = { orders: 0, piFields: 0, steps: 0, copies: 0, fileLinks: 0, added: 0 };
  const codes = opts.templates.map((t) => t.code);
  const tpl = (code: string) => opts.templates.find((t) => t.code === code)!;
  const dbTemplates: Array<{ id: string; code: string }> = await db.tradeStepTemplate.findMany({ where: { organizationId, scope: 'ORDER', code: { in: codes } }, select: { id: true, code: true } });
  const sos: any[] = await db.supplierOrder.findMany({
    where: { organizationId, customerOrders: { some: {} } },
    orderBy: [{ year: 'asc' }, { soNo: 'asc' }],
    include: {
      steps: true,
      fileLinks: { select: { id: true, fileId: true, stepId: true } },
      customerOrders: { orderBy: { orderNo: 'asc' }, include: { steps: { select: { id: true, code: true } }, fileLinks: { select: { id: true, fileId: true, stepId: true } } } },
    },
  });
  for (const so of sos) {
    const soLabel = so.piNo ? `PI ${so.piNo}` : `S${so.soNo}`;
    for (const [k, o] of (so.customerOrders as any[]).entries()) {
      const label = orderLabel(o);
      let touched = false;
      const data = piFieldsToCopy(so, o);
      if (Object.keys(data).length) {
        touched = true;
        r.piFields += Object.keys(data).length;
        opts.write('oneProcess', `${label} ← ${so.year}-${soLabel}: ${Object.entries(data).map(([f, v]) => `${f} ${show(o[f])} → ${show(v)}`).join(', ')}`);
        if (opts.apply) await db.tradeOrder.update({ where: { id: o.id }, data });
      }
      const stepMap = new Map<string, string>(); // supplier-order step id → the order's step id
      for (const st of so.steps as any[]) {
        if (!codes.includes(st.code)) continue;
        const have = o.steps.find((x: { code: string }) => x.code === st.code);
        if (have) {
          stepMap.set(st.id, have.id);
          continue;
        }
        const t = tpl(st.code);
        touched = true;
        if (k === 0) {
          r.steps++;
          opts.write('oneProcess', `${label}: step ${t.displayNo} ${st.code} (${st.status.toLowerCase()}) moves from ${soLabel} to the order`);
          if (opts.apply)
            await db.tradeStep.update({ where: { id: st.id }, data: { supplierOrderId: null, orderId: o.id, displayNo: t.displayNo, sortOrder: t.sortOrder, requiredFields: t.requiredFields ?? [], optionalDocTypes: t.optionalDocTypes ?? st.optionalDocTypes } });
          stepMap.set(st.id, st.id);
        } else {
          r.copies++;
          opts.write('oneProcess', `${label}: step ${t.displayNo} ${st.code} (${st.status.toLowerCase()}) copied from ${soLabel} (shared with an earlier order)`);
          if (opts.apply) {
            const { id: _id, supplierOrderId: _so, createdAt: _c, updatedAt: _u, ...rest } = st;
            void _id, _so, _c, _u;
            const c = await db.tradeStep.create({ data: { ...rest, orderId: o.id, displayNo: t.displayNo, sortOrder: t.sortOrder } });
            stepMap.set(st.id, c.id);
          }
        }
      }
      for (const l of so.fileLinks as any[]) {
        const mine = o.fileLinks.find((x: { fileId: string }) => x.fileId === l.fileId);
        const stepId = l.stepId ? (stepMap.get(l.stepId) ?? null) : null;
        if (mine) {
          // Already on the order (round E linked it to both): give it the step if it has none.
          if (!mine.stepId && stepId) {
            r.fileLinks++;
            touched = true;
            if (opts.apply) await db.tradeFileLink.update({ where: { id: mine.id }, data: { stepId } });
          }
          continue;
        }
        r.fileLinks++;
        touched = true;
        if (opts.apply) {
          if (k === 0) await db.tradeFileLink.update({ where: { id: l.id }, data: { supplierOrderId: null, orderId: o.id, stepId } });
          else await db.tradeFileLink.create({ data: { organizationId, fileId: l.fileId, orderId: o.id, stepId } });
        }
      }
      if (touched) r.orders++;
    }
  }
  // Orders that never had a supplier order (or whose supplier order had no steps): add steps 0 / 1.
  const orders: any[] = await db.tradeOrder.findMany({ where: { organizationId }, include: { steps: { select: { code: true } } } });
  for (const o of orders) {
    for (const code of codes) {
      if (o.steps.some((x: { code: string }) => x.code === code)) continue;
      // In a dry run the steps above haven't moved yet: don't count them twice.
      if (!opts.apply && o.supplierOrderId && sos.some((so) => so.id === o.supplierOrderId && so.steps.some((x: { code: string }) => x.code === code))) continue;
      const t = tpl(code);
      const done = o.status === 'COMPLETED';
      const na = code === 'PI_PAYMENT' && opts.noPiSupplierIds.has(o.supplierId);
      r.added++;
      opts.write('oneProcess', `${orderLabel(o)}: add step ${t.displayNo} ${code}${na ? ' (N/A — supplier without PI)' : done ? ' (done — order completed)' : ''}`);
      if (opts.apply)
        await db.tradeStep.create({
          data: {
            organizationId,
            orderId: o.id,
            templateId: dbTemplates.find((x) => x.code === code)?.id ?? null,
            code,
            title: t.title,
            displayNo: t.displayNo,
            sortOrder: t.sortOrder,
            requiredDocTypes: t.requiredDocTypes,
            optionalDocTypes: t.optionalDocTypes ?? ['OTHER'],
            requiredFields: t.requiredFields ?? [],
            isOngoing: false,
            notApplicable: na,
            status: done ? 'DONE' : 'NOT_STARTED',
            completedAt: done ? new Date() : null,
            updatedByName: done ? 'Backfill' : null,
          },
        });
    }
  }
  return r;
}

export const MOVED_TO_ORDER = 'Moved to the order (step 11)';

export async function moveInvoice2ToOrder(
  db: Db,
  organizationId: string,
  opts: { apply: boolean; template: OrderStepSpec; singleCustomerIds: Set<string>; write: Write },
): Promise<{ orderSteps: number; shipmentSteps: number }> {
  const r = { orderSteps: 0, shipmentSteps: 0 };
  const t = opts.template;
  const tplRow: { id: string } | null = await db.tradeStepTemplate.findFirst({ where: { organizationId, scope: 'ORDER', code: t.code }, select: { id: true } });
  const orders: any[] = await db.tradeOrder.findMany({
    where: { organizationId },
    orderBy: [{ year: 'asc' }, { orderNo: 'asc' }],
    include: {
      steps: { select: { code: true } },
      shipments: { select: { id: true, status: true, steps: { where: { code: t.code }, select: { id: true, status: true, notApplicable: true, title: true, requiredDocTypes: true, subtasks: true, completedAt: true, skipReason: true, payment: true } } } },
    },
  });
  for (const o of orders) {
    const live = o.shipments.filter((s: { status: string }) => s.status !== 'CANCELLED');
    const old = live.flatMap((s: any) => s.steps).filter((st: any) => !st.notApplicable);
    if (!o.steps.some((x: { code: string }) => x.code === t.code)) {
      const allDone = live.length > 0 && live.every((s: any) => s.steps.some((st: any) => st.status === 'DONE'));
      const status = o.status === 'COMPLETED' || allDone ? 'DONE' : old.some((st: any) => st.status !== 'NOT_STARTED') ? 'IN_PROGRESS' : 'NOT_STARTED';
      const first = old[0];
      const single = opts.singleCustomerIds.has(o.customerId);
      r.orderSteps++;
      opts.write('oneProcess', `${orderLabel(o)}: add order step ${t.displayNo} ${single ? 'single invoice' : 'Invoice #2'} (${status.toLowerCase()}${old.length ? `, from ${old.length} shipment step(s)` : ''})`);
      if (opts.apply)
        await db.tradeStep.create({
          data: {
            organizationId,
            orderId: o.id,
            templateId: tplRow?.id ?? null,
            code: t.code,
            title: first?.title ?? (single ? 'Issue invoice (single)' : t.title),
            displayNo: t.displayNo,
            sortOrder: t.sortOrder,
            requiredDocTypes: first?.requiredDocTypes ?? (single ? ['INVOICE_SINGLE'] : t.requiredDocTypes),
            optionalDocTypes: t.optionalDocTypes ?? ['OTHER'],
            requiredFields: [],
            isOngoing: false,
            status,
            completedAt: status === 'DONE' ? (old.map((st: any) => st.completedAt).filter(Boolean).sort().pop() ?? new Date()) : null,
            skipReason: status === 'DONE' ? (first?.skipReason ?? null) : null,
            updatedByName: 'Backfill',
            ...(first?.subtasks ? { subtasks: first.subtasks } : {}),
            ...(first?.payment ? { payment: first.payment } : {}),
          },
        });
    }
    for (const st of old) {
      r.shipmentSteps++;
      if (opts.apply) await db.tradeStep.update({ where: { id: st.id }, data: { notApplicable: true, skipReason: MOVED_TO_ORDER } });
    }
    if (old.length) opts.write('oneProcess', `${orderLabel(o)}: ${old.length} shipment step(s) 11 marked N/A ("${MOVED_TO_ORDER}")`);
  }
  return r;
}

/** The step a retired allocation pays (by target), or null. */
async function stepForAllocation(db: Db, organizationId: string, a: any): Promise<{ id: string; payment: unknown; where: string } | null> {
  const find = (where: Record<string, unknown>, code: string) => db.tradeStep.findFirst({ where: { organizationId, code, ...where }, select: { id: true, payment: true } });
  const shipCode: Record<string, string> = { CI: 'CI_PAYMENT', IMPORT_TAX: 'TAX_FUNDS', VENDOR_INVOICE: 'LOGISTICS_PAYMENT' };
  if (shipCode[a.targetType] && a.shipmentId) {
    const st = await find({ shipmentId: a.shipmentId }, shipCode[a.targetType]);
    return st ? { ...st, where: `shipment step ${shipCode[a.targetType]}` } : null;
  }
  if (a.targetType === 'PI') {
    const soId = a.supplierOrderId ?? a.targetId;
    const orders: Array<{ id: string }> = soId ? await db.tradeOrder.findMany({ where: { organizationId, supplierOrderId: soId }, select: { id: true } }) : [];
    if (orders.length !== 1) return null;
    const st = (await find({ orderId: orders[0].id }, 'PI_PAYMENT')) ?? (await find({ supplierOrderId: soId }, 'PI_PAYMENT'));
    return st ? { ...st, where: 'order step 1' } : null;
  }
  if (a.targetType === 'INVOICE' && a.targetId) {
    const g = await db.tradeGeneratedDoc.findFirst({ where: { organizationId, id: a.targetId }, select: { docType: true, orderId: true, shipment: { select: { orderId: true } } } });
    const orderId = g?.orderId ?? g?.shipment?.orderId ?? a.orderId;
    if (!g || !orderId) return null;
    const code = g.docType === 'INVOICE_1' ? 'INVOICE_1' : 'INVOICE_2';
    const st = await find({ orderId }, code);
    return st ? { ...st, where: `order step ${code === 'INVOICE_1' ? 2 : 11}` } : code === 'INVOICE_2' ? { id: '', payment: null, where: 'order step 11 (added above)' } : null;
  }
  return null;
}

export async function copyPaymentsToSteps(db: Db, organizationId: string, opts: { apply: boolean; write: Write }): Promise<{ payments: number; copied: number; notOneToOne: number; noStep: number; already: number }> {
  const r = { payments: 0, copied: 0, notOneToOne: 0, noStep: 0, already: 0 };
  const pays: any[] = await db.tradePayment.findMany({ where: { organizationId }, orderBy: { paidAt: 'asc' }, include: { allocations: true } });
  r.payments = pays.length;
  for (const p of pays) {
    const what = `${p.direction} ${p.currency} ${Number(p.amount).toFixed(2)} on ${p.paidAt.toISOString().slice(0, 10)} (${p.account})`;
    if (!oneToOne(p)) {
      r.notOneToOne++;
      opts.write('oneProcess', `payment ${what}: ${p.allocations.length} allocation(s) — left as is (hidden)`);
      continue;
    }
    const a = p.allocations[0];
    let st = await stepForAllocation(db, organizationId, a);
    if (st && !st.id && opts.apply) {
      // Step 11 was added above in this run.
      const g = await db.tradeGeneratedDoc.findFirst({ where: { organizationId, id: a.targetId }, select: { orderId: true, shipment: { select: { orderId: true } } } });
      const s2 = await db.tradeStep.findFirst({ where: { organizationId, orderId: g?.orderId ?? g?.shipment?.orderId, code: 'INVOICE_2' }, select: { id: true, payment: true } });
      st = s2 ? { ...s2, where: 'order step 11' } : null;
    }
    if (!st) {
      r.noStep++;
      opts.write('oneProcess', `payment ${what} (${a.targetType}): no matching step — left as is (hidden)`);
      continue;
    }
    if (st.payment && Number.isFinite(Number((st.payment as { amount?: unknown }).amount))) {
      r.already++;
      continue;
    }
    r.copied++;
    opts.write('oneProcess', `payment ${what} (${a.targetType}${a.targetLabel ? ` ${a.targetLabel}` : ''}) → ${st.where}`);
    if (opts.apply && st.id)
      await db.tradeStep.update({
        where: { id: st.id },
        data: { payment: { amount: Number(p.amount), currency: p.currency, paidAt: p.paidAt.toISOString().slice(0, 10), account: p.account, proofFileId: p.proofFileId ?? null } },
      });
  }
  return r;
}
