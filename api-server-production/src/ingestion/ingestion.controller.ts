import {
  Body,
  Controller,
  Headers,
  Logger,
  Post,
  UnauthorizedException,
} from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { Public } from '../decorators/public.decorator';
import { IngestionService } from './ingestion.service';
import { IngestBatchDto } from './dto/ingest-batch.dto';

// ---------------------------------------------------------------------------
// PUBLIC ingestion endpoint for the Biofuel weighbridge feed.
//
// No Clerk login (the weighbridge machine/feed posts directly), but every
// request MUST carry a shared secret in the `X-Ingest-Token` header, checked
// against process.env.INGEST_API_TOKEN. This mirrors the bills-inbound webhook
// secret pattern. Without the env var set the endpoint refuses all requests.
// ---------------------------------------------------------------------------

@ApiTags('ingestion')
@Controller('ingestion')
export class IngestionController {
  private readonly logger = new Logger(IngestionController.name);

  constructor(private readonly ingestion: IngestionService) {}

  @Public()
  @Post('invoices/ingest-batch')
  @ApiOperation({
    summary:
      'Biofuel weighbridge JSON batch → creates INVOICE documents in a pending-GL-posting state (no journal entry). Requires X-Ingest-Token header.',
  })
  async ingestBatch(
    @Headers('x-ingest-token') token: string,
    @Body() payload: IngestBatchDto,
  ) {
    const expected = process.env.INGEST_API_TOKEN;
    if (!expected) {
      throw new UnauthorizedException(
        'Ingestion is not configured (INGEST_API_TOKEN unset)',
      );
    }
    if (!token || token !== expected) {
      throw new UnauthorizedException('Invalid ingest token');
    }

    const summary = await this.ingestion.ingestBatch(payload);
    this.logger.log(
      `Ingest batch ${summary.batchType ?? ''} ${summary.batchDate ?? ''}: ` +
        `${summary.created} created, ${summary.updated} updated, ${summary.failed} failed`,
    );
    return summary;
  }
}
