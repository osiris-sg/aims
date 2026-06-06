import { BadRequestException, Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../common/prisma.service';
import { JournalService } from '../journal/journal.service';
import { FixedAssetsService } from '../fixed-assets/fixed-assets.service';

// ---------------------------------------------------------------------------
// Smart Close Wizard backend. The flow:
//   1. preflight(cutOffDate) — runs a checklist of "is this safe to close?"
//      checks. Returns each item with status pass/warn/fail + details.
//   2. run({ cutOffDate, type, skipWarnings }) — re-runs preflight, refuses if
//      any fail (or any warn unless skipWarnings), then for YEAR_END posts a
//      retained-earnings rollover JE, and for both types sets
//      AccountingSetting.lockedThroughDate so future entries in that range are
//      rejected by JournalService.create.
// ---------------------------------------------------------------------------

const ROUND = (n: number) => Math.round(n * 100) / 100;

export type PreflightItem = {
  key: string;
  label: string;
  status: 'pass' | 'warn' | 'fail';
  detail?: string;
  count?: number;
  action?: { label: string; link: string };
};

export type Preflight = {
  cutOffDate: string;
  alreadyLockedThrough: string | null;
  canClose: boolean; // false if any 'fail'
  items: PreflightItem[];
};

@Injectable()
export class CloseService {
  private readonly logger = new Logger(CloseService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly journal: JournalService,
    private readonly fixedAssets: FixedAssetsService,
  ) {}

  async preflight(organizationId: string, cutOffDate: Date): Promise<Preflight> {
    const settings = await this.prisma.accountingSetting.findUnique({
      where: { organizationId },
    });
    const lockedThrough = settings?.lockedThroughDate ?? null;

    const items: PreflightItem[] = [];

    // 1. Period already partially / fully closed?
    if (lockedThrough && lockedThrough >= cutOffDate) {
      items.push({
        key: 'already-locked',
        label: 'Period already closed',
        status: 'fail',
        detail: `This org is locked through ${lockedThrough.toISOString().slice(0, 10)} — pick a later cut-off`,
      });
    } else {
      items.push({
        key: 'period-state',
        label: 'Period is open',
        status: 'pass',
        detail: lockedThrough
          ? `Previously closed through ${lockedThrough.toISOString().slice(0, 10)}`
          : 'No prior close on record',
      });
    }

    // 2. All confirmed invoices posted to GL?
    const postedInvoiceDocIds = await this.prisma.journalEntry.findMany({
      where: { organizationId, status: 'POSTED', type: 'INVOICE' },
      select: { sourceDocumentId: true },
    });
    const postedSet = new Set(postedInvoiceDocIds.map((j) => j.sourceDocumentId).filter(Boolean));
    const unpostedInvoices = await this.prisma.document.count({
      where: {
        organizationId,
        status: 'paid',
        type: { in: ['INVOICE', 'TI'] },
        createdAt: { lte: cutOffDate },
        NOT: { id: { in: Array.from(postedSet) as string[] } },
      },
    });
    items.push({
      key: 'invoices-posted',
      label: 'All confirmed invoices posted to GL',
      status: unpostedInvoices === 0 ? 'pass' : 'warn',
      count: unpostedInvoices,
      detail: unpostedInvoices === 0
        ? `All confirmed invoices through ${cutOffDate.toISOString().slice(0, 10)} have GL entries`
        : `${unpostedInvoices} confirmed invoice(s) missing GL — auto-post should have handled these`,
      action: unpostedInvoices > 0 ? { label: 'Investigate', link: '/portal/accounting/reports?tab=audit' } : undefined,
    });

    // 3. No draft journal entries in the period
    const draftEntries = await this.prisma.journalEntry.count({
      where: {
        organizationId,
        status: 'DRAFT',
        entryDate: { lte: cutOffDate },
      },
    });
    items.push({
      key: 'no-drafts',
      label: 'No draft journal entries in the period',
      status: draftEntries === 0 ? 'pass' : 'warn',
      count: draftEntries,
      detail: draftEntries === 0
        ? 'All journals dated in the period are posted or voided'
        : `${draftEntries} draft entry/entries — post or void before closing`,
      action: draftEntries > 0 ? { label: 'Review drafts', link: '/portal/accounting/reports?tab=audit' } : undefined,
    });

    // 4. All posted entries in the period are balanced
    const inPeriodEntries = await this.prisma.journalEntry.findMany({
      where: { organizationId, status: 'POSTED', entryDate: { lte: cutOffDate } },
      select: { id: true, journalNumber: true, totalDebit: true, totalCredit: true },
    });
    const unbalanced = inPeriodEntries.filter((e) => ROUND(e.totalDebit - e.totalCredit) !== 0);
    items.push({
      key: 'all-balanced',
      label: 'All posted entries are balanced',
      status: unbalanced.length === 0 ? 'pass' : 'fail',
      count: unbalanced.length,
      detail: unbalanced.length === 0
        ? 'Trial balance ties out — debits === credits across all postings'
        : `${unbalanced.length} unbalanced entry/entries — must be fixed before closing`,
      action: unbalanced.length > 0 ? { label: 'View audit trail', link: '/portal/accounting/reports?tab=audit' } : undefined,
    });

    // 5. Tax payable visible (informational — not blocking)
    if (settings?.controlAccounts) {
      const taxCode = (settings.controlAccounts as any).taxLiabilities || 'CL900';
      const tb = await this.journal.trialBalance(organizationId, cutOffDate);
      const tax = tb.rows.find((r) => r.code === taxCode)?.balance ?? 0;
      if (tax > 0) {
        items.push({
          key: 'tax-payable',
          label: `GST payable: ${tax.toFixed(2)}`,
          status: 'warn',
          detail: 'File the GST return before closing the period',
          action: { label: 'Open GST report', link: '/portal/accounting/reports?tab=gst' },
        });
      } else {
        items.push({
          key: 'tax-payable',
          label: 'No outstanding GST',
          status: 'pass',
        });
      }
    }

    // 6. Fixed asset depreciation will run on close — informational.
    const cutYear = cutOffDate.getFullYear();
    const cutMonth = cutOffDate.getMonth() + 1;
    const activeFAs = await this.prisma.fixedAsset.count({
      where: { organizationId, isActive: true },
    });
    if (activeFAs > 0) {
      const already = await this.prisma.depreciationEntry.count({
        where: { organizationId, periodYear: cutYear, periodMonth: cutMonth },
      });
      items.push({
        key: 'depreciation',
        label:
          already > 0
            ? `Depreciation already posted for ${cutYear}-${String(cutMonth).padStart(2, '0')}`
            : `Depreciation will post for ${activeFAs} active asset${activeFAs === 1 ? '' : 's'}`,
        status: 'pass',
        count: activeFAs,
        detail: already > 0 ? 'No double-posting — period entries already exist' : 'Auto-run during close',
        action: { label: 'View fixed assets', link: '/portal/accounting/fixed-assets' },
      });
    }

    const canClose = !items.some((i) => i.status === 'fail');

    return {
      cutOffDate: cutOffDate.toISOString(),
      alreadyLockedThrough: lockedThrough ? lockedThrough.toISOString() : null,
      canClose,
      items,
    };
  }

  async run(
    organizationId: string,
    opts: {
      cutOffDate: Date;
      type: 'MONTH_END' | 'YEAR_END';
      skipWarnings?: boolean;
      userId?: string;
    },
  ) {
    const { cutOffDate, type, skipWarnings, userId } = opts;

    // Re-run preflight to make sure nothing changed between UI render and click.
    const preflight = await this.preflight(organizationId, cutOffDate);
    if (!preflight.canClose) {
      throw new BadRequestException(
        `Cannot close — preflight has ${preflight.items.filter((i) => i.status === 'fail').length} blocking issue(s)`,
      );
    }
    const warnings = preflight.items.filter((i) => i.status === 'warn');
    if (warnings.length > 0 && !skipWarnings) {
      throw new BadRequestException(
        `${warnings.length} warning(s) — pass skipWarnings=true to proceed: ${warnings.map((w) => w.label).join('; ')}`,
      );
    }

    let yearEndJournalEntryId: string | null = null;
    let depreciationJournalEntryId: string | null = null;
    let depreciationAssetCount = 0;

    if (type === 'YEAR_END') {
      // Build a single rollover entry: zero out every P&L account into RTPL.
      // Net debit/credit per P&L account = its current balance (relative to its
      // normalBalance side). Posting the opposite side closes it to 0.
      const yearStart = new Date(cutOffDate.getFullYear(), 0, 1);
      const accounts = await this.prisma.chartOfAccount.findMany({
        where: { organizationId, isActive: true, category: 'PNL' },
      });
      const accountIds = accounts.map((a) => a.id);

      const lines = await this.prisma.journalEntryLine.findMany({
        where: {
          accountId: { in: accountIds },
          journalEntry: {
            organizationId,
            status: 'POSTED',
            entryDate: { gte: yearStart, lte: cutOffDate },
          },
        },
      });

      const balancesById = new Map<string, number>();
      for (const l of lines) {
        const acct = accounts.find((a) => a.id === l.accountId)!;
        const delta = acct.normalBalance === 'DEBIT' ? l.debit - l.credit : l.credit - l.debit;
        balancesById.set(acct.id, ROUND((balancesById.get(acct.id) ?? 0) + delta));
      }

      // Build closing JE: for each non-zero P&L account, post the reversing
      // side (debit if normalBalance is CREDIT, credit if DEBIT) so its
      // balance returns to zero. RTPL absorbs the net.
      const settings = await this.prisma.accountingSetting.findUnique({ where: { organizationId } });
      const rtplCode = (settings?.controlAccounts as any)?.retainedProfits || 'RTPL';
      const rtpl = await this.prisma.chartOfAccount.findFirst({
        where: { organizationId, code: rtplCode },
      });
      if (!rtpl) {
        throw new BadRequestException(
          `Retained Profit account (${rtplCode}) not found — set controlAccounts.retainedProfits in accounting setup`,
        );
      }

      const rolloverLines: Array<{ accountId: string; debit: number; credit: number; description: string }> = [];
      let netDebitOnRtpl = 0;
      for (const acct of accounts) {
        const bal = balancesById.get(acct.id) ?? 0;
        if (bal === 0) continue;
        if (acct.normalBalance === 'CREDIT') {
          // Revenue/income — close with a debit
          rolloverLines.push({
            accountId: acct.id,
            debit: bal,
            credit: 0,
            description: `Year-end close ${cutOffDate.getFullYear()} — close ${acct.code}`,
          });
          netDebitOnRtpl -= bal; // a revenue balance closing means a CREDIT to RTPL
        } else {
          // Expense — close with a credit
          rolloverLines.push({
            accountId: acct.id,
            debit: 0,
            credit: bal,
            description: `Year-end close ${cutOffDate.getFullYear()} — close ${acct.code}`,
          });
          netDebitOnRtpl += bal; // an expense balance closing means a DEBIT to RTPL
        }
      }

      // Add the RTPL balancing line.
      if (netDebitOnRtpl > 0) {
        rolloverLines.push({
          accountId: rtpl.id,
          debit: netDebitOnRtpl,
          credit: 0,
          description: `Year-end close ${cutOffDate.getFullYear()} — net loss to retained`,
        });
      } else if (netDebitOnRtpl < 0) {
        rolloverLines.push({
          accountId: rtpl.id,
          debit: 0,
          credit: -netDebitOnRtpl,
          description: `Year-end close ${cutOffDate.getFullYear()} — net profit to retained`,
        });
      }

      if (rolloverLines.length >= 2) {
        const created = await this.journal.create(
          organizationId,
          {
            entryDate: cutOffDate.toISOString().slice(0, 10),
            type: 'ADJUSTMENT',
            reference: `YE-${cutOffDate.getFullYear()}`,
            description: `Year-end close ${cutOffDate.getFullYear()}: roll P&L into retained earnings`,
            lines: rolloverLines,
          } as any,
          userId,
          // The rollover JE is dated AT the cutOffDate. The lock is applied
          // immediately AFTER this entry posts, so we bypass the guard for
          // this single call. Subsequent manual posts will be rejected.
          { bypassPeriodLock: true },
        );
        // Immediately post it — the close is the post.
        const posted = await this.journal.post(organizationId, created.id, userId);
        yearEndJournalEntryId = posted.id;
      }
    }

    // Post depreciation for the cut-off month before locking. Idempotent —
    // depreciation entries have a unique (asset, year, month) constraint, so a
    // re-run won't double-post. Best-effort: failure here gets logged but
    // doesn't block the close (user can post depreciation manually).
    try {
      const dep = await this.fixedAssets.postPeriod(organizationId, cutOffDate, userId);
      depreciationJournalEntryId = dep.journalEntryId;
      depreciationAssetCount = dep.entriesCreated;
      if (dep.posted) {
        this.logger.log(`[close] depreciation posted: ${dep.entriesCreated} asset(s), JE ${dep.journalEntryId}`);
      }
    } catch (e: any) {
      this.logger.warn(`[close] depreciation posting failed (continuing): ${e?.message}`);
    }

    // Lock the period.
    const existingSettings = await this.prisma.accountingSetting.findUnique({ where: { organizationId } });
    const history = (existingSettings?.closeHistory as any[]) || [];
    history.push({
      type,
      lockedThrough: cutOffDate.toISOString(),
      runAt: new Date().toISOString(),
      runBy: userId ?? null,
      yearEndJournalEntryId,
      depreciationJournalEntryId,
      depreciationAssetCount,
    });

    await this.prisma.accountingSetting.update({
      where: { organizationId },
      data: {
        lockedThroughDate: cutOffDate,
        closeHistory: history,
      },
    });

    return {
      success: true,
      type,
      lockedThrough: cutOffDate.toISOString(),
      yearEndJournalEntryId,
      depreciationJournalEntryId,
      depreciationAssetCount,
      preflight,
    };
  }

  async unlock(organizationId: string) {
    // Admin escape hatch — clears the lock. Doesn't reverse a YE rollover.
    await this.prisma.accountingSetting.update({
      where: { organizationId },
      data: { lockedThroughDate: null },
    });
    return { success: true };
  }
}
