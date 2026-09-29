import { Injectable, Logger, BadRequestException } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { PrismaService } from '../common/prisma.service';
import { JournalService } from '../journal/journal.service';
import { ActionLogService } from '../action-log/action-log.service';
import { runAsOrg } from '../common/tenancy/tenant-context';

/**
 * Airwallex → AIMS ticket-order sync (built for YOURWORLD, org-generic).
 *
 * Polls Airwallex `payment_intents` with the org's API credentials and books
 * every SUCCEEDED intent whose order id starts with the connection's prefix
 * (e.g. STAR_) as a posted journal:
 *
 *     Dr  <clearingAccountCode>  (default CA103 Airwallex Clearing)
 *     Cr  <revenueAccountCode>   (default SS002 Ticket Sales)
 *
 * reference = the order id, so (a) re-runs dedupe against JournalEntry.reference
 * and (b) when the Airwallex payout lands in the bank statement, bank rec posts
 * it against the clearing account and the books tie without manual work.
 */
@Injectable()
export class AirwallexSyncService {
  private readonly logger = new Logger(AirwallexSyncService.name);
  // conn.id → { token, expiresAt } — Airwallex login tokens live ~30 min.
  private tokens = new Map<string, { token: string; expiresAt: number }>();
  private running = false;

  constructor(
    private readonly prisma: PrismaService,
    private readonly journal: JournalService,
    private readonly actionLog: ActionLogService,
  ) {}

  // ---------- Airwallex API ----------

  private async login(conn: any): Promise<string> {
    const cached = this.tokens.get(conn.id);
    if (cached && cached.expiresAt > Date.now() + 60_000) return cached.token;
    const res = await fetch(`${conn.apiBase}/api/v1/authentication/login`, {
      method: 'POST',
      headers: { 'x-client-id': conn.clientId, 'x-api-key': conn.apiKey, 'Content-Type': 'application/json' },
    });
    if (!res.ok) throw new Error(`Airwallex login failed: ${res.status} ${(await res.text()).slice(0, 200)}`);
    const body: any = await res.json();
    const expiresAt = body.expires_at ? new Date(body.expires_at).getTime() : Date.now() + 25 * 60_000;
    this.tokens.set(conn.id, { token: body.token, expiresAt });
    return body.token;
  }

  /** Page through payment_intents created at/after `from`. */
  private async fetchIntents(conn: any, from: Date): Promise<any[]> {
    const token = await this.login(conn);
    const out: any[] = [];
    for (let page = 0; page < 50; page++) {
      const url =
        `${conn.apiBase}/api/v1/pa/payment_intents?page_num=${page}&page_size=100` +
        `&from_created_at=${encodeURIComponent(from.toISOString())}`;
      const res = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
      if (!res.ok) throw new Error(`Airwallex payment_intents failed: ${res.status} ${(await res.text()).slice(0, 200)}`);
      const body: any = await res.json();
      out.push(...(body.items ?? []));
      if (!body.has_more) break;
    }
    return out;
  }

  /** The order id an intent carries: merchant_order_id, else metadata.order_id. */
  private orderIdOf(intent: any): string | null {
    return intent?.merchant_order_id || intent?.metadata?.order_id || null;
  }

  /** Page through refunds created at/after `from`. */
  private async fetchRefunds(conn: any, from: Date): Promise<any[]> {
    const token = await this.login(conn);
    const out: any[] = [];
    for (let page = 0; page < 50; page++) {
      const url =
        `${conn.apiBase}/api/v1/pa/refunds?page_num=${page}&page_size=100` +
        `&from_created_at=${encodeURIComponent(from.toISOString())}`;
      const res = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
      if (!res.ok) throw new Error(`Airwallex refunds failed: ${res.status} ${(await res.text()).slice(0, 200)}`);
      const body: any = await res.json();
      out.push(...(body.items ?? []));
      if (!body.has_more) break;
    }
    return out;
  }

  /**
   * Page through financial transactions (the settlement ledger: per-payment
   * gross `amount`, `fee`, `net`) created at/after `from`.
   */
  private async fetchFinancialTxns(conn: any, from: Date): Promise<any[]> {
    const token = await this.login(conn);
    const out: any[] = [];
    for (let page = 0; page < 50; page++) {
      const url =
        `${conn.apiBase}/api/v1/financial_transactions?page_num=${page}&page_size=100` +
        `&from_created_at=${encodeURIComponent(from.toISOString())}`;
      const res = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
      if (!res.ok) throw new Error(`Airwallex financial_transactions failed: ${res.status} ${(await res.text()).slice(0, 200)}`);
      const body: any = await res.json();
      out.push(...(body.items ?? []));
      if (!body.has_more) break;
    }
    return out;
  }

  /** Fetch one payment intent (used to resolve a refund's order id). */
  private async fetchIntent(conn: any, intentId: string): Promise<any | null> {
    const token = await this.login(conn);
    const res = await fetch(`${conn.apiBase}/api/v1/pa/payment_intents/${intentId}`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    if (!res.ok) return null;
    return res.json();
  }

  // ---------- sync ----------

  @Cron('*/5 * * * *')
  async syncAll() {
    if (this.running) return;
    this.running = true;
    try {
      const conns = await this.prisma.airwallexConnection.findMany({ where: { enabled: true } });
      for (const conn of conns) {
        try {
          await runAsOrg(conn.organizationId, () => this.syncConnection(conn));
        } catch (e: any) {
          this.logger.error(`sync failed for org ${conn.organizationId}: ${e.message}`);
          await this.prisma.airwallexConnection.update({
            where: { id: conn.id },
            data: { lastError: String(e.message).slice(0, 500) },
          });
        }
      }
    } finally {
      this.running = false;
    }
  }

  /** Dedupe key = JournalEntry.reference. Posts Dr/Cr `amount` and logs it. */
  private async postSimpleJE(
    ORG: string,
    args: { reference: string; date: Date; description: string; drAccountId: string; crAccountId: string; amount: number; details: any },
  ): Promise<boolean> {
    const dupe = await this.prisma.journalEntry.findFirst({
      where: { organizationId: ORG, reference: args.reference, status: { not: 'VOID' } },
      select: { id: true },
    });
    if (dupe) return false;
    const entry = await this.journal.create(
      ORG,
      {
        entryDate: args.date.toISOString(),
        type: 'MANUAL',
        reference: args.reference,
        description: args.description,
        lines: [
          { accountId: args.drAccountId, debit: args.amount, credit: 0, description: args.description },
          { accountId: args.crAccountId, debit: 0, credit: args.amount, description: args.description },
        ],
      } as any,
      'airwallex-sync',
    );
    const posted = await this.journal.post(ORG, entry.id, 'airwallex-sync');
    this.actionLog.system('airwallex-sync', 'CREATE', 'journal', {
      organizationId: ORG,
      resourceId: posted.id,
      details: { ...args.details, journalNumber: posted.journalNumber, amount: args.amount },
    });
    return true;
  }

  /**
   * Cross-process claim: two runners (cron in the API + a script, or two API
   * instances) racing the read-then-post dedupe WILL double-post — seen on dev
   * 2026-09-28. Atomically bump lastSyncAt iff no runner claimed it in the
   * last 2 minutes; losers skip this round.
   */
  private async claim(conn: any): Promise<boolean> {
    const n: number = await this.prisma.$executeRawUnsafe(
      `UPDATE "AirwallexConnection" SET "lastSyncAt" = now()
       WHERE id = $1 AND ("lastSyncAt" IS NULL OR "lastSyncAt" < now() - interval '2 minutes')`,
      conn.id,
    );
    return n > 0;
  }

  async syncConnection(conn: any): Promise<any> {
    if (!conn.clientId || !conn.apiKey) throw new BadRequestException('Airwallex clientId/apiKey not configured');
    if (!(await this.claim(conn))) {
      this.logger.warn(`org ${conn.organizationId}: another sync ran <2min ago — skipping`);
      return { skippedRun: 'another sync claimed this connection <2min ago' };
    }
    const ORG = conn.organizationId;

    const codes = [conn.clearingAccountCode, conn.revenueAccountCode, conn.feeAccountCode, conn.refundAccountCode];
    const accounts = await this.prisma.chartOfAccount.findMany({
      where: { organizationId: ORG, code: { in: codes } },
    });
    const byCode = new Map(accounts.map((a: any) => [a.code, a]));
    const missing = codes.filter((c) => !byCode.has(c));
    if (missing.length) throw new BadRequestException(`Posting accounts missing in chart: ${missing.join(', ')}`);
    const clearing: any = byCode.get(conn.clearingAccountCode);
    const revenue: any = byCode.get(conn.revenueAccountCode);
    const feeAcct: any = byCode.get(conn.feeAccountCode);
    const refundAcct: any = byCode.get(conn.refundAccountCode);

    // 24h overlap behind each cursor — reference-dedupe makes the overlap free.
    const cursor = (d: Date | null | undefined) => new Date((d?.getTime() ?? Date.now() - 30 * 864e5) - 864e5);
    const errors: string[] = [];
    const result: any = { orders: null, refunds: null, fees: null };
    const data: any = { lastSyncAt: new Date() };

    // ---- 1. orders: Dr clearing / Cr revenue (gross) ----
    try {
      const from = cursor(conn.syncFrom);
      const intents = await this.fetchIntents(conn, from);
      let created = 0, skipped = 0;
      let maxAt = conn.syncFrom ?? from;
      for (const intent of intents) {
        const createdAt = intent.created_at ? new Date(intent.created_at) : null;
        if (createdAt && createdAt > maxAt) maxAt = createdAt;
        const orderId = this.orderIdOf(intent);
        if (intent.status !== 'SUCCEEDED') continue;
        if (!orderId || !orderId.startsWith(conn.orderPrefix)) continue;
        if (intent.currency && intent.currency !== 'SGD') {
          this.logger.warn(`skipping non-SGD intent ${intent.id} (${intent.currency})`);
          skipped++;
          continue;
        }
        const amount = Math.round(Number(intent.amount) * 100) / 100;
        if (!amount || amount <= 0) continue;
        const desc = `Airwallex ticket order ${orderId} (${intent.id})`;
        const ok = await this.postSimpleJE(ORG, {
          reference: orderId,
          date: createdAt ?? new Date(),
          description: desc,
          drAccountId: clearing.id,
          crAccountId: revenue.id,
          amount,
          details: { orderId, airwallexIntentId: intent.id },
        });
        ok ? created++ : skipped++;
      }
      data.syncFrom = maxAt;
      result.orders = { fetched: intents.length, created, skipped };
    } catch (e: any) {
      errors.push(`orders: ${e.message}`);
    }

    // ---- 2. refunds: Dr refund account / Cr clearing ----
    try {
      const from = cursor(conn.refundsFrom);
      const refunds = await this.fetchRefunds(conn, from);
      let created = 0, skipped = 0;
      let maxAt = conn.refundsFrom ?? from;
      for (const rf of refunds) {
        const createdAt = rf.created_at ? new Date(rf.created_at) : null;
        if (createdAt && createdAt > maxAt) maxAt = createdAt;
        if (rf.status !== 'SUCCEEDED') continue;
        if (rf.currency && rf.currency !== 'SGD') { skipped++; continue; }
        const amount = Math.round(Number(rf.amount) * 100) / 100;
        if (!amount || amount <= 0) continue;
        // Resolve the order: local order JE mentions the intent id, else ask Airwallex.
        let orderId: string | null = null;
        const orderJe = await this.prisma.journalEntry.findFirst({
          where: { organizationId: ORG, description: { contains: rf.payment_intent_id ?? '∅' } },
          select: { reference: true },
        });
        orderId = orderJe?.reference ?? null;
        if (!orderId && rf.payment_intent_id) orderId = this.orderIdOf(await this.fetchIntent(conn, rf.payment_intent_id));
        if (!orderId || !orderId.startsWith(conn.orderPrefix)) { skipped++; continue; }
        const desc = `Airwallex refund ${rf.id} for order ${orderId}`;
        const ok = await this.postSimpleJE(ORG, {
          reference: `AWXRF_${rf.id}`,
          date: createdAt ?? new Date(),
          description: desc,
          drAccountId: refundAcct.id,
          crAccountId: clearing.id,
          amount,
          details: { orderId, airwallexRefundId: rf.id, airwallexIntentId: rf.payment_intent_id },
        });
        ok ? created++ : skipped++;
      }
      data.refundsFrom = maxAt;
      result.refunds = { fetched: refunds.length, created, skipped };
    } catch (e: any) {
      errors.push(`refunds: ${e.message}`);
    }

    // ---- 3. fees: Dr fee account / Cr clearing (reversed for fee credits) ----
    try {
      const from = cursor(conn.feesFrom);
      const txns = await this.fetchFinancialTxns(conn, from);
      let created = 0, skipped = 0;
      let maxAt = conn.feesFrom ?? from;
      for (const t of txns) {
        const createdAt = t.created_at ? new Date(t.created_at) : null;
        if (createdAt && createdAt > maxAt) maxAt = createdAt;
        if (t.currency && t.currency !== 'SGD') continue;
        const fee = Math.round(Number(t.fee ?? 0) * 100) / 100;
        if (!fee) continue;
        const desc = `Airwallex fee — ${t.transaction_type ?? 'transaction'} ${t.source_id ?? t.id}`;
        const ok = await this.postSimpleJE(ORG, {
          reference: `AWXFEE_${t.id}`,
          date: createdAt ?? new Date(),
          description: desc,
          // negative fee = Airwallex returned a fee (e.g. on refund) → reverse.
          drAccountId: fee > 0 ? feeAcct.id : clearing.id,
          crAccountId: fee > 0 ? clearing.id : feeAcct.id,
          amount: Math.abs(fee),
          details: { airwallexTxnId: t.id, sourceId: t.source_id, transactionType: t.transaction_type },
        });
        ok ? created++ : skipped++;
      }
      data.feesFrom = maxAt;
      result.fees = { fetched: txns.length, created, skipped };
    } catch (e: any) {
      errors.push(`fees: ${e.message}`);
    }

    data.lastError = errors.length ? errors.join(' | ').slice(0, 500) : null;
    await this.prisma.airwallexConnection.update({ where: { id: conn.id }, data });
    this.logger.log(`org ${ORG}: ${JSON.stringify(result)}${errors.length ? ' errors: ' + data.lastError : ''}`);
    if (errors.length && !result.orders) throw new Error(data.lastError);
    return result;
  }

  // ---------- admin surface ----------

  async status(organizationId: string) {
    const conn = await this.prisma.airwallexConnection.findUnique({ where: { organizationId } });
    if (!conn) return { configured: false };
    const clearingBalance = await this.prisma.journalEntryLine.aggregate({
      where: {
        journalEntry: { organizationId, status: 'POSTED' },
        account: { code: conn.clearingAccountCode },
      },
      _sum: { debit: true, credit: true },
    });
    return {
      configured: true,
      enabled: conn.enabled,
      ready: Boolean(conn.clientId && conn.apiKey),
      orderPrefix: conn.orderPrefix,
      clearingAccountCode: conn.clearingAccountCode,
      revenueAccountCode: conn.revenueAccountCode,
      feeAccountCode: conn.feeAccountCode,
      refundAccountCode: conn.refundAccountCode,
      lastSyncAt: conn.lastSyncAt,
      lastError: conn.lastError,
      clearingBalance:
        Math.round(((clearingBalance._sum.debit ?? 0) - (clearingBalance._sum.credit ?? 0)) * 100) / 100,
    };
  }

  async syncNow(organizationId: string) {
    if (this.running) throw new BadRequestException('A sync is already in progress');
    const conn = await this.prisma.airwallexConnection.findUnique({ where: { organizationId } });
    if (!conn) throw new BadRequestException('No Airwallex connection for this organization');
    if (!conn.enabled) throw new BadRequestException('Airwallex connection is disabled');
    return runAsOrg(organizationId, () => this.syncConnection(conn));
  }
}
