import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../common/prisma.service';
import { JournalService } from './journal.service';
import { refWith } from '../common/doc-ref';
import { isErpImported } from '../common/erp-import';
import { isOrgFeatureEnabled } from '../common/org-features';

/** Hold the GL journal of payments / receipts on ERP-imported invoices until the opening AR is booked. */
export const HOLD_ERP_PAYMENT_GL_FLAG = 'holdErpImportPaymentGl';

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

  async getControlAccounts(organizationId: string) {
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

  // ---------- Multi-currency ----------
  // Resolve a document's trading currency + the accountant's standing rate to
  // base. Currency comes from the doc config (set from the customer/supplier
  // master); rate from AccountingSetting.currencyRates ({"USD": 1.35} = 1 USD
  // → 1.35 base). Returns null when the doc is foreign but no rate is locked
  // in — posting must NOT proceed at par, that would misstate the ledger.
  private async resolveFx(
    organizationId: string,
    documentId?: string | null,
  ): Promise<{ currency: string; rate: number; isForeign: boolean } | null> {
    const setting = await this.prisma.accountingSetting.findUnique({
      where: { organizationId },
      select: { baseCurrency: true, currencyRates: true },
    });
    const base = setting?.baseCurrency || 'SGD';

    let currency = base;
    if (documentId) {
      const doc = await this.prisma.document.findUnique({ where: { id: documentId }, select: { config: true } });
      const c: any = doc?.config || {};
      currency = (c.currency || '').toUpperCase() || base;
      if (currency === base && (c.customerId || c.customer?.id)) {
        // Doc predates currency inheritance — fall back to the customer master.
        const cust = await this.prisma.customer.findUnique({
          where: { id: c.customerId || c.customer?.id },
          select: { currency: true },
        });
        if (cust?.currency) currency = cust.currency.toUpperCase();
      } else if (currency === base && (c.supplierId || c.supplier?.id)) {
        const supp = await this.prisma.supplier.findUnique({
          where: { id: c.supplierId || c.supplier?.id },
          select: { currency: true },
        });
        if (supp?.currency) currency = supp.currency.toUpperCase();
      }
    }

    if (currency === base) return { currency: base, rate: 1, isForeign: false };
    const rates = (setting?.currencyRates as Record<string, number> | null) ?? {};
    const rate = Number(rates[currency]);
    if (!rate || rate <= 0) {
      this.logger.warn(
        `[fx] doc ${documentId} is in ${currency} but no standing rate is locked in AccountingSetting.currencyRates — skipping post. Set the rate in Accounting Setup.`,
      );
      return null;
    }
    return { currency, rate, isForeign: true };
  }

  // Historical rate a document was originally posted at — read from its
  // invoice/bill journal's control-account line. Used to relieve AR/AP at the
  // same base value it went on at, so the control account clears exactly.
  async historicalRateForDocument(organizationId: string, documentId: string): Promise<number | null> {
    const entry = await this.prisma.journalEntry.findFirst({
      where: { organizationId, sourceDocumentId: documentId, type: { in: ['INVOICE', 'CREDIT_NOTE', 'DEBIT_NOTE'] }, status: { not: 'VOID' } },
      include: { lines: { where: { exchangeRate: { not: null } }, take: 1 } },
      orderBy: { createdAt: 'asc' },
    });
    const rate = entry?.lines?.[0]?.exchangeRate;
    return rate && rate > 0 ? rate : null;
  }

  async resolveFxGainLossAccount(organizationId: string, controls: Record<string, string> | null) {
    return (
      (await this.resolveAccountByCode(organizationId, controls?.fxGainLoss)) ||
      (await this.resolveAccountByCode(organizationId, '499')) ||
      (await this.resolveAccountByCode(organizationId, 'EX070')) ||
      (await this.firstAccountOfType(organizationId, 'EXCHANGE_GAIN_LOSS'))
    );
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
    // Per-line revenue accounts (from the Revenue Master File). When present, the
    // credit side splits across each line's account; anything unmapped falls back
    // to the single Sales control account. `amount` is the line NET (excl tax).
    revenueLines?: Array<{ accountCode?: string | null; accountId?: string | null; amount: number }>;
    // Header "GL Remarks" (HEADER_GL_ACCOUNT_FLAG orgs): the journal's description.
    glRemarks?: string | null;
    userId?: string;
  }) {
    const { organizationId, documentId, invoiceNumber, entryDate, customerName } = args;
    const glRemarks = String(args.glRemarks || '').trim() || null;
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

    // ERP-imported history never posts (common/erp-import.ts).
    const srcDoc = await this.prisma.document.findFirst({ where: { id: documentId, organizationId }, select: { config: true } });
    if (srcDoc && isErpImported(srcDoc.config)) {
      this.logger.log(`[postFromInvoice] doc=${documentId} was imported from the previous ERP; not posted`);
      return null;
    }

    // Multi-currency: face amounts are in the document's trading currency;
    // the ledger posts in base at the accountant's standing rate.
    const fx = await this.resolveFx(organizationId, documentId);
    if (!fx) return null; // foreign doc with no locked rate — surfaced in logs
    const toBase = (n: number) => ROUND(n * fx.rate);

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

    type Line = { accountId: string; debit: number; credit: number; description: string; foreignAmount?: number; exchangeRate?: number };
    const fxFields = (foreign: number) => (fx.isForeign ? { foreignAmount: ROUND(foreign), exchangeRate: fx.rate } : {});

    // Credit legs first (converted per line) — the debtor debit is then set to
    // their exact base sum so rounding can never unbalance the entry.
    const creditLines: Line[] = [];

    // Revenue credit side: split per line-account when the caller supplied them
    // (Revenue Master File mapping), else one Sales line for the whole net.
    const byAccount = new Map<string, number>();
    for (const rl of args.revenueLines || []) {
      const amt = ROUND(rl.amount || 0);
      if (amt === 0) continue;
      let acctId = rl.accountId || null;
      if (!acctId && rl.accountCode) acctId = (await this.resolveAccountByCode(organizationId, rl.accountCode))?.id || null;
      if (acctId) byAccount.set(acctId, ROUND((byAccount.get(acctId) || 0) + amt));
    }
    // A header (document) discount: the lines add up to MORE than the net.
    // Spread it over the line accounts pro rata so each account carries its
    // share. Before this the excess went out as a DEBIT "Sales (unmapped)"
    // plug on the default sales account (balanced, but the whole discount on
    // one account and the entry's total inflated; dev WCT 2026-11-12).
    // Lines that do not exceed the net are untouched.
    const linesTotal = ROUND([...byAccount.values()].reduce((sum, a) => sum + a, 0));
    if (linesTotal > 0 && ROUND(net - linesTotal) < -0.02) {
      const ratio = net / linesTotal;
      for (const [acctId, amt] of byAccount) byAccount.set(acctId, ROUND(amt * ratio));
    }
    if (byAccount.size === 0) {
      creditLines.push({ accountId: sales.id, debit: 0, credit: toBase(net), description: glRemarks || `Sales — ${invoiceNumber ?? ''}`.trim(), ...fxFields(net) });
    } else {
      let posted = 0;
      for (const [acctId, amt] of byAccount) {
        creditLines.push({ accountId: acctId, debit: 0, credit: toBase(amt), description: glRemarks || `Sales — ${invoiceNumber ?? ''}`.trim(), ...fxFields(amt) });
        posted = ROUND(posted + amt);
      }
      // Any net not covered by a mapped account (unmapped lines) → Sales.
      // Cent-level drift (rounding order differences between the document's
      // stored totals and its per-line amounts, e.g. 2183.87 × 17.50) is
      // rolled into the largest mapped line instead — a 1¢ "Sales (unmapped)"
      // plug line confused the accountant (JV-000038, 2026-08-19).
      const remainder = ROUND(net - posted);
      if (Math.abs(remainder) > 0.02) {
        creditLines.push({
          accountId: sales.id,
          debit: remainder < 0 ? toBase(-remainder) : 0,
          credit: remainder > 0 ? toBase(remainder) : 0,
          description: `Sales (unmapped) — ${invoiceNumber ?? ''}`.trim(),
          ...fxFields(Math.abs(remainder)),
        });
      } else if (remainder !== 0 && creditLines.length > 0) {
        const largest = creditLines.reduce((a, b) => (b.credit > a.credit ? b : a));
        largest.credit = ROUND(largest.credit + toBase(remainder));
      }
    }

    if (tax > 0 && taxAccount) {
      creditLines.push({ accountId: taxAccount.id, debit: 0, credit: toBase(tax), description: `Tax — ${invoiceNumber ?? ''}`.trim(), ...fxFields(tax) });
    }

    // The entry must land EXACTLY on the document's stored gross (nettTotal) —
    // that's the figure on the printed invoice and in Xero. If the credit legs
    // drift from it by a cent or two (net+tax rounded differently than the
    // grand total), absorb the difference into the largest revenue credit.
    let baseGross = ROUND(creditLines.reduce((s, l) => s + l.credit - l.debit, 0));
    const targetGross = toBase(gross);
    const grossDrift = ROUND(targetGross - baseGross);
    if (grossDrift !== 0 && Math.abs(grossDrift) <= 0.02) {
      const revenueLegs = creditLines.filter((l) => !taxAccount || l.accountId !== taxAccount.id);
      const largest = (revenueLegs.length ? revenueLegs : creditLines).reduce((a, b) => (b.credit > a.credit ? b : a));
      largest.credit = ROUND(largest.credit + grossDrift);
      baseGross = targetGross;
    }
    const lines: Line[] = [
      { accountId: debtor.id, debit: baseGross, credit: 0, description: `Invoice ${invoiceNumber ?? ''} — ${customerName ?? ''}`.trim(), ...fxFields(gross) },
      ...creditLines,
    ];

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
          description: glRemarks || `Auto-posted from invoice ${invoiceNumber ?? documentId}`,
          sourceDocumentId: documentId,
          currency: fx.currency,
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
    /** postHeldErpPayments: post a journal that was held (skips the hold check). */
    release?: boolean;
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
    // A payment on an ERP-imported invoice: the invoice never reached Trade Receivables, so with
    // the hold flag on the journal waits (the payment still settles the invoice).
    if (!args.release && documentId && (await this.holdsErpPaymentGl(organizationId, [documentId]))) {
      await this.recordHeldPayment(organizationId, documentId, {
        paymentId,
        amount,
        paymentDate: paymentDate.toISOString(),
        paymentMethod: paymentMethod ?? null,
        reference: paymentReference ?? null,
        cashAccountCode: args.cashAccountCode ?? null,
        heldAt: new Date().toISOString(),
      });
      this.logger.log(`[postFromPayment] payment=${paymentId} on ERP-imported doc=${documentId}: journal held (${HOLD_ERP_PAYMENT_GL_FLAG})`);
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

    // Multi-currency settlement. `amount` is in the document's trading
    // currency. AR is relieved at the invoice's HISTORICAL rate (so the
    // control account clears exactly); the bank leg posts at today's standing
    // rate; the difference is realised FX gain/loss.
    const fx = await this.resolveFx(organizationId, documentId ?? undefined);
    if (!fx) return null; // foreign doc, no locked rate
    type Line = { accountId: string; debit: number; credit: number; description: string; foreignAmount?: number; exchangeRate?: number };
    let lines: Line[];
    if (!fx.isForeign) {
      lines = [
        { accountId: bank.id, debit: amount, credit: 0, description: `Receipt — ${paymentReference ?? ''}`.trim() },
        { accountId: debtor.id, debit: 0, credit: amount, description: `Settle invoice — ${customerName ?? ''}`.trim() },
      ];
    } else {
      const historicalRate = (documentId ? await this.historicalRateForDocument(organizationId, documentId) : null) ?? fx.rate;
      const arBase = ROUND(amount * historicalRate);
      const bankBase = ROUND(amount * fx.rate);
      lines = [
        { accountId: bank.id, debit: bankBase, credit: 0, description: `Receipt — ${paymentReference ?? ''}`.trim(), foreignAmount: amount, exchangeRate: fx.rate },
        { accountId: debtor.id, debit: 0, credit: arBase, description: `Settle invoice — ${customerName ?? ''}`.trim(), foreignAmount: amount, exchangeRate: historicalRate },
      ];
      const diff = ROUND(bankBase - arBase); // >0: base received exceeds AR relieved → realised gain
      if (Math.abs(diff) > 0.005) {
        const fxAccount = await this.resolveFxGainLossAccount(organizationId, controls);
        if (!fxAccount) {
          this.logger.warn(`[postFromPayment] realised FX of ${diff} but no FX gain/loss account (controls.fxGainLoss/499/EX070); skipping post`);
          return null;
        }
        lines.push({
          accountId: fxAccount.id,
          debit: diff < 0 ? -diff : 0,
          credit: diff > 0 ? diff : 0,
          description: `Realised FX ${diff > 0 ? 'gain' : 'loss'} — ${paymentReference ?? ''} (${fx.currency} @ ${historicalRate} → ${fx.rate})`.trim(),
        });
        this.logger.log(`[postFromPayment] realised FX ${diff > 0 ? 'gain' : 'loss'} ${Math.abs(diff)} → ${fxAccount.code}`);
      }
    }

    try {
      const created = await this.journal.create(
        organizationId,
        {
          entryDate: paymentDate.toISOString(),
          type: 'PAYMENT',
          // Customer money in = REC (doc-type prefix plan).
          reference: paymentReference ? refWith('REC', paymentReference) : undefined,
          description: `Auto-posted from payment ${paymentReference ?? paymentId} — ${customerName ?? ''}`.trim(),
          sourcePaymentId: paymentId,
          sourceDocumentId: documentId ?? undefined,
          currency: fx.currency,
          lines,
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
   * Manual Offset (legacy AR): credit notes knocked off against invoices.
   * Both sides are ALREADY posted to the debtor control, so the offset itself
   * moves nothing — a journal exists only when the settled base values differ
   * (foreign docs at different historical rates): Dr debtor at the CN's
   * historical base / Cr debtor at the invoice's, difference to FX gain/loss.
   * Returns null when there is nothing to post.
   */
  async postFromManualOffset(args: {
    organizationId: string;
    offsetDocumentId: string;
    offsetNumber?: string | null;
    entryDate: Date;
    customerName?: string | null; // the party (customer, or supplier when party='supplier')
    /** 'supplier' = AP Manual Offset: creditor control, sides mirrored. */
    party?: 'customer' | 'supplier';
    debits: Array<{ documentId: string; amount: number; currency?: string | null }>; // invoices settled
    credits: Array<{ documentId: string; amount: number; currency?: string | null }>; // credit notes consumed
    userId?: string;
  }) {
    const { organizationId, offsetDocumentId, offsetNumber, customerName } = args;
    const isAp = args.party === 'supplier';
    const controls = await this.getControlAccounts(organizationId);
    if (!controls) return null;
    const debtor = await this.resolveAccountByCode(organizationId, isAp ? controls.creditorControl || 'CL001' : controls.debtorControl);
    if (!debtor) return null;

    // Re-save = repost safety (offsets are create-only today, but keep the
    // same void-previous contract as every other poster).
    const existing = await this.prisma.journalEntry.findFirst({
      where: { organizationId, sourceDocumentId: offsetDocumentId, type: 'PAYMENT', status: { not: 'VOID' } },
      select: { id: true },
    });
    if (existing) await this.journal.void(organizationId, existing.id, args.userId);

    const setting = await this.prisma.accountingSetting.findUnique({
      where: { organizationId },
      select: { baseCurrency: true },
    });
    const base = (setting?.baseCurrency || 'SGD').toUpperCase();
    const histBase = async (a: { documentId: string; amount: number; currency?: string | null }) => {
      const cur = (a.currency || base).toUpperCase();
      const hist = cur !== base ? (await this.historicalRateForDocument(organizationId, a.documentId)) ?? 1 : 1;
      return { baseAmount: ROUND(a.amount * hist), hist, foreign: cur !== base };
    };

    type Line = { accountId: string; debit: number; credit: number; description: string; foreignAmount?: number; exchangeRate?: number };
    const lines: Line[] = [];
    let drTotal = 0;
    let crTotal = 0;
    let anyForeign = false;
    for (const c of args.credits) {
      const { baseAmount, hist, foreign } = await histBase(c);
      anyForeign = anyForeign || foreign;
      drTotal = ROUND(drTotal + baseAmount);
      // AR: consuming a credit note DEBITS the debtor control; AP mirrors it.
      lines.push({
        accountId: debtor.id,
        debit: isAp ? 0 : baseAmount,
        credit: isAp ? baseAmount : 0,
        description: `Offset ${isAp ? 'supplier ' : ''}credit note — ${customerName ?? ''}`.trim(),
        ...(foreign ? { foreignAmount: ROUND(c.amount), exchangeRate: hist } : {}),
      });
    }
    for (const d of args.debits) {
      const { baseAmount, hist, foreign } = await histBase(d);
      anyForeign = anyForeign || foreign;
      crTotal = ROUND(crTotal + baseAmount);
      lines.push({
        accountId: debtor.id,
        debit: isAp ? baseAmount : 0,
        credit: isAp ? 0 : baseAmount,
        description: `Offset ${isAp ? 'supplier invoice' : 'invoice'} — ${customerName ?? ''}`.trim(),
        ...(foreign ? { foreignAmount: ROUND(d.amount), exchangeRate: hist } : {}),
      });
    }
    const diff = ROUND(drTotal - crTotal);
    if (!anyForeign || Math.abs(diff) <= 0.005) return null; // control nets out — nothing to post
    const fxAccount = await this.resolveFxGainLossAccount(organizationId, controls);
    if (!fxAccount) {
      this.logger.warn(`[postFromManualOffset] FX difference of ${diff} but no FX gain/loss account; skipping post`);
      return null;
    }
    // `drTotal` / `crTotal` are named for the AR orientation: the credits loop
    // feeds drTotal and the debits loop feeds crTotal. On AP both loops post to
    // the OPPOSITE column, so the residual needs the opposite side too — taking
    // the AR sides there put the balancing figure on the same side as the
    // imbalance and doubled it, and journal.create rejects the entry ("Journal
    // does not balance") AFTER the offset document and its BillPayment rows are
    // already committed. The column decides the wording: a debit to the FX
    // account is a loss, a credit is a gain.
    const fxDebit = isAp ? (diff > 0 ? diff : 0) : diff < 0 ? -diff : 0;
    const fxCredit = isAp ? (diff < 0 ? -diff : 0) : diff > 0 ? diff : 0;
    lines.push({
      accountId: fxAccount.id,
      debit: fxDebit,
      credit: fxCredit,
      description: `Realised FX ${fxCredit > 0 ? 'gain' : 'loss'} — Manual Offset ${offsetNumber ?? ''}`.trim(),
    });

    return this.journal.create(
      organizationId,
      {
        entryDate: args.entryDate.toISOString(),
        type: 'PAYMENT',
        reference: offsetNumber ?? undefined,
        description: `Manual Offset ${offsetNumber ?? ''} — ${customerName ?? ''}`.trim(),
        sourceDocumentId: offsetDocumentId,
        currency: base,
        lines,
      },
      args.userId,
      { autoPost: true },
    );
  }

  /**
   * Official Receipt — ONE receipt allocated across MANY invoices posts ONE
   * journal (legacy-UX overhaul):
   *   Dr Bank/Cash (deposit-to)   receipt total (base)
   *     Cr Trade Debtors          one credit per allocation, at each invoice's
   *                               HISTORICAL rate so the control clears exactly
   *     ± Realised FX gain/loss   residual (foreign receipts)
   * Re-save reposts: any previous journal for the receipt is voided first.
   * Allocation payment rows carry NO per-payment journal — this is it.
   */
  async postFromReceipt(args: {
    organizationId: string;
    receiptDocumentId: string;
    receiptNumber?: string | null;
    entryDate: Date;
    customerName?: string | null;
    bankAccountCode: string;
    // Credit-side account (guru 2026-07-28: selectable in the OR editor).
    // Defaults to the debtor control when absent.
    creditAccountCode?: string | null;
    currency?: string | null;
    rate?: number | null;
    amount: number; // receipt total, in receipt currency
    allocations: Array<{ documentId: string; amount: number }>; // receipt currency
    userId?: string;
  }) {
    const { organizationId, receiptDocumentId, receiptNumber, entryDate, customerName } = args;
    const controls = await this.getControlAccounts(organizationId);
    if (!controls) {
      this.logger.warn(`[postFromReceipt] org=${organizationId} has no controlAccounts; skipping`);
      return null;
    }
    const creditCode = args.creditAccountCode || controls.debtorControl;
    const debtor = await this.resolveAccountByCode(organizationId, creditCode);
    const bank = await this.resolveAccountByCode(organizationId, args.bankAccountCode);
    if (!debtor || !bank) {
      this.logger.warn(
        `[postFromReceipt] missing accounts (credit=${creditCode}, bank=${args.bankAccountCode}); skipping`,
      );
      return null;
    }

    // Re-save = repost: void the previous journal for this receipt.
    const existing = await this.prisma.journalEntry.findFirst({
      where: { organizationId, sourceDocumentId: receiptDocumentId, type: 'PAYMENT', status: { not: 'VOID' } },
      select: { id: true, journalNumber: true },
    });
    if (existing) await this.journal.void(organizationId, existing.id, args.userId);

    const setting = await this.prisma.accountingSetting.findUnique({
      where: { organizationId },
      select: { baseCurrency: true },
    });
    const base = (setting?.baseCurrency || 'SGD').toUpperCase();
    const currency = (args.currency || base).toUpperCase();
    const isForeign = currency !== base;
    const rate = isForeign ? Number(args.rate) || 1 : 1;

    type Line = { accountId: string; debit: number; credit: number; description: string; foreignAmount?: number; exchangeRate?: number };
    const lines: Line[] = [];
    const bankBase = ROUND(args.amount * rate);
    lines.push({
      accountId: bank.id,
      debit: bankBase,
      credit: 0,
      description: `Official Receipt ${receiptNumber ?? ''}`.trim(),
      ...(isForeign ? { foreignAmount: ROUND(args.amount), exchangeRate: rate } : {}),
    });
    let arBaseTotal = 0;
    for (const a of args.allocations) {
      const hist = isForeign ? (await this.historicalRateForDocument(organizationId, a.documentId)) ?? rate : 1;
      const arBase = ROUND(a.amount * hist);
      arBaseTotal = ROUND(arBaseTotal + arBase);
      lines.push({
        accountId: debtor.id,
        debit: 0,
        credit: arBase,
        description: `Settle invoice — ${customerName ?? ''}`.trim(),
        ...(isForeign ? { foreignAmount: ROUND(a.amount), exchangeRate: hist } : {}),
      });
    }
    const diff = ROUND(bankBase - arBaseTotal); // >0 → realised gain
    if (Math.abs(diff) > 0.005) {
      const fxAccount = await this.resolveFxGainLossAccount(organizationId, controls);
      if (!fxAccount) {
        this.logger.warn(`[postFromReceipt] realised FX of ${diff} but no FX gain/loss account; skipping post`);
        return null;
      }
      lines.push({
        accountId: fxAccount.id,
        debit: diff < 0 ? -diff : 0,
        credit: diff > 0 ? diff : 0,
        description: `Realised FX ${diff > 0 ? 'gain' : 'loss'} — ${receiptNumber ?? ''} (${currency} @ receipt ${rate})`.trim(),
      });
    }

    const created = await this.journal.create(
      organizationId,
      {
        entryDate: entryDate.toISOString(),
        type: 'PAYMENT',
        // Official Receipt = REC (doc-type prefix plan).
        reference: receiptNumber ? refWith('REC', receiptNumber) : undefined,
        description: `Official Receipt ${receiptNumber ?? ''} — ${customerName ?? ''}`.trim(),
        sourceDocumentId: receiptDocumentId,
        currency,
        lines,
      },
      args.userId,
      { autoPost: true },
    );
    this.logger.log(`[postFromReceipt] created journal=${created.journalNumber} (${lines.length} lines)`);
    return created;
  }

  /**
   * Payment Voucher (legacy AP, 2026-10-21) — the Official Receipt's twin.
   * ONE journal per voucher:
   *   Dr Trade Creditors  (per allocated bill, at the bill's historical rate)
   *     Cr Bank / Cash    (voucher total, at the voucher rate)
   *   ± Realised FX on the difference.
   * Re-save = void the previous voucher journal and repost.
   */
  /**
   * CONTRA SET-OFF (guru 2026-11-06) — the same company owes us as a customer
   * and is owed by us as a supplier, and the two are netted:
   *
   *   Dr Trade Creditors   (we stop owing them)
   *   Cr Trade Debtors     (they stop owing us)
   *
   * Unlike a Manual Offset this is never a no-op: the two control accounts are
   * different, so real balances move between the AP and AR ledgers. Re-save
   * voids the previous journal and reposts, same as every other document.
   */
  async postFromContraOffset(args: {
    organizationId: string;
    contraDocumentId: string;
    contraNumber?: string | null;
    entryDate: Date;
    customerName?: string | null;
    supplierName?: string | null;
    amount: number;
    userId?: string;
  }) {
    const { organizationId, contraDocumentId, contraNumber, entryDate } = args;
    const amount = ROUND(args.amount);
    if (amount <= 0) {
      this.logger.warn(`[postFromContraOffset] amount ${amount} is not positive; skipping`);
      return null;
    }
    const controls = await this.getControlAccounts(organizationId);
    if (!controls) {
      this.logger.warn(`[postFromContraOffset] org=${organizationId} has no controlAccounts; skipping`);
      return null;
    }
    const debtor = await this.resolveAccountByCode(organizationId, controls.debtorControl);
    const creditor = await this.resolveAccountByCode(organizationId, controls.creditorControl);
    if (!debtor || !creditor) {
      this.logger.warn(
        `[postFromContraOffset] missing control accounts (debtor=${controls.debtorControl}, creditor=${controls.creditorControl}); skipping`,
      );
      return null;
    }

    const existing = await this.prisma.journalEntry.findFirst({
      where: { organizationId, sourceDocumentId: contraDocumentId, type: 'ADJUSTMENT', status: { not: 'VOID' } },
      select: { id: true },
    });
    if (existing) await this.journal.void(organizationId, existing.id, args.userId);

    const who = [args.customerName, args.supplierName].filter(Boolean).join(' / ');
    const created = await this.journal.create(
      organizationId,
      {
        entryDate: entryDate.toISOString(),
        type: 'ADJUSTMENT',
        reference: contraNumber ? refWith('C/T', contraNumber) : undefined,
        description: `Contra set-off ${contraNumber ?? ''} — ${who}`.trim(),
        sourceDocumentId: contraDocumentId,
        lines: [
          { accountId: creditor.id, debit: amount, credit: 0, description: `Contra — bills settled (${args.supplierName ?? ''})`.trim() },
          { accountId: debtor.id, debit: 0, credit: amount, description: `Contra — invoices settled (${args.customerName ?? ''})`.trim() },
        ],
      },
      args.userId,
      { autoPost: true },
    );
    this.logger.log(`[postFromContraOffset] created journal=${created.journalNumber} for ${contraNumber}`);
    return created;
  }

  /**
   * Payment Voucher (legacy P/V screen, 2026-11-09): header bank + GL lines.
   *   Cr bank (total, voucher currency → base)
   *   Dr each direct line's account (a negative line credits it instead)
   *   Dr creditor control per ticked supplier invoice at the invoice's
   *      historical rate (a credit-note allocation credits it back)
   *   ± realised FX for the creditor line when "Update Exchange Gain / Loss"
   *      is on; off = the creditor is relieved at the voucher's own rate.
   */
  async postFromPaymentVoucher(args: {
    organizationId: string;
    voucherDocumentId: string;
    voucherNumber?: string | null;
    entryDate: Date;
    payee?: string | null;
    bankAccountCode: string; // paid-from (credit side)
    currency?: string | null; // voucher (bank) currency
    rate?: number | null; // voucher currency → base
    total: number; // sum of the lines, voucher currency
    lines: Array<{
      accountCode: string;
      amount: number; // voucher currency, signed
      description?: string | null;
      offset?: null | {
        party?: 'supplier' | 'customer' | null; // customer = refund of credit notes (Dr debtor control)
        supplierName?: string | null; // the party's name
        currency?: string | null; // supplier currency
        rate?: number | null; // supplier currency per voucher currency
        allocations: Array<{ documentId: string; amount: number }>; // supplier currency
        updateFx?: boolean | null;
        fxAccountCode?: string | null;
      };
    }>;
    userId?: string;
  }) {
    const { organizationId, voucherDocumentId, voucherNumber, entryDate, payee } = args;
    const controls = await this.getControlAccounts(organizationId);
    if (!controls) {
      this.logger.warn(`[postFromPaymentVoucher] org=${organizationId} has no controlAccounts; skipping`);
      return null;
    }
    const bank = await this.resolveAccountByCode(organizationId, args.bankAccountCode);
    if (!bank) {
      this.logger.warn(`[postFromPaymentVoucher] bank account ${args.bankAccountCode} missing; skipping`);
      return null;
    }

    const existing = await this.prisma.journalEntry.findFirst({
      where: { organizationId, sourceDocumentId: voucherDocumentId, type: 'PAYMENT', status: { not: 'VOID' } },
      select: { id: true, journalNumber: true },
    });
    if (existing) await this.journal.void(organizationId, existing.id, args.userId);

    const setting = await this.prisma.accountingSetting.findUnique({
      where: { organizationId },
      select: { baseCurrency: true },
    });
    const base = (setting?.baseCurrency || 'SGD').toUpperCase();
    const currency = (args.currency || base).toUpperCase();
    const isForeign = currency !== base;
    const rate = isForeign ? Number(args.rate) || 1 : 1;

    type Line = { accountId: string; debit: number; credit: number; description: string; foreignAmount?: number; exchangeRate?: number };
    const lines: Line[] = [];
    const fx = (amt: number) => (isForeign ? { foreignAmount: ROUND(Math.abs(amt)), exchangeRate: rate } : {});

    for (const l of args.lines) {
      const account = await this.resolveAccountByCode(organizationId, l.accountCode);
      if (!account) {
        this.logger.warn(`[postFromPaymentVoucher] account ${l.accountCode} missing; skipping`);
        return null;
      }
      const lineBase = ROUND(l.amount * rate);
      if (!l.offset) {
        if (lineBase === 0) continue;
        lines.push({
          accountId: account.id,
          debit: lineBase > 0 ? lineBase : 0,
          credit: lineBase < 0 ? -lineBase : 0,
          description: (l.description || account.name || '').trim() || `Payment Voucher ${voucherNumber ?? ''}`.trim(),
          ...fx(l.amount),
        });
        continue;
      }
      // Creditor line: Dr control per allocation. Allocations are in the
      // supplier's currency; the base value is the invoice's historical rate
      // (so the liability is relieved at what it was booked at) when FX
      // updating is on, else the voucher's rate (no FX leg).
      const o = l.offset;
      const supCur = String(o.currency || currency).toUpperCase();
      const supForeign = supCur !== base;
      const supRate = Number(o.rate) || 1; // supplier per voucher
      const voucherRateForSupplier = rate / supRate; // supplier currency → base via the voucher
      let apBaseTotal = 0;
      for (const a of o.allocations) {
        const hist = supForeign
          ? o.updateFx !== false
            ? (await this.historicalRateForDocument(organizationId, a.documentId)) ?? voucherRateForSupplier
            : voucherRateForSupplier
          : 1;
        const apBase = ROUND(a.amount * hist);
        if (apBase === 0) continue;
        apBaseTotal = ROUND(apBaseTotal + apBase);
        const isCredit = apBase < 0;
        // Customer refund: the credit note's credit is given back in cash, so
        // the debtor control is DEBITED by the credit consumed.
        const isCust = o.party === 'customer';
        lines.push({
          accountId: account.id,
          debit: isCust ? -apBase : isCredit ? 0 : apBase,
          credit: isCust ? 0 : isCredit ? -apBase : 0,
          description: isCust
            ? `Refund credit note — ${o.supplierName ?? ''}`.trim()
            : isCredit
            ? `Apply supplier credit note — ${o.supplierName ?? ''}`.trim()
            : `Settle supplier invoice — ${o.supplierName ?? ''}`.trim(),
          ...(supForeign ? { foreignAmount: ROUND(Math.abs(a.amount)), exchangeRate: hist } : {}),
        });
      }
      // Paid more base than the liability relieved → realised LOSS (debit FX).
      // (Customer refund: allocations are negative, the debit posted is −Σ.)
      const diff = ROUND(lineBase - (o.party === 'customer' ? -apBaseTotal : apBaseTotal));
      if (Math.abs(diff) > 0.005) {
        const fxAccount = o.fxAccountCode
          ? await this.resolveAccountByCode(organizationId, o.fxAccountCode)
          : await this.resolveFxGainLossAccount(organizationId, controls);
        if (!fxAccount) {
          this.logger.warn(`[postFromPaymentVoucher] realised FX of ${diff} but no FX gain/loss account; skipping post`);
          return null;
        }
        lines.push({
          accountId: fxAccount.id,
          debit: diff > 0 ? diff : 0,
          credit: diff < 0 ? -diff : 0,
          description: `Realised FX ${diff > 0 ? 'loss' : 'gain'} — ${voucherNumber ?? ''} (${supCur} @ voucher ${ROUND(voucherRateForSupplier)})`.trim(),
        });
      }
    }

    // Cr bank = the cash leaving. Zero cash (a credit note settling the bills
    // outright) posts no bank line — a 0/0 line is rejected by the ledger.
    const bankBase = ROUND(args.total * rate);
    if (bankBase !== 0) {
      lines.push({
        accountId: bank.id,
        debit: 0,
        credit: bankBase,
        description: `Payment Voucher ${voucherNumber ?? ''}${payee ? ` — ${payee}` : ''}`.trim(),
        ...fx(args.total),
      });
    }
    // Rounding drift from per-line conversion lands on the bank line.
    const dr = ROUND(lines.reduce((s, x) => s + x.debit, 0));
    const cr = ROUND(lines.reduce((s, x) => s + x.credit, 0));
    const drift = ROUND(dr - cr);
    if (drift !== 0 && Math.abs(drift) <= 0.05) {
      const b = lines.find((x) => x.accountId === bank.id && x.credit > 0);
      if (b) b.credit = ROUND(b.credit + drift);
    }
    if (!lines.length) {
      this.logger.warn(`[postFromPaymentVoucher] nothing to post for ${voucherNumber}`);
      return null;
    }

    const created = await this.journal.create(
      organizationId,
      {
        entryDate: entryDate.toISOString(),
        type: 'PAYMENT',
        // Supplier payment = P/V (doc-type prefix plan).
        reference: voucherNumber ? refWith('P/V', voucherNumber) : undefined,
        description: `Payment Voucher ${voucherNumber ?? ''}${payee ? ` — ${payee}` : ''}`.trim(),
        sourceDocumentId: voucherDocumentId,
        currency,
        lines,
      },
      args.userId,
      { autoPost: true },
    );
    this.logger.log(`[postFromPaymentVoucher] created journal=${created.journalNumber} (${lines.length} lines)`);
    return created;
  }

  /**
   * Spend Money / Receive Money (guru 2026-11-06) — a direct bank transaction
   * with no invoice behind it (Xero's Spend/Receive Money). ONE journal:
   *   SPEND:   Dr each line's account (net)  + Dr input GST   / Cr bank (gross)
   *   RECEIVE: Dr bank (gross)               / Cr each line's account (net) + Cr output GST
   * A negative line (a refund netted off) posts on the opposite side.
   * Re-save = void the previous journal and repost.
   */
  async postFromBankTransaction(args: {
    organizationId: string;
    documentId: string;
    number?: string | null;
    kind: 'SPEND' | 'RECEIVE';
    entryDate: Date;
    payee?: string | null;
    bankAccountCode: string;
    lines: Array<{ accountId: string; amount: number; description?: string | null }>; // NET amounts
    taxAmount: number;
    userId?: string;
  }) {
    const { organizationId, documentId, number, kind } = args;
    const controls = await this.getControlAccounts(organizationId);
    if (!controls) {
      this.logger.warn(`[postFromBankTransaction] org=${organizationId} has no controlAccounts; skipping`);
      return null;
    }
    const bank = await this.resolveAccountByCode(organizationId, args.bankAccountCode);
    if (!bank) {
      this.logger.warn(`[postFromBankTransaction] bank account ${args.bankAccountCode} missing; skipping`);
      return null;
    }
    const tax = ROUND(args.taxAmount || 0);
    // Spend = input GST (kept apart from output when the org's chart does);
    // Receive = output GST — the same accounts bills and invoices post to.
    const taxCode = kind === 'SPEND' ? controls.taxInput || controls.taxLiabilities || 'CL900' : controls.taxLiabilities || 'CL900';
    const taxAccount = tax > 0 ? await this.resolveAccountByCode(organizationId, taxCode) : null;
    if (tax > 0 && !taxAccount) {
      this.logger.warn(`[postFromBankTransaction] tax account ${taxCode} missing; skipping`);
      return null;
    }

    const existing = await this.prisma.journalEntry.findFirst({
      where: { organizationId, sourceDocumentId: documentId, type: 'PAYMENT', status: { not: 'VOID' } },
      select: { id: true },
    });
    if (existing) await this.journal.void(organizationId, existing.id, args.userId);

    const label = kind === 'SPEND' ? 'Spend Money' : 'Receive Money';
    const who = args.payee ? ` — ${args.payee}` : '';
    const lines: Array<{ accountId: string; debit: number; credit: number; description: string }> = [];
    let net = 0;
    for (const l of args.lines) {
      const amt = ROUND(l.amount);
      if (amt === 0) continue;
      net = ROUND(net + amt);
      const dr = kind === 'SPEND' ? amt > 0 : amt < 0;
      lines.push({ accountId: l.accountId, debit: dr ? Math.abs(amt) : 0, credit: dr ? 0 : Math.abs(amt), description: l.description || `${label} ${number ?? ''}${who}`.trim() });
    }
    if (taxAccount && tax > 0) {
      lines.push({ accountId: taxAccount.id, debit: kind === 'SPEND' ? tax : 0, credit: kind === 'SPEND' ? 0 : tax, description: `${kind === 'SPEND' ? 'Input' : 'Output'} tax — ${number ?? ''}`.trim() });
    }
    const gross = ROUND(net + tax);
    lines.push({ accountId: bank.id, debit: kind === 'SPEND' ? 0 : gross, credit: kind === 'SPEND' ? gross : 0, description: `${label} ${number ?? ''}${who}`.trim() });

    const created = await this.journal.create(
      organizationId,
      {
        entryDate: args.entryDate.toISOString(),
        type: 'PAYMENT',
        reference: number ? refWith(kind === 'SPEND' ? 'SPM' : 'RCM', number) : undefined,
        description: `${label} ${number ?? ''}${who}`.trim(),
        sourceDocumentId: documentId,
        lines,
      },
      args.userId,
      { autoPost: true },
    );
    this.logger.log(`[postFromBankTransaction] created journal=${created.journalNumber} (${lines.length} lines)`);
    return created;
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

    // Multi-currency: convert to base at the standing rate (see postFromInvoice).
    const fx = await this.resolveFx(organizationId, documentId);
    if (!fx) return null;
    const toBase = (n: number) => ROUND(n * fx.rate);
    const fxFields = (foreign: number) => (fx.isForeign ? { foreignAmount: ROUND(foreign), exchangeRate: fx.rate } : {});

    const lines: Array<{ accountId: string; debit: number; credit: number; description: string; foreignAmount?: number; exchangeRate?: number }> = [
      { accountId: sales.id, debit: toBase(net), credit: 0, description: `Credit note — ${documentNumber ?? ''}`.trim(), ...fxFields(net) },
    ];
    if (tax > 0 && taxAccount) {
      lines.push({ accountId: taxAccount.id, debit: toBase(tax), credit: 0, description: `Tax reversal — ${documentNumber ?? ''}`.trim(), ...fxFields(tax) });
    }
    const baseGross = ROUND(lines.reduce((s, l) => s + l.debit, 0));
    lines.push({ accountId: debtor.id, debit: 0, credit: baseGross, description: `Credit note — ${customerName ?? ''}`.trim(), ...fxFields(gross) });

    try {
      const created = await this.journal.create(
        organizationId,
        {
          entryDate: entryDate.toISOString(),
          type: 'CREDIT_NOTE',
          reference: documentNumber ?? undefined,
          description: `Auto-posted from credit note ${documentNumber ?? documentId}`,
          sourceDocumentId: documentId,
          currency: fx.currency,
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
    const taxAccount = tax > 0 ? await this.resolveAccountByCode(organizationId, controls.taxInput || controls.taxLiabilities) : null;

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

    // Multi-currency: convert to base at the standing rate (supplier currency).
    const fx = await this.resolveFx(organizationId, documentId);
    if (!fx) return null;
    const toBase = (n: number) => ROUND(n * fx.rate);
    const fxFields = (foreign: number) => (fx.isForeign ? { foreignAmount: ROUND(foreign), exchangeRate: fx.rate } : {});

    const lines: Array<{ accountId: string; debit: number; credit: number; description: string; foreignAmount?: number; exchangeRate?: number }> = [
      { accountId: debitAccount.id, debit: toBase(net), credit: 0, description: `${debitLabel} — ${documentNumber ?? ''}`.trim(), ...fxFields(net) },
    ];
    if (tax > 0 && taxAccount) {
      lines.push({ accountId: taxAccount.id, debit: toBase(tax), credit: 0, description: `Input tax — ${documentNumber ?? ''}`.trim(), ...fxFields(tax) });
    }
    const baseGross = ROUND(lines.reduce((s, l) => s + l.debit, 0));
    lines.push({ accountId: creditor.id, debit: 0, credit: baseGross, description: `PO — ${supplierName ?? ''}`.trim(), ...fxFields(gross) });

    try {
      const created = await this.journal.create(
        organizationId,
        {
          entryDate: entryDate.toISOString(),
          type: 'PURCHASE_ORDER',
          reference: documentNumber ?? undefined,
          description: `Auto-posted from purchase order ${documentNumber ?? documentId}`,
          sourceDocumentId: documentId,
          currency: fx.currency,
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
    const taxAccount = tax > 0 ? await this.resolveAccountByCode(organizationId, controls.taxInput || controls.taxLiabilities) : null;

    if (!creditor || !purchase || (tax > 0 && !taxAccount)) {
      this.logger.warn(`[postFromPurchaseReturn] missing accounts (creditor=${creditor?.code}, purchase=${purchase?.code}, tax=${taxAccount?.code}); skipping`);
      return null;
    }

    // Multi-currency: convert to base at the standing rate (supplier currency).
    const fx = await this.resolveFx(organizationId, documentId);
    if (!fx) return null;
    const toBase = (n: number) => ROUND(n * fx.rate);
    const fxFields = (foreign: number) => (fx.isForeign ? { foreignAmount: ROUND(foreign), exchangeRate: fx.rate } : {});

    const creditLines: Array<{ accountId: string; debit: number; credit: number; description: string; foreignAmount?: number; exchangeRate?: number }> = [
      { accountId: purchase.id, debit: 0, credit: toBase(net), description: `Purchase reversal — ${documentNumber ?? ''}`.trim(), ...fxFields(net) },
    ];
    if (tax > 0 && taxAccount) {
      creditLines.push({ accountId: taxAccount.id, debit: 0, credit: toBase(tax), description: `Input tax reversal — ${documentNumber ?? ''}`.trim(), ...fxFields(tax) });
    }
    const baseGross = ROUND(creditLines.reduce((s, l) => s + l.credit, 0));
    const lines = [
      { accountId: creditor.id, debit: baseGross, credit: 0, description: `Purchase return — ${supplierName ?? ''}`.trim(), ...fxFields(gross) },
      ...creditLines,
    ];

    try {
      const created = await this.journal.create(
        organizationId,
        {
          entryDate: entryDate.toISOString(),
          type: 'PURCHASE_RETURN',
          reference: documentNumber ?? undefined,
          description: `Auto-posted from purchase return ${documentNumber ?? documentId}`,
          sourceDocumentId: documentId,
          currency: fx.currency,
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

  // ── ERP-imported invoices: held payment journals (flag holdErpImportPaymentGl) ──────────────
  // Imported invoices (common/erp-import.ts) never posted to Trade Receivables. Until the
  // accountant books the opening AR, a payment's Cr Trade Receivables would push the control
  // account below zero, so with the flag on the journal is HELD: the payment / receipt still
  // settles the invoice (balance and status), and the hold is recorded on the invoice
  // (config.erpImport.heldPayments) or on the receipt (config.glHeld). postHeldErpPayments posts
  // them all later (Posting Queue → "Post held journals", or POST /journal/erp-held/post-held).

  /** True when the org holds these journals and any of the documents was imported from the ERP. */
  async holdsErpPaymentGl(organizationId: string, documentIds: string[]): Promise<boolean> {
    const ids = [...new Set(documentIds.filter(Boolean))];
    if (!ids.length) return false;
    if (!(await isOrgFeatureEnabled(this.prisma as any, organizationId, HOLD_ERP_PAYMENT_GL_FLAG))) return false;
    const docs = await this.prisma.document.findMany({ where: { organizationId, id: { in: ids } }, select: { config: true } });
    return docs.some((d) => isErpImported(d.config));
  }

  private async recordHeldPayment(organizationId: string, documentId: string, held: Record<string, any>) {
    const doc = await this.prisma.document.findFirst({ where: { id: documentId, organizationId }, select: { config: true } });
    const cfg: any = doc?.config || {};
    if (!isErpImported(cfg)) return;
    const list: any[] = Array.isArray(cfg.erpImport.heldPayments) ? cfg.erpImport.heldPayments : [];
    const next = [...list.filter((h) => h?.paymentId !== held.paymentId), held];
    await this.prisma.document.update({ where: { id: documentId }, data: { config: { ...cfg, erpImport: { ...cfg.erpImport, heldPayments: next } } as any } });
  }

  /** A deleted payment's hold goes with it (payments.service remove). */
  async dropHeldPayment(organizationId: string, documentId: string, paymentId: string) {
    const doc = await this.prisma.document.findFirst({ where: { id: documentId, organizationId }, select: { config: true } });
    const cfg: any = doc?.config || {};
    const list: any[] = cfg?.erpImport?.heldPayments;
    if (!Array.isArray(list) || !list.some((h) => h?.paymentId === paymentId)) return;
    await this.prisma.document.update({ where: { id: documentId }, data: { config: { ...cfg, erpImport: { ...cfg.erpImport, heldPayments: list.filter((h) => h?.paymentId !== paymentId) } } as any } });
  }

  /** A receipt whose journal is held: void any journal it already had and mark it held. */
  async holdReceipt(organizationId: string, receiptDocumentId: string, userId?: string) {
    const existing = await this.prisma.journalEntry.findFirst({
      where: { organizationId, sourceDocumentId: receiptDocumentId, type: 'PAYMENT', status: { not: 'VOID' } },
      select: { id: true },
    });
    if (existing) await this.journal.void(organizationId, existing.id, userId);
    const doc = await this.prisma.document.findFirst({ where: { id: receiptDocumentId, organizationId }, select: { config: true } });
    const cfg: any = doc?.config || {};
    const { journalNumber: _drop, ...rest } = cfg;
    await this.prisma.document.update({
      where: { id: receiptDocumentId },
      data: { config: { ...rest, glHeld: { reason: 'erp-import', flag: HOLD_ERP_PAYMENT_GL_FLAG, at: new Date().toISOString() } } as any },
    });
    this.logger.log(`[postFromReceipt] receipt=${receiptDocumentId} pays ERP-imported invoices: journal held (${HOLD_ERP_PAYMENT_GL_FLAG})`);
  }

  /** What is held now: payments on imported invoices and receipts. */
  async listHeldErpPayments(organizationId: string) {
    const invoices = await this.prisma.$queryRaw<Array<{ id: string; name: string | null; held: any }>>`
      select id::text, name, config->'erpImport'->'heldPayments' as held from "Document"
      where "organizationId" = ${organizationId} and jsonb_typeof(config->'erpImport'->'heldPayments') = 'array'
        and jsonb_array_length(config->'erpImport'->'heldPayments') > 0`;
    const receipts = await this.prisma.$queryRaw<Array<{ id: string; name: string | null; amount: any; date: any }>>`
      select id::text, name, config->>'receiptAmount' as amount, config->>'date' as date from "Document"
      where "organizationId" = ${organizationId} and type = 'OFFICIAL_RECEIPT' and config->'glHeld' is not null and config->'glHeld' <> 'null'::jsonb`;
    const payments = invoices.flatMap((d) => (d.held as any[]).map((h) => ({ invoiceId: d.id, invoice: d.name, ...h })));
    const total = ROUND(payments.reduce((s, p) => s + (Number(p.amount) || 0), 0) + receipts.reduce((s, r) => s + (Number(r.amount) || 0), 0));
    return {
      flagOn: await isOrgFeatureEnabled(this.prisma as any, organizationId, HOLD_ERP_PAYMENT_GL_FLAG),
      count: payments.length + receipts.length,
      total,
      payments,
      receipts: receipts.map((r) => ({ receiptId: r.id, receipt: r.name, amount: Number(r.amount) || 0, date: r.date })),
    };
  }

  /** Post every held journal (once the opening AR is booked). Each one posts on its own; failures stay held. */
  async postHeldErpPayments(organizationId: string, userId?: string) {
    const held = await this.listHeldErpPayments(organizationId);
    const results: Array<{ kind: 'payment' | 'receipt'; id: string; ref: string | null; ok: boolean; journalNumber?: string; error?: string }> = [];
    for (const h of held.payments) {
      const pay = await this.prisma.payment.findFirst({ where: { id: h.paymentId, organizationId }, include: { customer: { select: { name: true } } } });
      if (!pay) {
        await this.dropHeldPayment(organizationId, h.invoiceId, h.paymentId);
        results.push({ kind: 'payment', id: h.paymentId, ref: h.invoice, ok: true, error: 'payment no longer exists; hold removed' });
        continue;
      }
      try {
        const entry = await this.postFromPayment({
          organizationId,
          paymentId: pay.id,
          documentId: pay.documentId,
          paymentReference: pay.reference,
          paymentMethod: pay.paymentMethod,
          paymentDate: pay.paymentDate,
          customerName: pay.customer?.name,
          amount: Number(pay.amount),
          cashAccountCode: h.cashAccountCode || undefined,
          userId,
          release: true,
        });
        if (!entry) throw new Error('not posted (check the control / bank accounts)');
        await this.dropHeldPayment(organizationId, h.invoiceId, h.paymentId);
        results.push({ kind: 'payment', id: pay.id, ref: h.invoice, ok: true, journalNumber: (entry as any).journalNumber });
      } catch (e: any) {
        results.push({ kind: 'payment', id: pay.id, ref: h.invoice, ok: false, error: e?.message || String(e) });
      }
    }
    for (const r of held.receipts) {
      const doc = await this.prisma.document.findFirst({ where: { id: r.receiptId, organizationId }, select: { name: true, config: true } });
      const c: any = doc?.config || {};
      try {
        const entry = await this.postFromReceipt({
          organizationId,
          receiptDocumentId: r.receiptId,
          receiptNumber: doc?.name,
          entryDate: new Date(c.date),
          customerName: c.customerName,
          bankAccountCode: c.debitAccountCode,
          creditAccountCode: c.creditAccountCode || null,
          currency: c.currency || 'SGD',
          rate: Number(c.rate) || 1,
          amount: Number(c.receiptAmount) || 0,
          allocations: (Array.isArray(c.allocations) ? c.allocations : []).map((a: any) => ({ documentId: a.documentId, amount: Number(a.amount) || 0 })),
          userId,
        });
        if (!entry) throw new Error('not posted (check the bank / debtor accounts)');
        await this.prisma.document.update({ where: { id: r.receiptId }, data: { config: { ...c, glHeld: null, journalNumber: (entry as any).journalNumber } as any } });
        results.push({ kind: 'receipt', id: r.receiptId, ref: doc?.name ?? null, ok: true, journalNumber: (entry as any).journalNumber });
      } catch (e: any) {
        results.push({ kind: 'receipt', id: r.receiptId, ref: doc?.name ?? null, ok: false, error: e?.message || String(e) });
      }
    }
    return { posted: results.filter((x) => x.ok && x.journalNumber).length, failed: results.filter((x) => !x.ok).length, results };
  }
}
