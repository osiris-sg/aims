import { Controller, Get, Param } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { PublicPayService } from './public-pay.service';
import { Public } from '../decorators/public.decorator';

// PUBLIC (no auth): the "Click to pay" page a customer lands on from the
// invoice email. Documents are looked up by their unguessable payToken only.
@ApiTags('public-pay')
@Controller('public-pay')
export class PublicPayController {
  constructor(private readonly service: PublicPayService) {}

  @Public()
  @Get(':token')
  @ApiOperation({ summary: 'Public invoice payment page payload (by pay token)' })
  get(@Param('token') token: string) {
    return this.service.getByToken(token);
  }
}
