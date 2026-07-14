import { HttpException, HttpStatus, Injectable, Logger } from '@nestjs/common';
import Anthropic from '@anthropic-ai/sdk';
import { JournalService } from '../journal/journal.service';
import { ChartOfAccountsService } from '../accounting/chart-of-accounts.service';
import { PrismaService } from '../common/prisma.service';

// ---------------------------------------------------------------------------
// Conversational accounting agent. The frontend "Ask" bar POSTs a question
// here; we run a Claude tool-call loop that exposes the journal/accounting
// report methods as callable tools. Returns a natural-language answer plus
// optional structured attachments (KPI cards, tables, links) the UI can
// render inline.
// ---------------------------------------------------------------------------

type Attachment =
  | { type: 'kpi'; label: string; value: string; sub?: string }
  | { type: 'table'; title?: string; columns: string[]; rows: Array<Array<string | number>> }
  | { type: 'link'; href: string; label: string };

export type AskResult = {
  answer: string;
  attachments: Attachment[];
  toolCalls: Array<{ name: string; input: any }>; // for transparency / debugging
};

const MODEL = 'claude-sonnet-4-6';
const MAX_ITERATIONS = 6; // hard cap on tool-call loop to bound cost

@Injectable()
export class AskService {
  private readonly logger = new Logger(AskService.name);

  constructor(
    private readonly journal: JournalService,
    private readonly accounts: ChartOfAccountsService,
    private readonly prisma: PrismaService,
  ) {}

  async ask(organizationId: string, question: string, history?: Array<{ role: 'user' | 'assistant'; content: string }>): Promise<AskResult> {
    const apiKey = process.env.ANTHROPIC_API_KEY;
    if (!apiKey) {
      throw new HttpException(
        'Ask is not configured (missing ANTHROPIC_API_KEY)',
        HttpStatus.SERVICE_UNAVAILABLE,
      );
    }

    const client = new Anthropic({ apiKey });
    const tools = this.buildTools();
    const toolCalls: Array<{ name: string; input: any }> = [];
    const attachments: Attachment[] = [];

    const systemPrompt = this.buildSystemPrompt();

    const messages: Anthropic.MessageParam[] = [
      ...(history || []).map((m) => ({ role: m.role, content: m.content })),
      { role: 'user', content: question },
    ];

    let iteration = 0;
    let finalText = '';

    while (iteration < MAX_ITERATIONS) {
      iteration += 1;

      const response = await client.messages.create({
        model: MODEL,
        max_tokens: 2048,
        system: systemPrompt,
        tools,
        messages,
      });

      // Collect any text the model produced this turn.
      const textBlocks = response.content.filter((b) => b.type === 'text');
      const toolUseBlocks = response.content.filter((b) => b.type === 'tool_use');

      if (textBlocks.length) {
        finalText = textBlocks.map((b) => (b as any).text).join('\n');
      }

      if (response.stop_reason !== 'tool_use' || toolUseBlocks.length === 0) {
        break;
      }

      // Echo the assistant turn (text + tool_use) back into history.
      messages.push({ role: 'assistant', content: response.content });

      // Run each requested tool and accumulate tool_result blocks for next turn.
      const toolResults: Anthropic.ToolResultBlockParam[] = [];
      for (const block of toolUseBlocks) {
        const tu = block as Anthropic.ToolUseBlock;
        toolCalls.push({ name: tu.name, input: tu.input });

        try {
          const result = await this.runTool(organizationId, tu.name, tu.input as any, attachments);
          toolResults.push({
            type: 'tool_result',
            tool_use_id: tu.id,
            content: JSON.stringify(result).slice(0, 100_000), // safety cap
          });
        } catch (e: any) {
          this.logger.error(`Tool ${tu.name} failed: ${e?.message || e}`);
          toolResults.push({
            type: 'tool_result',
            tool_use_id: tu.id,
            content: `Error: ${e?.message || 'tool failed'}`,
            is_error: true,
          });
        }
      }

      messages.push({ role: 'user', content: toolResults });
    }

    return {
      answer: finalText || 'No response.',
      attachments,
      toolCalls,
    };
  }

  private buildSystemPrompt(): string {
    return `You are an accounting assistant for the AIMS platform. Today is ${new Date().toISOString().slice(0, 10)}.

You can answer both high-level questions (P&L, balance sheet, trial balance, GST, net profit, cash) AND detailed receivables/payables/invoice questions. For "who owes me", "aged receivables", "AR/AP by customer/supplier", "unpaid/overdue invoices", or "how much does X owe", use get_aged_receivables / get_aged_payables / list_invoices / get_customer_statement — these read the actual invoices and bills (with per-invoice balances tied to Xero), not just the GL.

When answering financial questions:
- Call tools to get real numbers. Never make up figures.
- Cite specific amounts with 2-decimal precision and the org's base currency.
- Keep prose concise (1-3 sentences). Use tools' data, not prose, for tables.
- If a question is ambiguous about period, default to the current month or year-to-date and say which you used.
- When listing transactions/accounts, return data via the 'show_table' final-output tool so the UI can render it.
- When highlighting a single key number, use 'show_kpi'.
- When the answer points to a full report page, use 'show_link' so the user can drill in.
- If the question isn't accounting-related or can't be answered with available tools, say so plainly.
- The user may attach PDFs or images (supplier statements, bank statements, invoices, receipts). Read them carefully and, when useful, cross-check their figures against the ledger using your tools (e.g. compare a supplier statement to aged payables, or a bank statement to the bank account ledger). Point out any discrepancies you find.`;
  }

  // Streaming variant: emits SSE-style events so the UI can narrate the agent's
  // steps ("Reading receivables…") and stream the answer live. Event shapes:
  //   { type: 'status', tool }        — a tool is about to run
  //   { type: 'text', delta }         — a chunk of the answer
  //   { type: 'attachment', attachment } — a KPI card / table / link to render
  //   { type: 'error', message } / { type: 'done' }
  async askStream(
    organizationId: string,
    question: string,
    history: Array<{ role: 'user' | 'assistant'; content: string }> | undefined,
    emit: (e: any) => void,
    files?: Array<{ name?: string; mediaType: string; base64: string }>,
  ): Promise<void> {
    const apiKey = process.env.ANTHROPIC_API_KEY;
    if (!apiKey) {
      emit({ type: 'error', message: 'Ask is not configured (missing ANTHROPIC_API_KEY)' });
      return;
    }
    const client = new Anthropic({ apiKey });
    const tools = this.buildTools();
    const systemPrompt = this.buildSystemPrompt();
    const attachments: Attachment[] = [];
    // Uploaded PDFs/images ride on the user turn as content blocks (same
    // pattern as the document assistant) so the model can read them alongside
    // the ledger tools — e.g. "does this supplier statement match my AP?".
    const userContent: any[] = [];
    for (const f of files || []) {
      if (f.mediaType === 'application/pdf') {
        userContent.push({ type: 'document', source: { type: 'base64', media_type: 'application/pdf', data: f.base64 } });
      } else {
        userContent.push({ type: 'image', source: { type: 'base64', media_type: f.mediaType || 'image/jpeg', data: f.base64 } });
      }
    }
    userContent.push({ type: 'text', text: question || 'Please analyse the attached file(s) in the context of my accounts.' });
    const messages: Anthropic.MessageParam[] = [
      ...(history || []).map((m) => ({ role: m.role, content: m.content })),
      { role: 'user', content: userContent },
    ];

    try {
      for (let iteration = 0; iteration < MAX_ITERATIONS; iteration++) {
        const stream = client.messages.stream({ model: MODEL, max_tokens: 2048, system: systemPrompt, tools, messages });
        stream.on('text', (delta) => emit({ type: 'text', delta }));
        const response = await stream.finalMessage();

        const toolUseBlocks = response.content.filter((b) => b.type === 'tool_use');
        if (response.stop_reason !== 'tool_use' || toolUseBlocks.length === 0) break;

        messages.push({ role: 'assistant', content: response.content });
        const toolResults: Anthropic.ToolResultBlockParam[] = [];
        const before = attachments.length;
        for (const block of toolUseBlocks) {
          const tu = block as Anthropic.ToolUseBlock;
          if (!['show_kpi', 'show_table', 'show_link'].includes(tu.name)) emit({ type: 'status', tool: tu.name });
          try {
            const result = await this.runTool(organizationId, tu.name, tu.input as any, attachments);
            toolResults.push({ type: 'tool_result', tool_use_id: tu.id, content: JSON.stringify(result).slice(0, 100_000) });
          } catch (e: any) {
            this.logger.error(`Tool ${tu.name} failed: ${e?.message || e}`);
            toolResults.push({ type: 'tool_result', tool_use_id: tu.id, content: `Error: ${e?.message || 'tool failed'}`, is_error: true });
          }
        }
        for (const att of attachments.slice(before)) emit({ type: 'attachment', attachment: att });
        messages.push({ role: 'user', content: toolResults });
      }
    } catch (e: any) {
      this.logger.error(`askStream failed: ${e?.message || e}`);
      emit({ type: 'error', message: e?.message || 'Assistant failed' });
    } finally {
      emit({ type: 'done' });
    }
  }

  // ---------- Tool catalog ----------

  private buildTools(): Anthropic.Tool[] {
    return [
      {
        name: 'get_finance_hub',
        description:
          "Get the Finance Hub snapshot: KPIs (revenue MTD/YTD, net profit, cash, AR, AP, GST payable) + action queue items + insights. Use this for broad 'how am I doing' or 'what needs attention' questions.",
        input_schema: { type: 'object', properties: {}, required: [] },
      },
      {
        name: 'get_trial_balance',
        description:
          'Trial balance: net debit/credit per account from all POSTED journal entries up to as-of date. Use for "what are my account balances".',
        input_schema: {
          type: 'object',
          properties: {
            asOfDate: { type: 'string', description: 'YYYY-MM-DD; defaults to today if omitted' },
          },
        },
      },
      {
        name: 'get_profit_loss',
        description:
          'Profit & loss with 3 columns: this month, previous month, year-to-date. Sections: Sales, COGS, Gross Profit, Other Income, Expenses, Operational Net Profit Before Tax.',
        input_schema: {
          type: 'object',
          properties: {
            cutOffDate: { type: 'string', description: 'YYYY-MM-DD; defaults to today' },
            closingStock: { type: 'number', description: 'Manual closing inventory value; defaults to 0' },
          },
        },
      },
      {
        name: 'get_balance_sheet',
        description: 'Balance sheet as of a date. Assets vs Liabilities + Equity; reports balanced indicator.',
        input_schema: {
          type: 'object',
          properties: {
            asOfDate: { type: 'string', description: 'YYYY-MM-DD; defaults to today' },
            closingStock: { type: 'number' },
          },
        },
      },
      {
        name: 'get_gst_report',
        description:
          'GST F5-style report: output tax / input tax / net GST payable + per-transaction details. Optional category filter (OUTPUT_STANDARD, OUTPUT_ZERO, OUTPUT_EXEMPT, INPUT_STANDARD, INPUT_ZERO, INPUT_EXEMPT).',
        input_schema: {
          type: 'object',
          properties: {
            startDate: { type: 'string' },
            endDate: { type: 'string' },
            category: { type: 'string' },
          },
        },
      },
      {
        name: 'list_journal_entries',
        description: 'List journal entries with filters. Use for "show me recent transactions" / "find entry XYZ".',
        input_schema: {
          type: 'object',
          properties: {
            type: {
              type: 'string',
              description: 'MANUAL | INVOICE | PAYMENT | CREDIT_NOTE | DEBIT_NOTE | OPENING_BALANCE | ADJUSTMENT',
            },
            status: { type: 'string', description: 'DRAFT | POSTED | VOID' },
            startDate: { type: 'string' },
            endDate: { type: 'string' },
            limit: { type: 'number', description: 'default 50, max 200' },
          },
        },
      },
      {
        name: 'list_accounts',
        description: 'List the chart of accounts (code, name, type, category). Use to look up an account before querying its ledger.',
        input_schema: { type: 'object', properties: {}, required: [] },
      },
      {
        name: 'get_account_ledger',
        description:
          'Drill into one account by its code (e.g. "CA001"). Returns posted activity rows + opening/closing balances within an optional date range.',
        input_schema: {
          type: 'object',
          properties: {
            accountCode: { type: 'string', description: 'Required. E.g. CA001, SS001, CL900' },
            startDate: { type: 'string' },
            endDate: { type: 'string' },
          },
          required: ['accountCode'],
        },
      },

      // -------- Output / presentation tools (no real data fetched, just appended) --------
      {
        name: 'show_kpi',
        description: 'Emit a KPI card the UI will render alongside the answer. Use for single key numbers.',
        input_schema: {
          type: 'object',
          properties: {
            label: { type: 'string' },
            value: { type: 'string', description: 'Pre-formatted number with currency / unit, e.g. "$33,912.10"' },
            sub: { type: 'string', description: 'Optional secondary line, e.g. "vs $0 last month"' },
          },
          required: ['label', 'value'],
        },
      },
      {
        name: 'show_table',
        description: 'Emit a tabular result the UI will render. Use for lists of accounts, transactions, or aging buckets.',
        input_schema: {
          type: 'object',
          properties: {
            title: { type: 'string' },
            columns: { type: 'array', items: { type: 'string' } },
            rows: {
              type: 'array',
              items: { type: 'array', items: { type: ['string', 'number'] as any } },
            },
          },
          required: ['columns', 'rows'],
        },
      },
      {
        name: 'show_link',
        description: 'Emit a deep link to a full report page. E.g. /portal/accounting/reports?tab=pl for P&L.',
        input_schema: {
          type: 'object',
          properties: {
            href: { type: 'string' },
            label: { type: 'string' },
          },
          required: ['href', 'label'],
        },
      },
      {
        name: 'get_aged_receivables',
        description:
          "Outstanding receivables from unpaid sales invoices, grouped by customer with aging buckets (current / 1-30 / 31-60 / 61-90 / 90+ days). Use for 'who owes me the most', 'aged receivables', 'AR by customer', 'total receivables', 'most overdue customers'. Optional customerName filters to one customer.",
        input_schema: { type: 'object', properties: { customerName: { type: 'string', description: 'optional — only customers whose name contains this' } } },
      },
      {
        name: 'get_aged_payables',
        description:
          "Outstanding payables from unpaid bills, grouped by supplier with aging buckets. Use for 'who do I owe', 'aged payables', 'AP by supplier', 'total payables'. Optional supplierName filter.",
        input_schema: { type: 'object', properties: { supplierName: { type: 'string' } } },
      },
      {
        name: 'list_invoices',
        description:
          "List individual sales invoices with filters — returns invoice number, customer, date, total, outstanding balance, status. Use for 'show unpaid invoices', 'invoices for customer X', 'overdue invoices', 'biggest outstanding invoices'.",
        input_schema: {
          type: 'object',
          properties: {
            customerName: { type: 'string', description: 'filter to a customer (name contains)' },
            status: { type: 'string', description: 'paid | unpaid | overdue | all (default all)' },
            startDate: { type: 'string', description: 'YYYY-MM-DD' },
            endDate: { type: 'string', description: 'YYYY-MM-DD' },
            limit: { type: 'number', description: 'default 50, max 200' },
          },
        },
      },
      {
        name: 'get_customer_statement',
        description: "A single customer's invoices and total outstanding balance. Use for 'statement for customer X', 'how much does X owe me', 'X's account'.",
        input_schema: { type: 'object', properties: { customerName: { type: 'string' } }, required: ['customerName'] },
      },
    ];
  }

  // ---------- Tool dispatch ----------

  private async runTool(
    organizationId: string,
    name: string,
    input: any,
    attachments: Attachment[],
  ): Promise<any> {
    const parseDate = (v: any) => (v ? new Date(v) : undefined);

    switch (name) {
      case 'get_finance_hub':
        return this.journal.hubSnapshot(organizationId);

      case 'get_trial_balance':
        return this.journal.trialBalance(organizationId, parseDate(input.asOfDate));

      case 'get_profit_loss':
        return this.journal.profitLossReport(organizationId, {
          cutOffDate: parseDate(input.cutOffDate) ?? new Date(),
          closingStock: input.closingStock,
        });

      case 'get_balance_sheet':
        return this.journal.balanceSheetReport(organizationId, {
          asOfDate: parseDate(input.asOfDate) ?? new Date(),
          closingStock: input.closingStock,
        });

      case 'get_gst_report':
        return this.journal.gstReport(organizationId, {
          startDate: parseDate(input.startDate),
          endDate: parseDate(input.endDate),
          category: input.category,
        });

      case 'list_journal_entries':
        return this.journal.findAll(organizationId, {
          type: input.type,
          status: input.status,
          startDate: parseDate(input.startDate),
          endDate: parseDate(input.endDate),
          limit: Math.min(input.limit ?? 50, 200),
        });

      case 'list_accounts': {
        const list = await this.accounts.findAll(organizationId);
        // Trim to the fields the model needs — keeps the tool result compact.
        return list.map((a: any) => ({
          id: a.id,
          code: a.code,
          name: a.name,
          accountType: a.accountType,
          category: a.category,
          normalBalance: a.normalBalance,
        }));
      }

      case 'get_account_ledger': {
        const list = await this.accounts.findAll(organizationId);
        const acct = list.find((a: any) => a.code === input.accountCode);
        if (!acct) return { error: `No account with code ${input.accountCode}` };
        return this.journal.generalLedger(organizationId, acct.id, {
          startDate: parseDate(input.startDate),
          endDate: parseDate(input.endDate),
        });
      }

      case 'get_aged_receivables':
        return this.agedReceivables(organizationId, input.customerName);

      case 'get_aged_payables':
        return this.agedPayables(organizationId, input.supplierName);

      case 'list_invoices':
        return this.listInvoices(organizationId, input);

      case 'get_customer_statement':
        return this.listInvoices(organizationId, { customerName: input.customerName, status: 'all', limit: 200, statement: true });

      // -------- Presentation tools --------
      case 'show_kpi':
        attachments.push({ type: 'kpi', label: input.label, value: input.value, sub: input.sub });
        return { ok: true };

      case 'show_table':
        attachments.push({
          type: 'table',
          title: input.title,
          columns: input.columns,
          rows: input.rows,
        });
        return { ok: true };

      case 'show_link':
        attachments.push({ type: 'link', href: input.href, label: input.label });
        return { ok: true };

      default:
        return { error: `Unknown tool: ${name}` };
    }
  }

  // ---------- AR / AP / invoice queries (read the Document table) ----------

  private static R = (n: number) => Math.round(n * 100) / 100;

  private ageBucket(ref: Date, today: Date): 'current' | '1-30' | '31-60' | '61-90' | '90+' {
    const days = Math.floor((today.getTime() - ref.getTime()) / 86400000);
    if (days <= 0) return 'current';
    if (days <= 30) return '1-30';
    if (days <= 60) return '31-60';
    if (days <= 90) return '61-90';
    return '90+';
  }

  private async agedReceivables(organizationId: string, customerName?: string) {
    const docs = await this.prisma.document.findMany({
      where: { organizationId, type: 'INVOICE', status: 'pending_payment' },
      select: { config: true },
    });
    const today = new Date();
    const q = (customerName || '').toLowerCase();
    const byCust = new Map<string, { total: number; current: number; d1_30: number; d31_60: number; d61_90: number; d90p: number; count: number }>();
    let grand = 0;
    for (const d of docs) {
      const c: any = d.config || {};
      if (c.voided) continue;
      const bal = Number(c.xeroBalance || 0);
      if (bal <= 0.005) continue;
      const name = c.customer?.name || '(no customer)';
      if (q && !name.toLowerCase().includes(q)) continue;
      const ref = new Date(c.dueDate || c.date || today);
      const b = this.ageBucket(ref, today);
      if (!byCust.has(name)) byCust.set(name, { total: 0, current: 0, d1_30: 0, d31_60: 0, d61_90: 0, d90p: 0, count: 0 });
      const e = byCust.get(name)!;
      e.total += bal; e.count++;
      e[b === 'current' ? 'current' : b === '1-30' ? 'd1_30' : b === '31-60' ? 'd31_60' : b === '61-90' ? 'd61_90' : 'd90p'] += bal;
      grand += bal;
    }
    const R = AskService.R;
    const rows = [...byCust.entries()]
      .map(([customer, e]) => ({ customer, invoices: e.count, total: R(e.total), current: R(e.current), '1-30': R(e.d1_30), '31-60': R(e.d31_60), '61-90': R(e.d61_90), '90+': R(e.d90p) }))
      .sort((a, b) => b.total - a.total);
    return { totalReceivables: R(grand), customerCount: rows.length, byCustomer: rows.slice(0, 100) };
  }

  private async agedPayables(organizationId: string, supplierName?: string) {
    const docs = await this.prisma.document.findMany({ where: { organizationId, type: 'BILL' }, select: { config: true } });
    const today = new Date();
    const q = (supplierName || '').toLowerCase();
    const bySup = new Map<string, { total: number; count: number }>();
    let grand = 0;
    for (const d of docs) {
      const c: any = d.config || {};
      if (c.voided) continue;
      const bal = Number(c.balance ?? c.xeroBalance ?? 0);
      if (bal <= 0.005) continue;
      const name = c.supplier?.name || '(no supplier)';
      if (q && !name.toLowerCase().includes(q)) continue;
      if (!bySup.has(name)) bySup.set(name, { total: 0, count: 0 });
      const e = bySup.get(name)!; e.total += bal; e.count++; grand += bal;
    }
    const R = AskService.R;
    const rows = [...bySup.entries()].map(([supplier, e]) => ({ supplier, bills: e.count, total: R(e.total) })).sort((a, b) => b.total - a.total);
    return { totalPayables: R(grand), supplierCount: rows.length, bySupplier: rows.slice(0, 100) };
  }

  private async listInvoices(organizationId: string, input: { customerName?: string; status?: string; startDate?: string; endDate?: string; limit?: number; statement?: boolean }) {
    const where: any = { organizationId, type: 'INVOICE' };
    const status = (input.status || 'all').toLowerCase();
    if (status === 'unpaid' || status === 'overdue') where.status = 'pending_payment';
    else if (status === 'paid') where.status = 'paid';
    const docs = await this.prisma.document.findMany({ where, select: { name: true, status: true, config: true }, orderBy: { createdAt: 'desc' } });
    const today = new Date();
    const q = (input.customerName || '').toLowerCase();
    const R = AskService.R;
    let rows = docs.map((d) => {
      const c: any = d.config || {};
      const date = String(c.date || '').slice(0, 10);
      const due = c.dueDate ? new Date(c.dueDate) : new Date(new Date(c.date || today).getTime() + 30 * 86400000);
      const balance = R(Number(c.xeroBalance || 0));
      return { invoice: d.name, customer: c.customer?.name || '(none)', date, total: R(Number(c.totalAmount || c.xeroGross || 0)), balance, status: c.voided ? 'voided' : d.status, _overdue: balance > 0.005 && due < today };
    });
    if (q) rows = rows.filter((r) => r.customer.toLowerCase().includes(q));
    if (status === 'overdue') rows = rows.filter((r) => r._overdue);
    if (input.startDate) rows = rows.filter((r) => r.date >= input.startDate!);
    if (input.endDate) rows = rows.filter((r) => r.date <= input.endDate!);
    const limit = Math.min(input.limit ?? 50, 200);
    const outstanding = R(rows.reduce((s, r) => s + (r.balance > 0 ? r.balance : 0), 0));
    const clean = rows.map(({ _overdue, ...r }) => r);
    return { count: rows.length, totalOutstanding: outstanding, invoices: clean.slice(0, limit) };
  }
}
