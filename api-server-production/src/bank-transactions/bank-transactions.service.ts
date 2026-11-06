import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../common/prisma.service';
import { JournalAutoPostService } from '../journal/journal-auto-post.service';
import { JournalService } from '../journal/journal.service';
import { AuditService } from 'src/common/audit.service';
import { DocumentNumberingService, bankCodeOf } from '../document-numbering/document-numbering.service';

const ROUND = (n: number) => Math.round(n * 100) / 100;

// ---------------------------------------------------------------------------
// Spend Money / Receive Money (guru 2026-11-06) — Xero's direct bank
// transactions. A payment that has NO supplier invoice behind it (a bank
// charge, a petty purchase, a director's reimbursement) or money in that has
// NO customer invoice (interest, a refund, a grant). Before this the only
// homes were a hand-keyed journal voucher or waiting for the bank statement.
//
// Each one is a Document row (type SPEND_MONEY / RECEIVE_MONEY) whose config
// carries the header, the lines and the totals, plus ONE journal:
//   Spend:   Dr each line's account (net) + Dr input GST  / Cr bank (gross)
//   Receive: Dr bank (gross) / Cr each line's account (net) + Cr output GST
// Re-save voids the previous journal and reposts; Void keeps the document and
// voids the journal in place (the house rule — no reversing entry).
// Bank rec sees the bank-side journal line like any other payment, and the
// GST report reads the tax line like a bill's / an invoice's.
// ---------------------------------------------------------------------------

export type BankTransactionKind = 'SPEND' | 'RECEIVE';
export const BANK_TX_DOC_TYPE: Record<BankTransactionKind, string> = { SPEND: 'SPEND_MONEY', RECEIVE: 'RECEIVE_MONEY' };
const KIND_OF_TYPE: Record<string, BankTransactionKind> = { SPEND_MONEY: 'SPEND', RECEIVE_MONEY: 'RECEIVE' };
const LABEL: Record<BankTransactionKind, string> = { SPEND: 'Spend Money', RECEIVE: 'Receive Money' };
const FALLBACK_PREFIX: Record<BankTransactionKind, string> = { SPEND: 'SM-', RECEIVE: 'RM-' };

export type AmountsAre = 'EXCLUSIVE' | 'INCLUSIVE' | 'NO_TAX';

export type BankTransactionLine = { description?: string | null; accountId: string; amount: number };

export type SaveBankTransactionDto = {
  kind: BankTransactionKind;
  date: string;
  bankAccountCode: string;
  payee?: string | null; // who was paid / who paid — free text
  contactId?: string | null; // optional supplier (SPEND) / customer (RECEIVE)
  reference?: string | null;
  remarks?: string | null;
  paymentMethod?: string | null;
  chequeNo?: string | null;
  amountsAre?: AmountsAre;
  taxCode?: string | null; // GST master code ("4" Input Tax, "1" Output Tax …)
  taxRate?: number | null; // % — from the tax code
  taxAmount?: number | null; // typed-over tax; computed from the rate when absent
  lines: BankTransactionLine[];
  attachments?: Array<{ fileKey: string; fileName: string; mimeType?: string; size?: number; label?: string }>;
  number?: string | null; // typed-over number (unique within the type)
};

type Actor = { id?: string; name?: string; email?: string };

@Injectable()
export class BankTransactionsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly journalAutoPost: JournalAutoPostService,
    private readonly journalService: JournalService,
    private readonly auditService: AuditService,
    private readonly numbering: DocumentNumberingService,
  ) {}

  private logEvent(opts: { documentId: string; organizationId: string; action: string; detail: string; documentName?: string; actor?: Actor }) {
    return this.auditService.logAction({
      userId: opts.actor?.id || 'system',
      userName: opts.actor?.name,
      userEmail: opts.actor?.email,
      action: opts.action,
      resource: 'document',
      resourceId: opts.documentId,
      resourceName: opts.documentName,
      organizationId: opts.organizationId,
      details: { detail: opts.detail },
    });
  }

  private static kindOf(dto: Partial<SaveBankTransactionDto>): BankTransactionKind {
    return dto.kind === 'RECEIVE' ? 'RECEIVE' : 'SPEND';
  }

  private async getOrCreateTemplate(organizationId: string, kind: BankTransactionKind): Promise<string> {
    const type = BANK_TX_DOC_TYPE[kind];
    const existing = await this.prisma.documentTemplate.findFirst({ where: { organizationId, type }, select: { id: true } });
    if (existing) return existing.id;
    const created = await this.prisma.documentTemplate.create({
      data: { organizationId, type, name: LABEL[kind], config: {} } as any,
      select: { id: true },
    });
    return created.id;
  }

  // Number: the org's active format for the type (Accounting Setup → Document
  // Numbers; {BANK} patterns such as SCBSM2611-001 work because the bank is
  // known at save time — no pending placeholder needed), else SM-000001 /
  // RM-000001 continuing from the highest existing.
  private async nextNumber(organizationId: string, kind: BankTransactionKind, when: Date, bankName: string): Promise<string> {
    const type = BANK_TX_DOC_TYPE[kind];
    const issued = await this.numbering.issueNumberLocked(organizationId, type, null, when, undefined, { bankCode: bankCodeOf(bankName) });
    if (issued) return issued;
    const prefix = FALLBACK_PREFIX[kind];
    const rows = await this.prisma.document.findMany({
      where: { organizationId, type, name: { startsWith: prefix } },
      select: { name: true },
    });
    let max = 0;
    const re = new RegExp(`^${prefix}(\\d+)$`);
    for (const r of rows) {
      const m = re.exec(r.name || '');
      if (m) max = Math.max(max, parseInt(m[1], 10));
    }
    return `${prefix}${String(max + 1).padStart(6, '0')}`;
  }

  private toRow(doc: any) {
    const c: any = doc.config || {};
    const kind = KIND_OF_TYPE[doc.type] || 'SPEND';
    return {
      id: doc.id,
      kind,
      number: doc.name,
      status: c.voided ? 'VOID' : 'POSTED',
      date: c.date || null,
      bankAccountCode: c.bankAccountCode || null,
      bankAccountName: c.bankAccountName || null,
      payee: c.payee || null,
      contactId: c.contactId || null,
      reference: c.referenceNo || c.reference || null,
      remarks: c.remarks || null,
      paymentMethod: c.paymentMethod || 'transfer',
      chequeNo: c.chequeNo || null,
      amountsAre: c.amountsAre || 'EXCLUSIVE',
      taxCode: c.taxCode || null,
      taxRate: Number(c.taxRate) || 0,
      subtotal: Number(c.subtotal) || 0,
      taxAmount: Number(c.taxAmount) || 0,
      totalAmount: Number(c.totalAmount) || 0,
      lines: Array.isArray(c.lines) ? c.lines : [],
      attachments: Array.isArray(c.attachments) ? c.attachments : [],
      journalNumber: c.journalNumber || null,
      voidedAt: c.voidedAt || null,
      voidedBy: c.voidedBy || null,
      savedBy: c.savedBy || null,
      savedAt: c.savedAt || null,
      createdAt: doc.createdAt,
      updatedAt: doc.updatedAt,
    };
  }

  async list(organizationId: string, kind?: BankTransactionKind | null) {
    const types = kind ? [BANK_TX_DOC_TYPE[kind]] : Object.values(BANK_TX_DOC_TYPE);
    const docs = await this.prisma.document.findMany({
      where: { organizationId, type: { in: types } },
      orderBy: { createdAt: 'desc' },
      take: 1000,
    });
    return docs.map((d) => this.toRow(d));
  }

  async getById(organizationId: string, id: string) {
    const doc = await this.prisma.document.findFirst({ where: { id, organizationId, type: { in: Object.values(BANK_TX_DOC_TYPE) } } });
    if (!doc) throw new NotFoundException('Bank transaction not found');
    return this.toRow(doc);
  }

  // Validate + compute the money. Amounts-are semantics as on bills: EXCLUSIVE
  // = lines are net; INCLUSIVE = lines are gross (tax inside); NO_TAX = none.
  private async prepare(organizationId: string, dto: SaveBankTransactionDto) {
    const kind = BankTransactionsService.kindOf(dto);
    if (!dto.date || !/^\d{4}-\d{2}-\d{2}/.test(String(dto.date))) throw new BadRequestException('Date is required');
    if (!dto.bankAccountCode) throw new BadRequestException('Bank account is required');
    const lines = (dto.lines || [])
      .map((l) => ({ description: String(l.description || '').trim() || null, accountId: l.accountId, amount: ROUND(Number(l.amount) || 0) }))
      .filter((l) => l.accountId && l.amount !== 0);
    if (!lines.length) throw new BadRequestException('Add at least one line with an account and an amount');

    const bank = await this.prisma.chartOfAccount.findFirst({
      where: { organizationId, code: dto.bankAccountCode, isActive: true },
      select: { id: true, code: true, name: true },
    });
    if (!bank) throw new BadRequestException(`Bank account ${dto.bankAccountCode} not found`);

    const accounts = await this.prisma.chartOfAccount.findMany({
      where: { organizationId, id: { in: lines.map((l) => l.accountId) } },
      select: { id: true, code: true, name: true, isActive: true },
    });
    const byId = new Map(accounts.map((a) => [a.id, a]));
    for (const [i, l] of lines.entries()) {
      const a = byId.get(l.accountId);
      if (!a || a.isActive === false) throw new BadRequestException(`Line ${i + 1}: account not found`);
      if (a.id === bank.id) throw new BadRequestException(`Line ${i + 1}: the line account cannot be the bank account itself`);
    }

    const amountsAre: AmountsAre = dto.amountsAre === 'INCLUSIVE' || dto.amountsAre === 'NO_TAX' ? dto.amountsAre : 'EXCLUSIVE';
    const taxRate = amountsAre === 'NO_TAX' ? 0 : Math.max(0, Number(dto.taxRate) || 0);
    const linesSum = ROUND(lines.reduce((s, l) => s + l.amount, 0));
    if (linesSum <= 0) throw new BadRequestException('The lines must add up to more than zero');
    let taxAmount: number;
    if (amountsAre === 'NO_TAX') taxAmount = 0;
    else if (dto.taxAmount !== undefined && dto.taxAmount !== null && Number.isFinite(Number(dto.taxAmount))) taxAmount = ROUND(Math.max(0, Number(dto.taxAmount)));
    else if (amountsAre === 'INCLUSIVE') taxAmount = ROUND((linesSum * taxRate) / (100 + taxRate));
    else taxAmount = ROUND((linesSum * taxRate) / 100);
    if (amountsAre === 'INCLUSIVE' && taxAmount >= linesSum) throw new BadRequestException('Tax cannot be the whole amount');
    const subtotal = amountsAre === 'INCLUSIVE' ? ROUND(linesSum - taxAmount) : linesSum;
    const totalAmount = amountsAre === 'INCLUSIVE' ? linesSum : ROUND(linesSum + taxAmount);

    // Posting lines carry NET amounts; inclusive lines are netted
    // proportionally, the rounding drift lands on the last line.
    const netFactor = amountsAre === 'INCLUSIVE' && taxAmount > 0 ? (linesSum - taxAmount) / linesSum : 1;
    const postingLines = lines.map((l) => ({ ...l, net: ROUND(l.amount * netFactor) }));
    const drift = ROUND(subtotal - postingLines.reduce((s, l) => s + l.net, 0));
    if (drift !== 0) postingLines[postingLines.length - 1].net = ROUND(postingLines[postingLines.length - 1].net + drift);

    return {
      kind,
      bank,
      lines: lines.map((l) => ({ ...l, accountCode: byId.get(l.accountId)?.code || null, accountName: byId.get(l.accountId)?.name || null })),
      postingLines,
      amountsAre,
      taxRate,
      taxAmount,
      subtotal,
      totalAmount,
    };
  }

  private async post(args: {
    organizationId: string;
    documentId: string;
    number: string;
    kind: BankTransactionKind;
    date: string;
    payee: string | null;
    bankAccountCode: string;
    postingLines: Array<{ accountId: string; net: number; description: string | null }>;
    taxAmount: number;
    userId?: string;
  }) {
    const entry = await this.journalAutoPost.postFromBankTransaction({
      organizationId: args.organizationId,
      documentId: args.documentId,
      number: args.number,
      kind: args.kind,
      entryDate: new Date(args.date),
      payee: args.payee,
      bankAccountCode: args.bankAccountCode,
      lines: args.postingLines.map((l) => ({ accountId: l.accountId, amount: l.net, description: l.description })),
      taxAmount: args.taxAmount,
      userId: args.userId,
    });
    if (!entry) {
      throw new BadRequestException('Could not post the journal — check the bank account and the GST control accounts in Accounting Setup');
    }
    return entry;
  }

  private async assertNumberFree(organizationId: string, kind: BankTransactionKind, number: string, exceptId?: string) {
    const clash = await this.prisma.document.findFirst({
      where: { organizationId, type: BANK_TX_DOC_TYPE[kind], name: number, ...(exceptId ? { NOT: { id: exceptId } } : {}) },
      select: { id: true },
    });
    if (clash) throw new BadRequestException(`Number ${number} is already used`);
  }

  private configOf(prev: any, dto: SaveBankTransactionDto, p: Awaited<ReturnType<BankTransactionsService['prepare']>>, actor?: Actor) {
    const reference = String(dto.reference || '').trim() || null;
    return {
      ...(prev || {}),
      kind: p.kind,
      date: String(dto.date).slice(0, 10),
      bankAccountCode: p.bank.code,
      bankAccountName: p.bank.name,
      payee: String(dto.payee || '').trim() || null,
      contactId: dto.contactId || null,
      // config.referenceNo is the canonical reference key (CLAUDE.md).
      referenceNo: reference,
      reference,
      remarks: String(dto.remarks || '').trim() || null,
      paymentMethod: dto.paymentMethod || (dto.chequeNo ? 'cheque' : 'transfer'),
      chequeNo: dto.chequeNo || null,
      amountsAre: p.amountsAre,
      taxCode: p.amountsAre === 'NO_TAX' ? null : dto.taxCode || null,
      taxRate: p.taxRate,
      subtotal: p.subtotal,
      taxAmount: p.taxAmount,
      totalAmount: p.totalAmount,
      currency: 'SGD',
      lines: p.lines,
      items: p.lines, // mirror — generic Document readers vary
      attachments: Array.isArray(dto.attachments) ? dto.attachments : prev?.attachments || [],
      documentInfo: { ...(prev?.documentInfo || {}), taxCode: p.amountsAre === 'NO_TAX' ? null : dto.taxCode || null, gstPercent: p.taxRate, absorbTax: p.amountsAre === 'INCLUSIVE', date: String(dto.date).slice(0, 10) },
      savedBy: actor?.name || actor?.email || actor?.id || 'system',
      savedAt: new Date().toISOString(),
    };
  }

  async create(organizationId: string, dto: SaveBankTransactionDto, actor?: Actor) {
    const p = await this.prepare(organizationId, dto);
    const templateId = await this.getOrCreateTemplate(organizationId, p.kind);
    const typed = String(dto.number || '').trim();
    if (typed) await this.assertNumberFree(organizationId, p.kind, typed);
    const number = typed || (await this.nextNumber(organizationId, p.kind, new Date(dto.date), p.bank.name || p.bank.code));

    const doc = await this.prisma.document.create({
      data: {
        organizationId,
        documentTemplateId: templateId,
        type: BANK_TX_DOC_TYPE[p.kind],
        name: number,
        status: 'confirmed',
        config: this.configOf(null, dto, p, actor) as any,
      },
    });

    let entry;
    try {
      entry = await this.post({
        organizationId,
        documentId: doc.id,
        number,
        kind: p.kind,
        date: dto.date,
        payee: String(dto.payee || '').trim() || null,
        bankAccountCode: p.bank.code,
        postingLines: p.postingLines,
        taxAmount: p.taxAmount,
        userId: actor?.id,
      });
    } catch (e) {
      // Nothing posted → nothing to keep (the delete guard only protects
      // documents with a live journal).
      await this.prisma.document.deleteMany({ where: { id: doc.id, organizationId } });
      throw e;
    }
    const saved = await this.prisma.document.update({
      where: { id: doc.id },
      data: { config: { ...(doc.config as any), journalNumber: entry.journalNumber } as any },
    });
    void this.logEvent({
      documentId: doc.id,
      organizationId,
      action: 'CREATED',
      detail: `${LABEL[p.kind]} ${number} — ${p.totalAmount.toFixed(2)} ${p.kind === 'SPEND' ? 'paid from' : 'received into'} ${p.bank.name}; ${entry.journalNumber} posted`,
      documentName: number,
      actor,
    });
    return this.toRow(saved);
  }

  async update(organizationId: string, id: string, dto: SaveBankTransactionDto, actor?: Actor) {
    const doc = await this.prisma.document.findFirst({ where: { id, organizationId, type: { in: Object.values(BANK_TX_DOC_TYPE) } } });
    if (!doc) throw new NotFoundException('Bank transaction not found');
    const prev: any = doc.config || {};
    if (prev.voided) throw new BadRequestException('A voided transaction cannot be edited');
    const kind = KIND_OF_TYPE[doc.type];
    const p = await this.prepare(organizationId, { ...dto, kind });

    let number = doc.name || '';
    const typed = String(dto.number || '').trim();
    if (typed && typed !== number) {
      await this.assertNumberFree(organizationId, kind, typed, id);
      number = typed;
    }

    const entry = await this.post({
      organizationId,
      documentId: id,
      number,
      kind,
      date: dto.date,
      payee: String(dto.payee || '').trim() || null,
      bankAccountCode: p.bank.code,
      postingLines: p.postingLines,
      taxAmount: p.taxAmount,
      userId: actor?.id,
    });
    const saved = await this.prisma.document.update({
      where: { id },
      data: { name: number, config: { ...this.configOf(prev, dto, p, actor), journalNumber: entry.journalNumber } as any },
    });
    void this.logEvent({
      documentId: id,
      organizationId,
      action: 'EDITED',
      detail: `${LABEL[kind]} ${number} saved — ${p.totalAmount.toFixed(2)}; ${entry.journalNumber} reposted`,
      documentName: number,
      actor,
    });
    return this.toRow(saved);
  }

  // Void in place: the journal is voided (kept for the audit trail) and the
  // document stays, marked VOID. Nothing is deleted.
  async void(organizationId: string, id: string, actor?: Actor) {
    const doc = await this.prisma.document.findFirst({ where: { id, organizationId, type: { in: Object.values(BANK_TX_DOC_TYPE) } } });
    if (!doc) throw new NotFoundException('Bank transaction not found');
    const prev: any = doc.config || {};
    if (prev.voided) return this.toRow(doc);
    const live = await this.prisma.journalEntry.findFirst({
      where: { organizationId, sourceDocumentId: id, type: 'PAYMENT', status: { not: 'VOID' } },
      select: { id: true },
    });
    if (live) await this.journalService.void(organizationId, live.id, actor?.id);
    const saved = await this.prisma.document.update({
      where: { id },
      data: {
        // DocumentStatus has no "void" value; the void flag lives on config
        // (the same convention bills use), and toRow() reads it.
        config: { ...prev, voided: true, voidedAt: new Date().toISOString(), voidedBy: actor?.name || actor?.email || actor?.id || 'system' } as any,
      },
    });
    void this.logEvent({
      documentId: id,
      organizationId,
      action: 'VOIDED',
      detail: `${LABEL[KIND_OF_TYPE[doc.type]]} ${doc.name} voided${prev.journalNumber ? ` — ${prev.journalNumber} voided in place` : ''}`,
      documentName: doc.name || undefined,
      actor,
    });
    return this.toRow(saved);
  }
}
