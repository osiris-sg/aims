// Lock dates (guru 2026-11-20, "see how Xero does it"): Accounting Setup → Financial
// Settings → Lock Dates holds two dates, the same two Xero has.
//
//   staffLockedThroughDate  "Stop all users (except accounting admins) making changes
//                            on and before" — a user WITHOUT accounting:update is refused;
//                            one with it (the same permission that sets the dates, i.e.
//                            Xero's Adviser) may still change records inside it.
//   lockedThroughDate       "Stop all users making changes on and before" — everyone is
//                            refused. The Close Wizard also sets this one.
//
// What is locked, as in Xero: any create / edit / confirm / void / delete / payment of
// a financial record DATED on or before the lock date — invoices, credit and debit
// notes, bills, receipts, payment and journal vouchers, offsets, receive money, contras,
// bank-rec matches and manual journals. Quotations, orders and delivery orders carry no
// money and stay open. A record is checked on its OWN date (the one in the ledger) and,
// on an edit, on the NEW date too, so a document cannot be moved into or out of a locked
// period.
//
// Every refused write throws 403 with a plain sentence the portal toasts as is.
import { ForbiddenException } from '@nestjs/common';
import { isPlatformAdminRole, PLATFORM_ADMIN_ROLE_WHERE } from '../auth/admin-scope';

export type LockDates = { all: string | null; staff: string | null };

type PrismaLike = {
  accountingSetting: { findUnique: (args: any) => Promise<any> };
  userRole: { findMany: (args: any) => Promise<any[]>; findFirst: (args: any) => Promise<any> };
};

const SETTINGS_TTL_MS = 15_000;
const ADVISER_TTL_MS = 60_000;
const settingsCache = new Map<string, { at: number; dates: LockDates }>();
const adviserCache = new Map<string, { at: number; adviser: boolean }>();

/** Document types whose rows carry money into the ledger — the ones a lock date covers. */
export const PERIOD_LOCKED_DOC_TYPES = new Set([
  'INVOICE', 'TI', 'TI2', 'CREDIT_NOTE', 'DEBIT_NOTE', 'SUPPLIER_CREDIT_NOTE', 'SUPPLIER_DEBIT_NOTE',
  'BILL', 'PURCHASE_INVOICE', 'PURCHASE_RETURN',
  'OFFICIAL_RECEIPT', 'PAYMENT_VOUCHER', 'JOURNAL_VOUCHER', 'MANUAL_OFFSET', 'AP_OFFSET',
  'SPEND_MONEY', 'RECEIVE_MONEY', 'CONTRA', 'BANK_TRANSFER',
]);

export const isPeriodLockedDocType = (type: string | null | undefined): boolean => {
  const t = String(type || '').toUpperCase();
  if (!t) return false;
  if (PERIOD_LOCKED_DOC_TYPES.has(t)) return true;
  return /INVOICE|NOTE|RECEIPT|VOUCHER|BILL|OFFSET|MONEY|CONTRA/.test(t);
};

/** YYYY-MM-DD of a date-ish value (ISO, dd/mm/yyyy, Date); null when unreadable. */
export function lockDay(value: unknown): string | null {
  if (!value) return null;
  if (value instanceof Date) return Number.isNaN(value.getTime()) ? null : value.toISOString().slice(0, 10);
  const v = String(value).trim();
  const iso = /^(\d{4})-(\d{2})-(\d{2})/.exec(v);
  if (iso) return `${iso[1]}-${iso[2]}-${iso[3]}`;
  const dmy = /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/.exec(v);
  if (dmy) return `${dmy[3]}-${dmy[2].padStart(2, '0')}-${dmy[1].padStart(2, '0')}`;
  const d = new Date(v);
  return Number.isNaN(d.getTime()) ? null : d.toISOString().slice(0, 10);
}

/** A document's own date: the editor's documentInfo.date, else the legacy config keys, else creation. */
export function documentDay(config: any, createdAt?: Date | string | null): string | null {
  const raw = [
    config?.documentInfo?.date, config?.date, config?.issueDate, config?.invoiceDate,
    config?.billDate, config?.receiptDate, config?.paymentDate, config?.voucherDate, config?.entryDate,
  ].find((v) => (typeof v === 'string' && v.trim()) || v instanceof Date);
  return lockDay(raw) ?? (createdAt ? lockDay(createdAt) : null);
}

const fmt = (day: string): string => {
  const [y, m, d] = day.split('-');
  return `${d}/${m}/${y}`;
};

export async function lockDatesOf(prisma: PrismaLike, organizationId: string): Promise<LockDates> {
  const hit = settingsCache.get(organizationId);
  if (hit && Date.now() - hit.at < SETTINGS_TTL_MS) return hit.dates;
  const s = await prisma.accountingSetting.findUnique({
    where: { organizationId },
    select: { lockedThroughDate: true, staffLockedThroughDate: true },
  });
  const dates: LockDates = { all: lockDay(s?.lockedThroughDate), staff: lockDay(s?.staffLockedThroughDate) };
  settingsCache.set(organizationId, { at: Date.now(), dates });
  return dates;
}

/** Call after the lock dates are saved so the next write sees them at once. */
export const forgetLockDates = (organizationId: string) => settingsCache.delete(organizationId);

/** Xero's "Adviser": holds accounting:update in this org (or is a platform admin). */
export async function isLockAdviser(prisma: PrismaLike, organizationId: string, userId?: string | null): Promise<boolean> {
  if (!userId) return false;
  const key = `${organizationId}:${userId}`;
  const hit = adviserCache.get(key);
  if (hit && Date.now() - hit.at < ADVISER_TTL_MS) return hit.adviser;
  let adviser = false;
  try {
    // Two scoped reads (per-org tenancy routes each by its organizationId): the
    // platform admin's role lives in the osiris-platform org, the user's own
    // roles in this org. An unscoped read would only see the request org.
    const [platformRow, rows] = await Promise.all([
      prisma.userRole.findFirst({ where: { userId, isActive: true, ...PLATFORM_ADMIN_ROLE_WHERE }, select: { id: true } }).catch(() => null),
      prisma.userRole.findMany({
        where: { userId, organizationId, isActive: true },
        include: { role: { include: { permissions: true } } },
      }),
    ]);
    adviser =
      !!platformRow ||
      rows.some((ur: any) => {
        if (isPlatformAdminRole(ur)) return true;
        const perms: any[] = ur.role?.permissions || [];
        return perms.some((p) => (p.resource === 'accounting' || p.resource === '*') && (p.action === 'update' || p.action === '*'));
      });
  } catch {
    adviser = false;
  }
  adviserCache.set(key, { at: Date.now(), adviser });
  return adviser;
}

export type PeriodOpenArgs = {
  organizationId: string;
  /** The record's date (and, on an edit, pass the new date in a second call). */
  date: unknown;
  /** Who is writing; undefined = a system actor, treated as staff. */
  actorId?: string | null;
  /** "Invoice BI2026090012" / "This receipt" / "The payment" — starts the sentence. */
  what: string;
  /** "changed" / "deleted" / "confirmed" / "voided" / "recorded"; default "changed". */
  verb?: string;
};

/**
 * Throws 403 when `date` falls on or before a lock date that binds this actor.
 * A record with no readable date is treated as today's (never silently open).
 */
export async function assertPeriodOpen(prisma: PrismaLike, args: PeriodOpenArgs): Promise<void> {
  const dates = await lockDatesOf(prisma, args.organizationId);
  if (!dates.all && !dates.staff) return;
  const day = lockDay(args.date) ?? new Date().toISOString().slice(0, 10);
  const verb = args.verb || 'changed';
  if (dates.all && day <= dates.all) {
    throw new ForbiddenException(
      `${args.what} is dated ${fmt(day)}, inside the locked period (locked through ${fmt(dates.all)}), so it cannot be ${verb}. Move the lock date in Accounting Setup, Financial Settings, Lock Dates first.`,
    );
  }
  if (dates.staff && day <= dates.staff && !(await isLockAdviser(prisma, args.organizationId, args.actorId))) {
    throw new ForbiddenException(
      `${args.what} is dated ${fmt(day)}, inside the locked period (locked through ${fmt(dates.staff)}), so it cannot be ${verb}. Only an accounting admin can change records in this period, or move the lock date in Accounting Setup, Financial Settings, Lock Dates.`,
    );
  }
}

/** The lock date that binds THIS actor, for screens: the later of the two that applies. */
export async function effectiveLockDay(prisma: PrismaLike, organizationId: string, actorId?: string | null): Promise<string | null> {
  const dates = await lockDatesOf(prisma, organizationId);
  if (!dates.all && !dates.staff) return null;
  const adviser = dates.staff ? await isLockAdviser(prisma, organizationId, actorId) : true;
  const candidates = [dates.all, adviser ? null : dates.staff].filter((d): d is string => !!d);
  return candidates.length ? candidates.sort()[candidates.length - 1] : null;
}
