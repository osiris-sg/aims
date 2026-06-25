import { BadRequestException, HttpException, HttpStatus, Injectable, Logger, NotFoundException } from '@nestjs/common';
import Anthropic from '@anthropic-ai/sdk';
import { PrismaService } from '../common/prisma.service';
import { JournalService } from '../journal/journal.service';

// ---------------------------------------------------------------------------
// Bank reconciliation engine.
//
// The flow:
//   1. User picks a bank account (a ChartOfAccount with a cash/bank code).
//   2. Uploads a CSV (with column mapping) or PDF (Claude vision extracts).
//   3. We create a BankStatementImport + BankStatementLine[] rows.
//   4. Auto-match each PENDING line against JournalEntryLine[] on the bank
//      account with same signed amount AND date within ±3 days. Exact matches
//      auto-resolve. Multiple candidates surface to the UI as "SUGGESTED".
//   5. Unmatched lines: LLM suggests a GL account ("OCBC charge" → Bank
//      Charges). User confirms → we post a new JE (Dr/Cr Bank, Cr/Dr suggested
//      account) and mark the statement line POSTED_NEW.
//
// Reconciliation summary computed on demand: ending bank balance vs GL bank
// balance + outstanding (unmatched-in-flight) items.
// ---------------------------------------------------------------------------

const ROUND = (n: number) => Math.round(n * 100) / 100;
const DAY_MS = 24 * 60 * 60 * 1000;

export type ParsedLine = {
  date: string;
  description: string;
  reference?: string;
  amount: number; // signed
  runningBalance?: number;
};

@Injectable()
export class BankRecService {
  private readonly logger = new Logger(BankRecService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly journal: JournalService,
  ) {}

  // List ChartOfAccount entries that look like bank/cash. Used by the UI's
  // account picker. Detection is delegated to JournalService.isCashOrBankAccount
  // so every cash-aware code path uses the same rule.
  async listBankAccounts(organizationId: string) {
    const all = await this.prisma.chartOfAccount.findMany({
      where: { organizationId, isActive: true, category: 'BALANCE_SHEET' },
      orderBy: { code: 'asc' },
    });
    return all.filter((a) => this.journal.isCashOrBankAccount(a));
  }

  // List imports for an account (history).
  listImports(organizationId: string, bankAccountId?: string) {
    return this.prisma.bankStatementImport.findMany({
      where: { organizationId, ...(bankAccountId && { bankAccountId }) },
      orderBy: { createdAt: 'desc' },
      include: { _count: { select: { lines: true } } },
    });
  }

  // ---------- Import: CSV with mapping ----------
  //
  // mapping = { date: 0, description: 1, amount: 2, reference?: 3, balance?: 4 }
  // amountColumn can be a single signed column OR two cols (debit / credit).
  // dateFormat is an optional strftime-ish hint; we default to JS Date parsing.
  async importCsv(
    organizationId: string,
    userId: string | undefined,
    args: {
      bankAccountId: string;
      csv: string;
      mapping: {
        date: number;
        description: number;
        amount?: number;
        debit?: number;
        credit?: number;
        reference?: number;
        balance?: number;
        // True if amounts are stored as positive numbers but the sign is
        // implied by which column is populated (debit OUT, credit IN).
        signFromColumn?: boolean;
        // CSV options
        skipRows?: number; // header rows to skip (default 1)
        delimiter?: string; // default ","
      };
      filename?: string;
    },
  ) {
    const acct = await this.prisma.chartOfAccount.findFirst({
      where: { id: args.bankAccountId, organizationId },
    });
    if (!acct) throw new NotFoundException('Bank account not found');

    const delim = args.mapping.delimiter || ',';
    const skip = args.mapping.skipRows ?? 1;
    const rows = args.csv.split(/\r?\n/).filter((l) => l.trim().length > 0);
    const data = rows.slice(skip);

    const parsed: ParsedLine[] = [];
    for (const row of data) {
      const cols = simpleCsvSplit(row, delim);
      try {
        const date = parseDateFlexible(cols[args.mapping.date]);
        const desc = cols[args.mapping.description] ?? '';
        let amount = 0;
        if (args.mapping.amount !== undefined) {
          const raw = parseFloat(cleanNumber(cols[args.mapping.amount])) || 0;
          // Treat as already-signed by default. If signFromColumn (rare with
          // a single amount column) the user can flip in mapping.
          amount = raw;
        } else if (args.mapping.debit !== undefined || args.mapping.credit !== undefined) {
          const debit = args.mapping.debit !== undefined ? parseFloat(cleanNumber(cols[args.mapping.debit])) || 0 : 0;
          const credit = args.mapping.credit !== undefined ? parseFloat(cleanNumber(cols[args.mapping.credit])) || 0 : 0;
          // Convention: credit (money IN) is +, debit (money OUT) is -.
          amount = credit - debit;
        } else {
          throw new BadRequestException('Mapping must include amount, or debit + credit columns');
        }
        const reference = args.mapping.reference !== undefined ? cols[args.mapping.reference] : undefined;
        const balance = args.mapping.balance !== undefined ? parseFloat(cleanNumber(cols[args.mapping.balance])) : undefined;
        parsed.push({ date: date.toISOString(), description: desc.trim(), reference, amount: ROUND(amount), runningBalance: balance });
      } catch {
        // Skip malformed rows (e.g. trailing blank line, footer notes).
        continue;
      }
    }

    if (parsed.length === 0) throw new BadRequestException('No valid lines parsed from CSV');

    const periodStart = new Date(parsed.reduce((min, l) => (l.date < min ? l.date : min), parsed[0].date));
    const periodEnd = new Date(parsed.reduce((max, l) => (l.date > max ? l.date : max), parsed[0].date));
    const endingBalance = parsed[parsed.length - 1]?.runningBalance;

    const imp = await this.prisma.bankStatementImport.create({
      data: {
        organizationId,
        bankAccountId: args.bankAccountId,
        source: 'CSV',
        filename: args.filename,
        periodStart,
        periodEnd,
        endingBalance,
        columnMapping: args.mapping as any,
        createdBy: userId,
        lines: {
          create: parsed.map((p) => ({
            organizationId,
            bankAccountId: args.bankAccountId,
            date: new Date(p.date),
            description: p.description,
            reference: p.reference,
            amount: p.amount,
            runningBalance: p.runningBalance ?? null,
          })),
        },
      },
      include: { lines: true },
    });

    // Kick off auto-match. Best-effort — caller can re-run via endpoint.
    await this.autoMatch(organizationId, imp.id);
    return imp;
  }

  // ---------- Import: PDF via Claude vision ----------
  async importPdf(
    organizationId: string,
    userId: string | undefined,
    args: { bankAccountId: string; base64: string; mediaType?: 'application/pdf' | 'image/jpeg' | 'image/png'; filename?: string },
  ) {
    const apiKey = process.env.ANTHROPIC_API_KEY;
    if (!apiKey) throw new HttpException('PDF extraction not configured (missing ANTHROPIC_API_KEY)', HttpStatus.SERVICE_UNAVAILABLE);

    const acct = await this.prisma.chartOfAccount.findFirst({
      where: { id: args.bankAccountId, organizationId },
    });
    if (!acct) throw new NotFoundException('Bank account not found');

    const commaIdx = args.base64.indexOf(',');
    const headerMatch = args.base64.match(/^data:([a-zA-Z/+]+);base64,/);
    const data = commaIdx >= 0 && headerMatch ? args.base64.slice(commaIdx + 1) : args.base64;
    const detectedMedia = (headerMatch?.[1] as any) ?? args.mediaType ?? 'application/pdf';

    const client = new Anthropic({ apiKey });
    const system = `You are extracting transactions from a bank statement. Output ONLY a JSON object with:
  - "endingBalance": number or null
  - "lines": [{ "date": "YYYY-MM-DD", "description": string, "amount": signed number (credit=positive, debit=negative), "reference": string|null, "runningBalance": number|null }]
Skip header/footer and balance-brought-forward rows. Use null when unsure. No prose.`;

    const content: any[] = [];
    if (detectedMedia === 'application/pdf') {
      content.push({ type: 'document', source: { type: 'base64', media_type: 'application/pdf', data } });
    } else {
      content.push({ type: 'image', source: { type: 'base64', media_type: detectedMedia, data } });
    }
    content.push({ type: 'text', text: 'Extract transactions per the system schema.' });

    const response = await client.messages.create({
      model: 'claude-sonnet-4-6',
      max_tokens: 8000,
      system,
      messages: [{ role: 'user', content }],
    });
    const text = response.content.find((b) => b.type === 'text');
    const raw = text && 'text' in text ? (text as any).text.trim() : '';
    const match = raw.match(/\{[\s\S]*\}/);
    if (!match) throw new BadRequestException("Couldn't parse statement — extraction returned no JSON");

    let parsed: { endingBalance?: number; lines: any[] };
    try {
      parsed = JSON.parse(match[0]);
    } catch {
      throw new BadRequestException('Extraction returned malformed JSON');
    }
    const lines: ParsedLine[] = (parsed.lines || [])
      .filter((l) => l && l.date && typeof l.amount === 'number')
      .map((l) => ({
        date: new Date(l.date).toISOString(),
        description: l.description || '',
        reference: l.reference || undefined,
        amount: ROUND(l.amount),
        runningBalance: typeof l.runningBalance === 'number' ? l.runningBalance : undefined,
      }));

    if (lines.length === 0) throw new BadRequestException('Extraction produced no transactions');

    const periodStart = new Date(lines.reduce((min, l) => (l.date < min ? l.date : min), lines[0].date));
    const periodEnd = new Date(lines.reduce((max, l) => (l.date > max ? l.date : max), lines[0].date));

    const imp = await this.prisma.bankStatementImport.create({
      data: {
        organizationId,
        bankAccountId: args.bankAccountId,
        source: 'PDF',
        filename: args.filename,
        periodStart,
        periodEnd,
        endingBalance: parsed.endingBalance ?? lines[lines.length - 1]?.runningBalance ?? null,
        createdBy: userId,
        lines: {
          create: lines.map((p) => ({
            organizationId,
            bankAccountId: args.bankAccountId,
            date: new Date(p.date),
            description: p.description,
            reference: p.reference,
            amount: p.amount,
            runningBalance: p.runningBalance ?? null,
          })),
        },
      },
      include: { lines: true },
    });
    await this.autoMatch(organizationId, imp.id);
    return imp;
  }

  // Get an import with its lines and (for matched lines) the JE line they're matched to.
  async getImport(organizationId: string, importId: string) {
    const imp = await this.prisma.bankStatementImport.findFirst({
      where: { id: importId, organizationId },
      include: { lines: { orderBy: { date: 'asc' } } },
    });
    if (!imp) throw new NotFoundException('Import not found');

    // Enrich with matched JE info per line.
    const matchedIds = imp.lines.map((l) => l.matchedJournalLineId).filter(Boolean) as string[];
    const matched =
      matchedIds.length > 0
        ? await this.prisma.journalEntryLine.findMany({
            where: { id: { in: matchedIds } },
            include: { journalEntry: { select: { id: true, journalNumber: true, entryDate: true, type: true } } },
          })
        : [];
    const matchedById = new Map(matched.map((m) => [m.id, m]));

    return {
      ...imp,
      lines: imp.lines.map((l) => ({
        ...l,
        matchedJournalLine: l.matchedJournalLineId ? matchedById.get(l.matchedJournalLineId) ?? null : null,
      })),
    };
  }

  // ---------- Auto-match ----------
  // For each PENDING line, find candidate JE lines on this bank account whose
  // amount matches (signed) and date is within ±3 days. Single candidate →
  // MATCHED. Multiple → first one wins (UI shows the alternatives via
  // suggested-matches endpoint). Zero → stays PENDING.
  async autoMatch(organizationId: string, importId: string) {
    const imp = await this.prisma.bankStatementImport.findFirst({
      where: { id: importId, organizationId },
      include: { lines: { where: { status: 'PENDING' } } },
    });
    if (!imp) throw new NotFoundException('Import not found');

    // Pull JE lines on this bank account within the import window ± buffer.
    const fromDate = new Date((imp.periodStart ?? imp.createdAt).getTime() - 7 * DAY_MS);
    const toDate = new Date((imp.periodEnd ?? imp.createdAt).getTime() + 7 * DAY_MS);

    const jeLines = await this.prisma.journalEntryLine.findMany({
      where: {
        accountId: imp.bankAccountId,
        journalEntry: { organizationId, status: 'POSTED', entryDate: { gte: fromDate, lte: toDate } },
      },
      include: { journalEntry: { select: { entryDate: true, reference: true } } },
    });

    // Exclude JE lines already matched by a different statement line in this org.
    const alreadyMatched = await this.prisma.bankStatementLine.findMany({
      where: { organizationId, matchedJournalLineId: { not: null } },
      select: { matchedJournalLineId: true },
    });
    const taken = new Set(alreadyMatched.map((r) => r.matchedJournalLineId!));

    let matchedCount = 0;
    for (const line of imp.lines) {
      // Bank credit (+) = Dr Cash → journal entry's bank line has positive debit.
      // Bank debit  (-) = Cr Cash → journal entry's bank line has positive credit.
      const wantDebit = line.amount > 0 ? Math.abs(line.amount) : 0;
      const wantCredit = line.amount < 0 ? Math.abs(line.amount) : 0;

      const candidates = jeLines.filter((j) => {
        if (taken.has(j.id)) return false;
        if (Math.abs(ROUND(j.debit) - wantDebit) > 0.005) return false;
        if (Math.abs(ROUND(j.credit) - wantCredit) > 0.005) return false;
        const diffMs = Math.abs(j.journalEntry.entryDate.getTime() - line.date.getTime());
        return diffMs <= 3 * DAY_MS;
      });

      if (candidates.length === 0) continue;
      // Exact single match → confirm. Multiple → still pick the closest by
      // date (deterministic) but flag in description so user can override.
      const winner = candidates.sort(
        (a, b) =>
          Math.abs(a.journalEntry.entryDate.getTime() - line.date.getTime()) -
          Math.abs(b.journalEntry.entryDate.getTime() - line.date.getTime()),
      )[0];

      await this.prisma.bankStatementLine.update({
        where: { id: line.id },
        data: {
          status: 'MATCHED',
          matchedJournalLineId: winner.id,
          matchedAt: new Date(),
        },
      });
      taken.add(winner.id);
      matchedCount += 1;
    }

    return { importId, matchedCount, totalPending: imp.lines.length };
  }

  // Manual match: user picked a JE line for a statement line.
  async manualMatch(organizationId: string, lineId: string, journalLineId: string, userId?: string) {
    const line = await this.prisma.bankStatementLine.findFirst({ where: { id: lineId, organizationId } });
    if (!line) throw new NotFoundException('Statement line not found');
    if (line.status !== 'PENDING') throw new BadRequestException(`Line is ${line.status} — unmatch first`);

    const jeLine = await this.prisma.journalEntryLine.findFirst({
      where: { id: journalLineId, accountId: line.bankAccountId },
    });
    if (!jeLine) throw new BadRequestException('JE line not on this bank account');

    return this.prisma.bankStatementLine.update({
      where: { id: lineId },
      data: {
        status: 'MATCHED',
        matchedJournalLineId: journalLineId,
        matchedAt: new Date(),
        matchedBy: userId,
      },
    });
  }

  async unmatch(organizationId: string, lineId: string) {
    const line = await this.prisma.bankStatementLine.findFirst({ where: { id: lineId, organizationId } });
    if (!line) throw new NotFoundException();
    return this.prisma.bankStatementLine.update({
      where: { id: lineId },
      data: { status: 'PENDING', matchedJournalLineId: null, matchedAt: null, matchedBy: null },
    });
  }

  async ignore(organizationId: string, lineId: string) {
    const line = await this.prisma.bankStatementLine.findFirst({ where: { id: lineId, organizationId } });
    if (!line) throw new NotFoundException();
    return this.prisma.bankStatementLine.update({ where: { id: lineId }, data: { status: 'IGNORED' } });
  }

  // ---------- LLM suggest GL account for unmatched ----------
  async suggestAccount(organizationId: string, lineId: string) {
    const apiKey = process.env.ANTHROPIC_API_KEY;
    const line = await this.prisma.bankStatementLine.findFirst({ where: { id: lineId, organizationId } });
    if (!line) throw new NotFoundException();

    if (!apiKey) {
      // No LLM → return null suggestion, UI falls back to manual picker.
      return { line, suggestion: null };
    }

    // Candidate accounts: P&L (revenue + expense) for bank-side categorization.
    const accounts = await this.prisma.chartOfAccount.findMany({
      where: { organizationId, isActive: true, category: 'PNL' },
      select: { id: true, code: true, name: true, accountType: true },
    });
    if (accounts.length === 0) return { line, suggestion: null };

    const candidateList = accounts.map((a) => `${a.code}|${a.name}|${a.accountType}`).join('\n');
    const direction = line.amount > 0 ? 'income (money received)' : 'expense (money paid)';
    const client = new Anthropic({ apiKey });
    const system = `Pick the best GL account for a bank statement line. Output ONLY JSON: { "code": string from list, "confidence": 0-1, "reason": short clause }. If nothing fits, output {"code": null}. Never invent codes.`;
    const userPrompt = `Bank line: ${line.description}\nReference: ${line.reference ?? '(none)'}\nAmount: ${line.amount} (${direction})\n\nCandidate accounts (code|name|type):\n${candidateList}\n\nReturn JSON.`;

    let raw = '';
    try {
      const response = await client.messages.create({
        model: 'claude-sonnet-4-6',
        max_tokens: 250,
        system,
        messages: [{ role: 'user', content: userPrompt }],
      });
      const t = response.content.find((b) => b.type === 'text');
      raw = t && 'text' in t ? (t as any).text.trim() : '';
    } catch (e: any) {
      this.logger.warn(`[suggest] LLM call failed: ${e?.message}`);
      return { line, suggestion: null };
    }

    const m = raw.match(/\{[\s\S]*\}/);
    if (!m) return { line, suggestion: null };
    let parsed: { code?: string | null; confidence?: number; reason?: string };
    try {
      parsed = JSON.parse(m[0]);
    } catch {
      return { line, suggestion: null };
    }
    if (!parsed.code) return { line, suggestion: null };
    const acct = accounts.find((a) => a.code === parsed.code);
    if (!acct) return { line, suggestion: null };

    // Persist the suggestion so the UI can show it without re-querying.
    await this.prisma.bankStatementLine.update({
      where: { id: lineId },
      data: {
        suggestedAccountId: acct.id,
        suggestionConfidence: typeof parsed.confidence === 'number' ? Math.max(0, Math.min(1, parsed.confidence)) : 0.5,
        suggestionReason: parsed.reason ?? '',
      },
    });

    return {
      line,
      suggestion: {
        accountId: acct.id,
        code: acct.code,
        name: acct.name,
        confidence: parsed.confidence ?? 0.5,
        reason: parsed.reason ?? '',
      },
    };
  }

  // ---------- Post-as-new: turn an unmatched bank line into a new JE ----------
  async postAsNewEntry(
    organizationId: string,
    lineId: string,
    args: { contraAccountId: string; description?: string },
    userId?: string,
  ) {
    const line = await this.prisma.bankStatementLine.findFirst({ where: { id: lineId, organizationId } });
    if (!line) throw new NotFoundException();
    if (line.status !== 'PENDING') throw new BadRequestException(`Line is ${line.status}`);

    const contra = await this.prisma.chartOfAccount.findFirst({
      where: { id: args.contraAccountId, organizationId, isActive: true },
    });
    if (!contra) throw new BadRequestException('Contra account not found / inactive');

    const desc = args.description || line.description;
    const isInflow = line.amount > 0; // money INTO bank account
    const abs = Math.abs(line.amount);

    const jeLines = isInflow
      ? [
          { accountId: line.bankAccountId, debit: abs, credit: 0, description: desc },
          { accountId: contra.id, debit: 0, credit: abs, description: desc },
        ]
      : [
          { accountId: contra.id, debit: abs, credit: 0, description: desc },
          { accountId: line.bankAccountId, debit: 0, credit: abs, description: desc },
        ];

    const entry = await this.journal.create(
      organizationId,
      {
        entryDate: line.date.toISOString(),
        type: 'MANUAL',
        reference: line.reference ?? undefined,
        description: `Bank rec: ${desc}`.slice(0, 200),
        lines: jeLines,
      },
      userId,
    );
    const posted = await this.journal.post(organizationId, entry.id, userId);

    // Find the bank-side JE line we just created so we can self-link it as the "match".
    const bankJeLine = await this.prisma.journalEntryLine.findFirst({
      where: { journalEntryId: posted.id, accountId: line.bankAccountId },
    });

    return this.prisma.bankStatementLine.update({
      where: { id: lineId },
      data: {
        status: 'POSTED_NEW',
        matchedJournalLineId: bankJeLine?.id ?? null,
        matchedAt: new Date(),
        matchedBy: userId,
        postedJournalEntryId: posted.id,
      },
    });
  }

  // ---------- Reconciliation summary for one import ----------
  async reconciliation(organizationId: string, importId: string) {
    const imp = await this.getImport(organizationId, importId);
    const matchedTotal = imp.lines
      .filter((l) => l.status === 'MATCHED' || l.status === 'POSTED_NEW')
      .reduce((s, l) => s + l.amount, 0);
    const pendingTotal = imp.lines.filter((l) => l.status === 'PENDING').reduce((s, l) => s + l.amount, 0);

    // GL balance for this bank account up to period end.
    const lines = await this.prisma.journalEntryLine.findMany({
      where: {
        accountId: imp.bankAccountId,
        journalEntry: {
          organizationId,
          status: 'POSTED',
          ...(imp.periodEnd && { entryDate: { lte: imp.periodEnd } }),
        },
      },
    });
    const glBalance = ROUND(lines.reduce((s, l) => s + l.debit - l.credit, 0));

    return {
      importId,
      bankAccountId: imp.bankAccountId,
      periodStart: imp.periodStart,
      periodEnd: imp.periodEnd,
      bankEndingBalance: imp.endingBalance ?? null,
      glBalance,
      matchedCount: imp.lines.filter((l) => l.status === 'MATCHED').length,
      postedNewCount: imp.lines.filter((l) => l.status === 'POSTED_NEW').length,
      pendingCount: imp.lines.filter((l) => l.status === 'PENDING').length,
      ignoredCount: imp.lines.filter((l) => l.status === 'IGNORED').length,
      matchedTotal: ROUND(matchedTotal),
      pendingTotal: ROUND(pendingTotal),
      reconciles:
        imp.endingBalance !== null && imp.endingBalance !== undefined
          ? Math.abs(glBalance - imp.endingBalance + pendingTotal) < 0.01
          : null,
      diff:
        imp.endingBalance !== null && imp.endingBalance !== undefined
          ? ROUND(imp.endingBalance - glBalance - pendingTotal)
          : null,
    };
  }

  async deleteImport(organizationId: string, importId: string) {
    const imp = await this.prisma.bankStatementImport.findFirst({ where: { id: importId, organizationId } });
    if (!imp) throw new NotFoundException();
    // Only allow delete if no POSTED_NEW lines (those created GL entries).
    const posted = await this.prisma.bankStatementLine.count({
      where: { importId, status: 'POSTED_NEW' },
    });
    if (posted > 0) {
      throw new BadRequestException(
        `Can't delete — ${posted} line(s) already created GL entries. Void those JEs first.`,
      );
    }
    return this.prisma.bankStatementImport.delete({ where: { id: importId } });
  }
}

// ---------- helpers ----------

function simpleCsvSplit(line: string, delim: string): string[] {
  // Minimal CSV splitter handling quoted fields with embedded delimiters.
  const out: string[] = [];
  let cur = '';
  let inQuote = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (ch === '"') {
      if (inQuote && line[i + 1] === '"') {
        cur += '"';
        i++;
      } else {
        inQuote = !inQuote;
      }
    } else if (ch === delim && !inQuote) {
      out.push(cur);
      cur = '';
    } else {
      cur += ch;
    }
  }
  out.push(cur);
  return out.map((s) => s.trim());
}

function cleanNumber(s: string | undefined): string {
  if (!s) return '0';
  // Strip currency symbols, commas, parentheses (treat parens as negative).
  let v = s.replace(/[$,£€\s]/g, '');
  if (v.startsWith('(') && v.endsWith(')')) v = '-' + v.slice(1, -1);
  return v;
}

function parseDateFlexible(s: string | undefined): Date {
  if (!s) throw new Error('Empty date');
  // Try ISO first.
  let d = new Date(s);
  if (!isNaN(d.getTime())) return d;
  // Try DD/MM/YYYY or DD-MM-YYYY (SG / UK convention)
  const m = s.match(/^(\d{1,2})[/-](\d{1,2})[/-](\d{2,4})$/);
  if (m) {
    let year = parseInt(m[3], 10);
    if (year < 100) year += 2000;
    d = new Date(year, parseInt(m[2], 10) - 1, parseInt(m[1], 10));
    if (!isNaN(d.getTime())) return d;
  }
  throw new Error(`Unparseable date: ${s}`);
}
