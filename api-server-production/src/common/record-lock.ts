// Per-document Lock (guru 2026-11-20): a Lock button on every accounting document
// (invoices, notes, bills, receipts, payment and journal vouchers…). A locked record
// cannot be edited, deleted, revised, confirmed or unlocked-for-editing at all,
// whatever its status, until someone unlocks it. This sits on top of the paid rule
// (a paid invoice is read-only; remove the payment and it is Awaiting Payment and
// editable again) and the org-wide lock dates (common/period-lock.ts).
//
// Stored on the document's config: recordLocked, recordLockedAt, recordLockedBy.
// Anyone who may update the document may lock it; UNLOCKING needs an accounting
// admin (accounting:update, the same rule as the lock dates) or a platform admin,
// so a lock is not undone by the person it was meant to stop. Both are stamped in
// the document's History (LOCKED / UNLOCKED).
import { ForbiddenException } from '@nestjs/common';

export const RECORD_LOCK_KEYS = ['recordLocked', 'recordLockedAt', 'recordLockedBy'] as const;

export const isRecordLocked = (config: unknown): boolean => !!config && typeof config === 'object' && (config as any).recordLocked === true;

/** The editor rebuilds config from its own field list; keep the lock stamps across a save. */
export function carryRecordLock(prev: unknown, next: Record<string, any> | null | undefined) {
  if (!next || !prev || typeof prev !== 'object') return;
  for (const k of RECORD_LOCK_KEYS) {
    if (next[k] === undefined && (prev as any)[k] !== undefined) next[k] = (prev as any)[k];
  }
}

/** Throws 403 when the record is locked. `verb`: changed / deleted / revised / confirmed… */
export function assertRecordUnlocked(doc: { name?: string | null; config?: unknown } | null | undefined, verb = 'changed') {
  if (!doc || !isRecordLocked(doc.config)) return;
  const by = (doc.config as any)?.recordLockedBy;
  const who = by?.name || by?.email ? ` by ${by.name || by.email}` : '';
  throw new ForbiddenException(`${doc.name || 'This document'} is locked${who}, so it cannot be ${verb}. Unlock it from the toolbar first.`);
}
