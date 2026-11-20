// Void an accounting document (guru 2026-11-20: "there is no way to void an
// actual document — we voided the J/V with AIMEE and the invoice still said
// Awaiting Payment").
//
// ONE marker, already honoured everywhere: config.voided === true. The owed
// amount reads 0 (document-money.ts), AR / statements / aged reports skip the
// row, the lists hide it by default and show it under the "Voided" status
// filter, the editor opens it read-only, and the status pill reads Voided.
// Stamped with voidedAt / voidedBy / voidReason.
//
// Voiding a document voids EVERY live journal posted from it (sourceDocumentId)
// and voiding one of those journals by hand (GL → Void, AIMEE) voids the
// document the same way, so the two can never disagree again. A document with
// money recorded against it is never voided: delete the receipt(s) first (it
// goes back to Awaiting Payment), then void. There is no un-void, as in Xero.
import { BadRequestException, NotFoundException } from '@nestjs/common';
import { amountPaidOf } from './document-money';
import { assertPeriodOpen, documentDay } from './period-lock';
import { assertRecordUnlocked } from './record-lock';

export const isDocumentVoided = (config: unknown): boolean => !!config && typeof config === 'object' && (config as any).voided === true;

/** Throws 400 when the document is voided. `verb`: changed / confirmed / revised / edited… */
export function assertNotVoided(doc: { name?: string | null; config?: unknown } | null | undefined, verb = 'changed') {
  if (!doc || !isDocumentVoided(doc.config)) return;
  throw new BadRequestException(`${doc.name || 'This document'} is voided, so it cannot be ${verb}.`);
}

/** Journal types that ARE the document's own posting (its payments carry sourcePaymentId instead). */
export const DOCUMENT_JOURNAL_TYPES = ['INVOICE', 'CREDIT_NOTE', 'DEBIT_NOTE', 'PURCHASE_ORDER', 'PURCHASE_RETURN', 'BILL'];

/** Receipts / vouchers are never voided: deleting one voids its journal (their own remove paths). */
const SETTLEMENT_TYPES = ['OFFICIAL_RECEIPT', 'OR', 'PAYMENT_VOUCHER', 'PV', 'JOURNAL_VOUCHER', 'JV'];

export type VoidActor = { id?: string; name?: string | null; email?: string | null };

export type VoidDocumentResult = {
  success: true;
  voided: true;
  alreadyVoided: boolean;
  journalsVoided: string[];
  voidedAt: string | null;
  voidedBy: { id: string; name: string | null; email: string | null } | null;
};

/**
 * Ids of the org's voided documents (config.voided), for the list pages: hidden
 * by default, the only rows under the "Voided" status filter.
 */
export async function voidedDocumentIds(prisma: any, organizationId: string): Promise<string[]> {
  const rows: Array<{ id: string }> = await prisma.$queryRaw`
    SELECT d.id FROM "Document" d
    WHERE d."organizationId" = ${organizationId}
      AND d.config ->> 'voided' = 'true'
    LIMIT 5000`;
  return rows.map((r) => r.id);
}

/**
 * The one void path. `voidJournal` is JournalService.void (the caller owns the
 * service); `log` writes the document's History row (documents.service
 * logDocumentEvent, or a plain AuditLog row from the journal side).
 */
export async function voidDocumentCore(
  prisma: any,
  opts: {
    organizationId: string;
    documentId: string;
    actor?: VoidActor;
    reason?: string | null;
    voidJournal: (journalId: string) => Promise<unknown>;
    log: (detail: string, documentName: string | undefined) => Promise<unknown>;
  },
): Promise<VoidDocumentResult> {
  const { organizationId, documentId, actor } = opts;
  const doc: any = await prisma.document.findFirst({
    where: { id: documentId, organizationId },
    select: { id: true, name: true, type: true, status: true, config: true, createdAt: true },
  });
  if (!doc) throw new NotFoundException('Document not found');
  const config: any = { ...((doc.config as any) || {}) };
  const name = doc.name || 'This document';
  if (isDocumentVoided(config)) {
    return { success: true, voided: true, alreadyVoided: true, journalsVoided: [], voidedAt: config.voidedAt ?? null, voidedBy: config.voidedBy ?? null };
  }
  const type = String(doc.type || '').toUpperCase();
  if (SETTLEMENT_TYPES.includes(type)) {
    throw new BadRequestException(`${name} is a receipt or voucher: delete it instead, and its journal is voided with it.`);
  }
  assertRecordUnlocked(doc, 'voided');
  await assertPeriodOpen(prisma, { organizationId, date: documentDay(config, doc.createdAt), actorId: actor?.id, what: name, verb: 'voided' });

  // Money recorded against it: the receipts / vouchers own that money, so they go first. A PAID
  // status counts even without Payment rows or stamps (Xero-imported paid invoices carry neither).
  const paymentRows: number = await prisma.payment.count({ where: { organizationId, documentId } }).catch(() => 0);
  const paidStamp = amountPaidOf(config) ?? 0;
  const paidStatus = String(doc.status || '').toLowerCase() === 'paid' || ['PAID', 'PARTIALLY_PAID'].includes(String(config.billStatus || '').toUpperCase());
  if (paymentRows > 0 || paidStamp > 0.005 || paidStatus) {
    const n = paymentRows || 1;
    throw new BadRequestException(
      `${name} is ${paidStatus && !paymentRows ? 'paid' : `${n === 1 ? 'a' : n} payment${n === 1 ? '' : 's'} in`}: money is recorded against it. Delete the receipt${n === 1 ? '' : 's'} first (it goes back to Awaiting Payment), then void it.`,
    );
  }

  // Every live journal posted FROM this document (the void-by-hand path voids itself here too).
  const journals: Array<{ id: string; journalNumber: string | null }> = await prisma.journalEntry.findMany({
    where: { organizationId, sourceDocumentId: documentId, status: { not: 'VOID' } },
    select: { id: true, journalNumber: true },
  });
  for (const je of journals) await opts.voidJournal(je.id);

  const at = new Date().toISOString();
  const by = actor?.id ? { id: actor.id, name: actor.name || null, email: actor.email || null } : null;
  const reason = String(opts.reason || '').trim() || null;
  config.voided = true;
  config.voidedAt = at;
  config.voidedBy = by;
  config.voidReason = reason;
  if (type === 'BILL') config.billStatus = 'VOID';
  await prisma.document.update({ where: { id: documentId }, data: { config } });

  const who = by?.name || by?.email || 'system';
  const jnums = journals.map((j) => j.journalNumber).filter(Boolean);
  await opts.log(
    `Voided by ${who}${reason ? `: ${reason}` : ''}${jnums.length ? ` (journal ${jnums.join(', ')} voided)` : ''}. Was ${doc.status}.`,
    doc.name || undefined,
  );
  return { success: true, voided: true, alreadyVoided: false, journalsVoided: jnums as string[], voidedAt: at, voidedBy: by };
}
