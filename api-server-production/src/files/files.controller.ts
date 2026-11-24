import { BadRequestException, Body, Controller, HttpCode, Post, Req } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { FilesService } from './files.service';

/**
 * POST /files/sign { keys: string[], downloadAs? } → { urls: { [key]: url | null }, expiresIn }.
 * Any signed-in member; each key must belong to one of the caller's orgs
 * (platform admins: any). URLs live ~10 minutes. Skipped by the Activity Log
 * (it fires for every image on a page); the record that shows the file is logged.
 */
@ApiTags('Files')
@Controller('files')
export class FilesController {
  constructor(private readonly files: FilesService) {}

  @Post('sign')
  @HttpCode(200)
  async sign(@Req() req: any, @Body() body: { keys?: unknown; downloadAs?: unknown }) {
    if (!Array.isArray(body?.keys)) throw new BadRequestException('keys must be an array');
    if (body.keys.length > 200) throw new BadRequestException('At most 200 keys');
    const downloadAs = typeof body.downloadAs === 'string' && body.downloadAs.trim() ? body.downloadAs.trim().slice(0, 200) : undefined;
    const urls = await this.files.sign(body.keys, { userId: req.user?.id, activeOrgId: req.userOrganization?.id, platform: !!req.isOsirisAdmin }, { downloadAs });
    return { urls, expiresIn: 600 };
  }
}
