import { Body, Controller, Get, Headers, Param, ParseUUIDPipe, Post } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { Public } from '../decorators/public.decorator';
import { DeliveryGroupPostsService } from './delivery-group-posts.service';

/**
 * The post-only WhatsApp worker (whatsapp-post-bridge). Public: authenticated
 * by X-Post-Bridge-Token, bound in WA_POST_BRIDGES to the org(s) it posts for.
 */
@ApiTags('wa-post')
@Public()
@Controller('wa-post')
export class WaPostController {
  constructor(private readonly posts: DeliveryGroupPostsService) {}

  @Get('jobs')
  @ApiOperation({ summary: 'Delivery posts ready to send (token-gated)' })
  jobs(@Headers('x-post-bridge-token') token: string) {
    return this.posts.jobs(token);
  }

  @Post('jobs/:id/claim')
  @ApiOperation({ summary: 'Atomically claim a post (10-minute lease)' })
  claim(@Headers('x-post-bridge-token') token: string, @Param('id', ParseUUIDPipe) id: string) {
    return this.posts.claim(token, id);
  }

  @Post('jobs/:id/done')
  @ApiOperation({ summary: 'Report a claimed post as sent or failed' })
  done(
    @Headers('x-post-bridge-token') token: string,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() body: { ok?: boolean; error?: string; messageIds?: string[]; resumed?: boolean },
  ) {
    return this.posts.done(token, id, body || {});
  }

  @Post('groups')
  @ApiOperation({ summary: "The worker's current WhatsApp group list" })
  groups(@Headers('x-post-bridge-token') token: string, @Body() body: { groups?: Array<{ id: string; name: string }> }) {
    return this.posts.reportGroups(token, body?.groups || []);
  }

  @Post('heartbeat')
  @ApiOperation({ summary: 'Worker heartbeat (every 60 s)' })
  heartbeat(@Headers('x-post-bridge-token') token: string) {
    return this.posts.heartbeat(token);
  }
}
