import { Controller, Get, Param, Post, Body, Delete, HttpException, HttpStatus, Req, UseGuards } from '@nestjs/common';
import { ProjectsService } from './projects.service';
import { CreateProjectDto } from './dto/create-project.dto';
import { GetProjectDto } from './dto/get-project.dto';
import { ClerkAuthGuard } from 'src/auth/clerk-auth.guard';
import { Request } from 'express';
import { Permissions } from 'src/auth/decorators/permissions.decorator';

// Extend Request type to include userOrganization
interface RequestWithOrganization extends Request {
  userOrganization?: {
    id: string;
    name: string;
  };
}

@Controller('projects')
@UseGuards(ClerkAuthGuard)
export class ProjectsController {
  constructor(private readonly projectsService: ProjectsService) {}

  @Get(':id')
  @Permissions('projects:read-one')
  async getProjectById(@Param('id') id: string, @Req() req: RequestWithOrganization) {
    const organizationId = req.userOrganization?.id;
    if (!organizationId) {
      throw new Error('User is not assigned to any organization');
    }
    return this.projectsService.getProjectById(id, organizationId);
  }
  @Post()
  @Permissions('projects:read')
  async getInventories(@Body() getProjectDto: GetProjectDto, @Req() req: RequestWithOrganization) {
    const organizationId = req.userOrganization?.id;
    if (!organizationId) {
      throw new Error('User is not assigned to any organization');
    }
    return await this.projectsService.getProjects(getProjectDto, organizationId);
  }

  @Post('create')
  @Permissions('projects:create')
  async createProject(@Body() createProjectDto: CreateProjectDto, @Req() req: RequestWithOrganization) {
    console.log('Incoming createProject request body:', createProjectDto);
    try {
      const organizationId = req.userOrganization?.id;
      if (!organizationId) {
        throw new Error('User is not assigned to any organization');
      }
      return await this.projectsService.createProject(createProjectDto, organizationId);
    } catch (error) {
      console.error('Error occurred in createProject:', error);
      throw new HttpException('An unexpected error occurred while creating the project.', HttpStatus.INTERNAL_SERVER_ERROR);
    }
  }
  @Post('create-by-name')
  @Permissions('projects:create-by-name')
  async createProjectByName(
    @Body() body: { name: string; customerId?: string },
    @Req() req: RequestWithOrganization,
  ) {
    try {
      const organizationId = req.userOrganization?.id;
      if (!organizationId) {
        throw new Error('User is not assigned to any organization');
      }
      return await this.projectsService.createProjectByName(
        body.name,
        organizationId,
        body.customerId,
      );
    } catch (error) {
      console.error('Error occurred in createProjectByName:', error);
      throw new HttpException('An unexpected error occurred while creating the project by name.', HttpStatus.INTERNAL_SERVER_ERROR);
    }
  }

  @Post(':id/assignments')
  @Permissions('projects:add-assignments')
  async addAssignmentsToProject(@Param('id') projectId: string, @Body() body: { assignments: any[] }, @Req() req: RequestWithOrganization) {
    try {
      const organizationId = req.userOrganization?.id;
      if (!organizationId) {
        throw new Error('User is not assigned to any organization');
      }
      return await this.projectsService.addAssignmentsToProject(projectId, body.assignments, organizationId);
    } catch (error) {
      console.error('Error adding assignments to project:', error);
      throw new HttpException('Failed to add assignments to project.', HttpStatus.INTERNAL_SERVER_ERROR);
    }
  }

  // Field bind flow: create a Deployment + single-item DO for a freshly
  // bound inventory unit. Reuses the add-assignments permission — it's the
  // same "field tech attaches an item to a project" capability.
  @Post(':id/field-deploy')
  @Permissions('projects:add-assignments')
  async fieldDeploy(
    @Param('id') projectId: string,
    @Body() body: { inventoryId: string; assetId: string },
    @Req() req: RequestWithOrganization,
  ) {
    const organizationId = req.userOrganization?.id;
    if (!organizationId) {
      throw new Error('User is not assigned to any organization');
    }
    return this.projectsService.fieldDeploy(projectId, organizationId, body);
  }

  // ---- Deployments ----------------------------------------------------------

  @Get(':id/deployments')
  @Permissions('projects:read-one')
  async listDeployments(@Param('id') projectId: string, @Req() req: RequestWithOrganization) {
    const organizationId = req.userOrganization?.id;
    if (!organizationId) throw new Error('User is not assigned to any organization');
    return this.projectsService.listDeployments(projectId, organizationId);
  }

  @Post(':id/deployments')
  @Permissions('projects:update')
  async createDeployment(
    @Param('id') projectId: string,
    @Body() body: any,
    @Req() req: RequestWithOrganization,
  ) {
    const organizationId = req.userOrganization?.id;
    if (!organizationId) throw new Error('User is not assigned to any organization');
    return this.projectsService.createDeployment(projectId, organizationId, body);
  }

  @Post('deployments/:deploymentId/update')
  @Permissions('projects:update')
  async updateDeployment(
    @Param('deploymentId') deploymentId: string,
    @Body() body: any,
    @Req() req: RequestWithOrganization,
  ) {
    const organizationId = req.userOrganization?.id;
    if (!organizationId) throw new Error('User is not assigned to any organization');
    return this.projectsService.updateDeployment(deploymentId, organizationId, body);
  }

  @Post('deployments/:deploymentId/off-hire')
  @Permissions('projects:update')
  async offHireDeployment(
    @Param('deploymentId') deploymentId: string,
    @Body() body: { offHiredDate?: string },
    @Req() req: RequestWithOrganization,
  ) {
    const organizationId = req.userOrganization?.id;
    if (!organizationId) throw new Error('User is not assigned to any organization');
    return this.projectsService.offHireDeployment(deploymentId, organizationId, body?.offHiredDate);
  }

  @Post('deployments/:deploymentId/attach-document')
  @Permissions('projects:update')
  async attachDocumentToDeployment(
    @Param('deploymentId') deploymentId: string,
    @Body() body: { documentId: string },
    @Req() req: RequestWithOrganization,
  ) {
    const organizationId = req.userOrganization?.id;
    if (!organizationId) throw new Error('User is not assigned to any organization');
    return this.projectsService.attachDocumentToDeployment(deploymentId, body.documentId, organizationId);
  }

  @Delete(':id')
  @Permissions('projects:delete')
  async deleteProject(@Param('id') id: string, @Req() req: RequestWithOrganization) {
    try {
      const organizationId = req.userOrganization?.id;
      if (!organizationId) {
        throw new Error('User is not assigned to any organization');
      }
      return await this.projectsService.deleteProject(id, organizationId);
    } catch (error) {
      console.error('Error occurred in deleteProject:', error);
      throw new HttpException('An unexpected error occurred while deleting the project.', HttpStatus.INTERNAL_SERVER_ERROR);
    }
  }

  @Post(':id/update')
  @Permissions('projects:update')
  async updateProject(@Param('id') id: string, @Body() updateProjectDto: any, @Req() req: RequestWithOrganization) {
    try {
      const organizationId = req.userOrganization?.id;
      if (!organizationId) {
        throw new Error('User is not assigned to any organization');
      }
      return await this.projectsService.updateProject(id, updateProjectDto, organizationId);
    } catch (error) {
      console.error('Error occurred in updateProject:', error);
      throw new HttpException('An unexpected error occurred while updating the project.', HttpStatus.INTERNAL_SERVER_ERROR);
    }
  }
}
