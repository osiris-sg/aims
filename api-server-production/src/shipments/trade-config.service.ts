import { BadRequestException, Injectable } from '@nestjs/common';
import { grossOf } from '../common/document-money';
import { PrismaService } from '../common/prisma.service';
import { TradeActor } from './shipments.request';
import { autoCompletePlan, documentLinkState, fieldRequirements, hasExactlyOneOwner, stepLabel, stepLabels, stepRequirements, stepsBrokenByRemoval } from './shipments.rules';

/** A Prisma client or interactive-transaction client. */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type Db = any;

export type TradeScope = 'CONTRACT' | 'SHIPMENT';
export type TradeOwner = { contractId: string; shipmentId?: undefined } | { shipmentId: string; contractId?: undefined };

export interface DocLinkRow {
  id: string;
  documentId: string;
  docType: string;
  stepId: string | null;
  contractId?: string | null;
  shipmentId?: string | null;
  createdAt: Date;
}

export const DOC_LINK_SELECT = { id: true, documentId: true, docType: true, stepId: true, contractId: true, shipmentId: true, createdAt: true };

/** A contract/shipment a file or document link is being removed from. */
export interface RemovalOwner {
  contractId?: string;
  shipmentId?: string;
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
    if (scope && scope !== 'CONTRACT' && scope !== 'SHIPMENT') {
      throw new BadRequestException('scope must be CONTRACT or SHIPMENT');
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
    const row = await db.tradeSetting.findUnique({ where: { organizationId }, select: { defaultConsignee: true, defaultNotifyParty: true, docDefaults: true, updatedAt: true } });
    return {
      defaultConsignee: row?.defaultConsignee ?? null,
      defaultNotifyParty: row?.defaultNotifyParty ?? null,
      /** Default texts for in-app documents (From block, bank, invoice conditions …). */
      docDefaults: (row?.docDefaults as Record<string, unknown> | null) ?? {},
      updatedAt: row?.updatedAt ?? null,
    };
  }

  async updateSettings(organizationId: string, dto: { defaultConsignee?: string | null; defaultNotifyParty?: string | null; docDefaults?: Record<string, unknown> }) {
    const data: Record<string, unknown> = {};
    for (const k of ['defaultConsignee', 'defaultNotifyParty'] as const) {
      const v = optText(dto[k]);
      if (v !== undefined) data[k] = v;
    }
    if (dto.docDefaults !== undefined) {
      const cur = await this.prisma.tradeSetting.findUnique({ where: { organizationId }, select: { docDefaults: true } });
      data.docDefaults = mergeDocDefaults((cur?.docDefaults as Record<string, unknown> | null) ?? {}, dto.docDefaults);
    }
    await this.prisma.tradeSetting.upsert({ where: { organizationId }, update: data as any, create: { organizationId, ...(data as any) } });
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
    const ownerWhere = owner.contractId ? { contractId: owner.contractId } : { shipmentId: owner.shipmentId };
    const [files, docLinks]: [Array<{ file: { docType: string } }>, Array<{ docType: string; documentId: string }>] = await Promise.all([
      db.tradeFileLink.findMany({
        where: { organizationId, ...ownerWhere, ...(exclude.fileId ? { NOT: { fileId: exclude.fileId } } : {}) },
        select: { file: { select: { docType: true } } },
      }),
      db.tradeDocumentLink.findMany({
        where: { organizationId, ...ownerWhere, ...(exclude.docLinkId ? { NOT: { id: exclude.docLinkId } } : {}) },
        select: { docType: true, documentId: true },
      }),
    ]);
    const live = await this.countableDocumentIds(
      db,
      organizationId,
      docLinks.map((l) => l.documentId),
    );
    return [...files.map((f) => f.file.docType), ...docLinks.filter((l) => live.has(l.documentId)).map((l) => l.docType)];
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
  ) {
    const docLinks = await this.describeDocLinks(db, organizationId, rec.docLinks);
    const fileTypes = rec.fileLinks.map((l) => l.file.docType);
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
  async syncSteps(db: Db, organizationId: string, owners: TradeOwner[], actor: TradeActor | null, changed: { docTypes?: string[]; fields?: string[] } = {}): Promise<string[]> {
    const done: string[] = [];
    const seen = new Set<string>();
    for (const owner of owners) {
      const key = owner.contractId ?? owner.shipmentId;
      if (!key || seen.has(key)) continue;
      seen.add(key);
      const record = owner.contractId
        ? await db.contract.findFirst({ where: { id: owner.contractId, organizationId } })
        : await db.shipment.findFirst({ where: { id: owner.shipmentId, organizationId } });
      if (!record || record.status !== 'OPEN') continue;
      const steps: Array<{ id: string; title: string; displayNo: string | null; status: string; isOngoing: boolean; sortOrder: number; requiredDocTypes: string[]; requiredFields: string[]; holdOpen: boolean }> =
        await db.tradeStep.findMany({
          where: { organizationId, ...(owner.contractId ? { contractId: owner.contractId } : { shipmentId: owner.shipmentId }) },
          orderBy: { sortOrder: 'asc' },
          select: { id: true, title: true, displayNo: true, status: true, isOngoing: true, sortOrder: true, requiredDocTypes: true, requiredFields: true, holdOpen: true },
        });
      if (!steps.length) continue;
      const plan = autoCompletePlan(steps, await this.presentDocTypes(db, organizationId, owner), record, changed);
      const stamp = { updatedById: actor?.id ?? null, updatedByName: actor?.name ?? 'Auto' };
      const now = new Date();
      for (const s of plan.release) if (!plan.complete.includes(s)) await db.tradeStep.update({ where: { id: s.id, organizationId }, data: { holdOpen: false } });
      for (const s of plan.complete) {
        await db.tradeStep.update({ where: { id: s.id, organizationId }, data: { status: 'DONE', completedAt: now, skipReason: null, holdOpen: false, ...stamp } });
      }
      if (plan.start) await db.tradeStep.update({ where: { id: plan.start.id, organizationId }, data: { status: 'IN_PROGRESS', ...stamp } });
      const labels = stepLabels(steps);
      done.push(...plan.complete.map((s) => labels.get(s.id) ?? stepLabel(s)));
    }
    return done;
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
      const owner: TradeOwner = o.contractId ? { contractId: o.contractId } : { shipmentId: o.shipmentId! };
      const doneSteps: Array<{ id: string; title: string; displayNo: string | null; status: string; isOngoing: boolean; requiredDocTypes: string[] }> = await db.tradeStep.findMany({
        where: { organizationId, ...owner, status: 'DONE' },
        orderBy: { sortOrder: 'asc' },
        select: { id: true, title: true, displayNo: true, status: true, isOngoing: true, requiredDocTypes: true },
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
    const step = await db.tradeStep.findFirst({ where: { organizationId, ...owner, code: stepCode }, select: { id: true } });
    await db.tradeFileLink.create({ data: { organizationId, fileId, contractId: owner.contractId ?? null, shipmentId: owner.shipmentId ?? null, stepId: step?.id ?? null } });
    await db.tradeExtraction.updateMany({ where: { organizationId, fileId }, data: owner.contractId ? { contractId: owner.contractId } : { shipmentId: owner.shipmentId } });
  }

  /** Copy the org's active templates of `scope` onto a new contract/shipment as TradeStep rows. */
  async snapshotSteps(db: Db, organizationId: string, scope: TradeScope, owner: TradeOwner) {
    if (!hasExactlyOneOwner(owner)) throw new BadRequestException('A step belongs to exactly one contract or shipment');
    const templates: Array<{ id: string; code: string; title: string; displayNo: string | null; sortOrder: number; requiredDocTypes: string[]; optionalDocTypes: string[]; requiredFields: string[]; isOngoing: boolean }> =
      await db.tradeStepTemplate.findMany({
        where: { organizationId, scope, isActive: true },
        orderBy: { sortOrder: 'asc' },
        select: { id: true, code: true, title: true, displayNo: true, sortOrder: true, requiredDocTypes: true, optionalDocTypes: true, requiredFields: true, isOngoing: true },
      });
    if (!templates.length) return 0;
    await db.tradeStep.createMany({
      data: templates.map((t) => ({
        organizationId,
        contractId: owner.contractId ?? null,
        shipmentId: owner.shipmentId ?? null,
        templateId: t.id,
        code: t.code,
        title: t.title,
        displayNo: t.displayNo,
        sortOrder: t.sortOrder,
        requiredDocTypes: t.requiredDocTypes,
        optionalDocTypes: t.optionalDocTypes ?? [],
        requiredFields: t.requiredFields ?? [],
        isOngoing: t.isOngoing,
      })),
    });
    return templates.length;
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
        throw new BadRequestException('banks must be a list (max 10) of { id, label, block }');
      out[k] = v.map((b) => ({ id: b.id.trim(), label: b.label.trim(), block: b.block }));
    } else if (k === 'deliveryProfiles') {
      if (!Array.isArray(v) || v.length > 50 || !v.every((p) => p && isText(p.id, 64) && isText(p.customerName, 200) && isText(p.siteName, 200) && isText(p.address, 500) && isText(p.notes ?? '')))
        throw new BadRequestException('deliveryProfiles must be a list (max 50) of { id, customerName, siteName, address, notes }');
      out[k] = v.map((p) => ({ id: p.id, customerName: p.customerName.trim(), siteName: p.siteName.trim(), address: p.address.trim(), notes: p.notes ?? '' }));
    } else if (k === 'sealImage') {
      const m = typeof v === 'string' ? /^data:image\/(png|jpeg);base64,([A-Za-z0-9+/=]+)$/.exec(v) : null;
      if (!m) throw new BadRequestException('The seal must be a PNG or JPEG image');
      if (Buffer.from(m[2], 'base64').length > SEAL_MAX_BYTES) throw new BadRequestException('The seal image must be 1 MB or smaller');
      out[k] = v;
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
