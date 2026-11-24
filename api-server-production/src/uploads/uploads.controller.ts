import { BadRequestException, Body, Controller, ForbiddenException, Post, Req, UploadedFile, UseInterceptors } from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { UploadsService } from './uploads.service';
import { IdempotencyInterceptor } from 'src/common/idempotency/idempotency.interceptor';
import { Permissions } from 'src/auth/decorators/permissions.decorator';
import { UserOrganization } from 'src/auth/decorators/user-organization.decorator';

@Controller('uploads')
export class UploadsController {
  constructor(private readonly uploadsService: UploadsService) {}

  @Post('image')
  @Permissions('uploads:upload-image')
  // Idempotency-Key: a resent photo upload stores once (the file counts towards "the same request").
  @UseInterceptors(FileInterceptor('file'), IdempotencyInterceptor)
  // The server builds the key (org/<orgId>/<folder>/<uuid>.<ext>): the client's
  // `key` / `folder` only picks the folder from the allow-list, never the path.
  async uploadImage(
    @UploadedFile() file: Express.Multer.File,
    @Body() body: { key?: string; folder?: string },
    @UserOrganization() org: { id: string } | null,
    @Req() req?: any,
  ) {
    if (!file) throw new BadRequestException('No file uploaded');
    if (!org?.id) throw new ForbiddenException('No organisation');
    const hasFolder = typeof body?.folder === 'string' && body.folder.trim();
    const Key = await this.uploadsService.uploadOrgFile({
      file,
      organizationId: org.id,
      folderHint: hasFolder ? body.folder : body?.key,
      hintIsKey: !hasFolder,
      uploadedBy: req?.user?.id ?? null,
    });
    return { Key };
  }
}
