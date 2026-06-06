import { HttpException, HttpStatus, Injectable, Logger } from '@nestjs/common';
import Anthropic from '@anthropic-ai/sdk';
import { JournalService } from '../journal/journal.service';
import { ChartOfAccountsService } from '../accounting/chart-of-accounts.service';

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

    const systemPrompt = `You are an accounting assistant for the AIMS platform. Today is ${new Date().toISOString().slice(0, 10)}.

When answering financial questions:
- Call tools to get real numbers. Never make up figures.
- Cite specific amounts with 2-decimal precision and the org's base currency.
- Keep prose concise (1-3 sentences). Use tools' data, not prose, for tables.
- If a question is ambiguous about period, default to the current month or year-to-date and say which you used.
- When listing transactions/accounts, return data via the 'show_table' final-output tool so the UI can render it.
- When highlighting a single key number, use 'show_kpi'.
- When the answer points to a full report page, use 'show_link' so the user can drill in.
- If the question isn't accounting-related or can't be answered with available tools, say so plainly.`;

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
}
