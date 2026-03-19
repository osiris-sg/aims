import { Injectable, HttpException, HttpStatus } from '@nestjs/common';
import { PrismaService } from 'src/common/prisma.service';
import * as fs from 'fs';
import * as path from 'path';

const ORGANIZATION_ID = '52e90ba8-bfbd-48b0-bb76-4f9667bf74f1'; // Biofuel

const STATUS_MAP: Record<string, string> = {
  Paid: 'paid',
  Approved: 'confirmed',
  Draft: 'draft',
};

@Injectable()
export class ImportService {
  constructor(private prisma: PrismaService) {}

  private getPrefilledPath(): string {
    return path.join(process.cwd(), 'scripts/xero-import-prefilled.json');
  }

  private getConfirmedPath(): string {
    return path.join(process.cwd(), 'scripts/import-tool/confirmed-invoices.json');
  }

  private loadPrefilled(): any {
    const raw = fs.readFileSync(this.getPrefilledPath(), 'utf-8');
    return JSON.parse(raw);
  }

  private loadConfirmed(): Record<string, any> {
    const confirmedPath = this.getConfirmedPath();
    if (!fs.existsSync(confirmedPath)) {
      return {};
    }
    const raw = fs.readFileSync(confirmedPath, 'utf-8');
    return JSON.parse(raw);
  }

  private saveConfirmed(data: Record<string, any>): void {
    const confirmedPath = this.getConfirmedPath();
    const dir = path.dirname(confirmedPath);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
    fs.writeFileSync(confirmedPath, JSON.stringify(data, null, 2));
  }

  async getInvoices(
    status?: 'pending' | 'confirmed' | 'skipped',
    confidence?: 'high' | 'medium' | 'low' | 'unmatched',
    page: number = 1,
    limit: number = 20,
    search?: string,
  ) {
    const prefilled = this.loadPrefilled();
    const confirmed = this.loadConfirmed();

    let invoices = prefilled.invoices.map((inv: any) => {
      const confirmedData = confirmed[inv.invoice_number];
      if (confirmedData) {
        return {
          ...inv,
          review_status: confirmedData.review_status || 'confirmed',
          confirmed_line_items: confirmedData.lineItems,
          confirmed_project_location: confirmedData.projectLocation,
          skip_reason: confirmedData.reason,
        };
      }
      return inv;
    });

    if (status) {
      invoices = invoices.filter((inv: any) => inv.review_status === status);
    }

    if (confidence) {
      invoices = invoices.filter((inv: any) => {
        return inv.line_items.some((li: any) => {
          if (confidence === 'unmatched') {
            return !li.confidence || li.confidence === 'unmatched';
          }
          return li.confidence === confidence;
        });
      });
    }

    if (search) {
      const searchLower = search.toLowerCase();
      invoices = invoices.filter((inv: any) =>
        inv.invoice_number?.toLowerCase().includes(searchLower) ||
        inv.customer?.toLowerCase().includes(searchLower)
      );
    }

    const total = invoices.length;
    const totalPages = Math.ceil(total / limit);
    const start = (page - 1) * limit;
    const paginatedInvoices = invoices.slice(start, start + limit);

    return {
      invoices: paginatedInvoices,
      total,
      totalPages,
      page,
      limit,
      summary: prefilled.summary,
    };
  }

  async getStats() {
    const prefilled = this.loadPrefilled();
    const confirmed = this.loadConfirmed();

    let pending = 0;
    let confirmedCount = 0;
    let skipped = 0;

    for (const inv of prefilled.invoices) {
      const confirmedData = confirmed[inv.invoice_number];
      if (confirmedData) {
        if (confirmedData.review_status === 'skipped') {
          skipped++;
        } else {
          confirmedCount++;
        }
      } else {
        pending++;
      }
    }

    return {
      total: prefilled.invoices.length,
      pending,
      confirmed: confirmedCount,
      skipped,
      summary: prefilled.summary,
    };
  }

  async confirmInvoice(invoiceNumber: string, lineItems: any[], projectLocation: string) {
    const confirmed = this.loadConfirmed();
    confirmed[invoiceNumber] = {
      review_status: 'confirmed',
      lineItems,
      projectLocation,
      confirmedAt: new Date().toISOString(),
    };
    this.saveConfirmed(confirmed);
    return { success: true, invoiceNumber };
  }

  async bulkConfirm(invoiceNumbers: string[]) {
    const prefilled = this.loadPrefilled();
    const confirmed = this.loadConfirmed();

    let count = 0;
    for (const invNum of invoiceNumbers) {
      const invoice = prefilled.invoices.find((inv: any) => inv.invoice_number === invNum);
      if (invoice && !confirmed[invNum]) {
        confirmed[invNum] = {
          review_status: 'confirmed',
          lineItems: invoice.line_items,
          projectLocation: invoice.project_location,
          confirmedAt: new Date().toISOString(),
        };
        count++;
      }
    }

    this.saveConfirmed(confirmed);
    return { success: true, confirmed: count, total: invoiceNumbers.length };
  }

  async skipInvoice(invoiceNumber: string, reason: string) {
    const confirmed = this.loadConfirmed();
    confirmed[invoiceNumber] = {
      review_status: 'skipped',
      reason,
      skippedAt: new Date().toISOString(),
    };
    this.saveConfirmed(confirmed);
    return { success: true, invoiceNumber };
  }

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
    // If no categoryId but categoryName provided, find or create the category
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

    const asset = await this.prisma.asset.create({
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
    return asset;
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
      data: {
        name: body.name,
        address: body.address,
        customerId: body.customerId,
      },
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
      configItems.push({
        inventoryItemId: assetId,
        sku: li.selectedSku || '',
        serialNumber: li.serialNumber || '',
        description: li.description || '',
        quantity: li.quantity || 1,
        unitPrice: li.unit_price || 0,
        discount: 0,
        amount: li.gross || (li.quantity || 1) * (li.unit_price || 0),
        uom: li.assetUom || 'PCS',
      });
    }

    // Map status
    const documentStatus = STATUS_MAP[body.status] || 'draft';

    // Build config
    const config = {
      customerId: customer.id,
      customer: { id: customer.id, name: customer.name },
      date: new Date(body.date).toISOString(),
      items: configItems,
      projectId: body.projectId || undefined,
      projectLocation: body.projectLocation || undefined,
      siteOfficeId: body.siteOfficeId || undefined,
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
      const serials: string[] = item.serialNumbers || (item.serialNumber ? [item.serialNumber] : []);
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

    // Create project assignments for inventory items
    if (body.projectId && createdInventoryIds.length > 0) {
      for (const invId of createdInventoryIds) {
        // Check if assignment already exists
        const existingAssignment = await this.prisma.assignment.findUnique({
          where: { projectId_inventoryId: { projectId: body.projectId, inventoryId: invId } },
        });
        if (!existingAssignment) {
          await this.prisma.assignment.create({
            data: {
              projectId: body.projectId,
              inventoryId: invId,
              startDate: body.startDate ? new Date(body.startDate) : undefined,
              endDate: body.endDate && body.endDate !== '' ? new Date(body.endDate) : undefined,
            },
          });
        }
      }
    }

    return { success: true, documentId: document.id, invoiceNumber: body.invoiceNumber };
  }

  async runImport() {
    const prefilled = this.loadPrefilled();
    const confirmed = this.loadConfirmed();

    const confirmedInvoices = prefilled.invoices.filter(
      (inv: any) => confirmed[inv.invoice_number]?.review_status === 'confirmed',
    );

    const results = { imported: 0, skipped: 0, errors: [] as string[] };

    for (const invoice of confirmedInvoices) {
      try {
        const confirmedData = confirmed[invoice.invoice_number];

        // Check for duplicate by invoice number (stored in name field)
        const existing = await this.prisma.document.findFirst({
          where: {
            organizationId: ORGANIZATION_ID,
            name: invoice.invoice_number,
          },
        });

        if (existing) {
          results.skipped++;
          continue;
        }

        // Find customer by name
        const customer = await this.prisma.customer.findFirst({
          where: {
            organizationId: ORGANIZATION_ID,
            name: { equals: invoice.customer, mode: 'insensitive' },
          },
        });

        if (!customer) {
          results.errors.push(`${invoice.invoice_number}: Customer "${invoice.customer}" not found`);
          continue;
        }

        // Find document template for INVOICE type
        const template = await this.prisma.documentTemplate.findFirst({
          where: {
            organizationId: ORGANIZATION_ID,
            OR: [
              { type: 'INVOICE' },
              { type: 'TI' },
            ],
          },
        });

        if (!template) {
          results.errors.push(`${invoice.invoice_number}: No INVOICE/TI template found`);
          continue;
        }

        // Resolve line items to asset IDs
        const lineItems = confirmedData.lineItems || invoice.line_items;
        const configItems: any[] = [];

        for (let i = 0; i < lineItems.length; i++) {
          const li = lineItems[i];
          const sku = li.asset_match?.sku || li.item_code;
          let assetId: string | null = null;

          if (sku) {
            const asset = await this.prisma.asset.findFirst({
              where: {
                organizationId: ORGANIZATION_ID,
                skuKey: sku,
              },
            });
            if (asset) {
              assetId = asset.id;
            }
          }

          configItems.push({
            inventoryItemId: assetId,
            sku: sku || '',
            description: li.description || li.full_description || '',
            quantity: li.quantity || 1,
            unitPrice: li.unit_price || 0,
            discount: li.discount || 0,
            amount: li.gross || (li.quantity || 1) * (li.unit_price || 0),
            uom: li.uom || 'PCS',
          });
        }

        // Map xero status to document status
        const documentStatus = STATUS_MAP[invoice.status] || 'draft';

        // Build config JSON
        const config = {
          customerId: customer.id,
          customer: { id: customer.id, name: customer.name },
          date: new Date(invoice.date).toISOString(),
          items: configItems,
          xeroImported: true,
          xeroInvoiceNumber: invoice.invoice_number,
          xeroStatus: invoice.status,
          xeroGross: invoice.gross,
          xeroBalance: invoice.balance,
        };

        // Create Document
        const document = await this.prisma.document.create({
          data: {
            name: invoice.invoice_number,
            type: template.type,
            documentTemplateId: template.id,
            organizationId: ORGANIZATION_ID,
            status: documentStatus as any,
            config: config as any,
          },
        });

        // Create DocumentItem records
        for (let i = 0; i < configItems.length; i++) {
          const item = configItems[i];
          if (item.inventoryItemId) {
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
          }
        }

        results.imported++;
      } catch (error) {
        results.errors.push(`${invoice.invoice_number}: ${error.message}`);
      }
    }

    return results;
  }
}
