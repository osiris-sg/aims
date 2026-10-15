import { Body, Controller, Param, ParseUUIDPipe, Post, Req, UseGuards } from '@nestjs/common';
import { ClerkAuthGuard } from '../auth/clerk-auth.guard';
import { Permissions } from '../auth/decorators/permissions.decorator';
import { actorOf, orgIdOf, TradeRequest } from './shipments.request';
import { TradeStepsService } from './trade-steps.service';

@Controller('trade-steps')
@UseGuards(ClerkAuthGuard)
export class TradeStepsController {
  constructor(private readonly steps: TradeStepsService) {}

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
}
