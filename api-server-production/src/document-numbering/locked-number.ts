import { HttpException, HttpStatus } from '@nestjs/common';
import { splitPartNamesAmong } from './document-numbering.service';

/**
 * Round 36 (WCT group, 2026-11-19): a document number claimed INSIDE the transaction that writes the document.
 *
 *   one transaction per attempt:
 *     1. pg_advisory_xact_lock(org + type): every create through this helper waits for the one before it;
 *     2. issueNumberLocked(…, tx): the format's counter row is locked too (a no-op UPDATE), the highest existing
 *        serial is read inside the lock, the counter is bumped (else the legacy prefix + serial, read the same way);
 *     3. insert(tx, number): the row is written with that number.
 *   The number and the row commit (or roll back) together, so a failed insert never burns a serial.
 *
 * A clash with a writer that does not go through here (the editor's New invoice, an import with its own numbers)
 * surfaces as a unique violation: Prisma's P2002 (the per-template unique index) or the aims_inv_number_guard
 * trigger (scripts/invoice-number-guard.ts, "AIMS guard: invoice number …"). The attempt rolls back and the next one
 * takes a fresh number (the clashing row is committed by then, so the scan inside the lock steps over it). Bounded:
 * after `tries` clashes a 409 asks the person to try again.
 */

export const INVOICE_NUMBER_GUARD_TEXT = 'AIMS guard: invoice number';

/** A unique-number clash (retry with a fresh number); anything else is a real failure. */
export function isNumberConflict(e: any): boolean {
  if (!e) return false;
  if (e.code === 'P2002' || e.code === '23505' || e.meta?.code === '23505') return true;
  const text = `${e.message ?? ''} ${e.meta?.message ?? ''} ${e.cause?.message ?? ''}`;
  return text.includes(INVOICE_NUMBER_GUARD_TEXT) || /unique constraint|duplicate key value|unique_violation/i.test(text);
}

/** Run `attempt` up to `tries` times while it fails with a number clash. */
export async function retryOnNumberConflict<T>(attempt: (n: number) => Promise<T>, opts: { tries?: number; what?: string; onConflict?: (n: number, e: unknown) => void } = {}): Promise<T> {
  const tries = Math.max(1, opts.tries ?? 3);
  for (let n = 1; ; n++) {
    try {
      return await attempt(n);
    } catch (e) {
      if (!isNumberConflict(e)) throw e;
      opts.onConflict?.(n, e);
      if (n >= tries) {
        throw new HttpException(`Could not take a free ${opts.what ?? 'document'} number (it was taken at the same moment ${tries} times). Please try again.`, HttpStatus.CONFLICT);
      }
    }
  }
}

/**
 * The legacy number (no active number format): `<prefix><serial>` where prefix is e.g. INV202611- and the serial is
 * one past the highest among the org's documents with that prefix (revisions excluded, split parts count as their
 * base serial), padded to 3. The same rule as DocumentsService.createBasicDocument, read with `db` (a transaction).
 */
export async function legacySerialName(db: { document: { findMany: (args: any) => Promise<any[]> } }, organizationId: string, namePrefix: string): Promise<string> {
  const existing: Array<{ name: string | null }> = await db.document.findMany({ where: { organizationId, name: { startsWith: namePrefix }, baseDocumentId: null }, select: { name: true } });
  let next = 1;
  const partNames = existing.map((d) => d.name || '').filter((n) => /^\d+-\d+$/.test(n.slice(namePrefix.length)));
  const parts = new Set(partNames.length ? await splitPartNamesAmong(db, organizationId, partNames) : []);
  for (const d of existing) {
    const name = d.name || '';
    const m = parts.has(name) ? name.slice(namePrefix.length).match(/^(\d+)-/) : name.match(/-(\d+)$/);
    if (m) next = Math.max(next, parseInt(m[1], 10) + 1);
  }
  return `${namePrefix}${String(next).padStart(3, '0')}`;
}

export interface NumberIssuer {
  issueNumberLocked(organizationId: string, documentType: string, formatId?: string | null, when?: Date, tx?: any): Promise<string | null>;
}

export interface LockedInsert<T> {
  organizationId: string;
  documentType: string;
  /** A specific number format (config.numberFormatId), else the type's active one. */
  formatId?: string | null;
  when?: Date;
  /** The legacy name prefix (e.g. INV202611-) used when the org has no active format for the type. */
  legacyPrefix: string;
  /** Write the row with the number, inside the transaction. */
  insert: (tx: any, name: string) => Promise<T>;
  tries?: number;
  /** Words for the 409 ("invoice"). */
  what?: string;
}

/** Claim the next number and write the row in ONE transaction (see the top of this file); retried on a clash. */
export async function insertWithLockedNumber<T>(prisma: any, numbering: NumberIssuer, args: LockedInsert<T>): Promise<{ row: T; name: string; attempts: number }> {
  const when = args.when ?? new Date();
  return retryOnNumberConflict(
    (attempt) =>
      prisma.$transaction(
        async (tx: any) => {
          await tx.$executeRawUnsafe('SELECT pg_advisory_xact_lock(hashtext($1))', `doc-number:${args.organizationId}:${args.documentType}`);
          const name = (await numbering.issueNumberLocked(args.organizationId, args.documentType, args.formatId ?? null, when, tx)) ?? (await legacySerialName(tx, args.organizationId, args.legacyPrefix));
          const row = await args.insert(tx, name);
          return { row, name, attempts: attempt };
        },
        { timeout: 30000 },
      ),
    { tries: args.tries, what: args.what },
  );
}
