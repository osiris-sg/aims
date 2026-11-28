import { Body, Controller, Get, Put, Query, Req, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { ClerkAuthGuard } from '../auth/clerk-auth.guard';
import { Permissions } from '../auth/decorators/permissions.decorator';
import { CommissionService } from './commission.service';

// Commission is pay: reading it needs payments:read and changing rates needs payments:create, the
// accounts permissions, not the documents:read every salesperson holds.
@ApiTags('Sales Reports')
@ApiBearerAuth()
@UseGuards(ClerkAuthGuard)
@Controller('sales-reports/commission')
export class CommissionController {
  constructor(private readonly service: CommissionService) {}

  @Get()
  @Permissions('payments:read')
  @ApiOperation({ summary: 'Commission report: customer payments received in a period, by salesperson and job type' })
  report(@Req() req: any, @Query('from') from?: string, @Query('to') to?: string) {
    return this.service.report(req.userOrganization?.id, { from, to });
  }

  @Get('settings')
  @Permissions('payments:read')
  @ApiOperation({ summary: 'Commission rates: standard per job type, per salesperson, minimum margin' })
  settings(@Req() req: any) {
    return this.service.getSettings(req.userOrganization?.id);
  }

  @Get('people')
  @Permissions('payments:read')
  @ApiOperation({ summary: 'The user accounts a commission salesperson can be tied to' })
  people(@Req() req: any) {
    return this.service.peopleOptions(req.userOrganization?.id);
  }

  @Put('settings')
  @Permissions('payments:create')
  @ApiOperation({ summary: 'Save the commission rates' })
  saveSettings(@Req() req: any, @Body() body: any) {
    return this.service.saveSettings(req.userOrganization?.id, body);
  }

  @Put('assign')
  @Permissions('payments:create')
  @ApiOperation({ summary: 'Set the salesperson of a job that has none, for commission (kept by quotation, else by invoice)' })
  saveAssign(@Req() req: any, @Body() body: any) {
    return this.service.saveAssign(req.userOrganization?.id, body);
  }

  @Put('rows')
  @Permissions('payments:create')
  @ApiOperation({ summary: 'Save per-row choices of the commission report (own rate, leave out, job type)' })
  saveRows(@Req() req: any, @Body() body: any) {
    return this.service.saveOverrides(req.userOrganization?.id, body);
  }
}
