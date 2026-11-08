import { Body, Controller, Delete, Get, Param, Patch, Post, Query, Req, UseGuards } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { ClerkAuthGuard } from '../auth/clerk-auth.guard';
import { Permissions } from '../auth/decorators/permissions.decorator';
import { PayablesService } from './payables.service';

function orgId(req: any): string {
  const id = req.userOrganization?.id;
  if (!id) throw new Error('User is not assigned to any organization');
  return id;
}
function actorName(req: any): string | null {
  const u: any = req.user || {};
  return [u.firstName, u.lastName].filter(Boolean).join(' ') || u.emailAddresses?.[0]?.emailAddress || null;
}

/**
 * Monthly supplier payables — the AIMS version of the office's "outgoing
 * payments" sheet. Rows arrive from the bills WhatsApp group (the bridge posts
 * to /whatsapp/group-ingest) or are added by hand; a payment date marks a row
 * PAID. Permissions ride on projects:* like Advances (same audience).
 */
@ApiTags('payables')
@UseGuards(ClerkAuthGuard)
@Controller('payables')
export class PayablesController {
  constructor(private readonly service: PayablesService) {}

  @Get()
  @Permissions('projects:read')
  @ApiOperation({
    summary:
      'Monthly payables tally: ?month=YYYY-MM (default current) & ?status=to_pay|paid. Returns rows (invoiceNo, supplierName, siteAddress, invoiceAmount, percentage, paymentAmount, paymentDate, remarks, projectName, attachmentUrl), the months that have rows, and totals {toPay, paid, all}.',
  })
  list(@Req() req: any, @Query('month') month?: string, @Query('status') status?: string) {
    return this.service.list(orgId(req), { month, status });
  }

  @Get('recurring')
  @Permissions('projects:read')
  @ApiOperation({ summary: 'Standing monthly payables (rent etc.) — materialised onto the tally once per month' })
  listRecurring(@Req() req: any) {
    return this.service.listRecurring(orgId(req));
  }

  @Post('recurring')
  @Permissions('projects:update')
  @ApiOperation({ summary: 'Add a recurring payable: supplierName, description, amount, percentage?, dayOfMonth? (1-28)' })
  createRecurring(@Req() req: any, @Body() dto: any) {
    return this.service.createRecurring(orgId(req), dto || {});
  }

  @Patch('recurring/:id')
  @Permissions('projects:update')
  @ApiOperation({ summary: 'Edit a recurring payable (set active:false to pause it)' })
  updateRecurring(@Req() req: any, @Param('id') id: string, @Body() dto: any) {
    return this.service.updateRecurring(orgId(req), id, dto || {});
  }

  @Delete('recurring/:id')
  @Permissions('projects:update')
  @ApiOperation({ summary: 'Delete a recurring payable template (already-created month rows stay)' })
  removeRecurring(@Req() req: any, @Param('id') id: string) {
    return this.service.removeRecurring(orgId(req), id);
  }

  @Get('project-options')
  @Permissions('projects:read')
  @ApiOperation({ summary: 'Light project list {id, name, address} for linking a payable to a project (verifying the site address against the project files)' })
  projectOptions(@Req() req: any) {
    return this.service.projectOptions(orgId(req));
  }

  @Post()
  @Permissions('projects:update')
  @ApiOperation({ summary: 'Add a payable row by hand (invoiceNo, supplierName, siteAddress, invoiceAmount, percentage, remarks, month)' })
  create(@Req() req: any, @Body() dto: any) {
    return this.service.create(orgId(req), dto || {}, actorName(req));
  }

  @Patch(':id')
  @Permissions('projects:update')
  @ApiOperation({ summary: "Edit a payable row's cells; amount/percentage changes re-derive the payment amount" })
  update(@Req() req: any, @Param('id') id: string, @Body() dto: any) {
    return this.service.update(orgId(req), id, dto || {});
  }

  @Post(':id/pay')
  @Permissions('projects:update')
  @ApiOperation({ summary: 'Mark a payable PAID (optional paymentDate YYYY-MM-DD, defaults today)' })
  pay(@Req() req: any, @Param('id') id: string, @Body() dto: { paymentDate?: string; approvedBy?: string }) {
    return this.service.markPaid(orgId(req), id, dto || {}, actorName(req));
  }

  @Post(':id/unpay')
  @Permissions('projects:update')
  @ApiOperation({ summary: 'Put a payable back to TO PAY (clears the payment date / releases a withholding)' })
  unpay(@Req() req: any, @Param('id') id: string) {
    return this.service.markUnpaid(orgId(req), id);
  }

  @Post('match-payment')
  @Permissions('projects:update')
  @ApiOperation({
    summary:
      'Upload a BANK PAYMENT page (screenshot/PDF dataUri) — AI-reads payee/amount/date, auto-matches the supplier among those with open rows, and returns the outstanding invoices to tick off',
  })
  matchPayment(@Req() req: any, @Body() body: { dataUri: string; mimetype?: string }) {
    return this.service.matchPayment(orgId(req), body || ({} as any));
  }

  @Post('settle')
  @Permissions('projects:update')
  @ApiOperation({ summary: 'Settle ticked payables against a bank payment: rows [{id, percentage?}] (optional REBATE % change — omit to keep) + paymentDate + reference → all marked PAID' })
  settle(@Req() req: any, @Body() body: { rows: Array<{ id: string; percentage?: number | null }>; paymentDate?: string; reference?: string | null }) {
    return this.service.settle(orgId(req), body || ({} as any), actorName(req));
  }

  @Post(':id/withhold')
  @Permissions('projects:update')
  @ApiOperation({ summary: 'WITHHOLD payment on a payable (the sheet\'s orange rows — held back, excluded from the To-pay total)' })
  withhold(@Req() req: any, @Param('id') id: string) {
    return this.service.markWithheld(orgId(req), id);
  }

  @Delete(':id')
  @Permissions('projects:update')
  @ApiOperation({ summary: 'Delete a payable row' })
  remove(@Req() req: any, @Param('id') id: string) {
    return this.service.remove(orgId(req), id);
  }
}
