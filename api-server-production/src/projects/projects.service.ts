import { HttpException, HttpStatus, Injectable } from '@nestjs/common';
import { PrismaService } from 'src/common/prisma.service';
import { CreateProjectDto } from './dto/create-project.dto';
import { UpdateProjectDto } from './dto/update-project.dto';
// import { DeleteProjectDto } from './dto/delete-project.dto';
import { GetProjectDto } from './dto/get-project.dto';
import { Prisma, DeploymentType, DeploymentStatus } from '@prisma/client';
import { ProjectStatus } from '@prisma/client';
import { InventoryStatus } from '@prisma/client';

// Try a few common JSON paths to extract the nett invoice total
function readDocAmount(config: any): number {
  if (!config || typeof config !== 'object') return 0;
  const cand =
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

@Injectable()
export class ProjectsService {
  constructor(private prisma: PrismaService) {}

  async getProjects(getProjectDto: GetProjectDto, organizationId: string) {
    try {
      const { page, limit, search, filters } = getProjectDto;
      const skip = (page - 1) * limit;

      const whereClause: any = { organizationId };

      if (search) {
        whereClause.OR = [{ name: { contains: search, mode: 'insensitive' } }];
      }

      // Filter by customer if provided
      if (filters?.customerId) {
        whereClause.siteOffice = {
          customer: {
            id: filters.customerId,
          },
        };
      }

      const projects = await this.prisma.project.findMany({
        where: whereClause,
        skip,
        take: limit,
        orderBy: { createdAt: 'desc' },
        include: {
          siteOffice: {
            include: {
              customer: true,
            },
          },
          assignments: {
            include: {
              inventory: { select: { sku: true, status: true } },
              asset: { select: { id: true, name: true, skuKey: true, uom: true } },
              document: { select: { id: true, name: true } },
            },
          },
        },
      });

      const totalDocs = await this.prisma.project.count({ where: whereClause });

      return {
        docs: projects.map((project) => ({
          id: project.id,
          name: project.name,
          siteOffice: project.siteOffice ? { name: project.siteOffice.name } : null,
          customer: project.siteOffice?.customer ? { name: project.siteOffice.customer.name, id: project.siteOffice.customer.id } : null,
          itemsRelated: project.assignments || [],
          startDate: project.startDate,
          endDate: project.endDate,
          status: project.status,
        })),
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
            include: {
              inventory: { select: { sku: true, status: true } },
              asset: { select: { id: true, name: true, skuKey: true, uom: true } },
              document: { select: { id: true, name: true } },
            },
          },
          deployments: {
            orderBy: [{ status: 'asc' }, { deployedDate: 'desc' }],
            include: {
              sourceDocument: { select: { id: true, name: true, type: true, createdAt: true } },
              assignments: {
                include: {
                  asset: { select: { id: true, name: true, skuKey: true, uom: true } },
                  inventory: { select: { id: true, sku: true, status: true } },
                },
              },
              invoices: {
                select: {
                  id: true,
                  name: true,
                  type: true,
                  status: true,
                  createdAt: true,
                  config: true,
                  payments: { select: { amount: true, paymentDate: true } },
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

      // Per-deployment rollups
      const deployments = project.deployments.map((d) => {
        const totalBilled = d.invoices.reduce((s, inv) => s + readDocAmount(inv.config), 0);
        const totalPaid = d.invoices.reduce(
          (s, inv) => s + inv.payments.reduce((p, pay) => p + (pay.amount ?? 0), 0),
          0,
        );
        const lastInvoice = d.invoices[d.invoices.length - 1] ?? null;
        return {
          id: d.id,
          type: d.type,
          status: d.status,
          description: d.description,
          monthlyRate: d.monthlyRate,
          currency: d.currency,
          deployedDate: d.deployedDate,
          offHiredDate: d.offHiredDate,
          notes: d.notes,
          sourceDocument: d.sourceDocument,
          assignments: d.assignments,
          invoices: d.invoices.map(({ payments, config, ...rest }) => ({
            ...rest,
            amount: readDocAmount(config),
            paid: payments.reduce((p, pay) => p + (pay.amount ?? 0), 0),
          })),
          totalBilled,
          totalPaid,
          outstanding: totalBilled - totalPaid,
          invoiceCount: d.invoices.length,
          lastInvoiceDate: lastInvoice?.createdAt ?? null,
          lastInvoiceName: lastInvoice?.name ?? null,
        };
      });

      // Project-level rollup (every linked document, deployment-attached or standalone)
      const allDocs = project.documents;
      const projectTotalBilled = allDocs.reduce((s, d) => s + readDocAmount(d.config), 0);
      const projectTotalPaid = allDocs.reduce(
        (s, d) => s + d.payments.reduce((p, pay) => p + (pay.amount ?? 0), 0),
        0,
      );

      // Standalone (sales/services not bound to a deployment)
      const standaloneDocs = allDocs
        .filter((d) => !d.projectDeploymentId)
        .map(({ payments, config, ...rest }) => ({
          ...rest,
          amount: readDocAmount(config),
          paid: payments.reduce((p, pay) => p + (pay.amount ?? 0), 0),
        }));

      // Flat chronological invoice list
      const allInvoices = allDocs.map(({ payments, config, ...rest }) => ({
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
        standaloneDocs,
        allInvoices,
        totals: {
          billed: projectTotalBilled,
          paid: projectTotalPaid,
          outstanding: projectTotalBilled - projectTotalPaid,
          deploymentCount: deployments.length,
          activeDeployments: deployments.filter((d) => d.status === 'ACTIVE').length,
          invoiceCount: allDocs.length,
        },
      };
    } catch (error) {
      throw new HttpException(error.message, HttpStatus.INTERNAL_SERVER_ERROR);
    }
  }

  // ---- Deployment CRUD --------------------------------------------------

  async listDeployments(projectId: string, organizationId: string) {
    return this.prisma.projectDeployment.findMany({
      where: { projectId, organizationId },
      orderBy: [{ status: 'asc' }, { deployedDate: 'desc' }],
      include: {
        sourceDocument: { select: { id: true, name: true } },
        assignments: {
          include: {
            asset: { select: { id: true, name: true, skuKey: true } },
            inventory: { select: { id: true, sku: true } },
          },
        },
        _count: { select: { invoices: true } },
      },
    });
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

    return this.prisma.projectDeployment.create({
      data: {
        projectId,
        organizationId,
        type: (data.type as DeploymentType) ?? DeploymentType.RENTAL,
        description: data.description,
        monthlyRate: data.monthlyRate,
        currency: data.currency ?? 'SGD',
        deployedDate: data.deployedDate ? new Date(data.deployedDate) : new Date(),
        sourceDocumentId: data.sourceDocumentId,
        notes: data.notes,
      },
    });
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

  async createProjectByName(name: string, organizationId: string) {
    try {
      const project = await this.prisma.project.create({
        data: {
          name,
          organizationId,
          status: ProjectStatus.pending, // default status
        },
      });
      return project;
    } catch (error) {
      throw new HttpException(error.message, HttpStatus.INTERNAL_SERVER_ERROR);
    }
  }
}
