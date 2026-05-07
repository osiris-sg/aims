import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
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
}
