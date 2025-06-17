import { Controller, Get, Param, Post, Body, HttpException, HttpStatus } from '@nestjs/common';
import { ProjectsService } from './projects.service';
import { CreateProjectDto } from './dto/create-project.dto';

@Controller('projects')
export class ProjectsController {
  constructor(private readonly projectsService: ProjectsService) {}

  @Get(':id')
  async getProjectById(@Param('id') id: string) {
    return this.projectsService.getProjectById(id);
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
}
