import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../common/prisma.service';

type FormatDto = {
  documentType: string;
  label: string;
  pattern: string;
  resetPolicy?: string; // never | daily | monthly | yearly
  nextSerial?: number;
  isActive?: boolean;
  sortOrder?: number;
};

// Short code per document type — used by the {DOC} token so one "default"
// pattern (e.g. BIPL-EW-{DOC}-{YYYYMMDD}-{####}) yields INV/QO/DO per type.
export const DOC_CODE: Record<string, string> = {
  QUOTATION: 'QO',
  SALES_ORDER: 'SO',
  DELIVERY_ORDER: 'DO',
  INVOICE: 'INV',
  CREDIT_NOTE: 'CN',
  DEBIT_NOTE: 'DN',
  PROFORMA: 'PF',
  PURCHASE_ORDER: 'PO',
  PURCHASE_RETURN: 'PR',
  STOCK_ADJUSTMENT: 'SA',
  PAYMENT_VOUCHER: 'PV',
  // Official Receipt (the AR receipt document, type OFFICIAL_RECEIPT). The
  // old 'RECEIPT' key never matched a real document type; rows seeded under
  // it are inert (guru/Heimen 2026-11-05).
  OFFICIAL_RECEIPT: 'OR',
};

/**
 * {BANK} token (Heimen 2026-11-05: "SCBOR2610-001 … if it's UOB the first
 * three change to UOB"). An Official Receipt / Payment Voucher number can
 * carry the short code of the bank it was deposited to / paid from. The code
 * comes from the bank's chart-of-account NAME: a known-bank table first, then
 * the name's own acronym (an all-caps word such as "DBS", or the initials of
 * the remaining words), then its first three letters. Shared with the Setup
 * builder's preview, which shows the same derivation for "Standard Chartered
 * Bank" → SCB.
 */
const KNOWN_BANKS: Array<[RegExp, string]> = [
  [/standard\s*chartered|\bscb\b/i, 'SCB'],
  [/united\s*overseas|\buob\b/i, 'UOB'],
  [/\bdbs\b|posb/i, 'DBS'],
  [/\bocbc\b|oversea.?chinese/i, 'OCBC'],
  [/maybank|malayan\s*banking|\bmbb\b/i, 'MBB'],
  [/\bhsbc\b|hongkong\s*and\s*shanghai/i, 'HSBC'],
  [/citi/i, 'CITI'],
  [/airwallex|\bawx\b/i, 'AWX'],
  [/aspire/i, 'ASP'],
  [/\bwise\b|transferwise/i, 'WISE'],
  [/paypal/i, 'PPL'],
  [/petty\s*cash/i, 'PC'],
  [/\bcash\b/i, 'CASH'],
];
const BANK_NOISE = /^(bank|pte|ltd|limited|account|a\/c|acct|current|savings|sgd|usd|eur|jpy|myr|the|of|and|&|-|\d+)$/i;

export function bankCodeOf(accountName: string | null | undefined): string {
  const name = String(accountName || '').trim();
  if (!name) return '';
  for (const [re, code] of KNOWN_BANKS) if (re.test(name)) return code;
  const words = name.split(/[\s()/,.-]+/).filter((w) => w && !BANK_NOISE.test(w));
  const acronym = words.find((w) => /^[A-Z]{3,5}$/.test(w));
  if (acronym) return acronym;
  const initials = words.map((w) => w[0].toUpperCase()).join('');
  if (initials.length >= 2) return initials.slice(0, 4);
  return (words[0] || name).replace(/[^A-Za-z]/g, '').slice(0, 3).toUpperCase();
}

/** True when a pattern carries the {BANK} token — its number needs the bank account first. */
export const patternNeedsBank = (pattern: string | null | undefined) => /\{BANK\}/.test(pattern || '');

/**
 * WCT orders (enableWctOrders, 2026-11-01): the Order number is issued from an
 * ORDER format too (default ORD{YYYY}{MM}-{###}). Kept OUT of DOC_CODE on
 * purpose: "Apply to all" walks DOC_CODE, and must not start creating ORDER
 * formats for every org. Its numbers live in Order.orderNumber, not
 * Document.name, so the "highest existing" scan reads the Order table.
 */
export const ORDER_NUMBER_TYPE = 'ORDER';
export const ORDER_DOC_CODE = 'ORD';
export const DEFAULT_ORDER_PATTERN = '{DOC}{YYYY}{MM}-{###}';
const docCodeOf = (documentType: string) => DOC_CODE[documentType] || (documentType === ORDER_NUMBER_TYPE ? ORDER_DOC_CODE : '');

type NamesDb = {
  document: { findMany: (args: any) => Promise<Array<{ name: string | null }>> };
  order?: { findMany: (args: any) => Promise<Array<{ orderNumber: string | null }>> };
};

@Injectable()
export class DocumentNumberingService {
  constructor(private readonly prisma: PrismaService) {}

  // ---------- pattern engine ----------
  // Replace {YYYY}{YY}{MM}{DD} (and combos like {YYYYMMDD}) with date parts,
  // {DOC} with the document-type short code, and {####} with the zero-padded
  // serial (padding = number of #).
  static format(pattern: string, serial: number, date: Date, docCode = '', bankCode = ''): string {
    const YYYY = String(date.getFullYear());
    const YY = YYYY.slice(2);
    const MM = String(date.getMonth() + 1).padStart(2, '0');
    const DD = String(date.getDate()).padStart(2, '0');
    return (pattern || '').replace(/\{([^}]+)\}/g, (_m, tok: string) => {
      if (/^#+$/.test(tok)) return String(serial).padStart(tok.length, '0');
      if (tok === 'DOC') return docCode;
      if (tok === 'BANK') return bankCode;
      return tok
        .replace(/YYYY/g, YYYY)
        .replace(/YY/g, YY)
        .replace(/MM/g, MM)
        .replace(/DD/g, DD);
    });
  }

  private resetKey(policy: string | null | undefined, date: Date): string | null {
    const YYYY = String(date.getFullYear());
    const MM = String(date.getMonth() + 1).padStart(2, '0');
    const DD = String(date.getDate()).padStart(2, '0');
    switch (policy) {
      case 'daily':
        return `${YYYY}-${MM}-${DD}`;
      case 'monthly':
        return `${YYYY}-${MM}`;
      case 'yearly':
        return YYYY;
      default:
        return null; // never
    }
  }

  // Highest serial already used by an existing document in this pattern's
  // namespace. Imported documents (e.g. Xero migrations) carry their own
  // numbers and never touch nextSerial, so without this the counter lags
  // behind (or collides with) the imported sequence. Split the pattern at its
  // serial token, resolve the literal/date prefix+suffix for `when`, and find
  // the highest serial among matching documents. Serial padding is tolerant
  // (\d+), so Xero's "BI202607046" bumps a {####} counter to 47.
  private async maxExistingSerial(
    organizationId: string,
    pattern: string,
    docCode: string,
    when: Date,
    db: NamesDb = this.prisma,
    documentType?: string,
    bankCode = '',
  ): Promise<number> {
    const serialToken = /\{(#+)\}/.exec(pattern);
    if (!serialToken) return 0;
    const prefix = DocumentNumberingService.format(pattern.slice(0, serialToken.index), 0, when, docCode, bankCode);
    const suffix = DocumentNumberingService.format(
      pattern.slice(serialToken.index + serialToken[0].length),
      0,
      when,
      docCode,
      bankCode,
    );
    if (!prefix) return 0;
    const existing =
      documentType === ORDER_NUMBER_TYPE && db.order
        ? (await db.order.findMany({ where: { organizationId, orderNumber: { startsWith: prefix } }, select: { orderNumber: true } })).map((o) => ({ name: o.orderNumber }))
        : await db.document.findMany({
            where: { organizationId, name: { startsWith: prefix } },
            select: { name: true },
          });
    let max = 0;
    for (const d of existing) {
      const name = d.name || '';
      if (suffix && !name.endsWith(suffix)) continue;
      const mid = name.slice(prefix.length, suffix ? name.length - suffix.length : undefined);
      if (/^\d+$/.test(mid)) max = Math.max(max, parseInt(mid, 10));
    }
    return max;
  }

  // ---------- generation ----------
  // Returns the next number for a document type. `formatId` picks a specific
  // variant; otherwise the single active variant is used. Returns null when the
  // org has no format for this type (caller keeps its legacy numbering).
  async generateNumber(
    organizationId: string,
    documentType: string,
    formatId?: string | null,
    when: Date = new Date(),
    opts: { bankCode?: string } = {},
  ): Promise<string | null> {
    let format = formatId
      ? await this.prisma.documentNumberFormat.findFirst({ where: { id: formatId, organizationId } })
      : null;
    if (!format) {
      const active = await this.prisma.documentNumberFormat.findMany({
        where: { organizationId, documentType, isActive: true },
        orderBy: { sortOrder: 'asc' },
      });
      if (active.length === 0) return null; // no custom numbering → legacy fallback
      format = active[0]; // exactly-one (or the first) active variant
    }

    const key = this.resetKey(format.resetPolicy, when);
    const docCode = docCodeOf(format.documentType);
    const bankCode = opts.bankCode || '';
    const perBank = patternNeedsBank(format.pattern);
    const maxExisting = await this.maxExistingSerial(organizationId, format.pattern, docCode, when, this.prisma, format.documentType, bankCode);

    // Atomically claim the serial: reset if the reset-window changed, else use
    // nextSerial — never below one past the highest existing number; then bump.
    // A {BANK} pattern runs ONE SERIES PER BANK (SCBOR2611-001 and
    // UOBOR2611-001 both exist): the series is read off the documents that
    // already carry that bank's prefix, so the shared counter row only
    // records the last number issued.
    const claimed = await this.prisma.$transaction(async (tx) => {
      const f = await tx.documentNumberFormat.findUnique({ where: { id: format!.id } });
      if (!f) throw new NotFoundException('Number format not found');
      const restart = key != null && f.lastResetKey !== key;
      const serial = perBank ? maxExisting + 1 : Math.max(restart ? 1 : f.nextSerial, maxExisting + 1);
      await tx.documentNumberFormat.update({
        where: { id: f.id },
        data: { nextSerial: serial + 1, ...(key != null ? { lastResetKey: key } : {}) },
      });
      return serial;
    });

    return DocumentNumberingService.format(format.pattern, claimed, when, docCode, bankCode);
  }

  /**
   * The number the next issue WOULD mint, without claiming it (guru
   * 2026-11-05: "when I select the bank I want the first three to auto
   * fill"). The OR/PV editors show it in the number box as soon as the bank
   * is chosen; the save then sends it back as the typed number, and the
   * server re-checks it is still free. `bankAccountCode` is resolved to the
   * bank's short code here so the client never has to know the mapping.
   */
  async peekNumber(
    organizationId: string,
    documentType: string,
    opts: { bankAccountCode?: string | null; when?: Date } = {},
  ): Promise<{ number: string; bankCode: string } | null> {
    const format = await this.activeFormat(organizationId, documentType);
    if (!format) return null;
    const when = opts.when && !isNaN(opts.when.getTime()) ? opts.when : new Date();
    let bankCode = '';
    if (opts.bankAccountCode) {
      const acc = await this.prisma.chartOfAccount.findFirst({
        where: { organizationId, code: opts.bankAccountCode },
        select: { name: true, code: true },
      });
      bankCode = bankCodeOf(acc?.name || opts.bankAccountCode);
    }
    if (patternNeedsBank(format.pattern) && !bankCode) return null;
    const docCode = docCodeOf(format.documentType);
    const maxExisting = await this.maxExistingSerial(organizationId, format.pattern, docCode, when, this.prisma, format.documentType, bankCode);
    const key = this.resetKey(format.resetPolicy, when);
    const restart = key != null && format.lastResetKey !== key;
    const serial = patternNeedsBank(format.pattern) ? maxExisting + 1 : Math.max(restart ? 1 : format.nextSerial, maxExisting + 1);
    return { number: DocumentNumberingService.format(format.pattern, serial, when, docCode, bankCode), bankCode };
  }

  /** The active format for a type, or null — lets OR/PV decide whether a number
   *  can be issued at creation or must wait for the bank account ({BANK}). */
  async activeFormat(organizationId: string, documentType: string) {
    return this.prisma.documentNumberFormat.findFirst({
      where: { organizationId, documentType, isActive: true },
      orderBy: { sortOrder: 'asc' },
    });
  }

  /**
   * Issue the next number with the format's counter row LOCKED for the whole
   * claim (enableRealDoOnSchedule, WCT 2026-10-30: a scheduled run's DO gets its
   * real number at once, so two office users scheduling at the same moment must
   * never get the same one). A no-op UPDATE takes the row lock; a concurrent
   * issuer waits on it until this transaction commits and then reads the bumped
   * counter. The highest existing number is read INSIDE the lock, so imported
   * or hand-typed numbers are still skipped. Same pattern, reset and padding as
   * generateNumber, which every other caller keeps using unchanged. Null when
   * the org has no active format for the type (caller falls back).
   *
   * `tx` (WCT orders): claim inside the caller's open transaction instead of a
   * new one, so the number and the row that carries it commit (or roll back)
   * together.
   */
  async issueNumberLocked(
    organizationId: string,
    documentType: string,
    formatId?: string | null,
    when: Date = new Date(),
    tx?: any,
    opts: { bankCode?: string } = {},
  ): Promise<string | null> {
    let format = formatId
      ? await this.prisma.documentNumberFormat.findFirst({ where: { id: formatId, organizationId } })
      : null;
    if (!format) {
      format = await this.prisma.documentNumberFormat.findFirst({
        where: { organizationId, documentType, isActive: true },
        orderBy: { sortOrder: 'asc' },
      });
      if (!format) return null;
    }
    const docCode = docCodeOf(format.documentType);
    const key = this.resetKey(format.resetPolicy, when);
    const bankCode = opts.bankCode || '';
    const claim = async (db: any) => {
      const f = await db.documentNumberFormat.update({ where: { id: format!.id }, data: { nextSerial: { increment: 0 } } });
      const maxExisting = await this.maxExistingSerial(organizationId, f.pattern, docCode, when, db, f.documentType, bankCode);
      const restart = key != null && f.lastResetKey !== key;
      // {BANK}: one series per bank — see generateNumber.
      const serial = patternNeedsBank(f.pattern) ? maxExisting + 1 : Math.max(restart ? 1 : f.nextSerial, maxExisting + 1);
      await db.documentNumberFormat.update({
        where: { id: f.id },
        data: { nextSerial: serial + 1, ...(key != null ? { lastResetKey: key } : {}) },
      });
      return DocumentNumberingService.format(f.pattern, serial, when, docCode, bankCode);
    };
    return tx ? claim(tx) : this.prisma.$transaction((t) => claim(t));
  }

  // Roll the counter back when a just-numbered document is deleted (e.g. the
  // editor's auto-delete of untouched drafts) so the serial isn't burned.
  // Best-effort: only releases when the deleted doc's number is EXACTLY the
  // last one claimed by a format (re-verified inside the transaction, so a
  // concurrent create can't be clobbered). Date-token patterns won't match
  // across a date boundary — the serial stays burned then, which is safe.
  async releaseNumberIfLatest(
    organizationId: string,
    documentType: string,
    documentName: string,
    when: Date = new Date(),
  ): Promise<boolean> {
    if (!documentName) return false;
    const formats = await this.prisma.documentNumberFormat.findMany({
      where: { organizationId, documentType },
    });
    for (const format of formats) {
      const released = await this.prisma.$transaction(async (tx) => {
        const f = await tx.documentNumberFormat.findUnique({ where: { id: format.id } });
        if (!f || f.nextSerial <= 1) return false;
        const lastSerial = f.nextSerial - 1;
        const expected = DocumentNumberingService.format(
          f.pattern,
          lastSerial,
          when,
          docCodeOf(f.documentType),
        );
        if (expected !== documentName) return false;
        await tx.documentNumberFormat.update({
          where: { id: f.id },
          data: { nextSerial: lastSerial },
        });
        return true;
      });
      if (released) return true;
    }
    return false;
  }

  // ---------- CRUD ----------
  async list(organizationId: string, documentType?: string) {
    const formats = await this.prisma.documentNumberFormat.findMany({
      where: { organizationId, ...(documentType ? { documentType } : {}) },
      orderBy: [{ documentType: 'asc' }, { sortOrder: 'asc' }, { createdAt: 'asc' }],
    });
    // Attach the number generation would ACTUALLY mint right now — the raw
    // nextSerial ignores imported documents and reset windows, so a client
    // preview computed from it shows stale numbers (e.g. BI2026070005 when the
    // Xero imports already reach BI202607069).
    const when = new Date();
    return Promise.all(
      formats.map(async (f) => {
        const docCode = docCodeOf(f.documentType);
        const maxExisting = await this.maxExistingSerial(organizationId, f.pattern, docCode, when, this.prisma, f.documentType);
        const key = this.resetKey(f.resetPolicy, when);
        const restart = key != null && f.lastResetKey !== key;
        const serial = Math.max(restart ? 1 : f.nextSerial, maxExisting + 1);
        return { ...f, preview: DocumentNumberingService.format(f.pattern, serial, when, docCode) };
      }),
    );
  }

  async create(organizationId: string, dto: FormatDto) {
    return this.prisma.documentNumberFormat.create({
      data: {
        organizationId,
        documentType: dto.documentType,
        label: dto.label,
        pattern: dto.pattern,
        resetPolicy: dto.resetPolicy || 'never',
        nextSerial: dto.nextSerial ?? 1,
        isActive: dto.isActive ?? true,
        sortOrder: dto.sortOrder ?? 0,
      },
    });
  }

  // Create the same variant for EVERY document type in one go (the {DOC} token
  // resolves to each type's code). Skips a type if the same variant label already
  // exists for it, so re-applying is idempotent.
  async applyToAll(organizationId: string, dto: FormatDto) {
    let created = 0;
    for (const documentType of Object.keys(DOC_CODE)) {
      const exists = await this.prisma.documentNumberFormat.findFirst({ where: { organizationId, documentType, label: dto.label } });
      if (exists) continue;
      await this.create(organizationId, { ...dto, documentType });
      created += 1;
    }
    return { created };
  }

  async update(organizationId: string, id: string, dto: Partial<FormatDto>) {
    const existing = await this.prisma.documentNumberFormat.findFirst({ where: { id, organizationId } });
    if (!existing) throw new NotFoundException('Number format not found');
    return this.prisma.documentNumberFormat.update({
      where: { id },
      data: {
        documentType: dto.documentType ?? undefined,
        label: dto.label ?? undefined,
        pattern: dto.pattern ?? undefined,
        resetPolicy: dto.resetPolicy ?? undefined,
        nextSerial: dto.nextSerial !== undefined ? dto.nextSerial : undefined,
        isActive: dto.isActive ?? undefined,
        sortOrder: dto.sortOrder !== undefined ? dto.sortOrder : undefined,
      },
    });
  }

  async remove(organizationId: string, id: string) {
    await this.prisma.documentNumberFormat.deleteMany({ where: { id, organizationId } });
    return { ok: true };
  }
}
