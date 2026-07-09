import { Injectable, NotFoundException, BadRequestException } from '@nestjs/common';
import { PrismaService } from '../common/prisma.service';

// GST master file — the legacy 1-7 tax codes carried over (rate 7% → 9%).
// Seeded per org on first read; accountants edit rates/names, codes stay fixed
// for system rows so documents and reports can rely on them.
const DEFAULT_TAX_RATES = [
  { code: '1', name: 'Output Tax', rate: 9, direction: 'OUTPUT', category: 'STANDARD' },
  { code: '2', name: 'Output Tax 0%', rate: 0, direction: 'OUTPUT', category: 'ZERO_RATED' },
  { code: '3', name: 'Output Tax Exempted', rate: 0, direction: 'OUTPUT', category: 'EXEMPT' },
  { code: '4', name: 'Input Tax', rate: 9, direction: 'INPUT', category: 'STANDARD' },
  { code: '5', name: 'Input Tax 0%', rate: 0, direction: 'INPUT', category: 'ZERO_RATED' },
  { code: '6', name: 'Input Tax Exempted', rate: 0, direction: 'INPUT', category: 'EXEMPT' },
  { code: '7', name: 'Major Exporter - Goods Imported under this scheme', rate: 0, direction: 'INPUT', category: 'MAJOR_EXPORTER' },
];

@Injectable()
export class TaxRatesService {
  constructor(private readonly prisma: PrismaService) {}

  async list(organizationId: string) {
    const existing = await this.prisma.taxRate.findMany({ where: { organizationId }, orderBy: { code: 'asc' } });
    if (existing.length) return existing;
    // First read — seed the legacy code set.
    await this.prisma.taxRate.createMany({
      data: DEFAULT_TAX_RATES.map((r) => ({ ...r, organizationId, isSystem: true })),
      skipDuplicates: true,
    });
    return this.prisma.taxRate.findMany({ where: { organizationId }, orderBy: { code: 'asc' } });
  }

  async update(organizationId: string, id: string, dto: { name?: string; rate?: number; isActive?: boolean }) {
    const row = await this.prisma.taxRate.findFirst({ where: { id, organizationId } });
    if (!row) throw new NotFoundException('Tax rate not found');
    return this.prisma.taxRate.update({
      where: { id },
      data: {
        name: dto.name ?? undefined,
        rate: dto.rate !== undefined ? Number(dto.rate) : undefined,
        isActive: dto.isActive ?? undefined,
      },
    });
  }

  async create(organizationId: string, dto: { code: string; name: string; rate: number; direction: string; category: string }) {
    if (!dto.code?.trim() || !dto.name?.trim()) throw new BadRequestException('Code and name are required');
    if (!['OUTPUT', 'INPUT'].includes(dto.direction)) throw new BadRequestException('direction must be OUTPUT or INPUT');
    return this.prisma.taxRate.create({
      data: {
        organizationId,
        code: dto.code.trim(),
        name: dto.name.trim(),
        rate: Number(dto.rate) || 0,
        direction: dto.direction,
        category: dto.category || 'STANDARD',
      },
    });
  }

  async remove(organizationId: string, id: string) {
    const row = await this.prisma.taxRate.findFirst({ where: { id, organizationId } });
    if (!row) throw new NotFoundException('Tax rate not found');
    if (row.isSystem) throw new BadRequestException('System tax codes cannot be deleted — deactivate instead');
    await this.prisma.taxRate.delete({ where: { id } });
    return { ok: true };
  }
}
