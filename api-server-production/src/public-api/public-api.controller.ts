import { Controller, Get, Param, UseGuards } from '@nestjs/common';
import { ApiOperation, ApiParam, ApiSecurity, ApiTags } from '@nestjs/swagger';
import { Public } from '../decorators/public.decorator';
import { ApiKeyGuard } from './api-key.guard';
import { PublicApiService } from './public-api.service';
import { UnitBySidResponseDto } from './dto/unit-by-sid.dto';
import { SidsUnitsResponseDto } from './dto/sids-units.dto';

/**
 * Cross-system read surface for water-sg (pull model). No user context: the
 * route is @Public() to bypass the global ClerkAuthGuard, then guarded by the
 * shared-secret ApiKeyGuard. Every handler returns a whitelisted DTO only.
 */
@ApiTags('public-api (water-sg)')
@ApiSecurity('water-sg-api-key')
@Controller('public-api')
export class PublicApiController {
  constructor(private readonly publicApiService: PublicApiService) {}

  @Public()
  @UseGuards(ApiKeyGuard)
  @Get('unit-by-sid/:sidId')
  @ApiOperation({
    summary: 'Look up the current AIMS unit state for a SIDS ID (water-sg pull).',
  })
  @ApiParam({ name: 'sidId', description: 'SIDS ID — bare "45"/"045" or "SID 045".' })
  async unitBySid(@Param('sidId') sidId: string): Promise<UnitBySidResponseDto> {
    return this.publicApiService.getUnitBySid(sidId);
  }

  @Public()
  @UseGuards(ApiKeyGuard)
  @Get('sids-units')
  @ApiOperation({
    summary:
      'List ALL SIDS units for water-sg\'s link dropdown. AIMS returns every unit; water-sg excludes its own already-linked ones.',
  })
  async sidsUnits(): Promise<SidsUnitsResponseDto> {
    return this.publicApiService.getSidsUnits();
  }
}
