import { Injectable } from '@nestjs/common';
import { PrismaService } from 'src/common/prisma.service';
import * as fs from 'fs';
import * as path from 'path';

const ORGANIZATION_ID = '52e90ba8-bfbd-48b0-bb76-4f9667bf74f1'; // Biofuel

const STATUS_MAP: Record<string, string> = {
  Paid: 'confirmed',
  Approved: 'confirmed',
  Draft: 'draft',
};

@Injectable()
export class ImportService {
  constructor(private prisma: PrismaService) {}

  // ─── Load from JSON file into DB (one-time seed) ───
  async seedFromJson() {
    const filePath = path.join(process.cwd(), 'scripts/xero-import-prefilled.json');
    if (!fs.existsSync(filePath)) {
      throw new Error('Prefilled JSON file not found');
    }

    const raw = fs.readFileSync(filePath, 'utf-8');
    const data = JSON.parse(raw);
    const invoices = data.invoices || [];

    let created = 0;
    let skipped = 0;

    for (const inv of invoices) {
      // Check if already exists
      const existing = await this.prisma.importInvoice.findUnique({
        where: {
          invoiceNumber_organizationId: {
            invoiceNumber: inv.invoice_number,
            organizationId: ORGANIZATION_ID,
          },
        },
      });

      if (existing) {
        skipped++;
        continue;
      }

      await this.prisma.importInvoice.create({
        data: {
          organizationId: ORGANIZATION_ID,
          invoiceNumber: inv.invoice_number,
          date: inv.date,
          customer: inv.customer,
          customerMatched: inv.customer_matched || false,
          status: inv.status,
          source: inv.source,
          gross: inv.gross,
          balance: inv.balance,
          projectName: inv.project_name,
          projectLocation: inv.project_location,
          siteOfficeName: inv.site_office_name,
          siteOfficeAddress: inv.site_office_address,
          doDate: inv.do_date,
          doNumber: inv.do_number,
          contactName: inv.contact_name,
          contactPhone: inv.contact_phone,
          lineItems: inv.line_items,
          reviewStatus: 'pending',
        },
      });
      created++;
    }

    return { created, skipped, total: invoices.length };
  }

  // ─── Get invoices from DB ───
  async getInvoices(
    status?: string,
    confidence?: string,
    page: number = 1,
    limit: number = 20,
    search?: string,
  ) {
    const where: any = { organizationId: ORGANIZATION_ID };

    if (status) {
      where.reviewStatus = status;
    }

    if (search) {
      where.OR = [
        { invoiceNumber: { contains: search, mode: 'insensitive' } },
        { customer: { contains: search, mode: 'insensitive' } },
      ];
    }

    const [invoices, total] = await Promise.all([
      this.prisma.importInvoice.findMany({
        where,
        orderBy: { date: 'asc' },
        skip: (page - 1) * limit,
        take: limit,
      }),
      this.prisma.importInvoice.count({ where }),
    ]);

    // Transform to match frontend expected format
    const transformed = invoices.map((inv) => ({
      invoice_number: inv.invoiceNumber,
      date: inv.date,
      customer: inv.customer,
      customer_matched: inv.customerMatched,
      status: inv.status,
      source: inv.source,
      gross: inv.gross,
      balance: inv.balance,
      project_name: inv.projectName,
      project_location: inv.projectLocation,
      site_office_name: inv.siteOfficeName,
      site_office_address: inv.siteOfficeAddress,
      do_date: inv.doDate,
      do_number: inv.doNumber,
      contact_name: inv.contactName,
      contact_phone: inv.contactPhone,
      line_items: inv.lineItems,
      review_status: inv.reviewStatus,
    }));

    return {
      invoices: transformed,
      total,
      totalPages: Math.ceil(total / limit),
      page,
      limit,
    };
  }

  async getStats() {
    const [total, pending, confirmed, skipped] = await Promise.all([
      this.prisma.importInvoice.count({ where: { organizationId: ORGANIZATION_ID } }),
      this.prisma.importInvoice.count({ where: { organizationId: ORGANIZATION_ID, reviewStatus: 'pending' } }),
      this.prisma.importInvoice.count({ where: { organizationId: ORGANIZATION_ID, reviewStatus: 'confirmed' } }),
      this.prisma.importInvoice.count({ where: { organizationId: ORGANIZATION_ID, reviewStatus: 'skipped' } }),
    ]);

    // Count matched items across all invoices
    const allInvoices = await this.prisma.importInvoice.findMany({
      where: { organizationId: ORGANIZATION_ID },
      select: { lineItems: true },
    });

    let totalItems = 0;
    let refLines = 0;
    let matched = 0;

    for (const inv of allInvoices) {
      const items = inv.lineItems as any[];
      if (!Array.isArray(items)) continue;
      for (const li of items) {
        totalItems++;
        if (li.is_reference_line) refLines++;
        else if (li.asset_match?.sku) matched++;
      }
    }

    return {
      total,
      pending,
      confirmed,
      skipped,
      summary: {
        total_invoices: total,
        total_line_items: totalItems,
        reference_lines: refLines,
        product_lines: totalItems - refLines,
        matched_high_confidence: matched,
        matched_medium_confidence: 0,
        matched_low_confidence: 0,
        unmatched: totalItems - refLines - matched,
        match_rate: `${((matched / Math.max(1, totalItems - refLines)) * 100).toFixed(1)}%`,
        auto_confirmable: `${((matched / Math.max(1, totalItems - refLines)) * 100).toFixed(1)}%`,
      },
    };
  }

  async confirmInvoice(invoiceNumber: string, lineItems: any[], projectLocation: string) {
    await this.prisma.importInvoice.update({
      where: {
        invoiceNumber_organizationId: {
          invoiceNumber,
          organizationId: ORGANIZATION_ID,
        },
      },
      data: {
        reviewStatus: 'confirmed',
        lineItems,
        projectLocation,
        confirmedAt: new Date(),
      },
    });
    return { success: true, invoiceNumber };
  }

  async bulkConfirm(invoiceNumbers: string[]) {
    const result = await this.prisma.importInvoice.updateMany({
      where: {
        organizationId: ORGANIZATION_ID,
        invoiceNumber: { in: invoiceNumbers },
        reviewStatus: 'pending',
      },
      data: {
        reviewStatus: 'confirmed',
        confirmedAt: new Date(),
      },
    });
    return { success: true, confirmed: result.count, total: invoiceNumbers.length };
  }

  async skipInvoice(invoiceNumber: string, reason: string) {
    await this.prisma.importInvoice.update({
      where: {
        invoiceNumber_organizationId: {
          invoiceNumber,
          organizationId: ORGANIZATION_ID,
        },
      },
      data: {
        reviewStatus: 'skipped',
        skipReason: reason,
      },
    });
    return { success: true, invoiceNumber };
  }

  async resetInvoice(invoiceNumber: string) {
    await this.prisma.importInvoice.update({
      where: {
        invoiceNumber_organizationId: {
          invoiceNumber,
          organizationId: ORGANIZATION_ID,
        },
      },
      data: {
        reviewStatus: 'pending',
        confirmedAt: null,
        skipReason: null,
      },
    });
    return { success: true, invoiceNumber };
  }

  // ─── Asset / Customer / Project / Category queries ───

  async createAsset(body: {
    name: string;
    skuKey: string;
    categoryId?: string;
    categoryName?: string;
    price?: number;
    uom: string;
    isTracked: boolean;
    description?: string;
    minQuantity?: number;
  }) {
    let categoryId = body.categoryId;
    if (!categoryId && body.categoryName) {
      const existing = await this.prisma.category.findFirst({
        where: { name: body.categoryName, organizationId: ORGANIZATION_ID },
      });
      if (existing) {
        categoryId = existing.id;
      } else {
        const created = await this.prisma.category.create({
          data: { name: body.categoryName, organizationId: ORGANIZATION_ID },
        });
        categoryId = created.id;
      }
    }

    if (!categoryId) {
      throw new Error('Category is required');
    }

    return this.prisma.asset.create({
      data: {
        name: body.name,
        skuKey: body.skuKey,
        categoryId,
        price: body.price,
        uom: body.uom || 'PCS',
        isTracked: body.isTracked ?? false,
        description: body.description,
        minQuantity: body.minQuantity,
        organizationId: ORGANIZATION_ID,
      },
      include: { category: { select: { name: true } } },
    });
  }

  async getAssets() {
    return this.prisma.asset.findMany({
      where: { organizationId: ORGANIZATION_ID, deletedAt: null },
      include: { category: { select: { name: true } } },
      orderBy: { name: 'asc' },
    });
  }

  async getCustomers() {
    return this.prisma.customer.findMany({
      where: { organizationId: ORGANIZATION_ID },
      select: { id: true, name: true, customerCode: true },
      orderBy: { name: 'asc' },
    });
  }

  async getProjects() {
    return this.prisma.project.findMany({
      where: { organizationId: ORGANIZATION_ID },
      select: { id: true, name: true, status: true, siteOfficeId: true },
      orderBy: { name: 'asc' },
    });
  }

  async getCategories() {
    return this.prisma.category.findMany({
      where: { organizationId: ORGANIZATION_ID },
      select: { id: true, name: true },
      orderBy: { name: 'asc' },
    });
  }

  async getSiteOffices(customerId: string) {
    return this.prisma.siteOffice.findMany({
      where: { customerId },
      select: { id: true, name: true, address: true },
      orderBy: { name: 'asc' },
    });
  }

  async createSiteOffice(body: { name: string; address?: string; customerId: string }) {
    return this.prisma.siteOffice.create({
      data: { name: body.name, address: body.address, customerId: body.customerId },
    });
  }

  async createProject(body: {
    name: string;
    customerId: string;
    siteOfficeId?: string;
    startDate?: string;
    endDate?: string;
  }) {
    return this.prisma.project.create({
      data: {
        name: body.name,
        organizationId: ORGANIZATION_ID,
        siteOfficeId: body.siteOfficeId || undefined,
        startDate: body.startDate && body.startDate !== '' ? new Date(body.startDate) : undefined,
        endDate: body.endDate && body.endDate !== '' ? new Date(body.endDate) : undefined,
        status: 'ongoing',
      },
    });
  }

  // ─── Import single invoice (create document + inventory + assignments) ───

  async importSingleInvoice(body: {
    invoiceNumber: string;
    date: string;
    customer: string;
    status: string;
    source: string;
    gross: number;
    balance: number;
    lineItems: any[];
    projectLocation: string;
    projectId?: string;
    siteOfficeId?: string;
    startDate?: string;
    endDate?: string;
  }) {
    // Check for duplicate
    const existing = await this.prisma.document.findFirst({
      where: { organizationId: ORGANIZATION_ID, name: body.invoiceNumber },
    });
    if (existing) {
      return { success: false, message: 'Invoice already exists', documentId: existing.id };
    }

    // Find customer
    const customer = await this.prisma.customer.findFirst({
      where: { organizationId: ORGANIZATION_ID, name: { equals: body.customer, mode: 'insensitive' } },
    });
    if (!customer) {
      throw new Error(`Customer "${body.customer}" not found`);
    }

    // Find document template
    const template = await this.prisma.documentTemplate.findFirst({
      where: { organizationId: ORGANIZATION_ID, OR: [{ type: 'INVOICE' }, { type: 'TI' }] },
    });
    if (!template) {
      throw new Error('No INVOICE template found');
    }

    // Build config items
    const configItems: any[] = [];
    for (const li of body.lineItems) {
      const assetId = li.selectedAssetId || null;
      const qty = li.quantity || 1;
      const unitPrice = li.unit_price || 0;
      const amount = qty * unitPrice;
      const gross = li.gross || amount;
      // Derive tax from Xero: gross includes tax, amount is pre-tax
      const taxAmount = li.tax || (gross - amount);
      // Derive per-item tax rate (e.g. 7%, 8%, 9%)
      const taxRatePercent = amount > 0 ? Math.round((taxAmount / amount) * 100 * 100) / 100 : 0;
      configItems.push({
        inventoryItemId: assetId,
        sku: li.selectedSku || '',
        serialNumbers: li.serialNumbers || [],
        description: li.description || '',
        quantity: qty,
        unitPrice,
        price: unitPrice,
        discount: 0,
        amount,
        tax: String(taxRatePercent), // Tax rate as string percentage for template
        taxAmount,
        gross,
        uom: li.assetUom || 'PCS',
      });
    }

    const documentStatus = STATUS_MAP[body.status] || 'draft';

    // Get GST rate from first item with tax
    const firstItemWithTax = configItems.find(item => parseFloat(item.tax) > 0);
    const gstPercent = firstItemWithTax ? parseFloat(firstItemWithTax.tax) : 9;

    const config = {
      customerId: customer.id,
      customer: { id: customer.id, name: customer.name },
      date: new Date(body.date).toISOString(),
      items: configItems,
      projectId: body.projectId || undefined,
      projectLocation: body.projectLocation || undefined,
      siteOfficeId: body.siteOfficeId || undefined,
      documentInfo: {
        gstPercent,
        currency: 'SGD',
      },
      xeroImported: true,
      xeroInvoiceNumber: body.invoiceNumber,
      xeroStatus: body.status,
      xeroGross: body.gross,
      xeroBalance: body.balance,
    };

    // Create document
    const document = await this.prisma.document.create({
      data: {
        name: body.invoiceNumber,
        type: template.type,
        documentTemplateId: template.id,
        organizationId: ORGANIZATION_ID,
        status: documentStatus as any,
        config: config as any,
        projectId: body.projectId || undefined,
      },
    });

    // Create DocumentItem records + Inventory items + Project assignments
    const createdInventoryIds: string[] = [];

    for (let i = 0; i < configItems.length; i++) {
      const item = configItems[i];
      if (!item.inventoryItemId) continue;

      // Create DocumentItem
      await this.prisma.documentItem.create({
        data: {
          documentId: document.id,
          itemId: item.inventoryItemId,
          itemType: 'ASSET',
          sku: item.sku,
          description: item.description,
          quantity: item.quantity,
          unitPrice: item.unitPrice,
          discount: item.discount,
          amount: item.amount,
          uom: item.uom,
          lineNumber: i + 1,
        },
      });

      // Create Inventory items for each serial number
      const serials: string[] = item.serialNumbers || [];
      for (const serial of serials) {
        if (!serial) continue;

        const existingInv = await this.prisma.inventory.findFirst({
          where: { sku: serial, organizationId: ORGANIZATION_ID },
        });

        let inventoryId: string;
        if (existingInv) {
          inventoryId = existingInv.id;
        } else {
          const asset = await this.prisma.asset.findUnique({
            where: { id: item.inventoryItemId },
            include: { category: true },
          });

          const inventory = await this.prisma.inventory.create({
            data: {
              assetId: item.inventoryItemId,
              sku: serial,
              category: asset?.category?.name || 'General',
              status: 'rental',
              organizationId: ORGANIZATION_ID,
              location: body.projectLocation || undefined,
            },
          });
          inventoryId = inventory.id;
        }
        createdInventoryIds.push(inventoryId);
      }
    }

    // Create project assignments
    if (body.projectId && createdInventoryIds.length > 0) {
      for (const invId of createdInventoryIds) {
        const existingAssignment = await this.prisma.assignment.findUnique({
          where: { projectId_inventoryId: { projectId: body.projectId, inventoryId: invId } },
        });
        if (!existingAssignment) {
          await this.prisma.assignment.create({
            data: {
              projectId: body.projectId,
              inventoryId: invId,
              startDate: body.startDate && body.startDate !== '' ? new Date(body.startDate) : undefined,
              endDate: body.endDate && body.endDate !== '' ? new Date(body.endDate) : undefined,
            },
          });
        }
      }
    }

    return { success: true, documentId: document.id, invoiceNumber: body.invoiceNumber };
  }

  // ─── Batch run import (legacy) ───
  async runImport() {
    const confirmedInvoices = await this.prisma.importInvoice.findMany({
      where: { organizationId: ORGANIZATION_ID, reviewStatus: 'confirmed' },
    });

    const results = { imported: 0, skipped: 0, errors: [] as string[] };

    for (const inv of confirmedInvoices) {
      try {
        const result = await this.importSingleInvoice({
          invoiceNumber: inv.invoiceNumber,
          date: inv.date || '',
          customer: inv.customer || '',
          status: inv.status || 'Draft',
          source: inv.source || 'Receivable Invoice',
          gross: inv.gross || 0,
          balance: inv.balance || 0,
          lineItems: inv.lineItems as any[],
          projectLocation: inv.projectLocation || '',
        });

        if (result.success) {
          results.imported++;
        } else {
          results.skipped++;
        }
      } catch (error: any) {
        results.errors.push(`${inv.invoiceNumber}: ${error.message}`);
      }
    }

    return results;
  }
}
