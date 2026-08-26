import { BadRequestException, HttpException, HttpStatus, Injectable, Logger, NotFoundException } from '@nestjs/common';
import Anthropic from '@anthropic-ai/sdk';
import { PrismaService } from '../common/prisma.service';
import { JournalService } from '../journal/journal.service';
import { AuditService } from '../common/audit.service';

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
    private readonly auditService: AuditService,
  ) {}

  // Reconciliation actions are audit-trail material (guru 2026-08-27: a match
  // left no trace in the audit log). Fire-and-forget — never blocks the action.
  private logRec(organizationId: string, userId: string | undefined, action: string, resourceName: string, detail: string, resourceId?: string) {
    void this.auditService
      .logAction({ userId: userId || 'system', action, resource: 'bank-rec', resourceId, resourceName, organizationId, details: { detail } })
      .catch(() => undefined);
  }

  private lineLabel(line: { description?: string | null; amount?: any; date?: Date | null }): string {
    const amt = Number(line.amount ?? 0);
    return `${(line.description || '').slice(0, 80)} (${amt.toFixed(2)})`;
  }

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
    this.logRec(organizationId, userId, 'IMPORT_CREATED', `CSV import (${parsed.length} lines)`, `Bank statement imported from CSV`, imp.id);
    return imp;
  }

  // ---------- Import: PDF via Claude vision ----------
  // Kick off a PDF import: creates the import row PROCESSING and returns
  // immediately — extraction + auto-match continue server-side, so the user
  // can leave or refresh the page (guru 2026-08-03). The row flips to READY
  // or FAILED (with error) when done; the UI polls.
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

    const imp = await this.prisma.bankStatementImport.create({
      data: {
        organizationId,
        bankAccountId: args.bankAccountId,
        source: 'PDF',
        filename: args.filename,
        status: 'PROCESSING',
        createdBy: userId,
      },
    });
    void this.runPdfExtraction(imp.id, organizationId, args).catch(async (e) => {
      this.logger.error(`[importPdf] background extraction failed for ${imp.id}: ${e?.message || e}`);
      await this.prisma.bankStatementImport
        .update({ where: { id: imp.id }, data: { status: 'FAILED', error: e?.message || 'Extraction failed' } })
        .catch(() => undefined);
    });
    this.logRec(organizationId, userId, 'IMPORT_CREATED', args.filename || 'PDF import', 'Bank statement uploaded (PDF, extracting)', imp.id);
    return imp;
  }

  private async runPdfExtraction(
    importId: string,
    organizationId: string,
    args: { bankAccountId: string; base64: string; mediaType?: 'application/pdf' | 'image/jpeg' | 'image/png'; filename?: string },
  ) {
    const apiKey = process.env.ANTHROPIC_API_KEY!;
    const commaIdx = args.base64.indexOf(',');
    const headerMatch = args.base64.match(/^data:([a-zA-Z/+]+);base64,/);
    const data = commaIdx >= 0 && headerMatch ? args.base64.slice(commaIdx + 1) : args.base64;
    const detectedMedia = (headerMatch?.[1] as any) ?? args.mediaType ?? 'application/pdf';

    const client = new Anthropic({ apiKey });
    const system = `You are extracting transactions from a bank statement. Output ONLY a JSON object with:
  - "endingBalance": number or null
  - "lines": [{ "date": "YYYY-MM-DD", "description": string, "amount": signed number (credit=positive, debit=negative), "reference": string|null, "runningBalance": number|null }]
Skip header/footer and balance-brought-forward rows. Use null when unsure. No prose.
Output STRICT JSON only — never emit the token undefined, no trailing commas, no code fences. Keep each description SHORT (max ~12 words).`;

    const content: any[] = [];
    if (detectedMedia === 'application/pdf') {
      content.push({ type: 'document', source: { type: 'base64', media_type: 'application/pdf', data } });
    } else {
      content.push({ type: 'image', source: { type: 'base64', media_type: detectedMedia, data } });
    }
    content.push({ type: 'text', text: 'Extract transactions per the system schema.' });

    // 8k tokens truncated real month-statements mid-array (guru hit this on
    // an SCB May-2026 statement, 2026-08-03) — give the model headroom. The
    // SDK requires streaming at this max_tokens; finalMessage() collects it.
    const response = await client.messages
      .stream({
        model: 'claude-sonnet-4-6',
        max_tokens: 32000,
        system,
        messages: [{ role: 'user', content }],
      })
      .finalMessage();
    const text = response.content.find((b) => b.type === 'text');
    const raw = text && 'text' in text ? (text as any).text.trim() : '';
    const match = raw.match(/\{[\s\S]*\}?/);
    if (!match) throw new BadRequestException("Couldn't parse statement — extraction returned no JSON");

    // Same LLM-JSON sanitize as the other extraction paths: bare undefined
    // values → null, trailing commas stripped.
    const sanitized = match[0]
      .replace(/:\s*undefined\s*([,}\]])/g, ': null$1')
      .replace(/,\s*([}\]])/g, '$1');

    // If the output STILL hit max_tokens the array is cut mid-object —
    // salvage every complete line instead of failing the whole import.
    const salvageTruncated = (str: string): any | null => {
      let idx = str.lastIndexOf('}');
      for (let tries = 0; idx > 0 && tries < 500; tries++, idx = str.lastIndexOf('}', idx - 1)) {
        const base = str.slice(0, idx + 1);
        for (const tail of [']}', '}', '']) {
          try {
            const p = JSON.parse(base + tail);
            if (p && Array.isArray(p.lines)) return p;
          } catch {
            /* keep walking back */
          }
        }
      }
      return null;
    };

    let parsed: { endingBalance?: number; lines: any[] };
    try {
      parsed = JSON.parse(sanitized);
    } catch {
      const salvaged = salvageTruncated(sanitized);
      if (!salvaged) throw new BadRequestException('Extraction returned malformed JSON');
      if (response.stop_reason === 'max_tokens') {
        this.logger.warn(`[importPdf] output hit max_tokens — salvaged ${salvaged.lines?.length ?? 0} complete lines from a truncated statement`);
      }
      parsed = salvaged;
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

    await this.prisma.bankStatementImport.update({
      where: { id: importId },
      data: {
        periodStart,
        periodEnd,
        endingBalance: parsed.endingBalance ?? lines[lines.length - 1]?.runningBalance ?? null,
        status: 'READY',
        error: null,
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
    });
    await this.autoMatch(organizationId, importId);
  }

  // Get an import with its lines and (for matched lines) the JE line they're matched to.
  async getImport(organizationId: string, importId: string) {
    const imp = await this.prisma.bankStatementImport.findFirst({
      where: { id: importId, organizationId },
      include: { lines: { orderBy: { date: 'asc' } } },
    });
    if (!imp) throw new NotFoundException('Import not found');

    // Enrich with matched JE info per line (single FK + batch match rows).
    const matchRows = await this.prisma.bankStatementMatch.findMany({
      where: { lineId: { in: imp.lines.map((l) => l.id) } },
      select: { lineId: true, journalLineId: true },
    });
    const matchesByLine = new Map<string, string[]>();
    for (const m of matchRows) matchesByLine.set(m.lineId, [...(matchesByLine.get(m.lineId) || []), m.journalLineId]);
    const matchedIds = [
      ...new Set([
        ...(imp.lines.map((l) => l.matchedJournalLineId).filter(Boolean) as string[]),
        ...matchRows.map((m) => m.journalLineId),
      ]),
    ];
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
      lines: imp.lines.map((l) => {
        const multi = (matchesByLine.get(l.id) || []).map((id) => matchedById.get(id)).filter(Boolean);
        return {
          ...l,
          matchedJournalLine: l.matchedJournalLineId ? matchedById.get(l.matchedJournalLineId) ?? null : multi[0] ?? null,
          // Batch matches: all journal lines this statement line settles.
          matchedJournalLines: multi.length ? multi : l.matchedJournalLineId ? [matchedById.get(l.matchedJournalLineId)].filter(Boolean) : [],
        };
      }),
    };
  }

  // ---------- Auto-match ----------
  // For each PENDING line, find candidate JE lines on this bank account whose
  // amount matches (signed) and date is within ±3 days. Single candidate →
  // MATCHED. Multiple → first one wins (UI shows the alternatives via
  // suggested-matches endpoint). Zero → stays PENDING.
  // Every journal line already claimed by any statement line (legacy single
  // FK + the match table).
  private async takenJournalLineIds(organizationId: string): Promise<Set<string>> {
    const [legacy, rows] = await Promise.all([
      this.prisma.bankStatementLine.findMany({
        where: { organizationId, matchedJournalLineId: { not: null } },
        select: { matchedJournalLineId: true },
      }),
      this.prisma.bankStatementMatch.findMany({ where: { organizationId }, select: { journalLineId: true } }),
    ]);
    return new Set([...legacy.map((r) => r.matchedJournalLineId!), ...rows.map((r) => r.journalLineId)]);
  }

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
      include: { journalEntry: { select: { id: true, entryDate: true, reference: true } } },
    });

    // Exclude JE lines already claimed anywhere (single FK or match rows).
    const taken = await this.takenJournalLineIds(organizationId);

    let matchedCount = 0;
    let batchMatched = 0;
    const stillPending: typeof imp.lines = [];
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

      if (candidates.length === 0) {
        stillPending.push(line);
        continue;
      }
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
          matches: { create: { organizationId, journalLineId: winner.id } },
        },
      });
      taken.add(winner.id);
      matchedCount += 1;
    }

    // ---- Phase 2: BATCH payments (guru 2026-08-03) — one statement line
    // settling SEVERAL journal lines (e.g. a customer paying 4 invoices in
    // one transfer). Subset-sum over open same-side JE lines near the date.
    const findCombo = (cands: Array<{ id: string; amt: number }>, target: number): string[] | null => {
      const sorted = [...cands].sort((a, b) => b.amt - a.amt).slice(0, 40);
      const n = sorted.length;
      const suffix: number[] = new Array(n + 1).fill(0);
      for (let i = n - 1; i >= 0; i--) suffix[i] = suffix[i + 1] + sorted[i].amt;
      const pick: string[] = [];
      const dfs = (i: number, remaining: number, len: number): boolean => {
        if (Math.abs(remaining) < 0.005) return len >= 2;
        if (i >= n || len >= 8 || remaining < -0.005) return false;
        if (suffix[i] < remaining - 0.005) return false; // can't reach target
        pick.push(sorted[i].id);
        if (dfs(i + 1, ROUND(remaining - sorted[i].amt), len + 1)) return true;
        pick.pop();
        return dfs(i + 1, remaining, len);
      };
      return dfs(0, ROUND(target), 0) ? [...pick] : null;
    };

    // Counterparty guard (guru 2026-08-03 — amount-only subset sums produced
    // nonsense batches like insurance premiums "settled" by transport bills):
    // a batch must be journals of ONE contact whose name appears in the bank
    // narrative. Journals with no known contact are never auto-batched.
    const entryIdsForContacts = [...new Set(jeLines.map((j) => j.journalEntry.id))];
    const [bpRows, payRows] = await Promise.all([
      this.prisma.billPayment.findMany({
        where: { journalEntryId: { in: entryIdsForContacts } },
        include: { supplier: { select: { name: true } } },
      }),
      this.prisma.payment.findMany({
        where: { journalEntryId: { in: entryIdsForContacts } } as any,
        include: { customer: { select: { name: true } } } as any,
      }),
    ]);
    const contactByEntry = new Map<string, string>();
    for (const b of bpRows) if (b.journalEntryId && b.supplier?.name) contactByEntry.set(b.journalEntryId, b.supplier.name);
    for (const pr of payRows as any[]) if (pr.journalEntryId && pr.customer?.name) contactByEntry.set(pr.journalEntryId, pr.customer.name);
    const normTokens = (x: string) =>
      x.toLowerCase().replace(/[^a-z0-9 ]/g, ' ').split(/\s+/).filter((w) => w.length >= 4 && !['received', 'from', 'fast', 'clearing', 'swift'].includes(w));
    const contactInDesc = (contact: string, desc: string) => {
      const d = desc.toLowerCase();
      return normTokens(contact).some((tok) => d.includes(tok));
    };

    for (const line of stillPending) {
      const target = Math.abs(line.amount);
      const contactGroups = new Map<string, Array<{ id: string; amt: number }>>();
      for (const j of jeLines) {
        if (taken.has(j.id)) continue;
        const amt = line.amount > 0 ? j.debit : j.credit;
        if (!(amt > 0)) continue;
        if (amt - target > 0.005) continue;
        const diffMs = Math.abs(j.journalEntry.entryDate.getTime() - line.date.getTime());
        if (diffMs > 14 * DAY_MS) continue;
        const contact = contactByEntry.get(j.journalEntry.id);
        if (!contact) continue; // unknown counterparty → never auto-batch
        if (!contactInDesc(contact, line.description || '')) continue; // must appear in the narrative
        contactGroups.set(contact, [...(contactGroups.get(contact) || []), { id: j.id, amt: ROUND(amt) }]);
      }
      let combo: string[] | null = null;
      for (const [, cands] of contactGroups) {
        if (cands.length < 2) continue;
        combo = findCombo(cands, target);
        if (combo) break;
      }
      if (!combo) continue;
      await this.prisma.bankStatementLine.update({
        where: { id: line.id },
        data: {
          // Batch finds are SUGGESTIONS (guru 2026-08-03): they reserve the
          // journals but need a human Confirm before counting as matched.
          status: 'SUGGESTED',
          matchedJournalLineId: null, // multi — the match rows are authoritative
          matchedAt: new Date(),
          matches: { create: combo.map((journalLineId) => ({ organizationId, journalLineId })) },
        },
      });
      combo.forEach((id) => taken.add(id));
      batchMatched += 1;
    }

    this.logRec(organizationId, undefined, 'AUTO_MATCH', `Import ${importId.slice(0, 8)}`, `Auto-match: ${matchedCount + batchMatched} of ${imp.lines.length} pending lines matched (${batchMatched} batch)`, importId);
    return { importId, matchedCount: matchedCount + batchMatched, batchMatched, totalPending: imp.lines.length };
  }

  // Manual match: user picked a JE line for a statement line.
  // One OR MANY journal lines (batch payments) per statement line.
  async manualMatch(organizationId: string, lineId: string, journalLineIds: string | string[], userId?: string) {
    const ids = (Array.isArray(journalLineIds) ? journalLineIds : [journalLineIds]).filter(Boolean);
    if (!ids.length) throw new BadRequestException('Pick at least one journal line');
    const line = await this.prisma.bankStatementLine.findFirst({ where: { id: lineId, organizationId } });
    if (!line) throw new NotFoundException('Statement line not found');
    if (line.status !== 'PENDING') throw new BadRequestException(`Line is ${line.status} — unmatch first`);

    const jeLines = await this.prisma.journalEntryLine.findMany({
      where: { id: { in: ids }, accountId: line.bankAccountId },
    });
    if (jeLines.length !== ids.length) throw new BadRequestException('Some journal lines are not on this bank account');
    const taken = await this.takenJournalLineIds(organizationId);
    if (ids.some((id) => taken.has(id))) throw new BadRequestException('One of the journal lines is already matched to another statement line');

    const updated = await this.prisma.bankStatementLine.update({
      where: { id: lineId },
      data: {
        status: 'MATCHED',
        matchedJournalLineId: ids.length === 1 ? ids[0] : null,
        matchedAt: new Date(),
        matchedBy: userId,
        matches: { create: ids.map((journalLineId) => ({ organizationId, journalLineId, createdBy: userId })) },
      },
    });
    this.logRec(organizationId, userId, 'MATCHED', this.lineLabel(line), `Statement line matched to ${ids.length} journal line${ids.length === 1 ? '' : 's'}`, lineId);
    return updated;
  }

  // Human confirmation of an AI-suggested batch match.
  async confirmMatch(organizationId: string, lineId: string, userId?: string) {
    const line = await this.prisma.bankStatementLine.findFirst({ where: { id: lineId, organizationId } });
    if (!line) throw new NotFoundException();
    if (line.status !== 'SUGGESTED') throw new BadRequestException(`Line is ${line.status} — only SUGGESTED lines need confirming`);
    const updated = await this.prisma.bankStatementLine.update({
      where: { id: lineId },
      data: { status: 'MATCHED', matchedBy: userId, matchedAt: new Date() },
    });
    this.logRec(organizationId, userId, 'MATCH_CONFIRMED', this.lineLabel(line), 'Suggested batch match confirmed', lineId);
    return updated;
  }

  async unmatch(organizationId: string, lineId: string, userId?: string) {
    const line = await this.prisma.bankStatementLine.findFirst({ where: { id: lineId, organizationId } });
    if (!line) throw new NotFoundException();
    await this.prisma.bankStatementMatch.deleteMany({ where: { lineId, organizationId } });
    const updated = await this.prisma.bankStatementLine.update({
      where: { id: lineId },
      data: { status: 'PENDING', matchedJournalLineId: null, matchedAt: null, matchedBy: null },
    });
    this.logRec(organizationId, userId, 'UNMATCHED', this.lineLabel(line), `Match removed (was ${line.status})`, lineId);
    return updated;
  }

  async ignore(organizationId: string, lineId: string, userId?: string) {
    const line = await this.prisma.bankStatementLine.findFirst({ where: { id: lineId, organizationId } });
    if (!line) throw new NotFoundException();
    const updated = await this.prisma.bankStatementLine.update({ where: { id: lineId }, data: { status: 'IGNORED' } });
    this.logRec(organizationId, userId, 'IGNORED', this.lineLabel(line), 'Statement line ignored', lineId);
    return updated;
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

    const updatedLine = await this.prisma.bankStatementLine.update({
      where: { id: lineId },
      data: {
        status: 'POSTED_NEW',
        matchedJournalLineId: bankJeLine?.id ?? null,
        matchedAt: new Date(),
        matchedBy: userId,
        postedJournalEntryId: posted.id,
      },
    });
    this.logRec(organizationId, userId, 'POSTED_NEW', this.lineLabel(line), `Posted as new entry ${posted.journalNumber} (contra ${contra.code})`, lineId);
    return updatedLine;
  }

  // ---------- Reconciliation summary for one import ----------
  async reconciliation(organizationId: string, importId: string) {
    const imp = await this.getImport(organizationId, importId);
    const matchedTotal = imp.lines
      .filter((l) => l.status === 'MATCHED' || l.status === 'POSTED_NEW' || l.status === 'SUGGESTED')
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
      suggestedCount: imp.lines.filter((l) => l.status === 'SUGGESTED').length,
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

  // "Reconciled transaction details" (guru 2026-08-03, Xero concept): what a
  // matched statement line reconciled to, in business terms — the journal
  // (with its double-entry lines) plus the source document / bill payment and
  // contact behind it, so the user can verify the AI match at a glance.
  async lineDetail(organizationId: string, lineId: string) {
    const line = await this.prisma.bankStatementLine.findFirst({ where: { id: lineId, organizationId } });
    if (!line) throw new NotFoundException('Statement line not found');

    // All matched journal lines (batch payments have several).
    const matchRows = await this.prisma.bankStatementMatch.findMany({ where: { lineId, organizationId }, select: { journalLineId: true } });
    const matchedLineIds = matchRows.length
      ? matchRows.map((m) => m.journalLineId)
      : line.matchedJournalLineId
      ? [line.matchedJournalLineId]
      : [];
    let entryIds: string[] = [];
    if (matchedLineIds.length) {
      const jls = await this.prisma.journalEntryLine.findMany({
        where: { id: { in: matchedLineIds } },
        select: { journalEntryId: true },
      });
      entryIds = [...new Set(jls.map((j) => j.journalEntryId))];
    } else if (line.postedJournalEntryId) {
      entryIds = [line.postedJournalEntryId];
    }
    if (!entryIds.length) return { line, entry: null, entries: [], document: null, billPayment: null };
    const entryId = entryIds[0];
    const matchedLineIdSet = new Set(matchedLineIds);

    // Build the enriched view for EACH journal the line settles (batch
    // payments have several — the dialog lists them all).
    const buildEntry = async (id: string) => {
      const entry = await this.prisma.journalEntry.findFirst({
        where: { id, organizationId },
        include: {
          lines: {
            include: { account: { select: { code: true, name: true } } },
            orderBy: { lineNumber: 'asc' },
          },
        },
      });
      if (!entry) return null;

      let document: any = null;
      if (entry.sourceDocumentId) {
        const doc = await this.prisma.document.findFirst({
          where: { id: entry.sourceDocumentId, organizationId },
          select: { id: true, name: true, type: true, documentTemplateId: true, config: true },
        });
        if (doc) {
          const c: any = doc.config || {};
          let contactName: string | null = c.customerName || c.supplierName || c.customer?.name || null;
          if (!contactName && c.customerId) {
            contactName = (await this.prisma.customer.findFirst({ where: { id: c.customerId }, select: { name: true } }))?.name ?? null;
          }
          if (!contactName && c.supplierId) {
            contactName = (await this.prisma.supplier.findFirst({ where: { id: c.supplierId }, select: { name: true } }))?.name ?? null;
          }
          document = {
            id: doc.id,
            name: doc.name,
            type: doc.type,
            templateId: doc.documentTemplateId,
            contactName,
            total: c.grossTotal ?? c.totalAmount ?? c.receiptAmount ?? null,
          };
        }
      }

      // Supplier payments: the BillPayment row (P/V) links by journalEntryId.
      const bp = await this.prisma.billPayment.findFirst({
        where: { journalEntryId: entry.id },
        include: { supplier: { select: { name: true } } },
      });
      const billDoc = bp
        ? await this.prisma.document.findFirst({ where: { id: bp.billId }, select: { name: true } })
        : null;
      // Customer receipts: the Payment row links by journalEntryId (Xero
      // backfill 2026-08-03) — gives the customer + settled invoice.
      const custPay = !bp
        ? await this.prisma.payment.findFirst({
            where: { journalEntryId: entry.id } as any,
            include: { customer: { select: { name: true } }, document: { select: { name: true } } } as any,
          })
        : null;

      return {
        entry: {
          id: entry.id,
          journalNumber: entry.journalNumber,
          entryDate: entry.entryDate,
          type: entry.type,
          reference: entry.reference,
          description: entry.description,
          status: entry.status,
          isUnconfirmed: (entry as any).isUnconfirmed ?? false,
          lines: entry.lines.map((l) => ({
            accountCode: l.account?.code,
            accountName: l.account?.name,
            description: l.description,
            debit: l.debit,
            credit: l.credit,
            isMatchedLine: matchedLineIdSet.has(l.id),
          })),
        },
        document,
        billPayment: bp
          ? { id: bp.id, billNumber: billDoc?.name || null, supplierName: bp.supplier?.name || null, amount: bp.amount, paymentDate: bp.paymentDate, reference: bp.reference }
          : null,
        customerPayment: custPay
          ? {
              id: (custPay as any).id,
              invoiceNumber: (custPay as any).document?.name || null,
              customerName: (custPay as any).customer?.name || null,
              amount: (custPay as any).amount,
              paymentDate: (custPay as any).paymentDate,
              reference: (custPay as any).reference,
            }
          : null,
      };
    };

    const entries = (await Promise.all(entryIds.map((id) => buildEntry(id)))).filter(Boolean) as any[];
    const first = entries[0] || { entry: null, document: null, billPayment: null };
    return {
      line,
      // Back-compat single fields + the full list for batch matches.
      entry: first.entry,
      document: first.document,
      billPayment: first.billPayment,
      entries,
    };
  }

  // Candidates for MANUAL matching (guru 2026-08-03): every unmatched journal
  // line on the bank account near the statement date, enriched with the
  // business identity behind it — OR / P/V reference, source document and
  // contact — so the accountant has ref + amount + customer to find the match.
  async matchCandidates(organizationId: string, lineId: string, search?: string) {
    const line = await this.prisma.bankStatementLine.findFirst({ where: { id: lineId, organizationId } });
    if (!line) throw new NotFoundException('Statement line not found');

    const windowDays = search ? 3650 : 90; // searching widens to "everything"
    const fromDate = new Date(line.date.getTime() - windowDays * DAY_MS);
    const toDate = new Date(line.date.getTime() + windowDays * DAY_MS);

    const taken = await this.takenJournalLineIds(organizationId);
    // Which statement line claimed each journal line — taken candidates stay
    // VISIBLE (flagged), because hiding them made correct candidates vanish
    // when a wrong match claimed them first (guru 2026-08-03, Allink case).
    const takenByLine = new Map<string, string>();
    const claimRows = await this.prisma.bankStatementMatch.findMany({
      where: { organizationId },
      select: { journalLineId: true, line: { select: { description: true, date: true, amount: true } } },
    });
    for (const c of claimRows) {
      takenByLine.set(c.journalLineId, `${c.line.date.toISOString().slice(0, 10)} · ${(c.line.description || '').slice(0, 40)} · ${c.line.amount}`);
    }
    const legacyClaims = await this.prisma.bankStatementLine.findMany({
      where: { organizationId, matchedJournalLineId: { not: null } },
      select: { matchedJournalLineId: true, description: true, date: true, amount: true },
    });
    for (const c of legacyClaims) {
      if (!takenByLine.has(c.matchedJournalLineId!)) {
        takenByLine.set(c.matchedJournalLineId!, `${c.date.toISOString().slice(0, 10)} · ${(c.description || '').slice(0, 40)} · ${c.amount}`);
      }
    }

    const jls = await this.prisma.journalEntryLine.findMany({
      where: {
        accountId: line.bankAccountId,
        journalEntry: { organizationId, status: 'POSTED', entryDate: { gte: fromDate, lte: toDate } },
      },
      include: {
        journalEntry: {
          select: { id: true, journalNumber: true, entryDate: true, reference: true, description: true, type: true, sourceDocumentId: true },
        },
      },
    });
    const open = jls; // taken ones included, flagged below

    // Batch-enrich: source documents + bill payments behind the journals.
    const docIds = [...new Set(open.map((j) => j.journalEntry.sourceDocumentId).filter(Boolean))] as string[];
    const docs = docIds.length
      ? await this.prisma.document.findMany({ where: { id: { in: docIds } }, select: { id: true, name: true, type: true, config: true } })
      : [];
    const docById = new Map(docs.map((d) => [d.id, d]));
    const entryIds = [...new Set(open.map((j) => j.journalEntry.id))];
    const bps = entryIds.length
      ? await this.prisma.billPayment.findMany({
          where: { journalEntryId: { in: entryIds } },
          include: { supplier: { select: { name: true } } },
        })
      : [];
    const bpByEntry = new Map(bps.map((b) => [b.journalEntryId as string, b]));
    const custPays = entryIds.length
      ? await this.prisma.payment.findMany({
          where: { journalEntryId: { in: entryIds } } as any,
          include: { customer: { select: { name: true } }, document: { select: { name: true } } } as any,
        })
      : [];
    const cpByEntry = new Map((custPays as any[]).map((p) => [p.journalEntryId as string, p]));

    const wantDebit = line.amount > 0; // bank money-in matches JE debit on the bank account
    const term = (search || '').trim().toLowerCase();

    const shaped = open
      .map((j) => {
        const je = j.journalEntry;
        const doc: any = je.sourceDocumentId ? docById.get(je.sourceDocumentId) : null;
        const cfg: any = doc?.config || {};
        const bp = bpByEntry.get(je.id);
        const cp: any = cpByEntry.get(je.id);
        const contactName =
          cfg.customerName || cfg.supplierName || cfg.customer?.name || bp?.supplier?.name || cp?.customer?.name || null;
        const amount = j.debit > 0 ? j.debit : j.credit;
        return {
          takenBy: taken.has(j.id) ? takenByLine.get(j.id) || 'another statement line' : null,
          journalLineId: j.id,
          journalNumber: je.journalNumber,
          entryDate: je.entryDate,
          reference: je.reference,
          description: j.description || je.description,
          debit: j.debit,
          credit: j.credit,
          sideMatches: wantDebit ? j.debit > 0 : j.credit > 0,
          amountMatches: Math.abs(amount - Math.abs(line.amount)) < 0.005,
          docType: doc?.type || (bp ? 'SUPPLIER_PAYMENT' : cp ? 'CUSTOMER_RECEIPT' : null),
          docName: doc?.name || cp?.document?.name || null,
          contactName,
          dateDiffDays: Math.round(Math.abs(je.entryDate.getTime() - line.date.getTime()) / DAY_MS),
        };
      })
      .filter((c) => {
        if (!term) return true;
        return [c.reference, c.description, c.journalNumber, c.docName, c.contactName, String(c.debit || ''), String(c.credit || '')]
          .some((v) => String(v ?? '').toLowerCase().includes(term));
      })
      // Rank: right side + exact amount first, then amount match, then date proximity.
      .sort((a, b) => {
        const score = (x: typeof a) => (x.takenBy ? 4 : 0) + (x.sideMatches && x.amountMatches ? 0 : x.amountMatches ? 1 : x.sideMatches ? 2 : 3);
        return score(a) - score(b) || a.dateDiffDays - b.dateDiffDays;
      })
      .slice(0, 120);

    return { line, candidates: shaped };
  }

  // Manual ending-balance override for imports whose statement carried no
  // running-balance column — without it "Reconciles?" can only say n/a.
  async setEndingBalance(organizationId: string, importId: string, endingBalance: number | null) {
    const imp = await this.prisma.bankStatementImport.findFirst({ where: { id: importId, organizationId } });
    if (!imp) throw new NotFoundException();
    const updated = await this.prisma.bankStatementImport.update({
      where: { id: importId },
      data: { endingBalance },
    });
    this.logRec(organizationId, undefined, 'ENDING_BALANCE_SET', `Import ${importId.slice(0, 8)}`, endingBalance === null ? 'Ending balance cleared' : `Ending balance set to ${endingBalance.toFixed(2)}`, importId);
    return updated;
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
    const deleted = await this.prisma.bankStatementImport.delete({ where: { id: importId } });
    this.logRec(organizationId, undefined, 'IMPORT_DELETED', imp.filename || `Import ${importId.slice(0, 8)}`, 'Bank statement import deleted', importId);
    return deleted;
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
