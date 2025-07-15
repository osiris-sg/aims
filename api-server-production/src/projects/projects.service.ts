import { HttpException, HttpStatus, Injectable } from '@nestjs/common';
import { PrismaService } from 'src/common/prisma.service';
import { CreateProjectDto } from './dto/create-project.dto';
// import { UpdateProjectDto } from './dto/update-project.dto';
// import { DeleteProjectDto } from './dto/delete-project.dto';
import { GetProjectDto } from './dto/get-project.dto';
import { Prisma } from '@prisma/client';
import { ProjectStatus } from '@prisma/client';
import { InventoryStatus } from '@prisma/client';

@Injectable()
export class ProjectsService {
  constructor(private prisma: PrismaService) {}

  async getProjects(getProjectDto: GetProjectDto, organizationId: string) {
    try {
      const { page, limit, search } = getProjectDto;
      const skip = (page - 1) * limit;

      const whereClause: any = { organizationId };

      if (search) {
        whereClause.OR = [{ name: { contains: search, mode: 'insensitive' } }];
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
          assignments: true,
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
        where: {
          id,
          organizationId,
        },
        include: {
          siteOffice: {
            select: {
              customer: true,
            },
          },
          assignments: true,
        },
      });
      if (!project) throw new HttpException('Project not found', HttpStatus.NOT_FOUND);
      return project;
    } catch (error) {
      throw new HttpException(error.message, HttpStatus.INTERNAL_SERVER_ERROR);
    }
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
          documentId: assignment.documentId,
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
              document: undefined,
            })),
          },
        },
        include: {
          assignments: true,
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

  //   async updateProject(updateProjectDto: UpdateProjectDto, organizationId: string) {
  //     try {
  //       const { id, ...updateData } = updateProjectDto;

  //       if (!id) {
  //         throw new HttpException('Project ID is required', HttpStatus.BAD_REQUEST);
  //       }

  //       const project = await this.prisma.project.update({
  //         where: {
  //           id,
  //           organizationId
  //         },
  //         data: updateData,
  //       });

  //       return project;
  //     } catch (error) {
  //       throw new HttpException(error.message, HttpStatus.INTERNAL_SERVER_ERROR);
  //     }
  //   }

  //   async deleteProject(deleteProjectDto: DeleteProjectDto, organizationId: string) {
  //     try {
  //       const project = await this.prisma.project.update({
  //         where: {
  //           id: deleteProjectDto.id,
  //           organizationId
  //         },
  //         data: { deletedAt: new Date() },
  //       });
  //       return project;
  //     } catch (error) {
  //       throw new HttpException(error.message, error.status || HttpStatus.INTERNAL_SERVER_ERROR);
  //     }
  //   }

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
