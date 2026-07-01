import { BadRequestException, Injectable } from '@nestjs/common';
import { PrismaService } from '../common/prisma.service';
import { ChartOfAccountsService } from '../accounting/chart-of-accounts.service';
import { AccountMemoryService } from '../account-memory/account-memory.service';

const ROUND = (n: number) => Math.round(n * 100) / 100;
const EPS = 0.005;

// Line descriptions can carry rich-text HTML (e.g. "<b>Jurong Port Pass
// Application</b><ul><li>…</li></ul>"). Strip it to plain text so the AI reads
// the real content and the preview dialog shows clean text.
function stripHtml(s?: string | null): string {
  return (s || '')
    .replace(/<\s*br\s*\/?>/gi, ' ')
    .replace(/<\/(p|div|li|ul|ol)>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/gi, "'")
    .replace(/\s+/g, ' ')
    .trim();
}

export type PreviewLine = {
  role: 'receivable' | 'payable' | 'line' | 'tax';
  lineIndex?: number;
  accountId: string | null;
  accountCode: string | null;
  accountName: string | null;
  debit: number;
  credit: number;
  description: string;
  source: 'existing' | 'ai' | 'learned' | 'fallback' | 'control';
  confidence?: number;
  reason?: string;
};

export type PreviewResult = {
  lines: PreviewLine[];
  totalDebit: number;
  totalCredit: number;
  balanced: boolean;
  warnings: string[];
};

export type PreviewDto = {
  type: string;
  // A line's current account may be given by id (bills) or by code (invoices).
  lines?: Array<{ description?: string; amount?: number; accountId?: string | null; accountCode?: string | null }>;
  taxAmount?: number;
  totalAmount?: number;
  documentNumber?: string;
};

/**
 * Builds an AI-suggested journal-entry preview for a document WITHOUT posting.
 * Mirrors the document→GL auto-post shapes (see journal-auto-post.service) but
 * asks the categorization AI to pick the per-line revenue/expense account, and
 * returns an editable preview the user confirms before posting.
 *
 * Bills have their own preview in bills.service (predates this). This service
 * is the generalized home for the rest — invoice is implemented; the remaining
 * posting types (CN / DN / PO / PR) slot into the switch below.
 */
@Injectable()
export class PostingPreviewService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly coa: ChartOfAccountsService,
    private readonly memory: AccountMemoryService,
  ) {}

  /** Record accountant corrections so future lines get coded the same way. */
  async learn(organizationId: string, side: string, corrections: Array<{ text?: string; accountCode?: string; accountId?: string | null }>) {
    const saved = await this.memory.record(organizationId, side, corrections);
    return { saved };
  }

  private async getControls(organizationId: string): Promise<Record<string, string>> {
    const s = await this.prisma.accountingSetting.findUnique({ where: { organizationId } });
    return ((s?.controlAccounts as Record<string, string>) || {}) as Record<string, string>;
  }

  private resolveByCode(organizationId: string, code?: string | null) {
    if (!code) return Promise.resolve(null);
    return this.prisma.chartOfAccount.findFirst({
      where: { organizationId, code, isActive: true },
      select: { id: true, code: true, name: true },
    });
  }

  private firstOfType(organizationId: string, accountType: string) {
    return this.prisma.chartOfAccount.findFirst({
      where: { organizationId, accountType, isActive: true },
      orderBy: { code: 'asc' },
      select: { id: true, code: true, name: true },
    });
  }

  async preview(organizationId: string, dto: PreviewDto): Promise<PreviewResult> {
    const type = (dto.type || '').toUpperCase();
    switch (type) {
      case 'INVOICE':
      case 'TI':
      case 'TI2':
      case 'DEBIT_NOTE':
      case 'DN':
        return this.previewSalesSide(organizationId, dto);
      default:
        throw new BadRequestException(`Posting preview not yet supported for document type "${dto.type}"`);
    }
  }

  // Sales side (invoice / debit note): Dr Accounts Receivable (gross) /
  // Cr Revenue per line (AI-suggested SALES/INCOME account) / Cr GST.
  private async previewSalesSide(organizationId: string, dto: PreviewDto): Promise<PreviewResult> {
    const warnings: string[] = [];
    const docLines = Array.isArray(dto.lines) ? dto.lines : [];
    const tax = ROUND(dto.taxAmount || 0);
    const docNo = dto.documentNumber || '';

    const controls = await this.getControls(organizationId);
    const debtorCode = controls.debtorControl || 'CA001';
    const taxCode = controls.taxLiabilities || 'CL900';

    const [debtor, taxAccount, fallbackSales] = await Promise.all([
      this.resolveByCode(organizationId, debtorCode),
      tax > 0 ? this.resolveByCode(organizationId, taxCode) : Promise.resolve(null),
      this.firstOfType(organizationId, 'SALES').then((s) => s || this.firstOfType(organizationId, 'INCOME')),
    ]);

    if (!debtor) warnings.push(`Accounts Receivable control (${debtorCode}) not found — set it in Accounting Setup.`);
    if (tax > 0 && !taxAccount) warnings.push(`Tax account (${taxCode}) not found — GST line is unassigned.`);

    // Suggest an account for lines without one (by id or code). Learned
    // corrections (accountant memory) win; only the still-unresolved go to the AI.
    const needIdx = docLines.map((l, i) => ({ l, i })).filter(({ l }) => !l.accountId && !l.accountCode);
    const suggestions: Array<{ accountId: string | null; code: string; name: string; confidence: number; reason: string; source: 'learned' | 'ai' } | null> =
      docLines.map(() => null);
    if (needIdx.length > 0) {
      const learned = await this.memory.resolveBatch(organizationId, 'SALES', needIdx.map(({ l }) => stripHtml(l.description)));
      const stillNeed: Array<{ l: any; i: number }> = [];
      needIdx.forEach((ni, k) => {
        if (learned[k]) suggestions[ni.i] = { accountId: learned[k]!.accountId, code: learned[k]!.code, name: learned[k]!.name, confidence: learned[k]!.confidence, reason: learned[k]!.reason, source: 'learned' };
        else stillNeed.push(ni);
      });
      if (stillNeed.length > 0) {
        const batch = await this.coa.suggestAccountsBatch(organizationId, stillNeed.map(({ l }) => stripHtml(l.description)), ['SALES', 'INCOME']);
        stillNeed.forEach(({ i }, k) => {
          if (batch[k]) suggestions[i] = { ...batch[k]!, source: 'ai' };
        });
      }
    }

    const out: PreviewLine[] = [];

    let sumLines = 0;
    for (const l of docLines) sumLines += ROUND(l.amount || 0);
    const gross = ROUND(dto.totalAmount != null ? dto.totalAmount : sumLines + tax);

    // Dr Accounts Receivable (control) — shown first.
    out.push({
      role: 'receivable',
      accountId: debtor?.id ?? null,
      accountCode: debtor?.code ?? null,
      accountName: debtor?.name ?? null,
      debit: gross,
      credit: 0,
      description: `Invoice ${docNo} — Accounts Receivable`.trim(),
      source: 'control',
    });

    // Cr Revenue per line.
    let sumCredit = 0;
    for (const [i, l] of docLines.entries()) {
      const amt = ROUND(l.amount || 0);
      sumCredit += amt;
      const desc = stripHtml(l.description) || `Invoice ${docNo}`.trim();
      if (l.accountId || l.accountCode) {
        const a = await this.prisma.chartOfAccount.findFirst({
          where: { organizationId, ...(l.accountId ? { id: l.accountId } : { code: l.accountCode as string }) },
          select: { id: true, code: true, name: true },
        });
        out.push({ role: 'line', lineIndex: i, accountId: a?.id ?? null, accountCode: a?.code ?? null, accountName: a?.name ?? null, debit: 0, credit: amt, description: desc, source: 'existing' });
      } else if (suggestions[i]) {
        const s = suggestions[i]!;
        out.push({ role: 'line', lineIndex: i, accountId: s.accountId, accountCode: s.code, accountName: s.name, debit: 0, credit: amt, description: desc, source: s.source, confidence: s.confidence, reason: s.reason });
      } else if (fallbackSales) {
        out.push({ role: 'line', lineIndex: i, accountId: fallbackSales.id, accountCode: fallbackSales.code, accountName: fallbackSales.name, debit: 0, credit: amt, description: desc, source: 'fallback', reason: 'Default sales account (no AI suggestion)' });
      } else {
        warnings.push(`Line ${i + 1}: no revenue account could be resolved.`);
        out.push({ role: 'line', lineIndex: i, accountId: null, accountCode: null, accountName: null, debit: 0, credit: amt, description: desc, source: 'fallback' });
      }
    }

    // Cr GST (control).
    if (tax > 0) {
      sumCredit += tax;
      out.push({ role: 'tax', accountId: taxAccount?.id ?? null, accountCode: taxAccount?.code ?? null, accountName: taxAccount?.name ?? null, debit: 0, credit: tax, description: `Output GST — ${docNo}`.trim(), source: 'control' });
    }

    const totalDebit = gross;
    const totalCredit = ROUND(sumCredit);
    const balanced = Math.abs(totalDebit - totalCredit) < EPS;
    if (!balanced) {
      warnings.push(`Entry is out of balance: Dr ${totalDebit.toFixed(2)} vs Cr ${totalCredit.toFixed(2)}. Check that line amounts + tax equal the invoice total.`);
    }

    return { lines: out, totalDebit, totalCredit, balanced, warnings };
  }
}
