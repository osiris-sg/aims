/**
 * Round AR — Vedanta cast / bundle numbers as a matching key. A cast is "265C1186" (3 digits, a letter, 4 digits); a
 * bundle (Vedanta's "Batch No.") is the cast + a 2-digit bundle no. ("265C118614"). Each PL / COA file on a shipment is
 * read once per server process (an in-memory cache by file id — files never change; nothing is written) so an email's attachment ("COA 265C1186 SUS 26th Oct.pdf") can be matched to its shipment by
 * EXACT cast / bundle no. — never by a prefix or a near miss. Ambiguous (the key is on several shipments) = no default.
 */
import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../common/prisma.service';
import { S3Service } from '../common/services/s3.service';
import { pdfText } from './trade-coa';
import { parseSheetFile } from './trade-sheet.parser';

/** The file types that list a shipment's bundles / casts (Vedanta's PL and COA, the spreadsheet and the PDF). */
export const CAST_SOURCE_DOC_TYPES = ['PL_XLS', 'PL', 'COA_XLS', 'COA', 'CONTAINER_PL', 'BUNDLE_LIST'];

const TOKEN = /(?<![0-9A-Z])(\d{3}[A-Z]\d{4})(\d{2})?(?![0-9A-Z])/gi;

/** Cast and bundle numbers written as whole words in a text (a PDF's broken spacing "265C1 186 14" is NOT read). */
export function castKeysOf(text: string): { batches: string[]; casts: string[] } {
  const batches = new Set<string>();
  const casts = new Set<string>();
  for (const m of String(text ?? '').matchAll(TOKEN)) {
    const cast = m[1].toUpperCase();
    casts.add(cast);
    if (m[2]) batches.add(`${cast}${m[2]}`);
  }
  return { batches: [...batches].sort(), casts: [...casts].sort() };
}

export interface CastHolder {
  shipmentId: string;
  orderId: string | null;
  batches: Set<string>;
  casts: Set<string>;
}

export interface AttachmentCastMatch {
  /** The keys this attachment names (its file name + text). */
  keys: string[];
  /** The bundle numbers used (the attachment's own, or the email's bundle of a cast the attachment names). */
  bundles: string[];
  /** Every shipment holding one of the keys exactly. */
  holders: Array<{ shipmentId: string; orderId: string | null; why: string }>;
  /** The one shipment all the keys point to — null when none or several. */
  best: { shipmentId: string; orderId: string | null; why: string } | null;
}

/**
 * Pure. Which shipment an attachment belongs to by its cast / bundle numbers. Bundles decide first (a bundle is on
 * exactly one B/L); a cast alone only when it is on exactly one shipment. `emailText` (the email's own text) lends a
 * bundle number when the attachment names only its cast ("COA 265C1186" + "bundle 265C118614" in the email).
 */
export function matchAttachmentByCast(att: { name: string; text?: string | null }, emailText: string, holders: CastHolder[]): AttachmentCastMatch {
  const own = castKeysOf(`${att.name}\n${att.text ?? ''}`);
  const fromEmail = castKeysOf(emailText);
  const bundles = new Set(own.batches);
  for (const b of fromEmail.batches) if (own.casts.includes(b.slice(0, 8))) bundles.add(b);
  const keys = [...new Set([...own.batches, ...own.casts])];
  const byBundle = new Map<string, { shipmentId: string; orderId: string | null; why: string }>();
  for (const b of bundles) for (const h of holders) if (h.batches.has(b)) byBundle.set(h.shipmentId, { shipmentId: h.shipmentId, orderId: h.orderId, why: `bundle ${b} on its packing list / COA` });
  const byCast = new Map<string, { shipmentId: string; orderId: string | null; why: string }>();
  for (const c of own.casts) for (const h of holders) if (h.casts.has(c)) byCast.set(h.shipmentId, byCast.get(h.shipmentId) ?? { shipmentId: h.shipmentId, orderId: h.orderId, why: `cast ${c} on its packing list / COA` });
  const all = new Map([...byCast, ...byBundle]);
  const best = byBundle.size === 1 ? [...byBundle.values()][0] : byBundle.size === 0 && byCast.size === 1 ? [...byCast.values()][0] : null;
  return { keys, bundles: [...bundles].sort(), holders: [...all.values()], best };
}

@Injectable()
export class TradeCastIndexService {
  private readonly logger = new Logger(TradeCastIndexService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly s3: S3Service,
  ) {}

  /** Files never change: their keys are cached by file id for the life of the process (nothing is written). */
  private readonly cache = new Map<string, { batches: string[]; casts: string[] }>();

  /** The keys of one file (read once per process). */
  private async keysOf(f: { id: string; fileName: string; s3Key: string }): Promise<{ batches: string[]; casts: string[] }> {
    const have = this.cache.get(f.id);
    if (have) return have;
    let keys: { batches: string[]; casts: string[] };
    try {
      const buf = await this.s3.downloadFile(f.s3Key);
      const text = /\.pdf$/i.test(f.fileName) ? await pdfText(buf) : (() => {
        const sh = parseSheetFile(buf);
        return [sh.headers, ...sh.rows].map((r) => r.join(' ')).join('\n');
      })();
      keys = castKeysOf(`${f.fileName}\n${text}`);
    } catch (e) {
      this.logger.warn(`[cast-index] ${f.id}: ${(e as Error)?.message}`);
      keys = castKeysOf(f.fileName);
    }
    this.cache.set(f.id, keys);
    return keys;
  }

  /** Every shipment's cast / bundle numbers (from its PL / COA files; cancelled shipments left out). */
  async holders(organizationId: string): Promise<CastHolder[]> {
    const links: Array<{ shipmentId: string | null; file: { id: string; fileName: string; s3Key: string }; shipment: { orderId: string | null; status: string } | null }> = await this.prisma.tradeFileLink.findMany({
      where: { organizationId, hiddenAt: null, shipmentId: { not: null }, file: { docType: { in: CAST_SOURCE_DOC_TYPES } } },
      select: { shipmentId: true, file: { select: { id: true, fileName: true, s3Key: true } }, shipment: { select: { orderId: true, status: true } } },
    });
    const live = links.filter((l) => l.shipmentId && l.shipment && l.shipment.status !== 'CANCELLED');
    const byFile = new Map<string, { batches: string[]; casts: string[] }>();
    const files = [...new Map(live.map((l) => [l.file.id, l.file])).values()];
    // Four at a time: the first build reads every PL / COA once; later calls read only new files.
    for (let i = 0; i < files.length; i += 4) {
      const chunk = files.slice(i, i + 4);
      const got = await Promise.all(chunk.map((f) => this.keysOf(f).catch((e) => {
        this.logger.warn(`[cast-index] ${f.id}: ${(e as Error)?.message}`);
        return { batches: [], casts: [] };
      })));
      chunk.forEach((f, j) => byFile.set(f.id, got[j]));
    }
    const out = new Map<string, CastHolder>();
    for (const l of live) {
      const h = out.get(l.shipmentId!) ?? { shipmentId: l.shipmentId!, orderId: l.shipment!.orderId, batches: new Set<string>(), casts: new Set<string>() };
      const k = byFile.get(l.file.id);
      for (const b of k?.batches ?? []) h.batches.add(b);
      for (const c of k?.casts ?? []) h.casts.add(c);
      out.set(l.shipmentId!, h);
    }
    return [...out.values()];
  }

  /** Shipments whose PL / COA carries this cast or bundle no. exactly (the Answer flow's search). */
  async search(organizationId: string, q: string): Promise<Array<{ shipmentId: string; orderId: string | null; key: string }>> {
    const key = String(q ?? '').trim().toUpperCase();
    if (!/^\d{3}[A-Z]\d{4}(\d{2})?$/.test(key)) return [];
    const hs = await this.holders(organizationId);
    return hs.filter((h) => (key.length === 10 ? h.batches.has(key) : h.casts.has(key))).map((h) => ({ shipmentId: h.shipmentId, orderId: h.orderId, key }));
  }
}
