import { BadRequestException, HttpException, HttpStatus, Injectable, Logger, NotFoundException } from '@nestjs/common';
import Anthropic from '@anthropic-ai/sdk';
import { XeroClient } from 'xero-node';
import { PrismaService } from '../common/prisma.service';

// ---------------------------------------------------------------------------
// Xero PULL-only sync. Mirror counterpart to the existing XeroService which
// is PUSH-only. Pulls (Phase A):
//   - Chart of Accounts → upserts into AIMS ChartOfAccount by Xero AccountID.
//     Doesn't auto-create new AIMS accounts on first sync; instead surfaces
//     them as unmapped XeroAccountMapping rows for the user to approve.
//   - Contacts → splits by IsCustomer/IsSupplier into Customer / Supplier
//     tables, upserts by Xero ContactID.
//
// Phase B (not in this session): Invoices, Bills, Payments, Manual Journals.
// Those need careful design to not double-count against existing AIMS data.
// ---------------------------------------------------------------------------

type ScopeFlags = {
  accounts?: boolean;
  contacts?: boolean;
};

@Injectable()
export class XeroSyncService {
  private readonly logger = new Logger(XeroSyncService.name);

  constructor(private readonly prisma: PrismaService) {}

  // ---------- Connection loader ----------

  private async loadConnection(organizationId: string) {
    const conn = await this.prisma.xeroConnection.findUnique({ where: { organizationId } });
    if (!conn) {
      throw new HttpException('Xero not connected. Connect first via the integrations page.', HttpStatus.FAILED_DEPENDENCY);
    }
    // Token may have expired — caller should refresh. v1 surfaces the error
    // and asks user to reconnect (existing XeroService handles refresh on its
    // own paths; we don't duplicate the logic here).
    if (conn.accessTokenExpiresAt < new Date()) {
      throw new HttpException(
        'Xero access token expired — re-connect on the integrations page to refresh.',
        HttpStatus.UNAUTHORIZED,
      );
    }
    return conn;
  }

  private buildClient(accessToken: string): XeroClient {
    const client = new XeroClient({
      clientId: process.env.XERO_CLIENT_ID || '',
      clientSecret: process.env.XERO_CLIENT_SECRET || '',
      redirectUris: [process.env.XERO_REDIRECT_URI || ''],
      scopes: 'openid profile email accounting.transactions accounting.contacts accounting.settings offline_access'.split(' '),
    });
    client.setTokenSet({ access_token: accessToken, token_type: 'Bearer' } as any);
    return client;
  }

  // ---------- Connection status (richer than the legacy /xero/status) ----------

  async status(organizationId: string) {
    const conn = await this.prisma.xeroConnection.findUnique({ where: { organizationId } });
    if (!conn) return { connected: false };
    const expired = conn.accessTokenExpiresAt < new Date();
    const lastRun = await this.prisma.xeroSyncRun.findFirst({
      where: { organizationId },
      orderBy: { startedAt: 'desc' },
    });
    const mappingCount = await this.prisma.xeroAccountMapping.count({
      where: { organizationId },
    });
    const mappedCount = await this.prisma.xeroAccountMapping.count({
      where: { organizationId, aimsAccountId: { not: null }, confirmedAt: { not: null } },
    });
    return {
      connected: true,
      tenantId: conn.tenantId,
      accessTokenExpiresAt: conn.accessTokenExpiresAt,
      expired,
      lastSync: lastRun
        ? {
            id: lastRun.id,
            status: lastRun.status,
            startedAt: lastRun.startedAt,
            finishedAt: lastRun.finishedAt,
            counts: lastRun.counts,
          }
        : null,
      mappingStats: { total: mappingCount, mapped: mappedCount, unmapped: mappingCount - mappedCount },
    };
  }

  // ---------- Sync runs (log) ----------

  listRuns(organizationId: string) {
    return this.prisma.xeroSyncRun.findMany({
      where: { organizationId },
      orderBy: { startedAt: 'desc' },
      take: 20,
    });
  }

  // ---------- Master run ----------

  async run(organizationId: string, scope: ScopeFlags, userId?: string) {
    const conn = await this.loadConnection(organizationId);
    const client = this.buildClient(conn.accessToken);

    const runRow = await this.prisma.xeroSyncRun.create({
      data: {
        organizationId,
        scope: scope as any,
        status: 'RUNNING',
        startedBy: userId,
      },
    });

    const counts: any = {};
    const errors: any[] = [];

    try {
      if (scope.accounts !== false) {
        try {
          const r = await this.pullAccounts(organizationId, client, conn.tenantId);
          counts.accountsCreatedMapping = r.mappingsCreated;
          counts.accountsAuto = r.autoMatched;
          counts.accountsTotal = r.total;
        } catch (e: any) {
          errors.push({ scope: 'accounts', error: e?.message || String(e) });
        }
      }
      if (scope.contacts !== false) {
        try {
          const r = await this.pullContacts(organizationId, client, conn.tenantId);
          counts.customersCreated = r.customersCreated;
          counts.customersUpdated = r.customersUpdated;
          counts.suppliersCreated = r.suppliersCreated;
          counts.suppliersUpdated = r.suppliersUpdated;
          counts.contactsTotal = r.total;
        } catch (e: any) {
          errors.push({ scope: 'contacts', error: e?.message || String(e) });
        }
      }

      const status = errors.length === 0 ? 'SUCCESS' : counts && Object.keys(counts).length > 0 ? 'PARTIAL' : 'FAILED';
      return this.prisma.xeroSyncRun.update({
        where: { id: runRow.id },
        data: {
          status,
          finishedAt: new Date(),
          counts,
          errors: errors.length > 0 ? (errors as any) : undefined,
        },
      });
    } catch (e: any) {
      return this.prisma.xeroSyncRun.update({
        where: { id: runRow.id },
        data: {
          status: 'FAILED',
          finishedAt: new Date(),
          errors: [{ fatal: e?.message || String(e) }] as any,
        },
      });
    }
  }

  // ---------- Pull: Chart of Accounts ----------
  //
  // For each Xero account:
  //   - If a XeroAccountMapping row already exists → update name/type, keep mapping
  //   - Else → create a XeroAccountMapping row (aimsAccountId=null initially);
  //     then attempt a code-based auto-match against the AIMS chart (exact code
  //     match wins, sets source='AUTO', confidence=1.0). Anything that doesn't
  //     match stays unmapped for the user to handle in the integrations page.
  //   - We do NOT auto-create AIMS ChartOfAccount rows here — that's a manual
  //     "Create in AIMS" action on the unmapped row in the UI.
  //
  async pullAccounts(organizationId: string, client: XeroClient, tenantId: string) {
    const resp = await client.accountingApi.getAccounts(tenantId);
    const xeroAccounts = resp.body?.accounts || [];

    const aimsAccounts = await this.prisma.chartOfAccount.findMany({
      where: { organizationId },
      select: { id: true, code: true, name: true },
    });
    const byCode = new Map(aimsAccounts.map((a) => [a.code.toUpperCase(), a]));

    let mappingsCreated = 0;
    let autoMatched = 0;

    for (const xa of xeroAccounts) {
      if (!xa.accountID) continue;
      const existing = await this.prisma.xeroAccountMapping.findUnique({
        where: { organizationId_xeroAccountId: { organizationId, xeroAccountId: xa.accountID } },
      });

      // Code-match candidate.
      const codeMatch = xa.code ? byCode.get(xa.code.toUpperCase()) : undefined;

      if (existing) {
        // Refresh name/type only — don't touch the mapping.
        await this.prisma.xeroAccountMapping.update({
          where: { id: existing.id },
          data: {
            xeroAccountCode: xa.code ?? null,
            xeroAccountName: xa.name ?? existing.xeroAccountName,
            // xa.type is xero-node's AccountType enum — coerce via String() so
            // TS doesn't complain about narrowing an enum down to plain string.
            xeroAccountType: xa.type != null ? String(xa.type) : null,
          },
        });
      } else {
        await this.prisma.xeroAccountMapping.create({
          data: {
            organizationId,
            xeroAccountId: xa.accountID,
            xeroAccountCode: xa.code ?? null,
            xeroAccountName: xa.name ?? '(unnamed)',
            // xa.type is xero-node's AccountType enum — coerce via String() so
            // TS doesn't complain about narrowing an enum down to plain string.
            xeroAccountType: xa.type != null ? String(xa.type) : null,
            aimsAccountId: codeMatch?.id ?? null,
            aimsAccountCode: codeMatch?.code ?? '',
            source: codeMatch ? 'AUTO' : 'AUTO',
            confidence: codeMatch ? 1.0 : null,
            reason: codeMatch ? `Exact code match: ${codeMatch.code}` : null,
            confirmedAt: codeMatch ? new Date() : null, // exact code matches are safe to auto-confirm
          },
        });
        mappingsCreated += 1;
        if (codeMatch) {
          autoMatched += 1;
          // Tag the AIMS account with its xeroId for future fast lookups.
          await this.prisma.chartOfAccount
            .update({
              where: { id: codeMatch.id },
              data: { xeroId: xa.accountID, xeroLastSyncAt: new Date() },
            })
            .catch(() => undefined); // duplicate-xeroId edge case, ignore
        }
      }
    }

    return { total: xeroAccounts.length, mappingsCreated, autoMatched };
  }

  // ---------- Pull: Contacts ----------
  //
  // Xero Contacts cover both customers and suppliers (via IsCustomer/IsSupplier
  // flags). We split into AIMS Customer and Supplier respectively, upserting
  // by xeroId. A Xero contact flagged as BOTH ends up in both tables.
  //
  async pullContacts(organizationId: string, client: XeroClient, tenantId: string) {
    const resp = await client.accountingApi.getContacts(tenantId);
    const contacts = resp.body?.contacts || [];

    let customersCreated = 0;
    let customersUpdated = 0;
    let suppliersCreated = 0;
    let suppliersUpdated = 0;

    for (const c of contacts) {
      if (!c.contactID || !c.name) continue;
      const email = c.emailAddress || undefined;
      const phone = c.phones?.[0]?.phoneNumber || undefined;
      const addressLines = c.addresses?.[0]?.addressLine1
        ? [c.addresses[0].addressLine1, c.addresses[0].addressLine2, c.addresses[0].city, c.addresses[0].postalCode]
            .filter(Boolean)
            .join(', ')
        : undefined;

      if (c.isCustomer) {
        const existing = await this.prisma.customer.findUnique({ where: { xeroId: c.contactID } });
        if (existing) {
          await this.prisma.customer.update({
            where: { id: existing.id },
            data: {
              name: c.name,
              email,
              phone,
              address: addressLines,
              gstRegNo: c.taxNumber || undefined,
              xeroLastSyncAt: new Date(),
            },
          });
          customersUpdated += 1;
        } else {
          await this.prisma.customer.create({
            data: {
              organizationId,
              name: c.name,
              email,
              phone,
              address: addressLines,
              gstRegNo: c.taxNumber || undefined,
              xeroId: c.contactID,
              xeroLastSyncAt: new Date(),
            },
          });
          customersCreated += 1;
        }
      }

      if (c.isSupplier) {
        const existing = await this.prisma.supplier.findUnique({ where: { xeroId: c.contactID } });
        if (existing) {
          await this.prisma.supplier.update({
            where: { id: existing.id },
            data: {
              name: c.name,
              email,
              phone,
              address: addressLines,
              gstRegNo: c.taxNumber || undefined,
              xeroLastSyncAt: new Date(),
            },
          });
          suppliersUpdated += 1;
        } else {
          await this.prisma.supplier.create({
            data: {
              organizationId,
              name: c.name,
              email,
              phone,
              address: addressLines,
              gstRegNo: c.taxNumber || undefined,
              xeroId: c.contactID,
              xeroLastSyncAt: new Date(),
            },
          });
          suppliersCreated += 1;
        }
      }
    }

    return {
      total: contacts.length,
      customersCreated,
      customersUpdated,
      suppliersCreated,
      suppliersUpdated,
    };
  }

  // ---------- Account mapping CRUD ----------

  listMappings(organizationId: string) {
    return this.prisma.xeroAccountMapping.findMany({
      where: { organizationId },
      orderBy: { xeroAccountCode: 'asc' },
    });
  }

  async setMapping(
    organizationId: string,
    xeroAccountId: string,
    aimsAccountId: string | null,
    source: 'MANUAL' | 'CREATED' = 'MANUAL',
  ) {
    const mapping = await this.prisma.xeroAccountMapping.findUnique({
      where: { organizationId_xeroAccountId: { organizationId, xeroAccountId } },
    });
    if (!mapping) throw new NotFoundException('Mapping not found — run a sync first');
    let aimsAccountCode = '';
    if (aimsAccountId) {
      const acct = await this.prisma.chartOfAccount.findFirst({
        where: { id: aimsAccountId, organizationId },
      });
      if (!acct) throw new BadRequestException('AIMS account not found');
      aimsAccountCode = acct.code;
      // Tag the AIMS account with this xeroId for fast bidirectional lookups.
      await this.prisma.chartOfAccount.update({
        where: { id: aimsAccountId },
        data: { xeroId: xeroAccountId, xeroLastSyncAt: new Date() },
      });
    }
    return this.prisma.xeroAccountMapping.update({
      where: { id: mapping.id },
      data: {
        aimsAccountId,
        aimsAccountCode,
        source,
        confirmedAt: new Date(),
      },
    });
  }

  // Create an AIMS account from an unmapped Xero account and link them.
  // Handy when Xero has accounts AIMS doesn't have yet.
  async createAimsFromXero(organizationId: string, xeroAccountId: string) {
    const mapping = await this.prisma.xeroAccountMapping.findUnique({
      where: { organizationId_xeroAccountId: { organizationId, xeroAccountId } },
    });
    if (!mapping) throw new NotFoundException();
    if (mapping.aimsAccountId) throw new BadRequestException('Already mapped to an AIMS account');

    // Map Xero type → AIMS accountType + category + normalBalance heuristics.
    const xt = (mapping.xeroAccountType || '').toUpperCase();
    const { accountType, category, normalBalance } = this.classifyXeroType(xt);

    // Code conflict? Auto-suffix.
    let code = mapping.xeroAccountCode || `X-${xeroAccountId.slice(0, 6)}`;
    const conflict = await this.prisma.chartOfAccount.findFirst({
      where: { organizationId, code },
    });
    if (conflict) code = `${code}-XR`;

    const acct = await this.prisma.chartOfAccount.create({
      data: {
        organizationId,
        code,
        name: mapping.xeroAccountName,
        accountType,
        category,
        normalBalance,
        isActive: true,
        xeroId: xeroAccountId,
        xeroLastSyncAt: new Date(),
      },
    });
    await this.prisma.xeroAccountMapping.update({
      where: { id: mapping.id },
      data: {
        aimsAccountId: acct.id,
        aimsAccountCode: acct.code,
        source: 'CREATED',
        confirmedAt: new Date(),
      },
    });
    return acct;
  }

  // Cheap heuristic — Xero's account types map roughly onto AIMS's categories.
  private classifyXeroType(xeroType: string): { accountType: string; category: 'PNL' | 'BALANCE_SHEET'; normalBalance: 'DEBIT' | 'CREDIT' } {
    // Xero types include REVENUE, SALES, OTHERINCOME, EXPENSE, DIRECTCOSTS,
    // OVERHEADS, FIXED, CURRENT, NONCURRENT, CURRLIAB, LIABILITY, TERMLIAB,
    // EQUITY, BANK, etc.
    if (['REVENUE', 'SALES', 'OTHERINCOME'].includes(xeroType)) {
      return { accountType: xeroType === 'SALES' ? 'SALES' : 'INCOME', category: 'PNL', normalBalance: 'CREDIT' };
    }
    if (['EXPENSE', 'OVERHEADS', 'DEPRECIATN'].includes(xeroType)) {
      return { accountType: 'EXPENSE', category: 'PNL', normalBalance: 'DEBIT' };
    }
    if (['DIRECTCOSTS'].includes(xeroType)) {
      return { accountType: 'PURCHASE', category: 'PNL', normalBalance: 'DEBIT' };
    }
    if (['FIXED'].includes(xeroType)) {
      return { accountType: 'FIXED_ASSET', category: 'BALANCE_SHEET', normalBalance: 'DEBIT' };
    }
    if (['CURRENT', 'BANK', 'INVENTORY'].includes(xeroType)) {
      return { accountType: 'CURRENT_ASSET', category: 'BALANCE_SHEET', normalBalance: 'DEBIT' };
    }
    if (['CURRLIAB', 'LIABILITY', 'PAYG', 'GST'].includes(xeroType)) {
      return { accountType: 'CURRENT_LIABILITY', category: 'BALANCE_SHEET', normalBalance: 'CREDIT' };
    }
    if (['TERMLIAB'].includes(xeroType)) {
      return { accountType: 'LONG_TERM_LIABILITY', category: 'BALANCE_SHEET', normalBalance: 'CREDIT' };
    }
    if (['EQUITY'].includes(xeroType)) {
      return { accountType: 'SHARE_CAPITAL', category: 'BALANCE_SHEET', normalBalance: 'CREDIT' };
    }
    // Fallback: treat unknowns as BS asset to avoid trial-balance breakage.
    return { accountType: 'CURRENT_ASSET', category: 'BALANCE_SHEET', normalBalance: 'DEBIT' };
  }

  // ---------- LLM auto-map ----------
  //
  // For all unmapped (mapping.aimsAccountId === null) Xero accounts, ask
  // Claude to pick the best AIMS account from the chart. Sets source='AUTO'
  // with the returned confidence, but does NOT auto-confirm — user reviews.
  //
  async autoMapWithLlm(organizationId: string) {
    const apiKey = process.env.ANTHROPIC_API_KEY;
    if (!apiKey) throw new HttpException('LLM auto-map not configured', HttpStatus.SERVICE_UNAVAILABLE);

    const unmapped = await this.prisma.xeroAccountMapping.findMany({
      where: { organizationId, aimsAccountId: null },
    });
    if (unmapped.length === 0) return { suggested: 0 };

    const aimsAccounts = await this.prisma.chartOfAccount.findMany({
      where: { organizationId, isActive: true },
      select: { id: true, code: true, name: true, accountType: true, category: true },
    });
    if (aimsAccounts.length === 0) return { suggested: 0 };
    const candidateList = aimsAccounts.map((a) => `${a.code}|${a.name}|${a.accountType}|${a.category}`).join('\n');

    const client = new Anthropic({ apiKey });
    let suggested = 0;

    // Batch the Xero accounts into a single prompt so we make 1-N round trips
    // (1 if small chart, N if huge). Keep prompt under ~8k tokens.
    const BATCH = 25;
    for (let i = 0; i < unmapped.length; i += BATCH) {
      const slice = unmapped.slice(i, i + BATCH);
      const xeroList = slice
        .map((m) => `${m.xeroAccountCode || '(no code)'}|${m.xeroAccountName}|${m.xeroAccountType || '(unknown)'}`)
        .join('\n');

      const system = `You map Xero accounts to existing AIMS accounts. Output ONLY a JSON array. For each Xero account input, return:
  { "xeroCode": string (echo the input code/name to identify), "aimsCode": string (must exactly match a candidate code) or null, "confidence": 0-1, "reason": short clause }
Never invent codes. If no AIMS account fits, output aimsCode=null.`;
      const userPrompt = `Xero accounts to map (code|name|type):
${xeroList}

Candidate AIMS accounts (code|name|accountType|category):
${candidateList}

Return JSON array.`;

      let raw = '';
      try {
        const response = await client.messages.create({
          model: 'claude-sonnet-4-6',
          max_tokens: 4000,
          system,
          messages: [{ role: 'user', content: userPrompt }],
        });
        const t = response.content.find((b) => b.type === 'text');
        raw = t && 'text' in t ? (t as any).text.trim() : '';
      } catch (e: any) {
        this.logger.warn(`[autoMap] LLM call failed: ${e?.message}`);
        continue;
      }
      const match = raw.match(/\[[\s\S]*\]/);
      if (!match) continue;
      let parsed: Array<{ xeroCode: string; aimsCode: string | null; confidence: number; reason: string }>;
      try {
        parsed = JSON.parse(match[0]);
      } catch {
        continue;
      }

      const byCode = new Map(aimsAccounts.map((a) => [a.code, a]));
      for (const p of parsed) {
        if (!p.aimsCode) continue;
        const aimsAcct = byCode.get(p.aimsCode);
        if (!aimsAcct) continue;
        // Find the matching mapping row by xeroCode (or name, fallback).
        const m = slice.find(
          (m2) =>
            (m2.xeroAccountCode && m2.xeroAccountCode === p.xeroCode) ||
            m2.xeroAccountName === p.xeroCode,
        );
        if (!m) continue;
        await this.prisma.xeroAccountMapping.update({
          where: { id: m.id },
          data: {
            aimsAccountId: aimsAcct.id,
            aimsAccountCode: aimsAcct.code,
            source: 'AUTO',
            confidence: typeof p.confidence === 'number' ? Math.max(0, Math.min(1, p.confidence)) : 0.5,
            reason: p.reason,
            // Don't auto-confirm — user reviews.
          },
        });
        suggested += 1;
      }
    }

    return { suggested };
  }
}
