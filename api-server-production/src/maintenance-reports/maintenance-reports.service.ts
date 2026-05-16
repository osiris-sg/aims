import { Injectable, NotFoundException, BadRequestException } from '@nestjs/common';
import { PrismaService } from 'src/common/prisma.service';
import { CreateMaintenanceReportDto } from './dto/create-maintenance-report.dto';
import { SignMaintenanceReportDto } from './dto/sign-maintenance-report.dto';

@Injectable()
export class MaintenanceReportsService {
  constructor(private readonly prisma: PrismaService) {}

  async create(dto: CreateMaintenanceReportDto, organizationId: string, technicianUserId: string) {
    const asset = await this.prisma.asset.findFirst({
      where: { id: dto.assetId, organizationId },
      select: { id: true },
    });
    if (!asset) throw new NotFoundException('Asset not found in this organization');

    return this.prisma.maintenanceServiceReport.create({
      data: {
        organizationId,
        assetId: dto.assetId,
        inventoryId: dto.inventoryId,
        technicianUserId,
        technicianName: dto.technicianName,
        description: dto.description,
        photos: dto.photos ?? [],
      },
    });
  }

  async sign(id: string, dto: SignMaintenanceReportDto, organizationId: string) {
    const report = await this.prisma.maintenanceServiceReport.findFirst({
      where: { id, organizationId },
    });
    if (!report) throw new NotFoundException('Service report not found');
    if (report.status === 'completed') {
      throw new BadRequestException('Report already signed');
    }

    return this.prisma.maintenanceServiceReport.update({
      where: { id },
      data: {
        signature: dto.signature,
        signedByName: dto.signedByName,
        signedAt: new Date(),
        status: 'completed',
      },
    });
  }

  async findById(id: string, organizationId: string) {
    const report = await this.prisma.maintenanceServiceReport.findFirst({
      where: { id, organizationId },
      include: { asset: true, inventory: true },
    });
    if (!report) throw new NotFoundException('Service report not found');
    return report;
  }

  async listByAsset(assetId: string, organizationId: string) {
    return this.prisma.maintenanceServiceReport.findMany({
      where: { assetId, organizationId },
      orderBy: { createdAt: 'desc' },
      take: 50,
    });
  }

  /**
   * Bundle everything the field-scan PWA needs for an asset in one call:
   * asset details, latest delivery order, and recent service reports.
   */
  async getScanContext(assetId: string, organizationId: string) {
    const asset = await this.prisma.asset.findFirst({
      where: { id: assetId, organizationId },
      include: { category: true },
    });
    if (!asset) throw new NotFoundException('Asset not found');

    const latestDoItem = await this.prisma.documentItem.findFirst({
      where: {
        itemId: assetId,
        itemType: 'ASSET',
        document: { organizationId, type: 'DELIVERY_ORDER' },
      },
      orderBy: { document: { createdAt: 'desc' } },
      include: { document: true },
    });

    const recentReports = await this.prisma.maintenanceServiceReport.findMany({
      where: { assetId, organizationId },
      orderBy: { createdAt: 'desc' },
      take: 5,
    });

    return {
      asset,
      latestDeliveryOrder: latestDoItem?.document ?? null,
      recentServiceReports: recentReports,
    };
  }
}
