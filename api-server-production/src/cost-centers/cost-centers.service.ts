import { BadRequestException, ConflictException, HttpException, HttpStatus, Injectable, Logger, NotFoundException } from '@nestjs/common';
import Anthropic from '@anthropic-ai/sdk';
import { PrismaService } from '../common/prisma.service';

@Injectable()
export class CostCentersService {
  private readonly logger = new Logger(CostCentersService.name);
  constructor(private readonly prisma: PrismaService) {}

  list(organizationId: string, includeInactive = false) {
    return this.prisma.costCenter.findMany({
      where: { organizationId, ...(includeInactive ? {} : { isActive: true }) },
      orderBy: { code: 'asc' },
    });
  }

  async findOne(organizationId: string, id: string) {
    const row = await this.prisma.costCenter.findFirst({ where: { id, organizationId } });
    if (!row) throw new NotFoundException('Cost center not found');
    return row;
  }

  async create(organizationId: string, dto: { code: string; name: string; description?: string; parentId?: string }) {
    if (!dto.code?.trim() || !dto.name?.trim()) {
      throw new BadRequestException('code and name are required');
    }
    try {
      return await this.prisma.costCenter.create({
        data: {
          organizationId,
          code: dto.code.trim().toUpperCase(),
          name: dto.name.trim(),
          description: dto.description,
          parentId: dto.parentId || null,
        },
      });
    } catch (e: any) {
      if (e.code === 'P2002') throw new ConflictException(`Code ${dto.code} already exists`);
      throw e;
    }
  }

  async update(
    organizationId: string,
    id: string,
    dto: Partial<{ code: string; name: string; description: string; parentId: string | null; isActive: boolean }>,
  ) {
    await this.findOne(organizationId, id);
    return this.prisma.costCenter.update({
      where: { id },
      data: {
        ...(dto.code !== undefined && { code: dto.code.trim().toUpperCase() }),
        ...(dto.name !== undefined && { name: dto.name.trim() }),
        ...(dto.description !== undefined && { description: dto.description }),
        ...(dto.parentId !== undefined && { parentId: dto.parentId || null }),
        ...(dto.isActive !== undefined && { isActive: dto.isActive }),
      },
    });
  }

  async remove(organizationId: string, id: string) {
    await this.findOne(organizationId, id);
    // Soft delete — preserves historical JE-line references.
    return this.prisma.costCenter.update({ where: { id }, data: { isActive: false } });
  }

  // ---------- Smart suggestion ----------
  // Suggest a cost-center for a free-form description (e.g. an invoice line memo
  // or doc description). Same shape as the GL-account smart categorize endpoint.
  async suggest(
    organizationId: string,
    description: string,
  ): Promise<{ suggestions: Array<{ costCenterId: string; code: string; name: string; confidence: number; reason: string }> }> {
    if (!description || description.trim().length < 2) return { suggestions: [] };

    const apiKey = process.env.ANTHROPIC_API_KEY;
    if (!apiKey) return { suggestions: [] };

    const ccs = await this.list(organizationId);
    if (ccs.length === 0) return { suggestions: [] };

    const candidateList = ccs.map((c) => `${c.code}|${c.name}${c.description ? ` (${c.description})` : ''}`).join('\n');
    const client = new Anthropic({ apiKey });
    const system = `Pick the best cost-center code for the given line description. Output ONLY a JSON array of up to 3 objects with: "code" (exact match from list), "confidence" (0-1), "reason" (short clause). If nothing fits, output []. Never invent codes.`;
    const userPrompt = `Description: ${description}\n\nCandidate cost centers (code|name):\n${candidateList}\n\nReturn JSON array.`;

    let raw = '';
    try {
      const response = await client.messages.create({
        model: 'claude-sonnet-4-6',
        max_tokens: 300,
        system,
        messages: [{ role: 'user', content: userPrompt }],
      });
      const text = response.content.find((b) => b.type === 'text');
      raw = text && 'text' in text ? (text as any).text.trim() : '';
    } catch (e: any) {
      this.logger.warn(`[suggest] LLM call failed: ${e?.message}`);
      return { suggestions: [] };
    }

    const match = raw.match(/\[[\s\S]*\]/);
    if (!match) return { suggestions: [] };
    let parsed: Array<{ code: string; confidence: number; reason: string }> = [];
    try { parsed = JSON.parse(match[0]); } catch { return { suggestions: [] }; }

    const byCode = new Map(ccs.map((c) => [c.code, c]));
    const suggestions = parsed
      .map((p) => {
        const cc = byCode.get(p.code);
        if (!cc) return null;
        return {
          costCenterId: cc.id,
          code: cc.code,
          name: cc.name,
          confidence: typeof p.confidence === 'number' ? Math.max(0, Math.min(1, p.confidence)) : 0.5,
          reason: typeof p.reason === 'string' ? p.reason : '',
        };
      })
      .filter((s): s is NonNullable<typeof s> => s !== null)
      .slice(0, 3);

    return { suggestions };
  }
}
