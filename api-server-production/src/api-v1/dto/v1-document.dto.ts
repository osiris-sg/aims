import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

// Canonical external payload for POST /v1/documents. Deliberately independent
// of the internal Document.config shape so external callers stay stable while
// internals evolve. Decorators are documentation-only (Swagger schema) — the
// service validates manually so callers get precise, field-level errors.

export class V1Party {
  @ApiPropertyOptional({ example: 'Ee Hup Construction Pte Ltd' })
  name?: string;

  @ApiPropertyOptional({ description: 'Company UEN / GST reg no — used to match an existing customer/supplier first', example: '197902194K' })
  uen?: string;

  @ApiPropertyOptional({ example: 'accounts@eehup.example' })
  email?: string;

  @ApiPropertyOptional({ example: '98340745' })
  phone?: string;

  @ApiPropertyOptional({ example: '22a Beatty Road' })
  address?: string;

  @ApiPropertyOptional({ description: 'Point of contact — stored as the customer\'s primary contact person', example: 'Shengjie Lin' })
  attention?: string;
}

export class V1Line {
  @ApiPropertyOptional({ example: 'Mixed Soil disposal — 17,790 kg @ $16/tonne' })
  description?: string;

  @ApiPropertyOptional({ example: 17.79 })
  quantity?: number;

  @ApiPropertyOptional({ example: 16.0 })
  unitPrice?: number;

  @ApiPropertyOptional({ description: 'Net line amount; derived from quantity × unitPrice when omitted', example: 284.64 })
  amount?: number;

  @ApiPropertyOptional({ example: 25.62 })
  taxAmount?: number;
}

export class V1CreateDocumentDto {
  @ApiProperty({ description: 'INVOICE | BILL | CREDIT_NOTE (alias: CN)', example: 'INVOICE' })
  type: string;

  @ApiPropertyOptional({ description: 'Caller\'s idempotency key — re-sending the same externalId updates the same document instead of duplicating', example: 'weighbridge-txn-8842' })
  externalId?: string;

  @ApiPropertyOptional({ description: 'Document number; auto-numbered from the org\'s number format when omitted', example: 'BIPL-INV-20260723-0001' })
  number?: string;

  @ApiPropertyOptional({ description: 'ISO or yyyy-mm-dd; defaults to now', example: '2026-07-23' })
  date?: string;

  @ApiPropertyOptional({ example: '2026-08-22' })
  dueDate?: string;

  @ApiPropertyOptional({ example: 'PO-4471' })
  reference?: string;

  @ApiPropertyOptional({ default: 'SGD' })
  currency?: string;

  @ApiPropertyOptional({ type: V1Party, description: 'Required for INVOICE / CREDIT_NOTE — matched by UEN, then name (fuzzy), else created' })
  customer?: V1Party;

  @ApiPropertyOptional({ type: V1Party, description: 'Required for BILL — matched/created the same way on the supplier table' })
  supplier?: V1Party;

  @ApiProperty({ type: [V1Line] })
  lines?: V1Line[];

  @ApiPropertyOptional({ description: 'Total GST; defaults to the sum of line taxAmounts', example: 25.62 })
  taxAmount?: number;

  @ApiPropertyOptional({ description: 'Gross total; defaults to net + tax', example: 310.26 })
  totalAmount?: number;

  @ApiPropertyOptional({ description: 'Free-form audit metadata stored on the document', example: { sourceSystem: 'weighbridge', plate: 'XE7645H' } })
  metadata?: Record<string, unknown>;
}
