import { Body, Controller, Get, Post, Req, UseGuards } from '@nestjs/common';
import { RequiresModule } from '../auth/decorators/requires-module.decorator';
import { ClerkAuthGuard } from '../auth/clerk-auth.guard';
import { Permissions } from '../auth/decorators/permissions.decorator';
import { actorOf, orgIdOf, TradeRequest } from './shipments.request';
import { TradeUnpaidService } from './trade-unpaid.service';

/** Round BP — Dashboard "Unpaid / 未払い・未入金": to pay / to receive with due dates, and Mark paid. */
@RequiresModule('SHIPMENTS')
@Controller('trade-unpaid')
@UseGuards(ClerkAuthGuard)
export class TradeUnpaidController {
  constructor(private readonly unpaid: TradeUnpaidService) {}

  /** Both lists as of today (invoice / PI amounts only — no margin or profit). */
  @Get()
  @Permissions('shipments:read')
  list(@Req() req: TradeRequest) {
    return this.unpaid.list(orgIdOf(req));
  }

  /** { key, paidAt, amount?, account?, proofFileId? } — recorded on the step (or as a receipt allocated to the invoice). */
  @Post('mark-paid')
  @Permissions('shipments:update')
  async markPaid(@Body() body: { key?: string; paidAt?: string; amount?: unknown; account?: string; proofFileId?: string | null }, @Req() req: TradeRequest) {
    const r = await this.unpaid.markPaid(orgIdOf(req), body ?? {}, actorOf(req));
    (req as any).actionLogResult = r;
    return r;
  }
}
