import { HttpException, HttpStatus, Injectable } from '@nestjs/common';
import { PrismaService } from 'src/common/prisma.service';
import { CreateProjectDto } from './dto/create-project.dto';
import { UpdateProjectDto } from './dto/update-project.dto';
// import { DeleteProjectDto } from './dto/delete-project.dto';
import { GetProjectDto } from './dto/get-project.dto';
import { Prisma, DeploymentType, DeploymentStatus } from '@prisma/client';
import { ProjectStatus } from '@prisma/client';
import { InventoryStatus } from '@prisma/client';

// Try a few common JSON paths to extract the invoice total. `xeroGross` comes
// first because the Biofuel Xero historical import (which produced ~1.8k of
// the org's invoices) stores the gross-with-GST there and uses none of the
// other keys — without this priority, every "Billed" rollup renders as 0.
function readDocAmount(config: any): number {
  if (!config || typeof config !== 'object') return 0;
  const cand =
    config.xeroGross ??
    config.nettTotal ??
    config.netTotal ??
    config.grandTotal ??
    config.total ??
    config.amount ??
    config.totalAmount ??
    0;
  const n = typeof cand === 'string' ? parseFloat(cand) : Number(cand);
  return Number.isFinite(n) ? n : 0;
}

// Document type buckets used to split a deployment's linked Documents into
// "delivery orders" vs "invoices" for the project view. Verified against
// existing usage in documents.service.ts and inventories.service.ts.
const DEPLOYMENT_DO_TYPES = new Set(['DO', 'DELIVERY_ORDER']);
const DEPLOYMENT_INVOICE_TYPES = new Set([
  'INVOICE', 'TI', 'TI2',
  'CN', 'CREDIT_NOTE',
  'DN', 'DEBIT_NOTE',
]);

function classifyDeploymentDoc(type: string | null | undefined, id: string): 'document' | 'invoice' {
  if (type && DEPLOYMENT_DO_TYPES.has(type)) return 'document';
  if (type && DEPLOYMENT_INVOICE_TYPES.has(type)) return 'invoice';
  console.warn(
    `[deployments] Unknown document type "${type}" on document ${id} — defaulting to documents bucket. Add to DEPLOYMENT_DO_TYPES or DEPLOYMENT_INVOICE_TYPES if this is wrong.`,
  );
  return 'document';
}

function deploymentName(deploymentNumber: number | null | undefined): string {
  return typeof deploymentNumber === 'number' ? `Deployment ${deploymentNumber}` : '(unnumbered)';
}

@Injectable()
export class ProjectsService {
  constructor(private prisma: PrismaService) {}

  async getProjects(getProjectDto: GetProjectDto, organizationId: string) {
    try {
      const { page, limit, search, filters } = getProjectDto;
      const skip = (page - 1) * limit;

      const whereClause: any = { organizationId };

      if (search) {
        whereClause.OR = [
          { name: { contains: search, mode: 'insensitive' } },
          // Also match a project when one of its tagged documents matches —
          // e.g. typing a quotation/DO number surfaces the project it's on.
          { documents: { some: { name: { contains: search, mode: 'insensitive' } } } },
        ];
      }

      // Filter by customer if provided. Match either the direct Project.customerId
      // FK (added later in the schema) or the legacy siteOffice.customer.id path
      // — projects in the wild use both depending on when they were created.
      if (filters?.customerId) {
        const customerOr = [
          { customerId: filters.customerId },
          { siteOffice: { customer: { id: filters.customerId } } },
        ];
        if (whereClause.OR) {
          // A search OR is already present — AND it with the customer OR.
          whereClause.AND = [{ OR: whereClause.OR }, { OR: customerOr }];
          delete whereClause.OR;
        } else {
          whereClause.OR = customerOr;
        }
      }

      const projects = await this.prisma.project.findMany({
        where: whereClause,
        skip,
        take: limit,
        orderBy: { createdAt: 'desc' },
        include: {
          // Direct customer FK (added with ProjectDeployment). getProjectById has
          // had this since 3053bb5; getProjects was missed in that pass.
          customer: { select: { id: true, name: true } },
          // Keep the siteOffice→customer path for legacy projects whose customer
          // attribution still transits through site office.
          siteOffice: {
            include: { customer: { select: { id: true, name: true } } },
          },
          // Count line items across the project's documents — Assignment rows
          // are empty under the deployment-centric model, so counting them
          // gave every Biofuel project "0 items".
          documents: { select: { _count: { select: { documentItems: true } } } },
        },
      });

      const totalDocs = await this.prisma.project.count({ where: whereClause });

      return {
        docs: projects.map((project) => {
          const resolvedCustomer = project.customer ?? project.siteOffice?.customer ?? null;
          const itemCount = project.documents.reduce(
            (s, d) => s + d._count.documentItems,
            0,
          );
          return {
            id: project.id,
            name: project.name,
            siteOffice: project.siteOffice
              ? { id: project.siteOffice.id, name: project.siteOffice.name }
              : null,
            customer: resolvedCustomer
              ? { id: resolvedCustomer.id, name: resolvedCustomer.name }
              : null,
            itemsRelated: itemCount,
            startDate: project.startDate,
            endDate: project.endDate,
            status: project.status,
          };
        }),
        hasNextPage: skip + projects.length < totalDocs,
        hasPreviousPage: page > 1,
        page,
        limit,
        totalPagesCount: Math.ceil(totalDocs / limit),
        totalDocuments: totalDocs,
      };
    } catch (error) {
      throw new HttpException(error.message, HttpStatus.INTERNAL_SERVER_ERROR);
    }
  }

  async getProjectById(id: string, organizationId: string) {
    try {
      const project = await this.prisma.project.findFirst({
        where: { id, organizationId },
        include: {
          customer: { select: { id: true, name: true, customerCode: true } },
          siteOffice: {
            select: { id: true, name: true, address: true, customer: true },
          },
          assignments: {
            // Only ACTIVE assignments (soft-closed ones carry an endDate).
            where: { endDate: null },
            include: {
              inventory: { select: { sku: true, status: true } },
              asset: { select: { id: true, name: true, skuKey: true, uom: true } },
              document: { select: { id: true, name: true } },
            },
          },
          deployments: {
            orderBy: [{ status: 'asc' }, { deployedDate: 'desc' }, { deploymentNumber: 'asc' }],
            include: {
              sourceDocument: { select: { id: true, name: true, type: true, createdAt: true } },
              assignments: {
                where: { endDate: null }, // active only — hide soft-closed (moved-away) units
                include: {
                  asset: { select: { id: true, name: true, skuKey: true, uom: true } },
                  inventory: { select: { id: true, sku: true, status: true } },
                },
              },
              // "invoices" relation is keyed by Document.projectDeploymentId — it actually
              // contains BOTH DO Documents and invoice Documents now. Service splits below.
              invoices: {
                select: {
                  id: true,
                  name: true,
                  type: true,
                  status: true,
                  createdAt: true,
                  config: true,
                  payments: { select: { amount: true, paymentDate: true } },
                  documentItems: {
                    select: {
                      id: true,
                      itemId: true,
                      itemType: true,
                      sku: true,
                      description: true,
                      quantity: true,
                      unitPrice: true,
                      uom: true,
                      lineNumber: true,
                      isService: true,
                    },
                    orderBy: { lineNumber: 'asc' },
                  },
                },
                orderBy: { createdAt: 'asc' },
              },
            },
          },
          documents: {
            select: {
              id: true,
              name: true,
              type: true,
              status: true,
              createdAt: true,
              projectDeploymentId: true,
              // Needed for the project page's "open quotation editor" link:
              // /portal/documents/QUOTATION/<documentTemplateId>/<id>
              documentTemplateId: true,
              config: true,
              payments: { select: { amount: true } },
            },
            orderBy: { createdAt: 'desc' },
          },
        },
      });
      if (!project) throw new HttpException('Project not found', HttpStatus.NOT_FOUND);

      // Resolve customer (direct FK first, fall back to siteOffice.customer for legacy rows)
      const resolvedCustomer =
        project.customer ?? (project.siteOffice as any)?.customer ?? null;

      // ---- Asset hierarchy (subAssets) for documentItems ---------------------
      // DocumentItem.itemId is a polymorphic UUID (inventory or asset). To show
      // child assets ("SIDS has a TSS child") on the item rows, gather every
      // referenced parent asset id in one pass, fetch each parent's subAssets
      // once, and build a lookup keyed by itemId so the per-item mapping is
      // O(1). Inventory items need an extra hop (inv.id → inv.assetId).
      const collectedItemIds = new Set<string>();
      const collectedInventoryIds = new Set<string>();
      const collectedAssetIds = new Set<string>();
      for (const d of project.deployments) {
        for (const linked of d.invoices) {
          for (const it of linked.documentItems) {
            collectedItemIds.add(it.itemId);
            if (it.itemType === 'INVENTORY') collectedInventoryIds.add(it.itemId);
            else if (it.itemType === 'ASSET') collectedAssetIds.add(it.itemId);
          }
        }
      }
      const invRows =
        collectedInventoryIds.size > 0
          ? await this.prisma.inventory.findMany({
              where: { id: { in: [...collectedInventoryIds] }, organizationId },
              select: { id: true, assetId: true },
            })
          : [];
      const inventoryAssetById = new Map(invRows.map((i) => [i.id, i.assetId]));
      for (const r of invRows) collectedAssetIds.add(r.assetId);

      const parentAssets =
        collectedAssetIds.size > 0
          ? await this.prisma.asset.findMany({
              where: { id: { in: [...collectedAssetIds] }, deletedAt: null },
              select: {
                id: true,
                subAssets: {
                  where: { deletedAt: null },
                  select: {
                    id: true,
                    name: true,
                    skuKey: true,
                    isTracked: true,
                    _count: { select: { inventories: true } },
                  },
                },
              },
            })
          : [];
      const subAssetsByParentId = new Map(
        parentAssets.map((a) => [
          a.id,
          a.subAssets.map((s) => ({
            id: s.id,
            name: s.name,
            skuKey: s.skuKey,
            isTracked: s.isTracked,
            inventoryCount: s._count.inventories,
          })),
        ]),
      );
      // Returns the subAssets array for a given documentItem (empty if the
      // item's resolved parent asset has no children).
      const subAssetsForItem = (it: { itemId: string; itemType: string }): any[] => {
        const assetId =
          it.itemType === 'INVENTORY' ? inventoryAssetById.get(it.itemId) : it.itemId;
        if (!assetId) return [];
        return subAssetsByParentId.get(assetId) ?? [];
      };

      // Per-deployment rollups. The `invoices` Prisma relation now contains BOTH
      // DO and invoice Documents (since DOs may be attached to a deployment via
      // Document.projectDeploymentId in Phase 4). Split by allowlisted type.
      const deployments = project.deployments.map((d) => {
        const docsBucket: any[] = [];
        const invoicesBucket: any[] = [];
        for (const linked of d.invoices) {
          const where = classifyDeploymentDoc(linked.type, linked.id);
          if (where === 'document') docsBucket.push(linked);
          else invoicesBucket.push(linked);
        }

        const totalBilled = invoicesBucket.reduce((s, inv) => s + readDocAmount(inv.config), 0);
        const totalPaid = invoicesBucket.reduce(
          (s, inv) => s + inv.payments.reduce((p, pay) => p + (pay.amount ?? 0), 0),
          0,
        );
        const lastInvoice = invoicesBucket[invoicesBucket.length - 1] ?? null;

        // isServiceOnly: every documentItem across all linked docs is a service.
        // Empty-items defaults to false (don't hide deployments with no items).
        const allItems = [
          ...docsBucket.flatMap((doc: any) => (doc.documentItems ?? [])),
          ...invoicesBucket.flatMap((inv: any) => (inv.documentItems ?? [])),
        ];
        const isServiceOnly = allItems.length > 0 && allItems.every((it: any) => it.isService === true);

        return {
          id: d.id,
          deploymentNumber: d.deploymentNumber,
          name: deploymentName(d.deploymentNumber),
          type: d.type,
          status: d.status,
          description: d.description,
          monthlyRate: d.monthlyRate,
          currency: d.currency,
          deployedDate: d.deployedDate,
          offHiredDate: d.offHiredDate,
          notes: d.notes,
          isServiceOnly,
          sourceDocument: d.sourceDocument,
          assignments: d.assignments,
          documents: docsBucket.map(({ payments, config, documentItems, ...rest }) => ({
            ...rest,
            documentItems: (documentItems ?? []).map((it: any) => ({
              ...it,
              subAssets: subAssetsForItem(it),
            })),
            // payments/config dropped (DO docs aren't billed)
          })),
          // Keep documentItems on the invoice mapper too — the project detail
          // page renders them inline under each invoice (since Biofuel has no
          // DO Documents, this is the only line-item surface available).
          invoices: invoicesBucket.map(({ payments, config, documentItems, ...rest }) => ({
            ...rest,
            documentItems: (documentItems ?? []).map((it: any) => ({
              ...it,
              subAssets: subAssetsForItem(it),
            })),
            amount: readDocAmount(config),
            paid: payments.reduce((p, pay) => p + (pay.amount ?? 0), 0),
          })),
          totalBilled,
          totalPaid,
          outstanding: totalBilled - totalPaid,
          invoiceCount: invoicesBucket.length,
          lastInvoiceDate: lastInvoice?.createdAt ?? null,
          lastInvoiceName: lastInvoice?.name ?? null,
        };
      });

      // Split quotations out of the document list — they have their own
      // surface on the project page and shouldn't double-count toward the
      // billed/paid rollups (quotations are proposals, not billed amounts).
      const quotationDocs = project.documents.filter((d) => d.type === 'QUOTATION');
      const nonQuotationDocs = project.documents.filter((d) => d.type !== 'QUOTATION');

      // Project-level rollup (every linked non-quotation document)
      const projectTotalBilled = nonQuotationDocs.reduce((s, d) => s + readDocAmount(d.config), 0);
      const projectTotalPaid = nonQuotationDocs.reduce(
        (s, d) => s + d.payments.reduce((p, pay) => p + (pay.amount ?? 0), 0),
        0,
      );

      // Quotations bucket — minimal header shape; full preview via the
      // existing DocumentPreviewDialog (GET /documents/:id).
      const quotations = quotationDocs.map(({ payments, config, ...rest }) => ({
        ...rest,
        amount: readDocAmount(config),
      }));

      // Standalone (sales/services not bound to a deployment, excluding quotations)
      const standaloneDocs = nonQuotationDocs
        .filter((d) => !d.projectDeploymentId)
        .map(({ payments, config, ...rest }) => ({
          ...rest,
          amount: readDocAmount(config),
          paid: payments.reduce((p, pay) => p + (pay.amount ?? 0), 0),
        }));

      // Flat chronological invoice/DO list (excluding quotations)
      const allInvoices = nonQuotationDocs.map(({ payments, config, ...rest }) => ({
        ...rest,
        amount: readDocAmount(config),
        paid: payments.reduce((p, pay) => p + (pay.amount ?? 0), 0),
      }));

      return {
        id: project.id,
        projectNumber: project.projectNumber,
        name: project.name,
        description: project.description,
        status: project.status,
        startDate: project.startDate,
        endDate: project.endDate,
        customerPoNumber: project.customerPoNumber,
        customer: resolvedCustomer
          ? { id: resolvedCustomer.id, name: resolvedCustomer.name, code: (resolvedCustomer as any).customerCode ?? null }
          : null,
        siteOffice: project.siteOffice
          ? { id: project.siteOffice.id, name: project.siteOffice.name, address: project.siteOffice.address }
          : null,
        deployments,
        quotations,
        standaloneDocs,
        allInvoices,
        totals: {
          billed: projectTotalBilled,
          paid: projectTotalPaid,
          outstanding: projectTotalBilled - projectTotalPaid,
          deploymentCount: deployments.length,
          activeDeployments: deployments.filter((d) => d.status === 'ACTIVE').length,
          invoiceCount: nonQuotationDocs.length,
          quotationCount: quotationDocs.length,
        },
      };
    } catch (error) {
      throw new HttpException(error.message, HttpStatus.INTERNAL_SERVER_ERROR);
    }
  }

  // ---- Deployment CRUD --------------------------------------------------

  async listDeployments(projectId: string, organizationId: string) {
    const rows = await this.prisma.projectDeployment.findMany({
      where: { projectId, organizationId },
      orderBy: [{ status: 'asc' }, { deployedDate: 'desc' }, { deploymentNumber: 'asc' }],
      include: {
        sourceDocument: { select: { id: true, name: true } },
        assignments: {
          where: { endDate: null }, // active only — hide soft-closed (moved-away) units
          include: {
            asset: { select: { id: true, name: true, skuKey: true } },
            inventory: { select: { id: true, sku: true } },
          },
        },
        // Split _count by document type so invoice/document totals are accurate
        // now that DOs may also live in the same back-relation.
        _count: {
          select: {
            invoices: { where: { type: { in: Array.from(DEPLOYMENT_INVOICE_TYPES) } } },
          },
        },
      },
    });

    return rows.map((d) => ({
      ...d,
      deploymentNumber: d.deploymentNumber,
      name: deploymentName(d.deploymentNumber),
      invoiceCount: d._count.invoices,
    }));
  }

  async createDeployment(
    projectId: string,
    organizationId: string,
    data: {
      type?: string;
      description?: string;
      monthlyRate?: number;
      currency?: string;
      deployedDate?: string;
      sourceDocumentId?: string;
      notes?: string;
    },
  ) {
    const project = await this.prisma.project.findFirst({
      where: { id: projectId, organizationId },
      select: { id: true },
    });
    if (!project) throw new HttpException('Project not found', HttpStatus.NOT_FOUND);

    // Auto-number per project: count existing deployments and use count+1.
    // The unique constraint (projectId, deploymentNumber) is the correctness
    // backstop for concurrent creates — catch P2002 and retry up to 3 times.
    const baseData = {
      projectId,
      organizationId,
      type: (data.type as DeploymentType) ?? DeploymentType.RENTAL,
      description: data.description,
      monthlyRate: data.monthlyRate,
      currency: data.currency ?? 'SGD',
      deployedDate: data.deployedDate ? new Date(data.deployedDate) : new Date(),
      sourceDocumentId: data.sourceDocumentId,
      notes: data.notes,
    };

    for (let attempt = 0; attempt < 3; attempt++) {
      const taken = await this.prisma.projectDeployment.count({ where: { projectId } });
      try {
        return await this.prisma.projectDeployment.create({
          data: { ...baseData, deploymentNumber: taken + 1 },
        });
      } catch (err) {
        if (
          err instanceof Prisma.PrismaClientKnownRequestError &&
          err.code === 'P2002' &&
          (err.meta?.target as string[] | undefined)?.includes('deploymentNumber')
        ) {
          continue; // raced — recompute and retry
        }
        throw err;
      }
    }
    throw new HttpException(
      'Could not allocate a deployment number after 3 attempts',
      HttpStatus.CONFLICT,
    );
  }

  /**
   * Field create-and-bind → deployment. Called by the NFC bind flow when the
   * tech picked a project: creates a Deployment + auto-numbered DO with one
   * line item for the freshly bound inventory unit, so the item shows up on
   * the project page's deployment cards (which read document line items —
   * standalone Assignment rows are invisible there).
   *
   * All writes run in one transaction; the 3-attempt retry covers unique
   * races on (projectId, deploymentNumber) and the document name — same
   * backstop pattern as createDeployment / createBasicDocument.
   */
  async fieldDeploy(
    projectId: string,
    organizationId: string,
    body: { inventoryId: string; assetId: string; type?: 'RENTAL' | 'SALE' },
  ) {
    const { inventoryId, assetId, type } = body ?? ({} as any);
    if (!inventoryId || !assetId) {
      throw new HttpException('inventoryId and assetId are required', HttpStatus.BAD_REQUEST);
    }
    // Default to RENTAL for backward compatibility with callers that omit type.
    const deploymentType = type === 'SALE' ? DeploymentType.SALE : DeploymentType.RENTAL;
    const inventoryStatus = type === 'SALE' ? InventoryStatus.sold : InventoryStatus.rental;

    const project = await this.prisma.project.findFirst({
      where: { id: projectId, organizationId },
      select: {
        id: true,
        customer: {
          select: { id: true, name: true, customerCode: true, email: true, phone: true, address: true, gstRegNo: true },
        },
      },
    });
    if (!project) throw new HttpException('Project not found', HttpStatus.NOT_FOUND);

    const inventory = await this.prisma.inventory.findFirst({
      where: { id: inventoryId, organizationId },
      include: { asset: { select: { id: true, name: true, uom: true } } },
    });
    if (!inventory) throw new HttpException('Inventory item not found', HttpStatus.NOT_FOUND);
    if (inventory.assetId !== assetId) {
      throw new HttpException('assetId does not match the inventory item', HttpStatus.BAD_REQUEST);
    }

    // Assignment-only: this flow creates a ProjectDeployment and flips the unit
    // status. It does NOT auto-create a Delivery Order — sourceDocumentId stays
    // null, and DOs can be attached later from the office via
    // Document.projectDeploymentId. (The DO-driven Start/Ack/Install delivery
    // flow is unaffected; it works off manually-created DOs.)
    const description = `${inventory.asset.name} - ${inventory.sku}`;
    const now = new Date();

    for (let attempt = 0; attempt < 3; attempt++) {
      try {
        return await this.prisma.$transaction(async (tx) => {
          // One unit, one ACTIVE project. "Active" = an assignment with no
          // endDate. Decide skip / add / soft-move BEFORE allocating anything.
          const active = await tx.assignment.findMany({
            where: { inventoryId, endDate: null },
            select: { id: true, projectId: true },
          });

          // CASE 1 — already active on the selected project: skip. No deployment
          // is created (avoids an orphan deployment + duplicate assignment).
          if (active.some((a) => a.projectId === projectId)) {
            return { status: 'already_on_project' as const, deployment: null };
          }

          // CASE 3 — active on OTHER project(s): soft-close them (endDate=now)
          // so the unit only ever has one active project. History is preserved.
          if (active.length) {
            await tx.assignment.updateMany({
              where: { inventoryId, endDate: null, projectId: { not: projectId } },
              data: { endDate: now },
            });
          }

          // Deployment — auto-numbered per project (count + 1).
          const taken = await tx.projectDeployment.count({ where: { projectId } });
          const deployment = await tx.projectDeployment.create({
            data: {
              projectId,
              organizationId,
              deploymentNumber: taken + 1,
              type: deploymentType,
              status: DeploymentStatus.ACTIVE,
              deployedDate: now,
              description,
            },
          });

          // (Re)open the assignment for the selected project — the real
          // unit↔project link the office reads. endDate:null on the UPDATE branch
          // re-activates a previously soft-closed row (a move-back), respecting
          // @@unique([projectId, inventoryId]); the upsert also means no P2002
          // from the assignment, so the retry loop only guards deploymentNumber.
          await tx.assignment.upsert({
            where: { projectId_inventoryId: { projectId, inventoryId } },
            update: { projectDeploymentId: deployment.id, startDate: now, endDate: null },
            create: {
              projectId,
              inventoryId,
              projectDeploymentId: deployment.id,
              startDate: now,
            },
          });

          await tx.inventory.update({
            where: { id: inventoryId },
            data: { status: inventoryStatus },
          });

          return { status: active.length ? ('moved' as const) : ('added' as const), deployment };
        });
      } catch (err) {
        // Unique race on deploymentNumber (count+1 per project) — recompute + retry.
        if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') {
          continue;
        }
        throw err;
      }
    }
    throw new HttpException('Could not allocate a deployment number after 3 attempts', HttpStatus.CONFLICT);
  }

  async attachDocumentToDeployment(
    deploymentId: string,
    documentId: string,
    organizationId: string,
  ) {
    const deployment = await this.prisma.projectDeployment.findFirst({
      where: { id: deploymentId, organizationId },
      select: { id: true, projectId: true },
    });
    if (!deployment) throw new HttpException('Deployment not found', HttpStatus.NOT_FOUND);

    const doc = await this.prisma.document.findFirst({
      where: { id: documentId, organizationId },
      select: { id: true, projectId: true, projectDeploymentId: true, type: true },
    });
    if (!doc) throw new HttpException('Document not found', HttpStatus.NOT_FOUND);

    if (doc.projectDeploymentId && doc.projectDeploymentId !== deploymentId) {
      throw new HttpException(
        `Document is already attached to a different deployment (${doc.projectDeploymentId})`,
        HttpStatus.CONFLICT,
      );
    }

    await this.prisma.document.update({
      where: { id: documentId },
      data: {
        projectDeploymentId: deploymentId,
        // Don't dangle: if the document had no project, inherit the deployment's project.
        ...(doc.projectId ? {} : { projectId: deployment.projectId }),
      },
    });

    // Return the deployment in the same shape getProjectById produces (single row).
    const refreshed = await this.prisma.projectDeployment.findUnique({
      where: { id: deploymentId },
      include: {
        sourceDocument: { select: { id: true, name: true, type: true, createdAt: true } },
        assignments: {
          where: { endDate: null }, // active only — hide soft-closed (moved-away) units
          include: {
            asset: { select: { id: true, name: true, skuKey: true, uom: true } },
            inventory: { select: { id: true, sku: true, status: true } },
          },
        },
        invoices: {
          select: {
            id: true, name: true, type: true, status: true, createdAt: true,
            config: true,
            payments: { select: { amount: true, paymentDate: true } },
            documentItems: {
              select: {
                id: true, itemId: true, itemType: true, sku: true, description: true,
                quantity: true, unitPrice: true, uom: true, lineNumber: true, isService: true,
              },
              orderBy: { lineNumber: 'asc' },
            },
          },
          orderBy: { createdAt: 'asc' },
        },
      },
    });
    if (!refreshed) throw new HttpException('Deployment vanished after update', HttpStatus.INTERNAL_SERVER_ERROR);

    const docsBucket: any[] = [];
    const invoicesBucket: any[] = [];
    for (const linked of refreshed.invoices) {
      const where = classifyDeploymentDoc(linked.type, linked.id);
      if (where === 'document') docsBucket.push(linked);
      else invoicesBucket.push(linked);
    }

    const allItems = [
      ...docsBucket.flatMap((doc: any) => (doc.documentItems ?? [])),
      ...invoicesBucket.flatMap((inv: any) => (inv.documentItems ?? [])),
    ];
    const isServiceOnly = allItems.length > 0 && allItems.every((it: any) => it.isService === true);

    return {
      id: refreshed.id,
      deploymentNumber: refreshed.deploymentNumber,
      name: deploymentName(refreshed.deploymentNumber),
      type: refreshed.type,
      status: refreshed.status,
      description: refreshed.description,
      monthlyRate: refreshed.monthlyRate,
      currency: refreshed.currency,
      deployedDate: refreshed.deployedDate,
      offHiredDate: refreshed.offHiredDate,
      notes: refreshed.notes,
      isServiceOnly,
      sourceDocument: refreshed.sourceDocument,
      assignments: refreshed.assignments,
      documents: docsBucket.map(({ payments, config, ...rest }) => ({ ...rest })),
      // Mirror getProjectById: keep documentItems so the invoice expansion
      // can render line items the same way DOs do.
      invoices: invoicesBucket.map(({ payments, config, ...rest }) => ({
        ...rest,
        amount: readDocAmount(config),
        paid: payments.reduce((p: number, pay: any) => p + (pay.amount ?? 0), 0),
      })),
    };
  }

  async updateDeployment(
    deploymentId: string,
    organizationId: string,
    data: Partial<{
      description: string;
      monthlyRate: number;
      notes: string;
      offHiredDate: string;
      status: string;
    }>,
  ) {
    const existing = await this.prisma.projectDeployment.findFirst({
      where: { id: deploymentId, organizationId },
    });
    if (!existing) throw new HttpException('Deployment not found', HttpStatus.NOT_FOUND);

    return this.prisma.projectDeployment.update({
      where: { id: deploymentId },
      data: {
        description: data.description,
        monthlyRate: data.monthlyRate,
        notes: data.notes,
        offHiredDate: data.offHiredDate ? new Date(data.offHiredDate) : undefined,
        status: data.status ? (data.status as DeploymentStatus) : undefined,
      },
    });
  }

  async offHireDeployment(deploymentId: string, organizationId: string, offHiredDate?: string) {
    return this.updateDeployment(deploymentId, organizationId, {
      offHiredDate: offHiredDate ?? new Date().toISOString(),
      status: DeploymentStatus.OFF_HIRED,
    });
  }

  async addAssignmentsToProject(projectId: string, assignments: any[], organizationId: string) {
    console.log('Adding assignments to project:', projectId, assignments);
    try {
      const existingProject = await this.prisma.project.findFirst({
        where: {
          id: projectId,
          organizationId,
        },
      });

      if (!existingProject) {
        throw new HttpException('Project not found', HttpStatus.NOT_FOUND);
      }

      const createdAssignments = await this.prisma.assignment.createMany({
        data: assignments.map((assignment) => ({
          projectId,
          startDate: assignment.startDate ? new Date(assignment.startDate) : undefined,
          endDate: assignment.endDate ? new Date(assignment.endDate) : undefined,
          inventoryId: assignment.inventoryId,
          // TODO: support documentId from API when manual project flow is updated.
        })),
        skipDuplicates: true,
      });

      for (const assignment of assignments) {
        if (assignment.inventoryId && assignment.status) {
          await this.prisma.inventory.update({
            where: {
              id: assignment.inventoryId,
              organizationId, // Ensure inventory belongs to the same organization
            },
            data: { status: assignment.status as InventoryStatus },
          });
        }
      }

      return createdAssignments;
    } catch (error) {
      throw new HttpException(error.message, HttpStatus.INTERNAL_SERVER_ERROR);
    }
  }

  async createProject(createProjectDto: CreateProjectDto, organizationId: string) {
    try {
      const project = await this.prisma.project.create({
        data: {
          name: createProjectDto.name,
          siteOfficeId: createProjectDto.siteOfficeId,
          startDate: createProjectDto.startDate,
          endDate: createProjectDto.endDate,
          status: createProjectDto.status as ProjectStatus,
          organizationId: organizationId,
          assignments: {
            create: createProjectDto.assignments.map((assignment) => ({
              startDate: assignment.startDate ? new Date(assignment.startDate) : undefined,
              endDate: assignment.endDate ? new Date(assignment.endDate) : undefined,
              inventory: assignment.inventoryId
                ? {
                    connect: { id: assignment.inventoryId },
                  }
                : undefined,
            })),
          },
        },
        include: {
          assignments: {
            // Only ACTIVE assignments (soft-closed ones carry an endDate).
            where: { endDate: null },
            include: {
              inventory: { select: { sku: true, status: true } },
              asset: { select: { id: true, name: true, skuKey: true, uom: true } },
              document: { select: { id: true, name: true } },
            },
          },
          siteOffice: true,
        },
      });
      for (const assignment of createProjectDto.assignments) {
        if (assignment.inventoryId && assignment.status) {
          await this.prisma.inventory.update({
            where: {
              id: assignment.inventoryId,
              organizationId, // Ensure inventory belongs to the same organization
            },
            data: { status: assignment.status as InventoryStatus },
          });
        }
      }
      return project;
    } catch (error) {
      console.error('Error while creating project:', error);
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
        const target = (error.meta?.target as string[])?.join(', ') || 'field';
        throw new HttpException(`Project with the same ${target} already exists.`, HttpStatus.BAD_REQUEST);
      }
      throw new HttpException('An unexpected error occurred while creating the project.', HttpStatus.INTERNAL_SERVER_ERROR);
    }
  }

  async updateProject(id: string, updateProjectDto: UpdateProjectDto, organizationId: string) {
    try {
      const { assignments, ...updateData } = updateProjectDto;

      // Check if project exists
      const existingProject = await this.prisma.project.findFirst({
        where: {
          id,
          organizationId,
        },
      });

      if (!existingProject) {
        throw new HttpException('Project not found', HttpStatus.NOT_FOUND);
      }

      // Update the project
      const project = await this.prisma.project.update({
        where: {
          id,
          organizationId,
        },
        data: {
          ...updateData,
          assignments: assignments
            ? {
                deleteMany: {}, // Delete existing assignments
                create: assignments.map((assignment) => ({
                  startDate: assignment.startDate ? new Date(assignment.startDate) : undefined,
                  endDate: assignment.endDate ? new Date(assignment.endDate) : undefined,
                  inventory: assignment.inventoryId ? { connect: { id: assignment.inventoryId } } : undefined,
                })),
              }
            : undefined,
        },
        include: {
          assignments: {
            // Only ACTIVE assignments (soft-closed ones carry an endDate).
            where: { endDate: null },
            include: {
              inventory: { select: { sku: true, status: true } },
              asset: { select: { id: true, name: true, skuKey: true, uom: true } },
              document: { select: { id: true, name: true } },
            },
          },
          siteOffice: true,
        },
      });

      // Update inventory statuses if provided
      if (assignments) {
        for (const assignment of assignments) {
          if (assignment.inventoryId && assignment.status) {
            await this.prisma.inventory.update({
              where: {
                id: assignment.inventoryId,
                organizationId,
              },
              data: { status: assignment.status as InventoryStatus },
            });
          }
        }
      }

      return project;
    } catch (error) {
      throw new HttpException(error.message, HttpStatus.INTERNAL_SERVER_ERROR);
    }
  }

  async deleteProject(id: string, organizationId: string) {
    try {
      // Delete assignments first
      await this.prisma.assignment.deleteMany({
        where: { projectId: id },
      });

      const project = await this.prisma.project.delete({
        where: {
          id,
          organizationId,
        },
      });
      return project;
    } catch (error) {
      throw new HttpException(error.message, HttpStatus.INTERNAL_SERVER_ERROR);
    }
  }

  async createProjectByName(name: string, organizationId: string, customerId?: string) {
    try {
      const project = await this.prisma.project.create({
        data: {
          name,
          organizationId,
          status: ProjectStatus.pending, // default status
          // Optional direct customer link — used by the quotation editor's
          // "+ Create new project" flow so the project shows up under the
          // selected customer immediately.
          ...(customerId ? { customerId } : {}),
        },
      });
      return project;
    } catch (error) {
      throw new HttpException(error.message, HttpStatus.INTERNAL_SERVER_ERROR);
    }
  }
}
