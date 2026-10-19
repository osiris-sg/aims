/**
 * Backfill: deals from before orders (one Contract = one deal, with its own
 * steps 1–2 and shipments) become Orders. Used by scripts/setup-adh-org.ts
 * (dev and, after the gate, prod) and safe to re-run (a contract whose
 * shipments all have an order is skipped).
 *
 * Per legacy contract C:
 *  - a TradeOrder (#n / year from the spec, else the next free number) with
 *    C's PI, deposit, B/L instructions and its product line's grade / size /
 *    quantity / premiums; status follows C (a completed deal stays completed);
 *  - C's steps (1 PI payment, 2 Invoice #1), file links, invoice links and
 *    generated documents (Invoice #1) move to the order;
 *  - the order's missing steps (0 Check contract, 13 Xero) are added — DONE when
 *    the deal was completed / the shipment's old step 13 was done;
 *  - shipment-level step 13 rows are kept but marked N/A ("moved to the order");
 *  - the shipments get the order (their contract stays; document IDs are kept).
 * Nothing is deleted.
 */
import { orderLabel } from './shipments.rules';
import { profileFor, stepOverride, subtasksFor } from './trade-profile';

/** Known ADH deals: contract + B/L → order number and months (ADH's task list). */
export interface BackfillSpec {
  contractNo: string;
  blNumber?: string;
  year: number;
  orderNo: number;
  shipMonth?: string;
  deliveryMonth?: string;
  grade?: string;
  qtyMt?: number;
}

export const ADH_BACKFILL: BackfillSpec[] = [
  { contractNo: '454003422', blNumber: '198GX04630', year: 2026, orderNo: 11, shipMonth: '2026-07', deliveryMonth: '2026-09', grade: '6063', qtyMt: 300 },
  { contractNo: '454003255', blNumber: '198GX04822', year: 2026, orderNo: 12, shipMonth: '2026-07', deliveryMonth: '2026-09', grade: '6005', qtyMt: 120 },
];

type Db = any; // eslint-disable-line @typescript-eslint/no-explicit-any

export interface BackfillResult {
  orders: Array<{ contractNo: string; label: string; year: number; shipments: string[]; status: string; created: boolean }>;
  writes: number;
}

const yearOf = (month: string | null | undefined, fallback: Date) => (/^\d{4}-\d{2}$/.test(month ?? '') ? Number(month!.slice(0, 4)) : fallback.getUTCFullYear());

export async function backfillOrders(
  db: Db,
  organizationId: string,
  opts: { apply: boolean; specs?: BackfillSpec[]; write: (step: string, msg: string) => void; info?: (msg: string) => void },
): Promise<BackfillResult> {
  const specs = opts.specs ?? ADH_BACKFILL;
  const info = opts.info ?? (() => undefined);
  const result: BackfillResult = { orders: [], writes: 0 };
  const w = (msg: string) => {
    result.writes++;
    opts.write('backfill', msg);
  };
  const contracts: any[] = await db.contract.findMany({
    where: { organizationId },
    orderBy: { createdAt: 'asc' },
    include: {
      lines: { orderBy: { sortOrder: 'asc' } },
      shipments: { orderBy: [{ seqNo: { sort: 'asc', nulls: 'last' } }, { createdAt: 'asc' }], select: { id: true, seqNo: true, blNumber: true, orderId: true, status: true } },
      steps: { select: { id: true, code: true, status: true } },
    },
  });
  const settings = await db.tradeSetting.findUnique({ where: { organizationId }, select: { customerProfiles: true } });
  const orderTemplates: any[] = await db.tradeStepTemplate.findMany({ where: { organizationId, scope: 'ORDER', isActive: true }, orderBy: { sortOrder: 'asc' } });
  // Numbers already taken (existing orders + the ones planned in this run).
  const taken = new Set<string>(((await db.tradeOrder.findMany({ where: { organizationId }, select: { year: true, orderNo: true } })) as any[]).map((o) => `${o.year}:${o.orderNo}`));

  for (const c of contracts) {
    const legacyShips = c.shipments.filter((s: any) => !s.orderId);
    if (!legacyShips.length && !c.steps.length) continue; // an LTC master, or already backfilled
    const spec = specs.find((x) => x.contractNo === c.contractNo && (!x.blNumber || c.shipments.some((s: any) => s.blNumber === x.blNumber))) ?? null;
    const line = c.lines.find((l: any) => spec?.grade && l.grade === spec.grade) ?? c.lines[0] ?? null;
    const year = spec?.year ?? yearOf(c.shipmentMonth, c.createdAt);
    let orderNo = spec?.orderNo ?? null;
    if (orderNo === null) {
      orderNo = 1;
      while (taken.has(`${year}:${orderNo}`)) orderNo++;
    }
    const existing = await db.tradeOrder.findFirst({ where: { organizationId, year, orderNo }, select: { id: true, contractId: true } });
    if (existing && existing.contractId !== c.id) {
      info(`⚠ #${orderNo} (${year}) already exists for another contract — ${c.contractNo} left as it is`);
      continue;
    }
    taken.add(`${year}:${orderNo}`);
    const status = c.status === 'COMPLETED' ? 'COMPLETED' : c.status === 'CANCELLED' ? 'CANCELLED' : 'OPEN';
    const data = {
      organizationId,
      year,
      orderNo,
      contractId: c.id,
      customerId: c.customerId,
      supplierId: c.supplierId,
      shipMonth: spec?.shipMonth ?? c.shipmentMonth ?? null,
      deliveryMonth: spec?.deliveryMonth ?? c.deliveryMonth ?? null,
      product: line?.product ?? null,
      grade: spec?.grade ?? line?.grade ?? null,
      size: line?.sizeSpec ?? null,
      qtyMt: spec?.qtyMt ?? line?.quantityMt ?? null,
      tolPct: line?.tolerancePct ?? 5,
      supplierPremium: line?.supplierPremium ?? null,
      // The premium the customer is invoiced (ADH's "Billet Premium", e.g. 230 for SUS 6063) — the line's billet premium, else its client premium.
      clientPremium: line?.billetPremium ?? line?.clientPremium ?? null,
      upcharge: line?.upcharge ?? null,
      piNo: c.piNumber,
      piDate: c.piDate,
      piAmount: c.piAmount,
      depositPct: c.depositPercent,
      depositAmount: c.depositAmount,
      depositDueDays: c.depositDueDays,
      depositDueUnit: c.depositDueUnit,
      depositPaidAt: c.depositPaidAt,
      currency: c.currency ?? 'USD',
      incoterm: c.incoterm,
      destinationPort: c.destinationPort,
      consignee: c.consignee,
      notifyParty: c.notifyParty,
      status,
      notes: c.notes,
      createdById: c.createdById,
    };
    const label = orderLabel({ orderNo });
    const shipRefs = legacyShips.map((s: any, i: number) => `${label}-${s.seqNo ?? i + 1}${s.blNumber ? ` (${s.blNumber})` : ''}`);
    result.orders.push({ contractNo: c.contractNo, label, year, shipments: shipRefs, status, created: !existing });
    w(
      `${existing ? 'reuse' : 'create'} order ${label} (${year}) ← contract ${c.contractNo}: ${data.grade ?? '?'} ${data.qtyMt ?? '?'} MT, ${data.shipMonth ?? '?'} → ${data.deliveryMonth ?? '?'}, premium ${data.clientPremium ?? '—'}, ${status}`,
    );
    w(`  shipments → ${label}: ${shipRefs.join(', ') || '(none)'}`);
    const stepCount = c.steps.length;
    if (stepCount) w(`  move ${stepCount} contract step(s) (${c.steps.map((s: any) => s.code).join(', ')}) to ${label}`);
    const links = await db.tradeFileLink.count({ where: { organizationId, contractId: c.id } });
    const docLinks = await db.tradeDocumentLink.count({ where: { organizationId, contractId: c.id } });
    const gens = await db.tradeGeneratedDoc.count({ where: { organizationId, contractId: c.id } });
    if (links + docLinks + gens) w(`  move ${links} file link(s), ${docLinks} invoice link(s), ${gens} in-app document(s) to ${label}`);
    const have = new Set(c.steps.map((s: any) => s.code));
    const missing = orderTemplates.filter((t) => !have.has(t.code));
    const shipXero: any[] = legacyShips.length
      ? await db.tradeStep.findMany({ where: { organizationId, shipmentId: { in: legacyShips.map((s: any) => s.id) }, code: 'XERO_HANDOFF' }, select: { id: true, status: true, notApplicable: true } })
      : [];
    const xeroDone = shipXero.length > 0 && shipXero.every((s) => s.status === 'DONE');
    if (missing.length)
      w(`  add order step(s): ${missing.map((t) => `${t.displayNo ?? ''} ${t.code}${status === 'COMPLETED' || (t.code === 'XERO_HANDOFF' && xeroDone) ? ' (done)' : ''}`).join(', ')}`);
    if (shipXero.some((s) => !s.notApplicable)) w(`  mark ${shipXero.length} shipment step 13 row(s) N/A — moved to the order`);
    if (!opts.apply) continue;

    const order = existing ?? (await db.tradeOrder.create({ data, select: { id: true } }));
    const profile = profileFor(settings?.customerProfiles, c.customerId);
    await db.tradeStep.updateMany({ where: { organizationId, contractId: c.id }, data: { orderId: order.id, contractId: null } });
    // Moved steps take the order templates' titles / sub-tasks (e.g. "Issue and send Invoice #1").
    for (const t of orderTemplates.filter((x) => have.has(x.code))) {
      const o = stepOverride(profile, t.code);
      const subtasks = subtasksFor(t.code, profile);
      await db.tradeStep.updateMany({
        where: { organizationId, orderId: order.id, code: t.code },
        data: {
          title: o.title ?? t.title,
          displayNo: t.displayNo,
          sortOrder: t.sortOrder,
          ...(subtasks ? { subtasks: subtasks.map((s) => (status === 'COMPLETED' ? { ...s, done: !s.na } : s)) } : {}),
        },
      });
    }
    for (const t of missing) {
      const done = status === 'COMPLETED' || (t.code === 'XERO_HANDOFF' && xeroDone);
      const subtasks = subtasksFor(t.code, profile);
      await db.tradeStep.create({
        data: {
          organizationId,
          orderId: order.id,
          templateId: t.id,
          code: t.code,
          title: t.title,
          displayNo: t.displayNo,
          sortOrder: t.sortOrder,
          requiredDocTypes: t.requiredDocTypes,
          optionalDocTypes: t.optionalDocTypes ?? [],
          requiredFields: t.requiredFields ?? [],
          isOngoing: t.isOngoing,
          status: done ? 'DONE' : 'NOT_STARTED',
          completedAt: done ? new Date() : null,
          updatedByName: done ? 'Backfill' : null,
          ...(subtasks ? { subtasks } : {}),
        },
      });
    }
    if (shipXero.length) {
      await db.tradeStep.updateMany({ where: { id: { in: shipXero.map((s) => s.id) } }, data: { notApplicable: true, skipReason: 'Moved to the order (step 13)' } });
    }
    await db.tradeFileLink.updateMany({ where: { organizationId, contractId: c.id }, data: { orderId: order.id, contractId: null } });
    await db.tradeDocumentLink.updateMany({ where: { organizationId, contractId: c.id }, data: { orderId: order.id, contractId: null } });
    await db.tradeGeneratedDoc.updateMany({ where: { organizationId, contractId: c.id }, data: { orderId: order.id, contractId: null } });
    await db.tradeExtraction.updateMany({ where: { organizationId, contractId: c.id }, data: { orderId: order.id } });
    if (legacyShips.length) await db.shipment.updateMany({ where: { organizationId, id: { in: legacyShips.map((s: any) => s.id) } }, data: { orderId: order.id } });
  }
  return result;
}

// ── Supplier orders (2026-10, round E) ─────────────────────────────────────
/** The supplier-order step templates the backfill plans against (from the setup script, so a dry run is exact). */
export interface SoStepSpec {
  code: string;
  displayNo: string;
  title: string;
  sortOrder: number;
  requiredDocTypes: string[];
  optionalDocTypes?: string[];
  requiredFields?: string[];
}

/** Doc types that belong to the supplier side: their order file links are also linked to the supplier order. */
const SUPPLIER_SIDE_DOCS = ['PI', 'DEPOSIT_PROOF', 'CONTRACT'];

/**
 * Every customer order without a supplier order gets one (1:1), made from the
 * order's PI fields: its steps 0 (Check contract) and 1 (PI payment) move to
 * the supplier order (status and history kept), missing supplier-side steps
 * are added (DONE when the order is completed), and the order's PI / deposit /
 * contract files are linked to the supplier order too (the order keeps its
 * links). Nothing is deleted; re-running skips orders that already have one.
 */
export async function backfillSupplierOrders(
  db: Db,
  organizationId: string,
  opts: { apply: boolean; templates: SoStepSpec[]; write: (step: string, msg: string) => void },
): Promise<{ created: number; writes: number }> {
  let writes = 0;
  const w = (msg: string) => {
    writes++;
    opts.write('soBackfill', msg);
  };
  const orders: any[] = await db.tradeOrder.findMany({
    where: { organizationId, supplierOrderId: null },
    orderBy: [{ year: 'asc' }, { orderNo: 'asc' }],
    include: {
      contract: { select: { contractNo: true } },
      steps: { select: { id: true, code: true, status: true } },
      fileLinks: { select: { id: true, fileId: true, stepId: true, file: { select: { docType: true } } } },
    },
  });
  if (!orders.length) return { created: 0, writes: 0 };
  const dbTemplates: Array<{ id: string; code: string }> = opts.apply
    ? await db.tradeStepTemplate.findMany({ where: { organizationId, scope: 'SUPPLIER_ORDER', isActive: true }, select: { id: true, code: true } })
    : [];
  const nextNo = new Map<number, number>();
  const soNoFor = async (year: number) => {
    if (!nextNo.has(year)) {
      const last = await db.supplierOrder.findFirst({ where: { organizationId, year }, orderBy: { soNo: 'desc' }, select: { soNo: true } });
      nextNo.set(year, last?.soNo ?? 0);
    }
    const n = nextNo.get(year)! + 1;
    nextNo.set(year, n);
    return n;
  };
  let created = 0;
  for (const o of orders) {
    const label = orderLabel(o);
    const year = /^\d{4}-\d{2}$/.test(o.shipMonth ?? '') ? Number(o.shipMonth.slice(0, 4)) : o.year;
    const soNo = await soNoFor(year);
    const status = o.status === 'CANCELLED' ? 'CANCELLED' : o.status === 'COMPLETED' ? 'COMPLETED' : 'OPEN';
    const moving = o.steps.filter((s: { code: string }) => opts.templates.some((t) => t.code === s.code));
    const missing = opts.templates.filter((t) => !moving.some((s: { code: string }) => s.code === t.code));
    const supplierLinks = o.fileLinks.filter((l: any) => SUPPLIER_SIDE_DOCS.includes(l.file.docType) || moving.some((s: { id: string }) => s.id === l.stepId));
    w(
      `${label} (${year}${o.contract?.contractNo ? `, contract ${o.contract.contractNo}` : ''}${o.piNo ? `, PI ${o.piNo}` : ''}${o.shipMonth ? `, ${o.shipMonth}` : ''}) → supplier order ${year}-S${soNo}, ${status}`,
    );
    if (moving.length) w(`  move ${moving.length} step(s) (${moving.map((s: { code: string }) => s.code).join(', ')}) from ${label} to the supplier order`);
    if (missing.length) w(`  add supplier step(s): ${missing.map((t) => `${t.displayNo} ${t.code}${status === 'COMPLETED' ? ' (done)' : ''}`).join(', ')}`);
    if (supplierLinks.length) w(`  link ${supplierLinks.length} file(s) (${[...new Set(supplierLinks.map((l: any) => l.file.docType))].join(', ')}) to the supplier order too`);
    created++;
    if (!opts.apply) continue;
    const so = await db.supplierOrder.create({
      data: {
        organizationId,
        year,
        soNo,
        supplierId: o.supplierId,
        contractId: o.contractId,
        declarationMonth: o.shipMonth,
        product: o.product,
        grade: o.grade,
        size: o.size,
        qtyMt: o.qtyMt,
        supplierPremium: o.supplierPremium,
        currency: o.currency,
        piNo: o.piNo,
        piDate: o.piDate,
        piAmount: o.piAmount,
        depositPct: o.depositPct,
        depositAmount: o.depositAmount,
        depositPaidAt: o.depositPaidAt,
        status,
        notes: `Backfilled from ${label}`,
        createdById: o.createdById,
      },
      select: { id: true },
    });
    for (const s of moving) {
      const t = opts.templates.find((x) => x.code === s.code)!;
      await db.tradeStep.update({
        where: { id: s.id },
        data: { orderId: null, supplierOrderId: so.id, displayNo: t.displayNo, sortOrder: t.sortOrder, title: t.title, requiredFields: t.requiredFields ?? [] },
      });
    }
    for (const t of missing) {
      const done = status === 'COMPLETED';
      await db.tradeStep.create({
        data: {
          organizationId,
          supplierOrderId: so.id,
          templateId: dbTemplates.find((x) => x.code === t.code)?.id ?? null,
          code: t.code,
          title: t.title,
          displayNo: t.displayNo,
          sortOrder: t.sortOrder,
          requiredDocTypes: t.requiredDocTypes,
          optionalDocTypes: t.optionalDocTypes ?? [],
          requiredFields: t.requiredFields ?? [],
          isOngoing: false,
          status: done ? 'DONE' : 'NOT_STARTED',
          completedAt: done ? new Date() : null,
          updatedByName: done ? 'Backfill' : null,
        },
      });
    }
    for (const l of supplierLinks) {
      const exists = await db.tradeFileLink.findFirst({ where: { organizationId, fileId: l.fileId, supplierOrderId: so.id }, select: { id: true } });
      if (!exists) await db.tradeFileLink.create({ data: { organizationId, fileId: l.fileId, supplierOrderId: so.id, stepId: moving.some((s: { id: string }) => s.id === l.stepId) ? l.stepId : null } });
    }
    await db.tradeOrder.update({ where: { id: o.id }, data: { supplierOrderId: so.id } });
  }
  return { created, writes };
}
