import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Patch,
  Post,
  Query,
  Req,
  UseGuards,
} from '@nestjs/common';
import { Request } from 'express';
import { ApiBearerAuth, ApiOperation, ApiQuery, ApiTags } from '@nestjs/swagger';
import { ClerkAuthGuard } from '../auth/clerk-auth.guard';
import { Permissions } from '../auth/decorators/permissions.decorator';
import { BillsService } from './bills.service';

interface RequestWithOrganization extends Request {
  userOrganization?: { id: string; name: string };
  auth?: { userId: string };
}

function requireOrgId(req: RequestWithOrganization): string {
  const id = req.userOrganization?.id;
  if (!id) throw new Error('User is not assigned to any organization');
  return id;
}

@ApiTags('bills')
@ApiBearerAuth()
@Controller('bills')
@UseGuards(ClerkAuthGuard)
export class BillsController {
  constructor(private readonly service: BillsService) {}

  @Get()
  @Permissions('bills:read')
  @ApiQuery({ name: 'status', required: false })
  @ApiQuery({ name: 'supplierId', required: false })
  @ApiQuery({ name: 'startDate', required: false })
  @ApiQuery({ name: 'endDate', required: false })
  list(@Req() req: RequestWithOrganization, @Query() q: any) {
    return this.service.list(requireOrgId(req), {
      status: q.status,
      supplierId: q.supplierId,
      startDate: q.startDate ? new Date(q.startDate) : undefined,
      endDate: q.endDate ? new Date(q.endDate) : undefined,
      limit: q.limit ? parseInt(q.limit) : undefined,
    });
  }

  @Get('aging')
  @Permissions('bills:read')
  @ApiQuery({ name: 'asOfDate', required: false })
  aging(@Req() req: RequestWithOrganization, @Query('asOfDate') asOfDate?: string) {
    return this.service.apAging(requireOrgId(req), asOfDate ? new Date(asOfDate) : undefined);
  }

  @Get(':id')
  @Permissions('bills:read')
  findOne(@Req() req: RequestWithOrganization, @Param('id') id: string) {
    return this.service.findOne(requireOrgId(req), id);
  }

  @Post()
  @Permissions('bills:create')
  create(@Req() req: RequestWithOrganization, @Body() body: any) {
    return this.service.create(requireOrgId(req), req.auth?.userId, body);
  }

  @Patch(':id')
  @Permissions('bills:update')
  update(@Req() req: RequestWithOrganization, @Param('id') id: string, @Body() body: any) {
    return this.service.update(requireOrgId(req), id, body);
  }

  @Post(':id/submit')
  @Permissions('bills:create')
  @ApiOperation({ summary: 'Submit a DRAFT — routes to PENDING_APPROVAL or posts immediately based on threshold' })
  submit(@Req() req: RequestWithOrganization, @Param('id') id: string) {
    return this.service.submit(requireOrgId(req), id, req.auth?.userId);
  }

  @Post(':id/approve')
  @Permissions('bills:approve')
  approve(@Req() req: RequestWithOrganization, @Param('id') id: string) {
    return this.service.approve(requireOrgId(req), id, req.auth?.userId);
  }

  @Post(':id/reject')
  @Permissions('bills:approve')
  reject(@Req() req: RequestWithOrganization, @Param('id') id: string) {
    return this.service.reject(requireOrgId(req), id, req.auth?.userId);
  }

  @Delete(':id')
  @Permissions('bills:update')
  voidBill(@Req() req: RequestWithOrganization, @Param('id') id: string) {
    return this.service.voidBill(requireOrgId(req), id, req.auth?.userId);
  }

  @Post('from-po/:poId')
  @Permissions('bills:create')
  @ApiOperation({ summary: 'Create a DRAFT bill from an existing PO (3-way match)' })
  fromPo(@Req() req: RequestWithOrganization, @Param('poId') poId: string) {
    return this.service.createFromPo(requireOrgId(req), poId, req.auth?.userId);
  }

  @Post('extract')
  @Permissions('bills:create')
  @ApiOperation({ summary: 'Extract bill data from an uploaded PDF/image via Claude vision — returns parsed structure for review' })
  extract(
    @Req() req: RequestWithOrganization,
    @Body() body: { base64: string; mediaType?: 'application/pdf' | 'image/jpeg' | 'image/png' | 'image/webp' },
  ) {
    return this.service.extractFromFile(requireOrgId(req), body.base64, body.mediaType ?? 'application/pdf');
  }

  // ---------- Payment Voucher ----------
  @Get(':id/payments')
  @Permissions('bills:read')
  listPayments(@Req() req: RequestWithOrganization, @Param('id') id: string) {
    return this.service.listPayments(requireOrgId(req), id);
  }

  @Post(':id/payments')
  @Permissions('bills:update')
  @ApiOperation({ summary: 'Record a payment against a POSTED bill — creates BillPayment + JE + updates amountPaid' })
  recordPayment(
    @Req() req: RequestWithOrganization,
    @Param('id') id: string,
    @Body() body: {
      amount: number;
      paymentDate: string;
      paymentMethod: string;
      bankAccountId: string;
      reference?: string;
      notes?: string;
      attachments?: Array<{ fileKey: string; fileName: string; mimeType?: string; label?: string }>;
    },
  ) {
    return this.service.recordPayment(requireOrgId(req), id, body, req.auth?.userId || 'unknown');
  }

  // ---------- Attachments on the bill itself ----------
  @Post(':id/attachments')
  @Permissions('bills:update')
  @ApiOperation({ summary: 'Append files (already uploaded via /uploads/image) to the bill' })
  addAttachments(
    @Req() req: RequestWithOrganization,
    @Param('id') id: string,
    @Body() body: { files: Array<{ fileKey: string; fileName: string; mimeType?: string; label?: string }> },
  ) {
    return this.service.addAttachments(requireOrgId(req), id, body.files || [], req.auth?.userId || 'unknown');
  }
}
