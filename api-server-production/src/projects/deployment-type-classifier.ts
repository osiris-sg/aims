/**
 * Classify a ProjectDeployment as RENTAL or SALE.
 *
 * Heuristic (in priority order):
 *   1. Any invoice line-item description matches the rental signal regex → RENTAL.
 *   2. Source document is a DO / DELIVERY_ORDER → RENTAL (deployed via a DO is
 *      typically a rental, not a one-off sale).
 *   3. More than one invoice in the bucket → RENTAL (recurring billing fallback,
 *      since multiple invoices across time suggest a recurring relationship).
 *   4. Otherwise → SALE.
 *
 * Shared single-source-of-truth for:
 *   - scripts/backfill-biofuel-deployments.ts (initial import classification)
 *   - scripts/reclassify-deployment-types.ts (one-off correction of existing rows)
 *
 * Note: SERVICE-type deployments aren't detected here. SERVICE-ness is computed
 * at view time from DocumentItem.isService (see projects.service.ts:isServiceOnly)
 * rather than stored on the deployment row.
 */

export const RENTAL_SIGNAL =
  /\brental\b|\bmonthly\b|\bmonth(s)?\b|\d+(st|nd|rd|th)\s*(month|mth)|recurring|rental\s*period|rental\s*rate|off.?hire/i;

export interface ClassifyInput {
  descriptions: string[];
  invoiceCount: number;
  sourceDocType?: string | null;
}

export interface ClassifyResult {
  type: 'RENTAL' | 'SALE';
  reason: string;             // human-readable reason for the choice
  matched?: string | null;    // the literal substring that matched (signal path only)
}

export function classifyDeployment(input: ClassifyInput): ClassifyResult {
  const { descriptions, invoiceCount, sourceDocType } = input;

  for (const desc of descriptions) {
    const m = desc.match(RENTAL_SIGNAL);
    if (m) {
      return {
        type: 'RENTAL',
        reason: `matched "${m[0]}" in invoice description`,
        matched: m[0],
      };
    }
  }

  if (sourceDocType === 'DO' || sourceDocType === 'DELIVERY_ORDER') {
    return {
      type: 'RENTAL',
      reason: 'source document is a DO (deployed via a delivery order)',
      matched: null,
    };
  }

  if (invoiceCount > 1) {
    return {
      type: 'RENTAL',
      reason: `invoice count = ${invoiceCount} (recurring billing fallback)`,
      matched: null,
    };
  }

  return {
    type: 'SALE',
    reason: 'no rental signal, no DO source, single invoice',
    matched: null,
  };
}
