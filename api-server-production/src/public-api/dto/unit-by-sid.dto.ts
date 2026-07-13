import { ApiProperty } from '@nestjs/swagger';

/**
 * Cross-system response for GET /public-api/unit-by-sid/:sidId.
 *
 * Explicit whitelist — this object is built field-by-field in the service and
 * is the ONLY thing returned to water-sg. It deliberately excludes internal
 * UUIDs, financials (rates/invoices), tag UIDs, and anything org-external.
 */
export class UnitBySidResponseDto {
  @ApiProperty({ description: 'Canonical 3-digit SIDS ID (zero-padded), e.g. "045".' })
  sidId: string;

  @ApiProperty({ description: 'AIMS unit SKU, e.g. "SID 045".' })
  sku: string;

  @ApiProperty({ description: 'Asset (product) name.' })
  assetName: string;

  @ApiProperty({ description: 'Unit status: instock | rental | sold.' })
  status: string;

  @ApiProperty({
    description: 'Current project + customer, or null when the unit has no active assignment.',
    nullable: true,
    type: 'object',
    properties: { name: { type: 'string' }, customer: { type: 'string', nullable: true } },
  })
  project: { name: string; customer: string | null } | null;

  @ApiProperty({ description: 'Deployment type of the active assignment (RENTAL | SALE | SERVICE), or null.', nullable: true })
  deploymentType: string | null;

  @ApiProperty({ description: 'Deployment date of the active assignment (ISO 8601), or null.', nullable: true })
  deployedDate: string | null;

  @ApiProperty({ description: 'Latitude captured when the unit was tagged, or null.', nullable: true })
  taggedLatitude: number | null;

  @ApiProperty({ description: 'Longitude captured when the unit was tagged, or null.', nullable: true })
  taggedLongitude: number | null;
}
