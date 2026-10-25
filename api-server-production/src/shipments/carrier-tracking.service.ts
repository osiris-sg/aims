import { BadRequestException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../common/prisma.service';
import { DocumentExtractionService } from '../document-extraction/document-extraction.service';
import { ActionLogService } from '../action-log/action-log.service';
import { ShipmentsService } from './shipments.service';
import { TradeActor } from './shipments.request';
import { shipmentRef } from './shipments.rules';
import {
  blMatches,
  carrierOf,
  checkAgainstText,
  DiffField,
  DiffRow,
  emailAutoFields,
  normalizeTracking,
  TRACKING_SCHEMA,
  TRACKING_SYSTEM_PROMPT,
  TRACKING_USER_PROMPT,
  TrackedShipment,
  trackingDiff,
  TrackingSnapshot,
  TrackingSource,
  updateFor,
} from './carrier-tracking';

const SHIP_SELECT = {
  id: true,
  seqNo: true,
  status: true,
  orderId: true,
  blNumber: true,
  shippingLine: true,
  vessel: true,
  voyageNo: true,
  arrivingVessel: true,
  arrivingVoyageNo: true,
  tsPort: true,
  tsEta: true,
  tsEtd: true,
  etd: true,
  eta: true,
  etaHistory: true,
  portOfLoading: true,
  portOfDischarge: true,
  blReleaseType: true,
  containerCount: true,
  totalBundles: true,
  grossWeightMt: true,
  order: { select: { orderNo: true, isTest: true } },
} as const;

const APPLIABLE: ReadonlySet<string> = new Set<DiffField>(['vessel', 'voyageNo', 'arrivingVessel', 'arrivingVoyageNo', 'tsPort', 'tsEta', 'tsEtd', 'etd', 'eta', 'portOfLoading', 'portOfDischarge', 'blReleaseType', 'containerCount']);
const ETA_SOURCE: Record<TrackingSource, string> = { SCREENSHOT: 'tracking screenshot', PASTE: 'tracking (pasted)', EMAIL: 'carrier email', PROVIDER: 'tracking API' };

export interface TrackingRead {
  id: string;
  shipmentId: string;
  ref: string;
  source: TrackingSource;
  snapshot: TrackingSnapshot;
  rows: DiffRow[];
  bl: 'match' | 'mismatch' | 'unknown';
}

/**
 * Round AL — carrier tracking without scraping: a person sends a screenshot or pastes the tracking page (portal or
 * WhatsApp), or a carrier notification email arrives. The page is read, compared with the shipment field by field
 * ("AIMS → tracking") and stored as a ShipmentTracking snapshot; a person confirms the fields to apply. A carrier
 * email may move the latest ETA (unless typed by hand) and fill empty fields by itself — everything else waits.
 * Every ETA change goes through ShipmentsService.update, so the ETA history, reminders and free-time logic follow.
 */
@Injectable()
export class CarrierTrackingService {
  private readonly logger = new Logger(CarrierTrackingService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly extractor: DocumentExtractionService,
    private readonly shipments: ShipmentsService,
    private readonly actionLog: ActionLogService,
  ) {}

  /** The reader (tests replace it). */
  reader = async (input: { text?: string; image?: { buffer: Buffer; mimetype: string } }) =>
    input.image
      ? this.extractor.extractStructured(input.image, TRACKING_SYSTEM_PROMPT, TRACKING_USER_PROMPT, { maxTokens: 2000 })
      : this.extractor.extractStructuredFromText(input.text ?? '', TRACKING_SYSTEM_PROMPT, TRACKING_USER_PROMPT, { maxTokens: 2000 });

  private shipment(organizationId: string, id: string) {
    return this.prisma.shipment.findFirst({ where: { id, organizationId }, select: SHIP_SELECT });
  }

  /** An open (non-test) shipment by B/L — for WhatsApp / email, where no shipment was picked. */
  async shipmentByBl(organizationId: string, bl: string | null): Promise<any | null> {
    if (!bl) return null;
    const core = bl.replace(/\s+/g, '').toUpperCase();
    const hits: any[] = await this.prisma.shipment.findMany({ where: { organizationId, status: 'OPEN', blNumber: { not: null }, order: { isTest: false } }, select: SHIP_SELECT });
    const m = hits.filter((s) => blMatches({ blNumber: core } as TrackingSnapshot, s.blNumber) === 'match');
    return m.length === 1 ? m[0] : null;
  }

  /**
   * Read a screenshot / pasted text / email body. shipmentId optional (then the B/L read picks the open shipment).
   * Throws when it isn't tracking information, or names another shipment's B/L.
   */
  async read(
    organizationId: string,
    input: { shipmentId?: string | null; text?: string | null; image?: { buffer: Buffer; mimetype: string } | null; source: TrackingSource; emailLogId?: string | null },
    actor: TradeActor | null,
  ): Promise<TrackingRead> {
    const text = (input.text ?? '').trim();
    if (!input.image && text.length < 20) throw new BadRequestException('Paste the tracking page text or attach a screenshot');
    if (input.image && !/^image\/(png|jpe?g|webp|gif)$/i.test(input.image.mimetype)) throw new BadRequestException('The screenshot must be a PNG, JPEG, WebP or GIF image');
    let sh: any = input.shipmentId ? await this.shipment(organizationId, input.shipmentId) : null;
    if (input.shipmentId && !sh) throw new NotFoundException('Shipment not found');
    const out = await this.reader(input.image ? { image: input.image } : { text });
    const raw = TRACKING_SCHEMA.parse(out.data ?? {});
    let snap = normalizeTracking(raw);
    if (!input.image) snap = checkAgainstText(snap, text);
    if (raw.isTrackingPage === false || (!snap.legs.length && !snap.eta && !snap.etd)) throw new BadRequestException("This doesn't look like carrier tracking information (no vessel, ETD or ETA found).");
    if (!sh) sh = await this.shipmentByBl(organizationId, snap.blNumber);
    if (!sh) throw new BadRequestException(snap.blNumber ? `No open shipment has B/L ${snap.blNumber}. Open the shipment and use Paste tracking there.` : 'No B/L on the page — open the shipment and use Paste tracking there.');
    const bl = blMatches(snap, sh.blNumber);
    if (bl === 'mismatch') throw new BadRequestException(`This tracking is for B/L ${snap.blNumber}, not ${sh.blNumber} (${shipmentRef(sh.order?.orderNo, sh.seqNo)}).`);
    const rows = trackingDiff(sh as TrackedShipment, snap);
    const row = await this.prisma.shipmentTracking.create({
      data: {
        organizationId,
        shipmentId: sh.id,
        source: input.source,
        carrier: snap.carrier ?? carrierOf(sh.blNumber, sh.shippingLine),
        blNumber: snap.blNumber ?? sh.blNumber,
        data: snap as any,
        raw: { model: out.model, tokens: [out.inputTokens, out.outputTokens], read: raw } as any,
        diff: rows as any,
        emailLogId: input.emailLogId ?? null,
        createdById: actor?.id ?? null,
      },
      select: { id: true },
    });
    return { id: row.id, shipmentId: sh.id, ref: shipmentRef(sh.order?.orderNo, sh.seqNo), source: input.source, snapshot: snap, rows, bl };
  }

  /**
   * Apply the chosen fields of a read. The comparison is re-done against the shipment as it is NOW (it may have
   * changed since the read); only fields that still differ are written; weights / bundles never.
   */
  async apply(organizationId: string, trackingId: string, fields: string[], actor: TradeActor | null, opts: { auto?: boolean } = {}) {
    const t: any = await this.prisma.shipmentTracking.findFirst({ where: { id: trackingId, organizationId } });
    if (!t) throw new NotFoundException('Tracking read not found');
    if (t.appliedAt) throw new BadRequestException('This tracking read was already applied — read the page again for a newer one');
    const sh: any = await this.shipment(organizationId, t.shipmentId);
    if (!sh) throw new NotFoundException('Shipment not found');
    if (sh.status !== 'OPEN') throw new BadRequestException(`${shipmentRef(sh.order?.orderNo, sh.seqNo)} is ${String(sh.status).toLowerCase()} — reopen it first`);
    const snap = t.data as TrackingSnapshot;
    const now = trackingDiff(sh as TrackedShipment, snap);
    const differs = new Set(now.filter((r) => r.status === 'new' || r.status === 'changed').map((r) => r.field));
    const chosen = [...new Set(fields)].filter((f): f is DiffField => APPLIABLE.has(f) && differs.has(f as DiffField));
    const values = updateFor(chosen, snap);
    if (Object.keys(values).length) {
      await this.shipments.update(organizationId, sh.id, { ...values, ...(values.eta ? { etaSource: ETA_SOURCE[t.source as TrackingSource] ?? 'tracking' } : {}) } as any, actor);
    }
    const applied = { fields: Object.keys(values), values, ...(opts.auto ? { auto: true } : {}) };
    await this.prisma.shipmentTracking.update({ where: { id: t.id }, data: { applied: applied as any, appliedById: actor?.id ?? null, appliedByName: actor?.name ?? null, appliedAt: new Date() } });
    return { ref: shipmentRef(sh.order?.orderNo, sh.seqNo), shipmentId: sh.id, orderId: sh.orderId, ...applied };
  }

  /**
   * A carrier notification email (rule CARRIER_TRACKING): read the body, link to the open shipment by B/L, move the
   * latest ETA unless a person typed it, fill empty fields; the rest stays offered on the shipment. Never throws.
   */
  async fromEmail(organizationId: string, logId: string, body: string, blNo: string | null) {
    try {
      // A re-run of the triage on the same email reads nothing twice.
      const seen = await this.prisma.shipmentTracking.findFirst({ where: { organizationId, emailLogId: logId }, select: { id: true } });
      if (seen) return { ok: false as const, reason: 'already read', trackingId: seen.id };
      const sh = await this.shipmentByBl(organizationId, blNo);
      if (!sh) return { ok: false as const, reason: blNo ? `no open shipment with B/L ${blNo}` : 'no B/L in the email' };
      const r = await this.read(organizationId, { shipmentId: sh.id, text: body, source: 'EMAIL', emailLogId: logId }, null);
      const auto = emailAutoFields(r.rows);
      const offered = r.rows.filter((x) => (x.status === 'changed' || x.status === 'new') && !auto.includes(x.field as DiffField)).map((x) => x.field);
      const done = auto.length ? await this.apply(organizationId, r.id, auto, { id: 'system:carrier-email', name: 'Carrier email' }, { auto: true }) : null;
      this.actionLog.system('carrier-tracking-email', 'UPDATE', 'Shipment', { organizationId, resourceId: sh.id, details: { emailLogId: logId, trackingId: r.id, ref: r.ref, applied: done?.values ?? {}, offered, dropped: r.snapshot.dropped } });
      return { ok: true as const, ref: r.ref, trackingId: r.id, applied: done?.fields ?? [], offered };
    } catch (e) {
      this.logger.warn(`carrier email ${logId}: ${(e as Error)?.message}`);
      return { ok: false as const, reason: (e as Error)?.message ?? 'read failed' };
    }
  }

  /** The shipment's tracking reads, newest first (history panel). */
  list(organizationId: string, shipmentId: string) {
    return this.prisma.shipmentTracking.findMany({
      where: { organizationId, shipmentId },
      orderBy: { createdAt: 'desc' },
      take: 20,
      select: { id: true, source: true, carrier: true, blNumber: true, data: true, diff: true, applied: true, appliedByName: true, appliedAt: true, emailLogId: true, createdAt: true },
    });
  }
}
