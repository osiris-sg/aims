import { ApiProperty } from '@nestjs/swagger';

/**
 * Response for GET /public-api/sids-units — the list water-sg uses to populate
 * its "link a site to an AIMS unit" dropdown. AIMS returns EVERY SIDS unit;
 * water-sg filters out the ones already linked (its own Site.aimsUnitId set).
 */
export class SidsUnitListItemDto {
  @ApiProperty({ description: 'Canonical 3-digit SIDS ID (e.g. "045"), or null if the sku has no 1-999 number.', nullable: true })
  sidId: string | null;

  @ApiProperty({ description: 'AIMS unit SKU, e.g. "SID 045".' })
  sku: string;

  @ApiProperty({ description: 'Unit status: instock | rental | sold.' })
  status: string;
}

export class SidsUnitsResponseDto {
  @ApiProperty({ type: [SidsUnitListItemDto] })
  units: SidsUnitListItemDto[];
}
