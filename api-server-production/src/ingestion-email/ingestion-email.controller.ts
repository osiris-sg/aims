import { Body, Controller, Headers, Logger, Post, UnauthorizedException } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { Public } from '../decorators/public.decorator';
import { IngestionEmailService, InboundEmailPayload } from './ingestion-email.service';

// ---------------------------------------------------------------------------
// Inbound email webhook for document ingestion (AR invoices + AP bills).
//
// External email provider forwards mail arriving at docs+{ORG_ID}@<domain>
// here as JSON with base64 attachments — the same provider-agnostic payload
// shape as the bills-inbound webhook. Auth is a shared secret in the
// X-Webhook-Secret header, checked against EMAIL_INGEST_SECRET (mirrors
// BILLS_INBOUND_SECRET / INGEST_API_TOKEN).
//
// Response contract: 401 ONLY for a bad/missing secret. Every business
// rejection (unknown org, ingestion disabled, unwatched sender, duplicate,
// no usable attachment, extraction failure) returns 200 with
// { ok: false, reason } so the provider does not retry.
// ---------------------------------------------------------------------------

@ApiTags('ingestion-email')
@Controller('ingestion-email')
export class IngestionEmailController {
  private readonly logger = new Logger(IngestionEmailController.name);

  constructor(private readonly ingestionEmail: IngestionEmailService) {}

  @Public()
  @Post('email')
  @ApiOperation({
    summary:
      'Inbound email webhook — classifies each PDF/image attachment by issuer/kind and creates DRAFT invoices (AR), bills (AP) or credit notes (AR/AP subtype). Requires X-Webhook-Secret header.',
  })
  async inboundEmail(
    @Headers('x-webhook-secret') secret: string,
    @Body() payload: InboundEmailPayload,
  ) {
    const expectedSecret = process.env.EMAIL_INGEST_SECRET;
    if (!expectedSecret) {
      throw new UnauthorizedException('Email ingestion is not configured (EMAIL_INGEST_SECRET unset)');
    }
    if (secret !== expectedSecret) throw new UnauthorizedException('Invalid webhook secret');

    const result = await this.ingestionEmail.handleInbound(payload);
    this.logger.log(
      `[ingest-email] from=${payload?.from ?? '?'} ok=${result.ok}` +
        (result.ok ? ` created=${(result as any).created?.length ?? 0}` : ` reason=${(result as any).reason}`),
    );
    return result;
  }
}
