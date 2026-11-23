import { Controller, Get, Post, Patch, Put, Delete, Body, Param, Query, UseGuards, Req } from '@nestjs/common';
import { DashboardService } from './dashboard.service';
import { JobsCalendarService } from './jobs-calendar.service';
import { CalendarNotesService } from './calendar-notes.service';
import { CalendarStyleService } from './calendar-style.service';
import { RoleHomeService } from './role-home.service';
import { ClerkAuthGuard } from 'src/auth/clerk-auth.guard';
import { Permissions } from 'src/auth/decorators/permissions.decorator';
import { ApiTags, ApiOperation, ApiResponse } from '@nestjs/swagger';
import { Request } from 'express';

// Extend Request type to include userOrganization
interface RequestWithOrganization extends Request {
  userOrganization?: {
    id: string;
    name: string;
  };
  // Set by ClerkAuthGuard — the authenticated user (id is the Clerk user id).
  user?: { id: string };
}

@ApiTags('dashboard')
@UseGuards(ClerkAuthGuard)
@Controller('dashboard')
export class DashboardController {
  constructor(
    private readonly dashboardService: DashboardService,
    private readonly jobsCalendar: JobsCalendarService,
    private readonly calendarNotes: CalendarNotesService,
    private readonly roleHome: RoleHomeService,
    private readonly calendarStyle: CalendarStyleService,
  ) {}

  @Get('overview')
  @Permissions('dashboard:read')
  @ApiOperation({ summary: 'Get dashboard overview data' })
  @ApiResponse({ status: 200, description: 'Dashboard overview data' })
  async getDashboardOverview(@Req() req: RequestWithOrganization) {
    const organizationId = req.userOrganization?.id;
    if (!organizationId) {
      throw new Error('User is not assigned to any organization');
    }
    return await this.dashboardService.getDashboardOverview(organizationId);
  }

  // Role-based home (enableRoleHome): every card's figure from the org's own
  // data, cut per role on the client. `today` + `tzOffset` are the user's
  // local day; `days` is the overview range (7 | 30 | 90).
  @Get('role-home')
  @Permissions('dashboard:read')
  @ApiOperation({ summary: 'Role-based home screen snapshot (real figures)' })
  async getRoleHome(
    @Req() req: RequestWithOrganization,
    @Query('days') days?: string,
    @Query('today') today?: string,
    @Query('tzOffset') tzOffset?: string,
  ) {
    const organizationId = req.userOrganization?.id;
    if (!organizationId) throw new Error('User is not assigned to any organization');
    return await this.roleHome.snapshot(organizationId, { days: Number(days), today, tzOffset: Number(tzOffset) });
  }

  @Get('assets-overview')
  @Permissions('assets:read')
  @ApiOperation({ summary: 'Get assets overview for dashboard' })
  @ApiResponse({ status: 200, description: 'Assets overview data' })
  async getAssetsOverview(@Req() req: RequestWithOrganization) {
    const organizationId = req.userOrganization?.id;
    if (!organizationId) {
      throw new Error('User is not assigned to any organization');
    }
    return await this.dashboardService.getAssetsOverview(organizationId);
  }

  @Get('invoices-due')
  @Permissions('documents:read')
  @ApiOperation({ summary: 'Get invoices due for dashboard' })
  @ApiResponse({ status: 200, description: 'Invoices due data' })
  async getInvoicesDue(@Req() req: RequestWithOrganization) {
    const organizationId = req.userOrganization?.id;
    if (!organizationId) {
      throw new Error('User is not assigned to any organization');
    }
    return await this.dashboardService.getInvoicesDue(organizationId);
  }

  @Get('delivery-orders-pending')
  @Permissions('documents:read')
  @ApiOperation({ summary: 'Get pending delivery orders for dashboard' })
  @ApiResponse({ status: 200, description: 'Pending delivery orders data' })
  async getDeliveryOrdersPending(@Req() req: RequestWithOrganization) {
    const organizationId = req.userOrganization?.id;
    if (!organizationId) {
      throw new Error('User is not assigned to any organization');
    }
    return await this.dashboardService.getDeliveryOrdersPending(organizationId);
  }

  @Get('projects-ending')
  @Permissions('projects:read')
  @ApiOperation({ summary: 'Get projects ending soon for dashboard' })
  @ApiResponse({ status: 200, description: 'Projects ending soon data' })
  async getProjectsEnding(@Req() req: RequestWithOrganization) {
    const organizationId = req.userOrganization?.id;
    if (!organizationId) {
      throw new Error('User is not assigned to any organization');
    }
    return await this.dashboardService.getProjectsEnding(organizationId);
  }

  // ── Operations dashboard (Biofuel, guru 2026-09-26) ────────────────────
  // Read-only aggregates. All five are GETs, so the global ActionLog
  // interceptor records them as views rather than bogus CREATEs.

  @Get('ops/stock')
  @Permissions('inventories:read')
  @ApiOperation({ summary: 'Stock on hand by product and status' })
  async getOpsStock(@Req() req: RequestWithOrganization) {
    return await this.dashboardService.getOpsStock(this.orgOf(req));
  }

  @Get('ops/movements')
  @Permissions('inventories:read')
  @ApiOperation({ summary: 'Recent units in and out' })
  async getOpsMovements(@Req() req: RequestWithOrganization, @Query('limit') limit?: string) {
    const n = Math.min(Math.max(parseInt(limit || '20', 10) || 20, 1), 100);
    return await this.dashboardService.getOpsMovements(this.orgOf(req), n);
  }

  @Get('ops/revenue')
  @Permissions('dashboard:read')
  @ApiOperation({ summary: 'Revenue by product over a date range' })
  async getOpsRevenue(
    @Req() req: RequestWithOrganization,
    @Query('from') from?: string,
    @Query('to') to?: string,
    @Query('assetId') assetId?: string,
  ) {
    const { start, end } = this.range(from, to);
    return await this.dashboardService.getOpsRevenue(this.orgOf(req), start, end, assetId || undefined);
  }

  @Get('ops/maintenance')
  @Permissions('dashboard:read')
  @ApiOperation({ summary: 'Service frequency and most-serviced units' })
  async getOpsMaintenance(
    @Req() req: RequestWithOrganization,
    @Query('from') from?: string,
    @Query('to') to?: string,
  ) {
    const { start, end } = this.range(from, to);
    return await this.dashboardService.getOpsMaintenance(this.orgOf(req), start, end);
  }

  @Get('ops/map')
  @Permissions('inventories:read')
  @ApiOperation({ summary: 'Where the fleet sits, and where the team has been' })
  async getOpsMap(@Req() req: RequestWithOrganization) {
    return await this.dashboardService.getOpsMap(this.orgOf(req));
  }

  @Get('ops/layout')
  @Permissions('dashboard:read')
  @ApiOperation({ summary: "This user's saved dashboard arrangement" })
  async getOpsLayout(@Req() req: RequestWithOrganization) {
    return await this.dashboardService.getOpsLayout(this.orgOf(req), this.userOf(req));
  }

  @Post('ops/layout')
  @Permissions('dashboard:read')
  @ApiOperation({ summary: 'Save this user’s dashboard arrangement' })
  async saveOpsLayout(@Req() req: RequestWithOrganization, @Body() body: { layout: Array<{ id: string; w: number }> }) {
    const layout = Array.isArray(body?.layout) ? body.layout : [];
    return await this.dashboardService.saveOpsLayout(this.orgOf(req), this.userOf(req), layout);
  }

  // ── Jobs calendar (WCT 2026-10-30, enableJobsCalendar) ─────────────────
  // Scheduled deliveries / returns / service runs plus the org's SiteClock
  // jobs for a visible range (yyyy-MM-dd, inclusive, at most 62 days).

  @Get('jobs-calendar')
  @Permissions('dashboard:read')
  @ApiOperation({ summary: 'Jobs calendar: AIMS runs and SiteClock jobs in a date range' })
  async getJobsCalendar(@Req() req: RequestWithOrganization, @Query('from') from: string, @Query('to') to: string) {
    return await this.jobsCalendar.get(this.orgOf(req), from, to, { userId: (req as any).user?.id ?? null });
  }

  // Calendar notes (WCT 2026-11-04, enableWctOrders + enableJobsCalendar):
  // leave / PTW / blockage bars; anyone with the calendar can manage them.

  @Post('jobs-calendar/notes')
  @Permissions('dashboard:read')
  @ApiOperation({ summary: 'Jobs calendar: add a note (not a job)' })
  async createCalendarNote(@Req() req: RequestWithOrganization, @Body() body: any) {
    return await this.calendarNotes.create(this.orgOf(req), req.user?.id ?? null, body);
  }

  @Patch('jobs-calendar/notes/:id')
  @Permissions('dashboard:read')
  @ApiOperation({ summary: 'Jobs calendar: edit a note' })
  async updateCalendarNote(@Req() req: RequestWithOrganization, @Param('id') id: string, @Body() body: any) {
    return await this.calendarNotes.update(this.orgOf(req), id, body);
  }

  @Delete('jobs-calendar/notes/:id')
  @Permissions('dashboard:read')
  @ApiOperation({ summary: 'Jobs calendar: delete a note' })
  async deleteCalendarNote(@Req() req: RequestWithOrganization, @Param('id') id: string) {
    return await this.calendarNotes.remove(this.orgOf(req), id);
  }

  // Calendar style (enableCalendarStyle, WCT group): people colours (Settings) and the job forms' pickers.

  @Get('calendar-style')
  @Permissions('dashboard:read')
  @ApiOperation({ summary: 'Jobs calendar style: every member with their salesperson / PTW colours' })
  async getCalendarStyle(@Req() req: RequestWithOrganization) {
    return await this.calendarStyle.settings(this.orgOf(req));
  }

  @Put('calendar-style')
  @Permissions('organizations:update')
  @ApiOperation({ summary: 'Jobs calendar style: save people colours and the default PTW applicant' })
  async saveCalendarStyle(@Req() req: RequestWithOrganization, @Body() body: any) {
    return await this.calendarStyle.save(this.orgOf(req), body);
  }

  @Get('calendar-style/ptw-applicants')
  @Permissions('dashboard:read')
  @ApiOperation({ summary: 'PTW applicants list (Settings > Job fields): entries, linkable logins, colours' })
  async getPtwApplicants(@Req() req: RequestWithOrganization) {
    return await this.calendarStyle.applicants(this.orgOf(req));
  }

  @Put('calendar-style/ptw-applicants')
  @Permissions('organizations:update')
  @ApiOperation({ summary: 'PTW applicants list: save entries (name, colour, login link, hidden, order) and the default' })
  async savePtwApplicants(@Req() req: RequestWithOrganization, @Body() body: any) {
    return await this.calendarStyle.saveApplicants(this.orgOf(req), body);
  }

  // Jobs calendar Export list (2026-11-20): the WhatsApp list's header line (Settings > Job fields).
  @Get('calendar-style/export-header')
  @Permissions('dashboard:read')
  @ApiOperation({ summary: 'Jobs calendar Export list: the header line (default when never set)' })
  async getCalendarExportHeader(@Req() req: RequestWithOrganization) {
    return await this.calendarStyle.exportHeader(this.orgOf(req));
  }

  @Put('calendar-style/export-header')
  @Permissions('organizations:update')
  @ApiOperation({ summary: 'Jobs calendar Export list: save the header line' })
  async saveCalendarExportHeader(@Req() req: RequestWithOrganization, @Body() body: any) {
    return await this.calendarStyle.saveExportHeader(this.orgOf(req), body);
  }

  @Get('calendar-style/people')
  @Permissions('dashboard:read')
  @ApiOperation({ summary: 'Jobs calendar style: Salesperson and PTW applicant pickers with their defaults' })
  async getCalendarStylePeople(@Req() req: RequestWithOrganization) {
    return await this.calendarStyle.formPeople(this.orgOf(req), req.user?.id ?? null);
  }

  // Group New job (WCT 2026-11-22): the companies this user may put a new job under (the group's orgs they belong to).
  // Every org outside an active group: { group: false, orgs: [] } and the form shows no Company field.
  // Jobs calendar search (WCT group, enableGroupCalendar, 2026-11-23): every job and note, any date. GET = a view.
  @Get('jobs-calendar/search')
  @Permissions('dashboard:read')
  @ApiOperation({ summary: 'Jobs calendar: search every job and note of the companies the calendar shows' })
  async searchJobsCalendar(@Req() req: RequestWithOrganization, @Query('q') q: string, @Query('companies') companies?: string) {
    return await this.jobsCalendar.search(this.orgOf(req), q, String(companies ?? '').split(',').map((x) => x.trim()).filter(Boolean));
  }

  @Get('jobs-calendar/companies')
  @Permissions('dashboard:read')
  @ApiOperation({ summary: 'Jobs calendar: the group companies a new job can go under' })
  async getJobCompanies(@Req() req: RequestWithOrganization) {
    return await this.jobsCalendar.companies(this.orgOf(req), req.user?.id ?? null, !!(req as any).isOsirisAdmin);
  }

  private userOf(req: RequestWithOrganization): string {
    const userId = req.user?.id;
    if (!userId) throw new Error('Not signed in');
    return userId;
  }

  private orgOf(req: RequestWithOrganization): string {
    const organizationId = req.userOrganization?.id;
    if (!organizationId) throw new Error('User is not assigned to any organization');
    return organizationId;
  }

  /** Defaults to the last 12 months when the caller gives no range. */
  private range(from?: string, to?: string): { start: Date; end: Date } {
    const end = to ? new Date(to) : new Date();
    const start = from ? new Date(from) : new Date(new Date().setMonth(new Date().getMonth() - 12));
    // An end date typed as a day means "including that day".
    if (to && /^\d{4}-\d{2}-\d{2}$/.test(to)) end.setDate(end.getDate() + 1);
    return { start, end };
  }
}
