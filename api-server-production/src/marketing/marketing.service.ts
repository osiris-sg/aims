import { BadRequestException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { PrismaService } from '../common/prisma.service';
import { ActionLogService } from '../action-log/action-log.service';
import { resolveTier } from '../common/role-tier';

// CRM → Marketing (guru 2026-09-21, for CIEL's Junrong): Meta ads insights —
// spend / CPC / CPL / video watch metrics per campaign & ad, trended daily,
// joined with AIMS leads + signed contracts for TRUE cost-per-lead and ROAS
// (which Meta itself can never compute for offline, weeks-later closings).
// Read-only Graph API access via a client-shared system-user token (ads_read).

const GRAPH = 'https://graph.facebook.com/v23.0';
const AD_SOURCES = ['facebook', 'instagram'];

const INSIGHT_FIELDS = [
  'date_start',
  'campaign_id',
  'campaign_name',
  'adset_id',
  'adset_name',
  'ad_id',
  'ad_name',
  'spend',
  'impressions',
  'clicks',
  'inline_link_clicks',
  'actions',
  'video_thruplay_watched_actions',
  'video_avg_time_watched_actions',
  'video_p25_watched_actions',
  'video_p50_watched_actions',
  'video_p75_watched_actions',
  'video_p100_watched_actions',
].join(',');

const num = (v: any) => (isFinite(Number(v)) ? Number(v) : 0);
const actionVal = (list: any[] | undefined, type: string) => num((list || []).find((a) => a.action_type === type)?.value);

@Injectable()
export class MarketingService {
  private readonly logger = new Logger(MarketingService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly actionLog: ActionLogService,
  ) {}

  /** Ad spend is management information — master/senior tiers only. */
  private async assertManagement(organizationId: string, userId?: string) {
    const { tier } = await resolveTier(this.prisma, organizationId, userId);
    if (tier === 'designer' || tier === 'junior') throw new NotFoundException();
  }

  // ── connection ───────────────────────────────────────────────────────────

  async getConnection(organizationId: string, userId?: string) {
    await this.assertManagement(organizationId, userId);
    const c = await this.prisma.adAccountConnection.findUnique({ where: { organizationId } });
    if (!c) return { connected: false };
    // Never echo the token back to the portal.
    return {
      connected: c.status === 'CONNECTED',
      adAccountId: c.adAccountId,
      accountName: c.accountName,
      currency: c.currency,
      status: c.status,
      lastError: c.lastError,
      lastSyncAt: c.lastSyncAt,
    };
  }

  async connect(organizationId: string, dto: { adAccountId?: string; accessToken?: string }, userId?: string) {
    await this.assertManagement(organizationId, userId);
    const adAccountId = String(dto?.adAccountId || '')
      .trim()
      .replace(/^act_/, '');
    const accessToken = String(dto?.accessToken || '').trim();
    if (!adAccountId || !accessToken) throw new BadRequestException('Ad account ID and access token are required');

    // Verify before storing: read the account's name/currency with the token.
    const res = await fetch(`${GRAPH}/act_${adAccountId}?fields=name,currency,account_status&access_token=${encodeURIComponent(accessToken)}`);
    const json: any = await res.json().catch(() => ({}));
    if (!res.ok) {
      throw new BadRequestException(`Meta rejected the connection: ${json?.error?.message || res.statusText}`);
    }

    const saved = await this.prisma.adAccountConnection.upsert({
      where: { organizationId },
      update: { adAccountId: `act_${adAccountId}`, accessToken, accountName: json.name || null, currency: json.currency || null, status: 'CONNECTED', lastError: null },
      create: { organizationId, adAccountId: `act_${adAccountId}`, accessToken, accountName: json.name || null, currency: json.currency || null },
    });

    // First sync: pull 90 days of history right away so the dashboard has
    // trends on day one. Fire-and-forget — the portal polls the connection.
    this.syncOrg(saved.organizationId, 90).catch((e) => this.logger.warn(`initial ad sync failed: ${e?.message}`));
    return { connected: true, accountName: json.name || null, currency: json.currency || null };
  }

  async disconnect(organizationId: string, userId?: string) {
    await this.assertManagement(organizationId, userId);
    await this.prisma.adAccountConnection.deleteMany({ where: { organizationId } });
    return { connected: false };
  }

  // ── sync ─────────────────────────────────────────────────────────────────

  async syncNow(organizationId: string, days: number | undefined, userId?: string) {
    await this.assertManagement(organizationId, userId);
    return this.syncOrg(organizationId, Math.min(Math.max(num(days) || 30, 1), 365));
  }

  /** Pull daily ad-level insights for the last `days` days and upsert. */
  private async syncOrg(organizationId: string, days: number) {
    const conn = await this.prisma.adAccountConnection.findUnique({ where: { organizationId } });
    if (!conn || conn.status === 'DISCONNECTED') throw new BadRequestException('No ad account connected');

    const until = new Date();
    const since = new Date(until.getTime() - days * 86400000);
    const iso = (d: Date) => d.toISOString().slice(0, 10);

    let url =
      `${GRAPH}/${conn.adAccountId}/insights?level=ad&time_increment=1` +
      `&time_range={"since":"${iso(since)}","until":"${iso(until)}"}` +
      `&fields=${INSIGHT_FIELDS}&limit=200&access_token=${encodeURIComponent(conn.accessToken)}`;

    let rows = 0;
    try {
      // Follow Graph API paging until exhausted.
      for (let page = 0; page < 50 && url; page++) {
        const res = await fetch(url);
        const json: any = await res.json().catch(() => ({}));
        if (!res.ok) throw new Error(json?.error?.message || `Graph API ${res.status}`);
        for (const r of json.data || []) {
          if (!r.ad_id || !r.date_start) continue;
          const date = new Date(`${r.date_start}T00:00:00Z`);
          const data = {
            campaignId: r.campaign_id || null,
            campaignName: r.campaign_name || null,
            adsetId: r.adset_id || null,
            adsetName: r.adset_name || null,
            adName: r.ad_name || null,
            spend: num(r.spend),
            impressions: num(r.impressions),
            clicks: num(r.clicks),
            linkClicks: num(r.inline_link_clicks),
            // Meta counts leads under a few action types depending on the flow.
            metaLeads: actionVal(r.actions, 'lead') || actionVal(r.actions, 'onsite_conversion.lead_grouped') || actionVal(r.actions, 'leadgen_grouped'),
            thruplays: actionVal(r.video_thruplay_watched_actions, 'video_view'),
            videoAvgSec: actionVal(r.video_avg_time_watched_actions, 'video_view') || null,
            videoP25: actionVal(r.video_p25_watched_actions, 'video_view'),
            videoP50: actionVal(r.video_p50_watched_actions, 'video_view'),
            videoP75: actionVal(r.video_p75_watched_actions, 'video_view'),
            videoP100: actionVal(r.video_p100_watched_actions, 'video_view'),
            raw: r.actions || null,
          };
          await this.prisma.adInsight.upsert({
            where: { organizationId_date_adId: { organizationId, date, adId: r.ad_id } },
            update: data,
            create: { organizationId, date, adId: r.ad_id, ...data },
          });
          rows++;
        }
        url = json?.paging?.next || '';
      }
      await this.prisma.adAccountConnection.update({ where: { organizationId }, data: { lastSyncAt: new Date(), status: 'CONNECTED', lastError: null } });
      return { synced: rows, since: iso(since), until: iso(until) };
    } catch (e: any) {
      await this.prisma.adAccountConnection.update({ where: { organizationId }, data: { status: 'ERROR', lastError: String(e?.message || e).slice(0, 500) } }).catch(() => null);
      throw new BadRequestException(`Ad sync failed: ${e?.message || e}`);
    }
  }

  /** 03:40 SGT nightly: refresh the last 3 days for every connected org
   *  (Meta restates recent days as attribution settles). */
  @Cron('40 19 * * *') // 19:40 UTC = 03:40 SGT
  async nightlySync() {
    const conns = await this.prisma.adAccountConnection.findMany({ where: { status: { not: 'DISCONNECTED' } } });
    for (const c of conns) {
      try {
        const r = await this.syncOrg(c.organizationId, 3);
        await this.actionLog.system('ads-insights-sync', 'SYNC', 'marketing', {
          organizationId: c.organizationId,
          details: { rows: r.synced, adAccountId: c.adAccountId },
        });
      } catch (e: any) {
        this.logger.warn(`nightly ad sync failed for ${c.organizationId}: ${e?.message}`);
      }
    }
  }

  // ── overview (the dashboard payload) ─────────────────────────────────────

  async overview(organizationId: string, months: number | undefined, userId?: string) {
    await this.assertManagement(organizationId, userId);
    const conn = await this.prisma.adAccountConnection.findUnique({ where: { organizationId } });
    const m = Math.min(Math.max(num(months) || 6, 1), 24);
    const now = new Date();
    const from = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - (m - 1), 1));

    const [insights, leads] = await Promise.all([
      this.prisma.adInsight.findMany({ where: { organizationId, date: { gte: from } }, orderBy: { date: 'asc' } }),
      this.prisma.lead.findMany({
        where: { organizationId, source: { in: AD_SOURCES }, receivedAt: { gte: from } },
        select: { id: true, status: true, source: true, receivedAt: true, projectId: true },
      }),
    ]);

    // Signed value of converted ad leads: linked project's confirmed quotation
    // grand total + confirmed VO milestones (same notion of revenue as the
    // ID dashboard uses).
    const projectIds = [...new Set(leads.map((l) => l.projectId).filter(Boolean))] as string[];
    const projects = projectIds.length
      ? await this.prisma.project.findMany({
          where: { id: { in: projectIds } },
          select: {
            id: true,
            documents: { where: { type: { in: ['QUOTATION', 'QO', 'QO1', 'QO2', 'QT'] }, status: 'confirmed' }, select: { config: true }, orderBy: { createdAt: 'desc' }, take: 1 },
            milestones: { where: { kind: 'vo' }, select: { amount: true } },
          },
        })
      : [];
    const valueOfProject = new Map<string, number>();
    for (const p of projects) {
      const cfg: any = p.documents[0]?.config || null;
      const quote = num(cfg?.documentInfo?.grandTotal);
      const vo = p.milestones.reduce((x, ms) => x + num(ms.amount), 0);
      valueOfProject.set(p.id, quote + vo);
    }

    const monthKey = (d: Date) => `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`;
    const monthKeys: string[] = [];
    for (let i = 0; i < m; i++) {
      const d = new Date(Date.UTC(from.getUTCFullYear(), from.getUTCMonth() + i, 1));
      monthKeys.push(monthKey(d));
    }

    // Monthly time series — ads side.
    const monthly = new Map(
      monthKeys.map((k) => [
        k,
        { month: k, spend: 0, impressions: 0, clicks: 0, metaLeads: 0, aimsLeads: 0, converted: 0, signedValue: 0, cpc: null as number | null, cpl: null as number | null, trueCpl: null as number | null, roas: null as number | null },
      ]),
    );
    for (const r of insights) {
      const row = monthly.get(monthKey(r.date));
      if (!row) continue;
      row.spend += r.spend;
      row.impressions += r.impressions;
      row.clicks += r.clicks;
      row.metaLeads += r.metaLeads;
    }
    for (const l of leads) {
      const row = l.receivedAt ? monthly.get(monthKey(l.receivedAt)) : null;
      if (!row) continue;
      row.aimsLeads += 1;
      if (l.status === 'converted') {
        row.converted += 1;
        row.signedValue += l.projectId ? valueOfProject.get(l.projectId) || 0 : 0;
      }
    }
    for (const row of monthly.values()) {
      row.spend = Math.round(row.spend * 100) / 100;
      row.cpc = row.clicks ? Math.round((row.spend / row.clicks) * 100) / 100 : null;
      row.cpl = row.metaLeads ? Math.round((row.spend / row.metaLeads) * 100) / 100 : null;
      row.trueCpl = row.aimsLeads ? Math.round((row.spend / row.aimsLeads) * 100) / 100 : null;
      row.roas = row.spend ? Math.round((row.signedValue / row.spend) * 100) / 100 : null;
    }

    // Per-campaign rollup.
    const byCampaign = new Map<string, any>();
    for (const r of insights) {
      const key = r.campaignId || 'unknown';
      const c = byCampaign.get(key) || { campaignId: key, name: r.campaignName || 'Unknown campaign', spend: 0, impressions: 0, clicks: 0, metaLeads: 0, thruplays: 0, watchSecWeighted: 0, p100: 0 };
      c.name = r.campaignName || c.name;
      c.spend += r.spend;
      c.impressions += r.impressions;
      c.clicks += r.clicks;
      c.metaLeads += r.metaLeads;
      c.thruplays += r.thruplays;
      c.watchSecWeighted += (r.videoAvgSec || 0) * r.impressions;
      c.p100 += r.videoP100;
      byCampaign.set(key, c);
    }
    const campaigns = [...byCampaign.values()]
      .map((c) => ({
        ...c,
        spend: Math.round(c.spend * 100) / 100,
        cpc: c.clicks ? Math.round((c.spend / c.clicks) * 100) / 100 : null,
        cpl: c.metaLeads ? Math.round((c.spend / c.metaLeads) * 100) / 100 : null,
        avgWatchSec: c.impressions ? Math.round((c.watchSecWeighted / c.impressions) * 10) / 10 : null,
        watchSecWeighted: undefined,
      }))
      .sort((a, b) => b.spend - a.spend);

    // Per-ad video/content table — "which creative is doing well".
    const byAd = new Map<string, any>();
    for (const r of insights) {
      const a = byAd.get(r.adId) || { adId: r.adId, name: r.adName || r.adId, campaign: r.campaignName || '', spend: 0, impressions: 0, clicks: 0, metaLeads: 0, thruplays: 0, watchSecWeighted: 0, p25: 0, p50: 0, p75: 0, p100: 0 };
      a.name = r.adName || a.name;
      a.campaign = r.campaignName || a.campaign;
      a.spend += r.spend;
      a.impressions += r.impressions;
      a.clicks += r.clicks;
      a.metaLeads += r.metaLeads;
      a.thruplays += r.thruplays;
      a.watchSecWeighted += (r.videoAvgSec || 0) * r.impressions;
      a.p25 += r.videoP25;
      a.p50 += r.videoP50;
      a.p75 += r.videoP75;
      a.p100 += r.videoP100;
      byAd.set(r.adId, a);
    }
    const ads = [...byAd.values()]
      .map((a) => ({
        ...a,
        spend: Math.round(a.spend * 100) / 100,
        cpc: a.clicks ? Math.round((a.spend / a.clicks) * 100) / 100 : null,
        cpl: a.metaLeads ? Math.round((a.spend / a.metaLeads) * 100) / 100 : null,
        ctr: a.impressions ? Math.round((a.clicks / a.impressions) * 10000) / 100 : null,
        avgWatchSec: a.impressions ? Math.round((a.watchSecWeighted / a.impressions) * 10) / 10 : null,
        completionPct: a.thruplays || a.p25 ? (a.p25 ? Math.round((a.p100 / a.p25) * 100) : null) : null,
        watchSecWeighted: undefined,
      }))
      .sort((a, b) => b.spend - a.spend)
      .slice(0, 50);

    // Totals across the window.
    const totals = [...monthly.values()].reduce(
      (acc, r) => {
        acc.spend += r.spend;
        acc.clicks += r.clicks;
        acc.impressions += r.impressions;
        acc.metaLeads += r.metaLeads;
        acc.aimsLeads += r.aimsLeads;
        acc.converted += r.converted;
        acc.signedValue += r.signedValue;
        return acc;
      },
      { spend: 0, clicks: 0, impressions: 0, metaLeads: 0, aimsLeads: 0, converted: 0, signedValue: 0 },
    );

    return {
      connection: conn
        ? { connected: conn.status === 'CONNECTED', accountName: conn.accountName, currency: conn.currency, status: conn.status, lastError: conn.lastError, lastSyncAt: conn.lastSyncAt }
        : { connected: false },
      months: monthKeys,
      totals: {
        ...totals,
        spend: Math.round(totals.spend * 100) / 100,
        cpc: totals.clicks ? Math.round((totals.spend / totals.clicks) * 100) / 100 : null,
        cpl: totals.metaLeads ? Math.round((totals.spend / totals.metaLeads) * 100) / 100 : null,
        trueCpl: totals.aimsLeads ? Math.round((totals.spend / totals.aimsLeads) * 100) / 100 : null,
        roas: totals.spend ? Math.round((totals.signedValue / totals.spend) * 100) / 100 : null,
        costPerSigned: totals.converted ? Math.round((totals.spend / totals.converted) * 100) / 100 : null,
      },
      monthly: [...monthly.values()],
      campaigns,
      ads,
    };
  }
}
