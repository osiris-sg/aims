import { Body, Controller, Get, Param, Post, Query, Req, UseGuards } from '@nestjs/common';
import { Request } from 'express';
import { ApiBearerAuth, ApiOperation, ApiQuery, ApiTags } from '@nestjs/swagger';
import { ClerkAuthGuard } from '../auth/clerk-auth.guard';
import { Permissions } from '../auth/decorators/permissions.decorator';
import { JournalService } from './journal.service';
import { CreateJournalEntryDto } from './dto/journal-entry.dto';

interface RequestWithOrganization extends Request {
  userOrganization?: { id: string; name: string };
  auth?: { userId: string };
}

function requireOrgId(req: RequestWithOrganization): string {
  const id = req.userOrganization?.id;
  if (!id) throw new Error('User is not assigned to any organization');
  return id;
}

@ApiTags('journal')
@ApiBearerAuth()
@Controller('journal')
@UseGuards(ClerkAuthGuard)
export class JournalController {
  constructor(private readonly service: JournalService) {}

  @Get('entries')
  @Permissions('journal:read')
  @ApiOperation({ summary: 'List journal entries' })
  @ApiQuery({ name: 'status', required: false, description: 'DRAFT | POSTED | VOID' })
  @ApiQuery({ name: 'type', required: false })
  @ApiQuery({ name: 'startDate', required: false })
  @ApiQuery({ name: 'endDate', required: false })
  @ApiQuery({ name: 'sourceDocumentId', required: false })
  @ApiQuery({ name: 'sourcePaymentId', required: false })
  @ApiQuery({ name: 'page', required: false, type: Number })
  @ApiQuery({ name: 'limit', required: false, type: Number })
  list(@Req() req: RequestWithOrganization, @Query() q: any) {
    return this.service.findAll(requireOrgId(req), {
      status: q.status,
      type: q.type,
      sourceDocumentId: q.sourceDocumentId,
      sourcePaymentId: q.sourcePaymentId,
      startDate: q.startDate ? new Date(q.startDate) : undefined,
      endDate: q.endDate ? new Date(q.endDate) : undefined,
      page: q.page ? parseInt(q.page) : undefined,
      limit: q.limit ? parseInt(q.limit) : undefined,
    });
  }

  @Get('entries/:id')
  @Permissions('journal:read')
  get(@Req() req: RequestWithOrganization, @Param('id') id: string) {
    return this.service.findOne(requireOrgId(req), id);
  }

  @Post('entries')
  @Permissions('journal:create')
  create(@Req() req: RequestWithOrganization, @Body() dto: CreateJournalEntryDto) {
    return this.service.create(requireOrgId(req), dto, req.auth?.userId);
  }

  @Post('entries/:id/post')
  @Permissions('journal:post')
  post(@Req() req: RequestWithOrganization, @Param('id') id: string) {
    return this.service.post(requireOrgId(req), id, req.auth?.userId);
  }

  @Post('entries/:id/void')
  @Permissions('journal:void')
  void(@Req() req: RequestWithOrganization, @Param('id') id: string) {
    return this.service.void(requireOrgId(req), id, req.auth?.userId);
  }

  @Get('reports/trial-balance')
  @Permissions('journal:read')
  @ApiQuery({ name: 'asOfDate', required: false })
  trialBalance(@Req() req: RequestWithOrganization, @Query('asOfDate') asOfDate?: string) {
    return this.service.trialBalance(requireOrgId(req), asOfDate ? new Date(asOfDate) : undefined);
  }

  @Get('reports/general-ledger/:accountId')
  @Permissions('journal:read')
  @ApiQuery({ name: 'startDate', required: false })
  @ApiQuery({ name: 'endDate', required: false })
  generalLedger(
    @Req() req: RequestWithOrganization,
    @Param('accountId') accountId: string,
    @Query() q: any,
  ) {
    return this.service.generalLedger(requireOrgId(req), accountId, {
      startDate: q.startDate ? new Date(q.startDate) : undefined,
      endDate: q.endDate ? new Date(q.endDate) : undefined,
    });
  }
}
