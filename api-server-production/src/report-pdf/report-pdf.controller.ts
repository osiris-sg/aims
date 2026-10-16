import { Body, Controller, Get, Post, Req } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { Permissions } from '../auth/decorators/permissions.decorator';
import { ReportPdfService, ReportPdfParams } from './report-pdf.service';

// Declared here rather than imported: every controller in this codebase
// carries its own, and there is no shared interface module to import from.
interface RequestWithOrganization extends Request {
  userOrganization?: { id: string; name: string };
}

@ApiTags('report-pdf')
@Controller('reports/pdf')
export class ReportPdfController {
  constructor(private readonly service: ReportPdfService) {}

  @Get('available')
  @Permissions('statements:read')
  @ApiOperation({ summary: 'Accounting reports that can be produced as a PDF' })
  listReports() {
    return { reports: this.service.listReports() };
  }

  @Post()
  @Permissions('statements:read')
  @ApiOperation({ summary: 'Render an accounting report to PDF and return a signed link' })
  async generate(
    @Body() body: { report: string } & ReportPdfParams,
    @Req() req: RequestWithOrganization,
  ) {
    const organizationId = req.userOrganization?.id;
    if (!organizationId) throw new Error('User is not assigned to any organization');
    const { report, ...params } = body || ({} as any);
    return this.service.generate(organizationId, report, params);
  }
}
