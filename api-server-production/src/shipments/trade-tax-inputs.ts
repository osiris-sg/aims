/**
 * Round BK — the import tax estimate's inputs as ADH's calculator takes them (輸入消費税計算ファイル):
 *   CIF   = the shipment's SG→JP INVOICE & PACKING LIST total (latest FINAL / ADH's own filed one; a draft only as a
 *           fallback, marked) — never Vedanta's CI;
 *   rate  = the customs weekly rate (税関 外国為替相場, 課税価格の換算) of the week of the estimated import clearance
 *           date (ETA by default), read from customs.go.jp's weekly PDF (robots.txt allows; read-only, cached).
 * Typed values on the shipment always win (never overwritten).
 */
import { Injectable, Logger, Optional } from '@nestjs/common';
import { PrismaService } from '../common/prisma.service';
import { S3Service } from '../common/services/s3.service';
import { pdfText } from './trade-coa';
import { sgjpTotals, SgjpItem } from './trade-logistics-docs';

export const CUSTOMS_FX_INDEX = 'https://www.customs.go.jp/tetsuzuki/kawase/index.htm';

// ── customs weekly rate ─────────────────────────────────────────────────────
/** The customs rate week (Sunday → Saturday) containing a date (YYYY-MM-DD). */
export function customsWeek(dateIso: string): { start: string; end: string } {
  const d = new Date(`${dateIso.slice(0, 10)}T00:00:00Z`);
  const start = new Date(d.getTime() - d.getUTCDay() * 86400000);
  const end = new Date(start.getTime() + 6 * 86400000);
  return { start: start.toISOString().slice(0, 10), end: end.toISOString().slice(0, 10) };
}
const ymd = (iso: string) => iso.replace(/-/g, '');
/** The week's published PDF (kawase<year>/kouji-rate<start>-<end>.pdf). */
export const customsRatePdfUrl = (w: { start: string; end: string }, year = w.start.slice(0, 4)) =>
  `https://www.customs.go.jp/tetsuzuki/kawase/kawase${year}/kouji-rate${ymd(w.start)}-${ymd(w.end)}.pdf`;
/** "304 アメリカ合衆国 ドル USD 158.26" → 158.26. */
export function parseCustomsUsd(text: string): number | null {
  const m = /\bUSD[\s,"]*(\d{2,3}\.\d{1,4})/.exec(text ?? '');
  return m ? Number(m[1]) : null;
}

export interface CustomsRate {
  rate: number;
  start: string;
  end: string;
  url: string;
  /** The clearance week isn't published yet: the latest published week is shown instead. */
  provisional: boolean;
}

// ── CIF from the SG→JP invoice ──────────────────────────────────────────────
export interface CifFromSgjp {
  amount: number;
  invoiceNo: string | null;
  invoiceDate: string | null;
  /** final = AIMS's FINAL draft; file = ADH's own invoice filed on the shipment; draft = an unfinished AIMS draft. */
  kind: 'final' | 'file' | 'draft';
  ref: string | null;
}

/** ADH's own SG→JP PDF: invoice no. (ADH + date), the total (largest US$ amount) and whether it is this shipment's quantity. */
export function sgjpFileFacts(text: string, netMt: number | null): { invoiceNo: string | null; invoiceDate: string | null; total: number | null; netMatches: boolean } {
  const no = /ADH(\d{4})(\d{2})(\d{2})/.exec(text ?? '');
  const amounts = [...(text ?? '').matchAll(/US\$\s*([\d,]+\.\d{2})/g)].map((m) => Number(m[1].replace(/,/g, '')));
  const total = amounts.length ? Math.max(...amounts) : null;
  const netMatches = netMt === null || new RegExp(`(^|[^\\d.])${netMt.toFixed(3).replace('.', '\\.')}(?!\\d)`).test(text ?? '');
  return { invoiceNo: no ? no[0] : null, invoiceDate: no ? `${no[1]}-${no[2]}-${no[3]}` : null, total, netMatches };
}

/** Pick the CIF: the latest FINAL / filed invoice (by invoice date, then newest); a draft only when there is none. */
export function pickCif(candidates: Array<CifFromSgjp & { at: string }>): CifFromSgjp | null {
  const by = (a: { invoiceDate: string | null; at: string }, b: { invoiceDate: string | null; at: string }) => (a.invoiceDate ?? '').localeCompare(b.invoiceDate ?? '') || a.at.localeCompare(b.at);
  const done = candidates.filter((c) => c.kind !== 'draft').sort(by);
  const pick = done.at(-1) ?? candidates.filter((c) => c.kind === 'draft').sort(by).at(-1) ?? null;
  if (!pick) return null;
  const { at: _at, ...rest } = pick;
  void _at;
  return rest;
}

@Injectable()
export class TradeTaxInputsService {
  private readonly logger = new Logger(TradeTaxInputsService.name);
  private readonly rates = new Map<string, { at: number; value: { rate: number; url: string } | null }>();
  private readonly files = new Map<string, string>();

  constructor(
    private readonly prisma: PrismaService,
    @Optional() private readonly s3?: S3Service,
    /** Tests pass a fake fetch. */
    @Optional() private readonly fetcher?: (url: string) => Promise<{ ok: boolean; buffer: () => Promise<Buffer> }>,
  ) {}

  private async get(url: string): Promise<Buffer | null> {
    const f =
      this.fetcher ??
      (async (u: string) => {
        const ctl = new AbortController();
        const timer = setTimeout(() => ctl.abort(), 6000);
        try {
          const r = await fetch(u, { signal: ctl.signal, headers: { 'User-Agent': 'AIMS (ai-ms.io) customs rate reader' } });
          return { ok: r.ok, buffer: async () => Buffer.from(await r.arrayBuffer()) };
        } finally {
          clearTimeout(timer);
        }
      });
    try {
      const r = await f(url);
      return r.ok ? await r.buffer() : null;
    } catch (e) {
      this.logger.warn(`customs rate fetch failed (${url}): ${(e as Error).message}`);
      return null;
    }
  }

  /** One week's USD rate (published weeks cached for good; a missing week re-checked after 6 h). */
  private async week(w: { start: string; end: string }): Promise<{ rate: number; url: string } | null> {
    const hit = this.rates.get(w.start);
    if (hit && (hit.value || Date.now() - hit.at < 6 * 3600_000)) return hit.value;
    let value: { rate: number; url: string } | null = null;
    for (const year of [...new Set([w.start.slice(0, 4), w.end.slice(0, 4)])]) {
      const url = customsRatePdfUrl(w, year);
      const buf = await this.get(url);
      const rate = buf ? parseCustomsUsd(await pdfText(buf).catch(() => '')) : null;
      if (rate) {
        value = { rate, url };
        break;
      }
    }
    this.rates.set(w.start, { at: Date.now(), value });
    return value;
  }

  /** The customs rate for a clearance date: its week, else (not published yet) the latest published of the 4 weeks before. */
  async usdRateFor(dateIso: string | null | undefined): Promise<CustomsRate | null> {
    if (!dateIso) return null;
    const w = customsWeek(dateIso);
    const own = await this.week(w);
    if (own) return { ...own, ...w, provisional: false };
    for (let k = 1; k <= 4; k++) {
      const prev = customsWeek(new Date(new Date(`${w.start}T00:00:00Z`).getTime() - k * 7 * 86400000).toISOString().slice(0, 10));
      if (prev.start > new Date().toISOString().slice(0, 10)) continue;
      const v = await this.week(prev);
      if (v) return { ...v, ...prev, provisional: true };
    }
    return null;
  }

  private async fileText(id: string, key: string): Promise<string> {
    if (this.files.has(id)) return this.files.get(id)!;
    if (!this.s3) return '';
    const t = await pdfText(await this.s3.downloadFile(key)).catch(() => '');
    if (this.files.size > 500) this.files.clear();
    this.files.set(id, t);
    return t;
  }

  /** The shipment's SG→JP invoice total for the CIF (see the file comment). */
  async cifFor(organizationId: string, shipmentId: string, netMt: number | null): Promise<CifFromSgjp | null> {
    const gens = await this.prisma.tradeGeneratedDoc.findMany({
      where: { organizationId, shipmentId, docType: 'SGJP_IV_PL' },
      select: { docRef: true, status: true, header: true, rows: true, updatedAt: true },
    });
    const out: Array<CifFromSgjp & { at: string }> = [];
    for (const g of gens) {
      const amount = sgjpTotals((Array.isArray(g.rows) ? g.rows : []) as unknown as SgjpItem[]).amount;
      if (!(amount > 0)) continue;
      const h = (g.header ?? {}) as { invoiceNo?: string; invoiceDate?: string };
      out.push({ amount, invoiceNo: h.invoiceNo ?? null, invoiceDate: h.invoiceDate ?? null, kind: g.status === 'FINAL' ? 'final' : 'draft', ref: g.docRef, at: g.updatedAt.toISOString() });
    }
    const files = await this.prisma.tradeFile.findMany({
      where: { organizationId, docType: 'SGJP_IV_PL', mimeType: 'application/pdf', links: { some: { shipmentId, hiddenAt: null } } },
      select: { id: true, fileName: true, s3Key: true, createdAt: true },
      orderBy: { createdAt: 'desc' },
      take: 4,
    });
    for (const f of files) {
      const facts = sgjpFileFacts(await this.fileText(f.id, f.s3Key), netMt);
      // A file filed on several shipments (one lot) counts only where its quantity is the shipment's net weight.
      if (facts.total && facts.netMatches) out.push({ amount: facts.total, invoiceNo: facts.invoiceNo, invoiceDate: facts.invoiceDate, kind: 'file', ref: f.fileName, at: f.createdAt.toISOString() });
    }
    return pickCif(out);
  }
}
