import { Controller, ForbiddenException, Get, Query, Req } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { AiUsageService } from './ai-usage.service';

/** Round BM — AIMEE / operator token usage, platform admins only (the Admin panel's AI usage page). */
@ApiTags('admin')
@ApiBearerAuth()
@Controller('admin/ai-usage')
export class AiUsageController {
  constructor(private readonly usage: AiUsageService) {}

  @Get()
  @ApiOperation({ summary: 'AIMEE token usage per org and user (platform admins)' })
  async summary(@Req() req: any, @Query('days') days?: string) {
    if (!req?.isOsirisAdmin) throw new ForbiddenException('Platform admins only');
    const n = Math.min(90, Math.max(1, Number(days) || 7));
    return this.usage.summary(n);
  }
}
