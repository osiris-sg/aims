import { Injectable, HttpException, HttpStatus } from '@nestjs/common';
import { PrismaService } from 'src/common/prisma.service';

@Injectable()
export class DashboardService {
  constructor(private prisma: PrismaService) {}

  async getDashboardOverview(organizationId: string) {
    try {
      // Get all data in parallel for better performance
      const [assetsOverview, invoicesDue, deliveryOrdersPending, projectsEnding] = await Promise.all([
        this.getAssetsOverview(organizationId),
        this.getInvoicesDue(organizationId),
        this.getDeliveryOrdersPending(organizationId),
        this.getProjectsEnding(organizationId),
      ]);

      return {
        success: true,
        data: {
          assetsOverview,
          invoicesDue,
          deliveryOrdersPending,
          projectsEnding,
        },
      };
    } catch (error) {
      throw new HttpException(`Dashboard overview fetch failed: ${error.message}`, HttpStatus.INTERNAL_SERVER_ERROR);
    }
  }

  async getAssetsOverview(organizationId: string) {
    try {
      // Count total instock inventory items
      const totalInStock = await this.prisma.inventory.count({
        where: { organizationId, status: 'instock' },
      });

      // Count total assets
      const totalAssets = await this.prisma.asset.count({
        where: { organizationId, deletedAt: null },
      });

      // Top categories by instock inventory count
      const categoryStats = await this.prisma.inventory.groupBy({
        by: ['assetId'],
        where: { organizationId, status: 'instock' },
        _count: { id: true },
      });

      // Get category names for top assets
      const assetIds = categoryStats.map(s => s.assetId);
      const assetsWithCats = assetIds.length > 0
        ? await this.prisma.asset.findMany({
            where: { id: { in: assetIds.slice(0, 1000) } },
            select: { id: true, category: { select: { name: true } } },
          })
        : [];

      const assetCatMap: Record<string, string> = {};
      assetsWithCats.forEach(a => { assetCatMap[a.id] = a.category?.name || 'Uncategorized'; });

      const categoryCount: Record<string, number> = {};
      categoryStats.forEach(s => {
        const catName = assetCatMap[s.assetId] || 'Uncategorized';
        categoryCount[catName] = (categoryCount[catName] || 0) + s._count.id;
      });

      const topCategories = Object.entries(categoryCount)
        .map(([name, count]) => ({ name, count }))
        .sort((a, b) => b.count - a.count)
        .slice(0, 5);

      // Low stock: assets with quantity > 0 and < 10 (for untracked products)
      const lowStockAssets = await this.prisma.asset.findMany({
        where: {
          organizationId,
          deletedAt: null,
          quantity: { gt: 0, lt: 10 },
        },
        select: {
          id: true,
          name: true,
          skuKey: true,
          quantity: true,
          category: { select: { name: true } },
        },
        take: 5,
        orderBy: { quantity: 'asc' },
      });

      return {
        success: true,
        data: {
          totalAssets,
          totalInStock,
          topCategories,
          lowStockCount: lowStockAssets.length,
          lowStockAssets: lowStockAssets.map(a => ({
            id: a.id,
            name: a.name,
            skuKey: a.skuKey,
            categoryName: a.category?.name || 'Uncategorized',
            totalQuantity: a.quantity || 0,
          })),
        },
      };
    } catch (error) {
      throw new HttpException(`Assets overview fetch failed: ${error.message}`, HttpStatus.INTERNAL_SERVER_ERROR);
    }
  }

  async getInvoicesDue(organizationId: string) {
    try {
      const currentDate = new Date();
      const threeDaysFromNow = new Date();
      threeDaysFromNow.setDate(currentDate.getDate() + 3);

      // Get all invoices (TI type documents)
      const invoices = await this.prisma.document.findMany({
        where: {
          organizationId,
          type: 'TI',
        },
        orderBy: { createdAt: 'desc' },
      });

      // Calculate due dates and filter
      const dueInvoices: any[] = [];
      const urgentInvoices: any[] = [];

      invoices.forEach((invoice) => {
        // Calculate due date (30 days from creation)
        const dueDate = new Date(invoice.createdAt);
        dueDate.setDate(dueDate.getDate() + 30);

        if (dueDate < currentDate) {
          const invoiceItem = {
            id: invoice.id,
            name: invoice.name || `Invoice ${invoice.id}`,
            dueDate: dueDate.toISOString(),
            customerName: (invoice.config as any)?.customerName || 'Unknown Customer',
            amount: invoice.config?.['totalAmount'] || 0,
          };

          dueInvoices.push(invoiceItem);

          // Check if it's urgent (due within 3 days from now)
          if (dueDate > threeDaysFromNow) {
            urgentInvoices.push(invoiceItem);
          }
        }
      });

      // Sort urgent invoices by due date
      urgentInvoices.sort((a, b) => new Date(a.dueDate).getTime() - new Date(b.dueDate).getTime());

      return {
        success: true,
        data: {
          totalDue: dueInvoices.length,
          urgentInvoices: urgentInvoices.slice(0, 5), // Top 5 urgent
        },
      };
    } catch (error) {
      throw new HttpException(`Invoices due fetch failed: ${error.message}`, HttpStatus.INTERNAL_SERVER_ERROR);
    }
  }

  async getDeliveryOrdersPending(organizationId: string) {
    try {
      // Get completed delivery orders
      const deliveryOrders = await this.prisma.document.findMany({
        where: {
          organizationId,
          type: 'DO',
          // Add status check here if you have a status field in config
        },
        orderBy: { updatedAt: 'desc' },
      });

      // Get all invoices to check which delivery orders already have invoices
      const invoices = await this.prisma.document.findMany({
        where: {
          organizationId,
          type: 'TI',
        },
        select: {
          id: true,
          name: true,
          config: true,
        },
      });

      // Find delivery orders without corresponding invoices
      const pendingOrders: any[] = [];

      deliveryOrders.forEach((order) => {
        // Check if this delivery order is completed
        const isCompleted = order.config?.['status'] === 'Completed' || order.config?.['status'] === 'Delivered';

        if (isCompleted) {
          // Check if there's already an invoice for this delivery order
          const hasInvoice = invoices.some(
            (invoice) => invoice.config?.['deliveryOrderId'] === order.id || invoice.name?.includes(order.name || '') || JSON.stringify(invoice.config).includes(order.id),
          );

          if (!hasInvoice) {
            pendingOrders.push({
              id: order.id,
              name: order.name || `Delivery Order ${order.id}`,
              customerName: (order.config as any)?.customerName || 'Unknown Customer',
              completedDate: order.updatedAt.toISOString(),
            });
          }
        }
      });

      return {
        success: true,
        data: {
          totalPending: pendingOrders.length,
          pendingOrders: pendingOrders.slice(0, 5), // Top 5 recent
        },
      };
    } catch (error) {
      throw new HttpException(`Delivery orders pending fetch failed: ${error.message}`, HttpStatus.INTERNAL_SERVER_ERROR);
    }
  }

  async getProjectsEnding(organizationId: string) {
    try {
      const currentDate = new Date();
      const tenDaysFromNow = new Date();
      tenDaysFromNow.setDate(currentDate.getDate() + 10);

      // Get projects ending within 10 days
      const projects = await this.prisma.project.findMany({
        where: {
          organizationId,
          endDate: {
            gte: currentDate,
            lte: tenDaysFromNow,
          },
          status: {
            not: 'completed',
          },
        },
        include: {
          siteOffice: {
            include: {
              customer: true,
            },
          },
        },
        orderBy: { endDate: 'asc' },
      });

      const endingProjects = projects.map((project) => ({
        id: project.id,
        name: project.name,
        endDate: project.endDate?.toISOString(),
        status: project.status,
        customerName: project.siteOffice?.customer?.name || 'Unknown Customer',
        daysLeft: Math.ceil((project.endDate!.getTime() - currentDate.getTime()) / (1000 * 60 * 60 * 24)),
      }));

      return {
        success: true,
        data: {
          totalEndingSoon: endingProjects.length,
          endingProjects: endingProjects.slice(0, 5), // Top 5 most urgent
        },
      };
    } catch (error) {
      throw new HttpException(`Projects ending fetch failed: ${error.message}`, HttpStatus.INTERNAL_SERVER_ERROR);
    }
  }
}
