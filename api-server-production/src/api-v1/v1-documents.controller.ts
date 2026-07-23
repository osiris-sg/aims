import { Body, Controller, Get, Param, Post, Query, Req, UseGuards } from '@nestjs/common';
import { ApiOperation, ApiSecurity, ApiTags } from '@nestjs/swagger';
import { Public } from '../decorators/public.decorator';
import { ApiV1KeyGuard, RequireScope } from './api-v1-key.guard';
import { V1DocumentsService } from './v1-documents.service';
import { V1CreateDocumentDto } from './dto/v1-document.dto';

// External /v1 API. @Public() skips the global ClerkAuthGuard; ApiV1KeyGuard
// authenticates the per-org API key and injects req.userOrganization.

@ApiTags('v1 (external API)')
@ApiSecurity('api-key')
@Controller('v1')
export class V1DocumentsController {
  constructor(private readonly service: V1DocumentsService) {}

  @Public()
  @UseGuards(ApiV1KeyGuard)
  @RequireScope('documents:create')
  @Post('documents')
  @ApiOperation({
    summary:
      'Create a document (INVOICE, BILL, CREDIT_NOTE) from an external app. Idempotent per externalId. Requires an API key.',
  })
  create(@Req() req: any, @Body() dto: V1CreateDocumentDto) {
    return this.service.create(req.userOrganization.id, req.apiKey, dto);
  }

  @Public()
  @UseGuards(ApiV1KeyGuard)
  @RequireScope('documents:read')
  @Get('documents/:id')
  @ApiOperation({ summary: 'Fetch one document (status incl. GL posting state).' })
  get(@Req() req: any, @Param('id') id: string) {
    return this.service.get(req.userOrganization.id, id);
  }

  @Public()
  @UseGuards(ApiV1KeyGuard)
  @RequireScope('documents:read')
  @Get('documents')
  @ApiOperation({ summary: 'List documents (INVOICE/BILL/CREDIT_NOTE) for the key\'s organization.' })
  list(
    @Req() req: any,
    @Query('type') type?: string,
    @Query('page') page?: string,
    @Query('limit') limit?: string,
    @Query('search') search?: string,
  ) {
    return this.service.list(req.userOrganization.id, {
      type,
      page: page ? Number(page) : undefined,
      limit: limit ? Number(limit) : undefined,
      search,
    });
  }
}
