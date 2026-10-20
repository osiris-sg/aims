import { BadRequestException, Injectable } from '@nestjs/common';
import { grossOf } from '../common/document-money';
import { PrismaService } from '../common/prisma.service';
import { DOMAIN_RE } from '../ingestion-email/email-triage.rules';
import { TradeActor } from './shipments.request';
import { docRefBase, nextDocRef, orderDocRefBase, supplierOrderDocRefBase } from './trade-docref';
import { autoCompletePlan, countsForProgress, documentLinkState, fieldRequirements, hasExactlyOneOwner, ORDER_INVOICE_TYPES, readyToAutoComplete, stepLabel, stepLabels, stepRequirements, stepsBrokenByRemoval, typesOnEveryShipment } from './shipments.rules';
import { CustomerProfile, mergeProfiles, mergeSupplierProfiles, naStepCodes, profileFor, stepOverride, subtasksFor, SupplierProfile, supplierProfileFor } from './trade-profile';
import { ratesOf } from './trade-estimator';
import { cleanAlertRules } from './trade-alerts';
import { cleanLmeByMonth } from './trade-contract';
import { bankEntity } from './trade-entity';

/** A Prisma client or interactive-transaction client. */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type Db = any;

export type TradeScope = 'CONTRACT' | 'SHIPMENT' | 'ORDER' | 'SUPPLIER_ORDER';
/**
 * The record a step / file link / document link hangs off: a customer order
 * (since 2026-10), a supplier order (Vedanta's PI, 2026-10 round E), a
 * shipment, or a legacy contract.
 */
export type TradeOwner =
  | { contractId: string; shipmentId?: undefined; orderId?: undefined; supplierOrderId?: undefined }
  | { shipmentId: string; contractId?: undefined; orderId?: undefined; supplierOrderId?: undefined }
  | { orderId: string; contractId?: undefined; shipmentId?: undefined; supplierOrderId?: undefined }
  | { supplierOrderId: string; contractId?: undefined; shipmentId?: undefined; orderId?: undefined };

type OwnerIds = { contractId?: string | null; shipmentId?: string | null; orderId?: string | null; supplierOrderId?: string | null };
/** Prisma where-fragment for an owner. */
export const ownerWhere = (o: OwnerIds) =>
  o.supplierOrderId
    ? { supplierOrderId: o.supplierOrderId }
    : o.orderId
      ? { orderId: o.orderId }
      : o.shipmentId
        ? { shipmentId: o.shipmentId }
        : { contractId: o.contractId as string };
/** The owner's id (whichever kind). */
export const ownerIdOf = (o: OwnerIds) => (o.supplierOrderId ?? o.orderId ?? o.shipmentId ?? o.contractId) as string;
/** A row's owner (link / step) as a TradeOwner. */
export const toOwner = (o: OwnerIds): TradeOwner =>
  o.supplierOrderId
    ? { supplierOrderId: o.supplierOrderId }
    : o.orderId
      ? { orderId: o.orderId }
      : o.shipmentId
        ? { shipmentId: o.shipmentId }
        : { contractId: o.contractId as string };

export interface DocLinkRow {
  id: string;
  documentId: string;
  docType: string;
  stepId: string | null;
  contractId?: string | null;
  shipmentId?: string | null;
  orderId?: string | null;
  createdAt: Date;
}

export const DOC_LINK_SELECT = { id: true, documentId: true, docType: true, stepId: true, contractId: true, shipmentId: true, orderId: true, createdAt: true };

/** A contract/shipment a file or document link is being removed from. */
export interface RemovalOwner {
  contractId?: string;
  shipmentId?: string;
  orderId?: string;
  supplierOrderId?: string;
  label: string;
  status: string;
}

/** Prisma unique-constraint violation (duck-typed: per-org clients throw their own error class). */
export const isUniqueViolation = (e: unknown) => (e as { code?: string })?.code === 'P2002';

/**
 * Per-org Shipments configuration (doc types, step templates) plus the helpers
 * the other Shipments services share.
 */
@Injectable()
export class TradeConfigService {
  constructor(private readonly prisma: PrismaService) {}

  listDocTypes(organizationId: string) {
    return this.prisma.tradeDocType.findMany({
      where: { organizationId },
      orderBy: [{ sortOrder: 'asc' }, { code: 'asc' }],
      select: { id: true, code: true, label: true, category: true, sortOrder: true, isActive: true },
    });
  }

  listStepTemplates(organizationId: string, scope?: string) {
    if (scope && scope !== 'CONTRACT' && scope !== 'SHIPMENT' && scope !== 'ORDER' && scope !== 'SUPPLIER_ORDER') {
      throw new BadRequestException('scope must be SUPPLIER_ORDER, ORDER, SHIPMENT or CONTRACT');
    }
    return this.prisma.tradeStepTemplate.findMany({
      where: { organizationId, ...(scope ? { scope: scope as TradeScope } : {}) },
      orderBy: [{ scope: 'asc' }, { sortOrder: 'asc' }],
      select: {
        id: true,
        scope: true,
        code: true,
        title: true,
        displayNo: true,
        description: true,
        sortOrder: true,
        requiredDocTypes: true,
        optionalDocTypes: true,
        requiredFields: true,
        isOngoing: true,
        isActive: true,
      },
    });
  }

  /** Org trade defaults (B/L instruction texts); empty values when never set. */
  async getSettings(organizationId: string, db: Db = this.prisma) {
    const row = await db.tradeSetting.findUnique({
      where: { organizationId },
      select: { defaultConsignee: true, defaultNotifyParty: true, docDefaults: true, customerProfiles: true, supplierProfiles: true, estimatorRates: true, alertRules: true, updatedAt: true },
    });
    return {
      defaultConsignee: row?.defaultConsignee ?? null,
      defaultNotifyParty: row?.defaultNotifyParty ?? null,
      /** Default texts for in-app documents (From block, bank, invoice conditions …). */
      docDefaults: (row?.docDefaults as Record<string, unknown> | null) ?? {},
      /** Per-customer profiles keyed by customer id (see trade-profile.ts). */
      customerProfiles: (row?.customerProfiles as Record<string, CustomerProfile> | null) ?? {},
      /** Per-supplier profiles keyed by supplier id (hasPI, shipping document set — see trade-profile.ts). */
      supplierProfiles: (row?.supplierProfiles as Record<string, SupplierProfile> | null) ?? {},
      /** Alert rules (free days, reminder offsets, stuck days — see trade-alerts.ts). */
      alertRules: (row?.alertRules as Record<string, unknown> | null) ?? {},
      /** Estimator rates with the defaults filled in (see trade-estimator.ts). */
      estimatorRates: ratesOf(row?.estimatorRates),
      updatedAt: row?.updatedAt ?? null,
    };
  }

  /** A supplier's profile (Vedanta-like defaults — has a PI — when it has none). */
  async supplierProfileOf(organizationId: string, supplierId: string | null | undefined, db: Db = this.prisma): Promise<SupplierProfile> {
    const row = await db.tradeSetting.findUnique({ where: { organizationId }, select: { supplierProfiles: true } });
    return supplierProfileFor(row?.supplierProfiles, supplierId);
  }

  /** A customer's profile (TWO_STAGE defaults when it has none). */
  async profileOf(organizationId: string, customerId: string | null | undefined, db: Db = this.prisma): Promise<CustomerProfile> {
    const row = await db.tradeSetting.findUnique({ where: { organizationId }, select: { customerProfiles: true } });
    return profileFor(row?.customerProfiles, customerId);
  }

  async updateSettings(
    organizationId: string,
    dto: {
      defaultConsignee?: string | null;
      defaultNotifyParty?: string | null;
      docDefaults?: Record<string, unknown>;
      customerProfiles?: Record<string, unknown>;
      supplierProfiles?: Record<string, unknown>;
      estimatorRates?: Record<string, unknown>;
      alertRules?: Record<string, unknown>;
    },
  ) {
    const data: Record<string, unknown> = {};
    for (const k of ['defaultConsignee', 'defaultNotifyParty'] as const) {
      const v = optText(dto[k]);
      if (v !== undefined) data[k] = v;
    }
    if (dto.docDefaults !== undefined) {
      const cur = await this.prisma.tradeSetting.findUnique({ where: { organizationId }, select: { docDefaults: true } });
      data.docDefaults = mergeDocDefaults((cur?.docDefaults as Record<string, unknown> | null) ?? {}, dto.docDefaults);
    }
    if (dto.customerProfiles !== undefined) {
      const cur = await this.prisma.tradeSetting.findUnique({ where: { organizationId }, select: { customerProfiles: true } });
      data.customerProfiles = mergeProfiles(cur?.customerProfiles, dto.customerProfiles, (m) => {
        throw new BadRequestException(m);
      });
    }
    if (dto.supplierProfiles !== undefined) {
      const cur = await this.prisma.tradeSetting.findUnique({ where: { organizationId }, select: { supplierProfiles: true } });
      data.supplierProfiles = mergeSupplierProfiles(cur?.supplierProfiles, dto.supplierProfiles, (m) => {
        throw new BadRequestException(m);
      });
    }
    if (dto.alertRules !== undefined) {
      const cur = await this.prisma.tradeSetting.findUnique({ where: { organizationId }, select: { alertRules: true } });
      data.alertRules = cleanAlertRules({ ...((cur?.alertRules as Record<string, unknown> | null) ?? {}), ...dto.alertRules }, (m) => {
        throw new BadRequestException(m);
      });
    }
    if (dto.estimatorRates !== undefined) data.estimatorRates = cleanRates(dto.estimatorRates);
    await this.prisma.tradeSetting.upsert({ where: { organizationId }, update: data as any, create: { organizationId, ...(data as any) } });
    // A changed profile re-marks the N/A steps of the customer's open orders / shipments.
    if (dto.customerProfiles !== undefined) {
      for (const customerId of Object.keys(dto.customerProfiles ?? {})) await this.applyProfileToCustomer(this.prisma, organizationId, customerId);
    }
    if (dto.supplierProfiles !== undefined) {
      for (const supplierId of Object.keys(dto.supplierProfiles ?? {})) await this.applyProfileToSupplier(this.prisma, organizationId, supplierId);
    }
    return this.getSettings(organizationId);
  }

  /** code → label for the org's doc types (labels for error messages and lists). */
  async docTypeLabels(organizationId: string, db: Db = this.prisma): Promise<Map<string, string>> {
    const rows: Array<{ code: string; label: string }> = await db.tradeDocType.findMany({
      where: { organizationId },
      select: { code: true, label: true },
    });
    return new Map(rows.map((r) => [r.code, r.label]));
  }

  /** Throws 400 unless `code` is an active doc type of the org. */
  async assertActiveDocType(organizationId: string, code: string, db: Db = this.prisma) {
    const row = await db.tradeDocType.findFirst({ where: { organizationId, code }, select: { code: true, isActive: true } });
    if (!row) throw new BadRequestException(`Unknown document type "${code}"`);
    if (!row.isActive) throw new BadRequestException(`Document type "${code}" is no longer active`);
  }

  /**
   * Doc-type codes present on one contract/shipment: every linked TradeFile's
   * type plus every TradeDocumentLink whose Document is CONFIRMED (not a draft,
   * not voided, not deleted). `exclude` drops one file or one document link (to test a removal).
   */
  async presentDocTypes(db: Db, organizationId: string, owner: TradeOwner, exclude: { fileId?: string; docLinkId?: string } = {}): Promise<string[]> {
    const where = ownerWhere(owner);
    const [files, docLinks]: [Array<{ file: { docType: string } }>, Array<{ docType: string; documentId: string }>] = await Promise.all([
      db.tradeFileLink.findMany({
        where: { organizationId, ...where, ...(exclude.fileId ? { NOT: { fileId: exclude.fileId } } : {}) },
        select: { file: { select: { docType: true } } },
      }),
      db.tradeDocumentLink.findMany({
        where: { organizationId, ...where, ...(exclude.docLinkId ? { NOT: { id: exclude.docLinkId } } : {}) },
        select: { docType: true, documentId: true },
      }),
    ]);
    const live = await this.countableDocumentIds(
      db,
      organizationId,
      docLinks.map((l) => l.documentId),
    );
    const own = [...files.map((f) => f.file.docType), ...docLinks.filter((l) => live.has(l.documentId)).map((l) => l.docType)];
    // Step 11 is the order's (round H): Invoice #2 / the single invoice counts once every live shipment has one.
    if (owner.orderId) return [...own, ...(await this.orderInvoiceTypes(db, organizationId, owner.orderId))];
    if (owner.shipmentId) return [...own, ...(await this.shipmentFieldTypes(db, organizationId, owner.shipmentId))];
    return own;
  }

  /**
   * Required documents a shipment can meet with a field instead of a file (prod click-through, round H):
   * the telex release code (Vedanta's email has only the code) → TELEX_RELEASE; the 出庫・納入依頼書 rows with
   * delivery dates (the schedule agreed by email) → DELIVERY_SCHEDULE; the in-app import-tax estimate
   * (CIF + rate filled) → TAX_ESTIMATE (the broker's file becomes optional).
   */
  async shipmentFieldTypes(db: Db, organizationId: string, shipmentId: string): Promise<string[]> {
    if (!db.shipment?.findFirst) return []; // a partial client (unit tests' mocks)
    const s: { telexReleaseCode: string | null; costs: unknown } | null = await db.shipment.findFirst({ where: { id: shipmentId, organizationId }, select: { telexReleaseCode: true, costs: true } });
    if (!s) return [];
    const out: string[] = [];
    if (s.telexReleaseCode?.trim()) out.push('TELEX_RELEASE');
    const c = (s.costs ?? {}) as Record<string, unknown>;
    const filled = (v: unknown) => v !== null && v !== undefined && v !== '' && Number.isFinite(Number(v)) && Number(v) > 0;
    if (filled(c.cifUsd) && filled(c.fxRate)) out.push('TAX_ESTIMATE');
    const sis: Array<{ rows: unknown }> = !db.tradeGeneratedDoc?.findMany ? [] : await db.tradeGeneratedDoc.findMany({ where: { organizationId, shipmentId, docType: 'SHIPPING_INSTRUCTIONS' }, select: { rows: true } });
    if (sis.some((g) => Array.isArray(g.rows) && (g.rows as Array<{ deliveryDate?: unknown }>).some((r) => typeof r?.deliveryDate === 'string' && r.deliveryDate.trim() !== ''))) out.push('DELIVERY_SCHEDULE');
    return out;
  }

  /** Invoice #2 / single-invoice types present on every live shipment of the order (see typesOnEveryShipment). */
  async orderInvoiceTypes(db: Db, organizationId: string, orderId: string): Promise<string[]> {
    const ships: Array<{ id: string }> = await db.shipment.findMany({ where: { organizationId, orderId, status: { not: 'CANCELLED' } }, select: { id: true } });
    if (!ships.length) return [];
    const ids = ships.map((x) => x.id);
    const [files, docLinks]: [Array<{ shipmentId: string | null; file: { docType: string } }>, Array<{ shipmentId: string | null; docType: string; documentId: string }>] = await Promise.all([
      db.tradeFileLink.findMany({ where: { organizationId, shipmentId: { in: ids }, file: { docType: { in: ORDER_INVOICE_TYPES } } }, select: { shipmentId: true, file: { select: { docType: true } } } }),
      db.tradeDocumentLink.findMany({ where: { organizationId, shipmentId: { in: ids }, docType: { in: ORDER_INVOICE_TYPES } }, select: { shipmentId: true, docType: true, documentId: true } }),
    ]);
    const live = await this.countableDocumentIds(
      db,
      organizationId,
      docLinks.map((l) => l.documentId),
    );
    return typesOnEveryShipment(ids, [
      ...files.map((f) => ({ shipmentId: f.shipmentId, docType: f.file.docType })),
      ...docLinks.filter((l) => live.has(l.documentId)).map((l) => ({ shipmentId: l.shipmentId, docType: l.docType })),
    ]);
  }

  /**
   * TradeDocumentLink rows plus a summary of each linked Document. Deleted,
   * voided and draft Documents are still listed (`state`) but `satisfies` is
   * false, so they don't count for any step until confirmed.
   */
  async describeDocLinks(db: Db, organizationId: string, links: DocLinkRow[]) {
    if (!links.length) return [];
    const fallbackCurrency = await this.defaultCurrency(organizationId);
    const docs: Array<{ id: string; name: string | null; type: string; status: string; config: any; createdAt: Date; documentTemplateId: string }> = await db.document.findMany({
      where: { organizationId, id: { in: [...new Set(links.map((l) => l.documentId))] } },
      select: { id: true, name: true, type: true, status: true, config: true, createdAt: true, documentTemplateId: true },
    });
    const byId = new Map(docs.map((d) => [d.id, d]));
    // An ADH 請求書 made in-app is also a finalized PDF in the files list: its file id lets the
    // portal count it once (Files tab label vs list).
    const genIds = docs.map((d) => d.config?.tradeGeneratedDocId).filter((x): x is string => typeof x === 'string');
    const gens: Array<{ id: string; finalFileId: string | null }> = genIds.length
      ? await db.tradeGeneratedDoc.findMany({ where: { organizationId, id: { in: genIds } }, select: { id: true, finalFileId: true } })
      : [];
    const pdfOf = new Map(gens.map((g) => [g.id, g.finalFileId]));
    return links.map((l) => {
      const d = byId.get(l.documentId);
      const { state, satisfies } = documentLinkState(d);
      return {
        ...l,
        inAppFileId: (d?.config?.tradeGeneratedDocId && pdfOf.get(d.config.tradeGeneratedDocId)) || null,
        document: d ? documentSummary(d, fallbackCurrency) : null,
        state,
        deleted: state === 'deleted',
        voided: state === 'voided',
        satisfies,
      };
    });
  }

  /**
   * For a contract/shipment detail: describe its document links and give each
   * step `requirements` (per required type: files, live documents, satisfied).
   */
  async decorateRecord<S extends { requiredDocTypes: string[]; requiredFields?: string[] }>(
    organizationId: string,
    rec: { steps: S[]; fileLinks: Array<{ file: { docType: string } }>; docLinks: DocLinkRow[] } & Record<string, unknown>,
    db: Db = this.prisma,
    /** Types satisfied elsewhere (an order's step 11: its shipments' invoices). */
    extraTypes: string[] = [],
  ) {
    const docLinks = await this.describeDocLinks(db, organizationId, rec.docLinks);
    const fileTypes = [...rec.fileLinks.map((l) => l.file.docType), ...extraTypes];
    const docTypes = docLinks.filter((l) => l.satisfies).map((l) => l.docType);
    return {
      docLinks,
      steps: rec.steps.map((s) => ({
        ...s,
        requirements: stepRequirements(s.requiredDocTypes, fileTypes, docTypes),
        // Record fields the step needs (shipment step 2: B/L no. + product line).
        fieldRequirements: fieldRequirements(s.requiredFields, rec),
      })),
    };
  }

  /**
   * Auto-complete (the server side of the step cards): on each contract /
   * shipment, mark DONE every step whose required documents and fields are
   * all there, release reopened steps whose own documents / fields changed,
   * and make the first open step the current one (IN_PROGRESS). Closed
   * records are left alone. Returns the labels of the steps it completed.
   */
  async syncSteps(
    db: Db,
    organizationId: string,
    owners: TradeOwner[],
    actor: TradeActor | null,
    changed: { docTypes?: string[]; fields?: string[] } = {},
    opts: { closeCheck?: boolean; closed?: { shipments: string[]; contracts: string[]; orders?: string[] } } = {},
  ): Promise<string[]> {
    const done: string[] = [];
    const seen = new Set<string>();
    const queue = [...owners];
    for (let qi = 0; qi < queue.length; qi++) {
      const owner = queue[qi];
      const key = ownerIdOf(owner);
      if (!key || seen.has(key)) continue;
      seen.add(key);
      const record = owner.supplierOrderId
        ? await db.supplierOrder.findFirst({ where: { id: owner.supplierOrderId, organizationId } })
        : owner.orderId
        ? await db.tradeOrder.findFirst({ where: { id: owner.orderId, organizationId } })
        : owner.contractId
          ? await db.contract.findFirst({ where: { id: owner.contractId, organizationId } })
          : await db.shipment.findFirst({ where: { id: owner.shipmentId, organizationId } });
      // A shipment's invoice can finish its order's step 11 — even once the shipment itself is completed.
      if (record && owner.shipmentId && record.orderId) queue.push({ orderId: record.orderId });
      if (!record || record.status !== 'OPEN') continue;
      const steps: Array<{
        id: string;
        code: string;
        payment: unknown;
        title: string;
        displayNo: string | null;
        status: string;
        isOngoing: boolean;
        notApplicable: boolean;
        sortOrder: number;
        requiredDocTypes: string[];
        requiredFields: string[];
        holdOpen: boolean;
      }> = await db.tradeStep.findMany({
        where: { organizationId, ...ownerWhere(owner) },
        orderBy: { sortOrder: 'asc' },
        select: { id: true, code: true, payment: true, title: true, displayNo: true, status: true, isOngoing: true, notApplicable: true, sortOrder: true, requiredDocTypes: true, requiredFields: true, holdOpen: true },
      });
      if (!steps.length) continue;
      const plan = autoCompletePlan(steps, await this.presentDocTypes(db, organizationId, owner), record, changed, readyToAutoComplete);
      const stamp = { updatedById: actor?.id ?? null, updatedByName: actor?.name ?? 'Auto' };
      const now = new Date();
      for (const s of plan.release) if (!plan.complete.includes(s)) await db.tradeStep.update({ where: { id: s.id, organizationId }, data: { holdOpen: false } });
      for (const s of plan.complete) {
        await db.tradeStep.update({ where: { id: s.id, organizationId }, data: { status: 'DONE', completedAt: now, skipReason: null, holdOpen: false, ...stamp } });
      }
      if (plan.start) await db.tradeStep.update({ where: { id: plan.start.id, organizationId }, data: { status: 'IN_PROGRESS', ...stamp } });
      const labels = stepLabels(steps);
      done.push(...plan.complete.map((s) => labels.get(s.id) ?? stepLabel(s)));
      // A step finished just now (auto or "Mark done") may finish the record — and the deal.
      if (plan.complete.length || opts.closeCheck) {
        const allDone = steps.every((s) => !countsForProgress(s) || s.status === 'DONE' || plan.complete.includes(s));
        if (owner.shipmentId && allDone) {
          await db.shipment.update({ where: { id: owner.shipmentId, organizationId }, data: { status: 'COMPLETED' } });
          opts.closed?.shipments.push(owner.shipmentId);
          if (record.orderId) await this.closeOrderIfDone(db, organizationId, record.orderId, opts.closed);
          else if (record.contractId) await this.closeDealIfDone(db, organizationId, record.contractId, opts.closed);
        } else if (owner.orderId && allDone) {
          await this.closeOrderIfDone(db, organizationId, owner.orderId, opts.closed);
        } else if (owner.supplierOrderId && allDone) {
          await this.closeSupplierOrderIfDone(db, organizationId, owner.supplierOrderId);
        } else if (owner.contractId && allDone) {
          await this.closeDealIfDone(db, organizationId, owner.contractId, opts.closed);
        }
      }
    }
    return done;
  }

  /**
   * The deal (contract) completes by itself when its own steps are all done and
   * every shipment is completed (cancelled ones don't count; at least one must
   * be completed). Manual Complete / Reopen stay available.
   */
  async closeDealIfDone(db: Db, organizationId: string, contractId: string, closed?: { contracts: string[] }) {
    const c = await db.contract.findFirst({
      where: { id: contractId, organizationId },
      select: { status: true, steps: { select: { status: true, isOngoing: true } }, shipments: { select: { status: true } } },
    });
    if (!c || c.status !== 'OPEN') return;
    const stepsDone = c.steps.every((s: { status: string; isOngoing: boolean }) => s.isOngoing || s.status === 'DONE');
    const ships = c.shipments.filter((x: { status: string }) => x.status !== 'CANCELLED');
    if (stepsDone && ships.length > 0 && ships.every((x: { status: string }) => x.status === 'COMPLETED')) {
      await db.contract.update({ where: { id: contractId, organizationId }, data: { status: 'COMPLETED' } });
      closed?.contracts.push(contractId);
    }
  }

  /**
   * An order completes by itself when its own steps are all done (N/A and
   * ongoing ones don't count) and every shipment under it is completed
   * (cancelled ones don't count; at least one must be completed).
   */
  async closeOrderIfDone(db: Db, organizationId: string, orderId: string, closed?: { orders?: string[] }) {
    const o = await db.tradeOrder.findFirst({
      where: { id: orderId, organizationId },
      select: { status: true, steps: { select: { status: true, isOngoing: true, notApplicable: true } }, shipments: { select: { status: true } } },
    });
    if (!o || o.status !== 'OPEN') return;
    const stepsDone = o.steps.every((s: { status: string; isOngoing: boolean; notApplicable: boolean }) => !countsForProgress(s) || s.status === 'DONE');
    const ships = o.shipments.filter((x: { status: string }) => x.status !== 'CANCELLED');
    if (stepsDone && ships.length > 0 && ships.every((x: { status: string }) => x.status === 'COMPLETED')) {
      await db.tradeOrder.update({ where: { id: orderId, organizationId }, data: { status: 'COMPLETED' } });
      closed?.orders?.push(orderId);
    }
  }

  /**
   * A supplier order completes by itself when its own steps (0, 1) are done
   * and every customer order bought under it is completed (cancelled ones
   * don't count; at least one must be completed).
   */
  async closeSupplierOrderIfDone(db: Db, organizationId: string, supplierOrderId: string) {
    const so = await db.supplierOrder.findFirst({
      where: { id: supplierOrderId, organizationId },
      select: { status: true, steps: { select: { status: true, isOngoing: true, notApplicable: true } }, customerOrders: { select: { status: true } } },
    });
    if (!so || so.status !== 'OPEN') return;
    const stepsDone = so.steps.every((s: { status: string; isOngoing: boolean; notApplicable: boolean }) => !countsForProgress(s) || s.status === 'DONE');
    const orders = so.customerOrders.filter((x: { status: string }) => x.status !== 'CANCELLED');
    if (stepsDone && orders.length > 0 && orders.every((x: { status: string }) => x.status === 'COMPLETED')) {
      await db.supplierOrder.update({ where: { id: supplierOrderId, organizationId }, data: { status: 'COMPLETED' } });
    }
  }

  /** Ids (of `ids`) whose Document exists in the org and counts (confirmed, not voided). */
  async countableDocumentIds(db: Db, organizationId: string, ids: string[]): Promise<Set<string>> {
    if (!ids.length) return new Set();
    const docs: Array<{ id: string; status: string; config: unknown }> = await db.document.findMany({
      where: { organizationId, id: { in: [...new Set(ids)] } },
      select: { id: true, status: true, config: true },
    });
    return new Set(docs.filter((d) => documentLinkState(d).satisfies).map((d) => d.id));
  }

  /** The org's default currency — shown for documents saved without one. */
  async defaultCurrency(organizationId: string): Promise<string | null> {
    const org = await this.prisma.organization.findFirst({ where: { id: organizationId }, select: { defaultCurrency: true } });
    return org?.defaultCurrency ?? null;
  }

  /**
   * Removing one file / document link from these contracts/shipments must not
   * leave a DONE step without one of its required doc types (counting both
   * files and live in-app documents). Closed records are refused outright.
   */
  async assertRemovalKeepsDoneSteps(db: Db, organizationId: string, owners: RemovalOwner[], exclude: { fileId?: string; docLinkId?: string }, verb: string) {
    const problems: string[] = [];
    let labels: Map<string, string> | null = null;
    for (const o of owners) {
      if (o.status !== 'OPEN') {
        throw new BadRequestException(`Can't ${verb}: ${o.label} is ${o.status.toLowerCase()} — reopen it first`);
      }
      const owner: TradeOwner = toOwner(o);
      const doneSteps: Array<{ id: string; title: string; displayNo: string | null; status: string; isOngoing: boolean; notApplicable: boolean; requiredDocTypes: string[] }> = await db.tradeStep.findMany({
        where: { organizationId, ...ownerWhere(owner), status: 'DONE' },
        orderBy: { sortOrder: 'asc' },
        select: { id: true, title: true, displayNo: true, status: true, isOngoing: true, notApplicable: true, requiredDocTypes: true },
      });
      if (!doneSteps.length) continue;
      const broken = stepsBrokenByRemoval(doneSteps, await this.presentDocTypes(db, organizationId, owner, exclude));
      if (!broken.length) continue;
      labels ??= await this.docTypeLabels(organizationId, db);
      for (const b of broken) {
        problems.push(`"${stepLabel(b.step)}" on ${o.label} (needs ${b.missing.map((c) => labels!.get(c) ?? c).join(', ')})`);
      }
    }
    if (problems.length) {
      throw new BadRequestException(`Can't ${verb}: these done steps would lose a required document — reopen them first: ${problems.join('; ')}`);
    }
  }

  /**
   * Link an already-stored source file (the PI / B/L draft read by AI) to a
   * new contract or shipment and to the step that needs it; extraction rows of
   * that file then point at the record.
   */
  async linkSourceFile(db: Db, organizationId: string, fileId: string, docType: string, owner: TradeOwner, stepCode: string) {
    const file = await db.tradeFile.findFirst({ where: { id: fileId, organizationId }, select: { id: true, docType: true, fileName: true } });
    if (!file) throw new BadRequestException('The source file was not found');
    if (file.docType !== docType) throw new BadRequestException(`${file.fileName} is filed as ${file.docType}, not ${docType}`);
    const step = await db.tradeStep.findFirst({ where: { organizationId, ...ownerWhere(owner), code: stepCode }, select: { id: true } });
    const linked = await db.tradeFileLink.findFirst({ where: { organizationId, fileId, ...ownerWhere(owner) }, select: { id: true } });
    if (!linked) {
      await db.tradeFileLink.create({
        data: {
          organizationId,
          fileId,
          contractId: owner.contractId ?? null,
          shipmentId: owner.shipmentId ?? null,
          orderId: owner.orderId ?? null,
          supplierOrderId: owner.supplierOrderId ?? null,
          stepId: step?.id ?? null,
        },
      });
    }
    await this.ensureFileDocRef(db, organizationId, fileId, owner);
    await db.tradeExtraction.updateMany({ where: { organizationId, fileId }, data: ownerWhere(owner) });
  }

  /**
   * The document ID for a new document of `docType` on this contract / shipment
   * (see trade-docref.ts): the next free "<contract>-<shipment no>-<code>"
   * across uploaded files and in-app documents. A shipment created before
   * shipment numbers existed gets its number first.
   */
  async docRefFor(db: Db, organizationId: string, owner: TradeOwner, docType: string): Promise<string | null> {
    let base: string | null = null;
    if (owner.supplierOrderId) {
      // "26-S3-PI": the supplier order's year + number.
      const so = await db.supplierOrder.findFirst({ where: { id: owner.supplierOrderId, organizationId }, select: { year: true, soNo: true } });
      if (so) base = supplierOrderDocRefBase({ year: so.year, soNo: so.soNo }, docType);
    } else if (owner.orderId) {
      const o = await db.tradeOrder.findFirst({ where: { id: owner.orderId, organizationId }, select: { year: true, orderNo: true } });
      if (o) base = orderDocRefBase({ year: o.year, orderNo: o.orderNo }, docType);
    } else if (owner.shipmentId) {
      const s = await db.shipment.findFirst({
        where: { id: owner.shipmentId, organizationId },
        select: { id: true, seqNo: true, contractId: true, orderId: true, contract: { select: { contractNo: true } }, order: { select: { year: true, orderNo: true } } },
      });
      if (!s) return null;
      if (s.order) {
        // "26-19-1-CPL": order year + number + the shipment's number in the order.
        const seqNo = s.seqNo ?? (await this.ensureSeqNo(db, organizationId, { orderId: s.orderId }, s.id));
        base = orderDocRefBase({ year: s.order.year, orderNo: s.order.orderNo, seqNo }, docType);
      } else if (s.contract?.contractNo) {
        const seqNo = s.seqNo ?? (await this.ensureSeqNo(db, organizationId, { contractId: s.contractId }, s.id));
        base = docRefBase({ contractNo: s.contract.contractNo, seqNo }, docType);
      }
    } else if (owner.contractId) {
      const c = await db.contract.findFirst({ where: { id: owner.contractId, organizationId }, select: { contractNo: true } });
      if (c?.contractNo) base = docRefBase({ contractNo: c.contractNo, seqNo: null }, docType);
    }
    if (!base) return null;
    const [files, gens]: [Array<{ docRef: string | null }>, Array<{ docRef: string | null }>] = await Promise.all([
      db.tradeFile.findMany({ where: { organizationId, docRef: { startsWith: base } }, select: { docRef: true } }),
      db.tradeGeneratedDoc.findMany({ where: { organizationId, docRef: { startsWith: base } }, select: { docRef: true } }),
    ]);
    return nextDocRef(base, [...files, ...gens].map((r) => r.docRef));
  }

  /** Number the order's (or legacy contract's) shipments 1, 2, … by creation (only those still without one); returns this shipment's. */
  async ensureSeqNo(db: Db, organizationId: string, parent: { orderId?: string | null; contractId?: string | null }, shipmentId: string): Promise<number> {
    const where = parent.orderId ? { orderId: parent.orderId } : { contractId: parent.contractId };
    const ships: Array<{ id: string; seqNo: number | null }> = await db.shipment.findMany({ where: { organizationId, ...where }, orderBy: { createdAt: 'asc' }, select: { id: true, seqNo: true } });
    let next = Math.max(0, ...ships.map((x) => x.seqNo ?? 0));
    let mine = ships.find((x) => x.id === shipmentId)?.seqNo ?? null;
    for (const x of ships) {
      if (x.seqNo) continue;
      next += 1;
      await db.shipment.update({ where: { id: x.id }, data: { seqNo: next } });
      if (x.id === shipmentId) mine = next;
    }
    return mine ?? next;
  }

  /** Give a file its document ID if it has none yet (it was stored before it was linked to a record). */
  async ensureFileDocRef(db: Db, organizationId: string, fileId: string, owner: TradeOwner) {
    const f = await db.tradeFile.findFirst({ where: { id: fileId, organizationId }, select: { docRef: true, docType: true } });
    if (!f || f.docRef) return;
    const ref = await this.docRefFor(db, organizationId, owner, f.docType);
    if (ref) await db.tradeFile.update({ where: { id: fileId }, data: { docRef: ref } });
  }

  /**
   * Copy the org's active templates of `scope` onto a new order / shipment as
   * TradeStep rows, shaped by the customer's profile: steps that don't apply
   * are marked N/A, SINGLE billing issues INVOICE_SINGLE on step 11, and
   * "sent" sub-tasks are attached (N/A ones flagged).
   */
  async snapshotSteps(db: Db, organizationId: string, scope: TradeScope, owner: TradeOwner, profile?: CustomerProfile, supplier?: SupplierProfile | null) {
    if (!hasExactlyOneOwner(owner)) throw new BadRequestException('A step belongs to exactly one order, shipment or contract');
    const p = profile ?? profileFor(null, null);
    const na = new Set(naStepCodes(p, scope, supplier));
    const templates: Array<{ id: string; code: string; title: string; displayNo: string | null; sortOrder: number; requiredDocTypes: string[]; optionalDocTypes: string[]; requiredFields: string[]; isOngoing: boolean }> =
      await db.tradeStepTemplate.findMany({
        where: { organizationId, scope, isActive: true },
        orderBy: { sortOrder: 'asc' },
        select: { id: true, code: true, title: true, displayNo: true, sortOrder: true, requiredDocTypes: true, optionalDocTypes: true, requiredFields: true, isOngoing: true },
      });
    if (!templates.length) return 0;
    await db.tradeStep.createMany({
      data: templates.map((t) => {
        const o = stepOverride(p, t.code, supplier);
        const subtasks = subtasksFor(t.code, p);
        return {
          organizationId,
          contractId: owner.contractId ?? null,
          shipmentId: owner.shipmentId ?? null,
          orderId: owner.orderId ?? null,
          supplierOrderId: owner.supplierOrderId ?? null,
          templateId: t.id,
          code: t.code,
          title: o.title ?? t.title,
          displayNo: t.displayNo,
          sortOrder: t.sortOrder,
          requiredDocTypes: o.requiredDocTypes ?? t.requiredDocTypes,
          optionalDocTypes: t.optionalDocTypes ?? [],
          requiredFields: t.requiredFields ?? [],
          isOngoing: t.isOngoing,
          notApplicable: na.has(t.code),
          ...(subtasks ? { subtasks: subtasks as any } : {}),
        };
      }),
    });
    return templates.length;
  }

  /**
   * Re-apply a customer's profile to the not-yet-done steps of its open orders
   * and shipments: N/A flags, step 11's invoice type and N/A sub-tasks. Done
   * steps are left as they are.
   */
  async applyProfileToCustomer(db: Db, organizationId: string, customerId: string) {
    const p = await this.profileOf(organizationId, customerId, db);
    const orders: Array<{ id: string; supplierId: string; shipments: Array<{ id: string; status: string }> }> = await db.tradeOrder.findMany({
      where: { organizationId, customerId, status: 'OPEN' },
      select: { id: true, supplierId: true, shipments: { select: { id: true, status: true } } },
    });
    for (const o of orders) {
      const sp = await this.supplierProfileOf(organizationId, o.supplierId, db);
      await this.applyProfile(db, organizationId, { orderId: o.id }, 'ORDER', p, sp);
      for (const s of o.shipments.filter((x) => x.status === 'OPEN')) await this.applyProfile(db, organizationId, { shipmentId: s.id }, 'SHIPMENT', p, sp);
    }
  }

  /** Re-apply a supplier's profile (PI or not, its shipping documents) to its open supplier orders and shipments. */
  async applyProfileToSupplier(db: Db, organizationId: string, supplierId: string) {
    const sp = await this.supplierProfileOf(organizationId, supplierId, db);
    const sos: Array<{ id: string }> = await db.supplierOrder.findMany({ where: { organizationId, supplierId, status: 'OPEN' }, select: { id: true } });
    for (const so of sos) await this.applyProfile(db, organizationId, { supplierOrderId: so.id }, 'SUPPLIER_ORDER', profileFor(null, null), sp);
    const orders: Array<{ id: string; customerId: string; shipments: Array<{ id: string; status: string }> }> = await db.tradeOrder.findMany({
      where: { organizationId, supplierId, status: 'OPEN' },
      select: { id: true, customerId: true, shipments: { select: { id: true, status: true } } },
    });
    for (const o of orders) {
      const p = await this.profileOf(organizationId, o.customerId, db);
      await this.applyProfile(db, organizationId, { orderId: o.id }, 'ORDER', p, sp);
      for (const s of o.shipments.filter((x) => x.status === 'OPEN')) await this.applyProfile(db, organizationId, { shipmentId: s.id }, 'SHIPMENT', p, sp);
    }
  }

  async applyProfile(db: Db, organizationId: string, owner: TradeOwner, scope: TradeScope, p: CustomerProfile, supplier?: SupplierProfile | null) {
    const na = new Set(naStepCodes(p, scope, supplier));
    const steps: Array<{ id: string; code: string; status: string; notApplicable: boolean; title: string; requiredDocTypes: string[]; subtasks: unknown }> = await db.tradeStep.findMany({
      where: { organizationId, ...ownerWhere(owner) },
      select: { id: true, code: true, status: true, notApplicable: true, title: true, requiredDocTypes: true, subtasks: true },
    });
    const templates: Array<{ code: string; title: string; requiredDocTypes: string[] }> = await db.tradeStepTemplate.findMany({
      where: { organizationId, scope },
      select: { code: true, title: true, requiredDocTypes: true },
    });
    for (const s of steps) {
      if (s.status === 'DONE') continue;
      const t = templates.find((x) => x.code === s.code);
      const o = stepOverride(p, s.code, supplier);
      const data: Record<string, unknown> = {};
      if (s.notApplicable !== na.has(s.code)) data.notApplicable = na.has(s.code);
      const want = o.requiredDocTypes ?? t?.requiredDocTypes;
      if (want && JSON.stringify(want) !== JSON.stringify(s.requiredDocTypes)) data.requiredDocTypes = want;
      const title = o.title ?? t?.title;
      if (title && title !== s.title) data.title = title;
      const fresh = subtasksFor(s.code, p);
      if (fresh) {
        const cur = Array.isArray(s.subtasks) ? (s.subtasks as Array<{ key: string; done?: boolean }>) : [];
        const merged = fresh.map((f) => ({ ...f, ...(cur.find((c) => c.key === f.key) ?? {}), na: f.na }));
        if (JSON.stringify(merged) !== JSON.stringify(cur)) data.subtasks = merged;
      }
      if (Object.keys(data).length) await db.tradeStep.update({ where: { id: s.id }, data });
    }
  }
}

/**
 * Display summary of a Sales Document. Total: the stamped gross (grossOf — the
 * one money read path), else the same candidates the invoice list's Amount
 * column uses, else the sum of the line items (a draft the editor saved has
 * no stamped total yet). Customer: the object or the editor's flat customerName.
 */
export function documentSummary(
  d: { id: string; name: string | null; type: string; status: string; config: any; createdAt: Date; documentTemplateId: string },
  fallbackCurrency: string | null = null,
) {
  const c = d.config ?? {};
  // First NON-ZERO candidate: a credit-style invoice (Invoice #2 with the first
  // shipment deducted) has a negative total that must not be skipped.
  const firstNonZero = (...v: unknown[]) =>
    v
      .filter((x) => x != null && x !== '')
      .map((x) => Number(x))
      .find((n) => Number.isFinite(n) && n !== 0) ?? null;
  const itemsTotal = Array.isArray(c.items) ? c.items.reduce((sum: number, it: any) => sum + (Number(it?.amount) || Number(it?.quantity) * Number(it?.unitPrice) || 0), 0) : 0;
  return {
    id: d.id,
    number: d.name,
    type: d.type,
    templateId: d.documentTemplateId,
    status: d.status,
    total: grossOf(c) ?? firstNonZero(c.summary?.grandTotal, c.grandTotal, c.total, c.summary?.total) ?? (itemsTotal || null),
    currency: c.currency ?? c.documentInfo?.currency ?? c.currencyCode ?? fallbackCurrency,
    date: c.date ?? c.documentInfo?.date ?? c.invoiceDate ?? d.createdAt,
    customerName: c.customer?.name ?? c.customerName ?? c.billTo?.name ?? null,
  };
}

/** A Document whose config says it was voided no longer counts as a trade document. */
export const isVoided = (config: unknown) => !!(config as { voided?: unknown } | null)?.voided;

/** Page/pageSize parsing shared by the list endpoints. */
export function pageArgs(page?: string | number, pageSize?: string | number) {
  const p = Math.max(1, Math.floor(Number(page) || 1));
  const size = Math.min(100, Math.max(1, Math.floor(Number(pageSize) || 20)));
  return { page: p, pageSize: size, skip: (p - 1) * size, take: size };
}

/** Optional trimmed string: undefined stays undefined (field untouched), '' becomes null. */
export function optText(v: unknown): string | null | undefined {
  if (v === undefined) return undefined;
  if (v === null) return null;
  const s = String(v).trim();
  return s === '' ? null : s;
}

/** Estimator rates patch: numbers ≥ 0 (truckRates: { "<t>": yen }); unknown keys refused. */
export function cleanRates(v: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  const NUMS = ['taxMultiplier', 'customsPerMt', 'blFee', 'storagePerContainer', 'storagePerMt', 'washingPerContainer', 'detentionPerContainer'];
  for (const [k, x] of Object.entries(v ?? {})) {
    if (k === 'truckRates') {
      if (!x || typeof x !== 'object' || Array.isArray(x)) throw new BadRequestException('truckRates must map tonnes to yen');
      const t: Record<string, number> = {};
      for (const [cap, yen] of Object.entries(x as Record<string, unknown>)) {
        if (!/^\d+$/.test(cap) || typeof yen !== 'number' || !Number.isFinite(yen) || yen < 0) throw new BadRequestException(`Truck rate for ${cap}t must be a number`);
        t[cap] = yen;
      }
      out.truckRates = t;
    } else if (NUMS.includes(k)) {
      if (typeof x !== 'number' || !Number.isFinite(x) || x < 0) throw new BadRequestException(`${k} must be a number`);
      out[k] = x;
    } else throw new BadRequestException(`Unknown estimator rate "${k}"`);
  }
  return out;
}

const SEAL_MAX_BYTES = 1024 * 1024;
const isText = (v: unknown, max = 4000) => typeof v === 'string' && v.length <= max;

/**
 * Apply a docDefaults patch: each listed key is replaced (null removes it).
 * Shapes are checked for the structured keys — banks, deliveryProfiles,
 * sealImage (PNG / JPEG data: URL, ≤ 1 MB) — and texts are capped; anything
 * else is refused with a message naming the key.
 */
export function mergeDocDefaults(current: Record<string, unknown>, patch: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = { ...current };
  for (const [k, v] of Object.entries(patch ?? {})) {
    if (!/^[A-Za-z][A-Za-z0-9]{0,63}$/.test(k)) throw new BadRequestException(`Unknown document setting "${k}"`);
    if (v === null) {
      delete out[k];
      continue;
    }
    if (k === 'banks') {
      if (!Array.isArray(v) || v.length > 10 || !v.every((b) => b && isText(b.id, 64) && isText(b.label, 200) && isText(b.block)))
        throw new BadRequestException('banks must be a list (max 10) of { id, label, block, entity? }');
      if (v.some((b) => b.entity !== undefined && b.entity !== null && b.entity !== 'ADH_JP' && b.entity !== 'ADH_SG')) throw new BadRequestException('A bank entity is ADH_JP or ADH_SG');
      // Each account belongs to one entity (DBS / Wise / CFSB = ADH SG, SMBC JPY = ADH JP).
      out[k] = v.map((b) => ({ id: b.id.trim(), label: b.label.trim(), block: b.block, entity: bankEntity(b) }));
    } else if (k === 'deliveryProfiles') {
      if (!Array.isArray(v) || v.length > 50 || !v.every((p) => p && isText(p.id, 64) && isText(p.customerName, 200) && isText(p.siteName, 200) && isText(p.address, 500) && isText(p.notes ?? '')))
        throw new BadRequestException('deliveryProfiles must be a list (max 50) of { id, customerName, siteName, address, notes }');
      out[k] = v.map((p) => ({ id: p.id, customerName: p.customerName.trim(), siteName: p.siteName.trim(), address: p.address.trim(), notes: p.notes ?? '' }));
    } else if (k === 'sealImage') {
      const m = typeof v === 'string' ? /^data:image\/(png|jpeg);base64,([A-Za-z0-9+/=]+)$/.exec(v) : null;
      if (!m) throw new BadRequestException('The seal must be a PNG or JPEG image');
      if (Buffer.from(m[2], 'base64').length > SEAL_MAX_BYTES) throw new BadRequestException('The seal image must be 1 MB or smaller');
      out[k] = v;
    } else if (k === 'qmjpByQuarter') {
      // { "2026-2Q": 351.5, "2026-3Q": 395 } — QMJP (US$/MT) per quarter.
      if (typeof v !== 'object' || Array.isArray(v)) throw new BadRequestException('qmjpByQuarter must map quarters ("2026-3Q") to numbers');
      const out2: Record<string, number> = {};
      for (const [q, n] of Object.entries(v as Record<string, unknown>)) {
        if (!/^\d{4}-[1-4]Q$/.test(q)) throw new BadRequestException(`QMJP quarter "${q}" must look like 2026-3Q`);
        if (typeof n !== 'number' || !Number.isFinite(n) || n < 0 || n > 100000) throw new BadRequestException(`QMJP for ${q} must be a number`);
        out2[q] = n;
      }
      out[k] = out2;
    } else if (k === 'lmeByMonth') {
      // { "2026-07": 3155.98 } — LME cash monthly average (US$/MT) for the price check.
      out[k] = cleanLmeByMonth(v, (m) => {
        throw new BadRequestException(m);
      });
    } else if (k === 'intakeKeepDomains') {
      // Email intake: mail with these domains is never purged automatically (NOT_SHIPMENT → UNSURE).
      const list = (Array.isArray(v) ? v : typeof v === 'string' ? v.split(/[,\s]+/) : null)?.map((d) => String(d).trim().toLowerCase().replace(/^@/, '')).filter(Boolean);
      if (!list || list.length > 100) throw new BadRequestException('intakeKeepDomains must be a list of up to 100 domains');
      const bad = list.find((d) => !DOMAIN_RE.test(d));
      if (bad) throw new BadRequestException(`"${bad.slice(0, 80)}" is not an email domain (like vedanta.co.in)`);
      out[k] = [...new Set(list)];
    } else if (k === 'productJa' || k === 'sizeInch') {
      if (typeof v !== 'object' || Array.isArray(v) || !Object.values(v as object).every((x) => isText(x, 200))) throw new BadRequestException(`${k} must map text to text`);
      out[k] = v;
    } else if (typeof v === 'number') {
      if (!Number.isFinite(v)) throw new BadRequestException(`${k} must be a number`);
      out[k] = v;
    } else if (isText(v)) out[k] = v;
    else throw new BadRequestException(`${k} must be text (max 4,000 characters)`);
  }
  return out;
}
