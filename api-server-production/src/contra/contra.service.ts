import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../common/prisma.service';
import { JournalAutoPostService } from '../journal/journal-auto-post.service';
import { ReceiptsService } from '../receipts/receipts.service';
import { PaymentVouchersService } from '../payment-vouchers/payment-vouchers.service';
import { PaymentsService } from '../payments/payments.service';
import { BillsService } from '../bills/bills.service';
import { orgToday } from '../common/org-today';
import { CONTRA_OFFSET_FLAG, isOrgFeatureEnabled } from '../common/org-features';

const ROUND = (n: number) => Math.round(n * 100) / 100;

// ---------------------------------------------------------------------------
// CONTRA SET-OFF (guru 2026-11-06) — "the same customer we bill them and they
// also bill us, we can offset from there".
//
// This is NOT the Manual Offset. Manual Offset nets ONE CUSTOMER's invoices
// against THAT customer's own credit notes: both sides sit on the debtors
// control, so it posts nothing but an FX difference. A contra crosses the two
// ledgers — the same legal entity owes us as a customer and is owed by us as a
// supplier — so it moves real money between two control accounts:
//
//     Dr Trade Creditors   (the bills we stop owing)
//     Cr Trade Debtors     (the invoices they stop owing us)
//
// AIMS keeps Customer and Supplier as separate rows with separate ids, so the
// pairing has to be recorded first: Customer.contraSupplierId. `suggestPairs`
// finds the likely ones by name; a human confirms each, because a name match
// is a guess and a contra needs the counterparty's agreement anyway.
// ---------------------------------------------------------------------------

export type ContraAllocation = { documentId: string; amount: number };
export type CreateContraDto = {
  customerId: string;
  date?: string;
  remarks?: string | null;
  /** Their invoices to us — the AR side we are giving up. */
  debtorItems: ContraAllocation[];
  /** Our bills from them — the AP side we stop owing. */
  creditorItems: ContraAllocation[];
};
export type Actor = { id?: string; name?: string; email?: string };

/** Loose company key: drop the legal suffixes and punctuation so
 *  "Tenda Equipment & Services Pte Ltd" meets "TENDA EQUIPMENT & SERVICES". */
export function companyKey(name: string): string {
  return String(name || '')
    .toUpperCase()
    .replace(/\b(PTE|LTD|LIMITED|PRIVATE|LLP|CO|COMPANY|SDN|BHD|INC|CORP|CORPORATION)\b/g, '')
    .replace(/[^A-Z0-9]/g, '');
}

@Injectable()
export class ContraService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly journalAutoPost: JournalAutoPostService,
    private readonly receipts: ReceiptsService,
    private readonly vouchers: PaymentVouchersService,
    private readonly payments: PaymentsService,
    private readonly bills: BillsService,
  ) {}

  private async requireEnabled(organizationId: string) {
    if (!(await isOrgFeatureEnabled(this.prisma, organizationId, CONTRA_OFFSET_FLAG)))
      throw new BadRequestException('Contra set-off is not enabled for this organisation');
  }

  /** Customers already paired, plus unpaired ones whose name matches a supplier. */
  async pairs(organizationId: string) {
    await this.requireEnabled(organizationId);
    const [customers, suppliers] = await Promise.all([
      this.prisma.customer.findMany({
        where: { organizationId },
        select: { id: true, name: true, customerCode: true, contraSupplierId: true },
        orderBy: { name: 'asc' },
      }),
      this.prisma.supplier.findMany({
        where: { organizationId },
        select: { id: true, name: true, supplierCode: true },
      }),
    ]);
    const supById = new Map(suppliers.map((s) => [s.id, s]));
    const supByKey = new Map<string, (typeof suppliers)[number]>();
    for (const s of suppliers) {
      const k = companyKey(s.name);
      // A key held by two suppliers is ambiguous — suggest neither.
      if (supByKey.has(k)) supByKey.set(k, null as any);
      else supByKey.set(k, s);
    }

    const linked: any[] = [];
    const suggested: any[] = [];
    for (const c of customers) {
      if (c.contraSupplierId) {
        const s = supById.get(c.contraSupplierId);
        linked.push({
          customerId: c.id, customerName: c.name, customerCode: c.customerCode,
          supplierId: c.contraSupplierId, supplierName: s?.name ?? '(supplier removed)', supplierCode: s?.supplierCode ?? null,
        });
        continue;
      }
      const hit = supByKey.get(companyKey(c.name));
      if (hit)
        suggested.push({
          customerId: c.id, customerName: c.name, customerCode: c.customerCode,
          supplierId: hit.id, supplierName: hit.name, supplierCode: hit.supplierCode,
        });
    }
    return { linked, suggested };
  }

  async link(organizationId: string, customerId: string, supplierId: string | null) {
    await this.requireEnabled(organizationId);
    const customer = await this.prisma.customer.findFirst({ where: { id: customerId, organizationId }, select: { id: true } });
    if (!customer) throw new NotFoundException('Customer not found');
    if (supplierId) {
      const supplier = await this.prisma.supplier.findFirst({ where: { id: supplierId, organizationId }, select: { id: true } });
      if (!supplier) throw new NotFoundException('Supplier not found');
      // One supplier belongs to one customer — two customers contra-ing the
      // same supplier would double-spend its balance.
      const taken = await this.prisma.customer.findFirst({
        where: { organizationId, contraSupplierId: supplierId, NOT: { id: customerId } },
        select: { name: true },
      });
      if (taken) throw new BadRequestException(`That supplier is already paired with ${taken.name}`);
    }
    await this.prisma.customer.update({ where: { id: customerId }, data: { contraSupplierId: supplierId } });
    return { ok: true, customerId, supplierId };
  }

  /** The two sides of a contra: their open invoices, and our open bills. */
  async items(organizationId: string, customerId: string) {
    await this.requireEnabled(organizationId);
    const customer = await this.prisma.customer.findFirst({
      where: { id: customerId, organizationId },
      select: { id: true, name: true, contraSupplierId: true },
    });
    if (!customer) throw new NotFoundException('Customer not found');
    if (!customer.contraSupplierId)
      throw new BadRequestException(`${customer.name} is not paired with a supplier yet — pair them first`);
    const supplier = await this.prisma.supplier.findFirst({
      where: { id: customer.contraSupplierId, organizationId },
      select: { id: true, name: true, supplierCode: true },
    });
    if (!supplier) throw new BadRequestException('The paired supplier no longer exists — re-pair this customer');

    const [debtorItems, creditorItems] = await Promise.all([
      this.receipts.openInvoices(organizationId, customerId),
      this.vouchers.openBills(organizationId, supplier.id),
    ]);
    return {
      customer: { id: customer.id, name: customer.name },
      supplier: { id: supplier.id, name: supplier.name, code: supplier.supplierCode },
      // What they owe us.
      debtorItems,
      // What we owe them. openBills may include supplier credit notes when
      // enableApCreditOffset is on — those are not contra material (they are
      // already a reduction of the same ledger), so drop them here.
      creditorItems: (creditorItems as any[]).filter((r) => r.kind !== 'credit'),
    };
  }

  async create(organizationId: string, dto: CreateContraDto, actor?: Actor) {
    await this.requireEnabled(organizationId);
    const debtor = (dto.debtorItems || [])
      .map((a) => ({ documentId: a.documentId, amount: ROUND(Number(a.amount) || 0) }))
      .filter((a) => a.documentId && a.amount > 0);
    const creditor = (dto.creditorItems || [])
      .map((a) => ({ documentId: a.documentId, amount: ROUND(Number(a.amount) || 0) }))
      .filter((a) => a.documentId && a.amount > 0);
    if (!debtor.length || !creditor.length)
      throw new BadRequestException('Tick at least one invoice and one bill — a contra needs both sides');

    const arTotal = ROUND(debtor.reduce((s, a) => s + a.amount, 0));
    const apTotal = ROUND(creditor.reduce((s, a) => s + a.amount, 0));
    if (Math.abs(arTotal - apTotal) > 0.005)
      throw new BadRequestException(
        `Contra must balance — invoices ${arTotal.toFixed(2)} vs bills ${apTotal.toFixed(2)} (difference ${(arTotal - apTotal).toFixed(2)})`,
      );

    const { customer, supplier, debtorItems, creditorItems } = await this.items(organizationId, dto.customerId);
    const arById = new Map((debtorItems as any[]).map((o) => [o.documentId, o]));
    const apById = new Map((creditorItems as any[]).map((o) => [o.documentId, o]));
    for (const a of debtor) {
      const o = arById.get(a.documentId);
      if (!o) throw new BadRequestException('A ticked invoice is not open for this customer');
      if (a.amount > o.outstanding + 0.005)
        throw new BadRequestException(`${o.reference}: ${a.amount.toFixed(2)} exceeds its outstanding ${o.outstanding.toFixed(2)}`);
    }
    for (const a of creditor) {
      const o = apById.get(a.documentId);
      if (!o) throw new BadRequestException('A ticked bill is not open for this supplier');
      if (a.amount > o.outstanding + 0.005)
        throw new BadRequestException(`${o.reference}: ${a.amount.toFixed(2)} exceeds its outstanding ${o.outstanding.toFixed(2)}`);
    }

    const tz = await this.prisma.accountingSetting.findUnique({ where: { organizationId }, select: { timeZone: true } });
    const date = dto.date || orgToday(tz?.timeZone);
    const number = await this.nextNumber(organizationId);
    const templateId = await this.getOrCreateTemplate(organizationId);
    // BillPayment.bankAccountId is required, and a contra touches no bank —
    // the bill is settled against the DEBTORS control, so that is the honest
    // account to record as the other side.
    const controls = await this.prisma.accountingSetting.findUnique({
      where: { organizationId },
      select: { controlAccounts: true },
    });
    const debtorCode = (controls?.controlAccounts as any)?.debtorControl;
    const debtorAccount = debtorCode
      ? await this.prisma.chartOfAccount.findFirst({ where: { organizationId, code: debtorCode }, select: { id: true } })
      : null;
    if (!debtorAccount)
      throw new BadRequestException('No debtors control account is set — Accounting Setup → Control Accounts');
    const enrich = (a: ContraAllocation, m: Map<string, any>) => {
      const o = m.get(a.documentId);
      return { ...a, reference: o?.reference ?? null, date: o?.date ?? null, currency: o?.currency ?? null };
    };

    const doc = await this.prisma.$transaction(async (tx) => {
      const created = await tx.document.create({
        data: {
          organizationId,
          documentTemplateId: templateId,
          type: 'CONTRA_OFFSET',
          name: number,
          status: 'confirmed',
          config: {
            date,
            customerId: customer.id,
            customerName: customer.name,
            supplierId: supplier.id,
            supplierName: supplier.name,
            remarks: dto.remarks || null,
            debtorItems: debtor.map((a) => enrich(a, arById)),
            creditorItems: creditor.map((a) => enrich(a, apById)),
            amount: arTotal,
            savedBy: actor?.name || actor?.email || actor?.id || 'system',
            savedAt: new Date().toISOString(),
          } as any,
        },
      });
      // AR side: a cashless 'contra' payment on each invoice, exactly as the
      // Manual Offset does, so the invoice's balance and the ageing follow.
      for (const a of debtor) {
        await tx.payment.create({
          data: {
            organizationId,
            customerId: customer.id,
            documentId: a.documentId,
            amount: a.amount,
            paymentDate: new Date(date),
            paymentMethod: 'contra',
            reference: number,
            notes: dto.remarks || `Contra ${number} — ${supplier.name}`,
            receiptId: created.id,
            createdBy: actor?.id || 'system',
          },
        });
      }
      // AP side: the BillPayment twin.
      for (const a of creditor) {
        await tx.billPayment.create({
          data: {
            organizationId,
            billId: a.documentId,
            supplierId: supplier.id,
            amount: a.amount,
            paymentDate: new Date(date),
            paymentMethod: 'contra',
            reference: number,
            notes: dto.remarks || `Contra ${number} — ${customer.name}`,
            bankAccountId: debtorAccount.id,
            createdBy: actor?.id || 'system',
          },
        });
      }
      return created;
    });

    // ONE journal: Dr creditors / Cr debtors. Unlike a Manual Offset this is
    // never a no-op — the two control accounts are different.
    const entry = await this.journalAutoPost.postFromContraOffset({
      organizationId,
      contraDocumentId: doc.id,
      contraNumber: number,
      entryDate: new Date(date),
      customerName: customer.name,
      supplierName: supplier.name,
      amount: arTotal,
      userId: actor?.id,
    });
    const journalNumber = (entry as any)?.journalNumber || null;
    if (journalNumber)
      await this.prisma.document.update({
        where: { id: doc.id },
        data: { config: { ...((doc.config as any) || {}), journalNumber } as any },
      });

    for (const a of debtor) {
      try {
        await this.payments.updateInvoiceStatusAfterPayment(a.documentId, organizationId);
      } catch (e) {
        console.error('Contra: AR status refresh failed for', a.documentId, e);
      }
    }
    for (const a of creditor) {
      try {
        await this.bills.refreshBillAfterPayments(organizationId, a.documentId);
      } catch (e) {
        console.error('Contra: AP status refresh failed for', a.documentId, e);
      }
    }
    return { id: doc.id, number, amount: arTotal, journalNumber };
  }

  async list(organizationId: string) {
    const docs = await this.prisma.document.findMany({
      where: { organizationId, type: 'CONTRA_OFFSET' },
      select: { id: true, name: true, status: true, config: true },
      orderBy: { createdAt: 'desc' },
      take: 500,
    });
    return docs.map((d) => {
      const c: any = d.config || {};
      return {
        id: d.id, number: d.name, date: c.date ?? null, customerName: c.customerName ?? null,
        supplierName: c.supplierName ?? null, amount: Number(c.amount) || 0,
        journalNumber: c.journalNumber ?? null, remarks: c.remarks ?? null, voided: c.voided === true,
      };
    });
  }

  /** Document.documentTemplateId is required, so the contra needs a template
   *  row of its own — same trick as the Manual Offset's. */
  private async getOrCreateTemplate(organizationId: string): Promise<string> {
    const existing = await this.prisma.documentTemplate.findFirst({
      where: { organizationId, type: 'CONTRA_OFFSET' },
      select: { id: true },
    });
    if (existing) return existing.id;
    const created = await this.prisma.documentTemplate.create({
      data: { organizationId, type: 'CONTRA_OFFSET', name: 'Contra Set-off', config: {} } as any,
      select: { id: true },
    });
    return created.id;
  }

  /** CT-###### per org, like the Manual Offset's MO- series. */
  private async nextNumber(organizationId: string): Promise<string> {
    const rows = await this.prisma.document.findMany({
      where: { organizationId, type: 'CONTRA_OFFSET', name: { startsWith: 'CT-' } },
      select: { name: true },
    });
    let max = 0;
    for (const r of rows) {
      const m = /^CT-(\d+)$/.exec(r.name || '');
      if (m) max = Math.max(max, parseInt(m[1], 10));
    }
    return `CT-${String(max + 1).padStart(6, '0')}`;
  }
}
