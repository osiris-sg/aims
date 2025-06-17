import { HttpException, HttpStatus, Injectable } from '@nestjs/common';
import { PrismaService } from 'src/common/prisma.service';
import { CreateProjectDto } from './dto/create-project.dto';
// import { UpdateProjectDto } from './dto/update-project.dto';
// import { DeleteProjectDto } from './dto/delete-project.dto';
// import { GetProjectDto } from './dto/get-project.dto';
import { Prisma } from '@prisma/client';
import { ProjectStatus } from '@prisma/client';
import { InventoryStatus } from '@prisma/client';

@Injectable()
export class ProjectsService {
  constructor(private prisma: PrismaService) {}

  //   async getProjects(getProjectDto: GetProjectDto) {
  //     try {
  //       const { organizationId, page, limit, search } = getProjectDto;
  //       const skip = (page - 1) * limit;

  //       const whereClause: any = { organizationId };
  //       whereClause.deletedAt = null;

  //       if (search) {
  //         whereClause.OR = [{ name: { contains: search, mode: 'insensitive' } }];
  //       }

  //       const projects = await this.prisma.project.findMany({
  //         where: whereClause,
  //         skip,
  //         take: limit,
  //         orderBy: { createdAt: 'desc' },
  //         include: {
  //           customer: true,
  //           assignments: true,
  //         },
  //       });

  //       const totalDocs = await this.prisma.project.count({ where: whereClause });

  //       return {
  //         docs: projects,
  //         hasNextPage: skip + projects.length < totalDocs,
  //         hasPreviousPage: page > 1,
  //         page,
  //         limit,
  //         totalPagesCount: Math.ceil(totalDocs / limit),
  //         totalDocuments: totalDocs,
  //       };
  //     } catch (error) {
  //       throw new HttpException(error.message, HttpStatus.INTERNAL_SERVER_ERROR);
  //     }
  //   }

  async getProjectById(id: string) {
    try {
      const project = await this.prisma.project.findUnique({
        where: { id },
        include: {
          customer: true,
          assignments: true,
        },
      });
      if (!project) throw new HttpException('Project not found', HttpStatus.NOT_FOUND);
      return project;
    } catch (error) {
      throw new HttpException(error.message, HttpStatus.INTERNAL_SERVER_ERROR);
    }
  }

  async createProject(createProjectDto: CreateProjectDto, organizationId: string) {
    console.log('Received DTO:', createProjectDto);
    console.log('Organization ID:', organizationId);
    try {
      console.log('Creating project in database...');
      const project = await this.prisma.project.create({
        data: {
          name: createProjectDto.name,
          customerId: createProjectDto.customerId,
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
        },
      });
      for (const assignment of createProjectDto.assignments) {
        console.log(`Processing assignment: ${JSON.stringify(assignment)}`);
        if (assignment.inventoryId && assignment.status) {
          console.log(`Updating inventory status for assignment: ${assignment.inventoryId} to ${assignment.status}`);
          await this.prisma.inventory.update({
            where: { id: assignment.inventoryId },
            data: { status: assignment.status as InventoryStatus },
          });
        }
      }
      console.log('Project created successfully:', project);
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

  //   async updateProject(updateProjectDto: UpdateProjectDto) {
  //     try {
  //       const { id, ...updateData } = updateProjectDto;

  //       if (!id) {
  //         throw new HttpException('Project ID is required', HttpStatus.BAD_REQUEST);
  //       }

  //       const project = await this.prisma.project.update({
  //         where: { id },
  //         data: updateData,
  //       });

  //       return project;
  //     } catch (error) {
  //       throw new HttpException(error.message, HttpStatus.INTERNAL_SERVER_ERROR);
  //     }
  //   }

  //   async deleteProject(deleteProjectDto: DeleteProjectDto) {
  //     try {
  //       const project = await this.prisma.project.update({
  //         where: { id: deleteProjectDto.id },
  //         data: { deletedAt: new Date() },
  //       });
  //       return project;
  //     } catch (error) {
  //       throw new HttpException(error.message, error.status || HttpStatus.INTERNAL_SERVER_ERROR);
  //     }
  //   }
}
