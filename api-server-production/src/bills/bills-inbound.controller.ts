import { BadRequestException, Body, Controller, Headers, Logger, Post, UnauthorizedException } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { BillsService } from './bills.service';
import { PrismaService } from '../common/prisma.service';

// ---------------------------------------------------------------------------
// Inbound email webhook for bills.
//
// External email service (Resend, SendGrid, Postmark) is configured to forward
// emails arriving at bills+{ORG_ID}@yourdomain.com to this endpoint as JSON
// with the attachment(s) base64-encoded. We:
//   1. Verify the shared-secret token header.
//   2. Pull orgId from the `to` address local-part suffix.
//   3. LLM-extract the first PDF attachment.
//   4. Create a DRAFT bill on success.
//
// Setup is one-time per email provider (DNS + forwarding rule). This endpoint
// is provider-agnostic — payload shape just needs { from, to, subject,
// attachments: [{ contentType, contentBase64, filename }] }.
// ---------------------------------------------------------------------------

interface InboundEmailPayload {
  from: string;
  to: string;
  subject?: string;
  text?: string;
  attachments?: Array<{ contentType: string; contentBase64: string; filename?: string }>;
}

@ApiTags('bills-inbound')
@Controller('bills-inbound')
export class BillsInboundController {
  private readonly logger = new Logger(BillsInboundController.name);

  constructor(
    private readonly bills: BillsService,
    private readonly prisma: PrismaService,
  ) {}

  @Post('email')
  @ApiOperation({
    summary:
      'Inbound email webhook — forwards a supplier email + PDF into a DRAFT bill. Requires X-Webhook-Secret header.',
  })
  async inboundEmail(
    @Headers('x-webhook-secret') secret: string,
    @Body() payload: InboundEmailPayload,
  ) {
    const expectedSecret = process.env.BILLS_INBOUND_SECRET;
    if (!expectedSecret) {
      throw new UnauthorizedException('Inbound email is not configured (BILLS_INBOUND_SECRET unset)');
    }
    if (secret !== expectedSecret) throw new UnauthorizedException('Invalid webhook secret');

    if (!payload?.to) throw new BadRequestException('Missing `to` address');

    // Convention: bills+{ORG_ID}@... → extract ORG_ID from local part.
    const match = payload.to.match(/bills\+([A-Za-z0-9-]+)@/i);
    const organizationId = match?.[1];
    if (!organizationId) {
      throw new BadRequestException('Address must be bills+{ORG_ID}@<your-domain>');
    }

    // Sanity check: org exists.
    const org = await this.prisma.organization.findUnique({ where: { id: organizationId } });
    if (!org) throw new BadRequestException(`Unknown organization in address: ${organizationId}`);

    const pdf = payload.attachments?.find((a) => /pdf|image\//i.test(a.contentType));
    if (!pdf) {
      this.logger.warn(`[inbound-email] org=${organizationId} no PDF/image attachment — skipping`);
      return { ok: false, reason: 'no-pdf' };
    }

    const extracted = await this.bills.extractFromFile(
      organizationId,
      pdf.contentBase64,
      /pdf/i.test(pdf.contentType) ? 'application/pdf' : (pdf.contentType as any),
    );

    if (!extracted) {
      this.logger.warn(`[inbound-email] org=${organizationId} extraction returned null`);
      return { ok: false, reason: 'extraction-failed' };
    }

    // Need a supplier to attach the bill to. If extraction couldn't find one,
    // create a placeholder supplier from the From address.
    let supplierId = extracted.supplierIdGuess?.id;
    if (!supplierId) {
      const fromEmail = (payload.from || '').match(/<?([^<>\s]+@[^<>\s]+)>?/)?.[1];
      const placeholderName = extracted.supplierName || fromEmail || 'Unknown Supplier';
      const supplier = await this.prisma.supplier.upsert({
        where: { email_organizationId: { email: fromEmail || '', organizationId } },
        update: {},
        create: {
          organizationId,
          name: placeholderName,
          email: fromEmail || null,
        },
      });
      supplierId = supplier.id;
    }

    const bill = await this.bills.create(organizationId, undefined, {
      supplierId,
      billNumber: extracted.billNumber || `EMAIL-${Date.now()}`,
      billDate: extracted.billDate || new Date().toISOString(),
      dueDate: extracted.dueDate || undefined,
      lines: extracted.lines || [{ description: 'Imported from email', amount: extracted.totalAmount || 0 }],
      taxAmount: extracted.taxAmount,
      inboundChannel: 'EMAIL',
      inboundMeta: {
        ...extracted.meta,
        fromAddress: payload.from,
        subject: payload.subject,
        filename: pdf.filename,
      },
    });

    return { ok: true, billId: bill.id, status: bill.status };
  }
}
