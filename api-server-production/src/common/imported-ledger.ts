import { BadRequestException } from '@nestjs/common';

/**
 * Documents whose GL entry lives somewhere else.
 *
 * The receipts and payment vouchers minted from Xero payments
 * (`scripts/import-xero-payments-as-documents.ts`, 2,950 of them on Biofuel
 * prod 2026-11-16) are PAPERWORK ONLY: the ledger already holds that payment's
 * imported `JV-XERO-#####` journal, so they were written with no journal and no
 * payment rows of their own.
 *
 * Saving such a document through the normal service would post a fresh journal
 * for money the GL already has. That is exactly what happened to the MSK Star
 * receipt UOBOR2610-002 — `JV-000946` duplicated `JV-XERO-30912` and the ledger
 * double-counted 100,904.24 until it was voided on 2026-11-16.
 *
 * So these documents are read-only. To change one, void it and key a new one.
 */
export const LEDGER_ELSEWHERE_SOURCES = ['xero-import'] as const;

export function ledgerLivesElsewhere(config: unknown): boolean {
  const source = (config as any)?.glSource;
  return typeof source === 'string' && (LEDGER_ELSEWHERE_SOURCES as readonly string[]).includes(source);
}

export function assertLedgerNotElsewhere(config: unknown, what: 'receipt' | 'payment voucher'): void {
  if (!ledgerLivesElsewhere(config)) return;
  throw new BadRequestException(
    `This ${what} was imported from Xero, so its ledger entry is the imported journal, not one of its own. ` +
      `Saving it here would post the same money to the GL twice. Void it and key a new ${what} if it needs to change.`,
  );
}
