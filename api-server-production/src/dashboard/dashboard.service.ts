import { Injectable, HttpException, HttpStatus } from '@nestjs/common';
import { Prisma } from '@prisma/client';
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

  // ── Operations dashboard (Biofuel, guru 2026-09-26) ────────────────────
  // What the admin asked to see on one screen: what is on the shelf, what
  // moved in and out lately, what each product earns over a period, how often
  // the field team services units, and where the fleet physically sits.
  //
  // Data sources, chosen after checking what is actually populated in prod:
  //   stock      Inventory grouped by asset + status (status is the truth for
  //              on-shelf vs out on rent).
  //   movements  Assignment.startDate / endDate — the structured in/out record.
  //              DO/RDO documents keep their lines in config JSON, so they are
  //              not reliably queryable; assignments are.
  //   revenue    DocumentItem.itemId -> Asset. itemId is populated on every
  //              invoice line; the free-text description is not groupable
  //              (it carries HTML and remarks).
  //   map        Inventory.taggedLatitude/Longitude, captured at field-bind.
  async getOpsStock(organizationId: string) {
    const rows = await this.prisma.$queryRaw<Array<{ asset: string; status: string; units: bigint }>>`
      SELECT a.name AS asset, i.status::text AS status, COUNT(*) AS units
      FROM "Inventory" i JOIN "Asset" a ON a.id = i."assetId"
      WHERE i."organizationId" = ${organizationId}
      GROUP BY a.name, i.status
      ORDER BY COUNT(*) DESC`;
    const byAsset = new Map<string, any>();
    for (const r of rows) {
      const entry = byAsset.get(r.asset) || { asset: r.asset, total: 0, instock: 0, rental: 0, sold: 0, reserved: 0, maintenance: 0, pending: 0 };
      const n = Number(r.units);
      entry[r.status] = (entry[r.status] || 0) + n;
      // `pending` units are auto-created child placeholders with no real
      // identity yet — they are deliberately excluded from the headline total
      // so the shelf count matches what the office can actually hand out.
      if (r.status !== 'pending') entry.total += n;
      byAsset.set(r.asset, entry);
    }
    const items = [...byAsset.values()].sort((a, b) => b.total - a.total);
    const totals = items.reduce(
      (t, i) => ({
        units: t.units + i.total,
        instock: t.instock + i.instock,
        rental: t.rental + i.rental,
        sold: t.sold + i.sold,
      }),
      { units: 0, instock: 0, rental: 0, sold: 0 },
    );
    return { items, totals };
  }

  async getOpsMovements(organizationId: string, limit = 20) {
    const rows = await this.prisma.$queryRaw<any[]>`
      SELECT * FROM (
        SELECT 'out' AS direction, a."startDate" AS at, ast.name AS asset, i.sku,
               p.name AS project
        FROM "Assignment" a
        JOIN "Inventory" i ON i.id = a."inventoryId"
        JOIN "Asset" ast ON ast.id = i."assetId"
        LEFT JOIN "Project" p ON p.id = a."projectId"
        WHERE i."organizationId" = ${organizationId} AND a."startDate" IS NOT NULL
        UNION ALL
        SELECT 'in' AS direction, a."endDate" AS at, ast.name AS asset, i.sku,
               p.name AS project
        FROM "Assignment" a
        JOIN "Inventory" i ON i.id = a."inventoryId"
        JOIN "Asset" ast ON ast.id = i."assetId"
        LEFT JOIN "Project" p ON p.id = a."projectId"
        WHERE i."organizationId" = ${organizationId} AND a."endDate" IS NOT NULL
      ) m
      ORDER BY m.at DESC
      LIMIT ${limit}`;
    return rows.map((r) => ({ ...r, at: r.at }));
  }

  // Revenue over a period, optionally narrowed to ONE product. Confirmed
  // invoices only would hide drafts the office still counts, so every invoice
  // is included and the caller can see the date range it asked for.
  async getOpsRevenue(organizationId: string, from: Date, to: Date, assetId?: string) {
    const byItem = await this.prisma.$queryRaw<Array<{ assetId: string; item: string; lines: bigint; revenue: number }>>`
      SELECT a.id AS "assetId", a.name AS item, COUNT(*) AS lines, SUM(di.amount)::float AS revenue
      FROM "DocumentItem" di
      JOIN "Document" d ON d.id = di."documentId"
      JOIN "Asset" a ON a.id = di."itemId"
      WHERE d."organizationId" = ${organizationId} AND d.type = 'INVOICE'
        AND d."createdAt" >= ${from} AND d."createdAt" < ${to}
        ${assetId ? Prisma.sql`AND a.id = ${assetId}::uuid` : Prisma.empty}
      GROUP BY a.id, a.name
      ORDER BY SUM(di.amount) DESC NULLS LAST`;

    const series = await this.prisma.$queryRaw<Array<{ month: string; revenue: number }>>`
      SELECT to_char(date_trunc('month', d."createdAt"), 'YYYY-MM') AS month,
             SUM(di.amount)::float AS revenue
      FROM "DocumentItem" di
      JOIN "Document" d ON d.id = di."documentId"
      JOIN "Asset" a ON a.id = di."itemId"
      WHERE d."organizationId" = ${organizationId} AND d.type = 'INVOICE'
        AND d."createdAt" >= ${from} AND d."createdAt" < ${to}
        ${assetId ? Prisma.sql`AND a.id = ${assetId}::uuid` : Prisma.empty}
      GROUP BY 1 ORDER BY 1`;

    const items = byItem.map((r) => ({ assetId: r.assetId, item: r.item, lines: Number(r.lines), revenue: Number(r.revenue) || 0 }));
    return {
      items,
      series: series.map((s) => ({ month: s.month, revenue: Number(s.revenue) || 0 })),
      total: items.reduce((t, i) => t + i.revenue, 0),
    };
  }

  async getOpsMaintenance(organizationId: string, from: Date, to: Date) {
    const series = await this.prisma.$queryRaw<Array<{ month: string; kind: string; n: bigint }>>`
      SELECT to_char(date_trunc('month', "createdAt"), 'YYYY-MM') AS month, kind::text AS kind, COUNT(*) AS n
      FROM "MaintenanceServiceReport"
      WHERE "organizationId" = ${organizationId} AND "createdAt" >= ${from} AND "createdAt" < ${to}
      GROUP BY 1, 2 ORDER BY 1`;
    // Units serviced most often — the ones an admin should worry about.
    const topUnits = await this.prisma.$queryRaw<Array<{ asset: string; sku: string; visits: bigint; last: Date }>>`
      SELECT ast.name AS asset, i.sku, COUNT(*) AS visits, MAX(m."createdAt") AS last
      FROM "MaintenanceServiceReport" m
      JOIN "Inventory" i ON i.id = m."inventoryId"
      JOIN "Asset" ast ON ast.id = i."assetId"
      WHERE m."organizationId" = ${organizationId} AND m.kind = 'SERVICE'
        AND m."createdAt" >= ${from} AND m."createdAt" < ${to}
      GROUP BY ast.name, i.sku ORDER BY COUNT(*) DESC LIMIT 8`;
    return {
      series: series.map((s) => ({ month: s.month, kind: s.kind, count: Number(s.n) })),
      topUnits: topUnits.map((u) => ({ ...u, visits: Number(u.visits) })),
    };
  }

  // Fleet map. Units carry a one-shot GPS fix from field-bind; service reports
  // carry the coordinates of the visit. Both are returned so the admin can see
  // where equipment sits AND where the team has been.
  async getOpsMap(organizationId: string) {
    const units = await this.prisma.$queryRaw<any[]>`
      SELECT i.sku, ast.name AS asset, i.status::text AS status,
             i."taggedLatitude" AS lat, i."taggedLongitude" AS lng
      FROM "Inventory" i JOIN "Asset" ast ON ast.id = i."assetId"
      WHERE i."organizationId" = ${organizationId}
        AND i."taggedLatitude" IS NOT NULL AND i."taggedLongitude" IS NOT NULL`;
    const visits = await this.prisma.$queryRaw<any[]>`
      SELECT m."reportNumber" AS ref, m.kind::text AS kind, m."createdAt" AS at,
             m.latitude AS lat, m.longitude AS lng
      FROM "MaintenanceServiceReport" m
      WHERE m."organizationId" = ${organizationId}
        AND m.latitude IS NOT NULL AND m.longitude IS NOT NULL
      ORDER BY m."createdAt" DESC LIMIT 200`;
    return { units, visits };
  }

}
