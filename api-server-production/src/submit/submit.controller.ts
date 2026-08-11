import {
  Body,
  Controller,
  Get,
  HttpCode,
  Param,
  Post,
  Query,
  Req,
  UnauthorizedException,
  UploadedFiles,
  UseInterceptors,
} from '@nestjs/common';
import { FilesInterceptor } from '@nestjs/platform-express';
import { ApiTags } from '@nestjs/swagger';
import { Request } from 'express';
import { Permissions } from '../auth/decorators/permissions.decorator';
import { SubmitService } from './submit.service';

interface OrgRequest extends Request {
  userOrganization?: { id: string };
  user?: { id?: string };
}

/**
 * Async /submit intake. `POST jobs` persists files + queues (202, nothing
 * extracted in-request); the worker (SubmitService @Cron) does extraction +
 * draft creation. Reuses existing permissions so no RBAC seeding is needed:
 * intake + own-history need documents:create-basic (the normal_user role has
 * it); the admin log + retry need documents:read (normal users don't).
 */
@ApiTags('submit')
@Controller('submit')
export class SubmitController {
  constructor(private readonly service: SubmitService) {}

  @Post('jobs')
  @HttpCode(202)
  @Permissions('documents:create-basic')
  @UseInterceptors(FilesInterceptor('files', 20, { limits: { fileSize: 15 * 1024 * 1024 } }))
  async intake(
    @UploadedFiles() files: Express.Multer.File[],
    @Body() body: { docType: string; batchId?: string },
    @Req() req: OrgRequest,
  ) {
    const organizationId = req.userOrganization?.id;
    const userId = req.user?.id;
    if (!organizationId || !userId) throw new UnauthorizedException('Missing organization or user');
    return this.service.intake(organizationId, userId, body.docType, files, body.batchId);
  }

  @Get('jobs/mine')
  @Permissions('documents:create-basic')
  async mine(@Req() req: OrgRequest) {
    const organizationId = req.userOrganization?.id;
    const userId = req.user?.id;
    if (!organizationId || !userId) throw new UnauthorizedException('Missing organization or user');
    return this.service.mine(organizationId, userId);
  }

  @Get('jobs')
  @Permissions('documents:read')
  async list(@Req() req: OrgRequest, @Query('status') status?: string) {
    const organizationId = req.userOrganization?.id;
    if (!organizationId) throw new UnauthorizedException('Missing organization');
    return this.service.list(organizationId, status);
  }

  @Post('jobs/:id/retry')
  @Permissions('documents:read')
  async retry(@Param('id') id: string, @Req() req: OrgRequest) {
    const organizationId = req.userOrganization?.id;
    if (!organizationId) throw new UnauthorizedException('Missing organization');
    return this.service.retry(organizationId, id);
  }
}
