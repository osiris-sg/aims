import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../common/prisma.service';

type ItemDto = {
  code?: string | null;
  name: string;
  type?: string; // PRODUCT | SERVICE
  unitPrice?: number | null;
  taxRate?: number | null;
  accountCode: string;
  isActive?: boolean;
};

@Injectable()
export class RevenueItemsService {
  constructor(private readonly prisma: PrismaService) {}

  async list(organizationId: string, opts?: { type?: string; activeOnly?: boolean }) {
    // Backfill codes for pre-code services so nothing shows blank on lines.
    const uncoded = await this.prisma.revenueItem.findMany({
      where: { organizationId, OR: [{ code: null }, { code: '' }] },
      select: { id: true },
      orderBy: { createdAt: 'asc' },
    });
    for (const u of uncoded) {
      await this.prisma.revenueItem.update({
        where: { id: u.id },
        data: { code: await this.nextServiceCode(organizationId) },
      });
    }

    const items = await this.prisma.revenueItem.findMany({
      where: {
        organizationId,
        ...(opts?.type ? { type: opts.type.toUpperCase() } : {}),
        ...(opts?.activeOnly ? { isActive: true } : {}),
      },
      orderBy: [{ type: 'asc' }, { name: 'asc' }],
    });
    // Attach the account name for display.
    const codes = Array.from(new Set(items.map((i) => i.accountCode).filter(Boolean)));
    const accts = await this.prisma.chartOfAccount.findMany({ where: { organizationId, code: { in: codes } }, select: { code: true, name: true } });
    const nameByCode = new Map(accts.map((a) => [a.code, a.name]));
    return items.map((i) => ({ ...i, accountName: nameByCode.get(i.accountCode) ?? null }));
  }

  private async resolveAccountId(organizationId: string, code?: string | null) {
    if (!code) return null;
    const a = await this.prisma.chartOfAccount.findFirst({ where: { organizationId, code }, select: { id: true } });
    return a?.id ?? null;
  }

  // Next free SV### code (services master). User-supplied codes win; this is
  // the fallback so every service ALWAYS has a code (shows in the document
  // line's Product Code column).
  private async nextServiceCode(organizationId: string): Promise<string> {
    const rows = await this.prisma.revenueItem.findMany({
      where: { organizationId, code: { startsWith: 'SV' } },
      select: { code: true },
    });
    let max = 0;
    for (const r of rows) {
      const m = /^SV(\d+)$/.exec(r.code || '');
      if (m) max = Math.max(max, parseInt(m[1], 10));
    }
    return `SV${String(max + 1).padStart(3, '0')}`;
  }

  async create(organizationId: string, dto: ItemDto) {
    const accountId = await this.resolveAccountId(organizationId, dto.accountCode);
    return this.prisma.revenueItem.create({
      data: {
        organizationId,
        code: dto.code?.trim() || (await this.nextServiceCode(organizationId)),
        name: dto.name,
        type: (dto.type || 'SERVICE').toUpperCase(),
        unitPrice: dto.unitPrice ?? null,
        taxRate: dto.taxRate ?? null,
        accountCode: dto.accountCode,
        accountId,
        isActive: dto.isActive ?? true,
      },
    });
  }

  async update(organizationId: string, id: string, dto: Partial<ItemDto>) {
    const existing = await this.prisma.revenueItem.findFirst({ where: { id, organizationId } });
    if (!existing) throw new NotFoundException('Revenue item not found');
    const accountId = dto.accountCode !== undefined ? await this.resolveAccountId(organizationId, dto.accountCode) : existing.accountId;
    return this.prisma.revenueItem.update({
      where: { id },
      data: {
        code: dto.code ?? undefined,
        name: dto.name ?? undefined,
        type: dto.type ? dto.type.toUpperCase() : undefined,
        unitPrice: dto.unitPrice !== undefined ? dto.unitPrice : undefined,
        taxRate: dto.taxRate !== undefined ? dto.taxRate : undefined,
        accountCode: dto.accountCode ?? undefined,
        accountId,
        isActive: dto.isActive ?? undefined,
      },
    });
  }

  async remove(organizationId: string, id: string) {
    await this.prisma.revenueItem.deleteMany({ where: { id, organizationId } });
    return { ok: true };
  }

  // Bulk seed helper (used to pre-populate a master file from a list).
  async bulkUpsert(organizationId: string, items: ItemDto[]) {
    let created = 0;
    for (const it of items) {
      if (!it.name || !it.accountCode) continue;
      const exists = await this.prisma.revenueItem.findFirst({ where: { organizationId, name: it.name } });
      if (exists) continue;
      await this.create(organizationId, it);
      created++;
    }
    return { created };
  }
}
