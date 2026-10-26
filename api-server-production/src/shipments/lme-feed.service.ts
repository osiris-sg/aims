import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { PrismaService } from '../common/prisma.service';
import { runAsOrg } from '../common/tenancy/tenant-context';
import { ActionLogService } from '../action-log/action-log.service';
import { orderLabel, shipmentRef } from './shipments.rules';
import {
  cleanLmeAuto,
  differsFromFinal,
  LME_DOC_LABEL,
  LME_METAL,
  LME_SOURCE,
  LmeAutoMark,
  LmeDay,
  LmeMonth,
  LmeParseError,
  LmeSyncPlan,
  monthlyAverages,
  parseWestmetallAverages,
  parseWestmetallDaily,
  planLmeSync,
  provisionalMonths,
  ReviseCandidate,
  reviseTask,
  WESTMETALL_AVERAGES_URL,
  westmetallDailyUrl,
} from './lme-feed';

/** Months before this are never auto-filled (ADH's trading in AIMS starts 2026). */
export const LME_FILL_FROM = '2026-01';
const UA = 'AIMS-LME-feed/1.0 (+https://ai-ms.io; once a day, LME aluminium cash-settlement)';
const TIMEOUT_MS = 20_000;
const PRICED_DOCS = ['INVOICE_1', 'INVOICE_2', 'INVOICE_SINGLE', 'SGJP_IV_PL'] as const;

export interface LmeOrgResult {
  organizationId: string;
  plan: LmeSyncPlan;
  revise: ReviseCandidate[];
  applied: boolean;
}
export interface LmeRunResult {
  ok: boolean;
  error?: string;
  apply: boolean;
  days: number;
  latest: string | null;
  months: LmeMonth[];
  publishedMismatch: Array<{ month: string; computed: number; published: number }>;
  newlyFinal: string[];
  quotesWritten: number;
  orgs: LmeOrgResult[];
}

/**
 * Round AK — LME aluminium cash-settlement from Westmetall, once a day after the LME close (07:00 JST, retry at
 * 09:00 when that failed). Stores daily quotes + monthly averages (shared market data), then for each org with the
 * SHIPMENTS module fills the empty months of its LME table and keeps the feed's own provisional month current; a
 * month typed by hand is never changed (a difference is reported). When a month becomes final, open CIs / invoices
 * priced at another LME for that month get a "revise" task on the order (bell / Tasks only — no WhatsApp push).
 * A page that no longer parses is logged as a failed run and writes nothing.
 */
@Injectable()
export class LmeFeedService {
  private readonly logger = new Logger(LmeFeedService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly actionLog: ActionLogService,
  ) {}

  @Cron('0 22 * * *') // 07:00 JST
  async daily() {
    if (!(await this.switchedOnOrgs()).length) return; // nobody switched on: no request at all
    await this.run('CRON', { apply: true }).catch((e) => this.logger.warn(`LME feed failed: ${(e as Error)?.message}`));
  }

  @Cron('0 0 * * *') // 09:00 JST: only when today's 07:00 run failed
  async retry() {
    const since = new Date(Date.now() - 3 * 3600_000);
    const last = await this.prisma.lmeFetchRun.findFirst({ where: { source: LME_SOURCE, createdAt: { gte: since } }, orderBy: { createdAt: 'desc' }, select: { ok: true } });
    if (last && !last.ok) await this.run('CRON', { apply: true }).catch((e) => this.logger.warn(`LME feed retry failed: ${(e as Error)?.message}`));
  }

  private async get(url: string): Promise<string> {
    const ctl = new AbortController();
    const t = setTimeout(() => ctl.abort(), TIMEOUT_MS);
    try {
      const r = await fetch(url, { headers: { 'User-Agent': UA, Accept: 'text/html' }, signal: ctl.signal });
      if (!r.ok) throw new Error(`HTTP ${r.status} from ${url}`);
      return await r.text();
    } finally {
      clearTimeout(t);
    }
  }

  /** Fetch + parse the source (current year; in January also last year, so December can become final). */
  async read(now = new Date()): Promise<{ days: LmeDay[]; published: Array<{ month: string; cash: number }> }> {
    const year = now.getUTCFullYear();
    const days = parseWestmetallDaily(await this.get(westmetallDailyUrl()));
    if (now.getUTCMonth() === 0 && !days.some((d) => d.date.startsWith(`${year - 1}-12`))) {
      await new Promise((r) => setTimeout(r, 2000)); // polite gap between requests
      days.unshift(...parseWestmetallDaily(await this.get(westmetallDailyUrl(year - 1))));
    }
    await new Promise((r) => setTimeout(r, 2000));
    let published: Array<{ month: string; cash: number }> = [];
    try {
      published = parseWestmetallAverages(await this.get(WESTMETALL_AVERAGES_URL), year);
    } catch (e) {
      this.logger.warn(`LME averages page: ${(e as Error)?.message}`); // a cross-check only
    }
    return { days, published };
  }

  /** One run. apply=false (dry run) reads and plans, writes nothing at all. */
  async run(trigger: 'CRON' | 'MANUAL' | 'SCRIPT', opts: { apply: boolean; onlyOrg?: string; now?: Date } = { apply: false }): Promise<LmeRunResult> {
    const now = opts.now ?? new Date();
    let fetched: { days: LmeDay[]; published: Array<{ month: string; cash: number }> };
    try {
      fetched = await this.read(now);
    } catch (e) {
      const error = `${e instanceof LmeParseError ? 'Page layout changed: ' : ''}${(e as Error)?.message ?? e}`.slice(0, 500);
      if (opts.apply && (trigger === 'SCRIPT' || (await this.switchedOnOrgs()).length)) {
        await this.prisma.lmeFetchRun.create({ data: { source: LME_SOURCE, trigger, ok: false, error } });
        this.actionLog.system('lme-feed', 'FETCH', 'LmeQuote', { status: 'FAILURE', details: { source: LME_SOURCE, error } });
      }
      return { ok: false, error, apply: opts.apply, days: 0, latest: null, months: [], publishedMismatch: [], newlyFinal: [], quotesWritten: 0, orgs: [] };
    }

    // Merge with what is stored (older years / months the page no longer lists).
    // A dry run before the tables exist (first deploy) reads nothing stored.
    const stored: any[] = await this.prisma.lmeQuote.findMany({ where: { metal: LME_METAL }, select: { date: true, cash: true, threeMonth: true, stock: true } }).catch((e: Error) => (opts.apply ? Promise.reject(e) : []));
    const byDate = new Map<string, LmeDay>(stored.map((q) => [q.date, { date: q.date, cash: Number(q.cash), threeMonth: q.threeMonth === null ? null : Number(q.threeMonth), stock: q.stock }]));
    const changed = fetched.days.filter((d) => {
      const s = byDate.get(d.date);
      return !s || s.cash !== d.cash || s.threeMonth !== d.threeMonth || s.stock !== d.stock;
    });
    for (const d of fetched.days) byDate.set(d.date, d);
    const all = [...byDate.values()].sort((a, b) => a.date.localeCompare(b.date));
    const months = monthlyAverages(all);
    const pub = new Map(fetched.published.map((p) => [p.month, p.cash]));
    const publishedMismatch = months.filter((m) => pub.has(m.month) && Math.abs(pub.get(m.month)! - m.avg) >= 0.005).map((m) => ({ month: m.month, computed: m.avg, published: pub.get(m.month)! }));
    // The org flag enableLmeFeed gates every write: with no org switched on, a run is a dry run (a script may still
    // store the market data with an explicit --apply).
    const switchedOn = new Set(await this.switchedOnOrgs());
    const apply = opts.apply && (trigger === 'SCRIPT' || switchedOn.size > 0);
    const prevMonthly: any[] = await this.prisma.lmeMonthly.findMany({ where: { metal: LME_METAL }, select: { month: true, final: true } }).catch((e: Error) => (opts.apply ? Promise.reject(e) : []));
    const wasFinal = new Set(prevMonthly.filter((m) => m.final).map((m) => m.month));
    const newlyFinal = months.filter((m) => m.final && !wasFinal.has(m.month) && m.month >= LME_FILL_FROM).map((m) => m.month);

    if (apply) {
      for (const d of changed) {
        await this.prisma.lmeQuote.upsert({
          where: { metal_date: { metal: LME_METAL, date: d.date } },
          create: { metal: LME_METAL, date: d.date, cash: d.cash, threeMonth: d.threeMonth, stock: d.stock, source: LME_SOURCE },
          update: { cash: d.cash, threeMonth: d.threeMonth, stock: d.stock, source: LME_SOURCE, fetchedAt: now },
        });
      }
      for (const m of months) {
        const data = { cashAvg: m.avg, days: m.days, final: m.final, publishedAvg: pub.get(m.month) ?? null, source: LME_SOURCE, ...(newlyFinal.includes(m.month) ? { finalizedAt: now } : {}) };
        await this.prisma.lmeMonthly.upsert({ where: { metal_month: { metal: LME_METAL, month: m.month } }, create: { metal: LME_METAL, month: m.month, ...data }, update: data });
      }
    }

    // Only orgs with the SHIPMENTS module (ADH today) — every other org is left alone.
    const orgIds = await this.shipmentsOrgs(opts.onlyOrg);
    const orgs: LmeOrgResult[] = [];
    for (const organizationId of orgIds) {
      try {
        orgs.push(await runAsOrg(organizationId, () => this.syncOrg(organizationId, months, newlyFinal, apply && switchedOn.has(organizationId), now)));
      } catch (e) {
        this.logger.warn(`LME sync failed for ${organizationId}: ${(e as Error)?.message}`);
      }
    }
    const result: LmeRunResult = { ok: true, apply, days: fetched.days.length, latest: all[all.length - 1]?.date ?? null, months, publishedMismatch, newlyFinal, quotesWritten: apply ? changed.length : 0, orgs };
    if (apply) {
      const summary = { latest: result.latest, quotesWritten: changed.length, newlyFinal, publishedMismatch, orgs: orgs.map((o) => ({ org: o.organizationId, writes: o.plan.writes.length, conflicts: o.plan.conflicts.length, revise: o.revise.length })) };
      await this.prisma.lmeFetchRun.create({ data: { source: LME_SOURCE, trigger, ok: true, rows: fetched.days.length, summary } });
      this.actionLog.system('lme-feed', 'FETCH', 'LmeQuote', { details: summary });
    }
    return result;
  }

  /** SHIPMENTS orgs with the flag enableLmeFeed on. */
  async switchedOnOrgs(): Promise<string[]> {
    const ids = await this.shipmentsOrgs();
    if (!ids.length) return [];
    const rows: Array<{ organizationId: string; features: unknown }> = await this.prisma.organizationUIConfig.findMany({ where: { organizationId: { in: ids } }, select: { organizationId: true, features: true } });
    return rows.filter((r) => !!(r.features as Record<string, unknown> | null)?.enableLmeFeed).map((r) => r.organizationId);
  }

  private async shipmentsOrgs(only?: string): Promise<string[]> {
    const rows: Array<{ organizationId: string }> = await this.prisma.organizationModule.findMany({ where: { moduleCode: 'SHIPMENTS', enabled: true, ...(only ? { organizationId: only } : {}) }, select: { organizationId: true } });
    return [...new Set(rows.map((r) => r.organizationId))];
  }

  /** One org: plan (and apply) the table fill, then the revise tasks for months that just became final. */
  private async syncOrg(organizationId: string, months: LmeMonth[], newlyFinal: string[], apply: boolean, now: Date): Promise<LmeOrgResult> {
    const row = await this.prisma.tradeSetting.findUnique({ where: { organizationId }, select: { docDefaults: true } });
    const dd = (row?.docDefaults as Record<string, unknown> | null) ?? {};
    const table = { ...((dd.lmeByMonth as Record<string, number> | undefined) ?? {}) };
    const auto = cleanLmeAuto(dd.lmeAuto);
    const plan = planLmeSync(table, auto, months, LME_FILL_FROM);
    // Months this org now holds at their final value for the first time → check what was priced on them.
    const finalNow = new Map(months.filter((m) => m.final).map((m) => [m.month, m.avg]));
    const toCheck = new Set<string>([...newlyFinal, ...plan.writes.filter((w) => w.reason === 'finalized').map((w) => w.month)]);
    const revise: ReviseCandidate[] = [];
    for (const m of toCheck) {
      const f = finalNow.get(m);
      if (f !== undefined) revise.push(...(await this.reviseCandidates(organizationId, m, f)));
    }
    const fresh = await this.newOnly(organizationId, revise);
    if (apply && row && plan.writes.length) {
      const at = now.toISOString();
      await this.prisma.$transaction(async (tx: any) => {
        // Re-read inside the transaction: a person may have saved the table meanwhile — re-plan on what is there.
        const cur = await tx.tradeSetting.findUnique({ where: { organizationId }, select: { docDefaults: true } });
        const d2 = (cur?.docDefaults as Record<string, unknown> | null) ?? {};
        const t2 = { ...((d2.lmeByMonth as Record<string, number> | undefined) ?? {}) };
        const a2: Record<string, LmeAutoMark> = cleanLmeAuto(d2.lmeAuto);
        const p2 = planLmeSync(t2, a2, months, LME_FILL_FROM);
        for (const w of p2.writes) {
          t2[w.month] = w.to;
          a2[w.month] = { value: w.to, final: w.final, days: w.days, at };
        }
        await tx.tradeSetting.update({ where: { organizationId }, data: { docDefaults: { ...d2, lmeByMonth: t2, lmeAuto: a2 } } });
        plan.writes = p2.writes;
      });
      this.actionLog.system('lme-feed', 'UPDATE', 'TradeSetting', {
        organizationId,
        details: { note: 'LME table: empty months filled / the feed’s own provisional month updated (Westmetall); typed months untouched', writes: plan.writes, conflicts: plan.conflicts },
      });
    }
    if (apply && fresh.length) {
      for (const c of fresh) {
        const t = reviseTask(c);
        await this.prisma.tradeAlert.create({
          data: { organizationId, kind: 'LME_REVISE', key: t.key, dueAt: now, title: t.title, detail: t.detail, orderId: c.orderId, shipmentId: c.shipmentId, linkUrl: c.orderId ? `/portal/shipments/orders/${c.orderId}${c.shipmentId ? `?shipment=${c.shipmentId}` : ''}` : null, status: 'DUE' },
        });
      }
      this.actionLog.system('lme-feed', 'CREATE', 'TradeAlert', { organizationId, details: { note: 'LME month final: revise tasks', tasks: fresh.map((c) => reviseTask(c).title) } });
    }
    return { organizationId, plan, revise: fresh, applied: apply };
  }

  /** Candidates whose task doesn't exist yet (a done / dismissed one is never re-created). */
  private async newOnly(organizationId: string, list: ReviseCandidate[]): Promise<ReviseCandidate[]> {
    if (!list.length) return [];
    const keys = list.map((c) => reviseTask(c).key);
    const have: Array<{ key: string }> = await this.prisma.tradeAlert.findMany({ where: { organizationId, key: { in: keys } }, select: { key: true } });
    const seen = new Set(have.map((h) => h.key));
    return list.filter((c) => !seen.has(reviseTask(c).key));
  }

  /**
   * Open CIs / in-app invoices priced at another LME than month `m`'s final average: in-app invoices whose header
   * LME month is `m` (any row LME differs), and Vedanta CIs (as read on upload) of open shipments whose order ships
   * in `m`. Test / cancelled / completed records are skipped.
   */
  async reviseCandidates(organizationId: string, m: string, final: number): Promise<ReviseCandidate[]> {
    const out: ReviseCandidate[] = [];
    const docs: any[] = await this.prisma.tradeGeneratedDoc.findMany({
      where: { organizationId, docType: { in: [...PRICED_DOCS] }, header: { path: ['lmeMonth'], equals: m } },
      select: {
        id: true,
        docType: true,
        number: true,
        status: true,
        rows: true,
        orderId: true,
        shipmentId: true,
        order: { select: { orderNo: true, status: true, isTest: true } },
        shipment: { select: { seqNo: true, status: true, orderId: true, order: { select: { orderNo: true, status: true, isTest: true } } } },
      },
    });
    for (const g of docs) {
      const order = g.order ?? g.shipment?.order;
      const open = g.shipment ? g.shipment.status === 'OPEN' : g.order?.status === 'OPEN';
      if (!open || !order || order.isTest) continue;
      const used = (Array.isArray(g.rows) ? g.rows : []).map((r: any) => r?.lme).find((v: unknown) => differsFromFinal(v, final));
      if (used === undefined) continue;
      out.push({
        key: `DOC:${g.id}:${m}`,
        month: m,
        used,
        final,
        kind: g.docType,
        ref: g.shipment ? shipmentRef(order.orderNo, g.shipment.seqNo) : orderLabel(order),
        docLabel: `${LME_DOC_LABEL[g.docType as ReviseCandidate['kind']] ?? g.docType}${g.number ? ` ${g.number}` : ''}${g.status === 'DRAFT' ? ' (draft)' : ''}`,
        orderId: g.orderId ?? g.shipment?.orderId ?? null,
        shipmentId: g.shipmentId ?? null,
      });
    }
    const ships: any[] = await this.prisma.shipment.findMany({
      where: { organizationId, status: 'OPEN', order: { shipMonth: m, isTest: false } },
      select: { id: true, seqNo: true, ciNumber: true, orderId: true, order: { select: { orderNo: true } }, fileLinks: { where: { hiddenAt: null, file: { docType: 'CI' } }, select: { fileId: true } } },
    });
    for (const s of ships) {
      const fileIds = s.fileLinks.map((l: any) => l.fileId);
      if (!fileIds.length) continue;
      const ex = await this.prisma.tradeExtraction.findFirst({ where: { organizationId, fileId: { in: fileIds }, kind: 'CI', status: 'DONE' }, orderBy: { createdAt: 'desc' }, select: { fileId: true, result: true } });
      const raw = ((ex?.result as any)?.raw ?? null) as Record<string, unknown> | null;
      const used = raw?.lme;
      if (!ex || !differsFromFinal(used, final)) continue;
      out.push({ key: `CI:${ex.fileId}:${m}`, month: m, used: used as number, final, kind: 'CI', ref: shipmentRef(s.order?.orderNo, s.seqNo), docLabel: `Vedanta CI${s.ciNumber ? ` ${s.ciNumber}` : ''}`, orderId: s.orderId, shipmentId: s.id });
    }
    return out;
  }

  /** Settings → LME panel: source, last runs, this month's daily values, monthly averages vs the org's table. */
  async status(organizationId: string, month?: string) {
    const [runs, monthly, row] = await Promise.all([
      this.prisma.lmeFetchRun.findMany({ where: { source: LME_SOURCE }, orderBy: { createdAt: 'desc' }, take: 5, select: { createdAt: true, ok: true, rows: true, error: true, trigger: true } }),
      this.prisma.lmeMonthly.findMany({ where: { metal: LME_METAL, month: { gte: LME_FILL_FROM } }, orderBy: { month: 'desc' }, select: { month: true, cashAvg: true, days: true, final: true, publishedAvg: true, finalizedAt: true } }),
      this.prisma.tradeSetting.findUnique({ where: { organizationId }, select: { docDefaults: true } }),
    ]);
    const dd = (row?.docDefaults as Record<string, unknown> | null) ?? {};
    const table = (dd.lmeByMonth as Record<string, number> | undefined) ?? {};
    const auto = cleanLmeAuto(dd.lmeAuto);
    const latestMonth = month && /^\d{4}-\d{2}$/.test(month) ? month : (monthly[0]?.month ?? new Date().toISOString().slice(0, 7));
    const days: any[] = await this.prisma.lmeQuote.findMany({ where: { metal: LME_METAL, date: { startsWith: latestMonth } }, orderBy: { date: 'asc' }, select: { date: true, cash: true, threeMonth: true, stock: true } });
    const months = monthly.map((m: any) => {
      const avg = Number(m.cashAvg);
      const t = table[m.month];
      const mark = auto[m.month];
      const ours = !!mark && typeof t === 'number' && Math.abs(t - mark.value) < 0.005;
      const state = typeof t !== 'number' ? 'missing' : ours ? 'westmetall' : Math.abs(t - avg) < 0.005 ? 'typed-agrees' : 'typed-differs';
      return { month: m.month, westmetall: avg, days: m.days, final: m.final, publishedAvg: m.publishedAvg === null ? null : Number(m.publishedAvg), table: typeof t === 'number' ? t : null, state };
    });
    return {
      source: { name: 'Westmetall — LME Aluminium Cash-Settlement', url: westmetallDailyUrl(), averagesUrl: WESTMETALL_AVERAGES_URL, schedule: 'Daily 07:00 JST (retry 09:00)' },
      lastRun: runs[0] ?? null,
      runs,
      month: latestMonth,
      days: days.map((d) => ({ date: d.date, cash: Number(d.cash), threeMonth: d.threeMonth === null ? null : Number(d.threeMonth), stock: d.stock })),
      months,
      provisional: provisionalMonths(table, auto),
    };
  }
}
