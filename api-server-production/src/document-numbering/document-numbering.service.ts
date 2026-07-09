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
  RECEIPT: 'RCP',
};

@Injectable()
export class DocumentNumberingService {
  constructor(private readonly prisma: PrismaService) {}

  // ---------- pattern engine ----------
  // Replace {YYYY}{YY}{MM}{DD} (and combos like {YYYYMMDD}) with date parts,
  // {DOC} with the document-type short code, and {####} with the zero-padded
  // serial (padding = number of #).
  static format(pattern: string, serial: number, date: Date, docCode = ''): string {
    const YYYY = String(date.getFullYear());
    const YY = YYYY.slice(2);
    const MM = String(date.getMonth() + 1).padStart(2, '0');
    const DD = String(date.getDate()).padStart(2, '0');
    return (pattern || '').replace(/\{([^}]+)\}/g, (_m, tok: string) => {
      if (/^#+$/.test(tok)) return String(serial).padStart(tok.length, '0');
      if (tok === 'DOC') return docCode;
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

  // ---------- generation ----------
  // Returns the next number for a document type. `formatId` picks a specific
  // variant; otherwise the single active variant is used. Returns null when the
  // org has no format for this type (caller keeps its legacy numbering).
  async generateNumber(
    organizationId: string,
    documentType: string,
    formatId?: string | null,
    when: Date = new Date(),
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
    // Atomically claim the serial: reset if the reset-window changed, else use
    // nextSerial; then bump.
    const claimed = await this.prisma.$transaction(async (tx) => {
      const f = await tx.documentNumberFormat.findUnique({ where: { id: format!.id } });
      if (!f) throw new NotFoundException('Number format not found');
      const restart = key != null && f.lastResetKey !== key;
      const serial = restart ? 1 : f.nextSerial;
      await tx.documentNumberFormat.update({
        where: { id: f.id },
        data: { nextSerial: serial + 1, ...(key != null ? { lastResetKey: key } : {}) },
      });
      return serial;
    });

    return DocumentNumberingService.format(format.pattern, claimed, when, DOC_CODE[format.documentType] || '');
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
          DOC_CODE[f.documentType] || '',
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
    return this.prisma.documentNumberFormat.findMany({
      where: { organizationId, ...(documentType ? { documentType } : {}) },
      orderBy: [{ documentType: 'asc' }, { sortOrder: 'asc' }, { createdAt: 'asc' }],
    });
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
