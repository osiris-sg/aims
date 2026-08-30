import { Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../common/prisma.service';

type ItemDto = {
  code?: string | null;
  name: string;
  type?: string; // PRODUCT | SERVICE
  unitPrice?: number | null;
  taxRate?: number | null;
  accountCode: string;
  isActive?: boolean;
  // Work-library fields (interior-design quotations). All optional — plain
  // services leave them null.
  workSectionId?: string | null;
  descriptionTemplate?: string | null;
  includes?: Array<{ text: string; qty?: number }> | null;
  unitCost?: number | null;
  uom?: string | null;
  pricingMode?: string | null; // priced | inclusive | complimentary
};

type SectionDto = {
  letter?: string | null;
  title: string;
  defaultNotes?: string[];
  sortOrder?: number;
  isActive?: boolean;
};

@Injectable()
export class RevenueItemsService {
  constructor(private readonly prisma: PrismaService) {}

  async list(organizationId: string, opts?: { type?: string; activeOnly?: boolean; workOnly?: boolean }) {
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
        ...(opts?.workOnly ? { workSectionId: { not: null } } : {}),
      },
      orderBy: [{ code: 'asc' }, { name: 'asc' }],
    });
    // Attach the GL account name for display (no relation on the model).
    const codes = Array.from(new Set(items.map((i) => i.accountCode).filter(Boolean)));
    const accts = await this.prisma.chartOfAccount.findMany({ where: { organizationId, code: { in: codes } }, select: { code: true, name: true } });
    const nameByCode = new Map(accts.map((a) => [a.code, a.name]));
    // …and the work section (letter + title) for the library views.
    const sectionIds = Array.from(new Set(items.map((i) => i.workSectionId).filter(Boolean))) as string[];
    const sections = sectionIds.length
      ? await this.prisma.workSection.findMany({ where: { organizationId, id: { in: sectionIds } }, select: { id: true, letter: true, title: true, sortOrder: true } })
      : [];
    const sectionById = new Map(sections.map((s) => [s.id, s]));
    return items.map((i) => ({
      ...i,
      accountName: nameByCode.get(i.accountCode) || null,
      workSection: i.workSectionId ? sectionById.get(i.workSectionId) || null : null,
    }));
  }

  private async resolveAccountId(organizationId: string, code?: string | null) {
    if (!code) return null;
    const a = await this.prisma.chartOfAccount.findFirst({ where: { organizationId, code }, select: { id: true } });
    return a?.id ?? null;
  }

  // Next free SV### code (services master). User-supplied codes win; this is
  // the fallback so every service ALWAYS has a code (shows in the document
  // editor's item-code column).
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

  // Next free <letter>## code inside a work section (e.g. E07) so library
  // items read naturally on a quotation line.
  private async nextWorkCode(organizationId: string, workSectionId: string): Promise<string> {
    const section = await this.prisma.workSection.findFirst({ where: { id: workSectionId, organizationId }, select: { letter: true } });
    const letter = section?.letter || 'W';
    const rows = await this.prisma.revenueItem.findMany({
      where: { organizationId, workSectionId, code: { startsWith: letter } },
      select: { code: true },
    });
    let max = 0;
    for (const r of rows) {
      const m = new RegExp(`^${letter}(\\d+)$`).exec(r.code || '');
      if (m) max = Math.max(max, parseInt(m[1], 10));
    }
    return `${letter}${String(max + 1).padStart(2, '0')}`;
  }

  private workFields(dto: Partial<ItemDto>) {
    return {
      workSectionId: dto.workSectionId !== undefined ? dto.workSectionId : undefined,
      descriptionTemplate: dto.descriptionTemplate !== undefined ? dto.descriptionTemplate : undefined,
      includes: dto.includes !== undefined ? ((dto.includes ?? Prisma.JsonNull) as Prisma.InputJsonValue) : undefined,
      unitCost: dto.unitCost !== undefined ? dto.unitCost : undefined,
      uom: dto.uom !== undefined ? dto.uom : undefined,
      pricingMode: dto.pricingMode ? dto.pricingMode : undefined,
    };
  }

  async create(organizationId: string, dto: ItemDto) {
    const accountId = await this.resolveAccountId(organizationId, dto.accountCode);
    const code =
      dto.code?.trim() ||
      (dto.workSectionId ? await this.nextWorkCode(organizationId, dto.workSectionId) : await this.nextServiceCode(organizationId));
    return this.prisma.revenueItem.create({
      data: {
        organizationId,
        code,
        name: dto.name,
        type: (dto.type || 'SERVICE').toUpperCase(),
        unitPrice: dto.unitPrice ?? null,
        taxRate: dto.taxRate ?? null,
        accountCode: dto.accountCode,
        accountId,
        isActive: dto.isActive ?? true,
        ...this.workFields(dto),
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
        ...this.workFields(dto),
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
    let updated = 0;
    for (const dto of items) {
      if (!dto?.name || !dto?.accountCode) continue;
      const existing = dto.code
        ? await this.prisma.revenueItem.findFirst({ where: { organizationId, code: dto.code } })
        : await this.prisma.revenueItem.findFirst({ where: { organizationId, name: dto.name } });
      if (existing) {
        await this.update(organizationId, existing.id, dto);
        updated += 1;
      } else {
        await this.create(organizationId, dto);
        created += 1;
      }
    }
    return { created, updated };
  }

  // ── Work sections (interior-design quotation trade groups) ───────────────
  async listSections(organizationId: string, activeOnly = false) {
    return this.prisma.workSection.findMany({
      where: { organizationId, ...(activeOnly ? { isActive: true } : {}) },
      orderBy: [{ sortOrder: 'asc' }, { letter: 'asc' }],
    });
  }

  async createSection(organizationId: string, dto: SectionDto) {
    const count = await this.prisma.workSection.count({ where: { organizationId } });
    return this.prisma.workSection.create({
      data: {
        organizationId,
        letter: dto.letter?.trim() || String.fromCharCode(65 + Math.min(count, 25)),
        title: dto.title.trim(),
        defaultNotes: dto.defaultNotes ?? [],
        sortOrder: dto.sortOrder ?? count,
        isActive: dto.isActive ?? true,
      },
    });
  }

  async updateSection(organizationId: string, id: string, dto: Partial<SectionDto>) {
    const existing = await this.prisma.workSection.findFirst({ where: { id, organizationId } });
    if (!existing) throw new NotFoundException('Work section not found');
    return this.prisma.workSection.update({
      where: { id },
      data: {
        letter: dto.letter !== undefined ? dto.letter : undefined,
        title: dto.title?.trim() || undefined,
        defaultNotes: dto.defaultNotes ?? undefined,
        sortOrder: dto.sortOrder ?? undefined,
        isActive: dto.isActive ?? undefined,
      },
    });
  }

  async removeSection(organizationId: string, id: string) {
    // Items keep existing; they just lose their section (become plain services).
    await this.prisma.revenueItem.updateMany({ where: { organizationId, workSectionId: id }, data: { workSectionId: null } });
    await this.prisma.workSection.deleteMany({ where: { id, organizationId } });
    return { ok: true };
  }
}
