import { Controller, Get, Param, Post, Body, HttpException, HttpStatus } from '@nestjs/common';
import { ProjectsService } from './projects.service';
import { CreateProjectDto } from './dto/create-project.dto';
import { GetProjectDto } from './dto/get-project.dto';

@Controller('projects')
export class ProjectsController {
  constructor(private readonly projectsService: ProjectsService) {}

  @Get(':id')
  async getProjectById(@Param('id') id: string) {
    return this.projectsService.getProjectById(id);
  }
  @Post()
  async getInventories(@Body() getProjectDto: GetProjectDto) {
    return await this.projectsService.getProjects(getProjectDto);
  }

  @Post('create')
  async createProject(@Body() body: { organizationId: string; data: CreateProjectDto }) {
    console.log('Incoming createProject request body:', body);
    try {
      return await this.projectsService.createProject(body.data, body.organizationId);
    } catch (error) {
      console.error('Error occurred in createProject:', error);
      throw new HttpException('An unexpected error occurred while creating the project.', HttpStatus.INTERNAL_SERVER_ERROR);
    }
  }
  @Post('create-by-name')
  async createProjectByName(@Body() body: { name: string; organizationId: string }) {
    try {
      return await this.projectsService.createProjectByName(body.name, body.organizationId);
    } catch (error) {
      console.error('Error occurred in createProjectByName:', error);
      throw new HttpException('An unexpected error occurred while creating the project by name.', HttpStatus.INTERNAL_SERVER_ERROR);
    }
  }

  @Post(':id/assignments')
  async addAssignmentsToProject(@Param('id') projectId: string, @Body() body: { assignments: any[] }) {
    try {
      return await this.projectsService.addAssignmentsToProject(projectId, body.assignments);
    } catch (error) {
      console.error('Error adding assignments to project:', error);
      throw new HttpException('Failed to add assignments to project.', HttpStatus.INTERNAL_SERVER_ERROR);
    }
  }
}
