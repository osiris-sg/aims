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
  async createProject(@Body() createProjectDto: CreateProjectDto) {
    try {
      return await this.projectsService.createProject(createProjectDto);
    } catch (error) {
      throw new HttpException(error.message, error.status || HttpStatus.INTERNAL_SERVER_ERROR);
    }
  }
}
