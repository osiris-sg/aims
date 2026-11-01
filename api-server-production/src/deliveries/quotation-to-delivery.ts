import { isOrgFeatureEnabled } from 'src/common/org-features';
import { runAsOrg } from 'src/common/tenancy/tenant-context';
import { ensureOrderNumberFormat, isWctOrdersEnabled, issueOrderNumberInTx, lockQuotation } from 'src/orders/wct-orders';

/**
 * Quotation → Delivery (WCT 2026-10-26): when a quotation is ACCEPTED (staff
 * "Confirm Quotation" or the client's /sign e-sign link), auto-create a DRAFT
 * scheduled delivery from its lines. The draft appears on the Deliveries page
 * ("Draft" chip) waiting for the office to confirm: they open it, set the date,
 * and save — promotion mints the DO (updateScheduled), the field app runs the
 * job, and completion fires the draft invoice exactly like Biofuel's flow.
 *
 * Pure helper on purpose (same pattern as delivery-group-posts/enqueue.ts):
 * DocumentsService and PublicSignService call it with their own Prisma, so
 * neither needs a dependency on the deliveries module (which injects
 * DocumentsService — a hard import would be circular).
 *
 * Gated per org by enableQuotationToDelivery. Idempotent: one run per
 * quotation, keyed on Delivery.sourceQuotationId.
 *
 * WCT orders (enableWctOrders, 2026-11-01): the quotation makes ONE Order and
 * this draft becomes its first job (Delivery.orderId). The guard moves to one
 * order per quotation: once the order has a job, a re-confirm adds nothing —
 * more jobs come from "Add job" on the order. A quotation that already got a
 * run before the flag (no order) is left alone: going forward only.
 */
export const QUOTATION_TO_DELIVERY_FLAG = 'enableQuotationToDelivery';

const QUOTATION_TYPES = ['QUOTATION', 'QO', 'QO1', 'QO2', 'QT'];

/** Editor descriptions can be rich HTML; delivery items are plain text. */
const plainText = (v: any): string =>
  String(v ?? '')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/(p|div|li)>/gi, '\n')
    .replace(/<[^>]*>/g, '')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .split('\n')[0]
    .trim();

const normDesc = (v: any): string => plainText(v).replace(/\s+/g, ' ').toLowerCase();

/** The quotation's billable lines (group headers and tag groups are display rows). */
function quotationLines(cfg: any): any[] {
  return (Array.isArray(cfg?.items) ? cfg.items : []).filter((it: any) => it && !it.isGroupHeader && !it.isTagGroup);
}

/**
 * Create the DRAFT scheduled delivery for an accepted quotation. Never throws —
 * a failure here must never fail the confirmation/signature that triggered it.
 * Returns the created delivery's id, or null when skipped (flag off, not a
 * quotation, no lines, or already created).
 */
export async function autoDraftDeliveryFromQuotation(
  prisma: any,
  organizationId: string,
  documentId: string,
  logger?: { warn: (m: string) => void; log?: (m: string) => void },
): Promise<{ id: string; deliveryNumber: number; orderId?: string; orderNumber?: string } | null> {
  try {
    if (!(await isOrgFeatureEnabled(prisma, organizationId, QUOTATION_TO_DELIVERY_FLAG))) return null;
    const wctOrders = await isWctOrdersEnabled(prisma, organizationId);

    const doc = await prisma.document.findFirst({
      where: { id: documentId, organizationId },
      select: { id: true, name: true, type: true, projectId: true, config: true },
    });
    if (!doc || !QUOTATION_TYPES.includes(String(doc.type).toUpperCase())) return null;

    // One run per quotation — a re-confirm (revert → edit → re-sign) must not
    // stack a second schedule next to the first. With WCT orders the order's
    // jobs all carry the quotation, so only a run WITHOUT an order (made before
    // the flag) blocks here; the one-order guard runs inside the transaction.
    const existing = await prisma.delivery.findFirst({
      where: { organizationId, sourceQuotationId: doc.id, ...(wctOrders ? { orderId: null } : {}) },
      select: { id: true },
    });
    if (existing) return null;

    const cfg: any = doc.config || {};
    const lines = quotationLines(cfg);
    if (!lines.length) return null;

    // Resolve catalog assets where the quotation line names one: itemCode =
    // Asset.skuKey (exact), or inventoryItemId that is actually an Asset id
    // (product-level pick). Everything else stays a FREE-TYPED line.
    const codes = [...new Set(lines.map((l) => String(l.itemCode ?? '').trim()).filter(Boolean))];
    const ids = [...new Set(lines.map((l) => l.inventoryItemId).filter((v: any): v is string => typeof v === 'string' && !!v))];
    const [byCode, byId] = await Promise.all([
      codes.length
        ? prisma.asset.findMany({ where: { organizationId, skuKey: { in: codes }, deletedAt: null }, select: { id: true, name: true, skuKey: true } })
        : [],
      ids.length
        ? prisma.asset.findMany({ where: { organizationId, id: { in: ids }, deletedAt: null }, select: { id: true, name: true, skuKey: true } })
        : [],
    ]);
    const assetByCode = new Map((byCode as any[]).map((a) => [String(a.skuKey ?? '').trim(), a]));
    const assetById = new Map((byId as any[]).map((a) => [a.id, a]));
    const resolveAsset = (l: any) => assetByCode.get(String(l.itemCode ?? '').trim()) ?? assetById.get(l.inventoryItemId) ?? null;

    const qtyOf = (l: any) => Math.max(1, Math.round(Number(l.quantity)) || 1);

    // Customer: the quotation's pick, verified org-scoped.
    const customerId = cfg.customerId || cfg.customer?.id || null;
    const customer = customerId
      ? await prisma.customer.findFirst({ where: { id: customerId, organizationId }, select: { id: true } })
      : null;

    // The job's site: the quotation's Job Location first (guru 2026-10-27 —
    // WCT quotes carry where the work happens, which is not the billing
    // address), then any Deliver To, then the customer's address.
    const di: any = cfg.documentInfo || {};
    const siteAddress = String(
      di.location || di.jobLocation || cfg.location || cfg.deliveryTo || cfg.customerAddress || cfg.customer?.address || '',
    ).trim();

    // Same qty-N → N qty-1 slot expansion for catalog lines as createScheduled,
    // so a later promotion edit sees the shape the dialog expects.
    const runData = (deliveryNumber: number, orderId: string | null) => ({
      organizationId,
      deliveryNumber,
      status: 'scheduled',
      isDraft: true,
      riderUserId: null,
      riderName: null,
      scheduledFor: null,
      projectId: doc.projectId ?? null,
      customerId: customer?.id ?? null,
      sourceQuotationId: doc.id,
      ...(siteAddress ? { siteAddress } : {}),
      notes: `Auto-created from accepted quotation ${doc.name || doc.id} — set the date and confirm the schedule to make it live.`,
      items: {
        create: lines.flatMap((l, lineIdx) => {
          const asset = resolveAsset(l);
          if (!asset) {
            return [
              {
                assetId: null,
                inventoryId: null,
                description: plainText(l.description) || 'Item',
                // A quotation line with no catalog product behind it is WORK in a
                // service-job org (the only orgs with this flag): a maintenance
                // visit, a degrease. The office flips a supplied item to Equipment
                // from the run page.
                assetClass: 'SERVICE',
                quantity: qtyOf(l),
                sortOrder: lineIdx * 100,
              },
            ];
          }
          return Array.from({ length: qtyOf(l) }, (_, n) => ({
            assetId: asset.id,
            inventoryId: null,
            description: asset.name,
            assetClass: null,
            quantity: 1,
            sortOrder: lineIdx * 100 + n,
          }));
        }),
      },
      ...(orderId ? { orderId } : {}),
    });

    if (wctOrders) return await createOrderWithFirstJob(prisma, organizationId, doc, customer?.id ?? null, lines, runData, logger);

    // Same per-org serial + P2002 retry as createScheduled.
    for (let attempt = 0; attempt < 3; attempt++) {
      const latest = await prisma.delivery.findFirst({
        where: { organizationId },
        orderBy: { deliveryNumber: 'desc' },
        select: { deliveryNumber: true },
      });
      const deliveryNumber = (latest?.deliveryNumber ?? 0) + 1;
      try {
        const run = await prisma.delivery.create({
          data: runData(deliveryNumber, null),
          select: { id: true, deliveryNumber: true },
        });
        logger?.log?.(`quotation→delivery: draft run #${run.deliveryNumber} created from quotation ${doc.name || doc.id}`);
        return run;
      } catch (err: any) {
        if (err?.code === 'P2002') continue; // serial raced — retry
        throw err;
      }
    }
    logger?.warn(`quotation→delivery: could not allocate a delivery number for quotation ${doc.id}`);
    return null;
  } catch (e: any) {
    logger?.warn(`quotation→delivery: draft not created for quotation ${documentId}: ${e?.message}`);
    return null;
  }
}

/**
 * WCT orders "Add job": the quotation's lines as the schedule dialog's rows,
 * resolved to catalog products exactly like the first job's (itemCode =
 * Asset.skuKey, or an inventoryItemId that is an Asset id); everything else a
 * free-typed SERVICE line. Read-only.
 */
export async function quotationLinesForJob(
  prisma: any,
  organizationId: string,
  cfg: any,
): Promise<Array<{ asset: { id: string; name: string; skuKey: string | null } | null; description: string; quantity: number; assetClass: string | null }>> {
  const lines = quotationLines(cfg);
  if (!lines.length) return [];
  const codes = [...new Set(lines.map((l) => String(l.itemCode ?? '').trim()).filter(Boolean))];
  const ids = [...new Set(lines.map((l) => l.inventoryItemId).filter((v: any): v is string => typeof v === 'string' && !!v))];
  const [byCode, byId] = await Promise.all([
    codes.length ? prisma.asset.findMany({ where: { organizationId, skuKey: { in: codes }, deletedAt: null }, select: { id: true, name: true, skuKey: true } }) : [],
    ids.length ? prisma.asset.findMany({ where: { organizationId, id: { in: ids }, deletedAt: null }, select: { id: true, name: true, skuKey: true } }) : [],
  ]);
  const assetByCode = new Map((byCode as any[]).map((a) => [String(a.skuKey ?? '').trim(), a]));
  const assetById = new Map((byId as any[]).map((a) => [a.id, a]));
  return lines.map((l) => {
    const asset = assetByCode.get(String(l.itemCode ?? '').trim()) ?? assetById.get(l.inventoryItemId) ?? null;
    const quantity = Math.max(1, Math.round(Number(l.quantity)) || 1);
    return asset
      ? { asset: { id: asset.id, name: asset.name, skuKey: asset.skuKey ?? null }, description: asset.name, quantity, assetClass: null }
      : { asset: null, description: plainText(l.description) || 'Item', quantity, assetClass: 'SERVICE' };
  });
}

/**
 * WCT orders: the Order for an accepted quotation plus its first (draft) job,
 * in ONE transaction under a per-quotation lock, so staff Confirm and the
 * client's e-sign landing together still make one order with one first job.
 * The order number is claimed inside the same transaction (rolled back with
 * it on a delivery-number race, then retried). Returns null when the order
 * already has a job.
 */
async function createOrderWithFirstJob(
  prisma: any,
  organizationId: string,
  doc: { id: string; name: string | null },
  customerId: string | null,
  lines: any[],
  runData: (deliveryNumber: number, orderId: string | null) => any,
  logger?: { warn: (m: string) => void; log?: (m: string) => void },
): Promise<{ id: string; deliveryNumber: number; orderId: string; orderNumber: string } | null> {
  const format = await ensureOrderNumberFormat(prisma, organizationId);
  const items = lines.map((l) => ({
    itemCode: l.itemCode ?? '',
    description: plainText(l.description),
    quantity: Number(l.quantity) || 1,
    unitPrice: Number(l.unitPrice) || 0,
    uom: l.uom ?? '',
    ...(l.accountCode ? { accountCode: l.accountCode } : {}),
  }));
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const out = await runAsOrg(organizationId, () =>
        prisma.$transaction(async (tx: any) => {
          await lockQuotation(tx, doc.id);
          let order = await tx.order.findFirst({ where: { organizationId, sourceQuotationId: doc.id }, select: { id: true, orderNumber: true } });
          if (order && (await tx.delivery.count({ where: { organizationId, orderId: order.id } })) > 0) return null;
          if (!order) {
            const orderNumber = await issueOrderNumberInTx(prisma, tx, organizationId, format.id);
            order = await tx.order.create({
              data: {
                organizationId,
                orderNumber,
                customerId,
                sourceQuotationId: doc.id,
                status: 'OPEN',
                items,
                linkedDocuments: { po: [], do: [], invoice: [], salesOrder: [] },
                notes: `Auto-created from quotation ${doc.name || doc.id}`,
              },
              select: { id: true, orderNumber: true },
            });
          }
          const latest = await tx.delivery.findFirst({ where: { organizationId }, orderBy: { deliveryNumber: 'desc' }, select: { deliveryNumber: true } });
          const run = await tx.delivery.create({ data: runData((latest?.deliveryNumber ?? 0) + 1, order!.id), select: { id: true, deliveryNumber: true } });
          return { ...run, orderId: order!.id, orderNumber: order!.orderNumber as string };
        }),
      );
      if (out) logger?.log?.(`quotation→order: ${out.orderNumber} with draft job #${out.deliveryNumber} created from quotation ${doc.name || doc.id}`);
      return out;
    } catch (err: any) {
      if (err?.code === 'P2002') continue; // a delivery or order number raced — retry the whole transaction
      throw err;
    }
  }
  logger?.warn(`quotation→order: could not allocate numbers for quotation ${doc.id}`);
  return null;
}

/**
 * Stamp the source-quotation link onto a DO config fragment at DO mint/regen
 * (updateScheduled). Sets sourceDocument* + quotationNo — which the WCT layout
 * prints as "Quotation Number" and priceInvoiceLinesFromAsset reads as the
 * quote tier when the auto-invoice is born — and carries the QUOTED PRICES
 * onto free-typed lines (matched by normalised description; catalog lines are
 * priced by the invoice's own SO→QO→asset ladder). Never throws; returns the
 * same config object.
 */
export async function applyQuotationLinkToDoConfig(
  prisma: any,
  organizationId: string,
  sourceQuotationId: string,
  cfg: Record<string, any>,
  logger?: { warn: (m: string) => void },
): Promise<Record<string, any>> {
  try {
    const qo = await prisma.document.findFirst({
      where: { id: sourceQuotationId, organizationId },
      select: { id: true, name: true, type: true, config: true },
    });
    if (!qo || !QUOTATION_TYPES.includes(String(qo.type).toUpperCase())) return cfg;
    const qcfg: any = qo.config || {};

    cfg.sourceDocumentId = qo.id;
    cfg.sourceDocumentType = 'QUOTATION';
    cfg.sourceDocumentNumber = qo.name ?? '';
    cfg.quotationNo = qo.name ?? '';
    if (!cfg.poNo && (qcfg.poNo || qcfg.referenceNo || qcfg.documentInfo?.referenceNo)) {
      cfg.poNo = qcfg.poNo || qcfg.documentInfo?.referenceNo || qcfg.referenceNo;
    }

    // Quoted prices for free-typed lines, matched on normalised description.
    // A description on 2+ quotation lines is ambiguous → skipped (same
    // strictness as the invoice pricing maps). Unmatched lines stay 0 for the
    // office to fill on the still-editable draft invoice.
    const qLines = quotationLines(qcfg);
    const seen = new Map<string, number>();
    for (const l of qLines) {
      const k = normDesc(l.description);
      if (k) seen.set(k, (seen.get(k) || 0) + 1);
    }
    const priceByDesc = new Map<string, number>();
    // The quotation line itself, for the bookkeeping keys that must follow the
    // line onto the DO and then the invoice: the revenue account (accountCode —
    // WCT's service lines post to SS001), item code, uom and the service flags.
    // Without them the invoice posted with the default sales account (guru
    // 2026-10-27: "are all the services linked to an account code?").
    const lineByDesc = new Map<string, any>();
    for (const l of qLines) {
      const k = normDesc(l.description);
      if (!k || seen.get(k)! > 1) continue;
      lineByDesc.set(k, l);
      const p = Number(l.unitPrice);
      if (!isFinite(p) || p <= 0) continue;
      priceByDesc.set(k, p);
    }
    const CARRY = ['accountCode', 'itemCode', 'uom', 'isService', 'revenueTag', 'taxCode', 'taxRate'];
    if (Array.isArray(cfg.items)) {
      for (const line of cfg.items) {
        if (!line || line.assetId) continue; // catalog lines price via the invoice ladder
        const src = lineByDesc.get(normDesc(line.description));
        if (src) {
          for (const k of CARRY) {
            if ((line[k] === undefined || line[k] === null || line[k] === '') && src[k] !== undefined && src[k] !== null && src[k] !== '') line[k] = src[k];
          }
        }
        if (Number(line.unitPrice) > 0) continue; // never overwrite an office-typed price
        const p = priceByDesc.get(normDesc(line.description));
        if (p === undefined) continue;
        const qty = Math.max(1, Number(line.quantity) || 1);
        line.unitPrice = p;
        line.amount = Math.round(p * qty * 100) / 100;
      }
    }
    return cfg;
  } catch (e: any) {
    logger?.warn(`quotation→delivery: DO link from quotation ${sourceQuotationId} not applied: ${e?.message}`);
    return cfg;
  }
}
