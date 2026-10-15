import { BadRequestException, Controller, Get, NotFoundException, Param, Query, Req, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { Request } from 'express';
import { ClerkAuthGuard } from '../auth/clerk-auth.guard';
import { Permissions } from '../auth/decorators/permissions.decorator';
import { PrismaService } from '../common/prisma.service';
import { S3Service } from '../common/services/s3.service';
import { StoredEmailMeta } from './email-store';

interface RequestWithOrganization extends Request {
  userOrganization?: { id: string; name: string };
}

// The current org's store-only email intake, read-only (Org Settings →
// Shipping & documents): its docs+{orgId}@ address and the emails received.
// Shipments permission, not organizations:read — ADH staff run it.
@ApiTags('email-intake')
@ApiBearerAuth()
@Controller('email-intake')
@UseGuards(ClerkAuthGuard)
export class EmailIntakeController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly s3: S3Service,
  ) {}

  private orgId(req: RequestWithOrganization): string {
    const id = req.userOrganization?.id;
    if (!id) throw new BadRequestException('No organization');
    return id;
  }

  @Get()
  @Permissions('shipments:read')
  @ApiOperation({ summary: "The org's intake address, whether intake is on, and the latest received emails." })
  async overview(@Req() req: RequestWithOrganization, @Query('limit') limit?: string) {
    const organizationId = this.orgId(req);
    const domain = process.env.EMAIL_INGEST_DOMAIN;
    const config = await this.prisma.emailIngestConfig.findUnique({ where: { organizationId }, select: { enabled: true, routingMode: true } });
    const take = Math.min(Math.max(parseInt(limit ?? '', 10) || 50, 1), 200);
    const logs = await this.prisma.emailIngestLog.findMany({ where: { organizationId }, orderBy: { createdAt: 'desc' }, take });
    return {
      address: domain ? `docs+${organizationId}@${domain}` : null,
      addressNote: domain ? null : 'EMAIL_INGEST_DOMAIN is not configured on this server',
      enabled: !!config?.enabled,
      mode: config?.routingMode ?? null,
      emails: logs.map((l) => {
        const m = (l.rawMeta ?? {}) as Partial<StoredEmailMeta>;
        return {
          id: l.id,
          receivedAt: l.createdAt,
          date: m.date ?? null,
          from: l.fromAddress,
          subject: l.subject,
          messageId: l.messageId,
          status: l.status,
          reason: l.reason,
          hasEml: !!m.emlKey,
          emlSource: m.emlSource ?? null,
          attachments: (m.attachments ?? []).map((a, i) => ({ index: i, name: a.name, contentType: a.contentType, size: a.size })),
          attachmentNames: m.attachments ? m.attachments.map((a) => a.name) : (m.attachmentNames ?? []).filter((n): n is string => !!n),
        };
      }),
    };
  }

  /** Short-lived link to a stored email's .eml or one of its attachments. */
  @Get(':id/file')
  @Permissions('shipments:read')
  @ApiOperation({ summary: 'Signed download URL for a stored email (.eml) or attachment (?attachment=n).' })
  async file(@Param('id') id: string, @Req() req: RequestWithOrganization, @Query('attachment') attachment?: string) {
    const organizationId = this.orgId(req);
    const log = await this.prisma.emailIngestLog.findFirst({ where: { id, organizationId } });
    const m = (log?.rawMeta ?? {}) as Partial<StoredEmailMeta>;
    if (!log || !m.emlKey) throw new NotFoundException('Stored email not found');
    let key = m.emlKey;
    if (attachment !== undefined) {
      const n = Number(attachment);
      if (!Number.isInteger(n) || n < 0) throw new BadRequestException('attachment must be an index');
      const a = (m.attachments ?? [])[n];
      if (!a) throw new NotFoundException('Attachment not found');
      key = a.key;
    }
    return { url: await this.s3.getSignedUrl(key, 300) };
  }
}
