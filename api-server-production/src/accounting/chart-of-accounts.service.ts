import { BadRequestException, ConflictException, HttpException, HttpStatus, Injectable, Logger, NotFoundException } from '@nestjs/common';
import Anthropic from '@anthropic-ai/sdk';
import { PrismaService } from '../common/prisma.service';
import { CreateChartOfAccountDto, UpdateChartOfAccountDto } from './dto/chart-of-account.dto';
import { DEFAULT_CHART_OF_ACCOUNTS } from './default-chart-of-accounts';

@Injectable()
export class ChartOfAccountsService {
  constructor(private readonly prisma: PrismaService) {}

  async findAll(organizationId: string, opts?: { category?: string; accountType?: string; includeInactive?: boolean }) {
    return this.prisma.chartOfAccount.findMany({
      where: {
        organizationId,
        ...(opts?.category && { category: opts.category }),
        ...(opts?.accountType && { accountType: opts.accountType }),
        ...(opts?.includeInactive ? {} : { isActive: true }),
      },
      orderBy: { code: 'asc' },
    });
  }

  async findOne(organizationId: string, id: string) {
    const account = await this.prisma.chartOfAccount.findFirst({ where: { id, organizationId } });
    if (!account) throw new NotFoundException('Account not found');
    return account;
  }

  async create(organizationId: string, dto: CreateChartOfAccountDto) {
    const existing = await this.prisma.chartOfAccount.findUnique({
      where: { organizationId_code: { organizationId, code: dto.code } },
    });
    if (existing) throw new ConflictException(`Account code "${dto.code}" already exists`);

    return this.prisma.chartOfAccount.create({
      data: {
        organizationId,
        code: dto.code,
        name: dto.name,
        description: dto.description,
        accountType: dto.accountType,
        category: dto.category,
        normalBalance: dto.normalBalance,
        isControlAccount: dto.isControlAccount ?? false,
        parentAccountId: dto.parentAccountId,
      },
    });
  }

  async update(organizationId: string, id: string, dto: UpdateChartOfAccountDto) {
    const account = await this.findOne(organizationId, id);

    // System accounts may be renamed but their code is locked.
    if (account.isSystem && dto.code && dto.code !== account.code) {
      throw new BadRequestException('System account code cannot be changed');
    }

    if (dto.code && dto.code !== account.code) {
      const clash = await this.prisma.chartOfAccount.findUnique({
        where: { organizationId_code: { organizationId, code: dto.code } },
      });
      if (clash) throw new ConflictException(`Account code "${dto.code}" already exists`);
    }

    return this.prisma.chartOfAccount.update({ where: { id }, data: dto });
  }

  async remove(organizationId: string, id: string) {
    const account = await this.findOne(organizationId, id);
    if (account.isSystem) throw new BadRequestException('System accounts cannot be deleted; deactivate instead');
    // Soft-delete to preserve ledger integrity
    return this.prisma.chartOfAccount.update({ where: { id }, data: { isActive: false } });
  }

  async seedDefaults(organizationId: string) {
    const existingCount = await this.prisma.chartOfAccount.count({ where: { organizationId } });
    if (existingCount > 0) {
      return { seeded: 0, message: 'Chart of accounts already has entries — skipped seeding' };
    }

    const created = await this.prisma.$transaction(
      DEFAULT_CHART_OF_ACCOUNTS.map((acc) =>
        this.prisma.chartOfAccount.create({
          data: {
            organizationId,
            code: acc.code,
            name: acc.name,
            accountType: acc.accountType,
            category: acc.category,
            normalBalance: acc.normalBalance,
            isControlAccount: acc.isControlAccount ?? false,
            isSystem: true,
          },
        }),
      ),
    );

    return { seeded: created.length, accounts: created };
  }

  // ---------- Smart categorization ----------
  // Suggest the best-fit GL account(s) for a free-form line description. Calls
  // Claude with the org's chart of accounts as context; returns top-N matches
  // with confidence scores so the caller can either auto-fill (high confidence)
  // or show as suggestions (medium). Intended to be wired into the invoice /
  // PO line entry flow.
  async suggestAccount(
    organizationId: string,
    description: string,
    hint?: 'SALE' | 'PURCHASE' | 'EXPENSE',
  ): Promise<{
    suggestions: Array<{ accountId: string; code: string; name: string; confidence: number; reason: string }>;
  }> {
    if (!description || description.trim().length < 2) {
      throw new BadRequestException('Description too short to categorize');
    }

    const apiKey = process.env.ANTHROPIC_API_KEY;
    if (!apiKey) {
      throw new HttpException(
        'Smart categorization is not configured (missing ANTHROPIC_API_KEY)',
        HttpStatus.SERVICE_UNAVAILABLE,
      );
    }

    // Restrict the candidate list to plausible accounts based on the hint.
    // - SALE → revenue / income accounts (CREDIT normal balance, PNL category)
    // - PURCHASE → COGS / purchase accounts (DEBIT, PNL)
    // - EXPENSE → expense accounts (DEBIT, PNL)
    // - No hint → all P&L accounts
    const hintFilter: Record<string, string[]> = {
      SALE: ['SALES', 'INCOME'],
      PURCHASE: ['PURCHASE'],
      EXPENSE: ['EXPENSE', 'EXCHANGE_GAIN_LOSS'],
    };
    const allowedTypes = hint ? hintFilter[hint] : undefined;

    const accounts = await this.prisma.chartOfAccount.findMany({
      where: {
        organizationId,
        isActive: true,
        category: 'PNL',
        ...(allowedTypes && { accountType: { in: allowedTypes } }),
      },
      select: { id: true, code: true, name: true, accountType: true },
      orderBy: { code: 'asc' },
    });

    if (accounts.length === 0) {
      return { suggestions: [] };
    }

    // Build a compact candidate list for the model.
    const candidateList = accounts
      .map((a) => `${a.code}|${a.name}|${a.accountType}`)
      .join('\n');

    const client = new Anthropic({ apiKey });
    const system = `You categorize accounting line items by picking the best chart-of-accounts match.

Output ONLY a JSON array of up to 3 objects, each with:
  - "code": exact account code from the candidate list
  - "confidence": number 0-1 (1 = perfect match)
  - "reason": one short clause explaining the choice

If no candidate fits, return [].
Never invent codes. Never include accounts not in the list.`;

    const userPrompt = `Description: ${description}
${hint ? `Hint: ${hint}\n` : ''}
Candidate accounts (code|name|type):
${candidateList}

Return JSON array.`;

    let raw = '';
    try {
      const response = await client.messages.create({
        model: 'claude-sonnet-4-6',
        max_tokens: 400,
        system,
        messages: [{ role: 'user', content: userPrompt }],
      });
      const textBlock = response.content.find((b) => b.type === 'text');
      raw = textBlock && 'text' in textBlock ? (textBlock as any).text.trim() : '';
    } catch (e: any) {
      Logger.error(`Categorization LLM call failed: ${e?.message}`, undefined, 'ChartOfAccountsService');
      return { suggestions: [] };
    }

    // Defend against fenced JSON or stray prose.
    const jsonMatch = raw.match(/\[[\s\S]*\]/);
    if (!jsonMatch) return { suggestions: [] };

    let parsed: Array<{ code: string; confidence: number; reason: string }> = [];
    try {
      parsed = JSON.parse(jsonMatch[0]);
    } catch {
      return { suggestions: [] };
    }

    const byCode = new Map(accounts.map((a) => [a.code, a]));
    const suggestions = parsed
      .map((p) => {
        const acct = byCode.get(p.code);
        if (!acct) return null;
        return {
          accountId: acct.id,
          code: acct.code,
          name: acct.name,
          confidence: typeof p.confidence === 'number' ? Math.max(0, Math.min(1, p.confidence)) : 0.5,
          reason: typeof p.reason === 'string' ? p.reason : '',
        };
      })
      .filter((s): s is NonNullable<typeof s> => s !== null)
      .slice(0, 3);

    return { suggestions };
  }
}
