import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../common/prisma.service';
import { JournalService } from './journal.service';

const ROUND = (n: number) => Math.round(n * 100) / 100;

/**
 * Resolves "control account codes" stored on AccountingSetting.controlAccounts
 * (e.g. debtorControl: "CA001") into actual ChartOfAccount.id values, then
 * creates balanced journal entries for invoice and payment events.
 *
 * Designed to be best-effort: if the org hasn't configured a chart of accounts
 * or its control accounts yet, posting is skipped silently. Callers should
 * still wrap calls in try/catch so a posting failure cannot block the source
 * transaction.
 */
@Injectable()
export class JournalAutoPostService {
  private readonly logger = new Logger(JournalAutoPostService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly journal: JournalService,
  ) {}

  // ---------- Helpers ----------

  private async resolveAccountByCode(organizationId: string, code?: string | null) {
    if (!code) return null;
    return this.prisma.chartOfAccount.findFirst({
      where: { organizationId, code, isActive: true },
      select: { id: true, code: true, name: true },
    });
  }

  private async getControlAccounts(organizationId: string) {
    const setting = await this.prisma.accountingSetting.findUnique({ where: { organizationId } });
    return (setting?.controlAccounts as Record<string, string> | null) ?? null;
  }

  private async firstAccountOfType(organizationId: string, accountType: string) {
    return this.prisma.chartOfAccount.findFirst({
      where: { organizationId, accountType, isActive: true },
      orderBy: { code: 'asc' },
      select: { id: true, code: true, name: true },
    });
  }

  private async firstSalesAccount(organizationId: string) {
    return this.firstAccountOfType(organizationId, 'SALES');
  }

  private async firstPurchaseAccount(organizationId: string) {
    return this.firstAccountOfType(organizationId, 'PURCHASE');
  }

  // For perpetual-inventory orgs. The Inventory account is the BS-side store
  // for stock-at-cost; COGS is the P&L expense recognized when stock leaves
  // the door. Both have sensible defaults (CA002 / CS001) but can be overridden
  // via AccountingSetting.controlAccounts.{inventoryAccount,cogsAccount}.
  private async resolvePerpetualAccounts(organizationId: string) {
    const setting = await this.prisma.accountingSetting.findUnique({
      where: { organizationId },
      select: { enablePerpetualInventory: true, controlAccounts: true },
    });
    if (!setting?.enablePerpetualInventory) return null;
    const controls = (setting.controlAccounts as Record<string, string> | null) ?? {};
    const inventoryCode = controls.inventoryAccount || 'CA002';
    const cogsCode = controls.cogsAccount || 'CS001';
    const [inventory, cogs] = await Promise.all([
      this.resolveAccountByCode(organizationId, inventoryCode),
      this.resolveAccountByCode(organizationId, cogsCode),
    ]);
    if (!inventory || !cogs) {
      this.logger.warn(
        `[perpetual] org=${organizationId} has perpetual ON but missing accounts (inventory=${inventoryCode} → ${inventory?.code}, cogs=${cogsCode} → ${cogs?.code}); falling back to non-perpetual`,
      );
      return null;
    }
    return { inventory, cogs };
  }

  // Compute COGS for an invoice = Σ(line qty × Asset.costPrice). Returns null
  // if we can't compute (no line items, no asset links). Used only when
  // perpetual is on.
  private async computeInvoiceCogs(organizationId: string, documentId: string): Promise<number | null> {
    const items = await this.prisma.documentItem.findMany({
      where: { documentId },
      select: { itemId: true, itemType: true, quantity: true },
    });
    if (items.length === 0) return null;

    // Resolve asset ids per item. INVENTORY items reference an Inventory row
    // (look up its asset); ASSET items reference the asset directly.
    const inventoryIds = items.filter((i) => i.itemType === 'INVENTORY').map((i) => i.itemId);
    const inventoryToAsset = new Map<string, string>();
    if (inventoryIds.length > 0) {
      const inv = await this.prisma.inventory.findMany({
        where: { id: { in: inventoryIds } },
        select: { id: true, assetId: true },
      });
      for (const r of inv) inventoryToAsset.set(r.id, r.assetId);
    }
    const assetIds = new Set<string>();
    for (const it of items) {
      const aid = it.itemType === 'ASSET' ? it.itemId : inventoryToAsset.get(it.itemId);
      if (aid) assetIds.add(aid);
    }
    if (assetIds.size === 0) return null;

    const assets = await this.prisma.asset.findMany({
      where: { id: { in: Array.from(assetIds) }, organizationId },
      select: { id: true, costPrice: true },
    });
    const costByAsset = new Map(assets.map((a) => [a.id, a.costPrice ?? 0]));

    let cogs = 0;
    for (const it of items) {
      const aid = it.itemType === 'ASSET' ? it.itemId : inventoryToAsset.get(it.itemId);
      if (!aid) continue;
      const unitCost = costByAsset.get(aid) ?? 0;
      cogs += (it.quantity || 0) * unitCost;
    }
    return ROUND(cogs);
  }

  /** Returns true if a non-void journal entry already exists for this source. */
  async alreadyPostedForDocument(organizationId: string, documentId: string, type: string) {
    const existing = await this.prisma.journalEntry.findFirst({
      where: { organizationId, sourceDocumentId: documentId, type, status: { not: 'VOID' } },
      select: { id: true, journalNumber: true },
    });
    return existing;
  }

  // ---------- Auto-post hooks ----------

  /**
   * Invoice confirmation:
   *   Dr Trade Receivables (debtor control)   gross
   *     Cr Sales (first SALES account)         net
   *     Cr GST Payable (tax control)           tax (if any)
   */
  async postFromInvoice(args: {
    organizationId: string;
    documentId: string;
    invoiceNumber?: string | null;
    entryDate: Date;
    customerName?: string | null;
    netAmount: number; // sales subtotal (excl tax)
    taxAmount: number; // GST/VAT amount
    grossAmount: number; // net + tax
    userId?: string;
  }) {
    const { organizationId, documentId, invoiceNumber, entryDate, customerName } = args;
    const net = ROUND(args.netAmount);
    const tax = ROUND(args.taxAmount);
    const gross = ROUND(args.grossAmount);

    this.logger.log(
      `[postFromInvoice] called org=${organizationId} doc=${documentId} invoice=${invoiceNumber ?? '?'} net=${net} tax=${tax} gross=${gross}`,
    );

    if (gross <= 0) {
      this.logger.warn(`[postFromInvoice] gross <= 0 (gross=${gross}); skipping`);
      return null;
    }

    const controls = await this.getControlAccounts(organizationId);
    if (!controls) {
      this.logger.warn(`[postFromInvoice] org=${organizationId} has no AccountingSetting.controlAccounts; skipping`);
      return null;
    }
    this.logger.log(`[postFromInvoice] resolved controlAccounts: ${JSON.stringify(controls)}`);

    const debtor = await this.resolveAccountByCode(organizationId, controls.debtorControl);
    const sales = await this.resolveAccountByCode(organizationId, controls.salesAccount) || (await this.firstSalesAccount(organizationId));
    const taxAccount = tax > 0 ? await this.resolveAccountByCode(organizationId, controls.taxLiabilities) : null;

    this.logger.log(
      `[postFromInvoice] resolved accounts debtor=${debtor?.code ?? 'none'} sales=${sales?.code ?? 'none'} tax=${taxAccount?.code ?? 'n/a'}`,
    );

    if (!debtor || !sales) {
      this.logger.warn(
        `[postFromInvoice] org=${organizationId} missing required accounts (debtorControl=${controls.debtorControl}, sales=${sales?.code ?? 'none'}); skipping`,
      );
      return null;
    }
    if (tax > 0 && !taxAccount) {
      this.logger.warn(`[postFromInvoice] org=${organizationId} has tax but no taxLiabilities account (looked for ${controls.taxLiabilities}); skipping`);
      return null;
    }

    const lines = [
      { accountId: debtor.id, debit: gross, credit: 0, description: `Invoice ${invoiceNumber ?? ''} — ${customerName ?? ''}`.trim() },
      { accountId: sales.id, debit: 0, credit: net, description: `Sales — ${invoiceNumber ?? ''}`.trim() },
    ];
    if (tax > 0 && taxAccount) {
      lines.push({ accountId: taxAccount.id, debit: 0, credit: tax, description: `Tax — ${invoiceNumber ?? ''}`.trim() });
    }

    // Perpetual-inventory cost side. Adds Dr COGS / Cr Inventory at cost so
    // the JE stays balanced and inventory drops out of the BS as stock leaves.
    const perpetual = await this.resolvePerpetualAccounts(organizationId);
    if (perpetual) {
      const cogs = await this.computeInvoiceCogs(organizationId, documentId);
      if (cogs && cogs > 0) {
        lines.push(
          { accountId: perpetual.cogs.id, debit: cogs, credit: 0, description: `COGS — ${invoiceNumber ?? ''}`.trim() },
          { accountId: perpetual.inventory.id, debit: 0, credit: cogs, description: `Inventory release — ${invoiceNumber ?? ''}`.trim() },
        );
        this.logger.log(`[postFromInvoice] perpetual ON — added COGS lines at ${cogs}`);
      } else {
        this.logger.warn(
          `[postFromInvoice] perpetual ON but COGS is 0 or unresolved — inventory side skipped (set Asset.costPrice on line items)`,
        );
      }
    }

    try {
      const created = await this.journal.create(
        organizationId,
        {
          entryDate: entryDate.toISOString(),
          type: 'INVOICE',
          reference: invoiceNumber ?? undefined,
          description: `Auto-posted from invoice ${invoiceNumber ?? documentId}`,
          sourceDocumentId: documentId,
          lines,
        },
        args.userId,
        { autoPost: true },
      );
      this.logger.log(`[postFromInvoice] created journal=${created.journalNumber} id=${created.id} lines=${created.lines.length}`);
      return created;
    } catch (e: any) {
      this.logger.error(`[postFromInvoice] journal.create threw: ${e?.message || e}`);
      throw e;
    }
  }

  /**
   * Payment received against an invoice:
   *   Dr Bank / Cash (resolved from payment method or default bank)
   *     Cr Trade Receivables (debtor control)
   */
  async postFromPayment(args: {
    organizationId: string;
    paymentId: string;
    documentId?: string | null;
    paymentReference?: string | null;
    paymentMethod?: string | null;
    paymentDate: Date;
    customerName?: string | null;
    amount: number;
    userId?: string;
    cashAccountCode?: string; // optional override
  }) {
    const { organizationId, paymentId, documentId, paymentReference, paymentMethod, paymentDate, customerName } = args;
    const amount = ROUND(args.amount);
    this.logger.log(
      `[postFromPayment] called org=${organizationId} payment=${paymentId} method=${paymentMethod} amount=${amount}`,
    );
    if (amount <= 0) {
      this.logger.warn(`[postFromPayment] amount <= 0 (amount=${amount}); skipping`);
      return null;
    }

    const controls = await this.getControlAccounts(organizationId);
    if (!controls) {
      this.logger.warn(`[postFromPayment] org=${organizationId} has no AccountingSetting.controlAccounts; skipping`);
      return null;
    }

    const debtor = await this.resolveAccountByCode(organizationId, controls.debtorControl);

    // Resolve the cash/bank side. Priority:
    //   1. explicit cashAccountCode arg
    //   2. paymentMethod hints (CASH → CA004, anything else → first bank account)
    //   3. controls.bankAccount / controls.cashAccount if set
    //   4. first CURRENT_ASSET account that looks like a bank/cash
    const explicit = args.cashAccountCode ? await this.resolveAccountByCode(organizationId, args.cashAccountCode) : null;
    const isCash = (paymentMethod || '').toUpperCase().includes('CASH');
    const fallbackCode = isCash ? controls.cashAccount || 'CA004' : controls.bankAccount || controls.foreignBankAccount || 'CA600';
    const bank =
      explicit ||
      (await this.resolveAccountByCode(organizationId, fallbackCode)) ||
      (await this.prisma.chartOfAccount.findFirst({
        where: {
          organizationId,
          isActive: true,
          accountType: 'CURRENT_ASSET',
          OR: [{ name: { contains: 'Bank', mode: 'insensitive' } }, { name: { contains: 'Cash', mode: 'insensitive' } }],
        },
        orderBy: { code: 'asc' },
        select: { id: true, code: true, name: true },
      }));

    if (!debtor || !bank) {
      this.logger.warn(
        `[postFromPayment] org=${organizationId} missing accounts (debtor=${controls.debtorControl}, bank=${bank?.code ?? 'none'}); skipping`,
      );
      return null;
    }

    this.logger.log(
      `[postFromPayment] resolved accounts bank=${bank.code} debtor=${debtor.code}`,
    );

    try {
      const created = await this.journal.create(
        organizationId,
        {
          entryDate: paymentDate.toISOString(),
          type: 'PAYMENT',
          reference: paymentReference ?? undefined,
          description: `Auto-posted from payment ${paymentReference ?? paymentId} — ${customerName ?? ''}`.trim(),
          sourcePaymentId: paymentId,
          sourceDocumentId: documentId ?? undefined,
          lines: [
            { accountId: bank.id, debit: amount, credit: 0, description: `Receipt — ${paymentReference ?? ''}`.trim() },
            { accountId: debtor.id, debit: 0, credit: amount, description: `Settle invoice — ${customerName ?? ''}`.trim() },
          ],
        },
        args.userId,
        { autoPost: true },
      );
      this.logger.log(`[postFromPayment] created journal=${created.journalNumber} id=${created.id}`);
      return created;
    } catch (e: any) {
      this.logger.error(`[postFromPayment] journal.create threw: ${e?.message || e}`);
      throw e;
    }
  }

  /**
   * Credit note (sales return): mirror of an invoice.
   *   Dr Sales (net)
   *   Dr GST Payable (tax, if any)
   *     Cr Trade Receivables (gross)
   */
  async postFromCreditNote(args: {
    organizationId: string;
    documentId: string;
    documentNumber?: string | null;
    entryDate: Date;
    customerName?: string | null;
    netAmount: number;
    taxAmount: number;
    grossAmount: number;
    userId?: string;
  }) {
    const { organizationId, documentId, documentNumber, entryDate, customerName } = args;
    const net = ROUND(args.netAmount);
    const tax = ROUND(args.taxAmount);
    const gross = ROUND(args.grossAmount);

    this.logger.log(`[postFromCreditNote] called doc=${documentId} cn=${documentNumber} net=${net} tax=${tax} gross=${gross}`);
    if (gross <= 0) {
      this.logger.warn(`[postFromCreditNote] gross <= 0; skipping`);
      return null;
    }

    const controls = await this.getControlAccounts(organizationId);
    if (!controls) {
      this.logger.warn(`[postFromCreditNote] org=${organizationId} has no controlAccounts; skipping`);
      return null;
    }

    const debtor = await this.resolveAccountByCode(organizationId, controls.debtorControl);
    const sales = await this.firstSalesAccount(organizationId);
    const taxAccount = tax > 0 ? await this.resolveAccountByCode(organizationId, controls.taxLiabilities) : null;

    if (!debtor || !sales || (tax > 0 && !taxAccount)) {
      this.logger.warn(`[postFromCreditNote] missing accounts (debtor=${debtor?.code}, sales=${sales?.code}, tax=${taxAccount?.code}); skipping`);
      return null;
    }

    const lines = [
      { accountId: sales.id, debit: net, credit: 0, description: `Credit note — ${documentNumber ?? ''}`.trim() },
    ];
    if (tax > 0 && taxAccount) {
      lines.push({ accountId: taxAccount.id, debit: tax, credit: 0, description: `Tax reversal — ${documentNumber ?? ''}`.trim() });
    }
    lines.push({ accountId: debtor.id, debit: 0, credit: gross, description: `Credit note — ${customerName ?? ''}`.trim() });

    try {
      const created = await this.journal.create(
        organizationId,
        {
          entryDate: entryDate.toISOString(),
          type: 'CREDIT_NOTE',
          reference: documentNumber ?? undefined,
          description: `Auto-posted from credit note ${documentNumber ?? documentId}`,
          sourceDocumentId: documentId,
          lines,
        },
        args.userId,
        { autoPost: true },
      );
      this.logger.log(`[postFromCreditNote] created journal=${created.journalNumber} id=${created.id}`);
      return created;
    } catch (e: any) {
      this.logger.error(`[postFromCreditNote] journal.create threw: ${e?.message || e}`);
      throw e;
    }
  }

  /**
   * Debit note (additional charge to customer): same shape as an invoice.
   */
  async postFromDebitNote(args: {
    organizationId: string;
    documentId: string;
    documentNumber?: string | null;
    entryDate: Date;
    customerName?: string | null;
    netAmount: number;
    taxAmount: number;
    grossAmount: number;
    userId?: string;
  }) {
    return this.postFromInvoice({
      organizationId: args.organizationId,
      documentId: args.documentId,
      invoiceNumber: args.documentNumber,
      entryDate: args.entryDate,
      customerName: args.customerName,
      netAmount: args.netAmount,
      taxAmount: args.taxAmount,
      grossAmount: args.grossAmount,
      userId: args.userId,
    }).then((entry) => {
      // Patch the type so it shows up as DEBIT_NOTE in the GL.
      if (!entry) return entry;
      return this.prisma.journalEntry.update({
        where: { id: entry.id },
        data: { type: 'DEBIT_NOTE' },
        include: { lines: { include: { account: true } } },
      });
    });
  }

  /**
   * Purchase order received: periodic-system posting.
   *   Dr Purchases (net)
   *   Dr GST Receivable (tax, if any — uses the same tax control account)
   *     Cr Trade Payables (gross)
   */
  async postFromPurchaseOrder(args: {
    organizationId: string;
    documentId: string;
    documentNumber?: string | null;
    entryDate: Date;
    supplierName?: string | null;
    netAmount: number;
    taxAmount: number;
    grossAmount: number;
    userId?: string;
  }) {
    const { organizationId, documentId, documentNumber, entryDate, supplierName } = args;
    const net = ROUND(args.netAmount);
    const tax = ROUND(args.taxAmount);
    const gross = ROUND(args.grossAmount);

    this.logger.log(`[postFromPurchaseOrder] called doc=${documentId} po=${documentNumber} net=${net} tax=${tax} gross=${gross}`);
    if (gross <= 0) {
      this.logger.warn(`[postFromPurchaseOrder] gross <= 0; skipping`);
      return null;
    }

    const controls = await this.getControlAccounts(organizationId);
    if (!controls) {
      this.logger.warn(`[postFromPurchaseOrder] org=${organizationId} has no controlAccounts; skipping`);
      return null;
    }

    const creditor = await this.resolveAccountByCode(organizationId, controls.creditorControl);
    const taxAccount = tax > 0 ? await this.resolveAccountByCode(organizationId, controls.taxLiabilities) : null;

    // Perpetual flips the debit side of a PO: stock goes onto the BS as
    // Inventory (asset) instead of being expensed to Purchases. Falls back to
    // periodic Purchases if perpetual isn't configured.
    const perpetual = await this.resolvePerpetualAccounts(organizationId);
    const debitAccount = perpetual ? perpetual.inventory : await this.firstPurchaseAccount(organizationId);
    const debitLabel = perpetual ? 'Inventory in' : 'Purchase';

    if (!creditor || !debitAccount || (tax > 0 && !taxAccount)) {
      this.logger.warn(`[postFromPurchaseOrder] missing accounts (creditor=${creditor?.code}, debit=${debitAccount?.code}, tax=${taxAccount?.code}); skipping`);
      return null;
    }

    const lines = [
      { accountId: debitAccount.id, debit: net, credit: 0, description: `${debitLabel} — ${documentNumber ?? ''}`.trim() },
    ];
    if (tax > 0 && taxAccount) {
      lines.push({ accountId: taxAccount.id, debit: tax, credit: 0, description: `Input tax — ${documentNumber ?? ''}`.trim() });
    }
    lines.push({ accountId: creditor.id, debit: 0, credit: gross, description: `PO — ${supplierName ?? ''}`.trim() });

    try {
      const created = await this.journal.create(
        organizationId,
        {
          entryDate: entryDate.toISOString(),
          type: 'PURCHASE_ORDER',
          reference: documentNumber ?? undefined,
          description: `Auto-posted from purchase order ${documentNumber ?? documentId}`,
          sourceDocumentId: documentId,
          lines,
        },
        args.userId,
        { autoPost: true },
      );
      this.logger.log(`[postFromPurchaseOrder] created journal=${created.journalNumber} id=${created.id}`);
      return created;
    } catch (e: any) {
      this.logger.error(`[postFromPurchaseOrder] journal.create threw: ${e?.message || e}`);
      throw e;
    }
  }

  /**
   * Purchase return: reverse of a purchase order.
   *   Dr Trade Payables (gross)
   *     Cr Purchases (net)
   *     Cr GST Receivable (tax, if any)
   */
  async postFromPurchaseReturn(args: {
    organizationId: string;
    documentId: string;
    documentNumber?: string | null;
    entryDate: Date;
    supplierName?: string | null;
    netAmount: number;
    taxAmount: number;
    grossAmount: number;
    userId?: string;
  }) {
    const { organizationId, documentId, documentNumber, entryDate, supplierName } = args;
    const net = ROUND(args.netAmount);
    const tax = ROUND(args.taxAmount);
    const gross = ROUND(args.grossAmount);

    this.logger.log(`[postFromPurchaseReturn] called doc=${documentId} pr=${documentNumber} net=${net} tax=${tax} gross=${gross}`);
    if (gross <= 0) {
      this.logger.warn(`[postFromPurchaseReturn] gross <= 0; skipping`);
      return null;
    }

    const controls = await this.getControlAccounts(organizationId);
    if (!controls) return null;

    const creditor = await this.resolveAccountByCode(organizationId, controls.creditorControl);
    const purchase = await this.firstPurchaseAccount(organizationId);
    const taxAccount = tax > 0 ? await this.resolveAccountByCode(organizationId, controls.taxLiabilities) : null;

    if (!creditor || !purchase || (tax > 0 && !taxAccount)) {
      this.logger.warn(`[postFromPurchaseReturn] missing accounts (creditor=${creditor?.code}, purchase=${purchase?.code}, tax=${taxAccount?.code}); skipping`);
      return null;
    }

    const lines = [
      { accountId: creditor.id, debit: gross, credit: 0, description: `Purchase return — ${supplierName ?? ''}`.trim() },
      { accountId: purchase.id, debit: 0, credit: net, description: `Purchase reversal — ${documentNumber ?? ''}`.trim() },
    ];
    if (tax > 0 && taxAccount) {
      lines.push({ accountId: taxAccount.id, debit: 0, credit: tax, description: `Input tax reversal — ${documentNumber ?? ''}`.trim() });
    }

    try {
      const created = await this.journal.create(
        organizationId,
        {
          entryDate: entryDate.toISOString(),
          type: 'PURCHASE_RETURN',
          reference: documentNumber ?? undefined,
          description: `Auto-posted from purchase return ${documentNumber ?? documentId}`,
          sourceDocumentId: documentId,
          lines,
        },
        args.userId,
        { autoPost: true },
      );
      this.logger.log(`[postFromPurchaseReturn] created journal=${created.journalNumber} id=${created.id}`);
      return created;
    } catch (e: any) {
      this.logger.error(`[postFromPurchaseReturn] journal.create threw: ${e?.message || e}`);
      throw e;
    }
  }
}
