import { TradeDueService } from './trade-due.service';
import { Body, Controller, Param, ParseUUIDPipe, Patch, Post, Req, UseGuards } from '@nestjs/common';
import { RequiresModule } from '../auth/decorators/requires-module.decorator';
import { ClerkAuthGuard } from '../auth/clerk-auth.guard';
import { Permissions } from '../auth/decorators/permissions.decorator';
import { actorOf, orgIdOf, TradeRequest } from './shipments.request';
import { TradeStepsService } from './trade-steps.service';

@RequiresModule('SHIPMENTS')
@Controller('trade-steps')
@UseGuards(ClerkAuthGuard)
export class TradeStepsController {
  constructor(
    private readonly steps: TradeStepsService,
    private readonly due: TradeDueService,
  ) {}

  /** Round AY: set this step's due date by hand ({ dueAt: "YYYY-MM-DD" }) or back to the rule ({ dueAt: null }). */
  @Patch(':id/due')
  @Permissions('shipments:update')
  async setDue(@Param('id', ParseUUIDPipe) id: string, @Body() body: { dueAt?: string | null }, @Req() req: TradeRequest) {
    const r = await this.due.setDue(orgIdOf(req), id, body?.dueAt ?? null, actorOf(req));
    (req as any).actionLogResult = { dueAt: { from: r.from, to: r.to } };
    return r;
  }

  @Post(':id/start')
  @Permissions('shipments:update')
  start(@Param('id', ParseUUIDPipe) id: string, @Req() req: TradeRequest) {
    return this.steps.start(orgIdOf(req), id, actorOf(req));
  }

  @Post(':id/complete')
  @Permissions('shipments:update')
  complete(@Param('id', ParseUUIDPipe) id: string, @Req() req: TradeRequest) {
    return this.steps.complete(orgIdOf(req), id, actorOf(req));
  }

  @Post(':id/reopen')
  @Permissions('shipments:update')
  reopen(@Param('id', ParseUUIDPipe) id: string, @Req() req: TradeRequest) {
    return this.steps.reopen(orgIdOf(req), id, actorOf(req));
  }

  /** Tick / untick a sub-task ("Sent to customer" …) — evidence only, never blocks the step. */
  @Post(':id/subtasks/:key')
  @Permissions('shipments:update')
  subtask(@Param('id', ParseUUIDPipe) id: string, @Param('key') key: string, @Body() body: { done?: boolean }, @Req() req: TradeRequest) {
    return this.steps.setSubtask(orgIdOf(req), id, key, body?.done !== false, actorOf(req));
  }

  /** A paying / receiving step's amount, date, account and proof file ({ payment: null } clears it). */
  @Post(':id/payment')
  @Permissions('shipments:update')
  payment(@Param('id', ParseUUIDPipe) id: string, @Body() body: unknown, @Req() req: TradeRequest) {
    return this.steps.setPayment(orgIdOf(req), id, body);
  }
}
