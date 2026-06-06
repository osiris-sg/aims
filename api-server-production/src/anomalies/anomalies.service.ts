import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../common/prisma.service';

// ---------------------------------------------------------------------------
// Deterministic anomaly checks the Finance Hub surfaces as Action Queue items.
// Each detector is a focused query, intentionally cheap to keep hub load
// snappy (sub-200ms target). If any one gets slow, hoist it out to a nightly
// cron and cache the result.
// ---------------------------------------------------------------------------

const ROUND = (n: number) => Math.round(n * 100) / 100;
const DAY_MS = 24 * 60 * 60 * 1000;

export type AnomalyFinding = {
  severity: 'info' | 'warning' | 'error';
  title: string;
  detail?: string;
  count?: number;
  link?: string;
};

@Injectable()
export class AnomaliesService {
  private readonly logger = new Logger(AnomaliesService.name);

  constructor(private readonly prisma: PrismaService) {}

  // Run all detectors and merge into one feed. Detectors that fail (bad data,
  // schema drift, etc.) log + skip — never crash the hub.
  async runAll(organizationId: string, now: Date = new Date()): Promise<AnomalyFinding[]> {
    const results = await Promise.allSettled([
      this.detectDuplicateInvoices(organizationId),
      this.detectStaleDrafts(organizationId, now),
      this.detectMissingTax(organizationId),
      this.detectUnusualJournalAmounts(organizationId),
      this.detectStaleUnpostedJournals(organizationId, now),
    ]);

    const findings: AnomalyFinding[] = [];
    for (const [i, r] of results.entries()) {
      if (r.status === 'fulfilled') {
        findings.push(...r.value);
      } else {
        this.logger.warn(`Anomaly detector #${i} failed: ${r.reason?.message || r.reason}`);
      }
    }
    return findings;
  }

  // --------- 1. Duplicate invoices ---------
  // Same customer + same gross amount within 14 days. Catches accidental
  // double-entry from imports or the "I forgot I already posted that" pattern.
  private async detectDuplicateInvoices(organizationId: string): Promise<AnomalyFinding[]> {
    // Pull recent posted invoice journal entries; group by amount + reference.
    const since = new Date(Date.now() - 14 * DAY_MS);
    const entries = await this.prisma.journalEntry.findMany({
      where: {
        organizationId,
        status: 'POSTED',
        type: 'INVOICE',
        entryDate: { gte: since },
      },
      select: {
        id: true,
        journalNumber: true,
        entryDate: true,
        totalDebit: true,
        reference: true,
        description: true,
      },
    });

    // Bucket by rounded-gross + description-first-word (proxy for customer).
    const buckets = new Map<string, typeof entries>();
    for (const e of entries) {
      const amt = ROUND(e.totalDebit);
      if (amt <= 0) continue;
      const partyHint = (e.description || '').split(/[—–-]/)[1]?.trim().toLowerCase() ?? '';
      const key = `${amt}|${partyHint}`;
      const list = buckets.get(key) ?? [];
      list.push(e);
      buckets.set(key, list);
    }

    const duplicates = Array.from(buckets.values()).filter((list) => list.length > 1);
    if (duplicates.length === 0) return [];

    const totalDup = duplicates.reduce((s, list) => s + list.length, 0);
    return [
      {
        severity: 'warning',
        title: `${duplicates.length} possible duplicate invoice ${duplicates.length === 1 ? 'group' : 'groups'} in the last 14 days`,
        detail: `${totalDup} entries grouped by same amount + customer hint — review and void any genuine duplicates`,
        count: duplicates.length,
        link: '/portal/accounting/reports?tab=audit',
      },
    ];
  }

  // --------- 2. Stale draft documents ---------
  // Drafts older than 30 days are usually forgotten. Surfaces them so the user
  // can either post or delete.
  private async detectStaleDrafts(organizationId: string, now: Date): Promise<AnomalyFinding[]> {
    const cutoff = new Date(now.getTime() - 30 * DAY_MS);
    const count = await this.prisma.document.count({
      where: {
        organizationId,
        status: 'draft',
        createdAt: { lt: cutoff },
      },
    });
    if (count === 0) return [];
    return [
      {
        severity: 'info',
        title: `${count} draft document${count === 1 ? '' : 's'} older than 30 days`,
        detail: 'Forgotten drafts inflate the document list — confirm or delete',
        count,
        link: '/portal/documents',
      },
    ];
  }

  // --------- 3. Missing tax on invoices ---------
  // When the org has a non-zero tax rate but recent invoice journals have no
  // tax line, that's often a wrong tax code on a line item.
  private async detectMissingTax(organizationId: string): Promise<AnomalyFinding[]> {
    const org = await this.prisma.organization.findUnique({
      where: { id: organizationId },
      select: { taxRate: true },
    });
    if (!org?.taxRate || org.taxRate <= 0) return [];

    const since = new Date(Date.now() - 30 * DAY_MS);

    // Find posted invoices in the last 30 days whose journal entry has no line
    // touching a tax-coded account (heuristic: account code starts with CL9 or TX).
    const entries = await this.prisma.journalEntry.findMany({
      where: {
        organizationId,
        status: 'POSTED',
        type: 'INVOICE',
        entryDate: { gte: since },
      },
      include: { lines: { include: { account: true } } },
    });

    const missing = entries.filter(
      (e) =>
        !e.lines.some(
          (l) => /^CL9/.test(l.account.code) || /^TX/.test(l.account.code) || l.account.accountType === 'TAX_LIABILITY',
        ),
    );

    if (missing.length === 0) return [];
    return [
      {
        severity: 'warning',
        title: `${missing.length} recent invoice${missing.length === 1 ? '' : 's'} posted without tax`,
        detail: `Org tax rate is ${org.taxRate}% — these may be missing GST. Spot-check.`,
        count: missing.length,
        link: '/portal/accounting/reports?tab=audit',
      },
    ];
  }

  // --------- 4. Unusual amount per account ---------
  // For each P&L expense/revenue account, flag the most recent line whose
  // amount is >3x the account's average historical line amount. Cheap
  // outlier check that catches typos like 100000 instead of 1000.
  private async detectUnusualJournalAmounts(organizationId: string): Promise<AnomalyFinding[]> {
    // Cap work: only inspect lines from the last 60 days, only on P&L accounts.
    const since = new Date(Date.now() - 60 * DAY_MS);
    const recentLines = await this.prisma.journalEntryLine.findMany({
      where: {
        journalEntry: {
          organizationId,
          status: 'POSTED',
          entryDate: { gte: since },
        },
        account: { category: 'PNL' },
      },
      include: {
        account: { select: { id: true, code: true, name: true, accountType: true } },
        journalEntry: { select: { entryDate: true, journalNumber: true, description: true } },
      },
    });

    // Group by account, find lines that are >5x median of the account's amounts.
    const byAccount = new Map<string, typeof recentLines>();
    for (const l of recentLines) {
      const list = byAccount.get(l.account.id) ?? [];
      list.push(l);
      byAccount.set(l.account.id, list);
    }

    const outliers: AnomalyFinding[] = [];
    for (const list of byAccount.values()) {
      if (list.length < 5) continue; // not enough history to call anything "unusual"
      const amts = list.map((l) => Math.max(l.debit, l.credit)).filter((a) => a > 0).sort((a, b) => a - b);
      const median = amts[Math.floor(amts.length / 2)] || 1;
      const threshold = median * 5;
      const worst = list
        .map((l) => ({ line: l, amt: Math.max(l.debit, l.credit) }))
        .filter((x) => x.amt > threshold)
        .sort((a, b) => b.amt - a.amt)[0];

      if (worst) {
        outliers.push({
          severity: 'info',
          title: `Unusual ${worst.line.account.code} amount: ${ROUND(worst.amt).toFixed(2)}`,
          detail: `${worst.line.account.name} — median is ${ROUND(median).toFixed(2)} over the last 60 days. Entry ${worst.line.journalEntry.journalNumber}.`,
          link: '/portal/accounting/reports?tab=audit',
        });
      }
    }

    // Cap to top 3 outlier accounts to avoid spamming the queue.
    return outliers.slice(0, 3);
  }

  // --------- 5. Stale unposted journals ---------
  // Drafts more than 7 days old should either be posted or voided. The
  // hub already counts draft entries; this adds an alert when they're stale.
  private async detectStaleUnpostedJournals(
    organizationId: string,
    now: Date,
  ): Promise<AnomalyFinding[]> {
    const cutoff = new Date(now.getTime() - 7 * DAY_MS);
    const count = await this.prisma.journalEntry.count({
      where: {
        organizationId,
        status: 'DRAFT',
        createdAt: { lt: cutoff },
      },
    });
    if (count === 0) return [];
    return [
      {
        severity: 'warning',
        title: `${count} draft journal entr${count === 1 ? 'y has' : 'ies have'} been sitting >7 days`,
        detail: 'Long-lived drafts mean the books are missing real activity. Post or void them.',
        count,
        link: '/portal/accounting/reports?tab=audit',
      },
    ];
  }
}
