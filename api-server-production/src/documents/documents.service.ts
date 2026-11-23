import { IMPORTED_ORDER_USE_CREATE_INVOICE, importedMarkerOf, importedOrderDraftInvoice, importedStatusFrom, isImportedOrder, isImportedOrdersEnabled, loadImportedOrderInputs, refreshImportedOrderStatus } from '../orders/imported-orders';
import { remainingForOrder } from '../orders/imported-remaining';
import { docCustomerIdOf } from '../orders/imported-order-links';
import { PENDING_ORDER_LINK_KEY, pendingOrderLinkOf } from '../orders/order-list-add';
import { BadRequestException, HttpException, HttpStatus, Inject, Injectable, NotFoundException, Optional, forwardRef } from '@nestjs/common';
import { ClerkIdentityService } from '../clerk/clerk-identity.service';
import { SALES_USER_ID_RE } from '../common/services/document-html/shared';
import { assertRecordUnlocked, carryRecordLock, isRecordLocked } from '../common/record-lock';
import { isLockAdviser } from '../common/period-lock';
import { assertNotVoided, isDocumentVoided, voidDocumentCore, voidedDocumentIds } from '../common/document-void';
import { assertPeriodOpen, documentDay, isPeriodLockedDocType } from '../common/period-lock';
import { tierOfRoleNames } from '../common/role-tier';
import { DeliveriesService } from '../deliveries/deliveries.service';
import { randomUUID } from 'crypto';
import AdmZip = require('adm-zip');
import { UpdateDocumentDto } from './dto/update-document.dto';
import { PrismaService } from 'src/common/prisma.service';
import { isUnconfirmedDoc } from '../common/doc-status';
import { documentReferenceOf } from '../common/doc-ref';
import { AccountMemoryService } from '../account-memory/account-memory.service';
import { CreateDocumentWithTimelineDto } from './dto/create-document-with-timeline.dto';
import { InventoryStatus, DocumentStatus, ItemType, DeliveryStatus, DeploymentType, Prisma } from '@prisma/client';
import { XeroService } from 'src/common/xero.service';
import { PriceHistoryService } from '../price-history/price-history.service';
import { EmailService } from '../email/email.service';
import { JournalAutoPostService } from '../journal/journal-auto-post.service';
import { JournalService } from '../journal/journal.service';
import { OrdersService } from '../orders/orders.service';
import { DocumentTemplatesService } from '../documentTemplates/documentTemplates.service';
import { runAsOrg } from '../common/tenancy/tenant-context';
import { isVoidedWithOrder } from '../orders/order-cancel';
import { DocumentNumberingService, splitPartNamesAmong } from '../document-numbering/document-numbering.service';
import { SendInvoiceEmailDto } from '../email/dto/send-invoice-email.dto';
import { S3Service } from 'src/common/services/s3.service';
import { PdfGeneratorService } from 'src/common/services/pdf-generator.service';
import { AuditService } from 'src/common/audit.service';
import { NotificationsService } from '../notifications/notifications.service';
import { StaffWhatsAppService } from '../staff-whatsapp/staff-whatsapp.service';
import * as moment from 'moment';
import { pdfOptionsFor, isNamedLayout } from '../common/services/document-html';
import { resolveDesign } from '../common/services/document-html/design';
import { effectiveDesign, isImportedDoc } from '../common/services/document-html/wct-brand';
import { outstandingOf, grossStampOf, grossOf, amountPaidOf, computeDocumentTotals, stampDocumentMoney } from '../common/document-money';
import { splitInvoice as splitInvoiceOp, undoInvoiceSplit as undoInvoiceSplitOp } from './invoice-split-ops';
import { keepSplitPartTotals, splitGlRevenueLines, type SplitPlan } from './invoice-split';
import { sgToday, wctFamilyOf, wctFamilyOfTypes, isWctStatusValue, wctStatusMatches, wctStatusOf } from '../common/wct-statuses';
import { ERP_QUOTE_CANCELLED_STATUSES, assertNotErpImportedDo, confirmPostsToGl, erpDraftState, erpPaidAtImport, erpQuotationDate, erpQuotationDisplayStatus, erpQuotationTag, erpStoredTotalsOf, isErpImported, isErpImportedDo, isQuotationDocType, moneySignature } from '../common/erp-import';
import { carryServerDoKeys, carryServerInvoiceKeys } from '../deliveries/do-number';
import { fillEmptyOrderCustomer, invoiceRowsWithSplitParts, isWctOrdersEnabled, linkedDoEntriesOf, liveInvoiceIds, orderInvoiceIdsOf, refreshOrderStatus, WCT_ORDER_INVOICE_FLAG } from '../orders/wct-orders';
import { isManualOrderFlow, manualAutoDraftsOff } from '../orders/manual-order-flow';
import { skipsDoSaveStockRule } from './do-first-save';
import { RDO_FREE_ROWS_FLAG, allowsRdoFreeRows, hasUnit, isRdoSigned, isRdoType } from './rdo-free-rows';
import { OFFICE_DO_EDITS_FLAG, isOfficeDoEdit, officeDoEditChanges, pinOfficeDoEdit } from './office-do-edit';
import { deliveryDocLockReason } from './delivery-doc-lock';
import { hasAdminRole } from '../common/admin-role';
import { ActionLogService } from '../action-log/action-log.service';
import { QUOTATION_REVISION_FLAG, nextRevision } from './quotation-revision';
import { SOFT_DELETE_DRAFTS_FLAG, SOFT_DELETED_TYPE, WCT_STATUSES_FLAG, isOrgFeatureEnabled, HEADER_GL_ACCOUNT_FLAG, LINE_GL_ACCOUNTS_FLAG, POST_INVOICES_ON_CONFIRM_FLAG, QUOTATION_GST_FLAG, QUOTATION_TOTALS_TOGGLE_FLAG, invoicePostingHeld } from '../common/org-features';
import { isVerifiedJob } from '../deliveries/finish-modes';
import { linkedDocIdsForNumber, wantsLinkedSearch } from '../orders/linked-number-search';
import { assetKey, descKey, invoiceDiscountPercent, isDisplayRow, orderInvoiceReference, planOrderInvoice, quoteDiscountAmount, splitJobLines } from '../orders/order-billing';
import { loadSubjectAccounts, subjectPostingLines } from './subject-type-account';

/** A quotation's Subject as stored (flat, or under documentInfo on older rows; WCT orders). */
const quoteSubjectOf = (qc: any): string => String(qc?.subject ?? qc?.documentInfo?.subject ?? '').trim();
import { quotationLinesForJob } from '../deliveries/quotation-to-delivery';
import { orgTodayFor } from '../common/org-today';
import { insertWithLockedNumber } from '../document-numbering/locked-number';

/** Create invoice's lines as the office confirmed them in the dialog (round 19 imported, round 36 AIMS orders). */
type EditedInvoiceLine = { description: string; quantity: number; unitPrice: number };

/** The dialog's lines, checked: at least one, each with a description, a qty of 0 or more and a price; not all $0. Null = none sent. */
function editedInvoiceLines(raw: unknown): EditedInvoiceLine[] | null {
  if (!Array.isArray(raw)) return null;
  const edited = raw.map((l: any) => ({ description: String(l?.description ?? '').trim(), quantity: Number(l?.quantity), unitPrice: Number(l?.unitPrice) }));
  if (!edited.length) throw new HttpException('Give at least one line', HttpStatus.BAD_REQUEST);
  if (edited.some((l) => !l.description || !Number.isFinite(l.quantity) || l.quantity < 0 || !Number.isFinite(l.unitPrice))) throw new HttpException('Every line needs a description, a quantity of 0 or more and a unit price', HttpStatus.BAD_REQUEST);
  if (!edited.some((l) => l.quantity * l.unitPrice > 0)) throw new HttpException('Nothing to bill: every line is $0', HttpStatus.BAD_REQUEST);
  return edited;
}

/**
 * Invoice items for Create invoice's lines (service lines at `rate`). Round 36: on an AIMS order a line whose description
 * is a quotation line's keeps that line's item code, unit, account and revenue tag (never a product unit: no stock link).
 */
function remainderInvoiceItems(lines: EditedInvoiceLine[], rate: number, quoteLines: any[] = []) {
  const R2l = (n: number) => Math.round(n * 100) / 100;
  const key = (v: unknown) => String(v ?? '').replace(/\s+/g, ' ').trim().toLowerCase();
  return lines.map((l) => {
    const q: any = quoteLines.find((x) => key(x?.description) === key(l.description) && key(l.description) !== '');
    const kept = q
      ? Object.fromEntries(['itemCode', 'uom', 'accountCode', 'revenueTag', 'isService'].filter((k) => q[k] !== undefined && q[k] !== null && q[k] !== '').map((k) => [k, q[k]]))
      : {};
    return {
      id: randomUUID(),
      itemCode: '',
      uom: '',
      isService: true,
      revenueTag: 'service',
      accountCode: '',
      inventoryItemId: '',
      ...kept,
      description: l.description,
      quantity: l.quantity,
      unitPrice: l.unitPrice,
      amount: R2l(l.quantity * l.unitPrice),
      tax: String(rate),
    };
  });
}

/** One Create invoice at a time per order (inside the order lock): refused while another run holds the order (5 min). */
async function claimOrderInvoice(tx: any, order: { id: string; linkedDocuments?: unknown }): Promise<{ id: string; at: string }> {
  const ld: any = order.linkedDocuments && typeof order.linkedDocuments === 'object' ? order.linkedDocuments : {};
  if (ld.invoiceClaim && Date.now() - Date.parse(ld.invoiceClaim.at) < 5 * 60_000) {
    throw new HttpException('An invoice for this order is being created. Refresh in a moment.', HttpStatus.CONFLICT);
  }
  const claim = { id: randomUUID(), at: new Date().toISOString() };
  await tx.order.update({ where: { id: order.id }, data: { linkedDocuments: { ...ld, invoiceClaim: claim } } });
  return claim;
}

/** WCT only (2026-11-05): document lists sort / search on the trigger-kept list keys. */
export const DOCUMENT_LIST_KEYS_FLAG = 'useDocumentListKeys';

// Who performed a document action — derived from req.user in the controller.
export interface DocumentActor {
  id?: string;
  name?: string;
  email?: string;
}

@Injectable()
export class DocumentsService {
  constructor(
    private prisma: PrismaService,
    private xeroService: XeroService,
    private priceHistoryService: PriceHistoryService,
    private emailService: EmailService,
    private journalAutoPost: JournalAutoPostService,
    private journalService: JournalService,
    private s3Service: S3Service,
    private pdfGeneratorService: PdfGeneratorService,
    private ordersService: OrdersService,
    private documentTemplatesService: DocumentTemplatesService,
    private documentNumbering: DocumentNumberingService,
    private auditService: AuditService,
    private accountMemory: AccountMemoryService,
    private notifications: NotificationsService,
    private staffWhatsApp: StaffWhatsAppService,
    // Lazy: DeliveriesModule imports DocumentsModule, so this closes a cycle.
    // Used ONLY for the ad-hoc project hand-off in updateDocument.
    @Inject(forwardRef(() => DeliveriesService))
    private deliveriesService: DeliveriesService,
    // Salesperson names for stored documents (withSalesPersonName). Global module; optional so bare test modules still build.
    @Optional() private clerkIdentity?: ClerkIdentityService,
    // Office DO edit log (enableOfficeDoEdits). Global module; optional so bare test modules still build.
    @Optional() private actionLog?: ActionLogService,
  ) {}

  /**
   * A stored document whose salesperson is a bare user id (a salesman with no code) and no saved name:
   * the user's name, looked up (cached) so server PDFs, sign links and emailed PDFs print it instead of the
   * id (2026-11-18, all orgs). A code, or a document that already has the name, is returned unchanged.
   * Never throws.
   */
  async withSalesPersonName<T extends Record<string, any>>(config: T): Promise<T> {
    const cfg: any = config || {};
    const di = cfg.documentInfo && typeof cfg.documentInfo === 'object' ? cfg.documentInfo : null;
    const raw = typeof cfg.salesPerson === 'string' ? cfg.salesPerson : typeof di?.salesPerson === 'string' ? di.salesPerson : '';
    if (!SALES_USER_ID_RE.test(raw.trim()) || String(cfg.salesPersonName || di?.salesPersonName || '').trim() || !this.clerkIdentity) return config;
    try {
      const u: any = (await this.clerkIdentity.toClerkUsers([raw.trim()])).get(raw.trim());
      const name = u ? `${u.firstName || ''} ${u.lastName || ''}`.trim() || u.username || u.emailAddresses?.[0]?.emailAddress || '' : '';
      if (!name) return config;
      return { ...cfg, salesPersonName: name, ...(di ? { documentInfo: { ...di, salesPersonName: name } } : {}) };
    } catch {
      return config;
    }
  }

  /**
   * Line coding for extracted documents (guru 2026-07-26): stamp each line
   * with the org's Revenue Master File item (product/service code + its GL
   * account) when the match is unambiguous, and fall back to the learned
   * account-memory suggestion for the account. Benefits every extraction
   * entry point (upload, email worker, extract-url). Ambiguous matches are
   * left uncoded — the Posting Queue's AI review remains the arbiter.
   */
  private async codeExtractedLines(organizationId: string, items: any[], docType: string): Promise<any[]> {
    if (!Array.isArray(items) || items.length === 0) return items;
    try {
      const revenueItems = await this.prisma.revenueItem.findMany({
        where: { organizationId, isActive: true },
        select: { code: true, name: true, type: true, accountCode: true, accountId: true },
      });
      const norm = (t: string) => String(t || '').toLowerCase().replace(/[^a-z0-9 ]+/g, ' ').replace(/\s+/g, ' ').trim();
      const side = ['BILL', 'PO', 'PURCHASE_ORDER', 'PR', 'PURCHASE_RETURN'].includes(String(docType).toUpperCase()) ? 'PURCHASE' : 'SALES';
      const learned = await this.accountMemory
        .resolveBatch(organizationId, side, items.map((it: any) => String(it?.description || '')))
        .catch(() => items.map(() => null));

      return items.map((it: any, i: number) => {
        if (it.itemCode || it.accountCode) return it; // already coded
        const desc = norm(it.description);
        if (!desc) return it;
        // Revenue Master File: exact code token first, then name containment.
        const byCode = revenueItems.filter((r) => r.code && desc.includes(norm(r.code)) && norm(r.code).length >= 3);
        const byName = byCode.length
          ? []
          : revenueItems.filter((r) => {
              const n = norm(r.name);
              return n.length >= 6 && (desc.includes(n) || n.includes(desc));
            });
        const hits = byCode.length ? byCode : byName;
        if (hits.length === 1) {
          const r = hits[0];
          return {
            ...it,
            itemCode: r.code || undefined,
            isService: r.type === 'SERVICE' ? true : it.isService,
            accountCode: r.accountCode || undefined,
            accountId: r.accountId || undefined,
            codedFrom: 'revenue-master',
          };
        }
        // Learned account mapping (accountant's past corrections).
        const l: any = learned[i];
        if (l?.accountCode) {
          return { ...it, accountCode: l.accountCode, accountId: l.accountId || undefined, codedFrom: 'account-memory' };
        }
        return it;
      });
    } catch (e: any) {
      console.warn('codeExtractedLines skipped:', e?.message || e);
      return items;
    }
  }

  /**
   * Populate each line's Product Code (itemCode) from the extracted MODEL by an
   * exact NORMALIZED match against Asset.skuKey (strip non-alphanumerics, lower-
   * case — so "AF 100" ↔ "AF100"). Precedence vs codeExtractedLines (which runs
   * first): an exact model↔skuKey match OVERRIDES itemCode (a model matching a
   * catalog product code is the specific, intended Product Code); accountCode/GL
   * set by codeExtractedLines is untouched. No skuKey match → put the raw model
   * text in itemCode ONLY if nothing has coded the line yet (so a RevenueItem
   * code is never clobbered, and the column shows the model instead of "—").
   * Best-effort: any failure returns the items unchanged.
   */
  private async codeItemsByAssetSkuKey(organizationId: string, items: any[]): Promise<any[]> {
    if (!Array.isArray(items) || items.length === 0) return items;
    if (!items.some((it) => it?._model)) return items; // nothing to match
    try {
      const norm = (t: string) => String(t || '').toLowerCase().replace(/[^a-z0-9]+/g, '');
      const assets = await this.prisma.asset.findMany({
        where: { organizationId },
        select: { skuKey: true },
      });
      const skuByNorm = new Map<string, string>();
      for (const a of assets) {
        const k = norm(a.skuKey);
        if (k) skuByNorm.set(k, a.skuKey); // canonical catalog spelling
      }
      return items.map((it) => {
        const model = String(it?._model || '').trim();
        if (!model) return it;
        const hit = skuByNorm.get(norm(model));
        if (hit) return { ...it, itemCode: hit, codedFrom: 'asset-skuKey' }; // exact match wins
        if (!it.itemCode) return { ...it, itemCode: model }; // fallback: raw model, don't clobber
        return it;
      });
    } catch (e: any) {
      console.warn('codeItemsByAssetSkuKey skipped:', e?.message || e);
      return items;
    }
  }

  // ── Document history (Xero-style "History and notes") ────────────────────
  // Events are AuditLog rows keyed by resource='document' + resourceId (the
  // admin audit page sees them too). details = { detail, changes? }.
  // AuditService swallows its own errors, so history can never break a save.
  private logDocumentEvent(opts: {
    documentId: string;
    organizationId: string;
    action: 'CREATED' | 'EDITED' | 'EDITED_AFTER_CONFIRM' | 'EDIT_UNLOCKED' | 'APPROVED' | 'STATUS_CHANGED' | 'NOTE' | 'SENT' | 'EMAIL_FAILED' | 'DELETED' | 'LOCKED' | 'UNLOCKED' | 'VOIDED' | 'UNIT_SWAPPED';
    detail: string;
    documentName?: string;
    actor?: DocumentActor;
    changes?: string[];
  }): Promise<void> {
    return this.auditService.logAction({
      userId: opts.actor?.id || 'system',
      userName: opts.actor?.name,
      userEmail: opts.actor?.email,
      action: opts.action,
      resource: 'document',
      resourceId: opts.documentId,
      resourceName: opts.documentName,
      organizationId: opts.organizationId,
      details: {
        detail: opts.detail,
        ...(opts.changes?.length ? { changes: opts.changes } : {}),
      },
    });
  }


  /** Swap unit on a delivered run (enableDeliveryUnitSwap): the DO's history line. */
  logUnitSwapHistory(opts: { documentId: string; organizationId: string; documentName?: string; detail: string; changes?: string[]; actor?: DocumentActor }): Promise<void> {
    return this.logDocumentEvent({ ...opts, action: 'UNIT_SWAPPED' });
  }

  // ── GL on save (no-draft model, 2026-07-15) ──────────────────────────────
  // Saving a transactional document posts it to the GL immediately; re-saving
  // voids the previous journal (with a reversing entry) and posts a fresh one,
  // so the ledger always mirrors the latest saved state. Confirm no longer
  // owns GL — it remains the finalise / stock-deduction / lock step and only
  // posts as a fallback when no entry exists (docs saved before this change).
  private static readonly SAVE_GL_TYPES: Record<string, 'INVOICE' | 'CREDIT_NOTE' | 'DEBIT_NOTE' | 'PURCHASE_ORDER' | 'PURCHASE_RETURN'> = {
    INVOICE: 'INVOICE', TI: 'INVOICE', TI2: 'INVOICE',
    CN: 'CREDIT_NOTE', CREDIT_NOTE: 'CREDIT_NOTE',
    DN: 'DEBIT_NOTE', DEBIT_NOTE: 'DEBIT_NOTE',
    PO: 'PURCHASE_ORDER', PURCHASE_ORDER: 'PURCHASE_ORDER',
    PR: 'PURCHASE_RETURN', PURCHASE_RETURN: 'PURCHASE_RETURN',
  };

  /** A document with no real line item cannot be confirmed (guru 2026-10-27).
   *  Group headers / tag rows do not count; a line counts when it has a
   *  description or an amount. Mirrors the editor's guard. */
  private assertHasLineItems(config: any, what = 'document'): void {
    const items: any[] = Array.isArray(config?.items) ? config.items : [];
    const strip = (v: any) => String(v ?? '').replace(/<[^>]*>/g, '').trim();
    const ok = items.some((it) => it && !it.isGroupHeader && !it.isTagGroup && (strip(it.description) !== '' || Number(it.amount) > 0 || Number(it.unitPrice) > 0));
    if (!ok) throw new BadRequestException(`Add at least one line item before confirming this ${what}.`);
  }

  /** Sales documents that bill a customer: these are what the AR reports and
   *  the Statement of Account key on. */
  private static readonly CUSTOMER_DOC_TYPES = new Set(['INVOICE', 'TI', 'TI2', 'CN', 'CREDIT_NOTE', 'DN', 'DEBIT_NOTE']);

  /**
   * A customer document cannot be confirmed with a typed name and no customer
   * RECORD behind it (guru 2026-11-19: "make it such that u cant confirm if no
   * customer select").
   *
   * Heimen's CCDC invoice was missing from her Statement of Account: it carried
   * `config.customer = { name, address }` and no `customerId`, and every
   * customer-keyed report (SOA, aged receivables, customer ledger) matches on
   * the id. The invoice was in the P&L and invisible to the customer — the
   * worst kind of wrong, because nothing looks broken until someone asks why
   * the statement is short. An invoice raised from a DO that itself had no
   * customer arrives here the same way.
   */
  private assertHasCustomer(config: any, type: any, what = 'document'): void {
    if (!DocumentsService.CUSTOMER_DOC_TYPES.has(String(type || '').toUpperCase())) return;
    const cfg: any = config || {};
    const id = cfg.customerId || cfg.customer?.id || cfg.documentInfo?.customerId;
    if (id) return;
    const typed = String(cfg.customerName || cfg.customer?.name || cfg.billTo || '').trim();
    throw new BadRequestException(
      typed
        ? `Pick "${typed}" from the customer list before confirming this ${what} — a typed name alone leaves it off the customer's Statement of Account.`
        : `Select a customer before confirming this ${what}.`,
    );
  }

  // Fast list path (WCT only, 2026-11-05): an org with the useDocumentListKeys setting ON whose
  // documents all carry the trigger-kept list keys (listIssueDate / listSearch / listCustomerId,
  // scripts/document-list-keys.js) sorts and searches on those columns. Every other org, and an
  // org with any document missing its keys, keeps the existing list code unchanged. A "ready"
  // answer is cached for 5 minutes per org.
  private readonly listKeysReadyAt = new Map<string, number>();
  private async listKeysReady(organizationId: string): Promise<boolean> {
    // The setting is read on every call, so turning it off (rollback) takes effect at once.
    if (!(await isOrgFeatureEnabled(this.prisma as any, organizationId, DOCUMENT_LIST_KEYS_FLAG))) {
      this.listKeysReadyAt.delete(organizationId);
      return false;
    }
    const at = this.listKeysReadyAt.get(organizationId);
    if (at && Date.now() - at < 5 * 60_000) return true;
    try {
      const r: Array<{ missing: boolean }> = await this.prisma.$queryRaw`
        SELECT EXISTS (SELECT 1 FROM "Document" WHERE "organizationId" = ${organizationId} AND "listIssueDate" IS NULL) AS missing`;
      const ready = r[0]?.missing === false;
      if (ready) this.listKeysReadyAt.set(organizationId, Date.now());
      else this.listKeysReadyAt.delete(organizationId);
      return ready;
    } catch {
      return false; // column not there yet (before the schema push)
    }
  }

  /** An ERP-imported document's stored totals, for the editor's preview / PDF (null otherwise). */
  async erpStoredTotalsForDocument(documentId: string, organizationId: string) {
    const doc = await this.prisma.document.findFirst({ where: { id: documentId, organizationId }, select: { config: true } });
    return erpStoredTotalsOf(doc?.config);
  }

  async repostGlForDocument(
    organizationId: string,
    documentId: string,
    docType: string,
    config: any,
    documentName?: string | null,
    actor?: DocumentActor,
  ): Promise<void> {
    const jeType = DocumentsService.SAVE_GL_TYPES[(docType || '').toUpperCase()];
    if (!jeType) return;
    // ERP-imported history never posts (common/erp-import.ts), even when edited and saved.
    if (isErpImported(config)) return;
    // A voided document has no GL entry (its journals were voided with it).
    if (isDocumentVoided(config)) return;
    try {
      // postInvoicesOnConfirm (WCT group): a draft invoice has no GL entry yet;
      // one left by an earlier save is voided. It posts when it leaves draft.
      if (jeType === 'INVOICE' && (await this.invoicePostingHeldFor(organizationId, documentId))) {
        const stale = await this.journalAutoPost.alreadyPostedForDocument(organizationId, documentId, jeType);
        if (stale) {
          await this.journalService.void(organizationId, stale.id, actor?.id);
          void this.logDocumentEvent({
            documentId,
            organizationId,
            action: 'EDITED',
            detail: `GL entry ${stale.journalNumber} voided: the invoice is a draft (it posts when confirmed or sent)`,
            documentName: documentName ?? undefined,
            actor,
          });
        }
        return;
      }
      const cfg: any = config || {};
      const di: any = cfg.documentInfo || {};
      const items: any[] = cfg.items || [];
      const partyName = cfg?.customer?.name || cfg?.customerName || cfg?.supplier?.name || cfg?.supplierName || null;

      // Same totals precedence as the confirm-time posting paths.
      const explicitNet = parseFloat(cfg?.subTotal ?? di?.subTotal ?? cfg?.summary?.subTotal ?? 'NaN');
      const explicitTax = parseFloat(cfg?.gstAmount ?? di?.gstAmount ?? cfg?.summary?.taxAmount ?? cfg?.tax?.amount ?? 'NaN');
      const explicitGross = parseFloat(cfg?.nettTotal ?? di?.nettTotal ?? cfg?.summary?.grandTotal ?? 'NaN');
      const fallbackNet = items.reduce((sum: number, item: any) => {
        const amt = parseFloat(item.amount) || (parseFloat(item.quantity) * parseFloat(item.unitPrice)) || 0;
        return sum + amt;
      }, 0);
      const org = await this.prisma.organization.findUnique({ where: { id: organizationId }, select: { taxRate: true } });
      const docPct = parseFloat(di?.gstPercent);
      const rate = (Number.isFinite(docPct) ? docPct : (org?.taxRate ?? 0)) / 100;
      const netAmount = !Number.isNaN(explicitNet) ? explicitNet : fallbackNet;
      const taxAmount = !Number.isNaN(explicitTax) ? explicitTax : netAmount * rate;
      const grossAmount = !Number.isNaN(explicitGross) ? explicitGross : netAmount + taxAmount;

      const existing = await this.journalAutoPost.alreadyPostedForDocument(organizationId, documentId, jeType);

      // Nothing postable yet (no items / zero gross) — void any stale entry so
      // the GL never shows amounts the document no longer carries.
      if (!(grossAmount > 0) || items.length === 0) {
        if (existing) {
          await this.journalService.void(organizationId, existing.id, actor?.id);
          void this.logDocumentEvent({
            documentId,
            organizationId,
            action: 'EDITED',
            detail: `GL entry ${existing.journalNumber} voided — document no longer has postable amounts`,
            documentName: documentName ?? undefined,
            actor,
          });
        }
        return;
      }

      if (existing) {
        await this.journalService.void(organizationId, existing.id, actor?.id);
      }

      const entryDate = cfg?.date ? new Date(cfg.date) : new Date();
      let entry: any = null;
      if (jeType === 'INVOICE') {
        // Tax-inclusive docs carry GROSS line amounts — scale to net for the
        // per-line revenue credits (postFromInvoice expects line NET).
        const inclusive = di?.absorbTax === 'Y' || di?.absorbTax === true;
        const factor = inclusive && fallbackNet > 0 ? netAmount / fallbackNet : 1;
        // Header "Accounts to Credit" (HEADER_GL_ACCOUNT_FLAG): the whole net
        // credits that one account; per-line codes are ignored.
        // A service business codes each LINE (LINE_GL_ACCOUNTS_FLAG), so the
        // header box is off there even though the legacy screen is on.
        const headerGl =
          (await isOrgFeatureEnabled(this.prisma as any, organizationId, HEADER_GL_ACCOUNT_FLAG)) &&
          !(await isOrgFeatureEnabled(this.prisma as any, organizationId, LINE_GL_ACCOUNTS_FLAG))
            ? { accountCode: String(cfg?.glAccountCode || '').trim() || null, remarks: String(cfg?.glRemarks || '').trim() || null }
            : null;
        const bySubject = subjectPostingLines(cfg, await loadSubjectAccounts(this.prisma, organizationId), netAmount);
        entry = await this.journalAutoPost.postFromInvoice({
          organizationId,
          documentId,
          invoiceNumber: documentName || cfg?.documentNumber,
          entryDate,
          customerName: partyName,
          netAmount,
          taxAmount,
          grossAmount,
          // WCT (subject-type-account.ts): the Subject's type decides what posts — the whole net on the
          // type's account, or only the priced lines when the subject combines types. It comes BEFORE
          // the header account: WCT also has "Accounts to Credit" on, and a blank one used to send
          // every invoice to the default sales account. Null (no type in the subject) = as before.
          revenueLines: bySubject
            ? bySubject.lines.map((l) => ({ accountCode: l.accountCode, amount: l.lineIndex < 0 ? l.amount : Math.round(l.amount * factor * 100) / 100 }))
            : // A SET header account takes the whole net. A BLANK one does NOT mean
              // "no coding" — it means nothing was chosen up top, so the LINES decide,
              // exactly as the confirm path has always done (guru 2026-11-23: "how come
              // i cant see gl name? i added this last time"). Until now a blank header
              // sent an empty list, so the net fell through to the single default sales
              // account: a soil-disposal invoice whose lines said 202 Transportation of
              // Hardcore posted to 200 Rental of MBR System, and the SAME invoice coded
              // itself differently depending on whether a save or a confirm posted it.
              headerGl?.accountCode
            ? [{ accountCode: headerGl.accountCode, amount: netAmount }]
            : // Split payment part: its net over the ORIGINAL invoice's revenue accounts (invoice-split.ts). Null for every other invoice.
              splitGlRevenueLines(cfg, netAmount) ??
              items.map((it: any) => ({
                accountCode: it.accountCode || it.revenueAccountCode || null,
                amount: Math.round((parseFloat(it.amount) || (parseFloat(it.quantity) * parseFloat(it.unitPrice)) || 0) * factor * 100) / 100,
              })),
          // One subject line: the journal line reads as the subject, not "Sales — <no>".
          glRemarks: (bySubject?.mode === 'subject' ? bySubject.lines[0].description : null) || headerGl?.remarks || null,
          userId: actor?.id,
        });
      } else {
        const baseArgs: any = {
          organizationId,
          documentId,
          documentNumber: documentName || cfg?.documentNumber,
          entryDate,
          netAmount,
          taxAmount,
          grossAmount,
        };
        if (jeType === 'CREDIT_NOTE') {
          if (cfg?.subtype === 'AP') {
            entry = await this.journalAutoPost.postFromPurchaseReturn({ ...baseArgs, supplierName: partyName });
            if (entry) {
              entry = await this.prisma.journalEntry.update({ where: { id: entry.id }, data: { type: 'CREDIT_NOTE' } });
            }
          } else {
            entry = await this.journalAutoPost.postFromCreditNote({ ...baseArgs, customerName: partyName, ...(await this.noteRevenueLines(organizationId, cfg, items, netAmount)) });
          }
        } else if (jeType === 'DEBIT_NOTE') {
          entry = await this.journalAutoPost.postFromDebitNote({ ...baseArgs, customerName: partyName, ...(await this.noteRevenueLines(organizationId, cfg, items, netAmount)) });
        } else if (jeType === 'PURCHASE_ORDER') {
          entry = await this.journalAutoPost.postFromPurchaseOrder({ ...baseArgs, supplierName: partyName });
        } else if (jeType === 'PURCHASE_RETURN') {
          entry = await this.journalAutoPost.postFromPurchaseReturn({ ...baseArgs, supplierName: partyName });
        }
      }

      if (entry) {
        void this.logDocumentEvent({
          documentId,
          organizationId,
          action: 'EDITED',
          detail: existing
            ? `GL updated on save: ${existing.journalNumber} voided, ${entry.journalNumber} posted (gross ${grossAmount.toFixed(2)})`
            : `Posted to GL on save: ${entry.journalNumber} (gross ${grossAmount.toFixed(2)})`,
          documentName: documentName ?? undefined,
          actor,
        });
      }
    } catch (e) {
      console.error('[GL on save] failed for', docType, documentId, e);
    }
  }

  /**
   * Per-line GL accounts for a credit / debit note (guru 2026-11-21: Biofuel, header-GL flag
   * off, "should be able to see the account" on a credit note). The same chain an invoice
   * uses minus the WCT subject and split-payment cases: header "Accounts to Credit" when the
   * org has that flag (blank = default sales account), else each line's accountCode with
   * tax-inclusive lines scaled to net. The posters fall back to the default sales account
   * for anything unmapped, so a note with no codes posts exactly as before.
   */
  private async noteRevenueLines(organizationId: string, cfg: any, items: any[], netAmount: number) {
    const di: any = cfg?.documentInfo || {};
    const fallbackNet = (items || []).reduce((sum: number, item: any) => sum + (parseFloat(item.amount) || parseFloat(item.quantity) * parseFloat(item.unitPrice) || 0), 0);
    const inclusive = di?.absorbTax === 'Y' || di?.absorbTax === true;
    const factor = inclusive && fallbackNet > 0 ? netAmount / fallbackNet : 1;
    const headerGl =
      (await isOrgFeatureEnabled(this.prisma as any, organizationId, HEADER_GL_ACCOUNT_FLAG)) &&
      !(await isOrgFeatureEnabled(this.prisma as any, organizationId, LINE_GL_ACCOUNTS_FLAG));
    const glRemarks = String(cfg?.glRemarks || '').trim() || null;
    if (headerGl) {
      const code = String(cfg?.glAccountCode || '').trim() || null;
      return { revenueLines: code ? [{ accountCode: code, amount: netAmount }] : [], glRemarks };
    }
    return {
      revenueLines: (items || []).map((it: any) => ({
        accountCode: it.accountCode || it.revenueAccountCode || null,
        amount: Math.round((parseFloat(it.amount) || parseFloat(it.quantity) * parseFloat(it.unitPrice) || 0) * factor * 100) / 100,
      })),
      glRemarks,
    };
  }

  /** postInvoicesOnConfirm is on and the invoice is still a draft / unconfirmed. */
  private async invoicePostingHeldFor(organizationId: string, documentId: string): Promise<boolean> {
    if (!(await isOrgFeatureEnabled(this.prisma as any, organizationId, POST_INVOICES_ON_CONFIRM_FLAG))) return false;
    const doc = await this.prisma.document.findFirst({ where: { id: documentId, organizationId }, select: { status: true } });
    return invoicePostingHeld(true, doc?.status as any);
  }

  /**
   * postInvoicesOnConfirm: the invoice just left draft (status change, or
   * emailed to the customer) and has no GL entry yet, so post it now. No-op
   * without the flag, for a non-invoice, a draft, or when an entry exists.
   * Best-effort, like every GL post here.
   */
  async postInvoiceLeavingDraft(organizationId: string, documentId: string, actor?: DocumentActor): Promise<void> {
    try {
      if (!(await isOrgFeatureEnabled(this.prisma as any, organizationId, POST_INVOICES_ON_CONFIRM_FLAG))) return;
      const doc = await this.prisma.document.findFirst({
        where: { id: documentId, organizationId },
        select: { type: true, status: true, name: true, config: true },
      });
      if (!doc || DocumentsService.SAVE_GL_TYPES[(doc.type || '').toUpperCase()] !== 'INVOICE') return;
      if (invoicePostingHeld(true, doc.status as any)) return;
      if (await this.journalAutoPost.alreadyPostedForDocument(organizationId, documentId, 'INVOICE')) return;
      await this.repostGlForDocument(organizationId, documentId, doc.type, doc.config, doc.name, actor);
    } catch (e) {
      console.error('[GL on confirm] failed for invoice', documentId, e);
    }
  }

  async getDocumentHistory(documentId: string, organizationId: string) {
    const doc = await this.prisma.document.findFirst({
      where: { id: documentId, organizationId },
      select: { id: true },
    });
    if (!doc) throw new HttpException('Document not found', HttpStatus.NOT_FOUND);
    return (this.prisma as any).auditLog.findMany({
      where: { resource: 'document', resourceId: documentId, organizationId },
      orderBy: { createdAt: 'desc' },
      take: 200,
      select: { id: true, action: true, userName: true, userEmail: true, details: true, createdAt: true },
    });
  }

  // Called by the editor the moment a user unlocks a CONFIRMED document via
  // the Edit warning dialog — so history shows WHEN the post-confirm editing
  // session started, not just the saves it later produced. Saves during the
  // session then log as EDITED_AFTER_CONFIRM, bracketing the whole session.
  async logEditUnlock(documentId: string, organizationId: string, actor?: DocumentActor) {
    // Managers and up only — same rule as the confirmed-edit save guard.
    if (actor?.id) {
      const { resolveTier } = await import('../common/role-tier');
      const { tier } = await resolveTier(this.prisma, organizationId, actor.id);
      if (tier === 'designer') throw new HttpException('Only managers can edit a confirmed document', HttpStatus.FORBIDDEN);
    }
    const doc = await this.prisma.document.findFirst({
      where: { id: documentId, organizationId },
      select: { id: true, name: true, status: true, config: true },
    });
    if (!doc) throw new HttpException('Document not found', HttpStatus.NOT_FOUND);
    assertRecordUnlocked(doc, 'edited');
    assertNotVoided(doc, 'edited');
    await this.logDocumentEvent({
      documentId,
      organizationId,
      action: 'EDIT_UNLOCKED',
      detail: `Unlocked ${doc.name || 'document'} for editing after confirmation (status: ${doc.status})`,
      documentName: doc.name || undefined,
      actor,
    });
    return { success: true };
  }

  // Per-document Lock / Unlock (common/record-lock.ts). Unlocking needs an accounting
  // admin (the lock-dates adviser rule) so a lock is not undone by the person it stops.
  async setRecordLock(documentId: string, organizationId: string, locked: boolean, actor?: DocumentActor) {
    const doc = await this.prisma.document.findFirst({
      where: { id: documentId, organizationId },
      select: { id: true, name: true, status: true, config: true },
    });
    if (!doc) throw new HttpException('Document not found', HttpStatus.NOT_FOUND);
    const config: any = { ...((doc.config as any) || {}) };
    if (locked === isRecordLocked(config)) return { success: true, recordLocked: locked, recordLockedAt: config.recordLockedAt ?? null, recordLockedBy: config.recordLockedBy ?? null };
    if (!locked && !(await isLockAdviser(this.prisma, organizationId, actor?.id))) {
      throw new HttpException('Only an accounting admin can unlock a locked document', HttpStatus.FORBIDDEN);
    }
    const stamp = actor?.id ? { id: actor.id, name: actor.name || null, email: actor.email || null } : null;
    if (locked) {
      config.recordLocked = true;
      config.recordLockedAt = new Date().toISOString();
      config.recordLockedBy = stamp;
    } else {
      config.recordLocked = false;
      config.recordLockedAt = null;
      config.recordLockedBy = null;
    }
    await this.prisma.document.update({ where: { id: documentId }, data: { config } });
    await this.logDocumentEvent({
      documentId,
      organizationId,
      action: locked ? 'LOCKED' : 'UNLOCKED',
      detail: locked
        ? `Locked ${doc.name || 'document'}: no edits until it is unlocked (status: ${doc.status})`
        : `Unlocked ${doc.name || 'document'}: editing allowed again (status: ${doc.status})`,
      documentName: doc.name || undefined,
      actor,
    });
    return { success: true, recordLocked: locked, recordLockedAt: config.recordLockedAt, recordLockedBy: config.recordLockedBy };
  }

  /**
   * VOID a document (guru 2026-11-20): the Void button on every accounting document and the
   * cascade from a voided journal (journal.service voidByUser). Voids every live journal posted
   * from it, stamps config.voided / voidedAt / voidedBy / voidReason, writes History VOIDED.
   * Refused while money is recorded against it (delete the receipt first). No un-void.
   */
  async voidDocument(documentId: string, organizationId: string, actor?: DocumentActor, reason?: string | null) {
    return voidDocumentCore(this.prisma, {
      organizationId,
      documentId,
      actor,
      reason,
      voidJournal: (journalId) => this.journalService.void(organizationId, journalId, actor?.id),
      log: (detail, documentName) => this.logDocumentEvent({ documentId, organizationId, action: 'VOIDED', detail, documentName, actor }),
    });
  }

  async addDocumentNote(documentId: string, organizationId: string, actor: DocumentActor, text: string) {
    const doc = await this.prisma.document.findFirst({
      where: { id: documentId, organizationId },
      select: { id: true, name: true },
    });
    if (!doc) throw new HttpException('Document not found', HttpStatus.NOT_FOUND);
    const trimmed = (text || '').trim();
    if (!trimmed) throw new HttpException('Note text is required', HttpStatus.BAD_REQUEST);
    await this.logDocumentEvent({
      documentId,
      organizationId,
      action: 'NOTE',
      detail: trimmed,
      documentName: doc.name,
      actor,
    });
    return { success: true };
  }

  // ── Attachments (global, every document type — guru 2026-09-09) ─────────
  // Same shape and contract as bills' Source Documents: metadata rows on the
  // Document.attachments Json column, files themselves in S3. Every add and
  // remove is stamped into the document's History & notes.
  async getAttachments(documentId: string, organizationId: string) {
    const doc = await this.prisma.document.findFirst({
      where: { id: documentId, organizationId },
      select: { attachments: true },
    });
    if (!doc) throw new HttpException('Document not found', HttpStatus.NOT_FOUND);
    return (doc.attachments as any[]) || [];
  }

  async addAttachments(
    documentId: string,
    organizationId: string,
    files: Array<{ fileKey: string; fileName: string; mimeType?: string; label?: string }>,
    actor: DocumentActor,
  ) {
    const doc = await this.prisma.document.findFirst({
      where: { id: documentId, organizationId },
      select: { id: true, name: true, attachments: true },
    });
    if (!doc) throw new HttpException('Document not found', HttpStatus.NOT_FOUND);
    const existing = (doc.attachments as any[]) || [];
    const existingKeys = new Set(existing.map((a) => a.fileKey));
    const stamped = (files || [])
      .filter((f) => f?.fileKey && !existingKeys.has(f.fileKey))
      .map((f) => ({ ...f, uploadedAt: new Date().toISOString(), uploadedBy: actor?.id || 'unknown' }));
    if (stamped.length === 0) return existing;
    const next = [...existing, ...stamped];
    await this.prisma.document.update({ where: { id: documentId }, data: { attachments: next as any } });
    void this.logDocumentEvent({
      documentId,
      organizationId,
      action: 'EDITED',
      detail: `Attachment${stamped.length === 1 ? '' : 's'} added: ${stamped.map((f) => f.fileName).join(', ')}`,
      documentName: doc.name,
      actor,
    });
    return next;
  }

  async removeAttachment(documentId: string, organizationId: string, fileKey: string, actor: DocumentActor) {
    if (!fileKey) throw new HttpException('fileKey is required', HttpStatus.BAD_REQUEST);
    const doc = await this.prisma.document.findFirst({
      where: { id: documentId, organizationId },
      select: { id: true, name: true, attachments: true },
    });
    if (!doc) throw new HttpException('Document not found', HttpStatus.NOT_FOUND);
    const existing = (doc.attachments as any[]) || [];
    const removed = existing.find((a) => a.fileKey === fileKey);
    if (!removed) return existing;
    const next = existing.filter((a) => a.fileKey !== fileKey);
    await this.prisma.document.update({ where: { id: documentId }, data: { attachments: next as any } });
    void this.logDocumentEvent({
      documentId,
      organizationId,
      action: 'EDITED',
      detail: `Attachment removed: ${removed.fileName || fileKey}`,
      documentName: doc.name,
      actor,
    });
    return next;
  }

  /**
   * Sync DocumentItem junction table for efficient item queries.
   * This is called after document create/update to keep the junction table in sync.
   */
  private async syncDocumentItems(documentId: string, config: any, organizationId: string) {
    try {
      const rawItems = config?.items;
      // An absent/malformed items[] is treated as "no desired rows" and routed
      // through the SAME reconciliation below (desired = []), so in-flight rows
      // are still protected — strictly safer than the old delete-everything.
      const items: any[] = Array.isArray(rawItems) ? rawItems : [];

      // Resolve an item's type once, cached for duplicate SKUs. Inventory is
      // checked first, then Asset — mirrors the legacy behavior. Returns null
      // for ids present in neither table (skipped, exactly as before).
      const typeCache = new Map<string, ItemType | null>();
      const resolveType = async (itemId: string): Promise<ItemType | null> => {
        if (typeCache.has(itemId)) return typeCache.get(itemId)!;
        let resolved: ItemType | null = null;
        const inv = await this.prisma.inventory.findUnique({ where: { id: itemId } });
        if (inv) {
          resolved = ItemType.INVENTORY;
        } else {
          const asset = await this.prisma.asset.findUnique({ where: { id: itemId } });
          if (asset) resolved = ItemType.ASSET;
        }
        typeCache.set(itemId, resolved);
        return resolved;
      };

      // Build the DESIRED row set from config.items[]. config.items is the
      // source of truth for the renderer / Xero / totals and is NEVER touched
      // here — we only reconcile the DocumentItem TABLE against it. Each desired
      // row carries its positional lineNumber (1-based) + resolved itemType and
      // inventory/asset FK backfill.
      type Desired = {
        itemId: string;
        itemType: ItemType;
        inventoryId: string | null;
        assetId: string | null;
        lineNumber: number;
        content: {
          sku: string | null;
          description: string | null;
          quantity: number;
          unitPrice: number;
          discount: number;
          amount: number;
          uom: string | null;
          isService: boolean;
          isFixedAsset: boolean;
        };
      };
      const desired: Desired[] = [];
      for (let i = 0; i < items.length; i++) {
        const item = items[i];
        const itemId = item.inventoryItemId || item.assetId;
        if (!itemId) continue; // Skip items without an ID (e.g. service lines)
        const itemType = await resolveType(itemId);
        if (!itemType) {
          console.warn(`DocumentItem sync: Item ${itemId} not found in Inventory or Asset table, skipping`);
          continue;
        }
        desired.push({
          itemId,
          itemType,
          // Backfill the typed FK from itemId + itemType (the new Phase 1
          // columns); itemId/itemType themselves are still written for the
          // ~15 back-compat readers.
          inventoryId: itemType === ItemType.INVENTORY ? itemId : null,
          assetId: itemType === ItemType.ASSET ? itemId : null,
          lineNumber: i + 1,
          content: {
            sku: item.sku || item.skuKey || null,
            description: item.description || null,
            quantity: parseFloat(item.quantity) || 0,
            unitPrice: parseFloat(item.unitPrice) || 0,
            discount: parseFloat(item.discount) || 0,
            amount: parseFloat(item.amount) || 0,
            uom: item.uom || null,
            isService: !!item.isService,
            isFixedAsset: !!item.isFixedAsset,
          },
        });
      }

      const existing = await this.prisma.documentItem.findMany({
        where: { documentId },
      });

      // ── Pairing (preserving reconciliation) ──────────────────────────────
      // Match desired ↔ existing by itemId ONLY — never by lineNumber, which is
      // positional and shifts on reorder (matching on it would reset delivery
      // state every time a line moves).
      //
      // Duplicate-SKU tiebreak: when one itemId has multiple existing and/or
      // multiple desired rows, pair them deterministically —
      //   • existing rows sorted MOST-ADVANCED first
      //     (completed > not_installed > delivering > not_delivered),
      //     tie-broken by lineNumber asc;
      //   • desired rows taken in document order (lineNumber asc);
      //   • zip the two: the first min(E,D) pair up.
      // This keeps delivery progress on the already-advanced rows; any surplus
      // existing rows (the least-advanced, hence most likely not_delivered) fall
      // into the "removed" bucket — so dropping one of N duplicate lines retires
      // a not-yet-delivered copy rather than an in-flight one.
      const RANK: Record<string, number> = {
        not_delivered: 0,
        delivering: 1,
        not_installed: 2,
        completed: 3,
      };
      const existingByItem = new Map<string, typeof existing>();
      for (const row of existing) {
        const arr = existingByItem.get(row.itemId) || [];
        arr.push(row);
        existingByItem.set(row.itemId, arr);
      }
      for (const arr of existingByItem.values()) {
        arr.sort((a, b) => {
          const rb = RANK[b.deliveryStatus] ?? 0;
          const ra = RANK[a.deliveryStatus] ?? 0;
          if (rb !== ra) return rb - ra; // most-advanced first
          return (a.lineNumber ?? 0) - (b.lineNumber ?? 0);
        });
      }
      const desiredByItem = new Map<string, Desired[]>();
      for (const d of desired) {
        const arr = desiredByItem.get(d.itemId) || [];
        arr.push(d);
        desiredByItem.set(d.itemId, arr);
      }

      const matched: Array<{ id: string; desired: Desired }> = [];
      const toCreate: Desired[] = [];
      const removed: typeof existing = [];
      const allItemIds = new Set<string>([...existingByItem.keys(), ...desiredByItem.keys()]);
      for (const itemId of allItemIds) {
        const ex = existingByItem.get(itemId) || [];
        const de = desiredByItem.get(itemId) || [];
        const pairCount = Math.min(ex.length, de.length);
        for (let k = 0; k < pairCount; k++) matched.push({ id: ex[k].id, desired: de[k] });
        for (let k = pairCount; k < de.length; k++) toCreate.push(de[k]);
        for (let k = pairCount; k < ex.length; k++) removed.push(ex[k]);
      }

      // ── Apply ────────────────────────────────────────────────────────────
      // Park every surviving row's lineNumber to null FIRST so reassigning
      // positions (including same-itemId swaps) can never trip the
      // @@unique([documentId, itemId, lineNumber]) constraint mid-flight —
      // NULLs are distinct under a Postgres unique index.
      if (existing.length > 0) {
        await this.prisma.documentItem.updateMany({
          where: { documentId },
          data: { lineNumber: null },
        });
      }

      // Removed rows: delete ONLY if still not_delivered. In-flight rows
      // (delivering / not_installed / completed) are KEPT — a document edit must
      // not silently destroy delivery progress — and a warning is logged. (Their
      // lineNumber stays null: they no longer have a position in config.items.)
      const removedNotDelivered = removed.filter((r) => r.deliveryStatus === 'not_delivered');
      const removedInFlight = removed.filter((r) => r.deliveryStatus !== 'not_delivered');
      if (removedNotDelivered.length > 0) {
        await this.prisma.documentItem.deleteMany({
          where: { id: { in: removedNotDelivered.map((r) => r.id) } },
        });
      }
      for (const r of removedInFlight) {
        console.warn(
          `DocumentItem sync: item ${r.itemId} (status=${r.deliveryStatus}) was removed from document ${documentId}'s config but is in-flight — keeping the row instead of deleting.`,
        );
      }

      // Matched rows: UPDATE content + lineNumber + FK backfill, and PRESERVE
      // every delivery column (deliveryStatus, deductedAt, deliveringAt,
      // deliveredAt, completedAt, installSkipped) by OMITTING them from the
      // update payload.
      for (const m of matched) {
        const d = m.desired;
        await this.prisma.documentItem.update({
          where: { id: m.id },
          data: {
            itemId: d.itemId,
            itemType: d.itemType,
            inventoryId: d.inventoryId,
            assetId: d.assetId,
            lineNumber: d.lineNumber,
            ...d.content,
          },
        });
      }

      // New rows: CREATE with the default deliveryStatus = not_delivered
      // (omitted ⇒ DB default) and installSkipped = false.
      if (toCreate.length > 0) {
        await this.prisma.documentItem.createMany({
          data: toCreate.map((d) => ({
            documentId,
            itemId: d.itemId,
            itemType: d.itemType,
            inventoryId: d.inventoryId,
            assetId: d.assetId,
            lineNumber: d.lineNumber,
            ...d.content,
          })),
          skipDuplicates: true,
        });
      }

      console.log(
        `📋 DocumentItem sync (preserving): doc ${documentId} — ${matched.length} updated, ${toCreate.length} created, ${removedNotDelivered.length} removed, ${removedInFlight.length} in-flight kept`,
      );
    } catch (error) {
      console.error('Failed to sync DocumentItems:', error);
      // Don't throw - this is a background sync operation
    }
  }

  /**
   * WCT (enableWctOrders, 2026-11-03): the order each quotation became, by
   * quotation id, for the quotation banner and the quotations list. Empty for
   * every other org and for non-quotation rows (one batched read).
   */
  private async quotationOrders(organizationId: string, docs: Array<{ id: string; type?: string | null }>): Promise<Map<string, { id: string; orderNumber: string; createdAt: string }>> {
    const ids = docs.filter((d) => ['QUOTATION', 'QO', 'QO1', 'QO2', 'QT'].includes(String(d.type ?? ''))).map((d) => d.id);
    if (!ids.length || !(await isOrgFeatureEnabled(this.prisma, organizationId, 'enableWctOrders'))) return new Map();
    const orders = await this.prisma.order.findMany({
      where: { organizationId, sourceQuotationId: { in: ids } },
      orderBy: { createdAt: 'asc' },
      select: { id: true, orderNumber: true, sourceQuotationId: true, linkedDocuments: true, createdAt: true },
    });
    // Imported orders (imported-orders.ts) show on their quotation only while the setting is on.
    const showImported = orders.some((o) => isImportedOrder(o)) && (await isImportedOrdersEnabled(this.prisma, organizationId));
    // createdAt: the quotation page says "Order … created" only right after the confirm that made it (2026-11-23).
    const out = new Map<string, { id: string; orderNumber: string; createdAt: string }>();
    for (const o of orders.filter((x) => showImported || !isImportedOrder(x))) if (o.sourceQuotationId && !out.has(o.sourceQuotationId)) out.set(o.sourceQuotationId, { id: o.id, orderNumber: o.orderNumber, createdAt: o.createdAt.toISOString() });
    return out;
  }

  async getById(id: string, organizationId: string) {
    try {
      const document = await this.prisma.document.findFirst({
        where: {
          id,
          organizationId,
          // Soft-deleted drafts (enableSoftDeleteDrafts) are gone for the app; the row only keeps the number.
          NOT: { type: SOFT_DELETED_TYPE },
        },
        include: {
          organization: true,
          baseDocument: true,
          revisions: true,
          // Field-tech delivery reports linked to this document. CleanDocumentPreview
          // renders these into a "Proof of Delivery" section at the bottom of the
          // DO print/preview + pulls the ack/install customer signatures. Restricted
          // to the DO_* proof kinds so unrelated service reports never leak into
          // print output, even if some future flow sets documentId on a kind=SERVICE
          // row. DO_INSTALL included so installation photos + the installation
          // signature render (the preview already handles them).
          maintenanceReports: {
            where: { kind: { in: ['DO_START', 'DO_ACK', 'DO_INSTALL'] } },
            orderBy: { createdAt: 'asc' },
            select: {
              id: true,
              kind: true,
              photos: true,
              signature: true,
              signedByName: true,
              signedAt: true,
              technicianName: true,
              createdAt: true,
              // assetId/inventoryId identify which unit each proof block is for,
              // so the preview can label each photo set (a multi-unit run shows
              // several sets). Names are resolved just below into subjectAsset/Sku.
              assetId: true,
              inventoryId: true,
              // Exact line the proof belongs to — lets the template render photos
              // inline under each item, including free-typed lines that assetId/
              // inventoryId cannot disambiguate. Null for run-level proof.
              deliveryItemId: true,
              // description: the free-typed line's own text ("Delivery started:
              // <text>"), used as the last-resort per-line match for old rows.
              description: true,
              // pingCount: whether this DO_START has a GPS route to link to (the
              // Timeline shows a Route link only when there are pings).
              _count: { select: { locationPings: true } },
              // serviceData carries signedDateText — the date the SIGNER TYPED,
              // which can legitimately differ from signedAt (the moment of
              // capture). Narrowed to that one key below; the rest of the blob
              // (photo angles, and for a guest signature the IP + user agent)
              // never leaves this method.
              serviceData: true,
            },
          },
        },
      });

      if (!document) return document;

      // Resolve each proof MSR's subject (the asset name + unit sku) so the DO
      // preview can print a bold label above each photo set. MSR carries plain
      // assetId/inventoryId (no relations), so batch-resolve: units give the sku
      // AND the assetId when the MSR's own assetId is null; assets give the name.
      // Asset-less proof (run-level DO_INSTALL, free-typed line) resolves to null
      // and the preview simply omits the label.
      const proofReports: any[] = (document as any).maintenanceReports ?? [];
      if (proofReports.length) {
        const invIds = [...new Set(proofReports.map((r) => r.inventoryId).filter(Boolean))] as string[];
        const units = invIds.length
          ? await this.prisma.inventory.findMany({ where: { id: { in: invIds } }, select: { id: true, sku: true, assetId: true } })
          : [];
        const unitById = new Map(units.map((u) => [u.id, u]));
        const assetIds = [
          ...new Set([
            ...proofReports.map((r) => r.assetId).filter(Boolean),
            ...units.map((u) => u.assetId).filter(Boolean),
          ]),
        ] as string[];
        const assets = assetIds.length
          ? await this.prisma.asset.findMany({ where: { id: { in: assetIds } }, select: { id: true, name: true } })
          : [];
        const assetNameById = new Map(assets.map((a) => [a.id, a.name]));
        for (const r of proofReports) {
          const unit = r.inventoryId ? unitById.get(r.inventoryId) : null;
          const assetId = r.assetId ?? unit?.assetId ?? null;
          r.subjectAsset = assetId ? assetNameById.get(assetId) ?? null : null;
          r.subjectSku = unit?.sku ?? null;
          // Whether this DO_START has a GPS route (the Timeline links to it only
          // when pings were recorded). _count comes from the select above.
          r.pingCount = (r as any)._count?.locationPings ?? 0;
          // Narrow serviceData to the single render-relevant key, then drop it.
          // Provenance recorded at signing (IP, user agent) is for a dispute, not
          // for a template, and must not reach any client.
          const sd = (r as any).serviceData;
          r.signedDateText = sd && typeof sd === 'object' ? (sd as any).signedDateText ?? null : null;
          delete (r as any).serviceData;
        }
        // subjectLabel: a display-only name for what the proof row covers, used
        // to title a sign-off's RECEIVED BY box on a DO signed more than once
        // (2026-09 partial sign-off). Unit -> "Asset, S/No SKU". Free-typed line
        // -> the DO line's own description (matched by deliveryItemId), else the
        // report's "Delivered/Delivery acknowledged: <text>" description. Plain
        // text only; no ids ride on it, so the public view can pass it through.
        const cfgLines: any[] = Array.isArray((document as any).config?.items) ? (document as any).config.items : [];
        const plain = (v: any) =>
          String(v ?? '')
            .replace(/<[^>]*>/g, ' ')
            .replace(/&nbsp;/g, ' ')
            .replace(/&amp;/g, '&')
            .split(/\n/)[0]
            .replace(/\s+/g, ' ')
            .trim();
        for (const r of proofReports) {
          if (r.subjectAsset) {
            r.subjectLabel = r.subjectSku ? `${r.subjectAsset}, S/No ${r.subjectSku}` : r.subjectAsset;
            continue;
          }
          const line = r.deliveryItemId ? cfgLines.find((l) => l?.deliveryItemId === r.deliveryItemId) : null;
          const fromLine = line ? plain(line.description) : '';
          const fromReport = plain(String(r.description ?? '').replace(/^(delivery acknowledged|delivered|delivery started|installed)[^:]*:\s*/i, ''));
          r.subjectLabel = fromLine || fromReport || null;
        }
      }

      // Group DO_START proof photos onto each config line so the DO preview
      // renders them inline and does NO matching itself. Match order (never
      // guess): 1) line.deliveryItemId === MSR.deliveryItemId (exact, new mints);
      // 2) line.inventoryItemId === MSR.inventoryId (exact, unit lines);
      // 2b) line.serialNumbers contains MSR.subjectSku (older unit lines with no
      // inventoryItemId), only when unambiguous; 3) line description === MSR
      // description (fallback, old free-typed), only when unambiguous. Each MSR is
      // attached to at most one line. DO_START only (DO_ACK/DO_INSTALL carry no
      // per-line condition photos). For an RDO these are the return DO_START
      // returning-condition photos; the outbound reference is never fetched here.
      try {
        const cfg: any = (document as any).config ?? {};
        const lines: any[] = Array.isArray(cfg.items) ? cfg.items : [];
        if (lines.length && proofReports.length) {
          const starts = proofReports.filter((r) => r.kind === 'DO_START' && (r.photos?.length ?? 0) > 0);
          const norm = (s: any) => String(s ?? '').trim().toLowerCase();
          // A free-typed MSR description is "Delivery started: <text>" / "Return
          // started: <text>"; strip the known prefix before comparing.
          const lineText = (r: any) => norm(String(r.description ?? '').replace(/^(delivery|return) started:\s*/i, ''));
          const used = new Set<string>();
          const findFor = (line: any): any | null => {
            if (line.deliveryItemId) {
              const m = starts.find((r) => !used.has(r.id) && r.deliveryItemId && r.deliveryItemId === line.deliveryItemId);
              if (m) return m;
            }
            if (line.inventoryItemId) {
              const m = starts.find((r) => !used.has(r.id) && r.inventoryId && r.inventoryId === line.inventoryItemId);
              if (m) return m;
            }
            const serials: string[] = Array.isArray(line.serialNumbers) ? line.serialNumbers.map(norm).filter(Boolean) : [];
            if (serials.length) {
              const ms = starts.filter((r) => !used.has(r.id) && r.subjectSku && serials.includes(norm(r.subjectSku)));
              if (ms.length === 1) return ms[0];
            }
            const d = norm(line.description);
            if (d) {
              const ms = starts.filter((r) => !used.has(r.id) && !r.inventoryId && lineText(r) === d);
              if (ms.length === 1) return ms[0];
            }
            return null;
          };
          for (const line of lines) {
            const m = findFor(line);
            // proofSerial (additive): the matched report's unit serial, so a
            // grouped line can name the unit even when the line itself carries
            // no serialNumbers.
            if (m) { line.proofPhotos = m.photos ?? []; line.proofSerial = m.subjectSku ?? null; used.add(m.id); }
          }
          (document as any).config = cfg;
        }
      } catch (err: any) {
        console.warn(`getById: proof photo grouping failed for ${document.id}: ${err?.message ?? err}`);
      }

      // Per-line delivery state (2026-09 partial sign-off): each line born from a
      // run item carries that item's LIVE deliveryStatus as lineDeliveryStatus, so
      // the DO can mark lines not yet signed for as "Pending". Read-time only and
      // recomputed on every read; a line whose item no longer exists loses the
      // key, so a value that an editor save wrote back can never go stale.
      try {
        const cfg: any = (document as any).config ?? {};
        const lines: any[] = Array.isArray(cfg.items) ? cfg.items : [];
        const itemIds = [...new Set(lines.map((l) => l?.deliveryItemId).filter(Boolean))] as string[];
        if (itemIds.length) {
          const rows = await this.prisma.deliveryItem.findMany({
            where: { id: { in: itemIds } },
            select: { id: true, deliveryStatus: true },
          });
          const statusById = new Map(rows.map((r) => [r.id, r.deliveryStatus]));
          for (const line of lines) {
            if (!line?.deliveryItemId) continue;
            const st = statusById.get(line.deliveryItemId);
            if (st) line.lineDeliveryStatus = st;
            else delete line.lineDeliveryStatus;
          }
          (document as any).config = cfg;
        }
      } catch (err: any) {
        console.warn(`getById: line delivery status failed for ${document.id}: ${err?.message ?? err}`);
      }

      // Timeline: the scheduled date/time lives on the Delivery RUN, not the DO
      // config. Resolve the run born-linked to this DO (via DeliveryItem.documentId)
      // and expose its scheduledFor INSIDE config, so it rides the config spread
      // to the preview (transformBackendDataForForm) with no per-page plumbing.
      // Best-effort; null when there is no run.
      try {
        const linkItem = await this.prisma.deliveryItem.findFirst({
          where: { documentId: document.id },
          select: { delivery: { select: { scheduledFor: true, completedAt: true } } },
        });
        const scheduledFor = linkItem?.delivery?.scheduledFor ?? null;
        const cfg2: any = (document as any).config ?? {};
        cfg2.scheduledFor = scheduledFor;
        // The timeline's "Delivery Ended" is the run's completion, not a proof
        // row written later (a link signature, a repaired row). Null until done.
        cfg2.runCompletedAt = linkItem?.delivery?.completedAt ?? null;
        (document as any).config = cfg2;
      } catch {
        /* non-fatal */
      }

      // Project name for the DO header. The DO project picker saves ONLY the
      // relation (Document.projectId); the Biofuel DO header renders a project
      // NAME (data.projectName), and nothing bridged the two — so a linked
      // project never showed. Resolve the name from the relation and fold it
      // into config so it rides the config spread to the preview, without
      // touching the picker or save path. DO/RDO only (no other layout reads
      // this, and generic DO deliberately renders no project row). Read-derived
      // each load, so a renamed project always shows fresh. Best-effort.
      try {
        const doTypes = ['DO', 'DELIVERY_ORDER', 'RDO', 'RETURN_DELIVERY_ORDER'];
        if (document.projectId && doTypes.includes((document as any).type)) {
          const project = await this.prisma.project.findUnique({
            where: { id: document.projectId },
            select: { name: true },
          });
          if (project?.name) {
            const cfg3: any = (document as any).config ?? {};
            cfg3.projectName = project.name;
            (document as any).config = cfg3;
          }
        }
      } catch {
        /* non-fatal */
      }

      // Fold the template + its field definitions into this response so opening a
      // document is ONE round-trip instead of three (was: GET doc → GET template →
      // GET template/fields). Resolved in-region here; the two extra client fetches
      // are eliminated. Best-effort: if the template can't be resolved in this org,
      // omit the bundle and the client falls back to its legacy per-request path.
      let templateBundle: Awaited<ReturnType<DocumentTemplatesService['getTemplateBundle']>> = null;
      if (document.documentTemplateId) {
        try {
          templateBundle = await this.documentTemplatesService.getTemplateBundle(document.documentTemplateId, organizationId);
        } catch (error) {
          console.warn(`getById: could not resolve template bundle for ${document.documentTemplateId}: ${error?.message ?? error}`);
        }
      }

      return {
        ...document,
        template: templateBundle?.template ?? null,
        fieldDefinitions: templateBundle?.fieldDefinitions ?? null,
        // WCT (enableWctOrders, 2026-11-03): the order this quotation became, for the
        // "Order ORD… created" banner. Absent for every other org / document.
        ...(await this.quotationOrders(organizationId, [document]).then((m) => (m.has(document.id) ? { linkedOrder: m.get(document.id) } : {}))),
        // enableRdoFreeTypedRows (Biofuel): a signed RDO opens read-only. Absent otherwise.
        ...(isRdoType(document.type) &&
        (await isOrgFeatureEnabled(this.prisma, organizationId, RDO_FREE_ROWS_FLAG)) &&
        (await isRdoSigned(this.prisma as any, organizationId, document.id))
          ? { rdoSigned: true }
          : {}),
      };
    } catch (error) {
      throw new HttpException(`Fetch by ID failed: ${error.message}`, HttpStatus.INTERNAL_SERVER_ERROR);
    }
  }

  async getByInventory(inventoryId: string, organizationId: string) {
    try {
      // Use DocumentItem junction table for efficient query (O(log n) with index)
      const documentItems = await this.prisma.documentItem.findMany({
        where: {
          itemId: inventoryId,
          document: {
            organizationId,
          },
        },
        include: {
          document: true,
        },
        orderBy: {
          document: {
            createdAt: 'desc',
          },
        },
      });

      // Return unique documents
      const documentMap = new Map();
      for (const item of documentItems) {
        if (!documentMap.has(item.document.id)) {
          documentMap.set(item.document.id, item.document);
        }
      }
      return Array.from(documentMap.values());
    } catch (error) {
      throw new HttpException(`Fetch by inventory failed: ${error.message}`, HttpStatus.INTERNAL_SERVER_ERROR);
    }
  }

  // --- Concurrent-edit lock (presence + takeover) ----------------------------
  // A holder is considered idle (and thus take-over-able) once they haven't made
  // a real content edit for this long. Presence heartbeats refresh editingAt but
  // NOT lastActivityAt, so a tab left open still goes idle.
  private static readonly LOCK_IDLE_MS = 5 * 60 * 1000; // 5 minutes

  private buildLockState(doc: any, viewerUserId: string) {
    const holder = doc?.editingByUserId || null;
    const heldByMe = !!holder && holder === viewerUserId;
    // Idle is measured from the last REAL edit. Fall back to the presence
    // heartbeat (editingAt) when lastActivityAt is missing, so a just-opened doc
    // (which has a fresh editingAt but no edits yet) is never instantly
    // take-over-able. Only a genuinely held doc with NO timestamps at all is
    // treated as idle.
    const activityTs = doc?.lastActivityAt ?? doc?.editingAt ?? null;
    const lastActivity = activityTs ? new Date(activityTs).getTime() : 0;
    const idleMs = lastActivity ? Date.now() - lastActivity : Number.POSITIVE_INFINITY;
    const isIdle = !holder || idleMs >= DocumentsService.LOCK_IDLE_MS;
    return {
      editingByUserId: holder,
      editingByName: doc?.editingByName || null,
      editingAt: doc?.editingAt || null,
      lastActivityAt: doc?.lastActivityAt || null,
      version: doc?.version ?? 0,
      heldByMe,
      // Someone else is actively editing → the opener should go read-only.
      lockedByOther: !!holder && !heldByMe && !isIdle,
      // Take over is offered ONLY once the holder has been idle (no real edit /
      // save) for >5 min — an actively-working holder is never taken over. A
      // stale lock self-resolves: it goes idle after 5 min and becomes
      // take-over-able, so nobody is permanently dead-ended in read-only.
      canTakeOver: !!holder && !heldByMe && isIdle,
    };
  }

  // Claim/refresh the lock when opening the editor. Claims when the doc is free,
  // already ours, or the holder is idle (>5 min). Never wrests an active editor —
  // an explicit takeover still requires the holder to be idle.
  async acquireDocumentLock(
    id: string,
    organizationId: string,
    userId: string,
    userName: string,
    takeover: boolean,
  ) {
    const doc = await this.prisma.document.findUnique({ where: { id, organizationId } });
    if (!doc) throw new HttpException('Document not found', HttpStatus.NOT_FOUND);
    const state = this.buildLockState(doc, userId);
    // Claim silently only when the doc is free or already ours. An idle holder
    // is NOT auto-grabbed — the opener gets read-only + a "Take over" affordance
    // and must pass takeover=true to claim. An actively-editing holder can never
    // be taken over.
    const canClaim = !state.editingByUserId || state.heldByMe || (takeover && state.canTakeOver);
    if (!canClaim) {
      // Either someone is actively editing (read-only), or it's idle and the
      // opener hasn't asked to take over yet (read-only + canTakeOver).
      return { acquired: false, ...state };
    }
    const now = new Date();
    const updated = await this.prisma.document.update({
      where: { id, organizationId },
      data: {
        editingByUserId: userId,
        editingByName: userName,
        editingAt: now,
        // Reset the idle clock on (re)acquire/takeover so a freshly opened doc
        // isn't instantly take-over-able and a takeover starts a clean window.
        lastActivityAt: now,
      } as any,
    });
    return { acquired: true, ...this.buildLockState(updated, userId) };
  }

  // Heartbeat while the editor is open. edited=true bumps the idle clock; a bare
  // ping only refreshes presence. The lock is self-healing: lostLock is reported
  // ONLY when ANOTHER user now holds it (a genuine takeover). If the lock was
  // found free (lapsed/released transiently — e.g. a stray cleanup or HMR remount
  // in dev), the holder simply re-claims it, so a hiccup never kicks the active
  // editor to read-only.
  async heartbeatDocumentLock(
    id: string,
    organizationId: string,
    userId: string,
    userName: string,
    edited: boolean,
  ) {
    const doc = await this.prisma.document.findUnique({ where: { id, organizationId } });
    if (!doc) throw new HttpException('Document not found', HttpStatus.NOT_FOUND);
    const holder = (doc as any).editingByUserId;
    if (holder && holder !== userId) {
      return { ok: false, lostLock: true, ...this.buildLockState(doc, userId) };
    }
    const reclaiming = !holder; // lock was free → re-assert this editor's hold
    const now = new Date();
    const updated = await this.prisma.document.update({
      where: { id, organizationId },
      data: {
        editingByUserId: userId,
        editingByName: userName || (doc as any).editingByName || 'Someone',
        editingAt: now,
        ...(edited || reclaiming ? { lastActivityAt: now } : {}),
      } as any,
    });
    return { ok: true, lostLock: false, ...this.buildLockState(updated, userId) };
  }

  // Release on close/save. No-op if the caller isn't the current holder.
  async releaseDocumentLock(id: string, organizationId: string, userId: string) {
    const doc = await this.prisma.document.findUnique({ where: { id, organizationId } });
    if (!doc) return { released: false };
    if ((doc as any).editingByUserId && (doc as any).editingByUserId !== userId) {
      return { released: false }; // someone else holds it now — leave it intact
    }
    await this.prisma.document.update({
      where: { id, organizationId },
      data: { editingByUserId: null, editingByName: null, editingAt: null, lastActivityAt: null } as any,
    });
    return { released: true };
  }

  async updateDocument(dto: UpdateDocumentDto, organizationId: string, actor?: DocumentActor, opts: { officeEdit?: boolean } = {}) {
    try {
      const configAsPlainObject: any = dto.config ? dto.config : null;
      const id: any = dto.id ? dto.id : null;

      // Check if document exists and its current status
      const existingDocument = await this.prisma.document.findUnique({
        where: {
          id,
          organizationId
        },
      });

      if (!existingDocument) {
        throw new HttpException('Document not found', HttpStatus.NOT_FOUND);
      }
      // An imported (old-ERP) DO is read-only (common/erp-import.ts): no save, no status change.
      assertNotErpImportedDo(existingDocument);

      // Lock dates (common/period-lock.ts): a financial document dated inside the
      // locked period is refused on its own date, and on the date it is being moved to.
      // Per-document Lock (common/record-lock.ts): nothing changes on a locked record.
      assertRecordUnlocked(existingDocument);
      assertNotVoided(existingDocument);
      carryRecordLock(existingDocument.config, configAsPlainObject);
      // Office edits on confirmed / delivered / signed DOs (enableOfficeDoEdits,
      // office-do-edit.ts): a paper edit. Status, DO number and signature keys stay
      // as stored; the stock / assignment / ad-hoc blocks below are skipped.
      const officeDoEdit =
        isOfficeDoEdit(existingDocument.type, existingDocument.status, true, opts.officeEdit === true) &&
        (await isOrgFeatureEnabled(this.prisma, organizationId, OFFICE_DO_EDITS_FLAG));
      // A delivered / signed DO: Admin role only (Biofuel 2026-11-23). Manager,
      // field-tech and normal_user may still edit a confirmed DO not yet delivered.
      if (officeDoEdit && (await deliveryDocLockReason(this.prisma as any, organizationId, existingDocument)) && !(await hasAdminRole(this.prisma as any, organizationId, actor?.id))) {
        throw new HttpException('Only an Admin can edit a delivered or signed DO', HttpStatus.FORBIDDEN);
      }
      const officeDoBefore = officeDoEdit ? JSON.parse(JSON.stringify(existingDocument.config ?? {})) : null;
      if (officeDoEdit) pinOfficeDoEdit(existingDocument as any, dto as any);
      if (isPeriodLockedDocType(existingDocument.type)) {
        const lockWhat = existingDocument.name || 'This document';
        await assertPeriodOpen(this.prisma, { organizationId, date: documentDay(existingDocument.config, existingDocument.createdAt), actorId: actor?.id, what: lockWhat });
        const movedTo = documentDay(configAsPlainObject, null);
        if (movedTo) await assertPeriodOpen(this.prisma, { organizationId, date: movedTo, actorId: actor?.id, what: lockWhat, verb: 'dated there' });
      }

      // Confirmed documents ARE editable (guru 2026-09-09) — the editor gates
      // this behind an explicit "Edit" unlock with a warning, and every such
      // save is stamped in the document history as EDITED_AFTER_CONFIRM with
      // the actor, so the person who re-edited a confirmed document is always
      // traceable. (The old behavior threw "Cannot edit confirmed document".)
      // Server-owned DO keys (enableRealDoOnSchedule): the editor rebuilds config
      // from its own field list and would drop them on every save, which would
      // let a cancelled DO lose its Cancelled mark. Carry them over unless the
      // incoming config sets them itself.
      if (configAsPlainObject && existingDocument.type === 'DELIVERY_ORDER') carryServerDoKeys(existingDocument.config, configAsPlainObject);
      if (configAsPlainObject && existingDocument.type === 'INVOICE') carryServerInvoiceKeys(existingDocument.config, configAsPlainObject);
      // Orders list "+" Quotation (round 38, WCT orders): a quotation made for an order with none carries a pending
      // link; its first content save links it to that order (after the write below) and drops the key.
      const pendingOrderId = configAsPlainObject && String(existingDocument.type).toUpperCase() === 'QUOTATION' ? pendingOrderLinkOf(existingDocument.config) : null;
      if (configAsPlainObject && PENDING_ORDER_LINK_KEY in configAsPlainObject) delete configAsPlainObject[PENDING_ORDER_LINK_KEY];
      let linkedToOrder: string | null = null;
      const wasConfirmedBeforeSave = !['draft', 'unconfirmed'].includes(existingDocument.status);

      // RDO free-typed rows (enableRdoFreeTypedRows, Biofuel 2026-11-19): with the
      // flag on, a signed RDO (signed DO_ACK or completed run) is read-only.
      const rdoFreeRowsOn = isRdoType(existingDocument.type)
        ? await isOrgFeatureEnabled(this.prisma, organizationId, RDO_FREE_ROWS_FLAG)
        : false;
      if (rdoFreeRowsOn && (await isRdoSigned(this.prisma as any, organizationId, existingDocument.id))) {
        throw new HttpException('This RDO is signed and can no longer be changed', HttpStatus.FORBIDDEN);
      }

      // Managers and up only (guru 2026-09-29): a Designer-tier user may
      // neither CONFIRM a document nor edit one that is already confirmed.
      // (The client-signature confirm runs with no user and is unaffected.)
      if (actor?.id && (wasConfirmedBeforeSave || dto.status === 'confirmed')) {
        const { resolveTier } = await import('../common/role-tier');
        const { tier } = await resolveTier(this.prisma, organizationId, actor.id);
        if (tier === 'designer') {
          throw new HttpException(
            wasConfirmedBeforeSave ? 'Only managers can edit a confirmed document' : 'Only managers can confirm a document',
            HttpStatus.FORBIDDEN,
          );
        }
      }

      // Optimistic-concurrency guard. If the client sent the version it loaded,
      // reject the save when the document has since moved on (someone else saved
      // it, or took the lock over). Stops a stale copy from silently clobbering
      // newer work. Callers that don't send a version (internal/non-editor
      // updates) are unaffected; the editor always sends it.
      const incomingVersion = (dto as any).version;
      if (
        typeof incomingVersion === 'number' &&
        (existingDocument as any).version != null &&
        incomingVersion !== (existingDocument as any).version
      ) {
        throw new HttpException(
          {
            message:
              'This document was updated by someone else. Reload to get the latest version before saving.',
            code: 'VERSION_CONFLICT',
            currentVersion: (existingDocument as any).version,
            editingByName: (existingDocument as any).editingByName || null,
          },
          HttpStatus.CONFLICT,
        );
      }

      // projectId can arrive either at the top level (frontend's update payload
      // sets it there alongside customerId) or nested inside config. Prefer the
      // top-level value so the doc picker actually persists; fall back to the
      // legacy config.projectId for backwards-compat with older callers.
      const projectId =
        (dto as any).projectId ?? configAsPlainObject?.projectId ?? null;
      // Non-fatal outcome of the ad-hoc project hand-off below, surfaced on the
      // response so the office sees WHY the units were not deployed instead of
      // the save looking clean. Null when there was nothing to do.
      let adHocWarning: string | null = null;
      // The hand-off's outcome when it ran (deployed, stock, draft invoice), shown
      // to the office as a toast. The attach also commits the DO, so the response
      // carries its fresh status instead of the pre-attach one.
      let adHocSummary: string | null = null;
      console.log('Project ID resolved:', projectId, 'Type:', typeof projectId);
      console.log('dto', dto);

      // Handle captured images - ensure they are stored as URLs
      if (configAsPlainObject?.capturedImages && Array.isArray(configAsPlainObject.capturedImages)) {
        // The capturedImages should already be S3 URLs from the frontend
        // Just ensure they are properly stored in the config
        console.log('Captured images to be stored:', configAsPlainObject.capturedImages);
      }

      // Handle MSR photos - ensure they are stored as URLs
      if (configAsPlainObject?.photos && Array.isArray(configAsPlainObject.photos)) {
        // The photos should already be S3 URLs from the frontend
        // Just ensure they are properly stored in the config
        console.log('MSR photos to be stored:', configAsPlainObject.photos.length, 'photos');
      }

      // Preserve "tracking" fields the form doesn't surface. Without this, a
      // round-trip Save wipes them (the form sends back its full config, but
      // not these), which breaks downstream features that depend on them:
      // - sourceOrderId / sourceOrderNumber: how a PO/DO/Invoice traces back
      //   to its parent Order (used by the supplier-doc verify-upload flow
      //   to find which order's items to stamp ✓).
      // - orderType: gates PO editor behaviour (Route Order hides discount,
      //   shows Less Points; Project cascades top discount).
      // - sourceDocumentId / sourceDocumentNumber / sourceDocumentType: the
      //   quotation-to-doc lineage used by the doc breadcrumbs.
      // Honour an *explicit* overwrite from the form (so it's still possible
      // to update these via tooling), but never let a bare save erase them.
      const existingConfig = (existingDocument.config as any) || {};
      const trackingKeys = [
        'sourceOrderId',
        'sourceOrderNumber',
        'orderType',
        'sourceDocumentId',
        'sourceDocumentNumber',
        'sourceDocumentType',
        // Public "Click to pay" token minted at email-send time. A bare save
        // wiping it killed every previously-emailed pay link with "invalid or
        // expired" (guru 2026-08-19).
        'payToken',
        // The attached Sales Order / Quotation. The editor does not surface it,
        // so a bare save used to erase it — which silently cost the invoice its
        // agreed-price source (priceInvoiceLinesFromAsset reads it) and the
        // deployment/recurring anchoring keyed off the order (guru 2026-09-28,
        // BI202609212 lost saleOrderId on its first edit).
        'saleOrderId',
        // Document currency. Templates without a currency field (e.g. ADH
        // Japan's invoice) never send it, so a bare save dropped the currency
        // a creator had set (Shipments "Create invoice" → contract currency,
        // 2026-10). Only an existing value is kept; none is invented.
        'currency',
        // Link Document (WCT group, 2026-11-22): two documents on no order linked to each other (orders/doc-links.ts).
        // Server-owned; the editor never sends it, so a bare save must not drop it.
        'linkedDocs',
      ];
      // Only meaningful when the caller actually sent a config. A status-only
      // save (dto.config absent → configAsPlainObject null) has nothing to
      // preserve INTO, and dereferencing null here threw
      // "Cannot read properties of null (reading 'sourceOrderId')" — the first
      // trackingKey — which the closing catch re-threw as a 500.
      if (configAsPlainObject) {
        for (const k of trackingKeys) {
          if (
            (configAsPlainObject as any)[k] === undefined &&
            existingConfig[k] !== undefined
          ) {
            (configAsPlainObject as any)[k] = existingConfig[k];
          }
        }
        // ERP-imported history (common/erp-import.ts): the marker is server-owned, so an
        // edit-after-confirm save can't drop the "Imported" mark (and with it the GL guard). The
        // stored totals and paid / owed amounts stay as the ERP had them while the lines' money is
        // unchanged; when the lines do change, the new totals stand and the balance follows them
        // (what was paid, in the ERP and since, is kept).
        // Split payment part: its stored subtotal / GST / total (the last part carries the
        // original's leftover cents) stand while its line's money is unchanged (invoice-split.ts).
        keepSplitPartTotals(existingConfig, configAsPlainObject);
        if (isErpImported(existingConfig)) {
          const next: any = configAsPlainObject;
          next.erpImport = existingConfig.erpImport;
          const stored = erpStoredTotalsOf(existingConfig);
          const linesSame = !Array.isArray(next.items) || !stored || moneySignature(next.items) === stored.sig;
          const MONEY = ['outstandingBalance', 'xeroBalance', 'paidToDate', 'xeroAmountPaid', 'totalWithTax', 'xeroGross'];
          if (linesSame) {
            for (const k of ['grossTotal', 'discountAmount', 'subTotal', 'gstAmount', 'nettTotal', 'gstPercent', 'taxApplicable', 'absorbTax', ...MONEY]) {
              if (existingConfig[k] !== undefined) next[k] = existingConfig[k];
              if (next.documentInfo && typeof next.documentInfo === 'object' && k in next.documentInfo && existingConfig[k] !== undefined) next.documentInfo[k] = existingConfig[k];
            }
          } else if (existingDocument.type === 'INVOICE' || existingDocument.type === 'TI' || existingDocument.type === 'TI2') {
            const oldGross = Number(grossStampOf(existingConfig) ?? existingConfig.nettTotal) || 0;
            const newGross = Number(next.nettTotal ?? next.documentInfo?.nettTotal);
            if (Number.isFinite(newGross)) {
              const paid = Number(amountPaidOf(existingConfig) ?? 0) || 0;
              const erpPaid = erpPaidAtImport(existingConfig, oldGross);
              next.erpImport = { ...existingConfig.erpImport, balanceAtImport: Math.max(0, Math.round((newGross - erpPaid) * 100) / 100) };
              Object.assign(next, stampDocumentMoney({}, { gross: newGross, paid, outstanding: Math.max(0, Math.round((newGross - paid) * 100) / 100) }));
            }
          }
        }
        // Reference canonicalisation (guru 2026-09-09): config.referenceNo is
        // THE document reference key — legacy writers used `reference` /
        // `xeroReference` / `documentInfo.reference`, which made the list
        // tables (fallback chain) show a Reference the editor (referenceNo
        // only) didn't. Converge on save: a caller that doesn't send
        // referenceNo at all inherits the best legacy value. An explicit ""
        // (the editor clearing the field) is respected, not resurrected.
        if ((configAsPlainObject as any).referenceNo === undefined) {
          const legacyRef =
            (configAsPlainObject as any).reference ||
            (configAsPlainObject as any).documentInfo?.reference ||
            (configAsPlainObject as any).xeroReference ||
            existingConfig.referenceNo ||
            existingConfig.reference ||
            existingConfig.documentInfo?.reference ||
            existingConfig.xeroReference;
          if (legacyRef) (configAsPlainObject as any).referenceNo = legacyRef;
        }
      }

      // Validate status transition for invoices
      const invoiceTypesForValidation = ['INVOICE', 'TI', 'TI2'];
      if (dto.status && invoiceTypesForValidation.includes(existingDocument.type)) {
        const currentStatus = existingDocument.status;
        const newStatus = dto.status;

        // Skip validation if status is not changing
        if (currentStatus === newStatus) {
          console.log(`Status unchanged: keeping document as "${currentStatus}"`);
        } else {
          // Define valid status transitions for invoices (guru 2026-07-24
          // status model: unconfirmed → confirm → pending_payment ["Awaiting
          // payment"] → paid; 'draft' kept readable for pre-backfill data).
          const validTransitions: Record<string, string[]> = {
            'draft': ['unconfirmed', 'confirmed', 'pending_payment'],
            'unconfirmed': ['confirmed', 'pending_payment'],
            'confirmed': ['pending_payment'], // confirmed can go to pending_payment (after email sent)
            'pending_payment': ['paid'], // pending_payment can go to paid
            'paid': [], // paid is final status
          };

          // Check if transition is valid
          const allowedNextStatuses = validTransitions[currentStatus] || [];
          if (!allowedNextStatuses.includes(newStatus)) {
            // Special case: Allow manual status change to 'paid' only from 'pending_payment'
            if (newStatus === DocumentStatus.paid && currentStatus !== DocumentStatus.pending_payment) {
              throw new HttpException(
                `Invoice must be in "pending_payment" status before marking as paid. Current status: ${currentStatus}`,
                HttpStatus.BAD_REQUEST,
              );
            } else if (newStatus === DocumentStatus.paid && currentStatus === DocumentStatus.pending_payment) {
              // This is allowed - user manually marking as paid from pending_payment status
            } else {
              throw new HttpException(
                `Invalid status transition from "${currentStatus}" to "${newStatus}". ` +
                `Allowed transitions: ${allowedNextStatuses.length > 0 ? allowedNextStatuses.join(', ') : 'none (final status)'}`,
                HttpStatus.BAD_REQUEST,
              );
            }
          }
        }
      }

      // Save as revision (enableQuotationRevisionOnSave, quotation-revision.ts): this save of an
      // accepted quotation takes the next "-Rn" number; the version it replaces is copied
      // under the old number after the write below.
      let revision: { name: string; revisionNumber: number } | null = null;
      if ((dto as any).saveAsRevision === true) {
        const isQuotation = String(existingDocument.type).toUpperCase() === 'QUOTATION';
        if (!configAsPlainObject || !isQuotation || !wasConfirmedBeforeSave || !existingDocument.name) {
          throw new HttpException('Only an accepted quotation can be saved as a revision.', HttpStatus.BAD_REQUEST);
        }
        if (!(await isOrgFeatureEnabled(this.prisma as any, organizationId, QUOTATION_REVISION_FLAG))) {
          throw new HttpException('Saving as a revision is not turned on for this organisation.', HttpStatus.BAD_REQUEST);
        }
        revision = nextRevision(existingDocument.name, existingDocument.revisionNumber);
        if ('documentNumber' in configAsPlainObject) configAsPlainObject.documentNumber = revision.name;
        if (configAsPlainObject.documentInfo && typeof configAsPlainObject.documentInfo === 'object') configAsPlainObject.documentInfo.documentNumber = revision.name;
        dto.name = revision.name;
        // The editor's save does not send who accepted the quotation; a revision keeps it.
        for (const k of ['confirmedBy', 'confirmedAt']) {
          const was = (existingDocument.config as any)?.[k];
          if (was != null && configAsPlainObject[k] == null) configAsPlainObject[k] = was;
        }
      }

      // Sync Document.name with the editable "Purchase Order No." / document
      // number on the form. When the user types a custom number into the
      // documentNumber field it becomes the document's authoritative name,
      // so the orders list, supplier-doc verification (which matches on name),
      // and any other downstream surface all stay in agreement.
      const editedDocNumber =
        (configAsPlainObject as any)?.documentNumber ??
        (configAsPlainObject as any)?.documentInfo?.documentNumber;
      const trimmedDocNumber =
        typeof editedDocNumber === 'string' && editedDocNumber.trim() ? editedDocNumber.trim() : undefined;
      const nameToWrite = trimmedDocNumber ?? dto.name;

      // OSI-83: a scheduled DRAFT DO carries a DO-PENDING-NN placeholder and never
      // consumed a real number. The FIRST time it confirms, claim the real
      // sequence NOW so the run display, auto-invoice, and print show the real DO
      // number. (Computed locally — `becomingConfirmed` below is defined after
      // this update.)
      const doConfirmingNow = dto.status === 'confirmed' && existingDocument.status !== 'confirmed';
      // A DO voided by its run's cancel (enableRealDoOnSchedule) keeps its number
      // for the record and is never confirmed afterwards.
      // A draft invoice voided with its cancelled order (orders/order-cancel.ts) never leaves draft.
      if (isVoidedWithOrder(existingDocument.config) && dto.status && !['draft', 'unconfirmed'].includes(String(dto.status))) {
        throw new HttpException(`${existingDocument.name ?? 'This invoice'} was voided with its cancelled order and can't be confirmed or sent.`, HttpStatus.BAD_REQUEST);
      }
      if (doConfirmingNow && (existingDocument.config as any)?.cancelled === true && existingDocument.type === 'DELIVERY_ORDER') {
        throw new HttpException(`${existingDocument.name ?? 'This DO'} was cancelled with its delivery and can't be confirmed.`, HttpStatus.BAD_REQUEST);
      }
      // Confirming an EMPTY document is refused here as well as in the editor.
      if (doConfirmingNow) this.assertHasLineItems(dto.config ?? existingDocument.config, String(existingDocument.type || 'document').toLowerCase().replace(/_/g, ' '));
      if (doConfirmingNow) this.assertHasCustomer(dto.config ?? existingDocument.config, existingDocument.type, String(existingDocument.type || 'document').toLowerCase().replace(/_/g, ' '));
      let confirmedDoName: string | undefined;
      if (
        doConfirmingNow &&
        existingDocument.type === 'DELIVERY_ORDER' &&
        typeof existingDocument.name === 'string' &&
        existingDocument.name.startsWith('DO-PENDING-')
      ) {
        confirmedDoName = await this.generateSequentialDocumentName(
          organizationId,
          existingDocument.type,
          existingDocument.documentTemplateId,
          configAsPlainObject,
          new Date(),
        );
      }

      // An unnumbered skip-numbering draft (ID quotation) claims its real
      // contract number the FIRST time it confirms (CIEL 09-01) — unless the
      // user typed their own number into the form.
      let confirmedIdqName: string | undefined;
      if (
        doConfirmingNow &&
        !existingDocument.name &&
        !trimmedDocNumber &&
        ((existingDocument.config as any)?.skipNumbering === true)
      ) {
        try {
          confirmedIdqName = await this.generateSequentialDocumentName(
            organizationId,
            existingDocument.type,
            existingDocument.documentTemplateId,
            configAsPlainObject ?? (existingDocument.config as any),
            new Date(),
          );
        } catch (e: any) {
          console.warn('[numbering] confirm-time allocation failed:', e?.message);
        }
      }

      // A document's NAME is its number: nameToWrite comes from the editable
      // documentNumber field above. Two documents cannot share a number on the
      // same template (@@unique([name, organizationId, documentTemplateId])),
      // and Prisma's raw P2002 was being shown to the user verbatim —
      // "Unique constraint failed on the fields: (`name`,`organizationId`,
      // `documentTemplateId`)", which tells an accountant nothing about what to
      // change (guru 2026-10-19, a JPSG invoice retried six times). Check first
      // and say which document already holds the number.
      const intendedName = confirmedDoName ?? confirmedIdqName ?? nameToWrite;
      if (intendedName && intendedName !== existingDocument.name) {
        const clash = await this.prisma.document.findFirst({
          where: {
            organizationId,
            name: intendedName,
            documentTemplateId: existingDocument.documentTemplateId,
            NOT: { id },
          },
          select: { name: true, type: true, status: true },
        });
        if (clash) {
          throw new HttpException(
            `Document number "${intendedName}" is already used by another ${String(clash.type).toLowerCase().replace(/_/g, ' ')} (${clash.status}). Pick a different number.`,
            HttpStatus.CONFLICT,
          );
        }
      }

      // Update the document itself with config only
      const updatedDocument = await this.prisma.document.update({
        where: {
          id,
          organizationId, // Ensure user can only update documents in their organization
        },
        data: {
          // A status-only save (Confirm, and any other caller that sends no
          // dto.config) carries no config at all, so it must leave the stored
          // config ALONE. Writing it unconditionally would put null into a
          // required Json column and wipe the document's contents.
          ...(configAsPlainObject ? { config: configAsPlainObject } : {}),
          type: dto.type,
          // Update document status if provided
          status: dto.status, // DocumentStatus enum
          // A confirming placeholder DO claims its real number here; otherwise a
          // custom doc number wins, else honour dto.name.
          name: intendedName,
          // Link to project if projectId exists in config
          projectId: projectId || undefined,
          ...(revision ? { revisionNumber: revision.revisionNumber } : {}),
          // Bump the optimistic-concurrency counter on every successful save so
          // any other editor holding an older copy is rejected on their save.
          version: { increment: 1 },
          // A content save IS activity by the lock holder — bump the idle clock
          // so an actively-saving editor (autosave fires ~every 2s) never reads
          // as idle and can't be taken over. Status-only updates skip this.
          ...(configAsPlainObject ? { lastActivityAt: new Date() } : {}),
        } as any,
      });
      if (pendingOrderId) linkedToOrder = await this.linkPendingQuotation(pendingOrderId, organizationId, updatedDocument, actor);

      // Save as revision: keep the version just replaced, read-only, under its old number.
      // After the write above, because two documents cannot hold one number.
      if (revision) {
        const family = existingDocument.baseDocumentId || existingDocument.id;
        await this.prisma.document.create({
          data: {
            documentTemplateId: existingDocument.documentTemplateId,
            type: existingDocument.type,
            organizationId,
            status: existingDocument.status,
            name: existingDocument.name,
            projectId: existingDocument.projectId ?? undefined,
            baseDocumentId: family,
            revisionNumber: existingDocument.revisionNumber ?? 0,
            config: {
              ...((existingDocument.config as any) || {}),
              voided: true,
              supersededBy: revision.name,
              cancelledReason: `Replaced by ${revision.name}`,
              cancelledAt: new Date().toISOString(),
            } as any,
          } as any,
        });
        void this.logDocumentEvent({
          documentId: id,
          organizationId,
          action: 'EDITED_AFTER_CONFIRM',
          detail: `Saved as revision ${revision.name} (was ${existingDocument.name})`,
          documentName: revision.name,
          actor,
        });
      }

      // Order.linkedDocuments stores a *snapshot* of each linked doc's name —
      // so when the user renames a PO/DO/Invoice (typically by typing a custom
      // Purchase Order No.), the chip on the order page would otherwise show
      // the stale label. Propagate the new name to every order that references
      // this document. Skip if the name didn't actually change.
      if (nameToWrite && nameToWrite !== existingDocument.name) {
        try {
          const orders = await this.prisma.order.findMany({
            where: { organizationId },
            select: { id: true, linkedDocuments: true },
          });
          for (const o of orders) {
            const ld: any = o.linkedDocuments || {};
            let dirty = false;
            for (const kind of ['po', 'do', 'invoice', 'salesOrder'] as const) {
              const list: any[] = Array.isArray(ld[kind]) ? ld[kind] : [];
              for (const ref of list) {
                if (ref && ref.id === id && ref.name !== nameToWrite) {
                  ref.name = nameToWrite;
                  dirty = true;
                }
              }
            }
            if (dirty) {
              await this.prisma.order.update({ where: { id: o.id }, data: { linkedDocuments: ld } });
            }
          }
        } catch (e) {
          console.warn('Failed to propagate doc rename to orders.linkedDocuments:', (e as Error).message);
        }
      }

      // WCT orders (2026-11-17, ORD202611-013): a quotation confirmed before its
      // customer was picked made an order with no customer, and the order never
      // followed. A later quotation save that names a customer fills the order's
      // EMPTY customer (never overwrites). Only orgs with enableWctOrders.
      const quoteCustomerId = configAsPlainObject?.customerId;
      if (typeof quoteCustomerId === 'string' && quoteCustomerId && /^QUOTATION|^QO|^QT/i.test(String(existingDocument.type || ''))) {
        await fillEmptyOrderCustomer(this.prisma as any, organizationId, existingDocument.id, quoteCustomerId).catch((e: any) =>
          console.warn('[wct-orders] order customer fill skipped:', e?.message),
        );
      }

      // ---- Invoice confirmation gate (price history + AR transaction) ----
      // NOTE: GL auto-posting for invoices lives in confirmInvoice(); this generic
      // update() path is for non-invoice document types or backwards-compat updates.
      const isInvoiceType = dto.type === 'INVOICE' || dto.type === 'TI' || dto.type === 'TI2';
      const becomingConfirmed = dto.status === 'confirmed' && existingDocument.status !== 'confirmed';
      console.log('🧾 [INVOICE-CONFIRM gate]', {
        docId: id,
        dtoType: dto.type,
        dtoStatus: dto.status,
        existingStatus: existingDocument.status,
        isInvoiceType,
        becomingConfirmed,
        willAutoPost: isInvoiceType && becomingConfirmed,
      });
      // Route Order PO confirm → decrement the org's Points balance by the
      // editable "Less Points" amount the user entered on the PO. Lives here
      // because confirms-flip is the trigger; balance moves once-per-confirm
      // and a confirmed doc can't be re-confirmed (guarded at the top).
      const isPoType = dto.type === 'PO' || dto.type === 'PURCHASE_ORDER';
      const cfgForPoints: any = configAsPlainObject || {};
      const isRouteOrderPo = isPoType && (cfgForPoints?.orderType ?? cfgForPoints?.documentInfo?.orderType) === 'Route Order';
      if (becomingConfirmed && isRouteOrderPo) {
        const redeemRaw =
          cfgForPoints?.documentInfo?.pointsRedeemed ??
          cfgForPoints?.pointsRedeemed ??
          cfgForPoints?.documentInfo?.pointsDeducted ?? // legacy auto-computed fallback
          cfgForPoints?.pointsDeducted ??
          0;
        const redeem = Math.max(0, Number(redeemRaw) || 0);
        if (redeem > 0) {
          try {
            const result = await this.prisma.organization.update({
              where: { id: organizationId },
              data: { pointsBalance: { decrement: redeem } },
              select: { pointsBalance: true },
            });
            console.log(
              `🎯 Points debited: -${redeem} on Route Order PO ${id}; new balance ${result.pointsBalance}`,
            );
          } catch (err) {
            console.error('Points debit failed (non-fatal):', (err as Error).message);
          }
        }
      }

      if (becomingConfirmed && isInvoiceType) {
        try {
          await this.priceHistoryService.savePriceHistoryFromDocument(id, organizationId);
          console.log('Price history saved for confirmed invoice:', id);
        } catch (error) {
          console.error('Failed to save price history:', error);
          // Don't fail the document update if price history fails
        }

        // NOTE: The Transaction / CustomerBalance sub-ledger has been RETIRED.
        // AR is now derived directly from the Document table (this invoice's
        // config carries the amount + outstanding balance), so the SOA, aging,
        // and AI tools all read one source. We no longer write a Transaction
        // row here. GL auto-post for invoices is handled by confirmInvoice().
      }

      // If document is being confirmed and is a Purchase Order, update inventory quantities
      console.log('📋 UPDATE DOC: dto.type =', dto.type, ', dto.status =', dto.status, ', existingDocument.status =', existingDocument.status);
      console.log('📋 UPDATE DOC: Is PO check:', dto.type === 'PO' || dto.type === 'PURCHASE_ORDER');
      if (dto.status === 'confirmed' &&
          existingDocument.status !== 'confirmed' &&
          (dto.type === 'PO' || dto.type === 'PURCHASE_ORDER')) {
        try {
          const items = configAsPlainObject?.items || [];
          console.log('📦 PO RECEIVE: Processing Purchase Order confirmation with items:', items.length);
          console.log('📦 PO RECEIVE: Items with receivedQty:', items.map((i: any) => ({ id: i.inventoryItemId, qty: i.quantity, receivedQty: i.receivedQty })));

          await Promise.all(
            items.map(async (item: any) => {
              if (!item.inventoryItemId) {
                console.warn('⚠️ PO RECEIVE: Item missing inventoryItemId, skipping');
                return;
              }

              const receivedQty = parseFloat(item.receivedQty) || 0;
              if (receivedQty <= 0) {
                console.warn('⚠️ PO RECEIVE: Item has no received quantity, skipping:', item.inventoryItemId);
                return;
              }

              // Try to find in Inventory table first (Asset Tracking Mode ON)
              let inventory = await this.prisma.inventory.findUnique({
                where: { id: item.inventoryItemId },
              });

              if (inventory) {
                // Update inventory quantity (add received quantity to existing stock)
                const currentQty = inventory.quantity || 0;
                const newQty = currentQty + receivedQty;

                await this.prisma.inventory.update({
                  where: { id: item.inventoryItemId },
                  data: { quantity: newQty },
                });

                console.log(`✅ PO RECEIVE: Updated inventory ${item.inventoryItemId}: ${currentQty} + ${receivedQty} = ${newQty}`);

                // Create timeline entry for the inventory update
                await this.prisma.timelineItem.create({
                  data: {
                    message: `Received ${receivedQty} units from Purchase Order ${updatedDocument.name || id.substring(0, 8)}`,
                    inventoryId: item.inventoryItemId,
                    documentId: id,
                    pdfUrl: null,
                  },
                });
              } else {
                // Try to find in Asset table (Products Mode - Asset Tracking OFF)
                const asset = await this.prisma.asset.findUnique({
                  where: { id: item.inventoryItemId },
                });

                if (asset) {
                  // Update asset quantity (add received quantity to existing stock)
                  const currentQty = asset.quantity || 0;
                  const newQty = currentQty + receivedQty;

                  await this.prisma.asset.update({
                    where: { id: item.inventoryItemId },
                    data: { quantity: newQty },
                  });

                  console.log(`✅ PO RECEIVE: Updated asset ${item.inventoryItemId}: ${currentQty} + ${receivedQty} = ${newQty}`);
                } else {
                  console.warn('⚠️ PO RECEIVE: Neither inventory nor asset found:', item.inventoryItemId);
                }
              }
            })
          );

          console.log('✅ PO RECEIVE: Purchase Order inventory update completed');
        } catch (error) {
          console.error('❌ PO RECEIVE: Failed to update inventory:', error);
          // Don't fail the document update if inventory update fails
        }

        // ---- PO-as-Project auto-creation (feature-flagged) ----
        // When enablePOAsProject is on, confirming a PO spins up a Project named
        // after the PO and links it back so subsequent DOs/invoices can attach to it.
        try {
          const uiConfig = await this.prisma.organizationUIConfig.findUnique({
            where: { organizationId },
            select: { features: true },
          });
          const features = (uiConfig?.features as any) || {};
          if (features.enablePOAsProject && !updatedDocument.projectId) {
            const projectName = updatedDocument.name || `PO-${id.substring(0, 8)}`;
            const newProject = await this.prisma.project.create({
              data: {
                name: projectName,
                organizationId,
                customerPoNumber: updatedDocument.name || null,
              },
              select: { id: true, name: true },
            });
            await this.prisma.document.update({
              where: { id },
              data: { projectId: newProject.id },
            });
            console.log(`✅ PO→PROJECT: created project ${newProject.id} ("${newProject.name}") and linked it to PO ${id}`);
          }
        } catch (err) {
          console.error('❌ PO→PROJECT: failed to auto-create project from PO', err);
          // Best-effort: don't fail the PO confirmation if project creation fails.
        }
      }

      // ---- Auto-create Order from confirmed quotation (gated by flag) ----
      // When a quotation flips to confirmed and enableConfirmQuotation is on,
      // spawn an Order so users can later spin off POs / DOs / Invoices for
      // selected items without having to use the immediate-convert popup.
      const isQuotationType =
        dto.type === 'QUOTATION' ||
        dto.type === 'QO' ||
        dto.type === 'QO1' ||
        dto.type === 'QO2' ||
        dto.type === 'QT';
      if (becomingConfirmed && isQuotationType) {
        try {
          const uiConfig = await this.prisma.organizationUIConfig.findUnique({
            where: { organizationId },
            select: { features: true },
          });
          const features = (uiConfig?.features as any) || {};
          // WCT orders (enableWctOrders) make their own Order in the
          // quotation→delivery hook below (one order per quotation, with its
          // first job), so the generic order must not be made next to it.
          if (features.enableConfirmQuotation && features.enableWctOrders !== true) {
            // Orders is a nav module of its own — an org that confirms
            // quotations WITHOUT the Orders tab (WCT 2026-10-26) must not
            // grow invisible Order rows. A stored module row decides; no
            // row means the catalog default (on).
            const ordersRow = await this.prisma.organizationModule.findFirst({
              where: { organizationId, moduleCode: 'ORDERS' },
              select: { enabled: true },
            });
            if (ordersRow && ordersRow.enabled === false) {
              console.log('ℹ️ QUOTATION→ORDER: skipped — ORDERS module is off for this org');
            } else {
              const order = await this.ordersService.createFromQuotation(id, organizationId);
              console.log(`✅ QUOTATION→ORDER: created order ${order.orderNumber} (${order.id})`);
            }
          }
        } catch (err) {
          console.error('❌ QUOTATION→ORDER: failed to auto-create order', err);
          // Best-effort: don't fail the quotation confirmation if order creation fails.
        }
        // Quotation → DRAFT DELIVERY (enableQuotationToDelivery, WCT 2026-10-26):
        // an accepted quotation auto-creates a draft scheduled run waiting for
        // the office to confirm. Pure helper (never throws), flag-gated inside,
        // idempotent on Delivery.sourceQuotationId. The e-sign path
        // (public-sign.service sign()) makes the same call.
        {
          const { autoDraftDeliveryFromQuotation } = await import('../deliveries/quotation-to-delivery');
          const run = await autoDraftDeliveryFromQuotation(this.prisma, organizationId, id, {
            warn: (m) => console.warn(`⚠️ ${m}`),
            log: (m) => console.log(`🚚 ${m}`),
          });
          // Tell the office on WhatsApp (guru 2026-10-28): the quotation is
          // confirmed and its draft delivery is waiting for a date. Flag-gated
          // and best-effort inside; never fails the confirm.
          // Manual order flow: the new job's draft DO + draft service report
          // (no-op unless enableManualOrderFlow; never throws).
          // Manual order flow, DO first (2026-11-13): the order's first draft DO, no job.
          const firstDo = run?.doFirst && run.orderId ? await this.prepareManualOrderDo(run.orderId, organizationId) : null;
          if (run && !run.doFirst) await this.prepareManualOrderJob(run.id, organizationId);
          if (run) {
            const c: any = configAsPlainObject || {};
            const who = c.customerName || c.customer?.name || '';
            await this.staffWhatsApp.push(
              organizationId,
              run.doFirst && !firstDo
                ? `Quotation ${updatedDocument.name || ''}${who ? ` (${who})` : ''} confirmed. Order ${run.orderNumber} created: add the DO and create the invoice from the order page.`
                : run.doFirst
                ? `Quotation ${updatedDocument.name || ''}${who ? ` (${who})` : ''} confirmed. Order ${run.orderNumber} created with draft DO ${firstDo?.doName || ''}: complete the DO when the work is done (add a job for a date or a technician if needed).`
                : run.orderNumber
                ? `Quotation ${updatedDocument.name || ''}${who ? ` (${who})` : ''} confirmed. Order ${run.orderNumber} created with draft job #${run.deliveryNumber}: please schedule a date and confirm the items.`
                : `Quotation ${updatedDocument.name || ''}${who ? ` (${who})` : ''} confirmed. Draft delivery #${run.deliveryNumber} created: please schedule a date and confirm the items.`,
              { linkPath: run.doFirst ? `/portal/orders/${run.orderId}` : `/portal/deliveries/${run.id}`, dedupeKey: `quotation-confirmed:${id}` },
            );
          }
        }
      }

      // ---- GL on save (no-draft model) ----
      // Every save of a transactional document mirrors it into the GL: void the
      // previous entry (reversing entry preserved for the audit trail) + post
      // fresh from the just-saved config. Best-effort — a posting failure never
      // fails the save (surfaced in history + logs instead).
      // Only full editor saves (config with an items array) repost — partial
      // updates (status flips, payment bookkeeping, link flows) leave the GL alone.
      if (
        DocumentsService.SAVE_GL_TYPES[(dto.type || existingDocument.type || '').toUpperCase()] &&
        configAsPlainObject &&
        Array.isArray((configAsPlainObject as any).items)
      ) {
        await this.repostGlForDocument(
          organizationId,
          id,
          dto.type || existingDocument.type,
          configAsPlainObject,
          updatedDocument.name,
          actor,
        );
      }
      // postInvoicesOnConfirm: a status change out of draft (no lines in the
      // save) posts the invoice now. Idempotent; no-op without the flag.
      if (dto.status && invoicePostingHeld(true, existingDocument.status as any) && !invoicePostingHeld(true, dto.status as any)) {
        await this.postInvoiceLeavingDraft(organizationId, id, actor);
      }

      // ---- GL auto-post for non-invoice transactional types ----
      // Credit Note / Debit Note / Purchase Order / Purchase Return — when status flips to "confirmed".
      const GL_TYPES: Record<string, 'CREDIT_NOTE' | 'DEBIT_NOTE' | 'PURCHASE_ORDER' | 'PURCHASE_RETURN'> = {
        CN: 'CREDIT_NOTE',
        CREDIT_NOTE: 'CREDIT_NOTE',
        DN: 'DEBIT_NOTE',
        DEBIT_NOTE: 'DEBIT_NOTE',
        PO: 'PURCHASE_ORDER',
        PURCHASE_ORDER: 'PURCHASE_ORDER',
        PR: 'PURCHASE_RETURN',
        PURCHASE_RETURN: 'PURCHASE_RETURN',
      };
      const glType = GL_TYPES[dto.type as keyof typeof GL_TYPES];

      // Teach the account-coding memory from every CONFIRMED document (guru
      // 2026-09-30). Until now the only way to teach it was to open the
      // Posting Preview dialog and OVERRIDE a suggestion — a door almost
      // nobody walks through: /posting-preview/learn had been called twice
      // ever, and the SALES side of the memory held zero rules while 80
      // invoice lines worth $431k sat uncoded.
      //
      // A confirmed document is a settled description->account pairing whether
      // or not anyone overrode anything, so it is the honest thing to learn
      // from. Fire-and-forget: a memory failure must never block a confirm.
      if (becomingConfirmed) {
        try {
          const cfgForLearn: any = configAsPlainObject || existingDocument.config;
          const learnSide = ['BILL', 'PO', 'PURCHASE_ORDER', 'PR', 'PURCHASE_RETURN'].includes(String(dto.type).toUpperCase())
            ? 'PURCHASE'
            : 'SALES';
          const corrections = (cfgForLearn?.items || [])
            .filter((it: any) => String(it?.description || '').trim() && it?.accountCode && (Number(it?.amount) || 0) !== 0)
            .map((it: any) => ({ text: String(it.description), accountCode: String(it.accountCode), accountId: it.accountId ?? null }));
          if (corrections.length) {
            this.accountMemory
              .record(organizationId, learnSide, corrections)
              .catch((e: any) => console.warn('[account-memory] learn on confirm failed:', e?.message));
          }
        } catch (e: any) {
          console.warn('[account-memory] learn on confirm skipped:', e?.message);
        }
      }

      // A confirmed revision retires the generation it replaces, so the family
      // never has two live documents (guru 2026-11-19).
      if (becomingConfirmed && existingDocument.baseDocumentId) {
        await this.supersedePreviousGenerations(
          { id, name: dto.name ?? existingDocument.name, baseDocumentId: existingDocument.baseDocumentId, revisionNumber: existingDocument.revisionNumber },
          organizationId,
          actor,
        );
      }

      // ERP-imported history never posts (common/erp-import.ts), even when its status is re-confirmed.
      if (confirmPostsToGl(becomingConfirmed, glType, configAsPlainObject || existingDocument.config)) {
        console.log('📒 [GL auto-post] entering for', dto.type, '→', glType);
        try {
          const existing = await this.journalAutoPost.alreadyPostedForDocument(organizationId, id, glType);
          if (existing) {
            console.log('📒 [GL auto-post] entry already exists — skipping', existing);
          } else {
            const cfg: any = configAsPlainObject || existingDocument.config;
            const items = cfg?.items || [];
            const partyName = cfg?.customer?.name || cfg?.customerName || cfg?.supplier?.name || cfg?.supplierName;

            // documentInfo.* carries the editor's summary (driven by the
            // document-level tax code) — same precedence as confirmInvoice.
            const cfgDi = cfg?.documentInfo;
            const explicitNet = parseFloat(cfg?.subTotal ?? cfgDi?.subTotal ?? cfg?.summary?.subTotal ?? 'NaN');
            const explicitTax = parseFloat(cfg?.gstAmount ?? cfgDi?.gstAmount ?? cfg?.summary?.taxAmount ?? cfg?.tax?.amount ?? 'NaN');
            const explicitGross = parseFloat(cfg?.nettTotal ?? cfgDi?.nettTotal ?? cfg?.summary?.grandTotal ?? 'NaN');

            const fallbackNet = items.reduce((sum: number, item: any) => {
              const amt = parseFloat(item.amount) || (parseFloat(item.quantity) * parseFloat(item.unitPrice)) || 0;
              return sum + amt;
            }, 0);
            const org = await this.prisma.organization.findUnique({ where: { id: organizationId }, select: { taxRate: true } });
            const glDocPct = parseFloat(cfgDi?.gstPercent);
            const orgRate = (Number.isFinite(glDocPct) ? glDocPct : (org?.taxRate ?? 0)) / 100;

            const netAmount = !Number.isNaN(explicitNet) ? explicitNet : fallbackNet;
            const taxAmount = !Number.isNaN(explicitTax) ? explicitTax : netAmount * orgRate;
            const grossAmount = !Number.isNaN(explicitGross) ? explicitGross : netAmount + taxAmount;

            console.log('📒 [GL auto-post] computed', { docId: id, type: glType, partyName, netAmount, taxAmount, grossAmount });

            const baseArgs = {
              organizationId,
              documentId: id,
              documentNumber: updatedDocument.name || cfg?.documentNumber,
              entryDate: new Date(cfg?.date || (await orgTodayFor(this.prisma, organizationId))),
              netAmount,
              taxAmount,
              grossAmount,
            };

            let entry: any = null;
            if (glType === 'CREDIT_NOTE') {
              // config.subtype 'AP' = supplier credited us (Xero ACCPAYCREDIT
              // convention from the migration + email ingestion) — that's the
              // purchase-return shape (Dr Payables / Cr Purchases + tax
              // reversal), not the AR shape (Dr Sales / Cr Debtors).
              if (cfg?.subtype === 'AP') {
                entry = await this.journalAutoPost.postFromPurchaseReturn({ ...baseArgs, supplierName: partyName });
                if (entry) {
                  entry = await this.prisma.journalEntry.update({
                    where: { id: entry.id },
                    data: { type: 'CREDIT_NOTE' },
                    include: { lines: { include: { account: true } } },
                  });
                }
              } else {
                entry = await this.journalAutoPost.postFromCreditNote({ ...baseArgs, customerName: partyName, ...(await this.noteRevenueLines(organizationId, cfg, items, netAmount)) });
              }
            } else if (glType === 'DEBIT_NOTE') {
              entry = await this.journalAutoPost.postFromDebitNote({ ...baseArgs, customerName: partyName, ...(await this.noteRevenueLines(organizationId, cfg, items, netAmount)) });
            } else if (glType === 'PURCHASE_ORDER') {
              entry = await this.journalAutoPost.postFromPurchaseOrder({ ...baseArgs, supplierName: partyName });
            } else if (glType === 'PURCHASE_RETURN') {
              entry = await this.journalAutoPost.postFromPurchaseReturn({ ...baseArgs, supplierName: partyName });
            }

            if (entry) {
              console.log('✅ [GL auto-post] entry created', { journalNumber: entry.journalNumber, totalDebit: entry.totalDebit, totalCredit: entry.totalCredit });
            } else {
              console.warn('⚠️ [GL auto-post] post* returned null — see service warnings above');
            }
          }
        } catch (error) {
          console.error('❌ [GL auto-post] failed for', dto.type, id, error);
        }
      }

      // REMOVED (2026-07-10): legacy block that wrote config.deliveryTo into
      // project.siteOfficeId on every save of a project-linked doc. deliveryTo
      // stopped being a site-office ID long ago — it's a free-text address —
      // so this crashed with a Postgres uuid error the moment a project-linked
      // DO had a Deliver-to filled (and would have silently corrupted the
      // project's site office for UUID-shaped text). Projects manage their own
      // siteOfficeId/startDate via the projects module.

      // ── AD-HOC RUN: HAND THE PROJECT TO THE DELIVERY ──────────────────────
      //
      // Setting a project on a DO that belongs to an AD-HOC delivery run used to
      // go nowhere useful. The run kept projectId null, no ProjectDeployment was
      // created, and the two blocks below still flipped every unit to `rental`
      // and wrote a bare Assignment — a unit on rental holding nothing. That is
      // run #30's shape, and it is exactly what the ad-hoc flow exists to avoid.
      //
      // So delegate. attachProjectToAdHocRun is the ONE place that knows how to
      // do this properly: it points the run at the project, derives the customer,
      // and calls projectsService.fieldDeploy per line, which creates the
      // ProjectDeployment + Assignment and performs the reserved -> rental flip
      // as one act. Copying projectId onto the run instead would reproduce the
      // half state in a second record.
      //
      // ORDER MATTERS: this runs BEFORE the inventory-status block below. That
      // block flips DO units to `rental` unconditionally, and attach refuses a
      // run whose units are no longer `reserved` — so running it afterwards
      // would make the hand-off fail 100% of the time on the very documents it
      // is meant to serve. Afterwards both blocks are no-ops for these units:
      // they are already rental, and fieldDeploy's Assignment already exists.
      //
      // AD_HOC ONLY. A scheduled run is born with its project and its DO is
      // committed by commitScheduledRunOnCompletion; attach rejects it outright.
      // The guard is here as well so the common case costs one indexed read.
      const adHocAttach = officeDoEdit ? null : await this.tryAttachProjectToAdHocRun(
        updatedDocument.id,
        projectId,
        organizationId,
        dto.type,
        actor,
      );
      if (adHocAttach?.warning) adHocWarning = adHocAttach.warning;
      if (adHocAttach?.summary) adHocSummary = adHocAttach.summary;

      // If config.items exists and is an array, handle inventory/timeline logic (for DO, RDO, etc.)
      // Exclude invoice types (TI, TI2, INVOICE), quotations (QO1, QUOTATION, QT, QO), service reports (MSR), and Purchase Orders (PO) from inventory status validation
      // Note: PO is handled separately above with receivedQty logic
      // Credit / debit notes (guru 2026-11-12) adjust MONEY, not stock: nothing
      // leaves or returns to the yard when one is raised, and a CN is routinely
      // a single service line (a pro-rate, a rebate) with no unit behind it at
      // all. Validating them here rejected the save with "Please select
      // inventory items for all rows", and the loop below would only have
      // written timeline rows with an EMPTY status message (newStatus is
      // undefined for every type but DO/RDO).
      const documentTypesExcludedFromInventory = ['QO1', 'QUOTATION', 'QT', 'QO', 'MSR', 'TI', 'TI2', 'INVOICE', 'PO', 'PURCHASE_ORDER', 'CREDIT_NOTE', 'CN', 'DEBIT_NOTE', 'DN'];
      // DO first (manual order flow, 2026-11-13): a DO on an order moves stock only through Complete DO (or its job),
      // and carries service lines and product rows without a unit until then; this save-time block (every row must
      // name a unit, each unit set to rental on every save) does not apply to it.
      const doFirstOrderDo = skipsDoSaveStockRule(
        dto.type || existingDocument.type,
        (dto.config as any)?.orderId ?? (existingDocument.config as any)?.orderId,
        await isManualOrderFlow(this.prisma, organizationId),
      );
      // RDO free-typed rows: rows with no unit are paper only (no stock move).
      const rdoFreeRows = allowsRdoFreeRows(dto.type || existingDocument.type, rdoFreeRowsOn);
      if (!officeDoEdit && !documentTypesExcludedFromInventory.includes(dto.type) && !doFirstOrderDo && dto.config && Array.isArray(dto.config.items)) {
        // PHYSICAL items only — a service row has no unit to point at
        // (guru 2026-11-12). Same rule as the project-assignment block below.
        const itemsWithoutInventory = rdoFreeRows
          ? []
          : dto.config.items.filter(
              (_item) => !_item.isService && (!_item.inventoryItemId || _item.inventoryItemId.trim() === '')
            );

        if (itemsWithoutInventory.length > 0) {
          throw new HttpException(
            'Please select inventory items for all rows before saving the document',
            HttpStatus.BAD_REQUEST
          );
        }

        await Promise.all(
          dto.config.items.map(async (_item) => {
            // RDO free-typed row (no unit): paper only, nothing to look up or move.
            if (rdoFreeRows && !hasUnit(_item)) return;

            // Determine inventory status based on document type (not document status)
            let docMessage = '';
            let statusChangeMessage = '';
            const newStatus: InventoryStatus = dto.type === 'DO' ? InventoryStatus.rental : dto.type === 'RDO' ? InventoryStatus.instock : undefined;

            if (dto.type === 'DO') {
              if (dto.status) {
                // Include status information in the message
                const statusText =
                  dto.status === 'delivered_not_installed' ? 'delivered (not installed)' : dto.status === 'delivered_installed' ? 'delivered and installed' : dto.status.replace(/_/g, ' ');
                docMessage = `A DO document is submitted as ${statusText}`;
              } else {
                docMessage = 'A DO document is updated';
              }
              statusChangeMessage = 'Item has been changed from instock to rental';
            } else if (dto.type === 'RDO') {
              docMessage = 'A RDO document is updated';
              statusChangeMessage = 'Item has been changed from rental to instock';
            } else {
              docMessage = `A ${dto.type} document is updated`;
            }

            // Try to update inventory status - first check if item exists in Inventory table
            const inventoryItem = await this.prisma.inventory.findUnique({
              where: { id: _item.inventoryItemId },
            });

            if (inventoryItem) {
              // Item is in Inventory table (Asset Tracking ON)
              await this.prisma.inventory.update({
                where: {
                  id: _item.inventoryItemId,
                  organizationId,
                },
                data: {
                  status: newStatus,
                },
              });

              // Create timeline item for document update
              await this.prisma.timelineItem.create({
                data: {
                  message: docMessage,
                  pdfUrl: '',
                  inventoryId: _item.inventoryItemId,
                  documentId: id,
                },
              });
              // Create timeline item for status change
              await this.prisma.timelineItem.create({
                data: {
                  message: statusChangeMessage,
                  inventoryId: _item.inventoryItemId,
                  documentId: null,
                  pdfUrl: null,
                },
              });
            } else {
              // Item might be in Asset table (Asset Tracking OFF / Products mode)
              // In this mode, we don't track rental status on assets, just skip the status update
              // Timeline entries are not applicable for assets in this context
              console.log(`Item ${_item.inventoryItemId} not found in Inventory table, skipping status update (likely Asset/Product)`);
            }
          }),
        );
      }

      // A RETURN document lists units LEAVING the project, so nothing here
      // applies to it: creating an assignment would attach a unit as part of
      // collecting it, and the reopen branch below actively UNDID the return —
      // it set endDate null and startDate `dto.config.startDate || null`, and an
      // RDO config has no startDate key, so confirming an RDO wiped BOTH dates
      // on every unit it listed. The block cannot tell an outbound DO (where
      // re-adding a unit should reopen it) from a return, so returns are
      // excluded outright. Both spellings are matched: the stored type is
      // RETURN_DELIVERY_ORDER, but 'RDO' is the variant alias callers pass
      // (same pair public-document.service.ts guards on).
      const isReturnDoc = dto.type === 'RETURN_DELIVERY_ORDER' || dto.type === 'RDO';
      if (!officeDoEdit && projectId && !isReturnDoc && dto.config?.items?.length) {
        // Validate that all PHYSICAL items have inventoryItemId for project
        // assignments — service rows have no unit to assign and are skipped.
        const itemsWithoutInventory = dto.config.items.filter(
          (_item) => !_item.isService && (!_item.inventoryItemId || _item.inventoryItemId.trim() === '')
        );

        if (itemsWithoutInventory.length > 0) {
          throw new HttpException(
            'Please select inventory items for all rows before saving the document',
            HttpStatus.BAD_REQUEST
          );
        }

        await Promise.all(
          dto.config.items.map(async (_item) => {
            if (_item.isService || !_item.inventoryItemId) return;

            // config.items[].inventoryItemId can hold EITHER an Inventory id
            // (serialized unit, Mode A) OR an Asset id (Asset-Tracking-OFF /
            // Products mode, Mode B) — resolve which before creating, else the
            // Assignment_inventoryId_fkey constraint blows up the whole save.
            const inventoryRow = await this.prisma.inventory.findUnique({
              where: { id: _item.inventoryItemId },
              select: { id: true },
            });
            const assetRow = inventoryRow
              ? null
              : await this.prisma.asset.findUnique({
                  where: { id: _item.inventoryItemId },
                  select: { id: true },
                });

            if (!inventoryRow && !assetRow) {
              console.log(
                `Item ${_item.inventoryItemId} not found in Inventory or Asset table, skipping project assignment`,
              );
              return;
            }

            const assignmentWhere: any = { projectId: projectId };
            if (inventoryRow) {
              assignmentWhere.inventoryId = _item.inventoryItemId;
            } else {
              assignmentWhere.assetId = _item.inventoryItemId;
            }

            const existingAssignment = await this.prisma.assignment.findFirst({
              where: assignmentWhere,
            });

            if (!existingAssignment) {
              const assignmentData: any = {
                projectId: projectId,
                startDate: dto.config.startDate || null,
                endDate: dto.config.endDate || null,
              };
              if (inventoryRow) {
                assignmentData.inventoryId = _item.inventoryItemId;
              } else {
                // Asset-mode assignments carry the quantity (no serial per unit)
                assignmentData.assetId = _item.inventoryItemId;
                assignmentData.quantity = Number(_item.quantity) || 1;
                assignmentData.documentId = updatedDocument.id;
              }
              await this.prisma.assignment.create({ data: assignmentData });
            } else if (existingAssignment.endDate) {
              // The unit was soft-closed on this project (e.g. moved off via
              // field-deploy) and is now re-added by this DO. Reopen it —
              // consistent with field-deploy — instead of leaving it closed.
              // ONLY soft-closed rows are touched; an already-active assignment
              // is left exactly as before (the prior no-op skip).
              await this.prisma.assignment.update({
                where: { id: existingAssignment.id },
                data: { endDate: null, startDate: dto.config.startDate || null },
              });
            }
          }),
        );
      }

      // Update Xero invoice if this is a TI (Invoice) document
      if (dto.type === 'TI') {
        console.log('🟡 XERO: Attempting to update invoice for TI document:', updatedDocument.id, 'with status:', dto.status);
        try {
          const xeroResult = await this.updateXeroInvoice(updatedDocument, configAsPlainObject, organizationId);
          console.log('🟢 XERO: Invoice updated successfully!', xeroResult ? `Xero Invoice ID: ${xeroResult.invoiceID}` : 'No invoice ID returned');
        } catch (xeroError) {
          console.error('🔴 XERO: Invoice update failed, but document was updated:', xeroError);
          console.error('🔴 XERO: Error details:', xeroError.message);
          // Don't fail the entire update if Xero fails - just log the error
        }
      } else {
        console.log('⚪ XERO: Skipping invoice update - Document type:', dto.type, 'Status:', dto.status);
      }

      // ── History: diff tracked header fields → one "Edited" entry per save
      // (diff-gated, so autosaves that change nothing log nothing). Status
      // transitions log as Approved / Status changed instead.
      try {
        const oldCfg: any = (existingDocument.config as any) || {};
        const newCfg: any = configAsPlainObject || {};
        // Two config layouts exist: newer editors nest header fields under
        // config.documentInfo; the classic TabbedDocumentCreator saves them
        // FLAT on config itself (referenceNo, documentNumber, nettTotal, …).
        // Diff whichever layout each side actually carries — reading only
        // documentInfo silently logged nothing for flat-config documents.
        const pickInfo = (cfg: any) =>
          cfg?.documentInfo && Object.keys(cfg.documentInfo).length > 0 ? cfg.documentInfo : cfg || {};
        const oldInfo: any = pickInfo(oldCfg);
        const newInfo: any = pickInfo(newCfg);
        const changes: string[] = [];
        // Diff only fields the incoming payload actually CARRIES (newVal
        // undefined = caller didn't send it). Some callers (payment/status
        // flows) send a partial config — without this gate a partial update
        // logged every field as `changed to ""`. Clearing a field still logs:
        // the editor sends "" for cleared fields, not undefined.
        const track = (label: string, oldVal: any, newVal: any) => {
          if (newVal === undefined) return;
          const a = oldVal ?? '';
          const b = newVal ?? '';
          if (String(a) !== String(b)) changes.push(`${label} changed from "${a}" to "${b}"`);
        };
        const hasInfo = newInfo && Object.keys(newInfo).length > 0;
        if (configAsPlainObject && hasInfo) {
          track('Document number', oldInfo.documentNumber, newInfo.documentNumber);
          track('Reference', oldInfo.referenceNo, newInfo.referenceNo);
          track('Terms', oldInfo.paymentTerms, newInfo.paymentTerms);
          // The rest of the legacy header (guru 2026-11-19: an edit after
          // confirm must show WHAT changed — a P/O number typed on a confirmed
          // invoice logged nothing before).
          track('P/O Number', oldInfo.poNo, newInfo.poNo);
          track('D/O Number', oldInfo.doNo, newInfo.doNo);
          track('Salesman', oldInfo.salesPerson, newInfo.salesPerson);
          track('Remarks', oldInfo.remarks, newInfo.remarks);
          track('Deliver to', oldCfg?.deliveryTo, newCfg?.deliveryTo);
          // Dates compared day-precision: create seeds ISO timestamps while the
          // form round-trips yyyy-mm-dd — full-string compare would log a fake
          // change on the first save.
          const day = (v: any) => (v ? String(v).slice(0, 10) : '');
          if (newInfo.date !== undefined && day(oldInfo.date) !== day(newInfo.date)) {
            changes.push(`Date changed from "${day(oldInfo.date)}" to "${day(newInfo.date)}"`);
          }
          if (newInfo.nettTotal !== undefined) {
            const oldTotal = Number(oldInfo.nettTotal ?? 0);
            const newTotal = Number(newInfo.nettTotal ?? 0);
            if (oldTotal.toFixed(2) !== newTotal.toFixed(2)) {
              changes.push(`Total changed from ${oldTotal.toFixed(2)} to ${newTotal.toFixed(2)}`);
            }
          }
          track(
            'Customer',
            oldCfg?.customer?.name ?? oldCfg?.customerName,
            newCfg?.customer?.name ?? newCfg?.customerName,
          );
        }
        // Item-level diffs — for a post-confirm edit these are the changes
        // that actually move money, so "what did the edit change" must cover
        // them, not just header fields. Lines are matched by Product Code
        // (falling back to description); qty/price/description changes,
        // additions and removals each log a change line.
        if (Array.isArray(newCfg.items) && Array.isArray(oldCfg.items)) {
          const label = (it: any, i: number) => it?.itemCode || it?.description || `line ${i + 1}`;
          const sig = (it: any) => (it?.itemCode ? `c:${it.itemCode}` : `d:${it?.description ?? ''}`);
          const num = (v: any) => Number(v ?? 0);
          const remainingOld: any[] = [...oldCfg.items];
          (newCfg.items as any[]).forEach((ni: any, i: number) => {
            const idx = remainingOld.findIndex((oi) => sig(oi) === sig(ni));
            if (idx === -1) {
              changes.push(`Item "${label(ni, i)}" added (qty ${num(ni.quantity)} @ ${num(ni.unitPrice).toFixed(2)})`);
              return;
            }
            const oi = remainingOld.splice(idx, 1)[0];
            if (num(oi.quantity) !== num(ni.quantity)) {
              changes.push(`Item "${label(ni, i)}" quantity changed from ${num(oi.quantity)} to ${num(ni.quantity)}`);
            }
            if (num(oi.unitPrice) !== num(ni.unitPrice)) {
              changes.push(`Item "${label(ni, i)}" unit price changed from ${num(oi.unitPrice).toFixed(2)} to ${num(ni.unitPrice).toFixed(2)}`);
            }
            if (oi.itemCode && String(oi.description ?? '') !== String(ni.description ?? '')) {
              changes.push(`Item "${label(ni, i)}" description changed from "${oi.description ?? ''}" to "${ni.description ?? ''}"`);
            }
          });
          remainingOld.forEach((oi: any, i: number) => {
            changes.push(`Item "${label(oi, i)}" removed (qty ${num(oi.quantity)} @ ${num(oi.unitPrice).toFixed(2)})`);
          });
        }
        const statusChanged = dto.status && dto.status !== existingDocument.status;
        if (statusChanged || changes.length) {
          // Cap entry size — AuditService drops oversized details wholesale.
          const capped = changes.slice(0, 6).map((c) => (c.length > 220 ? `${c.slice(0, 220)}…` : c));
          if (changes.length > 6) capped.push(`…and ${changes.length - 6} more change(s)`);
          const docName =
            newInfo.documentNumber || updatedDocument.name || existingDocument.name || updatedDocument.id;
          const effectiveActor: DocumentActor = {
            id: actor?.id,
            name: actor?.name || (dto as any).savedBy || undefined,
            email: actor?.email,
          };
          void this.logDocumentEvent({
            documentId: updatedDocument.id,
            organizationId,
            action: statusChanged
              ? (dto.status === 'confirmed' ? 'APPROVED' : 'STATUS_CHANGED')
              : wasConfirmedBeforeSave
              ? 'EDITED_AFTER_CONFIRM'
              : 'EDITED',
            detail: statusChanged
              ? `${docName} status changed from ${existingDocument.status} to ${dto.status}`
              : wasConfirmedBeforeSave
              ? `Edited AFTER confirmation: ${capped.join('; ')}`
              : capped.join('; '),
            documentName: docName,
            actor: effectiveActor,
            changes: capped.length ? capped : undefined,
          });
        }
      } catch (historyError) {
        console.error('Document history logging failed (save unaffected):', historyError);
      }

      // Office DO edit: one Activity Log row per save, old -> new per field, who.
      if (officeDoEdit && this.actionLog) {
        const changes = officeDoEditChanges(officeDoBefore, configAsPlainObject ?? existingDocument.config);
        if (changes.length) {
          void this.actionLog.log({
            actorType: 'USER',
            actorId: actor?.id || 'unknown',
            actorName: actor?.name || (dto as any).savedBy || null,
            actorEmail: actor?.email || null,
            organizationId,
            channel: 'web',
            method: 'POST',
            path: '/documents/update',
            action: 'EDITED_AFTER_DELIVERY',
            resource: 'documents',
            resourceId: updatedDocument.id,
            details: { document: existingDocument.name, status: existingDocument.status, changes: changes.slice(0, 40), more: Math.max(0, changes.length - 40) },
          });
        }
      }

      // Sync DocumentItem junction table for efficient item queries
      await this.syncDocumentItems(updatedDocument.id, configAsPlainObject || existingDocument.config, organizationId);

      // Draft-DO commitment (delivery-first #5): a DO that was linked to
      // delivery-run items while still draft/unconfirmed carries NO commerce
      // (no stamp, no deduction, no status mirror). Confirming it is the
      // commitment point — flush the deferred link effects now. Runs AFTER
      // syncDocumentItems so freshly-edited rows exist to bind/stamp against.
      // Best-effort: a commit failure must not fail the save (all sub-ops are
      // idempotent — a re-confirm or re-link can retry).
      if (
        ['DELIVERY_ORDER', 'DO'].includes(existingDocument.type) &&
        dto.status === 'confirmed' &&
        isUnconfirmedDoc(existingDocument.status)
      ) {
        await this.commitLinkedDeliveryItems(updatedDocument.id, organizationId).catch((err) =>
          console.warn(`commitLinkedDeliveryItems on confirm failed for ${updatedDocument.id}: ${err?.message}`),
        );
      }

      // The save itself succeeded. If the ad-hoc hand-off could not run, say so
      // ON THE RESPONSE rather than throwing: the office asked to save a
      // document, and failing the whole save would throw away their pricing and
      // PO to report a delivery-side precondition. Silence is the worse option
      // though — that is how the half state hid in the first place.
      // Round 38: the order the save linked this quotation to (the controller puts it on the Activity Log row).
      const withLink = (r: any) => (linkedToOrder ? { ...r, linkedToOrder } : r);
      if (adHocSummary) {
        const fresh = await this.prisma.document.findUnique({ where: { id: updatedDocument.id }, select: { status: true, name: true } });
        return withLink({ ...updatedDocument, ...(fresh ?? {}), adHocAttach: { ok: true, message: adHocSummary } });
      }
      return withLink(
        adHocWarning
          ? { ...updatedDocument, adHocAttachWarning: adHocWarning, adHocAttach: { ok: false, message: adHocWarning } }
          : updatedDocument,
      );
    } catch (error) {
      // A refusal with its own status (403 locked / locked period, 404, 409 version) passes through as is.
      if (error instanceof HttpException) throw error;
      throw new HttpException(`Update failed: ${error.message}`, HttpStatus.INTERNAL_SERVER_ERROR);
    }
  }

  /**
   * Hand a DO's newly-set project to the AD-HOC delivery run behind it.
   *
   * Returns null when there was nothing to do (not a DO, no project, the
   * document is not on an ad-hoc run, or that run already has a project), or a
   * human-readable reason when the attach was attempted and REFUSED.
   *
   * It never throws. Every refusal attachProjectToAdHocRun raises is a
   * delivery-side precondition — a unit no longer reserved, a project on a
   * different customer, a run already pointed somewhere — and none of them is a
   * reason to reject the document the office is saving. They come back as a
   * warning the editor shows.
   *
   * The link from Document back to Delivery is DeliveryItem.documentId (per-item
   * linking; Delivery.documentId is frozen legacy and deliberately not read).
   * One indexed lookup gives the run and its origin.
   */
  /**
   * Orders list "+" Quotation (round 38, WCT orders): the order a new quotation was made for gets it as its own
   * quotation on the quotation's first save, while the order is still without one and not cancelled (else nothing
   * happens). The order's customer is filled from the quotation when it has none. Never throws (the save stands).
   * Returns the order number when linked.
   */
  private async linkPendingQuotation(orderId: string, organizationId: string, doc: { id: string; name: string | null; config: any }, actor?: DocumentActor): Promise<string | null> {
    try {
      const order = await this.prisma.order.findFirst({ where: { id: orderId, organizationId }, select: { id: true, orderNumber: true, status: true, sourceQuotationId: true, customerId: true, linkedDocuments: true } });
      if (!order || order.sourceQuotationId || order.status === 'CANCELLED' || isImportedOrder(order)) return null;
      const r = await this.prisma.order.updateMany({ where: { id: order.id, organizationId, sourceQuotationId: null }, data: { sourceQuotationId: doc.id } });
      if (!r.count) return null;
      const customerId = docCustomerIdOf(doc.config);
      if (!order.customerId && customerId) await this.prisma.order.updateMany({ where: { id: order.id, organizationId, customerId: null }, data: { customerId } });
      await refreshOrderStatus(this.prisma, organizationId, order.id).catch(() => null);
      void this.logDocumentEvent({ documentId: doc.id, organizationId, action: 'EDITED', detail: `Linked to order ${order.orderNumber}`, documentName: doc.name ?? undefined, actor });
      return order.orderNumber;
    } catch (e: any) {
      console.warn(`linkPendingQuotation ${doc.id} -> ${orderId} failed: ${e?.message}`);
      return null;
    }
  }

  /**
   * Orders list "+" Quotation (round 38, WCT orders, enableWctOrders): a new draft quotation for an AIMS order that
   * has none, prefilled with the order's customer and site, made the way Sales > New quotation makes one
   * (createBasicDocument, the org's quotation numbering). It carries a pending link (PENDING_ORDER_LINK_KEY): its
   * first save links it to the order (linkPendingQuotation). Abandoned unsaved, the order stays as it was.
   */
  async newQuotationForOrder(orderId: string, organizationId: string, actor?: DocumentActor) {
    if (!(await isOrgFeatureEnabled(this.prisma as any, organizationId, 'enableWctOrders'))) throw new HttpException('Orders are not on for this company', HttpStatus.BAD_REQUEST);
    const order: any = await this.prisma.order.findFirst({
      where: { id: orderId, organizationId },
      select: {
        id: true,
        orderNumber: true,
        status: true,
        sourceQuotationId: true,
        linkedDocuments: true,
        customer: { select: { id: true, name: true, customerCode: true, address: true, email: true, phone: true, gstRegNo: true } },
        deliveries: { where: { status: { not: 'cancelled' } }, select: { siteAddress: true, deliveryNumber: true }, orderBy: { deliveryNumber: 'desc' } },
      },
    });
    if (!order) throw new HttpException('Order not found', HttpStatus.NOT_FOUND);
    if (isImportedOrder(order)) throw new HttpException('An imported order keeps its own quotation', HttpStatus.BAD_REQUEST);
    if (order.status === 'CANCELLED') throw new HttpException('This order is cancelled', HttpStatus.BAD_REQUEST);
    const linkedQuotes = Array.isArray(order.linkedDocuments?.quotation) ? order.linkedDocuments.quotation : [];
    if (order.sourceQuotationId || linkedQuotes.length) throw new HttpException(`${order.orderNumber} already has a quotation`, HttpStatus.BAD_REQUEST);
    // The site: the latest job's, else the first DO made on the order.
    let site: string | null = (order.deliveries ?? []).find((j: any) => String(j.siteAddress ?? '').trim())?.siteAddress?.trim() ?? null;
    if (!site) {
      const d: any = await this.prisma.document.findFirst({ where: { organizationId, type: { in: ['DELIVERY_ORDER', 'DO'] }, config: { path: ['orderId'], equals: order.id } } as any, select: { config: true }, orderBy: { createdAt: 'asc' } });
      site = String(d?.config?.deliveryTo ?? d?.config?.location ?? '').trim() || null;
    }
    const c = order.customer;
    const config: any = {
      ...(c
        ? {
            customerId: c.id,
            customerName: c.name,
            ...(c.customerCode ? { customerCode: c.customerCode } : {}),
            ...(c.address ? { customerAddress: c.address } : {}),
            ...(c.email ? { customerEmail: c.email } : {}),
            customer: { id: c.id, name: c.name, customerCode: c.customerCode ?? null, address: c.address ?? null, email: c.email ?? null, phone: c.phone ?? null, gstRegNo: c.gstRegNo ?? null },
          }
        : {}),
      ...(site ? { location: site } : {}),
      [PENDING_ORDER_LINK_KEY]: { orderId: order.id, orderNumber: order.orderNumber, at: new Date().toISOString(), byId: actor?.id ?? null },
    };
    const templateId = await this.resolveTemplateIdForType('QUOTATION', organizationId);
    const doc: any = await this.createBasicDocument(templateId, 'QUOTATION', organizationId, config, undefined, actor);
    const tid = doc?.documentTemplateId ?? templateId;
    return { id: doc.id as string, name: (doc.name ?? null) as string | null, type: 'QUOTATION', orderNumber: order.orderNumber as string, href: `/portal/documents/QUOTATION/${tid}/${doc.id}` };
  }

  private async tryAttachProjectToAdHocRun(
    documentId: string,
    projectId: string | null,
    organizationId: string,
    dtoType: string,
    actor?: DocumentActor,
  ): Promise<{ warning?: string; summary?: string } | null> {
    if (!projectId) return null;
    // Outbound delivery orders only. A return (RDO) off-hires rather than
    // deploys, and every other type has no delivery run behind it.
    if (!['DO', 'DELIVERY_ORDER'].includes(dtoType)) return null;

    try {
      const link = await this.prisma.deliveryItem.findFirst({
        where: { documentId },
        select: {
          delivery: {
            select: { id: true, deliveryNumber: true, origin: true, projectId: true, direction: true },
          },
        },
      });
      const run = link?.delivery;
      if (!run) return null;
      // AD_HOC ONLY, and only while the run is still unassigned. A scheduled run
      // was created with its project already chosen and its DO is committed by
      // commitScheduledRunOnCompletion — attach rejects it, and re-pointing a
      // run that already has a project is a deliberate act, not a side effect of
      // saving a document.
      if (run.origin !== 'AD_HOC' || run.direction === 'RETURN' || run.projectId) return null;

      // The office's save owns this document: attach only fills DO fields that
      // are still empty (customer, Bill To, PO), then deploys, commits and makes
      // the draft invoice exactly as the run page's "Attach project" does.
      const out: any = await this.deliveriesService.attachProjectToAdHocRun(run.id, projectId, organizationId, {
        actor,
        via: 'document-save',
        fillDocument: 'empty-only',
      });
      console.log(
        `updateDocument: handed project ${projectId} to ad-hoc delivery #${run.deliveryNumber} (${run.id})`,
      );
      return { summary: `Delivery #${run.deliveryNumber}: ${out?.attachResult?.summary ?? 'attached to the project.'}` };
    } catch (err: any) {
      const reason = err?.response?.message ?? err?.message ?? 'unknown error';
      console.warn(`tryAttachProjectToAdHocRun failed for document ${documentId}: ${reason}`);
      return { warning: `The document saved, but its delivery run could not be put on this project: ${reason}` };
    }
  }

  /**
   * BACKFILL FIELD CONDITION PHOTOS onto one line of a DO/RDO.
   *
   * The office adds photos a rider never took. They must be INDISTINGUISHABLE
   * from field photos downstream, so they go where field photos go: the line's
   * DO_START MaintenanceServiceReport, in its `photos` array. No flag, no
   * separate table, no marker. The read-time enrichment in getById, the four
   * renderers' photo strips, the run-detail proof cards and the public share
   * link then all pick them up with no changes at all.
   *
   * APPEND, DON'T DUPLICATE — mirroring the field app. Its own late-photo path
   * (deliveries.service.addItemPhotos) pushes onto the EARLIEST existing
   * DO_START and refuses when there is none. This does the same, except that
   * "there is none" is exactly the case being fixed, so it creates one instead.
   *
   * THE ROW MUST CARRY documentId. getById reads photos through the
   * `maintenanceReports` RELATION, which is keyed on documentId — a row with
   * only deliveryId set is invisible to the preview. Field rows get theirs
   * stamped at completion by stampProofMsrDocumentIds; a backfilled row sets it
   * directly, which is also what makes this work on a DO-first document that has
   * no delivery run behind it at all (deliveryId stays null, exactly as the
   * schema's "DO-first rows keep documentId" comment describes).
   *
   * Line addressing follows the same precedence as the enrichment:
   * deliveryItemId (exact — and the ONLY tie a free-typed line has), then
   * inventoryItemId, then description.
   */
  async addFieldPhotosToDocumentLine(
    documentId: string,
    organizationId: string,
    body: {
      deliveryItemId?: string | null;
      inventoryItemId?: string | null;
      description?: string | null;
      // Extra identifiers the editor sends so a stale id cannot strand the call
      // (see FIND THE LINE below).
      lineId?: string | number | null;
      itemCode?: string | null;
      lineIndex?: number | null;
      photos: string[];
    },
    actor: { userId: string | null; name: string | null },
  ) {
    const keys = (body.photos ?? []).map((k) => String(k ?? '').trim()).filter(Boolean);
    if (!keys.length) throw new HttpException('No photos to add', HttpStatus.BAD_REQUEST);

    const doc = await this.prisma.document.findFirst({
      where: { id: documentId, organizationId },
      select: { id: true, type: true, status: true, config: true },
    });
    if (!doc) throw new HttpException('Document not found', HttpStatus.NOT_FOUND);
    // Delivery documents only — condition photos have no meaning on an invoice
    // or a quotation, and DO_START rows on other types would pollute the
    // proof-of-delivery section of whatever document they landed on.
    if (!['DO', 'DELIVERY_ORDER', 'RDO', 'RETURN_DELIVERY_ORDER'].includes(String(doc.type))) {
      throw new HttpException('Condition photos can only be added to a delivery order', HttpStatus.BAD_REQUEST);
    }
    // Confirmed is fine — a photo is evidence, not a commercial term, and the
    // real-world case (the rider did not use the app) usually surfaces after the
    // DO has been confirmed and sent. Only a cancelled document is refused.
    if (String(doc.status) === 'cancelled') {
      throw new HttpException('This document is cancelled', HttpStatus.BAD_REQUEST);
    }

    // ── FIND THE LINE ───────────────────────────────────────────────────────
    // Every identifier the editor can see is tried IN TURN, best first. This
    // used to be an if/else chain on which identifier was SENT: the editor
    // sends all of them, so one present-but-stale id (a unit picked but not yet
    // saved, or an empty-string inventoryItemId on the stored line) made the
    // whole call fail with "that line is not on this document" even though the
    // description matched perfectly (guru 2026-11-05).
    //
    // Description matching is also tolerant now. These lines are RICH TEXT:
    // "<div>G045/0661</div><div>Generator 45KVA</div>" never equalled the plain
    // text the editor round-trips, and a trailing newline was enough to miss.
    // Tags are stripped, entities unescaped and whitespace collapsed on both
    // sides before comparing.
    const plainText = (v: any) =>
      String(v ?? '')
        .replace(/<br\s*\/?>/gi, ' ')
        .replace(/<[^>]*>/g, ' ')
        .replace(/&nbsp;/gi, ' ')
        .replace(/&amp;/gi, '&')
        .replace(/\s+/g, ' ')
        .trim()
        .toLowerCase();
    const norm = (v: any) => String(v ?? '').trim().toLowerCase();
    const lines: any[] = Array.isArray((doc.config as any)?.items) ? (doc.config as any).items : [];
    if (!lines.length) {
      throw new HttpException(
        'This delivery order has no saved lines yet. Save the document first, then add the photos.',
        HttpStatus.BAD_REQUEST,
      );
    }

    const has = (v: any) => v != null && String(v).trim() !== '';
    const finders: Array<() => any> = [
      // Exact ids first.
      () => (has(body.deliveryItemId) ? lines.find((l) => has(l.deliveryItemId) && l.deliveryItemId === body.deliveryItemId) : null),
      () => (has(body.inventoryItemId) ? lines.find((l) => has(l.inventoryItemId) && l.inventoryItemId === body.inventoryItemId) : null),
      // The editor's own row id, which is saved with the line.
      () => (has(body.lineId) ? lines.find((l) => has(l.id) && String(l.id) === String(body.lineId)) : null),
      // Product code, when it is unambiguous on this document.
      () => {
        if (!has(body.itemCode)) return null;
        const ms = lines.filter((l) => norm(l.itemCode) === norm(body.itemCode) || norm(l.sku) === norm(body.itemCode) || norm(l.skuKey) === norm(body.itemCode));
        return ms.length === 1 ? ms[0] : null;
      },
      // Text of the line, compared as plain text.
      () => {
        if (!has(body.description)) return null;
        const want = plainText(body.description);
        if (!want) return null;
        const ms = lines.filter((l) => plainText(l.description) === want);
        return ms.length === 1 ? ms[0] : null;
      },
      // Position, when the editor says which row it was.
      () => (typeof body.lineIndex === 'number' && body.lineIndex >= 0 && body.lineIndex < lines.length ? lines[body.lineIndex] : null),
      // A one-line document can only mean that line.
      () => (lines.length === 1 ? lines[0] : null),
    ];
    let line: any = null;
    for (const find of finders) {
      line = find();
      if (line) break;
    }
    if (!line) {
      // Say what went wrong. The old message named no cause, so the usual
      // reason — edits not saved yet — was impossible to guess.
      throw new HttpException(
        'Could not match that line to this delivery order. If the line was just added or edited, save the document first, then add the photos.',
        HttpStatus.NOT_FOUND,
      );
    }

    const deliveryItemId: string | null = line.deliveryItemId ?? body.deliveryItemId ?? null;
    const inventoryId: string | null = line.inventoryItemId ?? body.inventoryItemId ?? null;

    // The line's existing DO_START, if the rider ever started it. Scoped to THIS
    // document, then narrowed to the line the same way the enrichment does.
    // Earliest wins, matching the field app's `orderBy: createdAt asc`.
    const candidates = await this.prisma.maintenanceServiceReport.findMany({
      where: { documentId, organizationId, kind: 'DO_START' as any },
      orderBy: { createdAt: 'asc' },
      select: { id: true, deliveryItemId: true, inventoryId: true, description: true, photos: true },
    });
    // Same fall-through as FIND THE LINE above, and for the same reason. This
    // used to require BOTH ids to be absent before it would compare the text,
    // so a line carrying a STALE inventoryItemId never matched its own earlier
    // row: that row was written with a null inventoryId (every id is verified
    // before insert, see below), the id rung found nothing, and the text rung
    // was skipped. Each "add photos" therefore created ANOTHER DO_START.
    //
    // That is not just untidy. getById attaches photos to a line by matching
    // DO_START rows, and its description rung only accepts an UNAMBIGUOUS
    // match — so the second row made the line's photos vanish from the DO
    // entirely. Appending to the row that is already there keeps one row per
    // line, which is what both the display and the field app expect.
    const sameLineText = (r: { description: string | null }) =>
      plainText(String(r.description ?? '').replace(/^(delivery|return) started:\s*/i, '')) === plainText(line.description);
    const existing =
      (deliveryItemId ? candidates.find((r) => r.deliveryItemId === deliveryItemId) : null) ??
      (inventoryId ? candidates.find((r) => r.inventoryId === inventoryId) : null) ??
      (line.description ? candidates.find((r) => !r.deliveryItemId && !r.inventoryId && sameLineText(r)) : null) ??
      (line.description ? candidates.find(sameLineText) : null) ??
      null;

    if (existing) {
      const updated = await this.prisma.maintenanceServiceReport.update({
        where: { id: existing.id },
        data: { photos: { push: keys } },
        select: { id: true, photos: true },
      });
      return { reportId: updated.id, added: keys.length, total: updated.photos.length, created: false };
    }

    // No DO_START for this line — create one in the field's exact shape.
    //
    // EVERY FK IS VERIFIED BEFORE IT IS WRITTEN. A DO config line is a SNAPSHOT:
    // it keeps whatever ids were true when it was built, and those rows can go
    // away underneath it. updateScheduled regenerates a run's DeliveryItems
    // (delete + recreate, so the same unit gets a NEW id), and cleanup scripts
    // have deleted DeliveryItems while documents kept pointing at them. 4 of the
    // 27 lines carrying a deliveryItemId org-wide are already stale this way.
    //
    // Writing a stale id straight through is what produced
    //   Foreign key constraint violated: MaintenanceServiceReport_deliveryItemId_fkey
    // on DO-PENDING-02's LION250 line, whose stored deliveryItemId
    // (c9694427…) no longer exists while the unit is very much alive on a
    // NEWER DeliveryItem for the same run.
    //
    // Every one of these columns is NULLABLE, so a missing row becomes null
    // rather than a 500. Nothing is lost by that: the getById enrichment matches
    // photos to lines by deliveryItemId → inventoryItemId → serial →
    // description, so a null deliveryItemId simply falls through to the next
    // rung. A line whose unit still exists (the common case, and DO-PENDING-02's
    // case) keeps matching exactly.
    const verifiedDeliveryItem = deliveryItemId
      ? await this.prisma.deliveryItem.findFirst({
          where: { id: deliveryItemId },
          select: { id: true, deliveryId: true, assetId: true, delivery: { select: { organizationId: true } } },
        })
      : null;
    // Org-scoped too: an id that exists but belongs to another tenant must not
    // be written any more than one that does not exist at all.
    const safeDeliveryItem =
      verifiedDeliveryItem && verifiedDeliveryItem.delivery?.organizationId === organizationId
        ? verifiedDeliveryItem
        : null;
    if (deliveryItemId && !safeDeliveryItem) {
      console.warn(
        `addFieldPhotosToDocumentLine: document ${documentId} line carries a stale deliveryItemId ${deliveryItemId} — writing null and relying on the inventoryId/serial/description fallbacks`,
      );
    }

    const safeInventory = inventoryId
      ? await this.prisma.inventory.findFirst({ where: { id: inventoryId, organizationId }, select: { id: true, assetId: true } })
      : null;
    if (inventoryId && !safeInventory) {
      console.warn(`addFieldPhotosToDocumentLine: document ${documentId} line carries a stale inventoryItemId ${inventoryId} — writing null`);
    }

    // Asset: the line's own, else the verified DeliveryItem's, else the verified
    // unit's — and then confirmed to exist in this org before it is written.
    const assetCandidate: string | null =
      (line.assetId ?? null) || safeDeliveryItem?.assetId || safeInventory?.assetId || null;
    const safeAsset = assetCandidate
      ? await this.prisma.asset.findFirst({ where: { id: assetCandidate, organizationId }, select: { id: true } })
      : null;
    if (assetCandidate && !safeAsset) {
      console.warn(`addFieldPhotosToDocumentLine: document ${documentId} line carries a stale assetId ${assetCandidate} — writing null`);
    }

    // deliveryId only ever comes from a VERIFIED DeliveryItem, so it cannot be
    // stale independently — but it is read back off the run to be certain the
    // delivery itself still exists.
    const safeDelivery = safeDeliveryItem?.deliveryId
      ? await this.prisma.delivery.findFirst({
          where: { id: safeDeliveryItem.deliveryId, organizationId },
          select: { id: true },
        })
      : null;

    const isReturn = ['RDO', 'RETURN_DELIVERY_ORDER'].includes(String(doc.type));

    const created = await this.prisma.maintenanceServiceReport.create({
      data: {
        organizationId,
        // The office user stands in for the technician, exactly as they would if
        // they had been the one holding the phone. No separate actor kind: the
        // whole point is that the row is shaped like any other DO_START.
        technicianUserId: actor.userId ?? 'office',
        ...(actor.name ? { technicianName: actor.name } : {}),
        kind: 'DO_START' as any,
        status: 'draft' as any, // DO_START is unsigned proof
        documentId,
        // Only verified ids reach the insert; anything stale is simply omitted
        // (the column defaults to null).
        ...(safeDelivery ? { deliveryId: safeDelivery.id } : {}),
        ...(safeDeliveryItem ? { deliveryItemId: safeDeliveryItem.id } : {}),
        ...(safeInventory ? { inventoryId: safeInventory.id } : {}),
        ...(safeAsset ? { assetId: safeAsset.id } : {}),
        description: `${isReturn ? 'Return started' : 'Delivery started'}: ${line.description ?? 'line'}`,
        photos: keys,
      },
      select: { id: true, photos: true },
    });
    return { reportId: created.id, added: keys.length, total: created.photos.length, created: true };
  }

  /**
   * Attach, move, or detach a quotation or delivery-order document's Project link.
   * - projectId = "<uuid>" : link / re-link (overwrite if already linked).
   * - projectId = null     : unlink (set Document.projectId to null).
   */
  async linkProjectToDocument(
    documentId: string,
    projectId: string | null,
    organizationId: string,
    actor?: DocumentActor,
  ) {
    const doc = await this.prisma.document.findFirst({
      where: { id: documentId, organizationId },
      select: { id: true, name: true, type: true, projectId: true, config: true },
    });
    if (!doc) throw new HttpException('Document not found', HttpStatus.NOT_FOUND);
    assertNotErpImportedDo(doc);
    // DO rows are stored as type 'DO'; some paths also use 'DELIVERY_ORDER'
    // (see the project page DO filter), so accept both.
    if (!['QUOTATION', 'DO', 'DELIVERY_ORDER'].includes(doc.type)) {
      throw new HttpException(
        `Only quotations and delivery orders can be linked to a project (got "${doc.type}")`,
        HttpStatus.BAD_REQUEST,
      );
    }
    let projectName: string | null = null;
    if (projectId !== null) {
      const project = await this.prisma.project.findFirst({
        where: { id: projectId, organizationId },
        select: { id: true, name: true },
      });
      if (!project) throw new HttpException('Project not found', HttpStatus.NOT_FOUND);
      projectName = project.name;
    }

    const updated = await this.prisma.document.update({
      where: { id: documentId },
      data: { projectId },
      select: { id: true, name: true, type: true, status: true, projectId: true, createdAt: true, updatedAt: true },
    });

    // Only log actual link changes (the editor re-sends the same link on save).
    if (doc.projectId !== projectId) {
      void this.logDocumentEvent({
        documentId,
        organizationId,
        action: 'EDITED',
        detail: projectId ? `Linked to project "${projectName}"` : 'Unlinked from project',
        documentName: updated.name || undefined,
        actor,
      });
    }

    return updated;
  }

  /** Split payment (features.enableInvoiceSplit): a draft invoice into parts <number>-1..-n. See invoice-split-ops.ts. */
  async splitInvoice(id: string, organizationId: string, plan: SplitPlan, actor?: DocumentActor) {
    return splitInvoiceOp(this.prisma, organizationId, id, plan, actor, (e) => this.logDocumentEvent(e));
  }

  /** Undo split: every part still a draft with no payment; parts 2..n removed, part 1 back to its number. */
  async undoInvoiceSplit(id: string, organizationId: string, actor?: DocumentActor) {
    return undoInvoiceSplitOp(this.prisma, organizationId, id, actor, (e) => this.logDocumentEvent(e));
  }

  /**
   * DELETE A DOCUMENT — draft / unconfirmed work only (guru 2026-11-18).
   *
   * This used to delete anything it was handed, whatever its status, voiding
   * the journal on the way out. Heimen duplicated a confirmed September
   * invoice and then deleted the original: BIPL-JPSG-20260909-0001, Keller,
   * 30,101.80, issued to the customer and posted — gone from AIMS with one
   * audit row left behind, recoverable only from Xero. The LIST pages have
   * always said "drafts only" and the editor only offers delete on unsaved
   * work, but nothing enforced it where it matters, so one stray call took a
   * live receivable with it.
   *
   * A document that has been confirmed, has money recorded against it, or
   * holds a live journal is VOIDED or credited, never deleted. An internal
   * caller that genuinely must remove a posted document passes force.
   */
  /**
   * Soft delete of a draft (WCT group, enableSoftDeleteDrafts): never an imported or sent one. The row stays with its
   * number (a gap in the sequence, never handed out again) as type DELETED (so no list, order, count or queue shows
   * it; config.softDeleted keeps the type and who / when); it leaves any order it was on and that order's status is
   * worked out again. Document history + Activity Log (the DELETE request) record it.
   */
  async softDeleteDraft(id: string, organizationId: string, actor?: DocumentActor) {
    const doc: any = await this.prisma.document.findFirst({ where: { id, organizationId }, select: { id: true, name: true, type: true, status: true, config: true } });
    if (!doc) throw new NotFoundException('Document not found');
    const what = doc.name || 'This document';
    if (isErpImported(doc.config)) throw new BadRequestException(`${what} was imported from the old ERP: it is never deleted.`);
    const [signLinks, sent] = await Promise.all([
      (this.prisma as any).documentSignLink?.count({ where: { documentId: id } }).catch(() => 0) ?? 0,
      this.prisma.auditLog.count({ where: { organizationId, resource: 'document', action: 'SENT', resourceId: id } }).catch(() => 0),
    ]);
    if (signLinks > 0 || sent > 0) throw new BadRequestException(`${what} was sent to the customer: void or cancel it instead.`);
    const docType = String(doc.type || '').toUpperCase();
    const isInvoice = ['INVOICE', 'TI', 'TI2', 'TAX_INVOICE', 'INV'].includes(docType);
    // A DO a live job carries stays (the job's lines point at it; a hidden DO would leave the job without its DO).
    if (docType === 'DELIVERY_ORDER' || docType === 'DO') {
      const item: any = await this.prisma.deliveryItem.findFirst({
        where: { documentId: id, delivery: { organizationId, status: { not: 'cancelled' } } } as any,
        select: { delivery: { select: { deliveryNumber: true } } },
      });
      if (item) throw new BadRequestException(`${what} is the DO of job #${item.delivery?.deliveryNumber ?? ''}: cancel the job first.`);
    }
    const at = new Date().toISOString();
    const orderIds = await this.prisma.$transaction(async (tx: any) => {
      await tx.document.update({
        where: { id },
        data: { type: SOFT_DELETED_TYPE, config: { ...(doc.config || {}), softDeleted: { type: doc.type, name: doc.name, at, by: actor?.id ?? null, byName: actor?.name ?? null } } },
      });
      // Off every order it sits on (link lists; documents made on an order point back with config.orderId).
      const orders: Array<{ id: string; linkedDocuments: any }> = await tx.$queryRaw`
        SELECT o.id, o."linkedDocuments" FROM "Order" o
        WHERE o."organizationId" = ${organizationId} AND (o."linkedDocuments"::text LIKE ${'%' + id + '%'} OR o.id::text = ${String(doc.config?.orderId ?? '')})`;
      for (const o of orders) {
        const ld: any = o.linkedDocuments && typeof o.linkedDocuments === 'object' ? { ...o.linkedDocuments } : {};
        let changed = false;
        for (const k of Object.keys(ld)) {
          if (!Array.isArray(ld[k])) continue;
          const kept = ld[k].filter((x: any) => !(x && (x.id === id || x === id)));
          if (kept.length !== ld[k].length) {
            ld[k] = kept;
            changed = true;
          }
        }
        if (changed) await tx.order.update({ where: { id: o.id }, data: { linkedDocuments: ld } });
      }
      // An invoice leaves no stale id behind (round 24): the order invoice, the jobs and the DOs billed on it are
      // unbilled again (only where they point at exactly this invoice), and their orders are read again below.
      const touched: string[] = [];
      if (isInvoice) {
        const heads: Array<{ id: string }> = await tx.order.findMany({ where: { organizationId, invoiceDocumentId: id }, select: { id: true } });
        if (heads.length) await tx.order.updateMany({ where: { organizationId, invoiceDocumentId: id }, data: { invoiceDocumentId: null } });
        const jobs: Array<{ id: string; orderId: string | null }> = await tx.delivery.findMany({ where: { organizationId, orderInvoiceId: id }, select: { id: true, orderId: true } });
        if (jobs.length) await tx.delivery.updateMany({ where: { organizationId, orderInvoiceId: id }, data: { orderInvoiceId: null } });
        const dos: Array<{ id: string; config: any }> = await tx.document.findMany({
          where: { organizationId, type: { in: ['DELIVERY_ORDER', 'DO'] }, config: { path: ['orderInvoiceId'], equals: id } },
          select: { id: true, config: true },
        });
        const billedDos = dos.filter((d) => d.config?.orderInvoiceId === id);
        for (const d of billedDos) {
          const { orderInvoiceId: _gone, ...rest } = d.config || {};
          await tx.document.update({ where: { id: d.id }, data: { config: rest } });
        }
        touched.push(...heads.map((o) => o.id), ...jobs.map((j) => j.orderId).filter((v): v is string => !!v), ...billedDos.map((d) => d.config?.orderId).filter((v: unknown): v is string => typeof v === 'string' && !!v));
      }
      return [...new Set([...orders.map((o) => o.id), ...touched])];
    });
    for (const oid of orderIds) await refreshOrderStatus(this.prisma, organizationId, oid).catch(() => null);
    void this.logDocumentEvent({ documentId: id, organizationId, action: 'DELETED', detail: `${what} deleted (hidden; its number is kept as a gap)`, documentName: doc.name || undefined, actor });
    return { id, name: doc.name, type: doc.type, deleted: true, soft: true };
  }

  async deleteDocument(id: string, organizationId: string, actor?: DocumentActor, opts?: { force?: boolean; untouched?: boolean }) {
    try {
      // An imported (old-ERP) DO is never deleted through the app, not even by an internal force delete.
      assertNotErpImportedDo(await this.prisma.document.findFirst({ where: { id, organizationId }, select: { type: true, config: true } }));
      if (!opts?.force) {
        const doc = await this.prisma.document.findFirst({
          where: { id, organizationId },
          select: { id: true, name: true, type: true, status: true, config: true, createdAt: true },
        });
        if (!doc) throw new NotFoundException('Document not found');
        assertRecordUnlocked(doc, 'deleted');
        if (isPeriodLockedDocType(doc.type)) {
          await assertPeriodOpen(this.prisma, { organizationId, date: documentDay(doc.config, doc.createdAt), actorId: actor?.id, what: doc.name || 'This document', verb: 'deleted' });
        }
        const status = String(doc.status || '').toLowerCase();
        const isDraft = status === '' || status === 'draft' || status === 'unconfirmed' || status === 'rejected';
        const what = doc.name || 'This document';
        if (!isDraft) {
          throw new BadRequestException(
            `${what} is ${status.replace(/_/g, ' ')} — a confirmed document is voided or credited, never deleted.`,
          );
        }
        const [paid, jes] = await Promise.all([
          this.prisma.payment.count({ where: { organizationId, documentId: id } }),
          this.prisma.journalEntry.count({ where: { organizationId, sourceDocumentId: id, status: { not: 'VOID' } } }),
        ]);
        if (paid > 0) throw new BadRequestException(`${what} has payments recorded against it — remove those first.`);
        if (jes > 0) throw new BadRequestException(`${what} is posted to the ledger — void its journal first.`);
        // WCT group (enableSoftDeleteDrafts, Elroy 2026-11-19): a person's Delete hides the draft and keeps its
        // number as a gap. The editor's discard of an untouched empty new draft (?discard=untouched) stays a real delete.
        if (!opts?.untouched && (await isOrgFeatureEnabled(this.prisma, organizationId, SOFT_DELETE_DRAFTS_FLAG).catch(() => false))) {
          return await this.softDeleteDraft(id, organizationId, actor);
        }
      }

      // No-draft model: a saved document may already sit in the GL — void its
      // journal (reversing entry preserved) before the document row goes away.
      try {
        const doomed = await this.prisma.document.findFirst({ where: { id, organizationId }, select: { type: true } });
        const jeType = doomed ? DocumentsService.SAVE_GL_TYPES[(doomed.type || '').toUpperCase()] : undefined;
        if (jeType) {
          const existing = await this.journalAutoPost.alreadyPostedForDocument(organizationId, id, jeType);
          if (existing) await this.journalService.void(organizationId, existing.id, actor?.id);
        }
      } catch (error) {
        console.error('Failed voiding GL entry during document delete:', error);
        // Continue with document deletion even if the void fails
      }

      // Delete the document
      const deleted = await this.prisma.document.delete({
        where: {
          id,
          organizationId, // Ensure user can only delete documents in their organization
        },
      });

      // History rows outlive the document (AuditLog has no FK to Document).
      void this.logDocumentEvent({
        documentId: id,
        organizationId,
        action: 'DELETED',
        detail: `${deleted.name || id} deleted`,
        documentName: deleted.name || undefined,
        actor,
      });

      // If this document held the LAST serial its number-format handed out
      // (typical for the editor's auto-delete of untouched drafts), roll the
      // counter back so the next document reuses the number.
      try {
        const released = await this.documentNumbering.releaseNumberIfLatest(
          organizationId,
          deleted.type,
          deleted.name,
        );
        if (released) {
          console.log(`[numbering] released serial of deleted document ${deleted.name}`);
        }
      } catch (e: any) {
        console.warn('[numbering] serial release failed (delete unaffected):', e?.message);
      }

      return deleted;
    } catch (error) {
      throw new HttpException(`Delete failed: ${error.message}`, HttpStatus.INTERNAL_SERVER_ERROR);
    }
  }

  async createDocumentWithTimeline(dto: CreateDocumentWithTimelineDto, organizationId: string) {
    return this.prisma.$transaction(async (tx) => {
      try {
        const configAsPlainObject: any = dto.config ? dto.config : null;

        // Handle captured images - ensure they are stored as URLs
        if (configAsPlainObject?.capturedImages && Array.isArray(configAsPlainObject.capturedImages)) {
          // The capturedImages should already be S3 URLs from the frontend
          // Just ensure they are properly stored in the config
          console.log('Captured images to be stored:', configAsPlainObject.capturedImages);
        }

        // Handle MSR photos - ensure they are stored as URLs
        if (configAsPlainObject?.photos && Array.isArray(configAsPlainObject.photos)) {
          // The photos should already be S3 URLs from the frontend
          // Just ensure they are properly stored in the config
          console.log('MSR photos to be stored:', configAsPlainObject.photos.length, 'photos');
        }

        const createdDocument = await tx.document.create({
          data: {
            documentTemplateId: dto.documentTemplateId,
            type: dto.type || 'Default',
            config: configAsPlainObject,
            organizationId, // Automatically assign to user's organization
            name: dto.name, // Include document name if provided
          },
        });

        // Only process items for non-MSR documents
        if (dto.config.items && Array.isArray(dto.config.items) && dto.type !== 'MSR') {
          // Validate that all items have inventoryItemId.
          // Same carve-outs as the update path above: quotations are priced
          // before any unit is picked, and credit / debit notes adjust money
          // rather than stock (guru 2026-11-12).
          // RDO free-typed rows (enableRdoFreeTypedRows): rows with no unit are paper only.
          const rdoFreeRows = allowsRdoFreeRows(
            dto.type,
            isRdoType(dto.type) ? await isOrgFeatureEnabled(tx as any, organizationId, RDO_FREE_ROWS_FLAG) : false,
          );
          if (!rdoFreeRows && !['QO1', 'QUOTATION', 'QT', 'QO', 'CREDIT_NOTE', 'CN', 'DEBIT_NOTE', 'DN'].includes(dto.type)) {
            const itemsWithoutInventory = dto.config.items.filter(
              (_item: any) => !_item.isService && (!_item.inventoryItemId || _item.inventoryItemId.trim() === '')
            );

            if (itemsWithoutInventory.length > 0) {
              throw new HttpException(
                'Please select inventory items for all rows before saving the document',
                HttpStatus.BAD_REQUEST
              );
            }
          }

          await Promise.all(
            dto.config.items.map(async (_item) => {
              // RDO free-typed row (no unit): paper only, nothing to move.
              if (rdoFreeRows && !hasUnit(_item)) return;
              // Determine new inventory status and timeline messages based on document type
              let newStatus: InventoryStatus = InventoryStatus.instock;
              let docMessage = 'A RDO document is submitted';
              let statusChangeMessage = 'Item has been changed from rental to instock';
              console.log('Document Type:', JSON.stringify(dto.type, null, 2));
              if (dto.type === 'DO') {
                newStatus = InventoryStatus.rental;
                docMessage = 'A DO document is submitted';
                statusChangeMessage = 'Item has been changed from instock to rental';
              }

              // Update inventory status
              await tx.inventory.update({
                where: {
                  id: _item.inventoryItemId,
                  organizationId, // Ensure inventory belongs to the same organization
                },
                data: {
                  status: newStatus,
                },
              });
              // No need to connect inventory anymore as it's stored in config
              // Create timeline item for document submission
              await tx.timelineItem.create({
                data: {
                  message: docMessage,
                  pdfUrl: '',
                  inventoryId: _item.inventoryItemId,
                  documentId: createdDocument.id,
                },
              });

              // Create timeline item for status change
              await tx.timelineItem.create({
                data: {
                  message: statusChangeMessage,
                  inventoryId: _item.inventoryItemId,
                  documentId: null,
                  pdfUrl: null,
                },
              });
            }),
          );
        }

        // Create Xero invoice if this is a TI (Invoice) document and status is not unconfirmed
        if (dto.type === 'TI' && !isUnconfirmedDoc(dto.status)) {
          console.log('🟡 XERO: Attempting to create invoice for TI document:', createdDocument.id, 'with status:', dto.status);
          try {
            const xeroResult = await this.createXeroInvoice(createdDocument, configAsPlainObject, organizationId);
            console.log('🟢 XERO: Invoice created successfully!', xeroResult ? `Xero Invoice ID: ${xeroResult.invoiceID}` : 'No invoice ID returned');
          } catch (xeroError) {
            console.error('🔴 XERO: Invoice creation failed, but document was created:', xeroError);
            console.error('🔴 XERO: Error details:', xeroError.message);
            // Don't fail the entire transaction if Xero fails - just log the error
          }
        } else {
          console.log('⚪ XERO: Skipping invoice creation - Document type:', dto.type, 'Status:', dto.status);
        }

        return createdDocument;
      } catch (error) {
        throw new HttpException(`Update failed: ${error.message}`, HttpStatus.INTERNAL_SERVER_ERROR);
      }
    }).then(async (createdDocument) => {
      // Sync DocumentItem junction table after transaction completes
      await this.syncDocumentItems(createdDocument.id, dto.config, organizationId);
      return createdDocument;
    });
  }
  /**
   * Claim the REAL sequential number for a *-PENDING-NN placeholder document
   * (DO / RDO) the first time it reaches its terminal state without a manual
   * confirm. Mirrors the DO claim in maybeCompleteDeliveryOrderAndInvoice so a
   * scheduled RDO renames from RDO-PENDING-NN to the real number at completion.
   * IDEMPOTENT: a document already numbered (no PENDING suffix) is left as-is and
   * its existing name returned. Returns null when the document is not found.
   */
  async claimPendingNumber(documentId: string, organizationId: string): Promise<string | null> {
    const doc = await this.prisma.document.findFirst({
      where: { id: documentId, organizationId },
      select: { name: true, type: true, documentTemplateId: true, config: true },
    });
    if (!doc) return null;
    if (typeof doc.name === 'string' && /-PENDING-\d+$/.test(doc.name)) {
      const realName = await this.generateSequentialDocumentName(
        organizationId,
        doc.type,
        doc.documentTemplateId,
        doc.config,
        new Date(),
      );
      await this.prisma.document.update({ where: { id: documentId }, data: { name: realName } });
      return realName;
    }
    return doc.name ?? null;
  }

  /**
   * enableRealDoOnSchedule (WCT 2026-10-30): create a scheduled run's DO under
   * its REAL number straight away (no DO-PENDING-NN placeholder). The number is
   * issued with the format's counter locked (issueNumberLocked), so concurrent
   * schedules get different numbers. Other paths still mint DO numbers without
   * that lock (the editor's New DO, a different template), so a clash is still
   * possible in principle: a unique-key failure retries with a fresh number,
   * and a same-name DO elsewhere in the org renames THIS one (just created,
   * nobody has seen it) to a fresh number. Orgs without a DO number format fall
   * back to the legacy prefix + serial.
   */
  async createNumberedDeliveryOrder(
    templateId: string,
    organizationId: string,
    config: any,
    projectId?: string,
  ) {
    const issue = async () =>
      (await this.documentNumbering.issueNumberLocked(organizationId, 'DELIVERY_ORDER', (config as any)?.numberFormatId ?? null)) ??
      (await this.generateSequentialDocumentName(organizationId, 'DELIVERY_ORDER', templateId, config, new Date()));
    const clashes = (name: string, id: string) =>
      this.prisma.document.count({ where: { organizationId, type: 'DELIVERY_ORDER', name, id: { not: id } } });
    for (let attempt = 1; attempt <= 5; attempt++) {
      const name = await issue();
      let doc;
      try {
        doc = await this.createBasicDocument(templateId, 'DELIVERY_ORDER', organizationId, config, projectId, undefined, name);
      } catch (e: any) {
        if (attempt < 5 && /unique constraint/i.test(String(e?.message))) continue;
        throw e;
      }
      for (let rename = 1; (await clashes(doc.name!, doc.id)) > 0; rename++) {
        if (rename > 5) throw new HttpException(`DO number ${doc.name} is already in use — please retry`, HttpStatus.CONFLICT);
        const fresh = await issue();
        const before = doc.name;
        doc = await this.prisma.document.update({ where: { id: doc.id }, data: { name: fresh } });
        void this.logDocumentEvent({
          documentId: doc.id,
          organizationId,
          action: 'EDITED',
          detail: `Renumbered ${before} → ${fresh}: ${before} was taken at the same moment`,
          documentName: fresh,
        });
      }
      return doc;
    }
    throw new HttpException('Could not issue a DO number — please retry', HttpStatus.CONFLICT);
  }

  /**
   * Compute the next sequential document "number" (= Document.name) for a type,
   * using the SAME scheme as createBasicDocument: the org's custom
   * DocumentNumberFormat variant when one exists (claims its serial), else the
   * legacy prefix+serial from the max existing name. Used to claim a REAL number
   * for a placeholder-named draft at confirm (OSI-83).
   */
  // Public: PublicSignService allocates a confirm-time number for unnumbered
  // skip-numbering drafts (ID quotations) when the client signs.
  async generateSequentialDocumentName(
    organizationId: string,
    type: string,
    documentTemplateId: string,
    config: any,
    now: Date,
  ): Promise<string> {
    const organization = await this.prisma.organization.findUnique({
      where: { id: organizationId },
      select: { customDocumentTypes: true },
    });
    const documentTemplate = await this.prisma.documentTemplate.findUnique({
      where: { id: documentTemplateId },
      select: { templateVariant: true },
    });
    const year = now.getFullYear();
    const month = String(now.getMonth() + 1).padStart(2, '0');
    const customTypes = organization?.customDocumentTypes as Record<string, string> | null;
    const documentPrefix = documentTemplate?.templateVariant || customTypes?.[type] || type;
    const namePrefix = `${documentPrefix}${year}${month}-`;
    // ORG-WIDE, deliberately NOT scoped to documentTemplateId. The prefix comes
    // from templateVariant, which several templates SHARE (Biofuel has ten
    // quotation templates all on "QO1"). Scoping the scan to one template gave
    // each its own namespace under a shared prefix, so every template's first
    // document of a month took -001 and collided with its siblings'. That is
    // how QO1202607-001 came to exist three times, and RDO202609-001/-002
    // twice each. DocumentNumberingService.maxExistingSerial has always scanned
    // org-wide by name prefix; this now matches it.
    const existingDocs = await this.prisma.document.findMany({
      where: { organizationId, name: { startsWith: namePrefix }, baseDocumentId: null },
      select: { name: true },
    });
    // NUMERIC max, not `orderBy name desc + take 1`. Widening the scan can now
    // pull in names of differing serial width under one prefix, where a
    // lexicographic max picks "-0010" over "-002". Compare the parsed integers.
    let nextSerial = 1;
    // Split payment parts (INV…-005-2, config.invoiceSplit) count as their base serial (005), not as 2.
    const partNames = existingDocs.map((d) => d.name || '').filter((n) => /^\d+-\d+$/.test(n.slice(namePrefix.length)));
    const parts = new Set(partNames.length ? await splitPartNamesAmong(this.prisma as any, organizationId, partNames) : []);
    for (const d of existingDocs) {
      const name = (d.name || '').replace(/-R\d+$/, ''); // a "-Rn" revision holds its serial
      const match = parts.has(name) ? name.slice(namePrefix.length).match(/^(\d+)-/) : name.match(/-(\d+)$/);
      if (match) nextSerial = Math.max(nextSerial, parseInt(match[1], 10) + 1);
    }
    let name = `${namePrefix}${String(nextSerial).padStart(3, '0')}`;
    try {
      const numberFormatId = (config as any)?.numberFormatId ?? null;
      const custom = await this.documentNumbering.generateNumber(organizationId, type, numberFormatId, now);
      if (custom) name = custom;
    } catch (e: any) {
      console.warn('[numbering] custom format failed, using legacy name:', e?.message);
    }
    return name;
  }

  async createBasicDocument(
    documentTemplateId: string,
    type: string,
    organizationId: string,
    config: any = {},
    projectId?: string,
    actor?: DocumentActor,
    nameOverride?: string,
    // Round 36 (WCT group order invoices, createOrderInvoice): the number is claimed INSIDE the transaction that
    // writes the row (document-numbering/locked-number.ts), retried on a clash. Absent = unchanged for every caller.
    opts: { lockedNumber?: boolean } = {},
  ) {
    // The serial is claimed BEFORE the row is written. If the write then fails
    // the number is gone for good — eight JPSG invoice numbers (0057-0064)
    // were burned this way on 2026-10-19, leaving a gap an auditor will ask
    // about. Remember what we claimed so the catch can hand it back.
    let claimedName: string | undefined;
    try {
      console.log('Creating basic document with template ID:', documentTemplateId, 'Type:', type, 'Organization ID:', organizationId, 'Config:', config, 'ProjectId:', projectId);

      // If projectId is supplied, validate it belongs to this org and prefill
      // customer info into the config when the caller didn't pass one. Empty-
      // field-only fill so explicit customer choices in the config are never
      // overwritten.
      let resolvedProject: { id: string; customer: any } | null = null;
      if (projectId) {
        const project = await this.prisma.project.findFirst({
          where: { id: projectId, organizationId },
          select: {
            id: true,
            customer: { select: { id: true, name: true, customerCode: true, email: true, phone: true, address: true, gstRegNo: true } },
          },
        });
        if (!project) {
          throw new HttpException('Project not found in this organization', HttpStatus.NOT_FOUND);
        }
        resolvedProject = project;
      }

      // Get organization to check for custom document types and defaults (logo, stamp)
      const organization = await this.prisma.organization.findUnique({
        where: { id: organizationId },
        select: {
          customDocumentTypes: true,
          logo: true,
          defaultStamp: true,
          // Org-wide tax + currency defaults seeded onto documentInfo on new docs.
          taxRate: true,
          taxApplicable: true,
          absorbTax: true,
          defaultCurrency: true,
          // Per-doc-type boilerplate (T&Cs / Notes / Footer message).
          docTypeDefaults: true,
        },
      });

      // Get document template to use templateVariant for naming + inherit
      // column layout (tableColumnOrder/columnLabels) so per-template item
      // table layouts (e.g. FCU/CU Quotation) take effect on new docs.
      const documentTemplate = await this.prisma.documentTemplate.findUnique({
        where: { id: documentTemplateId },
        select: { templateVariant: true, config: true },
      });

      const now = new Date();
      const year = now.getFullYear();
      const month = String(now.getMonth() + 1).padStart(2, '0');

      // Use templateVariant for document name prefix (e.g., "SO" instead of "SALES_ORDER")
      // Falls back to custom document types, then to the original type
      const customTypes = organization?.customDocumentTypes as Record<string, string> | null;
      const documentPrefix = documentTemplate?.templateVariant || customTypes?.[type] || type;
      const namePrefix = `${documentPrefix}${year}${month}-`;

      // Find the highest serial for this prefix, ORG-WIDE and not scoped to
      // documentTemplateId — see generateSequentialDocumentName for why: the
      // prefix comes from templateVariant, which templates share, so a
      // per-template scan handed the same number to siblings. Revision
      // documents are excluded via baseDocumentId: null, as before.
      const existingDocs = await this.prisma.document.findMany({
        where: {
          organizationId,
          name: {
            startsWith: namePrefix,
          },
          baseDocumentId: null,
        },
        select: { name: true },
      });

      // Numeric max — a lexicographic one mis-ranks mixed serial widths, which
      // the widened scan can now surface under a single prefix.
      let nextSerial = 1;
      // Split payment parts (INV…-005-2, config.invoiceSplit) count as their base serial (005), not as 2.
      const partNames = existingDocs.map((d) => d.name || '').filter((n) => /^\d+-\d+$/.test(n.slice(namePrefix.length)));
      const parts = new Set(partNames.length ? await splitPartNamesAmong(this.prisma as any, organizationId, partNames) : []);
      for (const d of existingDocs) {
        const name = (d.name || '').replace(/-R\d+$/, ''); // a "-Rn" revision holds its serial
        const match = parts.has(name) ? name.slice(namePrefix.length).match(/^(\d+)-/) : name.match(/-(\d+)$/);
        if (match) {
          nextSerial = Math.max(nextSerial, parseInt(match[1], 10) + 1);
        }
      }

      const serial = String(nextSerial).padStart(3, '0');
      let name = `${namePrefix}${serial}`;

      // A scheduled DRAFT passes a placeholder (e.g. DO-PENDING-01) via
      // nameOverride and SKIPS the real sequence — the number is claimed at
      // confirm (OSI-83). Everything else takes the next number NOW: the
      // customisable per-type format (DocumentNumberFormat variant) if the org
      // has one — or config.numberFormatId — else the legacy serial above.
      // Round 36: a locked number (opts.lockedNumber) is claimed at the insert below, not here.
      const typedNumber = (config as any)?.documentNumber ?? (config as any)?.documentInfo?.documentNumber;
      const lockedNumber = !!opts.lockedNumber && !nameOverride && (config as any)?.skipNumbering !== true && !(typeof typedNumber === 'string' && typedNumber.trim());
      if (nameOverride) {
        name = nameOverride;
      } else if ((config as any)?.skipNumbering === true) {
        // ID quotations (CIEL 09-01): drafts carry NO number — the serial is
        // claimed only when the quotation confirms (updateDocument / sign),
        // so abandoned drafts stop burning contract numbers.
        name = null as any;
      } else if (lockedNumber) {
        // claimed with the insert (insertWithLockedNumber)
      } else {
        try {
          const numberFormatId = (config as any)?.numberFormatId ?? null;
          const custom = await this.documentNumbering.generateNumber(organizationId, type, numberFormatId, now);
          if (custom) name = custom;
        } catch (e: any) {
          console.warn('[numbering] custom format failed, using legacy name:', e?.message);
        }
      }

      // Seed initial config with organization defaults so they persist even if user doesn't save the form
      const initialConfig: any = config && typeof config === 'object' ? { ...config } : {};
      if (!initialConfig.logo && organization?.logo) {
        initialConfig.logo = organization.logo;
      }
      // support stamp.company convention across templates
      if (!initialConfig.stamp) {
        initialConfig.stamp = {};
      }
      if (!initialConfig.stamp.company && organization?.defaultStamp) {
        initialConfig.stamp.company = organization.defaultStamp;
      }
      // Inherit the template's column layout so per-template variants
      // (e.g. FCU/CU Quotation) render with their custom columns on new docs.
      const templateConfig: any = (documentTemplate?.config as any) || {};
      if (!initialConfig.tableColumnOrder && Array.isArray(templateConfig.tableColumnOrder)) {
        initialConfig.tableColumnOrder = templateConfig.tableColumnOrder;
      }
      if (!initialConfig.columnLabels && templateConfig.columnLabels && typeof templateConfig.columnLabels === 'object') {
        initialConfig.columnLabels = templateConfig.columnLabels;
      }

      // Seed the tax block from the org's defaults (Company Profile page →
      // taxApplicable / taxRate / absorbTax). Only fill when the caller didn't
      // already supply a value, so explicit per-doc overrides still win.
      const orgTaxApplicable = (organization as any)?.taxApplicable;
      const orgAbsorbTax = (organization as any)?.absorbTax;
      const orgTaxRate = organization?.taxRate;
      if (!initialConfig.documentInfo || typeof initialConfig.documentInfo !== 'object') {
        initialConfig.documentInfo = {};
      }
      const di = initialConfig.documentInfo;
      // The Tax / Absorb Tax fields render as Y/N selects in the form so we
      // store the string variant — booleans would render as empty.
      if (di.taxApplicable === undefined && orgTaxApplicable !== undefined && orgTaxApplicable !== null) {
        di.taxApplicable = orgTaxApplicable ? 'Y' : 'N';
      }
      if (di.absorbTax === undefined && orgAbsorbTax !== undefined && orgAbsorbTax !== null) {
        di.absorbTax = orgAbsorbTax ? 'Y' : 'N';
      }
      if ((di.gstPercent === undefined || di.gstPercent === null || di.gstPercent === 0) && orgTaxRate != null) {
        di.gstPercent = Number(orgTaxRate);
      }
      const orgCurrency = (organization as any)?.defaultCurrency;
      if (!di.currency && orgCurrency) {
        di.currency = orgCurrency;
      }
      // Some templates read formData.currency at the top level too — seed it
      // in case the form expects it there.
      if (!initialConfig.currency && orgCurrency) {
        initialConfig.currency = orgCurrency;
      }
      // Exchange rate: a new document is at par with the base currency
      // (1, shown as 1.0000000 — rates carry 7 decimals) until the user keys
      // another rate (guru 2026-11-14: the Rate box must never sit blank).
      if (di.rate === undefined || di.rate === null || di.rate === '' || Number(di.rate) === 0) {
        di.rate = 1;
      }

      // Per-doc-type boilerplate: T&Cs / Notes / Footer message. Looked up
      // by the doc's `type` against organization.docTypeDefaults. Per-doc
      // overrides still win — these only fill empty fields.
      const docTypeDefaults: any = (organization as any)?.docTypeDefaults || {};
      const typeDefaults = (docTypeDefaults && typeof docTypeDefaults === 'object' && docTypeDefaults[type]) || null;
      if (typeDefaults) {
        if (!di.termsAndConditions && typeof typeDefaults.tnc === 'string' && typeDefaults.tnc.trim()) {
          di.termsAndConditions = typeDefaults.tnc;
        }
        if (!di.note && typeof typeDefaults.notes === 'string' && typeDefaults.notes.trim()) {
          di.note = typeDefaults.notes;
        }
        if (!di.footerMessage && typeof typeDefaults.footerMessage === 'string' && typeDefaults.footerMessage.trim()) {
          di.footerMessage = typeDefaults.footerMessage;
        }
      }
      // Prefill customer info from the project when projectId is supplied and
      // the caller didn't already populate it. Generic across document types.
      if (resolvedProject?.customer) {
        if (!initialConfig.customerId) initialConfig.customerId = resolvedProject.customer.id;
        if (!initialConfig.customer) initialConfig.customer = resolvedProject.customer;
      }

      // Honour a user-supplied document number at creation time too — the
      // editable "Purchase Order No." (or any doc's number field) should
      // immediately become the document's name. Falls back to the
      // auto-generated serial when no custom value was passed.
      const initialDocNumber =
        (initialConfig as any)?.documentNumber ?? (initialConfig as any)?.documentInfo?.documentNumber;
      const initialName = nameOverride
        ? nameOverride
        : typeof initialDocNumber === 'string' && initialDocNumber.trim()
          ? initialDocNumber.trim()
          : name;

      let newDocument: any;
      if (lockedNumber) {
        // Number and row in one transaction (nothing to hand back on a failure: it rolls back with the row).
        newDocument = (
          await insertWithLockedNumber(this.prisma, this.documentNumbering, {
            organizationId,
            documentType: type,
            formatId: (config as any)?.numberFormatId ?? null,
            when: now,
            legacyPrefix: namePrefix,
            what: type === 'INVOICE' ? 'invoice' : 'document',
            insert: (tx, lockedName) =>
              tx.document.create({
                data: { documentTemplateId, type, config: initialConfig, organizationId, name: lockedName, revisionNumber: 0, projectId: projectId || undefined },
              }),
          })
        ).row;
      } else {
        claimedName = initialName;
        newDocument = await this.prisma.document.create({
          data: {
            documentTemplateId,
            type,
            config: initialConfig,
            organizationId,
            name: initialName,
            revisionNumber: 0,
            projectId: projectId || undefined,
          },
        });
        claimedName = undefined; // written — the number is legitimately spent
      }
      const createdName = lockedNumber ? newDocument.name : initialName;

      // Sync DocumentItem junction table (in case config has items)
      await this.syncDocumentItems(newDocument.id, initialConfig, organizationId);

      void this.logDocumentEvent({
        documentId: newDocument.id,
        organizationId,
        action: 'CREATED',
        detail: `${createdName} created`,
        documentName: createdName,
        actor,
      });

      return newDocument;
    } catch (error) {
      // Round 36: a locked create that could not take a free number says so (409), as it is.
      if (opts.lockedNumber && error instanceof HttpException) throw error;
      // Hand the serial back. releaseNumberIfLatest re-verifies inside its own
      // transaction that this name is still the LAST one claimed, so a
      // concurrent create that already took the next number is never clobbered
      // — if it is no longer last, the number stays spent, which is safe.
      if (claimedName) {
        try {
          const given = await this.documentNumbering.releaseNumberIfLatest(organizationId, type, claimedName);
          if (given) console.warn(`[numbering] returned ${claimedName} after a failed create`);
        } catch (e: any) {
          console.warn('[numbering] could not return the serial:', e?.message);
        }
      }
      throw new HttpException(`Basic document creation failed: ${error.message}`, HttpStatus.INTERNAL_SERVER_ERROR);
    }
  }

  /**
   * Create a draft document from extracted (AI-parsed) data.
   * - Fuzzy-matches customer by name (case-insensitive contains, unique match wins).
   * - Looks up an existing PO whose name == extracted poNumber; if found, the new
   *   draft inherits that PO's projectId so it lands inside the PO-as-project.
   * - Falls back to the type's default DocumentTemplate when no templateId is given.
   * Returns { id, templateId, type, matched: { customerId, projectId, poDocumentId } }.
   */
  // OSI-13: resolve extracted DELIVERY_ORDER line items to real inventory units.
  //  • AUTO-ASSIGN only on an EXACT serial match to a SINGLE in-stock unit in
  //    this org → emits one config line per matched unit (quantity 1) with
  //    inventoryItemId set, so the EXISTING syncDocumentItems materialises a
  //    deliverable DocumentItem row (no change to that path). syncDocumentItems
  //    is one-unit-per-line, so a multi-serial extracted line is SPLIT into
  //    per-unit lines here.
  //  • SUGGEST (never auto-assign) for the remainder: in-stock units of an asset
  //    whose name matches the description, attached as suggestedInventoryIds for
  //    the editor's quick-pick — inventoryItemId is left UNSET (non-deliverable
  //    until a human confirms). SKU/description NEVER auto-assign.
  //  • Strictly org-scoped; nothing cross-org.
  private async matchExtractedItemsToInventory(
    extractedItems: any[],
    organizationId: string,
  ): Promise<{
    items: any[];
    summary: { matched: number; suggested: number; unmatched: number };
  }> {
    const out: any[] = [];
    let matched = 0;
    let suggested = 0;
    let unmatched = 0;
    let lineId = 0;

    for (const it of Array.isArray(extractedItems) ? extractedItems : []) {
      const description: string = (it?.description ?? '').toString();
      const uom = it?.unit || undefined;
      const tax =
        typeof it?.tax === 'number' ? it.tax : parseFloat(it?.tax) || undefined;
      const qty =
        typeof it?.quantity === 'number' ? it.quantity : parseFloat(it?.quantity) || 0;
      const unitPrice =
        typeof it?.unitPrice === 'number' ? it.unitPrice : parseFloat(it?.unitPrice) || 0;
      const amount =
        typeof it?.amount === 'number' ? it.amount : parseFloat(it?.amount) || 0;
      const perUnit = unitPrice || (qty > 0 ? amount / qty : 0);
      const serials: string[] = Array.isArray(it?.serialNumbers)
        ? it.serialNumbers.map((s: any) => String(s ?? '').trim()).filter(Boolean)
        : [];

      // 1) Exact serial → SINGLE in-stock unit ⇒ auto-assign (one line per unit).
      const matchedUnitIds = new Set<string>();
      const unmatchedSerials: string[] = [];
      for (const serial of serials) {
        const units = await this.prisma.inventory.findMany({
          where: {
            organizationId,
            serialNumber: serial,
            status: InventoryStatus.instock,
          },
          select: { id: true },
          take: 2, // stop at 2 to reject ambiguous serials
        });
        if (units.length === 1 && !matchedUnitIds.has(units[0].id)) {
          matchedUnitIds.add(units[0].id);
          out.push({
            id: ++lineId,
            description,
            quantity: 1,
            unitPrice: perUnit,
            amount: perUnit,
            uom,
            tax,
            serialNumber: serial,
            inventoryItemId: units[0].id, // ⇒ syncDocumentItems makes a real row
          });
          matched++;
        } else {
          unmatchedSerials.push(serial);
        }
      }

      // 2) Remaining quantity ⇒ ONE non-deliverable line (no inventoryItemId) +
      //    description-based suggestions for the editor.
      const matchedCount = matchedUnitIds.size;
      const leftover =
        matchedCount === 0
          ? qty > 0
            ? qty
            : 1
          : Math.max(0, (qty || matchedCount) - matchedCount);
      if (leftover > 0) {
        let suggestedInventoryIds: string[] = [];
        if (description.trim()) {
          const assets = await this.prisma.asset.findMany({
            where: {
              organizationId,
              name: { contains: description.trim(), mode: 'insensitive' },
            },
            select: { id: true },
            take: 3,
          });
          if (assets.length) {
            const units = await this.prisma.inventory.findMany({
              where: {
                organizationId,
                assetId: { in: assets.map((a) => a.id) },
                status: InventoryStatus.instock,
              },
              select: { id: true },
              take: 5,
            });
            suggestedInventoryIds = units.map((u) => u.id);
          }
        }
        out.push({
          id: ++lineId,
          description,
          quantity: leftover,
          unitPrice: perUnit,
          amount: perUnit * leftover,
          uom,
          tax,
          ...(unmatchedSerials.length ? { serialNumbers: unmatchedSerials } : {}),
          ...(suggestedInventoryIds.length ? { suggestedInventoryIds } : {}),
        });
        if (suggestedInventoryIds.length) suggested++;
        else unmatched++;
      }
    }

    return { items: out, summary: { matched, suggested, unmatched } };
  }

  // Legacy document-type aliases → the canonical DocumentTemplate.type their
  // template lookup should use. Verified against prod data (2026-08-04):
  // DO-typed templates are all retired/inactive (live ones are
  // DELIVERY_ORDER); QO*/QT/TI*/CN/DN/RDO exist as no template type at all.
  // ⚠️ PO / PR / SAI / SAO are deliberately NOT aliases: those ARE the
  // canonical template types in this system (5 active templates each, and the
  // portal list pages send them), while the long forms (PURCHASE_ORDER,
  // PURCHASE_RETURN, STOCK_ADJUSTMENT_*) are a separate template family —
  // mapping them would repoint working uploads.
  private static readonly TEMPLATE_TYPE_ALIASES: Record<string, string> = {
    DO: 'DELIVERY_ORDER',
    RDO: 'RETURN_DELIVERY_ORDER',
    QO: 'QUOTATION',
    QO1: 'QUOTATION',
    QT: 'QUOTATION',
    TI: 'INVOICE',
    TI2: 'INVOICE',
    SO: 'SALES_ORDER',
    CN: 'CREDIT_NOTE',
    DN: 'DEBIT_NOTE',
  };

  async createFromExtraction(
    organizationId: string,
    type: string,
    extracted: any,
    documentTemplateId?: string,
    sourceFileUrl?: string | null,
    // Provenance stamp for config.source.extractedFrom — 'upload' (portal
    // upload button, the default) or 'email' (inbound email ingestion).
    extractedFrom: string = 'upload',
    actor?: DocumentActor,
  ) {
    // Resolve template: explicit > active variant > default > newest.
    // The active/default flags reflect the variant the user normally picks via
    // InvoiceVariantDrawer; without this ordering findFirst can return a legacy
    // variant with a thinner fieldConfig and the upload draft would look sparse.
    //
    // TEMPLATE LOOKUP ONLY: callers send legacy type aliases (/submit sends
    // "DO"; the portal sends "DELIVERY_ORDER") and templates/selections are
    // stored under the canonical string — an unmapped alias found no
    // selections, fell through every layer and landed on a RETIRED inactive
    // legacy template. `templateType` is used for the lookups below and
    // NOWHERE else — the document's saved type stays exactly what the caller
    // sent (preview branches key on it).
    const templateType =
      DocumentsService.TEMPLATE_TYPE_ALIASES[String(type).toUpperCase()] ?? type;
    let templateId = documentTemplateId;
    if (!templateId) {
      // Multiple templates can be active per org+type; resolve exactly ONE for
      // this headless path: prefer the primary selection, else the isDefault
      // among the selected, else the newest selected. Falls back to the cross-org
      // default (Standard) then the org's own active/default/newest template.
      const selections = await this.prisma.organizationActiveTemplate.findMany({
        where: { organizationId, type: templateType },
      });
      if (selections.length > 0) {
        const primary = selections.find((s) => s.isPrimary);
        if (primary) {
          templateId = primary.templateId;
        } else {
          const sel = await this.prisma.documentTemplate.findFirst({
            where: { id: { in: selections.map((s) => s.templateId) } },
            select: { id: true },
            orderBy: [{ isDefault: 'desc' }, { createdAt: 'desc' }],
          });
          templateId = sel?.id ?? selections[0].templateId;
        }
      } else {
        // Org's own active template first; seeded cross-org standard only when
        // the org has nothing of its own (keeps this headless path consistent
        // with the create picker's fallback).
        let tmpl =
          (await this.prisma.documentTemplate.findFirst({
            where: { type: templateType, organizationId, isActive: true },
            select: { id: true },
            orderBy: [{ createdAt: 'desc' }],
          })) ??
          (await this.prisma.documentTemplate.findFirst({
            where: { OR: [{ type: templateType, isDefault: true }, { type: templateType, organizationId }] },
            select: { id: true },
            orderBy: [{ isDefault: 'desc' }, { createdAt: 'desc' }],
          }));
        // Strict-superset safety net: if the canonical type resolves NOTHING,
        // retry with the raw alias before 404ing — an org living entirely on
        // legacy-typed templates keeps resolving exactly as before.
        if (!tmpl && templateType !== type) {
          tmpl =
            (await this.prisma.documentTemplate.findFirst({
              where: { type, organizationId, isActive: true },
              select: { id: true },
              orderBy: [{ createdAt: 'desc' }],
            })) ??
            (await this.prisma.documentTemplate.findFirst({
              where: { OR: [{ type, isDefault: true }, { type, organizationId }] },
              select: { id: true },
              orderBy: [{ isDefault: 'desc' }, { createdAt: 'desc' }],
            }));
        }
        if (!tmpl) {
          throw new HttpException(`No document template found for type ${type}`, HttpStatus.NOT_FOUND);
        }
        templateId = tmpl.id;
      }
    }

    // Fuzzy customer match — case-insensitive contains, only auto-link if unique.
    let matchedCustomerId: string | null = null;
    let matchedCustomer:
      | { id: string; name: string; customerCode: string | null; address: string | null; email: string | null }
      | null = null;
    const extractedCustomerName: string | undefined = extracted?.customer?.name?.trim();
    if (extractedCustomerName) {
      const candidates = await this.prisma.customer.findMany({
        where: {
          organizationId,
          name: { contains: extractedCustomerName, mode: 'insensitive' },
        },
        select: { id: true, name: true, customerCode: true, address: true, email: true },
        take: 2,
      });
      if (candidates.length === 1) {
        matchedCustomer = candidates[0];
        matchedCustomerId = candidates[0].id;
      }
    }

    // PO match — exact match on Document.name among PO types.
    let matchedProjectId: string | null = null;
    let matchedPoDocumentId: string | null = null;
    const extractedPoNumber: string | undefined =
      extracted?.references?.poNumber?.trim() || undefined;
    if (extractedPoNumber) {
      const po = await this.prisma.document.findFirst({
        where: {
          organizationId,
          type: { in: ['PO', 'PURCHASE_ORDER'] },
          name: extractedPoNumber,
        },
        select: { id: true, projectId: true },
      });
      if (po) {
        matchedPoDocumentId = po.id;
        matchedProjectId = po.projectId || null;
      }
    }

    // OSI-13: for a DELIVERY_ORDER, auto-match line items to inventory
    // (serial-exact → inventoryItemId; else suggestions). Other document types
    // keep the plain 1:1 mapping so QO/INVOICE behaviour is unchanged.
    const isDeliveryOrder = type === 'DO' || type === 'DELIVERY_ORDER';
    let itemMatchSummary:
      | { matched: number; suggested: number; unmatched: number }
      | null = null;
    let configItems: any[];
    if (isDeliveryOrder) {
      const res = await this.matchExtractedItemsToInventory(
        extracted?.items,
        organizationId,
      );
      configItems = res.items;
      itemMatchSummary = res.summary;
    } else {
      configItems = (Array.isArray(extracted?.items) ? extracted.items : []).map(
        (it: any, idx: number) => ({
          id: idx + 1,
          description: it?.description || '',
          quantity:
            typeof it?.quantity === 'number' ? it.quantity : parseFloat(it?.quantity) || 0,
          unitPrice:
            typeof it?.unitPrice === 'number' ? it.unitPrice : parseFloat(it?.unitPrice) || 0,
          amount: typeof it?.amount === 'number' ? it.amount : parseFloat(it?.amount) || 0,
          uom: it?.unit || undefined,
          tax: typeof it?.tax === 'number' ? it.tax : parseFloat(it?.tax) || undefined,
          // Transient: the extracted model/part code, consumed by the
          // Asset.skuKey matcher below and then stripped (not persisted).
          _model: it?.model || it?.code || '',
        }),
      );
      // Stamp product/service codes + GL accounts (guru 2026-07-26).
      configItems = await this.codeExtractedLines(organizationId, configItems, type);
      // Product Code from the extracted MODEL → Asset.skuKey (normalized exact).
      // Runs AFTER codeExtractedLines: an exact model↔skuKey match WINS the
      // Product Code (itemCode) even over a RevenueItem match — a model matching
      // a catalog product code is the specific, intended code; codeExtractedLines'
      // GL accountCode is left intact. No skuKey match → fall back to the raw
      // model text only when nothing else coded the line (never "—").
      configItems = await this.codeItemsByAssetSkuKey(organizationId, configItems);
      // Drop the transient model field so it never lands in persisted config.
      configItems = configItems.map(({ _model, ...rest }: any) => rest);
    }

    // Map extracted → AIMS document config shape.
    const config: any = {
      customer: {
        id: matchedCustomerId || undefined,
        name: extracted?.customer?.name || undefined,
        address: extracted?.customer?.address || undefined,
        attention: extracted?.customer?.attention || undefined,
      },
      // FLAT customer fields — the editor round-trip contract
      // (documentDataTransformer reads config.customerId/Name/Code/Address/Email;
      // DynamicFormFields renders customerCode). Sourced from the MATCHED customer
      // ROW only; when unmatched we leave them absent so the editor shows blank
      // for the admin to assign.
      ...(matchedCustomer
        ? {
            customerId: matchedCustomer.id,
            customerName: matchedCustomer.name,
            customerCode: matchedCustomer.customerCode || undefined,
            customerAddress: matchedCustomer.address || undefined,
            customerEmail: matchedCustomer.email || undefined,
          }
        : {}),
      // Canonical reference key is referenceNo (flat AND documentInfo) — the
      // editor and the list tables read it first. `reference` kept for
      // back-compat with older readers of extraction docs.
      referenceNo: extracted?.document?.reference || undefined,
      documentInfo: {
        documentNumber: extracted?.document?.number || undefined,
        date: extracted?.document?.date || undefined,
        dueDate: extracted?.document?.dueDate || undefined,
        reference: extracted?.document?.reference || undefined,
        referenceNo: extracted?.document?.reference || undefined,
        // OSI-13 (PART 2): carry the extracted delivery date onto the DO — the
        // preview reads documentInfo.deliveryDate; previously dropped.
        ...(isDeliveryOrder && extracted?.additionalFields?.deliveryDate
          ? { deliveryDate: extracted.additionalFields.deliveryDate }
          : {}),
      },
      // OSI-13 (PART 2): carry the extracted delivery ADDRESS onto the DO — the
      // editor/preview read deliveryAddress.address (an object); previously dropped.
      ...(isDeliveryOrder && extracted?.additionalFields?.deliveryAddress
        ? { deliveryAddress: { address: extracted.additionalFields.deliveryAddress } }
        : {}),
      references: extracted?.references || {},
      items: configItems,
      totals: extracted?.totals || {},
      // ALSO write the native total fields — lists/reports/AR feeds read
      // nettTotal/subTotal/gstAmount; extraction-only docs used to show $0.00
      // because their values lived solely under `totals` (found via the
      // BIPL-JPSG "empty draft" investigation, 2026-07-22).
      ...(extracted?.totals?.total != null
        ? {
            nettTotal: Number(extracted.totals.total) || 0,
            subTotal: Number(extracted.totals.subtotal ?? extracted.totals.total) || 0,
            gstAmount: Math.round(((Number(extracted.totals.total) || 0) - (Number(extracted.totals.subtotal ?? extracted.totals.total) || 0)) * 100) / 100,
          }
        : {}),
      notes: extracted?.notes || undefined,
      source: {
        extractedFrom,
        fileUrl: sourceFileUrl || undefined,
      },
      sourceFileUrl: sourceFileUrl || undefined,
    };

    // Create the draft via the existing helper so we get document numbering, defaults, etc.
    const created = await this.createBasicDocument(
      templateId,
      type,
      organizationId,
      config,
      undefined,
      actor ?? { name: extractedFrom === 'email' ? 'Email ingestion' : 'AI extraction' },
    );

    // If we matched a project (via PO), link it on the created document.
    if (matchedProjectId) {
      await this.prisma.document.update({
        where: { id: created.id },
        data: { projectId: matchedProjectId },
      });
    }

    // Best-effort sequence-gap warning (uploads only) — flags when the party's
    // own printed number jumps ahead of the last one we have in the same series,
    // so a /submit user can also upload the ones in between. Never blocks.
    const sequenceWarning = await this.computeSequenceGapWarning(
      organizationId,
      type,
      extracted?.document?.number,
    );

    return {
      id: created.id,
      templateId,
      type,
      matched: {
        customerId: matchedCustomerId,
        projectId: matchedProjectId,
        poDocumentId: matchedPoDocumentId,
        // OSI-13: item→inventory auto-match summary so the UI can report
        // "N linked, M suggested, K need a unit".
        ...(itemMatchSummary ? { items: itemMatchSummary } : {}),
      },
      ...(sequenceWarning ? { sequenceWarning } : {}),
    };
  }

  /**
   * Parse a printed document number into a comparable series key. The FINAL
   * digit-run is the running number; everything before it is the prefix that
   * defines the series. "BI2026167" → {prefix:"BI", value:2026167, width:7};
   * "BIPL-JPSG-INV-20260630-0077" → {prefix:"BIPL-JPSG-INV-20260630-", value:77,
   * width:4}; "009" → {prefix:"", value:9, width:3}. Returns null when there's
   * no trailing digit run (unparseable → caller stays silent).
   */
  private parseSeriesNumber(raw: unknown): { prefix: string; value: number; width: number } | null {
    if (typeof raw !== 'string') return null;
    const m = raw.trim().match(/^(.*?)(\d+)\s*$/);
    if (!m) return null;
    const prefix = m[1];
    const digits = m[2];
    if (digits.length === 0 || digits.length > 12) return null; // guard Number() range
    const value = Number(digits);
    if (!Number.isSafeInteger(value)) return null;
    return { prefix, value, width: digits.length };
  }

  /**
   * Best-effort sequence-gap warning for AI uploads. Compares the EXTRACTED
   * number (the party's OWN printed number, config.documentNumber) against the
   * highest prior same-org, same-TYPE document in the SAME prefix series, and
   * lists the numbers in between so a /submit user can upload those too.
   *
   * WARNING only — never blocks, never throws. Deliberately SILENT (no false
   * alarm) when: the number doesn't parse, there's no same-prefix prior, the
   * jump is implausibly large (>100), or the prior doc is stale (see recency).
   *
   * Scope: series the ORG CONTROLS. Supplier BILLs are excluded on purpose —
   * you never receive every document a supplier issues, so a gap in their
   * numbering is meaningless (BILLs also take a separate ingest pipeline).
   */
  private async computeSequenceGapWarning(
    organizationId: string,
    type: string,
    extractedNumber: unknown,
  ): Promise<{ missing: string[]; type: string } | undefined> {
    try {
      const parsed = this.parseSeriesNumber(extractedNumber);
      if (!parsed) return undefined;
      const { prefix, value, width } = parsed;

      // Candidate priors: same org + type. Each doc's own number lives in
      // config.documentNumber (fresh drafts) or name (edited/confirmed). Recent
      // first — the relevant series head sits near the top.
      const docs = await this.prisma.document.findMany({
        where: { organizationId, type },
        select: { name: true, config: true, createdAt: true },
        orderBy: { createdAt: 'desc' },
        take: 500,
      });

      let best: { value: number; createdAt: Date } | null = null;
      for (const d of docs) {
        const raw = (d.config as any)?.documentNumber ?? d.name;
        const p = this.parseSeriesNumber(raw);
        if (!p || p.prefix !== prefix || p.value >= value) continue; // same series, strictly below
        if (!best || p.value > best.value) best = { value: p.value, createdAt: d.createdAt };
      }
      if (!best) return undefined; // no same-prefix prior → silent

      const gap = value - best.value;
      if (gap <= 1) return undefined; // consecutive — no gap
      if (gap > 100) return undefined; // implausible jump (year rollover, format change) → silent

      // Recency guard: a months-old prior means the series was DORMANT, not that
      // paperwork is missing. 60 days covers monthly / irregular billing cadence
      // (an active monthly series' last doc is ~30 days old) while still
      // suppressing long-dead series that just resumed.
      const RECENCY_MS = 60 * 24 * 60 * 60 * 1000;
      if (Date.now() - best.createdAt.getTime() > RECENCY_MS) return undefined;

      // The missing numbers between best+1 and value-1, padded + prefixed. Cap
      // the list so a moderate jump stays readable.
      const missing: string[] = [];
      for (let n = best.value + 1; n < value && missing.length < 10; n++) {
        missing.push(`${prefix}${String(n).padStart(width, '0')}`);
      }
      const remaining = value - best.value - 1 - missing.length;
      if (remaining > 0) missing.push(`+${remaining} more`);
      return { missing, type };
    } catch {
      return undefined; // a warning must never break a submission
    }
  }

  async duplicateDocument(documentId: string, organizationId: string, actor?: DocumentActor) {
    try {
      const original = await this.prisma.document.findFirst({
        where: { id: documentId, organizationId },
      });
      if (!original) {
        throw new HttpException('Document not found', HttpStatus.NOT_FOUND);
      }

      // Build a fresh config copy without identity/state fields that should
      // not carry over to a new document.
      const originalConfig = (original.config as any) || {};
      const duplicatedConfig: any = { ...originalConfig };
      // Strip fields tied to the source document's identity/state.
      delete duplicatedConfig.id;
      delete duplicatedConfig.documentNumber;
      // A copy of an imported (old-ERP) DO is a new native DO: it does not inherit the import marker.
      if (isErpImportedDo(original)) delete duplicatedConfig.erpImport;
      if (duplicatedConfig.documentInfo) {
        duplicatedConfig.documentInfo = { ...duplicatedConfig.documentInfo };
        delete duplicatedConfig.documentInfo.documentNumber;
      }
      // The duplicate is always a fresh draft.
      delete duplicatedConfig.savedBy;
      delete duplicatedConfig.savedAt;
      delete duplicatedConfig.confirmedAt;
      delete duplicatedConfig.confirmedBy;

      // Dated today, not the source's date (guru 2026-11-04): a duplicate is
      // a new document, so it is issued today in the org's time zone. The due
      // date keeps the source's gap (due − date) from the new date; a source
      // with no parseable pair just drops its due date and the editor
      // recomputes it from the payment terms on open.
      {
        const today = await orgTodayFor(this.prisma, organizationId);
        const oldDate = documentIssueDate(originalConfig, original.createdAt);
        const oldDue = [originalConfig.documentInfo?.dueDate, originalConfig.dueDate].find((v) => typeof v === 'string' && v.trim());
        const addDays = (ymd: string, n: number) => {
          const d = new Date(`${ymd}T00:00:00Z`);
          d.setUTCDate(d.getUTCDate() + n);
          return d.toISOString().slice(0, 10);
        };
        let newDue: string | null = null;
        if (oldDue) {
          const a = new Date(`${oldDate}T00:00:00Z`).getTime();
          const b = new Date(String(oldDue).slice(0, 10) + 'T00:00:00Z').getTime();
          if (Number.isFinite(a) && Number.isFinite(b)) newDue = addDays(today, Math.round((b - a) / 86_400_000));
        }
        duplicatedConfig.date = today;
        if ('issueDate' in duplicatedConfig) duplicatedConfig.issueDate = today;
        if ('invoiceDate' in duplicatedConfig) duplicatedConfig.invoiceDate = today;
        duplicatedConfig.documentInfo = { ...(duplicatedConfig.documentInfo || {}), date: today };
        if (newDue) {
          duplicatedConfig.dueDate = newDue;
          duplicatedConfig.documentInfo.dueDate = newDue;
        } else {
          delete duplicatedConfig.dueDate;
          delete duplicatedConfig.documentInfo.dueDate;
        }
      }

      // Items born outside the editor (Xero sync, external API, EW flow) can
      // lack `id`s — and the editor keys delete/edit/drag on item.id, so an
      // id-less duplicate breaks row operations. Stamp unique ids on copy.
      if (Array.isArray(duplicatedConfig.items)) {
        let idSeed = Date.now();
        const seenIds = new Set<any>();
        duplicatedConfig.items = duplicatedConfig.items.map((item: any) => {
          let id = item?.id;
          if (id == null || seenIds.has(id)) id = ++idSeed;
          seenIds.add(id);
          return { ...item, id };
        });

        // Re-settle merged rate blocks (guru 2026-09-25). A block is quoted as
        // shared quantity x shared rate, but the amount is STORED on its first
        // row — copying it verbatim carried the source document's figure into
        // the duplicate, so the new quote printed the old amount however the
        // quantity was changed. Recompute each block from its own marker.
        const blockFirstSeen = new Set<string>();
        duplicatedConfig.items = duplicatedConfig.items.map((item: any) => {
          const merge = item?.rateMerge;
          if (!merge?.id) return item;
          // Documents merged before the shared quantity existed fall back to
          // the row's own quantity, exactly as the renderers do.
          const qty = Number(merge.quantity ?? item.quantity) || 0;
          const price = Number(merge.price) || 0;
          const isFirst = !blockFirstSeen.has(merge.id);
          blockFirstSeen.add(merge.id);
          return {
            ...item,
            quantity: qty,
            rateMerge: { ...merge, quantity: qty },
            amount: isFirst ? qty * price : null,
          };
        });
      }

      // Reuse createBasicDocument so we get the standard document-number
      // generation, organization defaults, and item junction sync.
      return await this.createBasicDocument(
        original.documentTemplateId,
        original.type,
        organizationId,
        duplicatedConfig,
        undefined,
        actor,
      );
    } catch (error) {
      if (error instanceof HttpException) throw error;
      throw new HttpException(
        `Duplicate document failed: ${error.message}`,
        HttpStatus.INTERNAL_SERVER_ERROR,
      );
    }
  }

  /**
   * REVISIONS, the accounting rule (guru 2026-11-19).
   *
   * An issued invoice is a record, not a draft: it is numbered, posted and in
   * the customer's hands. There are only two honest ways to change one.
   *
   *   CANCEL & REISSUE — only while nothing has happened to it: not sent, no
   *   payment, no allocation. The original is cancelled, its journal voided,
   *   its number kept forever and never reused, and the replacement carries
   *   (Rev-n). That is what "Create Revision" does here.
   *
   *   CREDIT NOTE — once it has gone to the customer or carries money, the
   *   invoice stands and is credited: a CN against it, then a new invoice.
   *   This is the IRAS route and the one Xero forces.
   *
   * So this refuses a revision in the cases where only a credit note is
   * correct, and says which to raise instead. An UNCONFIRMED document needs no
   * revision at all — it is still a draft, so it is simply edited.
   */
  private async assertRevisable(original: any, organizationId: string): Promise<void> {
    assertNotErpImportedDo(original);
    const what = String(original.name || 'This document');
    const status = String(original.status || '').toLowerCase();
    if (['draft', 'unconfirmed'].includes(status)) {
      throw new BadRequestException(`${what} is not issued yet — edit it instead of raising a revision.`);
    }
    if ((original.config as any)?.voided === true) {
      throw new BadRequestException(`${what} is voided. Raise a new document instead.`);
    }
    const paid = await this.prisma.payment.count({ where: { organizationId, documentId: original.id } });
    if (paid > 0) {
      throw new BadRequestException(
        `${what} already has a payment against it, so it cannot be replaced. Raise a credit note against it and then a new invoice.`,
      );
    }
    const sent = await this.prisma.auditLog.count({
      where: { organizationId, resourceId: original.id, action: 'SENT' },
    });
    if (sent > 0) {
      throw new BadRequestException(
        `${what} has already been sent to the customer, so it cannot be replaced. Raise a credit note against it and then a new invoice.`,
      );
    }
  }

  /**
   * Confirming a revision RETIRES the generation it replaces: the previous
   * document is cancelled and its journal voided, in the same breath (guru
   * 2026-11-19). Before this, "Create Revision" left the original live, so
   * confirming the revision posted a SECOND journal for the same job — on
   * Biofuel, BIPL-JPSG-20261102-0009 and its Rev-1 both sat in AR for $9,500,
   * under two different customers. Exactly ONE generation of a family is ever
   * live.
   */
  private async supersedePreviousGenerations(doc: any, organizationId: string, actor?: DocumentActor): Promise<void> {
    const family = doc.baseDocumentId || null;
    // A revision always carries BOTH a base and a revision number. Nothing
    // else is retired here: `baseDocumentId` is read defensively elsewhere as
    // a source-document fallback, and a DO must never be cancelled because the
    // invoice drawn from it was confirmed.
    if (!family || !((doc.revisionNumber ?? 0) >= 1)) return;
    const self = await this.prisma.document.findFirst({ where: { id: doc.id, organizationId }, select: { type: true } });
    const olders = await this.prisma.document.findMany({
      where: {
        organizationId,
        id: { not: doc.id },
        type: self?.type,
        OR: [{ id: family }, { baseDocumentId: family }],
        status: { notIn: ['draft'] as any },
      },
      select: { id: true, name: true, status: true, config: true, revisionNumber: true },
    });
    for (const old of olders) {
      if ((old.revisionNumber ?? 0) >= (doc.revisionNumber ?? 0)) continue; // never retire a NEWER generation
      if ((old.config as any)?.voided === true) continue; // already retired
      const jes = await this.prisma.journalEntry.findMany({
        where: { organizationId, sourceDocumentId: old.id, status: { not: 'VOID' } },
        select: { id: true },
      });
      for (const j of jes) {
        await this.prisma.journalEntry.update({
          where: { id: j.id },
          data: { status: 'VOID', voidedAt: new Date(), voidedBy: actor?.id || 'system' },
        });
      }
      // A document is voided through its CONFIG, the house convention — there
      // is no 'cancelled' in the DocumentStatus enum, and the listings read
      // config.voided for their Voided filter.
      await this.prisma.document.update({
        where: { id: old.id },
        data: {
          config: {
            ...((old.config as any) || {}),
            voided: true,
            supersededBy: doc.name,
            cancelledReason: `Superseded by ${doc.name}`,
            cancelledAt: new Date().toISOString(),
          } as any,
        },
      });
      void this.logDocumentEvent({
        documentId: old.id,
        organizationId,
        action: 'STATUS_CHANGED',
        detail: `Cancelled — superseded by ${doc.name}${jes.length ? `; ${jes.length} journal(s) voided` : ''}`,
        documentName: old.name || undefined,
        actor,
      });
    }
  }

  async createRevision(documentId: string, organizationId: string, actor?: DocumentActor) {
    try {
      // Load the original document with its revisions
      const original = await this.prisma.document.findFirst({
        where: { id: documentId, organizationId },
      });
      if (!original) {
        throw new HttpException('Document not found', HttpStatus.NOT_FOUND);
      }
      // A revision is only legal while the original can still be cancelled.
      await this.assertRevisable(original, organizationId);
      assertRecordUnlocked(original, 'revised');
      assertNotVoided(original, 'revised');
      if (isPeriodLockedDocType(original.type)) {
        await assertPeriodOpen(this.prisma, { organizationId, date: documentDay(original.config, original.createdAt), actorId: actor?.id, what: original.name || 'This document', verb: 'revised' });
      }

      // Determine baseDocumentId and next revision number
      const baseDocumentId = original.baseDocumentId || original.id;
      // If there is a base document, fetch it to use its clean name (without any appended Rev-x)
      const baseDocument = original.baseDocumentId ? await this.prisma.document.findUnique({ where: { id: baseDocumentId } }) : null;
      const lastRevision = await this.prisma.document.findFirst({
        where: { organizationId, baseDocumentId },
        orderBy: { revisionNumber: 'desc' },
        select: { revisionNumber: true },
      });
      const nextRevisionNumber = (lastRevision?.revisionNumber ?? 0) + 1;

      // Name formatting: ensure we only ever have a single (Rev-X)
      // Prefer the base document's original name when available; otherwise strip any existing Rev-x suffixes
      const rawBaseName = (baseDocument?.name || original.name || `${original.type}-${original.id.slice(0, 6)}`).trim();
      const cleanedBaseName = rawBaseName.replace(/\s*\(Rev-\d+\)/g, '').trim();
      const nameWithRevision = `${cleanedBaseName} (Rev-${nextRevisionNumber})`;

      // The revision's NUMBER is its own name, "<number> (Rev-n)" — carried
      // into the config the editor reads, not just the row's name (guru
      // 2026-11-19). Leaving config.documentNumber on the base number made the
      // editor show the ORIGINAL's number, so confirming the revision tried to
      // rename it onto a number another live document already held and died
      // with "already used by another invoice". A cancelled invoice also keeps
      // its number for the audit trail — numbers are never reused.
      const revisionConfig: any = { ...((original.config as any) || {}) };
      revisionConfig.documentNumber = nameWithRevision;
      if (revisionConfig.documentInfo) {
        revisionConfig.documentInfo = { ...revisionConfig.documentInfo, documentNumber: nameWithRevision };
      }
      // A revision starts unissued: it has not been confirmed or sent.
      delete revisionConfig.confirmedAt;
      delete revisionConfig.confirmedBy;

      const created = await this.prisma.document.create({
        data: {
          documentTemplateId: original.documentTemplateId,
          type: original.type,
          config: revisionConfig,
          organizationId: original.organizationId,
          status: 'unconfirmed', // Always set revision status to unconfirmed
          name: nameWithRevision,
          baseDocumentId,
          revisionNumber: nextRevisionNumber,
        },
      });

      // Sync DocumentItem junction table (copies items from original)
      await this.syncDocumentItems(created.id, original.config, organizationId);

      void this.logDocumentEvent({
        documentId: created.id,
        organizationId,
        action: 'CREATED',
        detail: `${nameWithRevision} created (revision of ${cleanedBaseName})`,
        documentName: nameWithRevision,
        actor,
      });

      return created;
    } catch (error) {
      // A refusal ("raise a credit note instead") is the user's answer, not a
      // server fault — it must reach the editor as its own message.
      if (error instanceof HttpException) throw error;
      throw new HttpException(`Create revision failed: ${error.message}`, HttpStatus.INTERNAL_SERVER_ERROR);
    }
  }

  async listRevisions(documentId: string, organizationId: string) {
    try {
      const original = await this.prisma.document.findFirst({ where: { id: documentId, organizationId } });
      if (!original) {
        throw new HttpException('Document not found', HttpStatus.NOT_FOUND);
      }
      const baseDocumentId = original.baseDocumentId || original.id;
      const documents = await this.prisma.document.findMany({
        where: { organizationId, baseDocumentId },
        orderBy: { createdAt: 'asc' },
        select: { id: true, name: true, createdAt: true, revisionNumber: true },
      });
      return documents;
    } catch (error) {
      throw new HttpException(`List revisions failed: ${error.message}`, HttpStatus.INTERNAL_SERVER_ERROR);
    }
  }
  /**
   * Revision history (enableQuotationRevisionOnSave): the live document and every version
   * it replaced, newest first. `current` = the live one (the family's own row).
   */
  async revisionHistory(documentId: string, organizationId: string) {
    const doc = await this.prisma.document.findFirst({ where: { id: documentId, organizationId }, select: { id: true, baseDocumentId: true } });
    if (!doc) throw new HttpException('Document not found', HttpStatus.NOT_FOUND);
    const family = doc.baseDocumentId || doc.id;
    const rows = await this.prisma.document.findMany({
      where: { organizationId, OR: [{ id: family }, { baseDocumentId: family }] },
      select: { id: true, name: true, createdAt: true, updatedAt: true, revisionNumber: true },
    });
    return rows
      .map((r) => ({ id: r.id, name: r.name, revisionNumber: r.revisionNumber ?? 0, current: r.id === family, at: r.id === family ? r.updatedAt : r.createdAt }))
      .sort((a, b) => Number(b.current) - Number(a.current) || b.revisionNumber - a.revisionNumber);
  }

  async getAllDocuments(organizationId: string) {
    try {
      // Fetch-all list. The heavy config keys (items text, logo/stamp images,
      // email overrides) are striped IN THE DATABASE — loading full configs for
      // every document OOM-killed the 512MB prod instance (2026-08-11) once a
      // few list requests ran concurrently. List consumers only read small
      // scalars (dueDate/customer/date/totals/reference); anything needing
      // items opens the document individually.
      const documents: any[] = await this.prisma.$queryRaw`
        SELECT d.id, d.name, d.type, d."documentTemplateId", d.status,
               d."createdAt", d."projectId",
               d.config->'items'->0->>'sku' AS sku,
               d.config->>'customerId' AS "customerId",
               (d.config - 'items' - 'logo' - 'stamp' - 'signature' - 'signatures' - 'email') AS config
        FROM "Document" d
        WHERE d."organizationId" = ${organizationId}
        ORDER BY d."createdAt" DESC`;

      // Fetch customer names if customerId exists in config
      const uniqueCustomerIds = [...new Set(documents.map((doc) => doc.customerId).filter(Boolean))] as string[];
      const customers = uniqueCustomerIds.length > 0
        ? await this.prisma.customer.findMany({
            where: { id: { in: uniqueCustomerIds } },
            select: { id: true, name: true },
          })
        : [];

      const customerMap = new Map(customers.map(c => [c.id, c.name]));

      return documents.map((doc: any) => ({
        id: doc.id,
        name: doc.name,
        associated_item: doc.sku ?? 'N/A',
        // Same fallback as the paginated list below: a supplier-side credit /
        // debit note names a supplier, not a customer (guru 2026-11-12).
        associated_customer:
          (doc.customerId ? customerMap.get(doc.customerId) : null) ??
          (doc.config as any)?.supplier?.name ??
          (doc.config as any)?.supplierName ??
          'N/A',
        counterpartyKind: counterpartyKind(doc.config as any),
        documentType: doc.type,
        templateId: doc.documentTemplateId,
        status: doc.status,
        createdAt: doc.createdAt,
        // Project link — the extract-from-quotation flows carry it onto the
        // new DO/invoice (it lives on the row, not in config).
        projectId: doc.projectId ?? null,
        config: doc.config, // slim config — due dates, totals, reference etc.
      }));
    } catch (error) {
      throw new HttpException(`Fetch all documents failed: ${error.message}`, HttpStatus.INTERNAL_SERVER_ERROR);
    }
  }

  /**
   * Lean navigation rows for the editor's prev/next arrows — every document of
   * one template (or type) WITHOUT config, so an 18k-invoice org answers in
   * well under a second instead of shipping 25.8k configs (guru 2026-10-23).
   * The portal keeps its running-number series logic; it only needs
   * id/name/type/templateId/status/createdAt.
   */
  async getDocumentsForNavigation(organizationId: string, opts: { templateId?: string; documentTypes?: string[] } = {}) {
    try {
      const where: any = { organizationId };
      if (opts.templateId) where.documentTemplateId = opts.templateId;
      else if (opts.documentTypes?.length) where.type = { in: opts.documentTypes };
      const rows = await this.prisma.document.findMany({
        where,
        select: { id: true, name: true, type: true, documentTemplateId: true, status: true, createdAt: true },
        orderBy: { createdAt: 'desc' },
      });
      // Plain array, like getAllDocuments — the global response wrapper adds
      // the { success, data } envelope.
      return rows.map((d) => ({
        id: d.id,
        name: d.name,
        documentType: d.type,
        templateId: d.documentTemplateId,
        status: d.status,
        createdAt: d.createdAt,
      }));
    } catch (error) {
      throw new HttpException(`Fetch documents for navigation failed: ${error.message}`, HttpStatus.INTERNAL_SERVER_ERROR);
    }
  }

  // Server-side paginated / filtered / sorted document list. ADDITIVE — the
  // legacy getAllDocuments (fetch-all) stays for other consumers (the editor's
  // prev/next arrows now use getDocumentsForNavigation). Customer/item live in the `config` JSON;
  // customer is filtered/searched via JSON paths (recent docs store
  // config.customer.id). Sort is limited to real columns (name/createdAt/
  // status/type) since Prisma orderBy can't target JSON paths.
  async getDocumentsPaginated(
    organizationId: string,
    opts: {
      page?: number;
      limit?: number;
      search?: string;
      documentTypes?: string[]; // include ONLY these (variant codes)
      excludeTypes?: string[]; // OR exclude these (Documents page hides invoices)
      status?: string | string[];
      customerId?: string;
      createdOn?: { startDate?: string | Date | null; endDate?: string | Date | null };
      sortBy?: 'name' | 'createdAt' | 'status' | 'type' | 'issueDate';
      sortDir?: 'asc' | 'desc';
      // Only documents built on this template — the editor's Locate dialog
      // (it used to pull EVERY document in the org and filter in the browser:
      // 12s for Chong Aik's 25.8k documents — guru 2026-10-23).
      templateId?: string;
      // Which side of the books. Credit and debit notes exist in BOTH
      // directions under one type, and Sales must show only the ones we issue
      // to a customer — a supplier's credit note belongs in the purchase
      // journal under AP (guru 2026-11-12).
      counterparty?: 'CUSTOMER' | 'SUPPLIER';
    } = {},
    callerUserId?: string,
  ) {
    try {
      const page = Math.max(1, opts.page || 1);
      const limit = Math.min(200, Math.max(1, opts.limit || 20));
      const skip = (page - 1) * limit;

      const where: any = { organizationId };
      const and: any[] = [];

      // Designers only see their own quotations (guru 2026-09-12): when the
      // caller's ONLY org role is Designer and this is a quotation/VO listing,
      // scope to quotes they own — the stamped config.designerUserId (designer
      // picker / create paths write it), the quote header's copy, or a linked
      // project they are the designer of. Other doc types and other roles are
      // untouched.
      const DESIGNER_SCOPED_TYPES = new Set(['QUOTATION', 'QO', 'QO1', 'QO2', 'QT', 'VARIATION_ORDER']);
      if (callerUserId && opts.documentTypes?.length && opts.documentTypes.every((t) => DESIGNER_SCOPED_TYPES.has(String(t).toUpperCase()))) {
        const roles = await this.prisma.userRole.findMany({
          where: { userId: callerUserId, organizationId, isActive: true },
          select: { role: { select: { name: true } } },
        });
        const names = roles.map((r) => r.role.name);
        if (names.length > 0 && names.every((n) => n === 'Designer')) {
          and.push({
            OR: [
              { config: { path: ['designerUserId'], equals: callerUserId } },
              { config: { path: ['quote', 'header', 'designerUserId'], equals: callerUserId } },
              { project: { designerUserId: callerUserId } },
            ],
          });
        }
      }

      if (opts.documentTypes?.length) where.type = { in: opts.documentTypes };
      // Soft-deleted drafts (type DELETED) are never listed.
      else if (opts.excludeTypes?.length) where.type = { notIn: [...opts.excludeTypes, SOFT_DELETED_TYPE] };
      else where.type = { not: SOFT_DELETED_TYPE };
      if (opts.templateId) where.documentTemplateId = opts.templateId;

      // Voided documents (config.voided: the Void button, a voided journal, a cancelled order): out of the
      // default list, and the only rows under the "Voided" status filter. No such rows = no change.
      {
        const asked = (Array.isArray(opts.status) ? opts.status : [opts.status]).filter(Boolean) as string[];
        const voidedIds = await voidedDocumentIds(this.prisma, organizationId);
        if (asked.includes('voided')) {
          and.push({ id: { in: voidedIds } });
          const rest = asked.filter((x) => x !== 'voided');
          opts = { ...opts, status: rest.length ? rest : undefined };
        } else if (voidedIds.length) and.push({ id: { notIn: voidedIds } });
      }

      // WCT group status set (common/wct-statuses.ts, features.enableWctStatuses): on a quotation, DO or invoice
      // list the filter takes the WCT values (Unconfirmed / Declined, Draft / Completed, Unpaid / Overdue /
      // Credited…), matched on the same rule the rows are shown with. Display only; other orgs never get here.
      const wctOn = await isOrgFeatureEnabled(this.prisma, organizationId, WCT_STATUSES_FLAG).catch(() => false);
      const wctFam = wctOn ? wctFamilyOfTypes(opts.documentTypes) : null;
      if (wctFam && opts.status) {
        const wanted = (Array.isArray(opts.status) ? opts.status : [opts.status]).filter(Boolean) as string[];
        if (wanted.length && wanted.every((v) => isWctStatusValue(wctFam, v))) {
          const classes = await this.wctStatusClasses(organizationId, opts.documentTypes!);
          // "Overdue" takes "Overdue · part paid" too (wctStatusMatches).
          const hit = classes.filter((r) => wctStatusMatches(wanted, r.cls)).map((r) => r.id);
          const miss = classes.filter((r) => !wctStatusMatches(wanted, r.cls)).map((r) => r.id);
          // The smaller list (the rows are already limited to these types): at most half the family.
          if (hit.length <= miss.length) and.push({ id: { in: hit } });
          else if (miss.length) and.push({ id: { notIn: miss } });
          opts = { ...opts, status: undefined };
        }
      }

      // WCT group wording (enableWctStatusFlow, portal helpers/wctStatusFlow.ts): "Draft" = made by the system and
      // never saved by a person (no config.savedAt), "Pending" = someone has saved it and it is not finished.
      // Neither is a stored status, so both are resolved to ids here. Only lists that offer them send them.
      {
        const asked = (Array.isArray(opts.status) ? opts.status : [opts.status]).filter(Boolean) as string[];
        const wantsDraft = asked.includes('flow_draft');
        const wantsPending = asked.includes('flow_pending');
        if ((wantsDraft || wantsPending) && opts.documentTypes?.length) {
          const isDo = opts.documentTypes.every((t) => ['DELIVERY_ORDER', 'DO'].includes(String(t).toUpperCase()));
          const rows: Array<{ id: string; untouched: boolean }> = await this.prisma.$queryRaw`
            SELECT d.id,
                   (d.status::text IN ('draft', 'unconfirmed') AND d.config ->> 'savedAt' IS NULL AND COALESCE(d.config ->> 'awaitingSignature', 'false') <> 'true') AS untouched
            FROM "Document" d
            WHERE d."organizationId" = ${organizationId}
              AND d.type::text = ANY(${opts.documentTypes})
              AND ((${isDo} AND d.status::text NOT IN ('delivered_installed', 'cancelled') AND COALESCE(d.config ->> 'cancelled', 'false') <> 'true')
                OR (NOT ${isDo} AND d.status::text IN ('draft', 'unconfirmed')))`;
          const ids = rows.filter((r) => (r.untouched ? wantsDraft : wantsPending)).map((r) => r.id);
          const rest = asked.filter((x) => x !== 'flow_draft' && x !== 'flow_pending');
          and.push(rest.length ? { OR: [{ id: { in: ids } }, { status: { in: rest } }] } : { id: { in: ids } });
          opts = { ...opts, status: undefined };
        }
      }

      if (opts.status) {
        const all = (Array.isArray(opts.status) ? opts.status : [opts.status]).filter(Boolean);
        // "partially_paid" is not a stored status: it is an unpaid document with
        // money paid AND money still owed (the stamps document-money.ts writes
        // after every payment). Filtering by it, or by pending_payment, splits
        // those rows the way the lists' chips do. Matched in SQL with COALESCE:
        // a Prisma JSON `gt` on a missing key is NULL, and NOT(NULL) drops the
        // row, so the never-stamped invoices vanished from Awaiting Payment.
        // An invoice is never "Confirmed" (guru 2026-11-14): a row still at the
        // generic `confirmed` status (imported books) is Awaiting Payment, so
        // the Awaiting Payment filter on an invoice list includes it.
        const INVOICE_T = ['INVOICE', 'TI', 'TI2'];
        if (opts.documentTypes?.length && opts.documentTypes.every((t) => INVOICE_T.includes(String(t).toUpperCase())) && all.includes('pending_payment') && !all.includes('confirmed')) all.push('confirmed');
        const PARTIAL = 'partially_paid';
        const s = all.filter((x) => x !== PARTIAL);
        const wantsPartial = all.includes(PARTIAL);
        const splitsPending = s.length >= 1 && s.includes('pending_payment') && s.every((x) => x === 'pending_payment' || x === 'confirmed');
        if (wantsPartial || splitsPending) {
          const partial: Array<{ id: string }> = await this.prisma.$queryRaw`
            SELECT d.id FROM "Document" d
            WHERE d."organizationId" = ${organizationId}
              -- Same exclusions the chip makes (components/StatusChip.tsx
              -- docDisplayStatus), so the filter cannot hand back a row that
              -- then renders as Paid or Cancelled.
              -- ::text — the DocumentStatus enum has no cancelled / voided, Postgres refuses the bare compare.
              AND d.status::text NOT IN ('paid', 'returned', 'cancelled', 'voided')
              AND COALESCE(d.config ->> 'voided', 'false') <> 'true'
              AND COALESCE((d.config ->> 'paidToDate')::numeric, (d.config ->> 'xeroAmountPaid')::numeric, 0) > 0.005
              AND COALESCE((d.config ->> 'outstandingBalance')::numeric, (d.config ->> 'xeroBalance')::numeric, 0) > 0.005
            LIMIT 5000`;
          const partialIds = partial.map((h) => h.id);
          if (wantsPartial) {
            const inPartial = { id: { in: partialIds } };
            and.push(s.length ? { OR: [inPartial, { status: { in: s } }] } : inPartial);
          } else {
            where.status = s.length > 1 ? { in: s } : 'pending_payment';
            if (partialIds.length) and.push({ id: { notIn: partialIds } });
          }
        } else if (s.length >= 1) {
          // WCT imported quotations the ERP has open (Draft / Sent) are Unconfirmed, and ones it cancelled
          // since import are Cancelled, whatever their stored status (common/erp-import.ts). None = no change.
          const erpQ = await this.erpQuotationDisplayIds(organizationId, opts.documentTypes);
          // Round 35: an ERP draft over 6 months old is Expired: never under Unconfirmed, only under "expired".
          const shown = [...erpQ.unconfirmed, ...erpQ.cancelled, ...erpQ.expired];
          const stored = s.length === 1 ? s[0] : { in: s };
          if (!shown.length) where.status = stored as any;
          else {
            const wantsUnconfirmed = s.includes('unconfirmed') || s.includes('draft');
            const wantsExpired = s.includes('expired');
            and.push({
              OR: [
                { AND: [{ status: stored as any }, { id: { notIn: shown } }] },
                ...(wantsUnconfirmed && erpQ.unconfirmed.length ? [{ id: { in: erpQ.unconfirmed } }] : []),
                ...(wantsExpired && erpQ.expired.length ? [{ id: { in: erpQ.expired } }] : []),
              ],
            });
          }
        }
      }

      // A supplier-side document is one that names a supplier: on an AP credit
      // note the customer block, where present, is OUR OWN company as the
      // recipient, so "has a customer" is not the test. Matched in SQL because
      // Prisma's JSON filters can't express "this key exists and isn't null"
      // across both shapes (config.supplier.id and the flat config.supplierId).
      if (opts.counterparty) {
        const typeFilter = opts.documentTypes?.length ? opts.documentTypes : null;
        const supplierSide: Array<{ id: string }> = typeFilter
          ? await this.prisma.$queryRaw`
              SELECT d.id FROM "Document" d
              WHERE d."organizationId" = ${organizationId}
                AND d.type = ANY(${typeFilter})
                AND COALESCE(d.config #>> '{supplier,id}', d.config ->> 'supplierId') IS NOT NULL`
          : await this.prisma.$queryRaw`
              SELECT d.id FROM "Document" d
              WHERE d."organizationId" = ${organizationId}
                AND COALESCE(d.config #>> '{supplier,id}', d.config ->> 'supplierId') IS NOT NULL`;
        const ids = supplierSide.map((r) => r.id);
        if (opts.counterparty === 'SUPPLIER') {
          and.push({ id: { in: ids } });
        } else if (ids.length) {
          and.push({ id: { notIn: ids } });
        }
      }

      if (opts.customerId) {
        and.push({
          OR: [
            { config: { path: ['customer', 'id'], equals: opts.customerId } },
            { config: { path: ['customerId'], equals: opts.customerId } },
          ],
        });
      }

      if (opts.createdOn?.startDate || opts.createdOn?.endDate) {
        where.createdAt = {};
        if (opts.createdOn.startDate) where.createdAt.gte = new Date(opts.createdOn.startDate);
        if (opts.createdOn.endDate) {
          const end = new Date(opts.createdOn.endDate);
          end.setHours(23, 59, 59, 999);
          where.createdAt.lte = end;
        }
      }

      const term = (opts.search || '').trim();
      if (term) {
        // Customer + reference live in config JSON under several shapes
        // (imported docs: customer.name / xeroReference; editor-born docs:
        // customerName / referenceNo; documentInfo.referenceNo everywhere).
        // Prisma's JSON `string_contains` has NO insensitive mode, so a
        // casing probe was used here and still missed names like
        // "GS Perfect Engineering" typed as "gs perfect" (guru 2026-10-20).
        // Match the JSON paths with real SQL ILIKE instead and feed the ids
        // back into the Prisma where-clause.
        const like = `%${term.replace(/[\\%_]/g, (ch) => '\\' + ch)}%`;
        // Once the org's list keys are filled (aims_doc_list_keys trigger), search the small
        // listSearch / listCustomerId columns instead of unpacking every config (WCT's 24k
        // documents took 2-4 s per search). Same fields, same customer-name match.
        const customerIdsLike = Prisma.sql`SELECT c.id::text FROM "Customer" c WHERE c."organizationId" = ${organizationId} AND c.name ILIKE ${like} ESCAPE '\\'`;
        const hits: Array<{ id: string }> = (await this.listKeysReady(organizationId))
          ? await this.prisma.$queryRaw`
          SELECT d.id FROM "Document" d
          WHERE d."organizationId" = ${organizationId}
            AND (
              d."listSearch" ILIKE ${like} ESCAPE '\\'
              OR d."listCustomerId" IN (
                SELECT c.id::text FROM "Customer" c
                WHERE c."organizationId" = ${organizationId} AND c.name ILIKE ${like} ESCAPE '\\'
              )
            )
          LIMIT 5000`
          : await this.prisma.$queryRaw`
          SELECT d.id FROM "Document" d
          WHERE d."organizationId" = ${organizationId}
            AND (
              d.config #>> '{customer,name}' ILIKE ${like} ESCAPE '\\'
              OR d.config ->> 'customerName' ILIKE ${like} ESCAPE '\\'
              OR d.config ->> 'reference' ILIKE ${like} ESCAPE '\\'
              OR d.config ->> 'referenceNo' ILIKE ${like} ESCAPE '\\'
              OR d.config ->> 'xeroReference' ILIKE ${like} ESCAPE '\\'
              OR d.config #>> '{documentInfo,referenceNo}' ILIKE ${like} ESCAPE '\\'
              OR d.config #>> '{documentInfo,reference}' ILIKE ${like} ESCAPE '\\'
              OR d.config #>> '{supplier,name}' ILIKE ${like} ESCAPE '\\'
              OR d.config ->> 'supplierName' ILIKE ${like} ESCAPE '\\'
              -- The list resolves the CUSTOMER column from the id in config
              -- against the Customer table, so a document that stores only an
              -- id showed a name the search could not find (guru 2026-10-20).
              -- Uncorrelated IN (hashed once per search), not a per-document EXISTS: the
              -- EXISTS re-ran the customer match for every document (Biofuel: 18 s avg,
              -- 281 s max on short terms; 2026-11-19). Same rows.
              OR d.config #>> '{customer,id}' IN (${customerIdsLike})
              OR d.config ->> 'customerId' IN (${customerIdsLike})
            )
          LIMIT 5000`;
        const or: any[] = [
          { name: { contains: term, mode: 'insensitive' } },
          { type: { contains: term, mode: 'insensitive' } },
        ];
        if (hits.length) or.push({ id: { in: hits.map((h) => h.id) } });
        // WCT group (enableWctOrders, 2026-11-23): a number also finds the documents linked to it (order, its
        // quotation, DOs, invoices; orders/linked-number-search.ts). The list's type filter keeps its own type.
        if (wantsLinkedSearch(term) && (await isWctOrdersEnabled(this.prisma as any, organizationId))) {
          const linked = await linkedDocIdsForNumber(this.prisma, organizationId, term).catch(() => [] as string[]);
          if (linked.length) or.push({ id: { in: linked } });
        }
        and.push({ OR: or });
      }

      if (and.length) where.AND = and;

      const sortDir = opts.sortDir === 'asc' ? 'asc' : 'desc';
      let rows: any[];
      let total: number;
      if (opts.sortBy === 'issueDate' && (await this.listKeysReady(organizationId))) {
        // Issue date sorted in the database on the trigger-kept listIssueDate (same key as
        // documentIssueDate; ties by createdAt, as before), then just this page is loaded.
        const ids = (await this.prisma.document.findMany({ where, select: { id: true } })).map((d) => d.id);
        const dir = Prisma.raw(sortDir === 'asc' ? 'ASC' : 'DESC');
        const ordered: Array<{ id: string }> = ids.length
          ? await this.prisma.$queryRaw`
              SELECT id::text AS id FROM "Document"
              WHERE "organizationId" = ${organizationId} AND id = ANY(${ids}::uuid[])
              ORDER BY "listIssueDate" ${dir}, "createdAt" ${dir}, id ${dir}
              LIMIT ${limit} OFFSET ${skip}`
          : [];
        const pageIds = ordered.map((x) => x.id);
        const page = pageIds.length ? await this.prisma.document.findMany({ where: { id: { in: pageIds }, organizationId } }) : [];
        const byId = new Map(page.map((d: any) => [d.id, d]));
        rows = pageIds.map((id) => byId.get(id)).filter(Boolean);
        total = ids.length;
      } else if (opts.sortBy === 'issueDate') {
        // The issue date lives in config JSON (documentInfo.date / date / issueDate):
        // order the matching ids in memory, then load just this page.
        const keys = await this.prisma.document.findMany({ where, select: { id: true, createdAt: true, config: true } });
        const sorted = keys
          .map((d: any) => ({ id: d.id, key: documentIssueDate(d.config, d.createdAt), at: d.createdAt.getTime() }))
          .sort((a, b) => (a.key === b.key ? a.at - b.at : a.key < b.key ? -1 : 1) * (sortDir === 'asc' ? 1 : -1));
        const ids = sorted.slice(skip, skip + limit).map((x) => x.id);
        const page = await this.prisma.document.findMany({ where: { id: { in: ids }, organizationId } });
        const byId = new Map(page.map((d: any) => [d.id, d]));
        rows = ids.map((id) => byId.get(id)).filter(Boolean);
        total = keys.length;
      } else {
        const sortBy = ['name', 'createdAt', 'status', 'type'].includes(opts.sortBy as string) ? (opts.sortBy as string) : 'createdAt';
        [rows, total] = await Promise.all([
          this.prisma.document.findMany({ where, orderBy: { [sortBy]: sortDir }, skip, take: limit }),
          this.prisma.document.count({ where }),
        ]);
      }

      const customerIds = rows
        .map((d: any) => (d.config as any)?.customer?.id || (d.config as any)?.customerId)
        .filter(Boolean);
      const customers = customerIds.length
        ? await this.prisma.customer.findMany({ where: { id: { in: [...new Set(customerIds)] } }, select: { id: true, name: true } })
        : [];
      const customerMap = new Map(customers.map((c) => [c.id, c.name]));

      // Quotation project lives on the Document.projectId COLUMN (not config),
      // so it was being stripped from this response — resolve names in one batch.
      const projectIds = rows.map((d: any) => d.projectId).filter(Boolean);
      const projects = projectIds.length
        ? await this.prisma.project.findMany({ where: { id: { in: [...new Set(projectIds)] } }, select: { id: true, name: true } })
        : [];
      const projectMap = new Map(projects.map((p) => [p.id, p.name]));
      const orderByQuotation = await this.quotationOrders(organizationId, rows);
      // WCT group: each row's status in the WCT set (the chip shows it).
      const wctToday = sgToday();
      const wctCredits = wctOn ? await this.wctInvoiceCredits(organizationId, rows.filter((d: any) => wctFamilyOf(d.type) === 'INVOICE').map((d: any) => d.id)) : new Map<string, number>();

      const docs = rows.map((doc: any) => {
        const config = doc.config as any;
        const cid = config?.customer?.id || config?.customerId;
        return {
          id: doc.id,
          name: doc.name,
          associated_item: config?.items?.[0]?.sku ?? 'N/A',
          // Who the document is WITH. A credit/debit note raised against a
          // SUPPLIER has no customer at all, and the column used to read a bare
          // "N/A" for every one of them (guru 2026-11-12) — fall back to the
          // supplier the document actually names before giving up.
          associated_customer:
            (cid && customerMap.get(cid)) ||
            config?.customer?.name ||
            config?.supplier?.name ||
            config?.supplierName ||
            'N/A',
          // ...and WHICH side that name is. A credit note list mixes the ones
          // we issue to a customer with the ones a supplier issues to us, and
          // the two move money in opposite directions (guru 2026-11-12: "it
          // should state if its a supplier cn or we send to the customer").
          // A named supplier is the decisive signal: on an AP note the
          // customer block, when present at all, is US as the recipient.
          counterpartyKind: counterpartyKind(config),
          documentType: doc.type,
          templateId: doc.documentTemplateId,
          status: doc.status,
          createdAt: doc.createdAt,
          // The document's own date (YYYY-MM-DD; the created date when it has none).
          issueDate: documentIssueDate(config, doc.createdAt),
          // The project column + its resolved name (null when unset) so the
          // schedule dialog's extract can fill the project from real quotations.
          projectId: doc.projectId ?? null,
          projectName: (doc.projectId && projectMap.get(doc.projectId)) ?? null,
          config: doc.config,
          // WCT: the order a confirmed quotation became (the list shows its number).
          ...(orderByQuotation.has(doc.id) ? { linkedOrder: orderByQuotation.get(doc.id) } : {}),
          // Imported from the previous ERP (common/erp-import.ts): the list shows an "Imported" tag.
          ...(isErpImported(config) ? { imported: true } : {}),
          // WCT imported quotation still open in the ERP: "ERP draft" / "ERP sent" beside its status.
          ...(erpQuotationTag(doc.type, config, { today: wctToday, createdAt: doc.createdAt }) ? { erpTag: erpQuotationTag(doc.type, config, { today: wctToday, createdAt: doc.createdAt }) } : {}),
          // Round 35: the ERP quotation's display state decided here (SG today), so the chip never guesses the 6-month cut.
          ...(erpQuotationDisplayStatus(doc.type, config, { today: wctToday, createdAt: doc.createdAt }) ? { erpQuoteStatus: erpQuotationDisplayStatus(doc.type, config, { today: wctToday, createdAt: doc.createdAt }) } : {}),
          ...(wctOn && wctFamilyOf(doc.type) ? { wctStatus: wctStatusOf({ type: doc.type, status: doc.status, config, creditFromNotes: wctCredits.get(doc.id) ?? 0, today: wctToday, createdAt: doc.createdAt }) } : {}),
        };
      });

      return { docs, total, page, limit, totalPages: Math.ceil(total / limit) };
    } catch (error) {
      throw new HttpException(`Fetch documents failed: ${error.message}`, HttpStatus.INTERNAL_SERVER_ERROR);
    }
  }

  // Aggregate counts for the list stat cards (total / this-month / drafts),
  // computed server-side so they stay accurate when the list is server-paginated
  // (the paginated query only returns one page). Counts the full type set,
  // independent of the user's search/filter.
  /** WCT status set: confirmed credit notes' gross per source invoice (all the org's, or these invoices). */
  async wctInvoiceCredits(organizationId: string, invoiceIds?: string[]): Promise<Map<string, number>> {
    if (invoiceIds && !invoiceIds.length) return new Map();
    const rows: Array<{ id: string; credit: number }> = await this.prisma.$queryRaw`
      SELECT d.config ->> 'sourceDocumentId' AS id,
             SUM(COALESCE((d.config ->> 'totalWithTax')::numeric, (d.config ->> 'xeroGross')::numeric, (d.config ->> 'nettTotal')::numeric, 0))::float8 AS credit
      FROM "Document" d
      WHERE d."organizationId" = ${organizationId}
        AND upper(d.type::text) IN ('CREDIT_NOTE', 'CN')
        AND d.status::text NOT IN ('draft', 'unconfirmed')
        AND COALESCE(d.config ->> 'voided', 'false') <> 'true'
        AND d.config ->> 'sourceDocumentId' IS NOT NULL
        ${invoiceIds ? Prisma.sql`AND d.config ->> 'sourceDocumentId' = ANY(${invoiceIds})` : Prisma.empty}
      GROUP BY 1`;
    return new Map(rows.map((r) => [r.id, Number(r.credit) || 0]));
  }

  /** WCT status set: every document of these types in the org with its WCT status (common/wct-statuses.ts). */
  async wctStatusClasses(organizationId: string, documentTypes: string[]): Promise<Array<{ id: string; cls: string }>> {
    const docs: Array<{ id: string; type: string; status: string; config: any; listIssueDate?: string | null; createdAt?: Date | null }> = await this.prisma.$queryRaw`
      SELECT d.id, d.type::text AS type, d.status::text AS status, d."listIssueDate" AS "listIssueDate", d."createdAt" AS "createdAt",
             jsonb_build_object(
               'cancelled', d.config -> 'cancelled', 'voided', d.config -> 'voided',
               'erpImport', jsonb_build_object('source', d.config #> '{erpImport,source}', 'status', d.config #> '{erpImport,status}', 'creditNotes', d.config #> '{erpImport,creditNotes}',
                 'ownerConfirmed', d.config #> '{erpImport,ownerConfirmed}', 'statusAtFirstImport', d.config #> '{erpImport,statusAtFirstImport}'),
               'date', d.config -> 'date',
               'totalWithTax', d.config -> 'totalWithTax', 'xeroGross', d.config -> 'xeroGross', 'nettTotal', d.config -> 'nettTotal',
               'outstandingBalance', d.config -> 'outstandingBalance', 'xeroBalance', d.config -> 'xeroBalance',
               'paidToDate', d.config -> 'paidToDate', 'xeroAmountPaid', d.config -> 'xeroAmountPaid',
               'dueDate', d.config -> 'dueDate', 'documentInfo', jsonb_build_object('dueDate', d.config #> '{documentInfo,dueDate}', 'date', d.config #> '{documentInfo,date}')
             ) AS config
      FROM "Document" d
      WHERE d."organizationId" = ${organizationId} AND d.type::text = ANY(${documentTypes})`;
    const credits = docs.some((d) => wctFamilyOf(d.type) === 'INVOICE') ? await this.wctInvoiceCredits(organizationId) : new Map<string, number>();
    const today = sgToday();
    return docs.map((d) => ({ id: d.id, cls: wctStatusOf({ type: d.type, status: d.status, config: d.config, creditFromNotes: credits.get(d.id) ?? 0, today, listIssueDate: d.listIssueDate ?? null, createdAt: d.createdAt ?? null }) || '' }));
  }

  /**
   * WCT imported quotations whose list status comes from the ERP (common/erp-import.ts erpQuotationDisplayStatus):
   * open in the ERP (Draft / Sent) = unconfirmed; open at import and cancelled since = cancelled. Only asked when
   * the list can hold quotations; other orgs have no wct-erp imports, so both lists are empty for them.
   */
  async erpQuotationDisplayIds(organizationId: string, documentTypes?: string[], today = sgToday()): Promise<{ unconfirmed: string[]; cancelled: string[]; expired: string[] }> {
    if (documentTypes?.length && !documentTypes.some((t) => isQuotationDocType(t))) return { unconfirmed: [], cancelled: [], expired: [] };
    // Round 35: the quotation's own date too (config.date, else documentInfo.date, else the list date, else created),
    // classified by the one rule in erp-import.ts (erpDraftState), so the lists, filter, cards and chips agree.
    const rows: Array<{ id: string; status: string | null; first: string | null; cdate: string | null; idate: string | null; ldate: string | null; created: Date | null }> = await this.prisma.$queryRaw`
      SELECT d.id, lower(d.config #>> '{erpImport,status}') AS status, lower(d.config #>> '{erpImport,statusAtFirstImport}') AS first,
             d.config ->> 'date' AS cdate, d.config #>> '{documentInfo,date}' AS idate, d."listIssueDate" AS ldate, d."createdAt" AS created
      FROM "Document" d
      WHERE d."organizationId" = ${organizationId}
        AND upper(d.type::text) IN ('QUOTATION', 'QO', 'QT', 'QO1')
        AND d.config #>> '{erpImport,source}' = 'wct-erp'
        AND ((lower(d.config #>> '{erpImport,status}') IN ('draft', 'sent') AND d.config #> '{erpImport,ownerConfirmed}' IS NULL)
             OR (lower(d.config #>> '{erpImport,status}') = ANY(${ERP_QUOTE_CANCELLED_STATUSES}) AND lower(d.config #>> '{erpImport,statusAtFirstImport}') IN ('draft', 'sent')))`;
    const out = { unconfirmed: [] as string[], cancelled: [] as string[], expired: [] as string[] };
    for (const r of rows) {
      const date = erpQuotationDate({ date: r.cdate, documentInfo: { date: r.idate } }, { listIssueDate: r.ldate, createdAt: r.created });
      // ownerConfirmed rows are already left out by the query; the cancelled branch needs statusAtFirstImport.
      const st = erpDraftState({ status: r.status, statusAtFirstImport: r.first }, date, today);
      if (st) out[st].push(r.id);
    }
    return out;
  }

  async getDocumentStats(
    organizationId: string,
    opts: { documentTypes?: string[]; counterparty?: 'CUSTOMER' | 'SUPPLIER' } = {},
  ) {
    try {
      const base: any = { organizationId };
      if (opts.documentTypes?.length) base.type = { in: opts.documentTypes };
      else base.type = { not: SOFT_DELETED_TYPE }; // soft-deleted drafts are never counted
      // The cards sit above the list and must count the SAME rows it shows:
      // a Sales credit-note list scoped to customers can't head a total that
      // includes the supplier ones (guru 2026-11-12).
      if (opts.counterparty) {
        const supplierSide: Array<{ id: string }> = await this.prisma.$queryRaw`
          SELECT d.id FROM "Document" d
          WHERE d."organizationId" = ${organizationId}
            AND COALESCE(d.config #>> '{supplier,id}', d.config ->> 'supplierId') IS NOT NULL`;
        const ids = supplierSide.map((r) => r.id);
        if (opts.counterparty === 'SUPPLIER') base.id = { in: ids };
        else if (ids.length) base.id = { notIn: ids };
      }
      const monthStart = new Date();
      monthStart.setDate(1);
      monthStart.setHours(0, 0, 0, 0);

      const erpQ = await this.erpQuotationDisplayIds(organizationId, opts.documentTypes);
      const [total, thisMonth, storedDrafts, erpOpen] = await Promise.all([
        this.prisma.document.count({ where: base }),
        this.prisma.document.count({ where: { ...base, createdAt: { gte: monthStart } } }),
        this.prisma.document.count({ where: { ...base, status: { in: ['draft', 'unconfirmed'] as any } } }),
        // WCT imported quotations the ERP has open read as Unconfirmed (their stored status is confirmed).
        erpQ.unconfirmed.length ? this.prisma.document.count({ where: { AND: [base, { id: { in: erpQ.unconfirmed } }, { status: { notIn: ['draft', 'unconfirmed'] as any } }] } }) : Promise.resolve(0),
      ]);
      return { total, thisMonth, drafts: storedDrafts + erpOpen };
    } catch (error) {
      throw new HttpException(`Fetch document stats failed: ${error.message}`, HttpStatus.INTERNAL_SERVER_ERROR);
    }
  }

  async getDeliveryOrdersByCustomer(customerId: string, organizationId: string) {
    try {
      console.log('🚚 DELIVERY ORDERS: Fetching for customer:', customerId, 'in organization:', organizationId);

      // Get all delivery orders
      const deliveryOrders = await this.prisma.document.findMany({
        where: {
          organizationId: organizationId,
          type: 'DO', // Delivery Order document type
        },
        orderBy: { createdAt: 'desc' },
      });

      // Filter by customerId in config
      const filteredOrders = deliveryOrders.filter((doc: any) => {
        const config = doc.config as any;
        return config?.customerId === customerId;
      });

      console.log('🚚 DELIVERY ORDERS: Found', filteredOrders.length, 'delivery orders for customer');

      // Fetch customer details
      const customer = await this.prisma.customer.findUnique({
        where: { id: customerId },
        select: { name: true },
      });

      const result = filteredOrders.map((doc: any) => {
        const config = doc.config as any;
        return {
          id: doc.id,
          name: doc.name,
          doNo: config?.doNo || doc.name, // Use doNo from config or fallback to name
          status: doc.status,
          customerId: config?.customerId,
          customerName: customer?.name,
          createdAt: doc.createdAt,
        };
      });

      console.log('🚚 DELIVERY ORDERS: Returning:', result);
      return result;
    } catch (error) {
      console.error('🔴 DELIVERY ORDERS: Error fetching delivery orders:', error);
      throw new HttpException(`Fetch delivery orders failed: ${error.message}`, HttpStatus.INTERNAL_SERVER_ERROR);
    }
  }
  async getDocumentsByAsset(assetId: string, organizationId: string) {
    try {
      const assetTemplateTags = await this.prisma.assetTemplateTag.findMany({
        where: {
          assetId,
          asset: {
            organizationId, // Ensure asset belongs to the same organization
          },
        },
        include: {
          template: true,
        },
      });

      return assetTemplateTags.map((tag) => ({
        doc_id: tag.template.id,
        doc_name: tag.template.name,
        doc_type: tag.template.type,
      }));
    } catch (error) {
      throw new HttpException(`Fetch templates by asset failed: ${error.message}`, HttpStatus.INTERNAL_SERVER_ERROR);
    }
  }

  async tagTemplateToAsset(assetId: string, templateId: string, _organizationId: string) {
    try {
      return await this.prisma.assetTemplateTag.create({
        data: {
          assetId,
          templateId,
        },
      });
    } catch (error) {
      throw new HttpException(`Failed to tag template to asset: ${error.message}`, HttpStatus.INTERNAL_SERVER_ERROR);
    }
  }

  async untagTemplateFromAsset(assetId: string, templateId: string, _organizationId: string) {
    try {
      return await this.prisma.assetTemplateTag.delete({
        where: {
          assetId_templateId: {
            assetId,
            templateId,
          },
        },
      });
    } catch (error) {
      throw new HttpException(`Failed to untag template from asset: ${error.message}`, HttpStatus.INTERNAL_SERVER_ERROR);
    }
  }

  /**
   * Create an invoice in Xero based on the document data
   * This is called when TI (Invoice) documents are created or updated with non-draft status
   */
  private async createXeroInvoice(document: any, config: any, organizationId: string) {
    try {
      console.log('🔍 XERO: Starting invoice creation process for document:', document.id);

      // Extract customerId from config
      const customerId = config?.customerId;
      console.log('🔍 XERO: Document details - Name:', document.name, 'Customer ID:', customerId);

      if (!customerId) {
        console.error('🔴 XERO: Customer ID not found in document config:', document.id);
        throw new Error('Customer ID not found in document config');
      }

      // Get customer information
      const customer = await this.prisma.customer.findUnique({
        where: { id: customerId },
      });

      if (!customer) {
        console.error('🔴 XERO: Customer not found for document:', document.id, 'Customer ID:', customerId);
        throw new Error('Customer not found for invoice');
      }

      console.log('✅ XERO: Customer found - Name:', customer.name, 'Email:', customer.email || 'No email');

      // Extract invoice data from the document config
      const lineItems = [];
      console.log('🔍 XERO: Processing document items:', config.items ? config.items.length : 0, 'items found');

      // Process items if they exist
      if (config.items && Array.isArray(config.items)) {
        for (const [index, item] of config.items.entries()) {
          console.log(`🔍 XERO: Processing item ${index + 1} - Inventory ID:`, item.inventoryItemId, 'Quantity:', item.quantity);

          // Get inventory item details
          const inventoryItem = await this.prisma.inventory.findUnique({
            where: { id: item.inventoryItemId },
            include: { asset: true },
          });

          if (inventoryItem) {
            const lineItem = {
              description: item.description || inventoryItem.asset?.name || inventoryItem.sku || 'Item',
              quantity: item.quantity || 1,
              unitAmount: item.price || inventoryItem.asset?.price || 0, // Use item price first, then asset price
              accountCode: item.accountCode || '200', // Use selected account code or default to '200'
              taxType: 'NONE', // Default to no tax - you may want to make this configurable
            };
            lineItems.push(lineItem);
            console.log(`✅ XERO: Added line item ${index + 1} -`, lineItem.description, 'Qty:', lineItem.quantity, 'Price:', lineItem.unitAmount, 'Account:', lineItem.accountCode);
          } else {
            console.warn(`⚠️ XERO: Inventory item not found for ID:`, item.inventoryItemId);
          }
        }
      }

      // Format date to DD/MM/YYYY format like in the image
      const formatDate = (dateString: string) => {
        if (!dateString) return new Date().toLocaleDateString('en-GB');
        const date = new Date(dateString);
        return date.toLocaleDateString('en-GB');
      };

      // If no line items from inventory, create a generic line item
      if (lineItems.length === 0) {
        console.log('⚠️ XERO: No items found, creating generic line item');
        lineItems.push({
          description: `Service/Product - Invoice ${document.name || document.id}`,
          quantity: 1,
          unitAmount: 0, // You may want to add amount fields to your document config
          accountCode: '200',
          taxType: 'NONE',
        });
      }

      // Add reference line items AFTER all the actual items (only for Xero, not in app)
      const referenceItems = [];

      // Add DO reference if selected
      if (config.doNo) {
        console.log('📋 XERO: Adding DO reference line item for DO:', config.doNo);
        referenceItems.push({
          description: `Our DO No. ${config.doNo} dated ${formatDate(config.date)}`,
          quantity: 0, // No quantity for reference lines
          unitAmount: 0, // No amount for reference lines
          accountCode: '200',
          taxType: 'NONE',
        });
      }

      // Add quotation reference if available
      if (config.referenceNo) {
        console.log('📋 XERO: Adding quotation reference:', config.referenceNo);
        referenceItems.push({
          description: `Our Qtn Ref. ${config.referenceNo} dated ${formatDate(config.date)}`,
          quantity: 0,
          unitAmount: 0,
          accountCode: '200',
          taxType: 'NONE',
        });
      }

      // Add work order reference if available
      if (config.poNo) {
        console.log('📋 XERO: Adding work order reference:', config.poNo);
        referenceItems.push({
          description: `Your WO No. ${config.poNo} dated ${formatDate(config.date)}`,
          quantity: 0,
          unitAmount: 0,
          accountCode: '200',
          taxType: 'NONE',
        });
      }

      // Add location and project info if available
      if (config.deliveryTo) {
        console.log('📋 XERO: Adding location reference:', config.deliveryTo);
        referenceItems.push({
          description: `Location: ${config.deliveryTo}`,
          quantity: 0,
          unitAmount: 0,
          accountCode: '200',
          taxType: 'NONE',
        });
      }

      // Add project information if available
      if (config.projectId) {
        try {
          const project = await this.prisma.project.findUnique({
            where: { id: config.projectId },
            include: {
              siteOffice: {
                include: {
                  customer: true,
                },
              },
            },
          });

          if (project) {
            console.log('📋 XERO: Adding project reference:', project.name);
            referenceItems.push({
              description: `Project/Dept: ${project.name}`,
              quantity: 0,
              unitAmount: 0,
              accountCode: '200',
              taxType: 'NONE',
            });
          }
        } catch (error) {
          console.warn('⚠️ XERO: Could not fetch project information:', error.message);
        }
      }

      // Add all reference items to the end of line items
      lineItems.push(...referenceItems);

      if (referenceItems.length > 0) {
        console.log('✅ XERO: Added', referenceItems.length, 'reference line items');
      }

      console.log('📝 XERO: Total line items prepared:', lineItems.length);

      // Prepare invoice data for Xero
      const invoiceData = {
        contactName: customer.name,
        contactEmail: customer.email || '',
        reference: config.referenceNo || config.poNo || '',
        invoiceNumber: document.name || undefined, // Let Xero auto-generate if not provided
        dueDate: config.dueDate || undefined,
        lineItems: lineItems,
        status: 'DRAFT' as const, // Start as draft, you can change this based on document status
      };

      console.log('📤 XERO: Sending invoice data:', {
        contactName: invoiceData.contactName,
        reference: invoiceData.reference,
        invoiceNumber: invoiceData.invoiceNumber,
        dueDate: invoiceData.dueDate,
        lineItemsCount: invoiceData.lineItems.length,
      });

      // Create the invoice in Xero
      console.log('🚀 XERO: Calling Xero API to create invoice...');
      const xeroInvoice = await this.xeroService.createInvoice(organizationId, invoiceData);

      console.log('🎉 XERO: Invoice created successfully! Xero Invoice ID:', xeroInvoice?.invoiceID || 'No ID returned');

      // Store the Xero invoice ID in the document config
      if (xeroInvoice?.invoiceID) {
        console.log('💾 XERO: Storing Xero invoice ID in document config:', xeroInvoice.invoiceID);
        await this.prisma.document.update({
          where: { id: document.id },
          data: {
            config: {
              ...config,
              xeroInvoiceId: xeroInvoice.invoiceID,
            },
          },
        });
        console.log('✅ XERO: Xero invoice ID stored successfully');
      }

      return xeroInvoice;
    } catch (error) {
      console.error('💥 XERO: Failed to create invoice - Error type:', error.constructor.name);
      console.error('💥 XERO: Error message:', error.message);
      console.error('💥 XERO: Full error:', error);
      throw error;
    }
  }

  private async updateXeroInvoice(document: any, config: any, organizationId: string) {
    try {
      console.log('🔄 XERO: Starting invoice update process for document:', document.id);

      // Check if we have a Xero invoice ID stored
      let xeroInvoiceId = (config as any)?.xeroInvoiceId;

      if (!xeroInvoiceId) {
        console.log('⚠️ XERO: No Xero invoice ID found in config');

        // Try to find existing invoice by invoice number before creating new one
        const invoiceNumber = document.name;
        console.log('🔍 XERO: Searching for existing invoice with number:', invoiceNumber);

        try {
          const existingInvoice = await this.xeroService.findInvoiceByNumber(organizationId, invoiceNumber);
          if (existingInvoice) {
            console.log('✅ XERO: Found existing invoice in Xero with ID:', existingInvoice.invoiceID);
            xeroInvoiceId = existingInvoice.invoiceID;

            // Store the found invoice ID in the document config for future updates
            const updatedConfig = { ...config, xeroInvoiceId };
            await this.prisma.document.update({
              where: { id: document.id },
              data: { config: updatedConfig },
            });
            console.log('💾 XERO: Stored invoice ID in document config for future updates');
          } else {
            console.log('⚠️ XERO: No existing invoice found, creating new invoice');
            return await this.createXeroInvoice(document, config, organizationId);
          }
        } catch (searchError) {
          console.log('⚠️ XERO: Error searching for existing invoice, creating new invoice:', searchError.message);
          return await this.createXeroInvoice(document, config, organizationId);
        }
      }

      console.log('🔍 XERO: Found Xero invoice ID in config:', xeroInvoiceId);

      // Verify the invoice actually exists in Xero
      const invoiceExists = await this.xeroService.invoiceExists(organizationId, xeroInvoiceId);
      if (!invoiceExists) {
        console.log('⚠️ XERO: Invoice ID exists in config but not found in Xero, creating new invoice');
        // Clear the invalid xeroInvoiceId from config
        const updatedConfig = { ...config };
        delete (updatedConfig as any).xeroInvoiceId;

        // Update the document to remove the invalid xeroInvoiceId
        await this.prisma.document.update({
          where: { id: document.id },
          data: { config: updatedConfig },
        });

        return await this.createXeroInvoice(document, updatedConfig, organizationId);
      }

      console.log('✅ XERO: Invoice confirmed to exist in Xero, proceeding with update');

      // Extract customerId from config
      const customerId = config?.customerId;

      if (!customerId) {
        console.error('🔴 XERO: Customer ID not found in document config:', document.id);
        throw new Error('Customer ID not found in document config');
      }

      // Get customer information
      const customer = await this.prisma.customer.findUnique({
        where: { id: customerId },
      });

      if (!customer) {
        console.error('🔴 XERO: Customer not found for document:', document.id, 'Customer ID:', customerId);
        throw new Error('Customer not found for invoice update');
      }

      console.log('✅ XERO: Customer found - Name:', customer.name, 'Email:', customer.email || 'No email');

      // Extract invoice data from the document config (same logic as create)
      const lineItems = [];
      console.log('🔍 XERO: Processing document items for update:', config.items ? config.items.length : 0, 'items found');

      // Process items if they exist (same logic as createXeroInvoice)
      if (config.items && Array.isArray(config.items)) {
        for (const [index, item] of config.items.entries()) {
          console.log(`🔍 XERO: Processing item ${index + 1} - Inventory ID:`, item.inventoryItemId, 'Quantity:', item.quantity);

          const inventoryItem = await this.prisma.inventory.findUnique({
            where: { id: item.inventoryItemId },
            include: { asset: true },
          });

          if (inventoryItem) {
            const lineItem = {
              description: item.description || inventoryItem.asset?.name || inventoryItem.sku || 'Item',
              quantity: item.quantity || 1,
              unitAmount: item.price || inventoryItem.asset?.price || 0,
              accountCode: item.accountCode || '200',
              taxType: 'NONE',
            };
            lineItems.push(lineItem);
            console.log(`✅ XERO: Added line item ${index + 1} -`, lineItem.description, 'Qty:', lineItem.quantity, 'Price:', lineItem.unitAmount);
          } else {
            console.warn(`⚠️ XERO: Inventory item not found for ID:`, item.inventoryItemId);
          }
        }
      }

      // Format date to DD/MM/YYYY format like in the image
      const formatDate = (dateString: string) => {
        if (!dateString) return new Date().toLocaleDateString('en-GB');
        const date = new Date(dateString);
        return date.toLocaleDateString('en-GB');
      };

      // If no line items from inventory, create a generic line item
      if (lineItems.length === 0) {
        console.log('⚠️ XERO: No items found, creating generic line item');
        lineItems.push({
          description: `Service/Product - Invoice ${document.name || document.id}`,
          quantity: 1,
          unitAmount: 0,
          accountCode: '200',
          taxType: 'NONE',
        });
      }

      // Add reference line items AFTER all the actual items (same logic as create)
      const referenceItems = [];

      // Add DO reference if selected
      if (config.doNo) {
        referenceItems.push({
          description: `Our DO No. ${config.doNo} dated ${formatDate(config.date)}`,
          quantity: 0,
          unitAmount: 0,
          accountCode: '200',
          taxType: 'NONE',
        });
      }

      // Add quotation reference if available
      if (config.referenceNo) {
        referenceItems.push({
          description: `Our Qtn Ref. ${config.referenceNo} dated ${formatDate(config.date)}`,
          quantity: 0,
          unitAmount: 0,
          accountCode: '200',
          taxType: 'NONE',
        });
      }

      // Add work order reference if available
      if (config.poNo) {
        referenceItems.push({
          description: `Your WO No. ${config.poNo} dated ${formatDate(config.date)}`,
          quantity: 0,
          unitAmount: 0,
          accountCode: '200',
          taxType: 'NONE',
        });
      }

      // Add location and project info if available
      if (config.deliveryTo) {
        referenceItems.push({
          description: `Location: ${config.deliveryTo}`,
          quantity: 0,
          unitAmount: 0,
          accountCode: '200',
          taxType: 'NONE',
        });
      }

      // Add project information if available
      if (config.projectId) {
        try {
          const project = await this.prisma.project.findUnique({
            where: { id: config.projectId },
            include: {
              siteOffice: {
                include: {
                  customer: true,
                },
              },
            },
          });

          if (project) {
            referenceItems.push({
              description: `Project/Dept: ${project.name}`,
              quantity: 0,
              unitAmount: 0,
              accountCode: '200',
              taxType: 'NONE',
            });
          }
        } catch (error) {
          console.warn('⚠️ XERO: Could not fetch project information:', error.message);
        }
      }

      // Add all reference items to the end of line items
      lineItems.push(...referenceItems);

      console.log('📝 XERO: Total line items prepared for update:', lineItems.length);

      // Prepare invoice data for Xero update
      const invoiceData = {
        contactName: customer.name,
        contactEmail: customer.email || '',
        reference: config.referenceNo || config.poNo || '',
        invoiceNumber: document.name || undefined,
        dueDate: config.dueDate || undefined,
        lineItems: lineItems,
        status: 'DRAFT' as const,
      };

      console.log('🔄 XERO: Updating invoice in Xero...');
      const xeroInvoice = await this.xeroService.updateInvoice(organizationId, xeroInvoiceId, invoiceData);

      console.log('🎉 XERO: Invoice updated successfully! Xero Invoice ID:', xeroInvoice?.invoiceID || 'No ID returned');

      return xeroInvoice;
    } catch (error) {
      console.error('💥 XERO: Failed to update invoice - Error type:', error.constructor.name);
      console.error('💥 XERO: Error message:', error.message);
      console.error('💥 XERO: Full error:', error);
      throw error;
    }
  }

  async getPastDescriptions(organizationId: string) {
    try {
      // Distinct line descriptions for the editor's autocomplete, computed in
      // SQL over the org's most recent 1,000 documents. It used to load EVERY
      // document's config and walk the items in Node — 15.8s on Chong Aik's
      // 25.8k documents, for a suggestion list nobody could scroll anyway
      // (guru 2026-10-23). Capped at 2,000 suggestions.
      const rows: Array<{ description: string }> = await this.prisma.$queryRaw`
        SELECT DISTINCT btrim(item->>'description') AS description
        FROM (
          SELECT d.config
          FROM "Document" d
          WHERE d."organizationId" = ${organizationId}
            AND jsonb_typeof(d.config->'items') = 'array'
          ORDER BY d."createdAt" DESC
          LIMIT 1000
        ) recent,
        jsonb_array_elements(recent.config->'items') AS item
        WHERE jsonb_typeof(item->'description') = 'string'
          AND btrim(item->>'description') <> ''
        ORDER BY 1
        LIMIT 2000`;

      return {
        success: true,
        descriptions: rows.map((r) => r.description),
      };
    } catch (error) {
      console.error('Failed to fetch past descriptions:', error);
      throw new HttpException(
        `Failed to fetch past descriptions: ${error.message}`,
        HttpStatus.INTERNAL_SERVER_ERROR,
      );
    }
  }

  /**
   * Send invoice email to customer
   */
  async sendInvoiceEmail(
    documentId: string,
    emailDto: SendInvoiceEmailDto,
    organizationId: string,
    actor?: DocumentActor,
  ) {
    try {
      // 1. Get the document
      const document = await this.prisma.document.findFirst({
        where: {
          id: documentId,
          organizationId,
        },
        include: {
          organization: true,
        },
      });

      if (!document) {
        throw new HttpException('Document not found', HttpStatus.NOT_FOUND);
      }
      // A draft invoice voided with its cancelled order (orders/order-cancel.ts) is never sent.
      if (isVoidedWithOrder(document.config)) throw new HttpException(`${document.name ?? 'This invoice'} was voided with its cancelled order and can't be sent.`, HttpStatus.BAD_REQUEST);

      // 2. Validate it's an invoice or a quotation. Quotations reuse the same
      // Resend + PDF pipeline; only the guards differ (see below).
      const invoiceTypes = ['INVOICE', 'TI', 'TI2'];
      const quotationTypes = ['QUOTATION', 'QO', 'QO1', 'QO2', 'QT'];
      const isQuotation = quotationTypes.includes(document.type);
      if (!invoiceTypes.includes(document.type) && !isQuotation) {
        throw new HttpException(
          'Only invoices or quotations can be sent via email',
          HttpStatus.BAD_REQUEST,
        );
      }

      // 3. No status gate: invoices are sendable in EVERY status, drafts
      // included (guru 2026-08-18 — the old confirmed-only guard blocked
      // sending unconfirmed invoices).

      // 4. Extract invoice details from config
      const config: any = document.config;
      let customer = config?.customer;
      // Recurring/machine-generated invoices carry only customerId — resolve
      // the master record instead of rejecting (found 2026-08-06: every
      // recurring auto-send died here with "Invoice must have a customer").
      if (!customer && config?.customerId) {
        customer = await this.prisma.customer.findFirst({
          where: { id: config.customerId, organizationId },
          select: { id: true, name: true, email: true, address: true, phone: true },
        });
      }
      const documentInfo = config?.documentInfo;
      const items = config?.items || [];

      // Customer guard, type-aware. Invoices stay strict. Quotations may be
      // sent with just an Attention contact email — real quotes exist with
      // attention.email filled but no customer picked yet (prospect flow), and
      // the PDF generator + email body are null-safe for a missing customer.
      const attentionEmail: string | undefined = config?.attention?.email || undefined;
      if (isQuotation) {
        if (!customer && !attentionEmail) {
          throw new HttpException(
            'Quotation must have a customer or an Attention contact email',
            HttpStatus.BAD_REQUEST,
          );
        }
      } else if (!customer) {
        throw new HttpException(
          'Invoice must have a customer',
          HttpStatus.BAD_REQUEST,
        );
      }

      // Total shown in the email: the invoice's own GROSS total (incl. GST)
      // when present — the items sum is net, which made the info box (400)
      // disagree with the body text (436) (guru 2026-08-06).
      const summedAmount = items.reduce((sum: number, item: any) => {
        const amount =
          parseFloat(item.amount) ||
          parseFloat(item.quantity) * parseFloat(item.unitPrice) ||
          0;
        return sum + amount;
      }, 0);
      const totalAmount = Number(config?.nettTotal ?? config?.grossTotal) || summedAmount;

      // Get invoice number and due date
      const invoiceNumber = document.name || documentInfo?.documentNumber || `${isQuotation ? 'QO' : 'INV'}-${documentId.substring(0, 8)}`;
      // Invoices carry a due date (real, or +30d default). Quotations have none —
      // pass undefined so the email body + PDF omit the Due Date row entirely.
      const dueDate = isQuotation
        ? undefined
        : config?.dueDate
          ? moment(config.dueDate).format('DD MMM YYYY')
          : moment().add(30, 'days').format('DD MMM YYYY');

      // 5. Generate or get PDF URL
      const pdfUrl: string | undefined = await this.getOrGeneratePdfUrl(documentId, organizationId, {
        document,
        customer,
        documentInfo,
        items,
        config,
        isQuotation,
        dueDate,
      });

      // Public "Click to pay" page: mint the unguessable token once and reuse.
      const payToken = await this.ensurePayToken(documentId, organizationId);
      const paymentUrl = payToken ? `${process.env.PORTAL_BASE_URL || 'https://app.ai-ms.io'}/pay/${payToken}` : undefined;

      // 6. Send email via email service
      const emailResult = await this.emailService.sendInvoiceEmail({
        to: emailDto.to,
        cc: emailDto.cc,
        bcc: emailDto.bcc,
        subject: emailDto.subject,
        message: emailDto.message,
        paymentLink: paymentUrl,
        invoiceNumber,
        invoiceAmount: totalAmount,
        dueDate,
        isQuotation,
        // Null-safe: quotations can now send without a customer object; fall
        // back to the flat extraction field, then a generic salutation.
        customerName: customer?.name || config?.customerName || 'Customer',
        organizationName: document.organization.name,
        pdfUrl,
      });

      if (!emailResult.success) {
        throw new HttpException(
          emailResult.error || 'Failed to send email',
          HttpStatus.INTERNAL_SERVER_ERROR,
        );
      }

      {
        const recipients = [emailDto.to, emailDto.cc, emailDto.bcc]
          .flat()
          .filter(Boolean)
          .join(', ');
        void this.logDocumentEvent({
          documentId,
          organizationId,
          action: 'SENT',
          detail: `${invoiceNumber} emailed${recipients ? ` to ${recipients}` : ''}`,
          documentName: invoiceNumber,
          actor,
        });
      }

      // 7. Update document status to 'pending_payment' (email has been sent).
      // Invoices only — quotations have no such status, so their status is
      // left untouched after sending.
      if (!isQuotation) {
        await this.prisma.document.update({
          where: {
            id: documentId,
          },
          data: {
            status: DocumentStatus.pending_payment,
          },
        });
        // postInvoicesOnConfirm: emailing a draft takes it out of draft, so
        // this is where its GL entry is posted (no-op otherwise).
        await this.postInvoiceLeavingDraft(organizationId, documentId, actor);
      }

      return {
        success: true,
        message: `${isQuotation ? 'Quotation' : 'Invoice'} email sent successfully`,
        messageId: emailResult.messageId,
      };
    } catch (error) {
      console.error('Error sending invoice email:', error);
      // Durable trace (guru 2026-08-06): email failures were only visible in
      // the server console — recurring auto-sends swallowed them entirely.
      // Now every failure lands in the document history.
      void this.logDocumentEvent({
        documentId,
        organizationId,
        action: 'EMAIL_FAILED',
        detail: `Email failed: ${error?.message || error}`,
        actor,
      });
      throw new HttpException(
        error.message || 'Failed to send invoice email',
        error.status || HttpStatus.INTERNAL_SERVER_ERROR,
      );
    }
  }

  // ─────────────────────────────────────────────────────────────────────────
  // Per-item Delivery Order flow (Phases 3 + 4)
  // ─────────────────────────────────────────────────────────────────────────

  /**
   * Deduct stock for ONE DocumentItem — IDEMPOTENTLY. The `deductedAt` column is
   * the idempotency guard: a conditional updateMany ({ deductedAt: null })
   * atomically CLAIMS the deduction in the same transaction as the stock
   * decrement, so an item can never double-deduct whether it arrives via a
   * per-item DO_ACK scan OR the office bulk-complete button. Returns true only
   * when this call actually performed the deduction.
   *
   * Handles BOTH item types (must not regress asset deduction): INVENTORY
   * decrements Inventory.quantity (via inventoryId), ASSET decrements
   * Asset.quantity (via assetId). Falls back to itemId when the typed FK is null
   * (rows created before Phase 2 backfilled the FKs).
   */
  private async deductDocumentItemStock(
    item: {
      id: string;
      itemId: string;
      itemType: ItemType;
      inventoryId: string | null;
      assetId: string | null;
      quantity: number | null;
    },
    documentId: string,
    documentName: string | null,
    organizationId: string,
  ): Promise<boolean> {
    const quantity = item.quantity || 0;
    const inventoryId =
      item.itemType === ItemType.INVENTORY ? item.inventoryId ?? item.itemId : null;
    const assetId =
      item.itemType === ItemType.ASSET ? item.assetId ?? item.itemId : null;

    return this.prisma.$transaction(async (tx) => {
      // Atomically claim the deduction. deductedAt:null guard ⇒ exactly-once.
      const claim = await tx.documentItem.updateMany({
        where: { id: item.id, deductedAt: null },
        data: { deductedAt: new Date() },
      });
      if (claim.count === 0) return false; // already deducted — idempotent no-op

      // Flip the delivered unit's status, mirroring the legacy DO submit path
      // (documents.service DO → rental) + the deployment rental-vs-sale rule
      // (projects.service:584 — SALE → sold, else rental). Idempotent: only from
      // instock, so re-runs / already-moved units are no-ops. Rides the SAME
      // deductedAt claim as the deduction ⇒ exactly-once per item, and runs
      // regardless of line quantity (a delivered unit is rental/sold either way).
      // Serialized (inventory) units only — asset-level quantity rows have no
      // per-unit status to flip.
      if (inventoryId) {
        const dep = await tx.document.findUnique({
          where: { id: documentId },
          select: { projectDeployment: { select: { type: true } } },
        });
        const deliveredStatus =
          dep?.projectDeployment?.type === DeploymentType.SALE
            ? InventoryStatus.sold
            : InventoryStatus.rental;
        await tx.inventory.updateMany({
          // 'reserved' included so a unit soft-held by a standalone Delivery
          // flips correctly when its DO deducts at link time. DO-first is
          // unaffected — instock still matches exactly as before.
          where: { id: inventoryId, status: { in: [InventoryStatus.instock, InventoryStatus.reserved] } },
          data: { status: deliveredStatus },
        });
      }

      if (quantity <= 0) return true; // claimed; nothing to decrement

      if (inventoryId) {
        const inv = await tx.inventory.findUnique({
          where: { id: inventoryId },
          select: { quantity: true },
        });
        if (inv) {
          const newQty = Math.max(0, (inv.quantity || 0) - quantity);
          await tx.inventory.update({ where: { id: inventoryId }, data: { quantity: newQty } });
          await tx.timelineItem.create({
            data: {
              message: `Stock deducted: ${quantity} units for Delivery Order ${documentName || documentId.substring(0, 8)}`,
              inventoryId,
              documentId,
              pdfUrl: null,
            },
          });
        }
      } else if (assetId) {
        const asset = await tx.asset.findUnique({
          where: { id: assetId },
          select: { quantity: true },
        });
        if (asset) {
          const newQty = Math.max(0, (asset.quantity || 0) - quantity);
          await tx.asset.update({ where: { id: assetId }, data: { quantity: newQty } });
        }
      }
      return true;
    });
  }

  /**
   * Advance ONE scanned item through the per-item delivery lifecycle. Resolves
   * the target DocumentItem on the DO from the scanned unit (inventoryId FK,
   * else itemId for un-backfilled/asset-level rows). Duplicate-SKU tiebreak:
   * among rows whose CURRENT status is the action's predecessor, pick the
   * lowest lineNumber — i.e. the LEAST-advanced eligible copy — so repeated
   * scans of the same SKU advance the copies one at a time.
   *
   *   start   not_delivered → delivering    (deliveringAt)
   *   ack     delivering    → not_installed  (deliveredAt) + DEDUCT STOCK (3c)
   *   install not_installed → completed      (completedAt) + completion gate
   *   skip    not_installed → completed      (completedAt, installSkipped) + gate
   */
  async advanceDeliveryItem(
    documentId: string,
    inventoryId: string,
    action: 'start' | 'ack' | 'install' | 'skip',
    organizationId: string,
  ) {
    const document = await this.prisma.document.findFirst({
      where: { id: documentId, organizationId },
      select: { id: true, name: true },
    });
    if (!document) {
      throw new HttpException('Delivery Order not found', HttpStatus.NOT_FOUND);
    }

    const predecessor: Record<typeof action, DeliveryStatus> = {
      start: DeliveryStatus.not_delivered,
      ack: DeliveryStatus.delivering,
      install: DeliveryStatus.not_installed,
      skip: DeliveryStatus.not_installed,
    };

    // Resolve the scanned unit's parent asset so we also match SKU-level DOs
    // (DocumentItem rows can reference the specific Inventory unit OR the parent
    // Asset — see getScanContext's itemFilter). Match: inventoryId FK, OR itemId
    // == unit (un-backfilled INVENTORY rows), OR an ASSET row for the parent.
    const unit = await this.prisma.inventory.findUnique({
      where: { id: inventoryId },
      select: { assetId: true, sku: true },
    });
    const itemMatch: any[] = [{ inventoryId }, { itemId: inventoryId }];
    if (unit?.assetId) itemMatch.push({ itemId: unit.assetId, itemType: ItemType.ASSET });

    const rows = await this.prisma.documentItem.findMany({
      where: { documentId, OR: itemMatch },
    });
    const eligible = rows
      .filter((r) => r.deliveryStatus === predecessor[action])
      .sort((a, b) => (a.lineNumber ?? 0) - (b.lineNumber ?? 0));
    // Prefer the scanned unit's OWN row when it's eligible — an already-bound
    // unit must advance its own slot, never a sibling's anonymous copy.
    let target =
      eligible.find(
        (r) =>
          r.inventoryId === inventoryId ||
          (r.itemId === inventoryId && r.itemType === ItemType.INVENTORY),
      ) ?? eligible[0];

    if (!target) {
      // Nothing eligible — already advanced past this step, or the scanned unit
      // isn't on this DO. No-op (keeps repeated scans safe).
      console.warn(
        `advanceDeliveryItem: no eligible row for doc ${documentId}, unit ${inventoryId}, action ${action}`,
      );
      return null;
    }

    // Multi-slot asset-level fix: a specific unit STARTING against an
    // anonymous asset-level slot CLAIMS that slot first (same shared helper as
    // tag-time auto-bind and delivery-link — dual write, first-unbound-first,
    // race-safe claim, already-bound pre-guard). The advance below then runs
    // on the bound row, so each physical unit owns its own slot and the
    // per-unit stage/deduction machinery works. Unit-level rows never enter
    // this branch (condition requires an ASSET-typed unbound target), and
    // asset-only scans (no scanned unit) keep today's anonymous advance.
    if (action === 'start' && target.itemType === ItemType.ASSET && !target.inventoryId && inventoryId) {
      const boundId = await this.bindUnitToUnboundDoSlot(documentId, organizationId, {
        id: inventoryId,
        assetId: unit?.assetId ?? target.itemId,
        sku: unit?.sku ?? null,
      });
      if (boundId) {
        const claimed = await this.prisma.documentItem.findUnique({ where: { id: boundId } });
        if (claimed) target = claimed;
      } else {
        // No slot claimable (unit already bound elsewhere, config mismatch, or
        // race lost with no slots left). Do NOT advance an anonymous slot on a
        // specific unit's behalf — no-op, same posture as !target.
        console.warn(
          `advanceDeliveryItem: start for unit ${inventoryId} on doc ${documentId} could not claim a slot — no-op`,
        );
        return null;
      }
    }

    const now = new Date();
    if (action === 'start') {
      await this.prisma.documentItem.update({
        where: { id: target.id },
        data: { deliveryStatus: DeliveryStatus.delivering, deliveringAt: now },
      });
    } else if (action === 'ack') {
      await this.prisma.documentItem.update({
        where: { id: target.id },
        data: { deliveryStatus: DeliveryStatus.not_installed, deliveredAt: now },
      });
      // Per-item deduction happens HERE (idempotent), not in a whole-DO loop.
      await this.deductDocumentItemStock(target, documentId, document.name, organizationId);
    } else if (action === 'install') {
      await this.prisma.documentItem.update({
        where: { id: target.id },
        data: { deliveryStatus: DeliveryStatus.completed, completedAt: now },
      });
      await this.maybeCompleteDeliveryOrderAndInvoice(documentId, organizationId);
    } else if (action === 'skip') {
      await this.prisma.documentItem.update({
        where: { id: target.id },
        data: { deliveryStatus: DeliveryStatus.completed, installSkipped: true, completedAt: now },
      });
      await this.maybeCompleteDeliveryOrderAndInvoice(documentId, organizationId);
    }

    return this.prisma.documentItem.findUnique({ where: { id: target.id } });
  }

  /**
   * U1+items DUAL-ADVANCE BRIDGE. A DO-first delivery event advances the
   * DocumentItem ledger FIRST (advanceDeliveryItem — deduction, completion
   * gate, DO status: commerce, unchanged and authoritative), then mirrors the
   * physical state onto the unit's born-linked DeliveryItem so the run fold
   * stays correct. The mirror is independently try/caught — a mirror failure
   * NEVER touches commerce; catch-up semantics make the next event converge.
   * Call sites (all four, per spec): applyDeliveryItemTransition,
   * skipDeliveryInstall, bulkCompleteDeliveryOrder, guest advance.
   */
  async dualAdvance(
    documentId: string,
    inventoryId: string,
    action: 'start' | 'ack' | 'install' | 'skip',
    organizationId: string,
  ) {
    const result = await this.advanceDeliveryItem(documentId, inventoryId, action, organizationId);
    try {
      await this.mirrorRunItemAdvance(documentId, inventoryId, action);
    } catch (err: any) {
      console.warn(`dualAdvance: run mirror failed for unit ${inventoryId} on doc ${documentId}: ${err?.message}`);
    }
    return result;
  }

  /**
   * Mirror a DO-side advance onto the matching open-run DeliveryItem with
   * CATCH-UP semantics: deliveryStatus = max(current, action target) by rank,
   * null timestamps back-filled — so a previously missed mirror self-heals at
   * the next event. Matches items linked to THIS DO on an open run (covers
   * born-linked U1 items AND office-linked standalone items, healing the
   * post-link advance gap). No matching item → silent no-op, which also makes
   * the mirror safe when enableUnifiedRuns is off. Ends with the same
   * monotonic run-status fold as deliveries.recomputeRunStatus (duplicated
   * here prisma-only to avoid a documents→deliveries circular dependency).
   */
  private async mirrorRunItemAdvance(
    documentId: string,
    inventoryId: string,
    action: 'start' | 'ack' | 'install' | 'skip',
  ): Promise<void> {
    const RANK: Record<DeliveryStatus, number> = {
      [DeliveryStatus.not_delivered]: 0,
      [DeliveryStatus.delivering]: 1,
      [DeliveryStatus.not_installed]: 2,
      [DeliveryStatus.completed]: 3,
    };
    const TARGET: Record<typeof action, DeliveryStatus> = {
      start: DeliveryStatus.delivering,
      ack: DeliveryStatus.not_installed,
      install: DeliveryStatus.completed,
      skip: DeliveryStatus.completed,
    };
    const target = TARGET[action];
    const item = await this.prisma.deliveryItem.findFirst({
      where: {
        documentId,
        inventoryId,
        delivery: { status: { in: ['in_progress', 'delivered'] } },
      },
      select: { id: true, deliveryId: true, deliveryStatus: true, deliveringAt: true, deliveredAt: true, completedAt: true, installSkipped: true },
    });
    if (!item) return;
    if (RANK[item.deliveryStatus] < RANK[target]) {
      const now = new Date();
      await this.prisma.deliveryItem.update({
        where: { id: item.id },
        data: {
          deliveryStatus: target,
          // Catch-up: back-fill every timestamp the target rank implies.
          ...(RANK[target] >= 1 && !item.deliveringAt ? { deliveringAt: now } : {}),
          ...(RANK[target] >= 2 && !item.deliveredAt ? { deliveredAt: now } : {}),
          ...(RANK[target] >= 3 && !item.completedAt ? { completedAt: now } : {}),
          ...(action === 'skip' ? { installSkipped: true } : {}),
        },
      });
    }
    // Fold (monotonic, mirrors deliveries.recomputeRunStatus).
    const run = await this.prisma.delivery.findUnique({
      where: { id: item.deliveryId },
      select: { id: true, status: true, completedAt: true, items: { select: { deliveryStatus: true } } },
    });
    if (!run || run.status === 'cancelled' || run.items.length === 0) return;
    const ranks = run.items.map((i) => RANK[i.deliveryStatus]);
    const fold =
      ranks.every((r) => r >= 3) ? ('completed' as const)
      : ranks.every((r) => r >= 2) ? ('delivered' as const)
      : ('in_progress' as const);
    if (fold !== run.status) {
      await this.prisma.delivery.update({
        where: { id: run.id },
        data: { status: fold, ...(fold === 'completed' && !run.completedAt ? { completedAt: new Date() } : {}) },
      });
    }
  }

  /**
   * Link-time deduction for a standalone Delivery being attached to this DO
   * (deliveries.service.link). Runs the DO's OWN exactly-once deduction
   * (deductedAt claim) for each already-delivered unit — the same private
   * routine the DO-first ack path uses; re-calls are idempotent no-ops.
   * Deliberately does NOT touch the completion gate / auto-invoice.
   */
  async deductLinkedDeliveryUnits(
    documentId: string,
    organizationId: string,
    inventoryIds: string[],
  ): Promise<number> {
    if (!inventoryIds.length) return 0;
    const document = await this.prisma.document.findFirst({
      where: { id: documentId, organizationId },
      select: { id: true, name: true },
    });
    if (!document) {
      throw new HttpException('Delivery Order not found', HttpStatus.NOT_FOUND);
    }
    let deducted = 0;
    for (const inventoryId of inventoryIds) {
      const row = await this.prisma.documentItem.findFirst({
        where: {
          documentId,
          deductedAt: null,
          OR: [{ inventoryId }, { itemId: inventoryId, itemType: ItemType.INVENTORY }],
        },
      });
      if (!row) continue; // not on this DO, or already deducted — no-op
      const ok = await this.deductDocumentItemStock(row, documentId, document.name, organizationId);
      if (ok) deducted++;
    }
    return deducted;
  }

  /**
   * Commit the commerce side of per-item delivery links for ONE DO: bind
   * delivered units into unbound asset-level slots, stamp the run items'
   * delivery states onto the DO's rows (advance-only), run the DO's OWN
   * exactly-once stock deduction for already-delivered units, and mirror
   * Document.status from the post-stamp fold. Every sub-op is idempotent
   * (race-safe slot claim, advance-only stamp, deductedAt claim, no-downgrade
   * mirror), so re-firing is safe.
   *
   * Called from deliveries.link for a confirmed-or-beyond DO (immediate
   * commitment, `itemIds` = the linked selection) and from updateDocument's
   * confirm hook for a DO that was linked while draft/unconfirmed (deferred
   * commitment, no `itemIds` = every DeliveryItem pointing at this DO).
   */
  async commitLinkedDeliveryItems(
    documentId: string,
    organizationId: string,
    itemIds?: string[],
    opts: { partial?: boolean } = {},
  ): Promise<number> {
    const document = await this.prisma.document.findFirst({
      where: { id: documentId, organizationId },
      select: { id: true, name: true, status: true },
    });
    if (!document) {
      throw new HttpException('Delivery Order not found', HttpStatus.NOT_FOUND);
    }
    const items = await this.prisma.deliveryItem.findMany({
      where: { documentId, ...(itemIds?.length ? { id: { in: itemIds } } : {}) },
    });
    if (!items.length) return 0;

    const RANK: Record<DeliveryStatus, number> = {
      [DeliveryStatus.not_delivered]: 0,
      [DeliveryStatus.delivering]: 1,
      [DeliveryStatus.not_installed]: 2,
      [DeliveryStatus.completed]: 3,
    };

    // Bind each unit into an unbound asset-level slot FIRST (shared auto-bind
    // helper). Without this, asset-level rows would get status stamped below
    // but be invisible to the unit-keyed deduction matcher. Units already
    // bound (incl. create-DO's born-bound rows) skip via the pre-guard.
    const invIds = items.map((i) => i.inventoryId).filter((v): v is string => !!v);
    const units = invIds.length
      ? await this.prisma.inventory.findMany({ where: { id: { in: invIds } }, select: { id: true, sku: true } })
      : [];
    const skuById = new Map(units.map((u) => [u.id, u.sku]));
    for (const item of items) {
      if (!item.inventoryId) continue;
      await this.bindUnitToUnboundDoSlot(documentId, organizationId, {
        id: item.inventoryId,
        assetId: item.assetId,
        sku: skuById.get(item.inventoryId) ?? null,
      }).catch((err) =>
        console.warn(`commitLinkedDeliveryItems: auto-bind failed for unit ${item.inventoryId}: ${err?.message}`),
      );
    }

    // Stamp item states across. Only ever advances a DO row; a more-advanced
    // DO row is left alone.
    //
    // A unit that has its OWN line (bound above, or born bound) stamps ONLY
    // that line. An asset-level line of the same product is a fallback for a
    // unit with no line at all, and never during a partial sign-off: there the
    // empty lines belong to units still to come, and completing one here left
    // the next unit nothing to bind into (DO202609072, 2026-09-27: trip 1
    // completed trip 2's empty slot, so ZZTEST-02 never reached the DO).
    for (const item of items) {
      if (!item.inventoryId) continue;
      const itemMatch: any[] = [
        { inventoryId: item.inventoryId },
        { itemId: item.inventoryId },
        { itemId: item.assetId, itemType: ItemType.ASSET },
      ];
      const matched = await this.prisma.documentItem.findMany({ where: { documentId, OR: itemMatch } });
      const own = matched.filter((r) => r.inventoryId === item.inventoryId || r.itemId === item.inventoryId);
      const rows = own.length ? own : opts.partial ? [] : matched;
      const docRow = rows
        .filter((r) => RANK[r.deliveryStatus] < RANK[item.deliveryStatus])
        .sort((a, b) => RANK[a.deliveryStatus] - RANK[b.deliveryStatus])[0];
      if (!docRow) continue;
      await this.prisma.documentItem.update({
        where: { id: docRow.id },
        data: {
          deliveryStatus: item.deliveryStatus,
          deliveringAt: item.deliveringAt ?? docRow.deliveringAt,
          deliveredAt: item.deliveredAt ?? docRow.deliveredAt,
          completedAt: item.completedAt ?? docRow.completedAt,
          installSkipped: item.installSkipped || docRow.installSkipped,
        },
      });
    }

    // The DO's own deduction for already-delivered units (ack'd or beyond).
    // Exactly-once via the DocumentItem deductedAt claim; a unit soft-held as
    // reserved flips to rental/sold through the widened predicate.
    const deliveredUnitIds = items
      .filter((i) => i.inventoryId && RANK[i.deliveryStatus] >= RANK[DeliveryStatus.not_installed])
      .map((i) => i.inventoryId as string);
    const deducted = await this.deductLinkedDeliveryUnits(documentId, organizationId, deliveredUnitIds);

    // Mirror Document.status from the (post-stamp) item fold. No downgrade:
    // delivered_installed is terminal. Completion gate NOT fired (by design).
    if (document.status !== 'delivered_installed') {
      const docItems = await this.prisma.documentItem.findMany({
        where: { documentId },
        select: { deliveryStatus: true, isService: true },
      });
      const deliverable = docItems.filter((i) => !i.isService);
      if (deliverable.length > 0) {
        if (deliverable.every((i) => i.deliveryStatus === DeliveryStatus.completed)) {
          await this.prisma.document.update({ where: { id: documentId }, data: { status: 'delivered_installed' } });
        } else if (deliverable.some((i) => RANK[i.deliveryStatus] >= RANK[DeliveryStatus.not_installed])) {
          await this.prisma.document.update({ where: { id: documentId }, data: { status: 'delivered_not_installed' } });
        }
      }
    }
    return deducted;
  }

  // Eligible = created but NOT completed / in the return cycle. Shared by the
  // auto-bind slot search and its already-bound pre-guard.
  private static readonly BIND_ELIGIBLE_DO_STATUSES: any = {
    notIn: ['delivered_installed', 'pending_return', 'returned'],
  };

  /**
   * Append ONE free-typed (description-only) line to a document — mirrors how a
   * scheduled DO carries free-typed lines. Pushes a `{description, quantity}` row
   * into config.items (no assetId / no unit) and re-syncs DocumentItems so the two
   * layers stay consistent. Used when a rider adds a free-typed item in the field
   * basket on a DO-linked run (there's no asset slot to bind, so the DO would
   * otherwise never gain the line). No pricing, no stock, no GL.
   */
  async appendFreeTypedLineToDocument(
    documentId: string,
    organizationId: string,
    line: { description: string; quantity: number },
  ): Promise<void> {
    const doc = await this.prisma.document.findFirst({
      where: { id: documentId, organizationId },
      select: { config: true },
    });
    if (!doc) return;
    const config: any = doc.config ?? {};
    const items: any[] = Array.isArray(config.items) ? config.items : [];
    items.push({ description: line.description, quantity: line.quantity, unitPrice: 0, amount: 0 });
    const newConfig = { ...config, items };
    await this.prisma.document.update({
      where: { id: documentId },
      data: { config: newConfig as Prisma.InputJsonValue },
    });
    await this.syncDocumentItems(documentId, newConfig, organizationId);
  }

  /**
   * Append ONE UNIT-KEYED line to a document — the asset-backed twin of
   * appendFreeTypedLineToDocument above.
   *
   * WHY THIS EXISTS. A run's DO is born from what the OFFICE scheduled. A rider
   * can legitimately put a unit on that run that the office never declared —
   * they scan an asset with no open slot (addItem), or they pick a run by
   * address whose declared asset is a different one (mergeIntoChosenScheduledRun).
   * Both paths linked the DeliveryItem to the run's DO and then stopped: nothing
   * wrote the LINE, so the unit was delivered, signed for and invoiced off a DO
   * that did not mention it. bindUnitToUnboundDoSlot cannot help — it binds a
   * serial INTO an existing line and no-ops when none matches. This is the only
   * other runtime writer of config.items, and it is deliberately narrow.
   *
   * The line matches what createDoFromDelivery / createDoOnAdHocCompletion emit
   * for a bound unit, field for field:
   *   description, quantity, unitPrice 0, amount 0   — a DO is a GOODS document;
   *     the price is the INVOICE's job (priceInvoiceLinesFromAsset). A non-zero
   *     unitPrice here would be carried into the invoice and override the
   *     Sales-Order → Quotation → asset ladder.
   *   inventoryItemId  — the unit; what syncDocumentItems keys the DocumentItem on
   *   serialNumbers    — [Inventory.sku]; this fleet stores the nameplate
   *     identifier in `sku`, so that is the S/No. the office reads on the DO
   *   skuKey + itemCode — Model row + Product Code column
   *   deliveryGroup    — per-asset display grouping key
   *   deliveryItemId   — lets getById attach this line's DO_START proof photos
   *
   * IDEMPOTENT. A line already carrying this inventoryItemId (or this
   * deliveryItemId) means the unit is on the document; the call returns without
   * writing. Retries, replayed clients and a rider re-scanning cannot duplicate
   * a line.
   *
   * Tax: NOT invented. Delivery-built DOs carry no per-line tax at all, while an
   * editor-built DO carries it on every line. So the value is inherited only
   * when every existing goods line already agrees on one, and omitted otherwise
   * — the appended line is then taxed exactly like its siblings on the same
   * document, whichever kind of DO it landed on.
   */
  async appendUnitLineToDocument(
    documentId: string,
    organizationId: string,
    line: {
      inventoryItemId: string;
      deliveryItemId?: string | null;
      assetId?: string | null;
      sku?: string | null;
      skuKey?: string | null;
      description: string;
      quantity?: number;
    },
  ): Promise<boolean> {
    // Org-scoped: a documentId from another tenant must not resolve.
    const doc = await this.prisma.document.findFirst({
      where: { id: documentId, organizationId },
      select: { config: true },
    });
    if (!doc) return false;
    const config: any = doc.config ?? {};
    const items: any[] = Array.isArray(config.items) ? config.items : [];

    // Already present → no-op. Checked on BOTH keys: inventoryItemId is the
    // real identity, deliveryItemId catches a line written for the same run row
    // before the unit was bound.
    const already = items.some(
      (it) =>
        (it?.inventoryItemId && it.inventoryItemId === line.inventoryItemId) ||
        (line.deliveryItemId && it?.deliveryItemId && it.deliveryItemId === line.deliveryItemId),
    );
    if (already) return false;

    // Inherit tax only on unanimous agreement among existing goods lines.
    const goods = items.filter((it) => it?.inventoryItemId || it?.assetId);
    const taxes = [...new Set(goods.map((it) => it?.tax).filter((t) => t !== undefined && t !== null))];
    const inheritedTax = goods.length > 0 && taxes.length === 1 ? taxes[0] : undefined;

    items.push({
      description: line.description,
      quantity: line.quantity ?? 1,
      unitPrice: 0,
      amount: 0,
      inventoryItemId: line.inventoryItemId,
      ...(line.deliveryItemId ? { deliveryItemId: line.deliveryItemId } : {}),
      ...(line.sku ? { serialNumbers: [line.sku] } : {}),
      ...(line.skuKey ? { skuKey: line.skuKey, itemCode: line.skuKey } : {}),
      ...(line.assetId ? { deliveryGroup: line.assetId } : {}),
      ...(inheritedTax !== undefined ? { tax: inheritedTax } : {}),
    });

    const newConfig = { ...config, items };
    await this.prisma.document.update({
      where: { id: documentId },
      data: { config: newConfig as Prisma.InputJsonValue },
    });
    // syncDocumentItems matches desired<->existing by itemId and preserves every
    // delivery column on the rows it keeps, so appending to a part-delivered DO
    // neither resets nor re-deducts the units already handed over.
    await this.syncDocumentItems(documentId, newConfig, organizationId);
    return true;
  }

  /**
   * Regenerate a scheduled draft DO from a config fragment: merge the fragment
   * over the existing config (so logo/stamp/template layout survive), optionally
   * re-point projectId, then re-sync DocumentItems. Used when the office edits a
   * still-scheduled delivery run (nothing bound yet, placeholder DO number kept).
   */
  async replaceScheduledDoConfig(
    documentId: string,
    organizationId: string,
    fragment: Record<string, any>,
    projectId?: string,
  ): Promise<void> {
    const doc = await this.prisma.document.findFirst({
      where: { id: documentId, organizationId },
      select: { config: true },
    });
    if (!doc) return;
    const merged = { ...((doc.config as any) ?? {}), ...fragment };
    await this.prisma.document.update({
      where: { id: documentId },
      data: {
        config: merged as Prisma.InputJsonValue,
        ...(projectId !== undefined ? { projectId } : {}),
      },
    });
    await this.syncDocumentItems(documentId, merged, organizationId);
  }

  /**
   * Auto-bind (tag-time): fill ONE unbound asset-level slot on the given DO
   * with a specific physical unit. A "slot" is a DocumentItem the office left
   * at asset level: itemType=ASSET, inventoryId NULL, same asset, still
   * not_delivered and never deducted — office-bound unit rows can never match,
   * so the DO-first unit-level path is untouched by construction.
   *
   * DUAL WRITE (mandatory): the DocumentItem row AND the matching config.items
   * line are converted together in one transaction. syncDocumentItems pairs
   * rows by itemId derived from config.items[].inventoryItemId — a row-only
   * bind would be retired and recreated unbound on the next office edit.
   * After the write the row is byte-identical to an office-picked unit row
   * ({itemId: unit, itemType: INVENTORY, inventoryId: unit, assetId: null}),
   * so scan-context, advanceDeliveryItem, deduction and the preview all work
   * with no downstream change.
   *
   * Concurrency: the row update is a claim (updateMany gated inventoryId:null)
   * — count 0 means another tag filled the slot first; we move to the next
   * slot. Returns the bound DocumentItem id, or null (no slot / already bound
   * elsewhere / config line unresolvable).
   */
  async bindUnitToUnboundDoSlot(
    documentId: string,
    organizationId: string,
    unit: { id: string; assetId: string; sku: string | null },
  ): Promise<string | null> {
    // Pre-guard: a unit already bound on ANY active DO is never re-bound —
    // one physical unit can only be "the delivered unit" of one open DO.
    const alreadyBound = await this.prisma.documentItem.findFirst({
      where: {
        OR: [{ inventoryId: unit.id }, { itemId: unit.id, itemType: ItemType.INVENTORY }],
        document: {
          organizationId,
          type: { in: ['DELIVERY_ORDER', 'DO'] },
          status: DocumentsService.BIND_ELIGIBLE_DO_STATUSES,
        },
      },
      select: { id: true, documentId: true },
    });
    if (alreadyBound) {
      console.log(
        `auto-bind: unit ${unit.sku ?? unit.id} already bound on document ${alreadyBound.documentId} — skipping`,
      );
      return null;
    }

    const slots = await this.prisma.documentItem.findMany({
      where: {
        documentId,
        itemType: ItemType.ASSET,
        inventoryId: null,
        isService: false,
        deliveryStatus: DeliveryStatus.not_delivered,
        deductedAt: null,
        OR: [{ assetId: unit.assetId }, { itemId: unit.assetId }],
      },
      orderBy: { lineNumber: 'asc' }, // first-unbound-first
    });

    for (const slot of slots) {
      try {
        const boundId = await this.prisma.$transaction(async (tx) => {
          // Claim the slot — exactly-once even under concurrent tagging.
          const claim = await tx.documentItem.updateMany({
            where: { id: slot.id, inventoryId: null },
            data: {
              itemId: unit.id,
              itemType: ItemType.INVENTORY,
              inventoryId: unit.id,
              assetId: null,
            },
          });
          if (claim.count === 0) return null; // lost the race — next slot

          // Mirror into config.items (the renderer / sync source of truth).
          // Match by the slot's lineNumber position, validated against the
          // asset; fall back to the first still-unbound line for this asset.
          const doc = await tx.document.findUnique({
            where: { id: documentId },
            select: { config: true },
          });
          const config: any = doc?.config ?? {};
          const items: any[] = Array.isArray(config.items) ? config.items : [];
          let idx = (slot.lineNumber ?? 0) - 1;
          const lineMatches = (it: any) =>
            it && !it.inventoryItemId && (it.assetId === unit.assetId || it.itemId === unit.assetId);
          if (!(idx >= 0 && idx < items.length && lineMatches(items[idx]))) {
            idx = items.findIndex(lineMatches);
          }
          if (idx < 0) {
            // Config line unresolvable — abort so the two layers never diverge
            // (a row-only bind would be wiped by the next syncDocumentItems).
            throw new Error('config line for slot not found');
          }
          items[idx] = {
            ...items[idx],
            inventoryItemId: unit.id,
            ...(unit.sku ? { serialNumbers: [unit.sku] } : {}),
          };
          await tx.document.update({
            where: { id: documentId },
            data: { config: { ...config, items } as Prisma.InputJsonValue },
          });
          return slot.id;
        });
        if (boundId) {
          console.log(`auto-bind: unit ${unit.sku ?? unit.id} bound into DO ${documentId} slot ${boundId}`);
          return boundId;
        }
      } catch (err: any) {
        // Rolled back (claim + config stay consistent). Log and try next slot.
        console.warn(`auto-bind: slot ${slot.id} failed (${err?.message}) — trying next`);
      }
    }
    return null;
  }

  /**
   * Tag-time entry point: find the project's NEWEST eligible DO that still has
   * an unbound slot for this unit's asset, and bind into it. No slot anywhere
   * → returns null and the assign proceeds untouched (locked rule).
   */
  async bindTaggedUnitToProjectDo(
    projectId: string,
    organizationId: string,
    unit: { id: string; assetId: string; sku: string | null },
  ): Promise<string | null> {
    const candidates = await this.prisma.document.findMany({
      where: {
        organizationId,
        projectId,
        type: { in: ['DELIVERY_ORDER', 'DO'] },
        status: DocumentsService.BIND_ELIGIBLE_DO_STATUSES,
        documentItems: {
          some: {
            itemType: ItemType.ASSET,
            inventoryId: null,
            isService: false,
            deliveryStatus: DeliveryStatus.not_delivered,
            deductedAt: null,
            OR: [{ assetId: unit.assetId }, { itemId: unit.assetId }],
          },
        },
      },
      orderBy: { createdAt: 'desc' }, // NEWEST candidate DO first (locked)
      select: { id: true },
    });
    for (const doc of candidates) {
      const bound = await this.bindUnitToUnboundDoSlot(doc.id, organizationId, unit);
      if (bound) return bound;
    }
    return null;
  }

  /**
   * Completion gate (Phase 4a), DEADLOCK-SAFE. After any item reaches
   * completed, check whether ALL DELIVERABLE items are completed. Service items
   * (isService=true) are EXCLUDED from the gate (treated as auto-complete). A DO
   * with no deliverable items (all-service) completes immediately. On
   * satisfaction the DO is marked terminal and an invoice is fired (idempotent).
   *
   * NOTE: DocumentStatus has no `completed` value; `delivered_installed` is the
   * terminal DO status (already written by the DO_INSTALL sign() path), so that
   * is what "DO complete" maps to here.
   *
   * ONE-WAY: completion → invoice is never auto-unwound (reversal = manual
   * credit note).
   */
  // Public so the standalone-completion wrapper (deliveries.autoCreateDoOnRun-
  // Completion) can fire the gate for its freshly-committed auto-DO. Returns the
  // created/existing invoice (or null when not all deliverable items are done);
  // the DO-first callers (advanceDeliveryItem, bulkComplete) ignore the return.
  async maybeCompleteDeliveryOrderAndInvoice(
    documentId: string,
    organizationId: string,
  ) {
    // An imported (old-ERP) DO never completes here and never makes an invoice.
    const guard = await this.prisma.document.findFirst({ where: { id: documentId, organizationId }, select: { type: true, config: true } });
    if (isErpImportedDo(guard)) return null;
    const items = await this.prisma.documentItem.findMany({
      where: { documentId },
      select: { isService: true, deliveryStatus: true },
    });
    const deliverable = items.filter((i) => !i.isService);
    const allDone =
      deliverable.length === 0 ||
      deliverable.every((i) => i.deliveryStatus === DeliveryStatus.completed);
    if (!allDone) return null;

    // OSI-83: a scheduled DO reaches its terminal state HERE (placeholder →
    // delivered_installed) without ever passing through the manual 'confirmed'
    // path — so claim its real number NOW, BEFORE the invoice below snapshots
    // the source DO number (else the invoice would capture "DO-PENDING-NN").
    // Idempotent: the prefix guard means a DO already numbered is untouched.
    const doc = await this.prisma.document.findUnique({
      where: { id: documentId },
      select: { name: true, type: true, documentTemplateId: true, config: true },
    });
    const realName =
      doc && typeof doc.name === 'string' && doc.name.startsWith('DO-PENDING-')
        ? await this.generateSequentialDocumentName(organizationId, doc.type, doc.documentTemplateId, doc.config, new Date())
        : undefined;

    // THE NUMBER LIVES IN MORE THAN ONE PLACE. Renaming only Document.name left
    // config.documentNumber on the placeholder, and the editor reads
    //   documentInfo.documentNumber || config.documentNumber || name
    // so the list showed the claimed number while the DO page still showed
    // "DO-PENDING-NN" — the same document disagreeing with itself.
    // (DO202609-0062 and -0063 both shipped in that state.)
    //
    // Only DOs built by the schedule dialog carry config.documentNumber at all,
    // which is why this stayed invisible on the 354 DOs that have no such key.
    // jsonb_set is NOT used: writing the whole config back would race a
    // concurrent editor save, so the two nested keys are patched in place and
    // only when they already exist — a DO without them keeps its shape.
    const cfg = (doc?.config ?? null) as Record<string, any> | null;
    const renamedConfig = realName && cfg
      ? {
          ...cfg,
          ...(cfg.documentNumber !== undefined ? { documentNumber: realName } : {}),
          ...(cfg.documentInfo && typeof cfg.documentInfo === 'object'
            && (cfg.documentInfo as any).documentNumber !== undefined
            ? { documentInfo: { ...(cfg.documentInfo as any), documentNumber: realName } }
            : {}),
        }
      : undefined;

    await this.prisma.document.update({
      where: { id: documentId },
      data: {
        status: DocumentStatus.delivered_installed,
        ...(realName ? { name: realName } : {}),
        ...(renamedConfig ? { config: renamedConfig } : {}),
      },
    });

    // Notify the office that a DO is ready (best-effort; idempotent via the
    // Notification unique index, so a re-run does not re-bell). NEVER awaited in
    // a way that could fail completion: emit() swallows all errors internally.
    const doName = realName ?? doc?.name ?? null;
    await this.notifications.emit({
      organizationId,
      kind: 'DO_READY',
      title: 'Delivery Order ready',
      body: doName ? `${doName} is ready to review.` : 'A delivery order is ready to review.',
      entityType: 'document',
      entityId: documentId,
      linkUrl: doc?.documentTemplateId
        ? `/portal/documents/${doc.type}/${doc.documentTemplateId}/${documentId}`
        : null,
    });

    return this.createInvoiceFromDeliveryOrder(documentId, organizationId);
  }

  /**
   * Create an invoice from a completed DO (Phase 4c) — IDEMPOTENT.
   * Idempotency guard: skip if an INVOICE already references this DO via
   * config.sourceDocumentId (JSON path). Document has no sourceDocumentId column
   * and no VOID status, so the existence of any such INVOICE means "already
   * invoiced". The new invoice carries config.sourceDocumentId = DO.id so both
   * the guard and the DO↔invoice link work.
   */
  async createInvoiceFromDeliveryOrder(documentId: string, organizationId: string) {
    // WCT invoice per order (enableWctOrderInvoice): a job of an order is
    // billed on the ORDER's invoice, never on its own. The DO is complete; the
    // order bills itself once every job is done and verified (or on "Invoice
    // now"). Every other DO (other orgs, runs without an order, the flag off)
    // carries on below exactly as before.
    {
      const doHead = await this.prisma.document.findFirst({ where: { id: documentId, organizationId }, select: { config: true } });
      const orderId = (doHead?.config as any)?.orderId;
      if (orderId && (await isOrgFeatureEnabled(this.prisma, organizationId, WCT_ORDER_INVOICE_FLAG))) {
        console.log(`🧾 DO→INVOICE: DO ${documentId} is a job of order ${orderId}; billed on the order's invoice.`);
        await this.maybeInvoiceOrder(orderId, organizationId);
        return null;
      }
      // disableAutoDraftInvoice (manual order flow, 2026-11-19): a DO of an order never makes a draft invoice by itself.
      if (orderId && (await manualAutoDraftsOff(this.prisma, organizationId)).invoiceOff) {
        console.log(`🧾 DO→INVOICE: DO ${documentId} of order ${orderId} completed; no automatic invoice (disableAutoDraftInvoice).`);
        return null;
      }
    }
    const existing = await this.prisma.document.findFirst({
      where: {
        organizationId,
        type: 'INVOICE',
        config: { path: ['sourceDocumentId'], equals: documentId },
      },
      select: { id: true },
    });
    if (existing) {
      console.log(`🧾 DO→INVOICE: invoice ${existing.id} already exists for DO ${documentId}; skipping.`);
      return existing;
    }

    const doDoc = await this.prisma.document.findFirst({
      where: { id: documentId, organizationId },
    });
    if (!doDoc) {
      throw new HttpException('Delivery Order not found', HttpStatus.NOT_FOUND);
    }
    const doConfig: any = doDoc.config || {};

    const templateId = await this.resolveTemplateIdForType('INVOICE', organizationId);

    // Carry the DO config forward (items/customer/etc.), stamp the source link
    // + a fresh date. The DO is a GOODS document (lines are 0); the INVOICE
    // prices its own lines from the asset here (rate x quantity, no duration),
    // so an unpriced DO no longer yields an unpriced invoice.
    // STRIP THE DO'S OWN IDENTITY BEFORE SPREADING.
    //
    // The spread carries the DO's config forward so the invoice inherits the
    // customer, PO, addresses and lines. It was also carrying keys that identify
    // the DO ITSELF rather than describing the delivery — and `documentNumber`
    // is the damaging one: createBasicDocument honours an inherited
    // documentNumber over the number it just allocated, so an invoice raised
    // from a still-placeholder DO was NAMED "DO-PENDING-NN" while its own
    // freshly claimed INVOICE serial was burned unused. That happened on
    // DO202609-0062 -> invoice 9215c14f.
    //
    // This is the SECOND time the spread has carried something it should not
    // (the first was saleOrderId's siblings), so the exclusion is an explicit,
    // named list rather than a single delete — the next key to go wrong should
    // be added here, not patched downstream.
    //
    // What is stripped and why:
    //   documentNumber  the DO's own number — the invoice must use its own
    //   savedAt/savedBy        who last saved the DO, not the invoice
    //   lastUsedAt/lastUsedBy  same, the editor's provenance stamp
    //   confirmedAt            when the DO was confirmed, meaningless here
    //   stockDeducted          a DO-only flag; an invoice deducts nothing
    //   signature/signedAt/signedByName  the DELIVERY signature. An invoice
    //                          must never inherit the customer's proof-of-
    //                          delivery signature as if it were an approval.
    //   dueDate                the DO's date, not an invoice payment term —
    //                          left to the invoice's own defaults.
    // `date` is overwritten below rather than stripped (it is always set).
    // sourceDocument* are deliberately RE-SET below, not inherited: on the DO
    // they are empty strings pointing at nothing.
    const {
      documentNumber: _doNumber,
      savedAt: _savedAt,
      savedBy: _savedBy,
      lastUsedAt: _lastUsedAt,
      lastUsedBy: _lastUsedBy,
      confirmedAt: _confirmedAt,
      stockDeducted: _stockDeducted,
      signature: _signature,
      signedAt: _signedAt,
      signedByName: _signedByName,
      dueDate: _dueDate,
      ...doConfigForInvoice
    } = (doConfig ?? {}) as Record<string, unknown>;

    // `deliveryGroup` (= the Asset id) is a DO DISPLAY key: the renderers'
    // groupDeliveryLines() collapses a consecutive run sharing it into one
    // "Rental of N units / Model / S/No." block. That is right for a DO, but
    // wrong once the lines become an INVOICE the office edits: several units of
    // the SAME asset record share one deliveryGroup, so the preview collapsed
    // every line into one row and REGENERATED its description from the first
    // line — silently discarding edits to the others (guru 2026-09-25,
    // BI202609212). The invoice keeps inventoryItemId / deliveryItemId /
    // serialNumbers (real identity: DocumentItem sync, DO_START proof photos)
    // and drops only the display key, so its rows render exactly as typed.
    const pricedLines = await this.priceInvoiceLinesFromAsset(
      Array.isArray(doConfig.items) ? doConfig.items : [],
      organizationId,
      {
        saleOrderId: doConfig.saleOrderId,
        // A DO extracted from a quotation carries its source — the quote's
        // agreed prices back the invoice when no Sales Order is attached.
        sourceDocumentId: doConfig.sourceDocumentId,
        sourceDocumentType: doConfig.sourceDocumentType,
      },
    );

    // The DO's column layout (S/No · DESCRIPTION · QTY · REMARK on WCT) is a
    // DO display setting — an invoice has its own template columns, so it must
    // not ride along or the invoice editor shows a price-less goods table.
    const { columnLabels: _cl, tableColumnOrder: _tco, internalColumns: _ic, ...invoiceBase } = doConfigForInvoice as any;
    const invoiceLines = pricedLines.map(({ deliveryGroup: _deliveryGroup, ...line }: any) => line);
    // Tax settings follow the source quotation when the DO came from one (the
    // agreed GST treatment), else the org defaults. Totals are stamped NOW so
    // the draft already carries nett / GST / outstanding — an invoice saved
    // with no totals posted Dr 0 vs Cr <lines> in the posting review.
    let taxSrc: any = null;
    if (doConfig.sourceDocumentId && String(doConfig.sourceDocumentType || '').toUpperCase() === 'QUOTATION') {
      const qo = await this.prisma.document.findFirst({ where: { id: doConfig.sourceDocumentId, organizationId }, select: { config: true } }).catch(() => null);
      const qc: any = qo?.config || {};
      taxSrc = { gstPercent: qc.gstPercent ?? qc.documentInfo?.gstPercent, taxApplicable: qc.taxApplicable ?? qc.documentInfo?.taxApplicable, absorbTax: qc.absorbTax ?? qc.documentInfo?.absorbTax };
    }
    if (!taxSrc || (taxSrc.gstPercent == null && taxSrc.taxApplicable == null && taxSrc.absorbTax == null)) {
      const orgRow: any = await this.prisma.organization.findUnique({ where: { id: organizationId }, select: { taxRate: true, taxApplicable: true } }).catch(() => null);
      taxSrc = { gstPercent: orgRow?.taxRate ?? 9, taxApplicable: orgRow?.taxApplicable === false ? 'N' : 'Y', absorbTax: 'N' };
    }
    const totals = computeDocumentTotals(invoiceLines, taxSrc);
    const invoiceConfig = stampDocumentMoney(
      {
        ...invoiceBase,
        items: invoiceLines,
        date: await orgTodayFor(this.prisma, organizationId),
        sourceDocumentId: documentId,
        sourceDocumentNumber: doDoc.name ?? undefined,
        sourceDocumentType: 'DELIVERY_ORDER',
        ...totals,
        showTotals: true,
        documentInfo: { ...((invoiceBase as any).documentInfo || {}), ...totals },
      },
      { gross: totals.nettTotal, outstanding: totals.nettTotal, paid: 0 },
    );

    const invoice = await this.createBasicDocument(
      templateId,
      'INVOICE',
      organizationId,
      invoiceConfig,
      doDoc.projectId ?? undefined,
    );
    console.log(`🧾 DO→INVOICE: created invoice ${invoice.id} from DO ${documentId}`);
    // A service report written DURING the job (before the sign-off) could not
    // link an invoice that did not exist yet — link it now that it does.
    await this.prisma.maintenanceServiceReport
      .updateMany({
        where: { organizationId, kind: 'SERVICE', status: 'completed', invoiceDocumentId: null, delivery: { items: { some: { documentId } } } },
        data: { invoiceDocumentId: invoice.id },
      })
      .catch((e: any) => console.warn(`DO→INVOICE: could not link the service report to ${invoice.name}: ${e?.message}`));
    // Post it to the GL right away (guru 2026-10-27: "if an invoice is created
    // it should already post to GL") — the draft carries totals, tax and the
    // quotation's account codes now, so it posts exactly as a saved invoice
    // would; a later save voids + reposts, confirm marks the entry confirmed.
    await this.repostGlForDocument(organizationId, invoice.id, 'INVOICE', invoiceConfig, invoice.name).catch((e: any) =>
      console.warn(`DO→INVOICE: GL post for ${invoice.name} skipped: ${e?.message}`),
    );

    // Notify the office that a draft invoice was created on completion. Only
    // reached in the NEW-creation branch (the idempotency guard above returns
    // early when an invoice already exists), so a re-run never double-notifies.
    // Best-effort: emit() never throws, so it cannot roll back the invoice.
    await this.notifications.emit({
      organizationId,
      kind: 'INVOICE_DRAFT',
      title: 'Draft invoice created',
      body: invoice.name ? `${invoice.name} is ready to price and confirm.` : 'A draft invoice is ready to price and confirm.',
      entityType: 'document',
      entityId: invoice.id,
      linkUrl: `/portal/documents/${invoice.type ?? 'INVOICE'}/${templateId}/${invoice.id}`,
    });
    // The same news on the office's WhatsApp (guru 2026-10-28: "once the
    // maintenance and DO is done they will get a noti that the draft invoice
    // is created pls confirm"). Flag-gated, best-effort.
    {
      const c: any = invoiceConfig || {};
      const who = c.customerName || c.customer?.name || '';
      await this.staffWhatsApp.push(
        organizationId,
        `Job done: ${doDoc.name || 'the delivery order'} is signed off${who ? ` by ${who}` : ''}. Draft invoice ${invoice.name || ''} is created${(await isOrgFeatureEnabled(this.prisma as any, organizationId, POST_INVOICES_ON_CONFIRM_FLAG)) ? ': please review and confirm it (it posts to the ledger when confirmed or sent).' : ' and posted to the ledger: please review and confirm it.'}`,
        { linkPath: `/portal/documents/${invoice.type ?? 'INVOICE'}/${templateId}/${invoice.id}`, dedupeKey: `invoice-draft:${invoice.id}` },
      );
    }

    return invoice;
  }

  // ── WCT invoice per order (enableWctOrderInvoice, 2026-11-01) ───────────
  //
  // One invoice for the whole order instead of one per DO. A job goes on an
  // invoice once it is completed AND verified (a signature is verified at once;
  // a stamped-DO / paper finish after the office's Verify). Automatic when
  // every job of the order is done and verified; "Invoice now" bills what is
  // verified so far, and the jobs verified later go on a SECOND invoice for
  // the same order — never blocked, never folded into an invoice already made.
  // Each job is claimed (Delivery.orderInvoiceId) before the invoice exists, so
  // two triggers at once never bill a job twice. Prices come from the
  // quotation (the same SO → quotation → asset ladder as a DO's invoice); the
  // invoice posts to the GL and notifies like the per-DO one did.

  /** Automatic: bill the order when every job is done and verified and some are not invoiced yet. Never throws. */
  // ── DO first (manual order flow, 2026-11-13): DOs billed without a job ─────
  /** The order's completed DOs with no job and no invoice yet. */
  private async billableJoblessDos(organizationId: string, orderId: string) {
    const dos = await this.deliveriesService.orderDos(organizationId, orderId);
    const out: Array<{ id: string; name: string | null }> = [];
    for (const d of dos) {
      const c: any = d.config || {};
      if (!String(d.status).startsWith('delivered') || c.orderInvoiceId) continue;
      if ((await this.deliveriesService.jobsOnDo(organizationId, d.id)).length) continue;
      out.push({ id: d.id, name: d.name ?? null });
    }
    return out;
  }

  /** Claim DO-only units for one invoice run, under a per-order lock (the jobs keep their own claim). */
  private async claimJoblessDos(organizationId: string, orderId: string, ids: string[], claim: string) {
    return this.prisma.$transaction(async (tx) => {
      await tx.$executeRawUnsafe('SELECT pg_advisory_xact_lock(hashtext($1))', `order-invoice:${orderId}`);
      const docs = await tx.document.findMany({ where: { id: { in: ids }, organizationId }, select: { id: true, name: true, config: true } });
      const won: Array<{ id: string; name: string | null }> = [];
      for (const d of docs) {
        const c: any = d.config || {};
        if (c.orderInvoiceId) continue;
        await tx.document.update({ where: { id: d.id }, data: { config: { ...c, orderInvoiceId: claim } } });
        won.push({ id: d.id, name: d.name ?? null });
      }
      return won;
    });
  }

  /** Move DO-only units from a claim to the invoice (or back to unbilled with null). */
  private async setDoInvoiceClaim(organizationId: string, ids: string[], claim: string, invoiceId: string | null) {
    if (!ids.length) return;
    const docs = await this.prisma.document.findMany({ where: { id: { in: ids }, organizationId }, select: { id: true, config: true } });
    for (const d of docs) {
      const c: any = d.config || {};
      if (c.orderInvoiceId !== claim) continue;
      const { orderInvoiceId: _drop, ...rest } = c;
      void _drop;
      await this.prisma.document.update({ where: { id: d.id }, data: { config: invoiceId ? { ...c, orderInvoiceId: invoiceId } : rest } });
    }
  }

  // ── Linked DOs (round 33, 2026-11-19): a DO put on an AIMS order with Link existing document ─────
  // Create invoice bills a completed linked DO too. The DO is never written: its billed marker is the order's link
  // entry (linkedDocuments.do[i].orderInvoiceId, wct-orders.ts), claimed under the same per-order lock.

  /** The order's linked DOs that are completed, carry no job, are not ERP-imported and have no live invoice yet. */
  private async billableLinkedDos(organizationId: string, order: { id: string; linkedDocuments?: unknown }) {
    const entries = linkedDoEntriesOf(order).filter((e) => e.imported !== true);
    if (!entries.length) return [];
    const docs: any[] = await this.prisma.document.findMany({ where: { organizationId, id: { in: entries.map((e) => e.id) }, type: { in: ['DELIVERY_ORDER', 'DO'] } }, select: { id: true, name: true, status: true, config: true } });
    const live = await liveInvoiceIds(this.prisma, organizationId, entries.map((e) => e.orderInvoiceId));
    const out: Array<{ id: string; name: string | null }> = [];
    for (const e of entries) {
      const d = docs.find((x) => x.id === e.id);
      if (!d || isErpImported(d.config) || d.config?.cancelled === true || d.config?.orderId === order.id) continue;
      if (!String(d.status).startsWith('delivered')) continue;
      if (e.orderInvoiceId && (String(e.orderInvoiceId).startsWith('claim:') || live.has(e.orderInvoiceId))) continue;
      if ((await this.deliveriesService.jobsOnDo(organizationId, d.id)).length) continue;
      out.push({ id: d.id, name: d.name ?? null });
    }
    return out;
  }

  /** Claim linked DOs for one invoice run on the order's link entries (per-order lock); returns those won. */
  private async claimLinkedDos(organizationId: string, orderId: string, ids: string[], claim: string) {
    return this.prisma.$transaction(async (tx: any) => {
      await tx.$executeRawUnsafe('SELECT pg_advisory_xact_lock(hashtext($1))', `order-invoice:${orderId}`);
      const row: any = await tx.order.findFirst({ where: { id: orderId, organizationId }, select: { linkedDocuments: true } });
      const ld: any = row?.linkedDocuments && typeof row.linkedDocuments === 'object' ? row.linkedDocuments : {};
      const list: any[] = Array.isArray(ld.do) ? ld.do : [];
      const live = await liveInvoiceIds(tx, organizationId, list.map((e: any) => e?.orderInvoiceId));
      const won: Array<{ id: string; name: string | null }> = [];
      const next = list.map((e: any) => {
        if (!e || !ids.includes(e.id)) return e;
        if (e.orderInvoiceId && (String(e.orderInvoiceId).startsWith('claim:') || live.has(e.orderInvoiceId))) return e;
        won.push({ id: e.id, name: e.name ?? null });
        return { ...e, orderInvoiceId: claim };
      });
      if (won.length) await tx.order.update({ where: { id: orderId }, data: { linkedDocuments: { ...ld, do: next } } });
      return won;
    });
  }

  /** Move linked DOs from a claim to the invoice (or back to unbilled with null). */
  private async setLinkedDoClaim(organizationId: string, orderId: string, claim: string, invoiceId: string | null) {
    await this.prisma.$transaction(async (tx: any) => {
      await tx.$executeRawUnsafe('SELECT pg_advisory_xact_lock(hashtext($1))', `order-invoice:${orderId}`);
      const row: any = await tx.order.findFirst({ where: { id: orderId, organizationId }, select: { linkedDocuments: true } });
      const ld: any = row?.linkedDocuments && typeof row.linkedDocuments === 'object' ? row.linkedDocuments : {};
      if (!Array.isArray(ld.do) || !ld.do.some((e: any) => e?.orderInvoiceId === claim)) return;
      const next = ld.do.map((e: any) => {
        if (e?.orderInvoiceId !== claim) return e;
        const { orderInvoiceId: _x, ...rest } = e;
        return invoiceId ? { ...rest, orderInvoiceId: invoiceId } : rest;
      });
      await tx.order.update({ where: { id: orderId }, data: { linkedDocuments: { ...ld, do: next } } });
    });
  }

  async maybeInvoiceOrder(orderId: string, organizationId: string) {
    try {
      if (!(await isOrgFeatureEnabled(this.prisma, organizationId, WCT_ORDER_INVOICE_FLAG))) return null;
      // An imported order (round 19: it takes DOs now) never bills itself when its DOs complete: its invoices are
      // made with Create invoice on the order page (invoiceImportedOrderRemainder), so nothing is billed twice.
      const head = await Promise.resolve()
        .then(() => this.prisma.order.findFirst({ where: { id: orderId, organizationId }, select: { linkedDocuments: true } }))
        .catch(() => null);
      if (isImportedOrder(head)) return null;
      // disableAutoDraftInvoice (manual flow, 2026-11-19): the run below only links the DOs / jobs to an invoice
      // already on the order (no new document); with none, the order reads "DO completed, invoice pending".
      const auto = (await manualAutoDraftsOff(this.prisma, organizationId)).invoiceOff ? ({ trigger: 'auto', linkOnly: true } as const) : ({ trigger: 'auto' } as const);
      // DO first: the order bills itself once every live DO is done (a DO with a job: its jobs verified too).
      if (await isManualOrderFlow(this.prisma, organizationId)) {
        const dos = await this.deliveriesService.orderDos(organizationId, orderId);
        if (dos.length) {
          let unbilled = false;
          for (const d of dos) {
            const jobs = await this.deliveriesService.jobsOnDo(organizationId, d.id);
            if (jobs.length) {
              if (jobs.some((j) => j.isDraft || !isVerifiedJob(j))) return null;
              if (jobs.some((j) => !j.orderInvoiceId)) unbilled = true;
            } else {
              if (!String(d.status).startsWith('delivered')) return null;
              if (!(d.config as any)?.orderInvoiceId) unbilled = true;
            }
          }
          const loose = await this.prisma.delivery.findMany({
            where: { organizationId, orderId, status: { not: 'cancelled' }, NOT: { items: { some: { documentId: { not: null } } } } },
            select: { id: true },
          });
          if (loose.length) return null; // a job with no DO yet (before DO first): finish it the old way
          if (!unbilled) return null;
          return await this.invoiceOrder(orderId, organizationId, auto);
        }
      }
      const jobs = await this.prisma.delivery.findMany({
        where: { organizationId, orderId },
        select: { id: true, status: true, isDraft: true, verificationState: true, orderInvoiceId: true },
      });
      const live = jobs.filter((j) => j.status !== 'cancelled');
      if (!live.length || live.some((j) => j.isDraft) || !live.every((j) => isVerifiedJob(j))) return null;
      if (!live.some((j) => !j.orderInvoiceId)) return null;
      return await this.invoiceOrder(orderId, organizationId, auto);
    } catch (e: any) {
      console.warn(`🧾 ORDER→INVOICE: automatic invoice for order ${orderId} failed: ${e?.message}`);
      return null;
    }
  }

  /**
   * Bill the order's completed + verified jobs that are not on an invoice yet.
   * trigger 'now' = the admin's "Invoice now" (refuses when there is nothing to
   * bill); 'auto' = from maybeInvoiceOrder. Returns the new invoice, or null
   * when another trigger already took the jobs.
   */
  async invoiceOrder(orderId: string, organizationId: string, opts: { trigger: 'auto' | 'now'; actor?: DocumentActor; linkOnly?: boolean }) {
    if (!(await isOrgFeatureEnabled(this.prisma, organizationId, WCT_ORDER_INVOICE_FLAG))) {
      throw new HttpException('Invoicing per order is not enabled for this organisation', HttpStatus.BAD_REQUEST);
    }
    const order = await this.prisma.order.findFirst({
      where: { id: orderId, organizationId },
      select: { id: true, orderNumber: true, sourceQuotationId: true, linkedDocuments: true },
    });
    if (!order) throw new HttpException('Order not found', HttpStatus.NOT_FOUND);
    if (isImportedOrder(order)) throw new HttpException(IMPORTED_ORDER_USE_CREATE_INVOICE, HttpStatus.BAD_REQUEST);
    const jobs = await this.prisma.delivery.findMany({
      where: { organizationId, orderId },
      select: { id: true, deliveryNumber: true, status: true, verificationState: true, orderInvoiceId: true, projectId: true },
      orderBy: { deliveryNumber: 'asc' },
    });
    let billable = jobs.filter((j) => isVerifiedJob(j) && !j.orderInvoiceId);
    const adopted: string[] = [];
    // A job whose DO already has its own invoice (finished before invoicing
    // per order was switched on) is never billed twice: it keeps that invoice.
    if (billable.length) {
      const its = await this.prisma.deliveryItem.findMany({ where: { deliveryId: { in: billable.map((j) => j.id) }, documentId: { not: null } }, select: { deliveryId: true, documentId: true } });
      for (const j of [...billable]) {
        const doIds = [...new Set(its.filter((i) => i.deliveryId === j.id).map((i) => i.documentId as string))];
        if (!doIds.length) continue;
        const own = await this.prisma.document.findFirst({ where: { organizationId, type: 'INVOICE', OR: doIds.map((id) => ({ config: { path: ['sourceDocumentId'], equals: id } })) }, select: { id: true } });
        if (!own) continue;
        await this.prisma.delivery.updateMany({ where: { id: j.id, organizationId, orderInvoiceId: null }, data: { orderInvoiceId: own.id } });
        adopted.push(own.id);
        billable = billable.filter((b) => b.id !== j.id);
      }
    }
    // Manual order flow, DO first (2026-11-13): a completed DO with no job is billed on its own (a "DO unit").
    const manualDo = await isManualOrderFlow(this.prisma, organizationId);
    const doCandidates = manualDo ? await this.billableJoblessDos(organizationId, orderId) : [];
    // Round 33: completed linked DOs (Link existing document) not billed yet, on Create invoice only (never automatic).
    const linkedCandidates = manualDo && opts.trigger === 'now' ? await this.billableLinkedDos(organizationId, order) : [];
    if (!billable.length && !doCandidates.length && !linkedCandidates.length) {
      // Invoice first (manual flow, 2026-11-16): nothing completed yet, so "Create invoice" bills the quotation.
      if (opts.trigger === 'now' && manualDo) {
        // Already invoiced (e.g. the draft made at signing, 2026-11-17): open that one, never a second.
        const existing = await this.liveOrderInvoice(organizationId, order);
        if (existing) return { ...existing, existing: true } as any;
        return this.invoiceOrderFromQuotation(orderId, organizationId);
      }
      if (opts.trigger === 'now') throw new HttpException('Nothing to invoice: no completed DO or verified job is waiting for an invoice.', HttpStatus.BAD_REQUEST);
      return null;
    }

    // Claim the jobs first: only rows still unbilled are taken, so a second
    // trigger at the same moment finds nothing left and stops. DO-only units
    // are claimed the same way under a per-order lock.
    const claim = `claim:${randomUUID()}`;
    if (billable.length) {
      await this.prisma.delivery.updateMany({ where: { id: { in: billable.map((j) => j.id) }, organizationId, orderInvoiceId: null }, data: { orderInvoiceId: claim } });
    }
    const claimed = await this.prisma.delivery.findMany({
      where: { organizationId, orderInvoiceId: claim },
      select: { id: true, deliveryNumber: true, projectId: true },
      orderBy: { deliveryNumber: 'asc' },
    });
    const claimedDos = doCandidates.length ? await this.claimJoblessDos(organizationId, orderId, doCandidates.map((d) => d.id), claim) : [];
    const claimedLinked = linkedCandidates.length ? await this.claimLinkedDos(organizationId, orderId, linkedCandidates.map((d) => d.id), claim) : [];
    if (!claimed.length && !claimedDos.length && !claimedLinked.length) return null;

    try {
      // Each job's DO, in job order: the jobs' lines, to tell the quote's scope from the extras.
      const items = await this.prisma.deliveryItem.findMany({ where: { deliveryId: { in: claimed.map((j) => j.id) }, documentId: { not: null } }, select: { deliveryId: true, documentId: true } });
      const doIdsInOrder: string[] = [];
      const doJob = new Map<string, string>();
      for (const j of claimed)
        for (const it of items)
          if (it.deliveryId === j.id && it.documentId && !doIdsInOrder.includes(it.documentId)) {
            doIdsInOrder.push(it.documentId);
            doJob.set(it.documentId, j.id);
          }
      for (const d of claimedDos) {
        if (!doIdsInOrder.includes(d.id)) doIdsInOrder.push(d.id);
        doJob.set(d.id, `do:${d.id}`);
      }
      for (const d of claimedLinked) {
        if (!doIdsInOrder.includes(d.id)) doIdsInOrder.push(d.id);
        doJob.set(d.id, `ldo:${d.id}`);
      }
      const dos = await this.prisma.document.findMany({ where: { id: { in: doIdsInOrder }, organizationId, type: { in: ['DELIVERY_ORDER', 'DO'] } } });
      const doById = new Map(dos.map((d) => [d.id, d]));
      const orderedDos = doIdsInOrder.map((id) => doById.get(id)).filter(Boolean) as any[];
      if (!orderedDos.length) throw new Error('the jobs have no Delivery Order to invoice from');
      // What this invoice bills, for the messages: job numbers and DO-only DOs.
      const unitsText = [...claimed.map((j) => `job #${j.deliveryNumber}`), ...claimedDos.map((d) => d.name || 'DO'), ...claimedLinked.map((d) => d.name || 'DO')].join(', ');

      // The quotation is the contract: billed once per order (order-billing.ts).
      // It is already billed when an earlier invoice of this order exists (the
      // first one always carries it; a job that kept its own per-DO invoice
      // billed it too). Checked against live rows, so a deleted invoice counts as never made.
      const quotationId = order.sourceQuotationId ?? (orderedDos[0].config as any)?.sourceDocumentId ?? null;
      const qo = quotationId ? await this.prisma.document.findFirst({ where: { id: quotationId, organizationId }, select: { name: true, config: true } }).catch(() => null) : null;
      const qc: any = qo?.config || {};
      const quoteItems: any[] = Array.isArray(qc.items) ? qc.items : [];
      const earlierIds = [
        ...new Set([
          ...jobs.map((j) => j.orderInvoiceId).filter((v): v is string => !!v && !v.startsWith('claim:')),
          ...adopted,
          ...(Array.isArray((order.linkedDocuments as any)?.invoice) ? (order.linkedDocuments as any).invoice.map((x: any) => x?.id).filter(Boolean) : []),
        ]),
      ];
      const earlier = earlierIds.length
        ? await this.prisma.document.findMany({ where: { id: { in: earlierIds }, organizationId, type: 'INVOICE' }, select: { id: true, name: true }, orderBy: { createdAt: 'asc' } })
        : [];
      const workLines = quoteItems.filter((l) => !isDisplayRow(l));
      const resolved = await quotationLinesForJob(this.prisma, organizationId, qc);
      const quoteKey = new Map<any, string | null>(workLines.map((l, i) => [l, resolved[i]?.asset ? assetKey(resolved[i].asset!.id) : descKey(l.description)]));
      const unitLines = (unitId: string) =>
        orderedDos
          .filter((d) => doJob.get(d.id) === unitId)
          .flatMap((d) => (Array.isArray((d.config as any)?.items) ? (d.config as any).items : []).map((l: any) => ({ ...l, __doId: d.id })));
      // Round 33 (Elroy): a linked DO. With the quotation already billed on this order (nothing left to bill from
      // it), Create invoice bills the linked DO's own lines as they are (qty / items, priced by the usual ladder).
      // With the quotation not billed yet: the quotation once, and the linked DO's lines only as extras above it
      // (the same scope / extras rule as the order's own DOs).
      const quoteBilled = earlier.length > 0;
      const linkedUnits = claimedLinked.map((d) => `ldo:${d.id}`);
      const plan = planOrderInvoice({
        quoteBilled,
        quoteLines: quoteItems,
        jobs: [...claimed.map((j) => j.id), ...claimedDos.map((d) => `do:${d.id}`), ...(quoteBilled ? [] : linkedUnits)].map((id) => ({ jobId: id, lines: unitLines(id) })),
        keyOfQuoteLine: (l) => quoteKey.get(l) ?? null,
        keyOfJobLine: (l: any) => assetKey(l.assetId) ?? descKey(l.description),
      });
      const linkedFull = quoteBilled
        ? linkedUnits.flatMap((id) => splitJobLines(unitLines(id), (l: any) => assetKey(l.assetId) ?? descKey(l.description), new Map()).extras.map((e: any) => ({ ...e, jobId: id })))
        : [];
      const extrasAll: any[] = [...plan.extras, ...linkedFull];
      const nothing = !plan.billQuote && !extrasAll.length;

      if (nothing) {
        // The quote is billed and these jobs add nothing on top: no empty
        // invoice. The jobs are covered by the invoice that billed the quote.
        const cover = earlier[0];
        // No quotation lines and nothing extra: nothing at all to bill (the catch hands the jobs back).
        if (!cover) throw new HttpException('Nothing to invoice: the quotation has no lines and the jobs add none.', HttpStatus.BAD_REQUEST);
        await this.prisma.delivery.updateMany({ where: { organizationId, orderInvoiceId: claim }, data: { orderInvoiceId: cover.id } });
        await this.setDoInvoiceClaim(organizationId, claimedDos.map((d) => d.id), claim, cover.id);
        await this.setLinkedDoClaim(organizationId, order.id, claim, cover.id);
        console.log(`🧾 ORDER→INVOICE: ${order.orderNumber} jobs ${claimed.map((j) => `#${j.deliveryNumber}`).join(', ')} add no lines to the quotation; covered by ${cover.name} (${opts.trigger}).`);
        await refreshOrderStatus(this.prisma, organizationId, order.id);
        return { id: cover.id, name: cover.name, type: 'INVOICE', covered: true, jobNumbers: claimed.map((j) => j.deliveryNumber) } as any;
      }

      // disableAutoDraftInvoice (linkOnly, from maybeInvoiceOrder): never a new draft by itself. The jobs / DOs go
      // back to unbilled, so the order reads "DO completed, invoice pending" and Create invoice bills them.
      if (opts.linkOnly) {
        await this.prisma.delivery.updateMany({ where: { organizationId, orderInvoiceId: claim }, data: { orderInvoiceId: null } });
        await this.setDoInvoiceClaim(organizationId, claimedDos.map((d) => d.id), claim, null);
        await this.setLinkedDoClaim(organizationId, order.id, claim, null);
        console.log(`🧾 ORDER→INVOICE: ${order.orderNumber} ${unitsText} done; no automatic invoice (disableAutoDraftInvoice).`);
        await refreshOrderStatus(this.prisma, organizationId, order.id);
        return null;
      }

      // Lines: the quotation's exactly as quoted (once), then each job's extras
      // priced by the usual SO → quotation → asset ladder (a typed price stays).
      const lines: any[] = plan.billQuote ? quoteItems.map((l) => ({ ...l, fromQuotation: true })) : [];
      for (const d of orderedDos) {
        const c: any = d.config || {};
        const extras = extrasAll.filter((e: any) => e.__doId === d.id).map(({ jobId: _j, __doId: _d, ...l }: any) => l);
        if (!extras.length) continue;
        const priced = await this.priceInvoiceLinesFromAsset(extras, organizationId, {
          saleOrderId: c.saleOrderId,
          sourceDocumentId: c.sourceDocumentId ?? quotationId ?? undefined,
          sourceDocumentType: c.sourceDocumentType ?? (quotationId ? 'QUOTATION' : undefined),
        });
        for (const { deliveryGroup: _g, ...line } of priced as any[]) lines.push({ ...line, doNumber: d.name ?? null, orderExtra: true });
      }

      // The header (customer, addresses, PO, quotation no.) from the first DO,
      // without the DO's own identity — the same strip list as the per-DO invoice.
      const {
        documentNumber: _n, savedAt: _sa, savedBy: _sb, lastUsedAt: _la, lastUsedBy: _lb, confirmedAt: _ca, stockDeducted: _sd,
        signature: _sg, signedAt: _st, signedByName: _sn, dueDate: _dd, columnLabels: _cl, tableColumnOrder: _tco, internalColumns: _ic,
        issuedOnSchedule: _is, cancelled: _cn, cancelledAt: _cat, cancelledReason: _cr, ...base
      } = ((orderedDos[0].config as any) ?? {}) as Record<string, any>;

      let taxSrc: any = qo ? { gstPercent: qc.gstPercent ?? qc.documentInfo?.gstPercent, taxApplicable: qc.taxApplicable ?? qc.documentInfo?.taxApplicable, absorbTax: qc.absorbTax ?? qc.documentInfo?.absorbTax } : null;
      if (!taxSrc || (taxSrc.gstPercent == null && taxSrc.taxApplicable == null && taxSrc.absorbTax == null)) {
        const orgRow: any = await this.prisma.organization.findUnique({ where: { id: organizationId }, select: { taxRate: true, taxApplicable: true } }).catch(() => null);
        taxSrc = { gstPercent: orgRow?.taxRate ?? 9, taxApplicable: orgRow?.taxApplicable === false ? 'N' : 'Y', absorbTax: 'N' };
      }
      // The quotation's document discount comes with its lines, as an amount
      // (extras on top are not discounted); the % is stored so the editor,
      // which re-derives the discount from it, lands on the same amount.
      const quoteGross = plan.billQuote ? computeDocumentTotals(workLines, taxSrc).grossTotal : 0;
      const discount = plan.billQuote ? quoteDiscountAmount(qc, quoteGross) : 0;
      const totals = computeDocumentTotals(lines, taxSrc, { discountAmount: discount });
      const discountPercent = invoiceDiscountPercent(qc, discount, totals.grossTotal, !extrasAll.length);
      const discountKeys = discount > 0 ? { discountAmount: totals.discountAmount ?? 0, discountPercent } : {};
      const quotedNett = Number(qc.nettTotal ?? qc.documentInfo?.nettTotal);
      if (plan.billQuote && !extrasAll.length && isFinite(quotedNett) && quotedNett > 0 && Math.abs(quotedNett - totals.nettTotal) > 0.01) {
        console.warn(`🧾 ORDER→INVOICE: ${order.orderNumber} invoice total ${totals.nettTotal} differs from the quotation's ${quotedNett}; check the quotation's adjustments.`);
      }
      const doNumbers = orderedDos.map((d) => d.name).filter(Boolean) as string[];
      const reference = orderInvoiceReference(order.orderNumber, doNumbers, (base as any).referenceNo ?? (base as any).documentInfo?.referenceNo);
      const invoiceConfig = stampDocumentMoney(
        {
          ...base,
          // The quotation's Subject comes with it (2026-11-20): the header is taken from the DO,
          // which has no Subject, so the invoice used to start with a blank one. WCT's subject
          // also carries the job type that decides what the invoice posts (subject-type-account.ts).
          ...(!(base as any).subject && !(base as any).documentInfo?.subject && quoteSubjectOf(qc) ? { subject: quoteSubjectOf(qc) } : {}),
          items: lines,
          date: await orgTodayFor(this.prisma, organizationId),
          // Priced from the quotation; the order + its DOs are named on it.
          ...(quotationId ? { sourceDocumentId: quotationId, sourceDocumentType: 'QUOTATION', ...(qo?.name ? { sourceDocumentNumber: qo.name } : {}) } : {}),
          orderId: order.id,
          orderNo: order.orderNumber,
          orderJobIds: claimed.map((j) => j.id),
          // Round 33: the linked DOs this invoice bills (their marker is on the order's link entries).
          ...(claimedLinked.length ? { orderLinkedDoIds: claimedLinked.map((d) => d.id) } : {}),
          orderBillsQuote: plan.billQuote,
          deliveryOrderNos: doNumbers,
          // Reference (the canonical free-text key) names the order and its DOs
          // too, so the invoice lists find it by order number.
          referenceNo: reference,
          ...totals,
          ...discountKeys,
          showTotals: true,
          documentInfo: { ...((base as any).documentInfo || {}), ...totals, ...discountKeys, referenceNo: reference },
        },
        { gross: totals.nettTotal, outstanding: totals.nettTotal, paid: 0 },
      );
      // Round 36: the org's next INV number, claimed with the insert (createOrderInvoice).
      const invoice = await this.createOrderInvoice(organizationId, invoiceConfig, claimed[0]?.projectId ?? orderedDos[0].projectId ?? undefined);
      const templateId = invoice.documentTemplateId;

      await this.prisma.delivery.updateMany({ where: { organizationId, orderInvoiceId: claim }, data: { orderInvoiceId: invoice.id } });
      await this.setDoInvoiceClaim(organizationId, claimedDos.map((d) => d.id), claim, invoice.id);
      // Read the links again: the run's claims sit on them (linked DOs, round 33), never overwrite them with the start copy.
      const freshLd: any = (await this.prisma.order.findFirst({ where: { id: order.id, organizationId }, select: { linkedDocuments: true } }))?.linkedDocuments;
      const ld: any = (freshLd && typeof freshLd === 'object' ? freshLd : (order.linkedDocuments as any)) || { po: [], do: [], invoice: [], salesOrder: [] };
      ld.invoice = [...(Array.isArray(ld.invoice) ? ld.invoice : []), { id: invoice.id, name: invoice.name, jobIds: claimed.map((j) => j.id) }];
      await this.prisma.order.update({ where: { id: order.id }, data: { invoiceDocumentId: invoice.id, linkedDocuments: ld } });
      await this.setLinkedDoClaim(organizationId, order.id, claim, invoice.id);
      console.log(`🧾 ORDER→INVOICE: ${invoice.name} for ${order.orderNumber} (${opts.trigger}; ${unitsText})`);

      // The jobs' service reports point at the invoice that bills them.
      await this.prisma.maintenanceServiceReport
        .updateMany({ where: { organizationId, kind: 'SERVICE', invoiceDocumentId: null, deliveryId: { in: claimed.map((j) => j.id) } }, data: { invoiceDocumentId: invoice.id } })
        .catch(() => undefined);
      await this.repostGlForDocument(organizationId, invoice.id, 'INVOICE', invoiceConfig, invoice.name).catch((e: any) =>
        console.warn(`ORDER→INVOICE: GL post for ${invoice.name} skipped: ${e?.message}`),
      );
      const link = `/portal/documents/${invoice.type ?? 'INVOICE'}/${templateId}/${invoice.id}`;
      const jobsText = unitsText;
      await this.notifications.emit({
        organizationId,
        kind: 'INVOICE_DRAFT',
        title: 'Draft invoice created',
        body: `${invoice.name || 'A draft invoice'} for order ${order.orderNumber} (${jobsText}) is ready to review and confirm.`,
        entityType: 'document',
        entityId: invoice.id,
        linkUrl: link,
      });
      {
        const who = (invoiceConfig as any).customerName || (invoiceConfig as any).customer?.name || '';
        await this.staffWhatsApp.push(
          organizationId,
          `Order ${order.orderNumber}${who ? ` (${who})` : ''}: ${opts.trigger === 'now' ? 'invoiced now for' : 'all done and verified,'} ${jobsText}. Draft invoice ${invoice.name || ''} is ${(await isOrgFeatureEnabled(this.prisma as any, organizationId, POST_INVOICES_ON_CONFIRM_FLAG)) ? 'ready to review and confirm (it posts to the ledger when confirmed or sent).' : 'created and posted to the ledger: please review and confirm it.'}`,
          { linkPath: link, dedupeKey: `order-invoice:${invoice.id}` },
        );
      }
      await refreshOrderStatus(this.prisma, organizationId, order.id);
      return invoice;
    } catch (e: any) {
      // Hand the jobs back so the next trigger can bill them.
      await this.prisma.delivery.updateMany({ where: { organizationId, orderInvoiceId: claim }, data: { orderInvoiceId: null } }).catch(() => undefined);
      await this.setDoInvoiceClaim(organizationId, claimedDos.map((d) => d.id), claim, null).catch(() => undefined);
      await this.setLinkedDoClaim(organizationId, order.id, claim, null).catch(() => undefined);
      throw e;
    }
  }

  /**
   * Round 36 (WCT group, 2026-11-19): every invoice made from an order (Invoice now, the invoice from the quotation,
   * Create invoice for what is left on an AIMS or an imported order) is made here. Its number is the org's next INV
   * number from the counter, claimed inside the transaction that writes the invoice (createBasicDocument with
   * lockedNumber: document-numbering/locked-number.ts), retried with a fresh number on a clash (the per-template
   * unique index, or the aims_inv_number_guard trigger). Never a typed or carried-over number (no -01 / -02 suffix):
   * a documentNumber inherited from the DO / quotation header is dropped. Invoices already numbered keep their names.
   */
  async createOrderInvoice(organizationId: string, config: any, projectId?: string): Promise<any> {
    const { documentNumber: _n, ...rest } = ((config ?? {}) as Record<string, any>);
    if (rest.documentInfo && typeof rest.documentInfo === 'object') {
      const { documentNumber: _d, ...di } = rest.documentInfo;
      rest.documentInfo = di;
    }
    const templateId = await this.resolveTemplateIdForType('INVOICE', organizationId);
    const invoice: any = await this.createBasicDocument(templateId, 'INVOICE', organizationId, rest, projectId, undefined, undefined, { lockedNumber: true });
    return { ...invoice, documentTemplateId: invoice?.documentTemplateId ?? templateId };
  }

  /**
   * Invoice first (manual order flow, 2026-11-16; WCT invoices before it
   * delivers). The order's invoice made from its quotation while no DO is done
   * yet: the quotation's lines exactly as quoted, once (its discount and tax
   * too), the header from the order's DO (the DO made at signing carries the
   * quotation's customer and addresses), else from the quotation. Recorded on
   * the order (linkedDocuments.invoice + invoiceDocumentId) and NOT on any DO:
   * when the last DO completes, maybeInvoiceOrder finds the quotation already
   * billed and links the DOs to this invoice ("covered"), so no second invoice
   * is made unless a DO carries lines on top of the quote. Refused when the
   * order already has an invoice. Drafts post per postInvoicesOnConfirm as usual.
   */
  async invoiceOrderFromQuotation(orderId: string, organizationId: string) {
    if (!(await isManualOrderFlow(this.prisma, organizationId))) {
      throw new HttpException('Invoicing from the quotation is part of the manual order flow, which is not enabled for this organisation', HttpStatus.BAD_REQUEST);
    }
    const emptyLinks = () => ({ po: [], do: [], invoice: [], salesOrder: [] });
    // Under the order lock: check there is no invoice yet and claim the order for this run
    // (a second click waits on the lock, then sees the claim or the invoice).
    const { order, qo, qc, quoteItems, workLines, claim } = await this.prisma.$transaction(async (tx) => {
      await tx.$executeRawUnsafe('SELECT pg_advisory_xact_lock(hashtext($1))', `order-invoice:${orderId}`);
      const order = await tx.order.findFirst({
        where: { id: orderId, organizationId },
        select: { id: true, orderNumber: true, status: true, sourceQuotationId: true, linkedDocuments: true, invoiceDocumentId: true },
      });
      if (!order) throw new HttpException('Order not found', HttpStatus.NOT_FOUND);
      if (isImportedOrder(order)) throw new HttpException(IMPORTED_ORDER_USE_CREATE_INVOICE, HttpStatus.BAD_REQUEST);
      if (order.status === 'CANCELLED') throw new HttpException('This order is cancelled', HttpStatus.BAD_REQUEST);
      const existingIds = orderInvoiceIdsOf(order);
      const existing = existingIds.length ? await tx.document.findFirst({ where: { organizationId, id: { in: existingIds }, type: 'INVOICE' }, select: { name: true } }) : null;
      if (existing) throw new HttpException(`This order already has an invoice (${existing.name ?? 'invoice'}).`, HttpStatus.BAD_REQUEST);
      if (!order.sourceQuotationId) throw new HttpException('This order has no quotation to invoice from.', HttpStatus.BAD_REQUEST);
      const qo = await tx.document.findFirst({ where: { id: order.sourceQuotationId, organizationId }, select: { id: true, name: true, config: true } });
      if (!qo) throw new HttpException('The quotation of this order is gone.', HttpStatus.BAD_REQUEST);
      const qc: any = qo.config || {};
      const quoteItems: any[] = Array.isArray(qc.items) ? qc.items : [];
      const workLines = quoteItems.filter((l) => !isDisplayRow(l));
      if (!workLines.length) throw new HttpException('Nothing to invoice: the quotation has no lines.', HttpStatus.BAD_REQUEST);
      const ld: any = (order.linkedDocuments as any) || emptyLinks();
      if (ld.invoiceClaim && Date.now() - Date.parse(ld.invoiceClaim.at) < 5 * 60_000) {
        throw new HttpException('An invoice for this order is being created. Refresh in a moment.', HttpStatus.CONFLICT);
      }
      const claim = { id: randomUUID(), at: new Date().toISOString() };
      await tx.order.update({ where: { id: order.id }, data: { linkedDocuments: { ...ld, invoiceClaim: claim } } });
      return { order, qo, qc, quoteItems, workLines, claim };
    });
    // Drop this run's claim and, when made, record the invoice on the order (same lock).
    const release = (invoice: { id: string; name: string | null } | null) =>
      this.prisma.$transaction(async (tx) => {
        await tx.$executeRawUnsafe('SELECT pg_advisory_xact_lock(hashtext($1))', `order-invoice:${order.id}`);
        const fresh = await tx.order.findFirst({ where: { id: order.id, organizationId }, select: { linkedDocuments: true } });
        const { invoiceClaim, ...rest }: any = (fresh?.linkedDocuments as any) || emptyLinks();
        const next: any = invoiceClaim && invoiceClaim.id !== claim.id ? { ...rest, invoiceClaim } : rest;
        if (invoice) next.invoice = [...(Array.isArray(next.invoice) ? next.invoice : []), { id: invoice.id, name: invoice.name, jobIds: [], fromQuotation: true }];
        await tx.order.update({ where: { id: order.id }, data: { linkedDocuments: next, ...(invoice ? { invoiceDocumentId: invoice.id } : {}) } });
      });
    try {
      // Header: the order's first live DO (made at signing from this quotation), else the quotation itself.
      const dos = (await this.deliveriesService.orderDos(organizationId, order.id)).filter((d: any) => (d.config as any)?.cancelled !== true);
      const headerSrc: any = (dos[0]?.config as any) ?? qc;
      const {
        documentNumber: _n, savedAt: _sa, savedBy: _sb, lastUsedAt: _la, lastUsedBy: _lb, confirmedAt: _ca, stockDeducted: _sd,
        signature: _sg, signedAt: _st, signedByName: _sn, dueDate: _dd, columnLabels: _cl, tableColumnOrder: _tco, internalColumns: _ic,
        issuedOnSchedule: _is, cancelled: _cn, cancelledAt: _cat, cancelledReason: _cr, items: _it, orderInvoiceId: _oi, awaitingSignature: _aw,
        ...base
      } = (headerSrc ?? {}) as Record<string, any>;
      let taxSrc: any = { gstPercent: qc.gstPercent ?? qc.documentInfo?.gstPercent, taxApplicable: qc.taxApplicable ?? qc.documentInfo?.taxApplicable, absorbTax: qc.absorbTax ?? qc.documentInfo?.absorbTax };
      if (taxSrc.gstPercent == null && taxSrc.taxApplicable == null && taxSrc.absorbTax == null) {
        const orgRow: any = await this.prisma.organization.findUnique({ where: { id: organizationId }, select: { taxRate: true, taxApplicable: true } }).catch(() => null);
        taxSrc = { gstPercent: orgRow?.taxRate ?? 9, taxApplicable: orgRow?.taxApplicable === false ? 'N' : 'Y', absorbTax: 'N' };
      }
      const lines = quoteItems.map((l) => ({ ...l, fromQuotation: true }));
      const quoteGross = computeDocumentTotals(workLines, taxSrc).grossTotal;
      const discount = quoteDiscountAmount(qc, quoteGross);
      const totals = computeDocumentTotals(lines, taxSrc, { discountAmount: discount });
      const discountPercent = invoiceDiscountPercent(qc, discount, totals.grossTotal, true);
      const discountKeys = discount > 0 ? { discountAmount: totals.discountAmount ?? 0, discountPercent } : {};
      const doNumbers = dos.map((d: any) => d.name).filter(Boolean) as string[];
      const reference = orderInvoiceReference(order.orderNumber, doNumbers, (base as any).referenceNo ?? (base as any).documentInfo?.referenceNo);
      const invoiceConfig = stampDocumentMoney(
        {
          ...base,
          // The quotation's Subject comes with it (2026-11-20): the header is taken from the DO,
          // which has no Subject, so the invoice used to start with a blank one. WCT's subject
          // also carries the job type that decides what the invoice posts (subject-type-account.ts).
          ...(!(base as any).subject && !(base as any).documentInfo?.subject && quoteSubjectOf(qc) ? { subject: quoteSubjectOf(qc) } : {}),
          items: lines,
          date: await orgTodayFor(this.prisma, organizationId),
          sourceDocumentId: qo.id,
          sourceDocumentType: 'QUOTATION',
          ...(qo.name ? { sourceDocumentNumber: qo.name } : {}),
          orderId: order.id,
          orderNo: order.orderNumber,
          orderJobIds: [],
          orderBillsQuote: true,
          orderInvoicedFirst: true,
          deliveryOrderNos: doNumbers,
          referenceNo: reference,
          ...totals,
          ...discountKeys,
          showTotals: true,
          documentInfo: { ...((base as any).documentInfo || {}), ...totals, ...discountKeys, referenceNo: reference },
        },
        { gross: totals.nettTotal, outstanding: totals.nettTotal, paid: 0 },
      );
      const invoice = await this.createOrderInvoice(organizationId, invoiceConfig, (dos[0] as any)?.projectId ?? undefined);
      await release({ id: invoice.id, name: invoice.name ?? null });
      console.log(`🧾 ORDER→INVOICE: ${invoice.name} for ${order.orderNumber} from quotation ${qo.name ?? qo.id} (invoice first)`);
      await this.repostGlForDocument(organizationId, invoice.id, 'INVOICE', invoiceConfig, invoice.name).catch((e: any) =>
        console.warn(`ORDER→INVOICE: GL post for ${invoice.name} skipped: ${e?.message}`),
      );
      await refreshOrderStatus(this.prisma, organizationId, order.id);
      return invoice;
    } catch (e) {
      await release(null).catch(() => undefined);
      throw e;
    }
  }

  /**
   * "Create invoice" for what is left on an order (POST /orders/:id/invoice-remaining). Round 36 (2026-11-19): an AIMS
   * order of an org with invoicing per order (enableWctOrderInvoice) takes it too (invoiceNativeOrderRemainder); an
   * imported order as before. The number is never typed: the org's next INV number (createOrderInvoice). A `number`
   * sent by an older page is ignored.
   */
  async invoiceImportedOrderRemainder(orderId: string, organizationId: string, body: { number?: string | null; lines?: Array<{ description?: string; quantity?: unknown; unitPrice?: unknown }> | null } = {}) {
    const edited = editedInvoiceLines(body?.lines);
    const head: any = await this.prisma.order.findFirst({ where: { id: orderId, organizationId }, select: { id: true, linkedDocuments: true } });
    if (head && !isImportedOrder(head) && (await isOrgFeatureEnabled(this.prisma as any, organizationId, WCT_ORDER_INVOICE_FLAG))) {
      return this.invoiceNativeOrderRemainder(orderId, organizationId, edited);
    }
    return this.invoiceImportedRemainder(orderId, organizationId, edited);
  }

  /**
   * Imported orders (2026-11-19): "Create invoice" on a PART BILLED imported order. A NATIVE draft invoice (normal
   * INV numbering; posts per postInvoicesOnConfirm once confirmed) for what is left on the quotation
   * (imported-remaining.ts: the remaining qty per quotation line plus its $0 description lines, else one line for
   * the remaining amount), header from the quotation (customer, addresses, attention, subject, salesperson), GST at
   * the org's current rate when the quotation charged GST. No DO. Linked to the order (linkedDocuments.invoice,
   * native) and the order's status re-read. The imported quotation and invoices are never written. Round 19: on any
   * imported order (Paid, Invoiced, Complete too; the dialog then sends the quotation's lines, edited). Refused when
   * the order already has a draft AIMS invoice made on it (open that one). Round 36: the org's next INV number
   * (createOrderInvoice, never a -02 suffix), and one Create invoice at a time per order (a claim on the order).
   */
  private async invoiceImportedRemainder(orderId: string, organizationId: string, edited: EditedInvoiceLine[] | null) {
    if (!(await isImportedOrdersEnabled(this.prisma as any, organizationId))) throw new HttpException('Order not found', HttpStatus.NOT_FOUND);
    const { order, invoiceConfig, claim } = await this.prisma.$transaction(
      async (tx) => {
        await tx.$executeRawUnsafe('SELECT pg_advisory_xact_lock(hashtext($1))', `order-invoice:${orderId}`);
        const order = await tx.order.findFirst({ where: { id: orderId, organizationId }, select: { id: true, orderNumber: true, linkedDocuments: true, sourceQuotationId: true } });
        if (!order) throw new HttpException('Order not found', HttpStatus.NOT_FOUND);
        if (!isImportedOrder(order)) throw new HttpException('Create invoice here is for orders imported from the old ERP', HttpStatus.BAD_REQUEST);
        const m: any = importedMarkerOf(order) || {};
        const qo = order.sourceQuotationId ? await tx.document.findFirst({ where: { id: order.sourceQuotationId, organizationId }, select: { id: true, name: true, config: true } }) : null;
        if (!qo) throw new HttpException('This order has no quotation to invoice from.', HttpStatus.BAD_REQUEST);
        const qc: any = qo.config || {};
        // Round 19: any status (Paid, Invoiced, Complete...); everything on the order counts (linked quotations and
        // invoices, split parts). One draft made on the order at a time: open that one.
        const inputs = (await loadImportedOrderInputs(tx, organizationId, [order], { sourceQuotationConfigs: new Map([[qo.id, qc]]) })).get(order.id)!;
        const docs: any[] = inputs.invoiceDocs;
        const draft = importedOrderDraftInvoice(docs, order.id);
        if (draft) throw new HttpException(`This order already has a draft invoice (${draft.name ?? 'draft'}). Open it to finish it.`, HttpStatus.BAD_REQUEST);
        const st = importedStatusFrom(order, inputs);
        const allItems = [...(Array.isArray(qc.items) ? qc.items : []), ...inputs.linkedQuotations.flatMap((d: any) => (Array.isArray(d.config?.items) ? d.config.items : []))];
        const plan = remainingForOrder({ marker: m, invoiceDocs: docs, quotation: { name: qo.name, config: { ...qc, items: allItems } }, quoteTotal: st.quoteTotal, billed: st.billed });
        if (!edited && !plan.lines.some((l) => l.priced && l.amount > 0)) throw new HttpException('Nothing left to bill on this order: give the lines to bill.', HttpStatus.BAD_REQUEST);
        const sourceLines = edited ?? plan.lines.map((l) => ({ description: l.description, quantity: l.quantity, unitPrice: l.unitPrice }));

        // Tax: the org's current rate when the quotation charged GST; none when it did not ("(NG)" / non-GST).
        const orgRow: any = await tx.organization.findUnique({ where: { id: organizationId }, select: { taxRate: true } }).catch(() => null);
        const quoteHasGst = (Number(qc.gstPercent) || 0) > 0 || Math.abs((Number(qc.gstAmount) || 0)) > 0.005;
        const rate = quoteHasGst ? Number(orgRow?.taxRate ?? 9) : 0;
        const taxSrc = { gstPercent: rate, taxApplicable: rate > 0 ? 'Y' : 'N', absorbTax: 'N' };
        // 2026-11-23: each line that is a quotation line keeps its item code, UOM, account and revenue tag (as on AIMS orders).
        const items = remainderInvoiceItems(sourceLines, rate, allItems);
        const totals = computeDocumentTotals(items, taxSrc);
        const reference = orderInvoiceReference(order.orderNumber, [], qc.referenceNo ?? qc.subject ?? null);
        // Header: the quotation's customer side only (never its ERP marker, numbers, totals or money keys).
        const pick = (k: string) => (qc[k] === undefined ? {} : { [k]: qc[k] });
        const header = {
          ...pick('company'), ...pick('gstRegNo'), ...pick('footerMessage'), ...pick('currency'),
          ...pick('customerId'), ...pick('customerCode'), ...pick('customerName'), ...pick('customerEmail'), ...pick('customerAddress'),
          ...pick('billTo'), ...pick('location'), ...pick('deliveryTo'), ...pick('attention'), ...pick('contact'),
          ...pick('subject'), ...pick('salesPerson'), ...pick('salesMobile'), ...pick('termsAndConditions'),
        };
        const date = await orgTodayFor(this.prisma, organizationId);
        const invoiceConfig = stampDocumentMoney(
          {
            ...header,
            items,
            date,
            dueDate: date,
            sourceDocumentId: qo.id,
            sourceDocumentType: 'QUOTATION',
            ...(qo.name ? { sourceDocumentNumber: qo.name } : {}),
            orderId: order.id,
            orderNo: order.orderNumber,
            importedOrderRemainder: { matched: plan.matched, reason: plan.reason, remainingGross: plan.remainingGross, edited: !!edited },
            referenceNo: reference,
            ...totals,
            showTotals: true,
            documentInfo: { ...totals, referenceNo: reference },
          },
          { gross: totals.nettTotal, outstanding: totals.nettTotal, paid: 0 },
        );
        const claim = await claimOrderInvoice(tx, order);
        return { order, invoiceConfig, claim };
      },
      { timeout: 30000 },
    );
    let invoice: any;
    try {
      invoice = await this.createOrderInvoice(organizationId, invoiceConfig);
    } catch (e) {
      await this.releaseOrderInvoiceClaim(organizationId, order.id, claim, null).catch(() => undefined);
      throw e;
    }
    // Link on the order (re-read under the lock so a parallel write is kept) and drop this run's claim.
    await this.releaseOrderInvoiceClaim(organizationId, order.id, claim, { id: invoice.id, name: invoice.name ?? null, templateId: invoice.documentTemplateId, total: (invoiceConfig as any).nettTotal, native: true });
    console.log(`🧾 IMPORTED ORDER→INVOICE: ${invoice.name} for ${order.orderNumber} (what is left on the quotation)`);
    await this.repostGlForDocument(organizationId, invoice.id, 'INVOICE', invoiceConfig, invoice.name).catch((e: any) =>
      console.warn(`IMPORTED ORDER→INVOICE: GL post for ${invoice.name} skipped: ${e?.message}`),
    );
    await refreshImportedOrderStatus(this.prisma as any, organizationId, order.id);
    return invoice;
  }

  /**
   * Round 36 (WCT group, 2026-11-19): "Create invoice" for what is left on an AIMS order, while its invoices (not
   * draft, not voided, credit notes taken off) bill less than the quotation total. Offered exactly when the order
   * page offers it (OrdersService.nativeInvoiceRemainder reads the page). A draft invoice for the lines the office
   * confirmed in the dialog (prefilled with what is left: imported-remaining.ts), header from the order's first DO
   * else the quotation (as the invoice made from the quotation), tax as the quotation's, the org's next INV number.
   * Linked on the order (linkedDocuments.invoice, remainder: true, and the order's invoice); one at a time per order.
   * Posts per postInvoicesOnConfirm as every order invoice. Activity Log: the HTTP row (invoice-remaining, CREATE).
   */
  private async invoiceNativeOrderRemainder(orderId: string, organizationId: string, edited: EditedInvoiceLine[] | null) {
    const { order, claim } = await this.prisma.$transaction(
      async (tx: any) => {
        await tx.$executeRawUnsafe('SELECT pg_advisory_xact_lock(hashtext($1))', `order-invoice:${orderId}`);
        const order = await tx.order.findFirst({ where: { id: orderId, organizationId }, select: { id: true, orderNumber: true, status: true, sourceQuotationId: true, linkedDocuments: true } });
        if (!order) throw new HttpException('Order not found', HttpStatus.NOT_FOUND);
        if (order.status === 'CANCELLED') throw new HttpException('This order is cancelled', HttpStatus.BAD_REQUEST);
        return { order, claim: await claimOrderInvoice(tx, order) };
      },
      { timeout: 30000 },
    );
    let invoice: any = null;
    let invoiceConfig: any = null;
    try {
      const plan = await this.ordersService.nativeInvoiceRemainder(order.id, organizationId);
      if (plan.draft) throw new HttpException(`This order already has a draft invoice (${plan.draft.name ?? 'draft'}). Open it to finish it.`, HttpStatus.BAD_REQUEST);
      if (!plan.canInvoiceRemaining) throw new HttpException('Nothing left to bill on this order: its invoices already reach the quotation total.', HttpStatus.BAD_REQUEST);
      const qo = order.sourceQuotationId ? await this.prisma.document.findFirst({ where: { id: order.sourceQuotationId, organizationId }, select: { id: true, name: true, config: true } }) : null;
      if (!qo) throw new HttpException('This order has no quotation to invoice from.', HttpStatus.BAD_REQUEST);
      const qc: any = qo.config || {};
      const lines = edited ?? plan.invoiceLines.map((l) => ({ description: l.description, quantity: l.quantity, unitPrice: l.unitPrice }));
      if (!lines.some((l) => l.quantity * l.unitPrice > 0)) throw new HttpException('Nothing left to bill on this order: give the lines to bill.', HttpStatus.BAD_REQUEST);
      // Header: the order's first live DO (made from this quotation), else the quotation; as the invoice from the quotation.
      const dos = (await this.deliveriesService.orderDos(organizationId, order.id)).filter((d: any) => (d.config as any)?.cancelled !== true);
      const headerSrc: any = (dos[0]?.config as any) ?? qc;
      const {
        documentNumber: _n, savedAt: _sa, savedBy: _sb, lastUsedAt: _la, lastUsedBy: _lb, confirmedAt: _ca, stockDeducted: _sd,
        signature: _sg, signedAt: _st, signedByName: _sn, dueDate: _dd, columnLabels: _cl, tableColumnOrder: _tco, internalColumns: _ic,
        issuedOnSchedule: _is, cancelled: _cn, cancelledAt: _cat, cancelledReason: _cr, items: _it, orderInvoiceId: _oi, awaitingSignature: _aw,
        discountAmount: _da, discountPercent: _dp, erpImport: _ei,
        ...base
      } = (headerSrc ?? {}) as Record<string, any>;
      let taxSrc: any = { gstPercent: qc.gstPercent ?? qc.documentInfo?.gstPercent, taxApplicable: qc.taxApplicable ?? qc.documentInfo?.taxApplicable, absorbTax: qc.absorbTax ?? qc.documentInfo?.absorbTax };
      if (taxSrc.gstPercent == null && taxSrc.taxApplicable == null && taxSrc.absorbTax == null) {
        const orgRow: any = await this.prisma.organization.findUnique({ where: { id: organizationId }, select: { taxRate: true, taxApplicable: true } }).catch(() => null);
        taxSrc = { gstPercent: orgRow?.taxRate ?? 9, taxApplicable: orgRow?.taxApplicable === false ? 'N' : 'Y', absorbTax: 'N' };
      }
      const rate = String(taxSrc.taxApplicable ?? 'Y').toUpperCase() === 'N' ? 0 : Number(taxSrc.gstPercent) || 0;
      // A line that is a quotation line keeps that line's item code, unit and account (the office may have edited qty / price).
      const quoteLines: any[] = Array.isArray(qc.items) ? qc.items.filter((l: any) => !isDisplayRow(l)) : [];
      const items = remainderInvoiceItems(lines, rate, quoteLines);
      const totals = computeDocumentTotals(items, taxSrc);
      const doNumbers = dos.map((d: any) => d.name).filter(Boolean) as string[];
      const reference = orderInvoiceReference(order.orderNumber, doNumbers, (base as any).referenceNo ?? (base as any).documentInfo?.referenceNo);
      invoiceConfig = stampDocumentMoney(
        {
          ...base,
          items,
          date: await orgTodayFor(this.prisma, organizationId),
          sourceDocumentId: qo.id,
          sourceDocumentType: 'QUOTATION',
          ...(qo.name ? { sourceDocumentNumber: qo.name } : {}),
          orderId: order.id,
          orderNo: order.orderNumber,
          orderJobIds: [],
          deliveryOrderNos: doNumbers,
          orderRemainder: { remainingGross: plan.summary?.remaining?.remainingGross ?? null, matched: plan.summary?.remaining?.matched ?? null, edited: !!edited },
          referenceNo: reference,
          ...totals,
          showTotals: true,
          documentInfo: { ...((base as any).documentInfo || {}), ...totals, referenceNo: reference },
        },
        { gross: totals.nettTotal, outstanding: totals.nettTotal, paid: 0 },
      );
      invoice = await this.createOrderInvoice(organizationId, invoiceConfig, (dos[0] as any)?.projectId ?? undefined);
    } catch (e) {
      await this.releaseOrderInvoiceClaim(organizationId, order.id, claim, null).catch(() => undefined);
      throw e;
    }
    await this.releaseOrderInvoiceClaim(organizationId, order.id, claim, { id: invoice.id, name: invoice.name ?? null, jobIds: [], remainder: true }, { setOrderInvoice: true });
    console.log(`🧾 ORDER→INVOICE: ${invoice.name} for ${order.orderNumber} (what is left on the quotation)`);
    await this.repostGlForDocument(organizationId, invoice.id, 'INVOICE', invoiceConfig, invoice.name).catch((e: any) =>
      console.warn(`ORDER→INVOICE: GL post for ${invoice.name} skipped: ${e?.message}`),
    );
    await refreshOrderStatus(this.prisma, organizationId, order.id);
    return invoice;
  }

  /** Drop this run's Create invoice claim on the order and, when the invoice was made, add it to the order's links (under the order lock). */
  private async releaseOrderInvoiceClaim(organizationId: string, orderId: string, claim: { id: string }, entry: Record<string, unknown> | null, opts: { setOrderInvoice?: boolean } = {}) {
    await this.prisma.$transaction(async (tx: any) => {
      await tx.$executeRawUnsafe('SELECT pg_advisory_xact_lock(hashtext($1))', `order-invoice:${orderId}`);
      const fresh = await tx.order.findFirst({ where: { id: orderId, organizationId }, select: { linkedDocuments: true } });
      const { invoiceClaim, ...rest }: any = (fresh?.linkedDocuments as any) || {};
      const next: any = invoiceClaim && invoiceClaim.id !== claim.id ? { ...rest, invoiceClaim } : rest;
      if (entry) next.invoice = [...(Array.isArray(next.invoice) ? next.invoice : []), entry];
      await tx.order.update({ where: { id: orderId }, data: { linkedDocuments: next, ...(entry && opts.setOrderInvoice ? { invoiceDocumentId: entry.id as string } : {}) } });
    });
  }

  /**
   * Price a DO→INVOICE's goods lines from the asset — rate x quantity, no
   * duration. Intent (rental vs sale) per line comes from the config line's
   * deploymentType (set by createDoFromDelivery) or the unit's active
   * ProjectDeployment.type, defaulting to RENTAL (a delivered unit is a rental).
   *   • SALE   → Asset.price
   *   • RENTAL → Asset.customPrices "Monthly Rental" (14 assets) with a
   *              rental/hire label fallback ("Rental Price" outlier, etc.)
   * NO GUESSING: when the asset has no matching price the line stays 0 for the
   * office to fill on the still-editable DRAFT. Non-goods lines (remarks, no
   * asset/unit) are left untouched. The DO's own lines stay 0 (goods-only).
   */
  private async priceInvoiceLinesFromAsset(
    items: any[],
    organizationId: string,
    links?: { saleOrderId?: string; sourceDocumentId?: string; sourceDocumentType?: string },
  ): Promise<any[]> {
    if (!items.length) return items;
    const saleOrderId = links?.saleOrderId;
    // Sales Order agreed prices — HIGHEST priority source (2026-09-22, per the
    // SO→invoice pricing handoff). Rules, deliberately strict:
    //   • match invoice line → SO line on itemCode (= Asset.skuKey), exact,
    //     case-insensitive, trimmed — NEVER on description;
    //   • a code that appears on more than one SO line is AMBIGUOUS → skipped;
    //   • take unitPrice and recompute — never copy the SO's amount (the two
    //     sides disagree about what quantity counts: months vs units);
    //   • no SO line for an item → fall through to the asset price, not to 0.
    const buildCodeMap = (doc: { config: any } | null): Map<string, any> => {
      const map = new Map<string, any>();
      const lines: any[] = Array.isArray((doc?.config as any)?.items) ? (doc!.config as any).items : [];
      const seen = new Map<string, number>();
      for (const line of lines) {
        const code = String(line?.itemCode ?? '').trim().toLowerCase();
        if (!code) continue;
        seen.set(code, (seen.get(code) || 0) + 1);
      }
      for (const line of lines) {
        const code = String(line?.itemCode ?? '').trim().toLowerCase();
        if (!code || seen.get(code)! > 1) continue; // ambiguous → unusable
        if (line?.unitPrice == null || isNaN(Number(line.unitPrice))) continue;
        map.set(code, line);
      }
      return map;
    };
    // Identity match, tried BEFORE the code match (guru 2026-09-28). Codes are
    // typed by hand and drift: QO202609-0086 priced "AIS4260" while the DO line
    // carried the asset's own skuKey "AIS", so the agreed $400 never reached
    // the invoice and it silently fell back to the asset rate. Both sides are
    // normalised to an ASSET id first: a quotation line stores the Asset id in
    // `inventoryItemId` (a product-level pick), while a delivery-built line
    // stores the Inventory UNIT id there and the Asset id in `assetId`.
    // Same strictness as the code map: an asset on 2+ lines is ambiguous and
    // unusable, and a line without a usable unitPrice is skipped.
    const buildAssetMap = async (doc: { config: any } | null): Promise<Map<string, any>> => {
      const map = new Map<string, any>();
      const lines: any[] = Array.isArray((doc?.config as any)?.items) ? (doc!.config as any).items : [];
      const candidates = [
        ...new Set(
          lines
            .flatMap((l) => [l?.assetId, l?.inventoryItemId])
            .filter((v): v is string => typeof v === 'string' && !!v),
        ),
      ];
      if (!candidates.length) return map;
      const [assetRows, invRows] = await Promise.all([
        this.prisma.asset.findMany({ where: { id: { in: candidates }, organizationId }, select: { id: true } }),
        this.prisma.inventory.findMany({ where: { id: { in: candidates } }, select: { id: true, assetId: true } }),
      ]);
      const isAsset = new Set(assetRows.map((a) => a.id));
      const invToAsset = new Map(invRows.map((i) => [i.id, i.assetId]));
      const resolve = (l: any): string | null => {
        for (const v of [l?.assetId, l?.inventoryItemId]) {
          if (typeof v !== 'string' || !v) continue;
          if (isAsset.has(v)) return v;
          const viaUnit = invToAsset.get(v);
          if (viaUnit) return viaUnit;
        }
        return null;
      };
      const seen = new Map<string, number>();
      for (const l of lines) {
        const a = resolve(l);
        if (a) seen.set(a, (seen.get(a) || 0) + 1);
      }
      for (const l of lines) {
        const a = resolve(l);
        if (!a || seen.get(a)! > 1) continue; // ambiguous → unusable
        if (l?.unitPrice == null || isNaN(Number(l.unitPrice))) continue;
        map.set(a, l);
      }
      return map;
    };
    // Sales Order beats Quotation beats asset (guru 2026-09-22). The attached
    // doc id is accepted as either type — the schedule dialog may attach a
    // quotation; type decides which tier its prices land in.
    let soLineByCode = new Map<string, any>();
    let qoLineByCode = new Map<string, any>();
    let soLineByAsset = new Map<string, any>();
    let qoLineByAsset = new Map<string, any>();
    if (saleOrderId) {
      const attached = await this.prisma.document.findFirst({
        where: { id: saleOrderId, organizationId, type: { in: ['SALES_ORDER', 'QUOTATION'] } },
        select: { type: true, config: true },
      });
      if (attached?.type === 'SALES_ORDER') {
        soLineByCode = buildCodeMap(attached);
        soLineByAsset = await buildAssetMap(attached);
      } else if (attached) {
        qoLineByCode = buildCodeMap(attached);
        qoLineByAsset = await buildAssetMap(attached);
      }
    }
    if (
      qoLineByCode.size === 0 &&
      qoLineByAsset.size === 0 &&
      links?.sourceDocumentId &&
      String(links.sourceDocumentType || '').toUpperCase().includes('QUOTATION')
    ) {
      const qo = await this.prisma.document.findFirst({
        where: { id: links.sourceDocumentId, organizationId, type: 'QUOTATION' },
        select: { type: true, config: true },
      });
      if (qo) {
        qoLineByCode = buildCodeMap(qo);
        qoLineByAsset = await buildAssetMap(qo);
      }
    }
    const unitIds = [...new Set(items.map((i) => i.inventoryItemId).filter((v): v is string => !!v))];
    const units = unitIds.length
      ? await this.prisma.inventory.findMany({ where: { id: { in: unitIds } }, select: { id: true, assetId: true } })
      : [];
    const unitAsset = new Map(units.map((u) => [u.id, u.assetId]));
    // Commercial intent per unit, read off its deployment. The OPEN assignment
    // wins; a CLOSED one is the fallback, newest first.
    //
    // The fallback is load-bearing since off-hire began closing assignments:
    // convert-to-sale now off-hires, which closes the sold unit's assignment,
    // and an open-only lookup would find nothing and silently fall back to the
    // RENTAL default. That would price a sold unit at its monthly rental rate
    // instead of its sale price (on the ZZTEST asset, 500 instead of 5000).
    // Reading Inventory.status === 'sold' would also work, but it conflates
    // stock state with commercial intent and says nothing about a unit that is
    // back in stock, so the deployment stays the single source of truth.
    const deploys = unitIds.length
      ? await this.prisma.assignment.findMany({
          where: { inventoryId: { in: unitIds }, projectDeploymentId: { not: null } },
          orderBy: { startDate: 'desc' },
          select: {
            inventoryId: true,
            endDate: true,
            projectDeployment: { select: { type: true } },
          },
        })
      : [];
    const unitDeploy = new Map<string, string>();
    // Pass 1: open assignments (today's behaviour, unchanged).
    for (const a of deploys) {
      if (a.endDate) continue;
      if (a.inventoryId && a.projectDeployment && !unitDeploy.has(a.inventoryId)) {
        unitDeploy.set(a.inventoryId, a.projectDeployment.type);
      }
    }
    // Pass 2: newest closed assignment, only for units with no open one.
    for (const a of deploys) {
      if (a.inventoryId && a.projectDeployment && !unitDeploy.has(a.inventoryId)) {
        unitDeploy.set(a.inventoryId, a.projectDeployment.type);
      }
    }
    const assetIds = [
      ...new Set(items.map((i) => i.assetId || (i.inventoryItemId ? unitAsset.get(i.inventoryItemId) : null)).filter((v): v is string => !!v)),
    ];
    const assets = assetIds.length
      ? await this.prisma.asset.findMany({ where: { id: { in: assetIds }, organizationId }, select: { id: true, price: true, customPrices: true } })
      : [];
    const assetById = new Map(assets.map((a) => [a.id, a]));

    // Label variance: prefer "Monthly Rental" (the 14), then any rental/hire label.
    const rentalRate = (cp: any): number | null => {
      const arr = Array.isArray(cp) ? cp : [];
      const e = arr.find((x) => /monthly\s*rental/i.test(x?.label || '')) ?? arr.find((x) => /rental|hire/i.test(x?.label || ''));
      const v = e?.value;
      if (typeof v === 'number') return v;
      return v != null && !isNaN(Number(v)) ? Number(v) : null;
    };

    return items.map((it) => {
      const qty = Number(it.quantity) || 1;
      const assetId: string | null = it.assetId || (it.inventoryItemId ? unitAsset.get(it.inventoryItemId) ?? null : null);
      // 1) Sales Order / Quotation agreed price. Identity (same Asset) is tried
      //    before the typed code, and SALES_ORDER still outranks QUOTATION.
      const lineCode = String(it.skuKey ?? it.itemCode ?? '').trim().toLowerCase();
      const fromSalesOrder =
        (assetId ? soLineByAsset.has(assetId) : false) || (lineCode ? soLineByCode.has(lineCode) : false);
      const agreed =
        (assetId ? soLineByAsset.get(assetId) : undefined) ??
        (lineCode ? soLineByCode.get(lineCode) : undefined) ??
        (assetId ? qoLineByAsset.get(assetId) : undefined) ??
        (lineCode ? qoLineByCode.get(lineCode) : undefined);
      if (agreed) {
        const unitPrice = Number(agreed.unitPrice);
        const amount = Math.round(unitPrice * qty * 100) / 100;
        // recompute from unitPrice — the source doc's own amount counts a
        // different quantity (e.g. months of hire vs units delivered).
        const pricedFrom = fromSalesOrder ? 'SALES_ORDER' : 'QUOTATION';
        return { ...it, unitPrice, price: unitPrice, amount, pricedFrom };
      }
      // 2) Asset price (today's behaviour).
      const asset = assetId ? assetById.get(assetId) : null;
      if (!asset) return it; // non-goods / unresolved → leave as-is (0)
      const intent = it.deploymentType || (it.inventoryItemId ? unitDeploy.get(it.inventoryItemId) : null) || 'RENTAL';
      const unitPrice =
        intent === 'SALE'
          ? typeof asset.price === 'number'
            ? asset.price
            : 0
          : rentalRate(asset.customPrices) ?? 0;
      const amount = Math.round(unitPrice * qty * 100) / 100;
      return { ...it, unitPrice, price: unitPrice, amount, ...(unitPrice ? { pricedFrom: 'ASSET' } : {}) };
    });
  }

  /**
   * Resolve exactly ONE template id for a type, mirroring createFromExtraction's
   * priority: active selection (primary → isDefault → newest among selected),
   * else the cross-org default / org's own default-active-newest.
   */
  async resolveTemplateIdForType(type: string, organizationId: string): Promise<string> {
    const selections = await this.prisma.organizationActiveTemplate.findMany({
      where: { organizationId, type },
    });
    if (selections.length > 0) {
      const primary = selections.find((s) => s.isPrimary);
      if (primary) return primary.templateId;
      const sel = await this.prisma.documentTemplate.findFirst({
        where: { id: { in: selections.map((s) => s.templateId) } },
        select: { id: true },
        orderBy: [{ isDefault: 'desc' }, { createdAt: 'desc' }],
      });
      return sel?.id ?? selections[0].templateId;
    }
    // Org's own active template first; seeded cross-org standard only when the
    // org has nothing of its own (consistent with the create picker's fallback).
    const tmpl =
      (await this.prisma.documentTemplate.findFirst({
        where: { type, organizationId, isActive: true },
        select: { id: true },
        orderBy: [{ createdAt: 'desc' }],
      })) ??
      (await this.prisma.documentTemplate.findFirst({
        where: { OR: [{ type, isDefault: true }, { type, organizationId }] },
        select: { id: true },
        orderBy: [{ isDefault: 'desc' }, { createdAt: 'desc' }],
      }));
    if (!tmpl) {
      throw new HttpException(`No document template found for type ${type}`, HttpStatus.NOT_FOUND);
    }
    return tmpl.id;
  }

  /**
   * Office BULK-COMPLETE (Phase 4b) — required for non-taggable items the field
   * can't scan. Marks every deliverable item on the DO → completed, deducting
   * each via the SAME idempotent per-item path (deductedAt guards double-deduct
   * for items already scanned). Service items are skipped. Then the completion
   * gate fires → DO completes → invoice.
   */
  async bulkCompleteDeliveryOrder(documentId: string, organizationId: string) {
    const document = await this.prisma.document.findFirst({
      where: { id: documentId, organizationId },
      select: { id: true, name: true, type: true, config: true },
    });
    assertNotErpImportedDo(document);
    if (!document) {
      throw new HttpException('Document not found', HttpStatus.NOT_FOUND);
    }
    if (document.type !== 'DO' && document.type !== 'DELIVERY_ORDER') {
      throw new HttpException('This endpoint is only for Delivery Orders', HttpStatus.BAD_REQUEST);
    }

    // A DO whose field run is still going must be finished in the field, not
    // bulk-completed here (2026-09 partial sign-off). The completion gate below
    // only sees this DO's DocumentItem rows, and a free-typed line has none, so
    // a partly signed run could otherwise look "all done" and fire the invoice
    // while items are still undelivered. Checked on the RUN's own items, which
    // cover free-typed lines too. Cancelled runs are ignored.
    const owed = await this.prisma.deliveryItem.findMany({
      where: {
        documentId,
        deliveryStatus: { not: DeliveryStatus.completed },
        delivery: { status: { not: 'cancelled' } },
      },
      select: { delivery: { select: { deliveryNumber: true } } },
    });
    if (owed.length) {
      const runs = [...new Set(owed.map((o) => o.delivery.deliveryNumber))].sort((a, b) => a - b);
      throw new HttpException(
        `Delivery ${runs.map((n) => `#${n}`).join(', ')} still has ${owed.length} ${owed.length === 1 ? 'item' : 'items'} ` +
          `to deliver or sign for. Finish ${runs.length === 1 ? 'that delivery' : 'those deliveries'} in the field app ` +
          `before completing this Delivery Order.`,
        HttpStatus.BAD_REQUEST,
      );
    }

    const items = await this.prisma.documentItem.findMany({ where: { documentId } });
    let deductedCount = 0;
    for (const item of items) {
      if (item.isService) continue; // services aren't delivered/deducted
      const didDeduct = await this.deductDocumentItemStock(
        item,
        documentId,
        document.name,
        organizationId,
      );
      if (didDeduct) deductedCount++;
      if (item.deliveryStatus !== DeliveryStatus.completed) {
        await this.prisma.documentItem.update({
          where: { id: item.id },
          data: { deliveryStatus: DeliveryStatus.completed, completedAt: new Date() },
        });
      }
      // Dual-advance bridge (U1+items): mirror the completion onto the unit's
      // open-run DeliveryItem so the run fold completes too. Unit rows only;
      // best-effort — a mirror failure never affects the bulk completion.
      const unitId = item.itemType === ItemType.INVENTORY ? item.inventoryId ?? item.itemId : item.inventoryId;
      if (unitId) {
        await this.mirrorRunItemAdvance(documentId, unitId, 'install').catch((err) =>
          console.warn(`bulk-complete: run mirror failed for unit ${unitId}: ${err?.message}`),
        );
      }
    }

    await this.maybeCompleteDeliveryOrderAndInvoice(documentId, organizationId);

    return {
      success: true,
      message: 'Delivery Order bulk-completed',
      itemCount: items.length,
      deductedCount,
    };
  }

  /**
   * Confirm a Delivery Order and always deduct stock
   * DO confirmation always triggers stock deduction
   */
  async confirmDeliveryOrder(
    documentId: string,
    confirmData: { fromDONo: string; toDONo: string },
    organizationId: string,
    actor?: DocumentActor,
  ) {
    try {
      console.log('📦 DO CONFIRM: Starting confirmation for document:', documentId);

      // Get the document
      const document = await this.prisma.document.findFirst({
        where: {
          id: documentId,
          organizationId,
        },
      });

      if (!document) {
        throw new HttpException('Document not found', HttpStatus.NOT_FOUND);
      }
      assertNotErpImportedDo(document);
      this.assertHasLineItems((document as any).config, 'delivery order');

      // Validate it's a Delivery Order
      if (document.type !== 'DO' && document.type !== 'DELIVERY_ORDER') {
        throw new HttpException(
          'This endpoint is only for Delivery Orders',
          HttpStatus.BAD_REQUEST
        );
      }

      // Confirming a DO no longer deducts stock. Deduction happens ONLY per-item:
      // on Acknowledge (advanceDeliveryItem action==='ack') and via bulk-complete
      // — so an item that was never delivered is never deducted. The idempotent
      // deductedAt guard on deductDocumentItemStock still protects those paths.
      const config: any = document.config;

      // Update document with confirmation data and set status to confirmed
      const updatedConfig = {
        ...config,
        fromDONo: confirmData.fromDONo,
        toDONo: confirmData.toDONo,
        confirmedAt: new Date().toISOString(),
        // Confirm no longer deducts — stock deducts per-item on delivery.
        stockDeducted: false,
      };

      const updatedDocument = await this.prisma.document.update({
        where: {
          id: documentId,
          organizationId,
        },
        data: {
          config: updatedConfig,
          status: 'confirmed',
        },
      });

      // Any journals born while this document was unconfirmed flip now.
      await this.journalService.markConfirmedForDocument(organizationId, documentId).catch(() => undefined);

      // Draft-DO commitment (delivery-first #5) — this endpoint is the
      // editor's ACTUAL "Confirm Delivery Order" button and updates status
      // directly, so the updateDocument confirm hook never sees it. Without
      // this call a delivery-created draft DO would confirm with no stamp, no
      // deduction and no status mirror (silent stock loss — E2E finding 1).
      // Idempotent + best-effort, same contract as the updateDocument hook.
      await this.commitLinkedDeliveryItems(documentId, organizationId).catch((err) =>
        console.warn(`commitLinkedDeliveryItems on confirm-do failed for ${documentId}: ${err?.message}`),
      );

      console.log('✅ DO CONFIRM: Document confirmed successfully');

      void this.logDocumentEvent({
        documentId,
        organizationId,
        action: 'APPROVED',
        detail: `${updatedDocument.name || confirmData.toDONo} confirmed`,
        documentName: updatedDocument.name || confirmData.toDONo,
        actor,
      });

      return {
        success: true,
        document: updatedDocument,
        stockDeducted: false,
        message: 'Delivery Order confirmed',
      };
    } catch (error) {
      console.error('❌ DO CONFIRM: Error:', error);
      throw new HttpException(
        error.message || 'Failed to confirm Delivery Order',
        error.status || HttpStatus.INTERNAL_SERVER_ERROR
      );
    }
  }

  /**
   * Confirm an Invoice document.
   * Stock deduction occurs only if the invoice was NOT extracted from a DO (standalone invoice)
   */
  async confirmInvoice(
    documentId: string,
    confirmData: { fromInvoiceNo: string; toInvoiceNo: string },
    organizationId: string,
    actor?: DocumentActor,
  ) {
    try {
      console.log('🧾 INVOICE CONFIRM: Starting confirmation for document:', documentId);

      // Get the document
      const document = await this.prisma.document.findFirst({
        where: {
          id: documentId,
          organizationId,
        },
      });

      if (!document) {
        throw new HttpException('Document not found', HttpStatus.NOT_FOUND);
      }
      assertRecordUnlocked(document, 'confirmed');
      assertNotVoided(document, 'confirmed');
      await assertPeriodOpen(this.prisma, { organizationId, date: documentDay(document.config, document.createdAt), actorId: actor?.id, what: document.name || 'This invoice', verb: 'confirmed' });
      this.assertHasLineItems((document as any).config, 'invoice');
      this.assertHasCustomer((document as any).config, (document as any).type, 'invoice');

      // Validate it's an Invoice
      const invoiceTypes = ['INVOICE', 'TI', 'TI2'];
      if (!invoiceTypes.includes(document.type)) {
        throw new HttpException(
          'This endpoint is only for Invoices',
          HttpStatus.BAD_REQUEST
        );
      }

      // Get items from document config
      const config: any = document.config;
      const items = config?.items || [];
      console.log('🧾 INVOICE CONFIRM: Processing', items.length, 'items');

      // Check if invoice was extracted from a DO (has sourceDocumentId in config or baseDocumentId)
      const sourceDocumentId = config?.sourceDocumentId || document.baseDocumentId;
      const isExtractedFromDO = !!sourceDocumentId;
      console.log('🧾 INVOICE CONFIRM: Source document ID:', sourceDocumentId);
      console.log('🧾 INVOICE CONFIRM: Is extracted from DO:', isExtractedFromDO);

      // Only deduct stock if invoice was NOT extracted from a DO (standalone invoice)
      // If extracted from DO, stock was already deducted when DO was confirmed
      const shouldDeductStock = !isExtractedFromDO;

      if (shouldDeductStock) {
        console.log('🧾 INVOICE CONFIRM: Deducting stock (standalone invoice, not extracted from DO)');

        await Promise.all(
          items.map(async (item: any) => {
            if (!item.inventoryItemId) {
              console.warn('⚠️ INVOICE CONFIRM: Item missing inventoryItemId, skipping');
              return;
            }

            const quantity = parseFloat(item.quantity) || 0;
            if (quantity <= 0) {
              console.warn('⚠️ INVOICE CONFIRM: Item has no quantity, skipping:', item.inventoryItemId);
              return;
            }

            // Try to find in Inventory table first (Asset Tracking Mode ON)
            let inventory = await this.prisma.inventory.findUnique({
              where: { id: item.inventoryItemId },
            });

            if (inventory) {
              // Deduct from inventory quantity
              const currentQty = inventory.quantity || 0;
              const newQty = Math.max(0, currentQty - quantity); // Don't go below 0

              await this.prisma.inventory.update({
                where: { id: item.inventoryItemId },
                data: { quantity: newQty },
              });

              console.log(`✅ INVOICE CONFIRM: Updated inventory ${item.inventoryItemId}: ${currentQty} - ${quantity} = ${newQty}`);

              // Create timeline entry for the stock deduction
              await this.prisma.timelineItem.create({
                data: {
                  message: `Stock deducted: ${quantity} units for Invoice ${document.name || documentId.substring(0, 8)}`,
                  inventoryId: item.inventoryItemId,
                  documentId: documentId,
                  pdfUrl: null,
                },
              });
            } else {
              // Try to find in Asset table (Products Mode - Asset Tracking OFF)
              const asset = await this.prisma.asset.findUnique({
                where: { id: item.inventoryItemId },
              });

              if (asset) {
                // Deduct from asset quantity
                const currentQty = asset.quantity || 0;
                const newQty = Math.max(0, currentQty - quantity); // Don't go below 0

                await this.prisma.asset.update({
                  where: { id: item.inventoryItemId },
                  data: { quantity: newQty },
                });

                console.log(`✅ INVOICE CONFIRM: Updated asset ${item.inventoryItemId}: ${currentQty} - ${quantity} = ${newQty}`);
              } else {
                console.warn('⚠️ INVOICE CONFIRM: Neither inventory nor asset found:', item.inventoryItemId);
              }
            }
          })
        );

        console.log('✅ INVOICE CONFIRM: Stock deduction completed');
      } else {
        console.log('🧾 INVOICE CONFIRM: Skipping stock deduction (invoice extracted from DO)');
      }

      // Update document with confirmation data and set status to confirmed
      const updatedConfig = {
        ...config,
        fromInvoiceNo: confirmData.fromInvoiceNo,
        toInvoiceNo: confirmData.toInvoiceNo,
        confirmedAt: new Date().toISOString(),
        stockDeducted: shouldDeductStock,
      };

      // Propagate project + deployment link from source DO when the invoice
      // doesn't already carry one. Source DO is the authoritative anchor.
      let inheritedProjectId: string | undefined;
      let inheritedDeploymentId: string | undefined;
      if (sourceDocumentId && (!document.projectId || !document.projectDeploymentId)) {
        try {
          const sourceDoc = await this.prisma.document.findFirst({
            where: { id: sourceDocumentId, organizationId },
            select: { projectId: true, projectDeploymentId: true },
          });
          if (sourceDoc) {
            if (!document.projectId && sourceDoc.projectId) inheritedProjectId = sourceDoc.projectId;
            if (!document.projectDeploymentId && sourceDoc.projectDeploymentId) {
              inheritedDeploymentId = sourceDoc.projectDeploymentId;
            }
            if (inheritedProjectId || inheritedDeploymentId) {
              console.log('🧾 INVOICE CONFIRM: Inheriting project/deployment from DO', {
                projectId: inheritedProjectId,
                projectDeploymentId: inheritedDeploymentId,
              });
            }
          }
        } catch (err) {
          console.warn('🧾 INVOICE CONFIRM: Could not inherit project link from DO', err);
        }
      }

      const updatedDocument = await this.prisma.document.update({
        where: {
          id: documentId,
          organizationId,
        },
        data: {
          config: updatedConfig,
          // guru 2026-07-24: confirm goes STRAIGHT to Awaiting payment
          // (pending_payment) — no resting 'confirmed' state for invoices.
          status: 'pending_payment',
          ...(inheritedProjectId ? { projectId: inheritedProjectId } : {}),
          ...(inheritedDeploymentId ? { projectDeploymentId: inheritedDeploymentId } : {}),
        },
      });

      // The invoice's journals stop being "unconfirmed" now.
      await this.journalService.markConfirmedForDocument(organizationId, documentId).catch(() => undefined);

      // A confirmed revision retires the generation it replaces (guru 2026-11-19).
      if (document.baseDocumentId) {
        await this.supersedePreviousGenerations(
          { id: documentId, name: updatedDocument.name, baseDocumentId: document.baseDocumentId, revisionNumber: document.revisionNumber },
          organizationId,
          actor,
        );
      }

      console.log('✅ INVOICE CONFIRM: Document confirmed successfully');

      void this.logDocumentEvent({
        documentId,
        organizationId,
        action: 'APPROVED',
        detail: `${updatedDocument.name || confirmData.toInvoiceNo} confirmed`,
        documentName: updatedDocument.name || confirmData.toInvoiceNo,
        actor,
      });

      // Save price history (best-effort)
      try {
        await this.priceHistoryService.savePriceHistoryFromDocument(documentId, organizationId);
        console.log('✅ INVOICE CONFIRM: Price history saved');
      } catch (e) {
        console.error('❌ INVOICE CONFIRM: Price history failed', e);
      }

      // Auto-post the invoice to the General Ledger (best-effort)
      console.log('📒 [GL auto-post] entering auto-post block for invoice', documentId);
      try {
        // Idempotency: if a journal entry already exists for this invoice, skip.
        const existingEntry = await this.prisma.journalEntry.findFirst({
          where: { organizationId, sourceDocumentId: documentId, type: 'INVOICE', status: { not: 'VOID' } },
          select: { id: true, journalNumber: true },
        });
        if (existingEntry) {
          console.log('📒 [GL auto-post] entry already exists for this invoice — skipping', existingEntry);
          return {
            success: true,
            document: updatedDocument,
            stockDeducted: shouldDeductStock,
            message: shouldDeductStock ? 'Invoice confirmed and stock deducted' : 'Invoice confirmed',
          };
        }

        const customer = config?.customer;
        const customerName = customer?.name || config?.customerName;
        const itemsForTotal = config?.items || [];

        // Prefer the explicit totals AIMS already computes on the document
        // config — including the editor's summary fields (documentInfo.*),
        // which the document-level tax code drives (e.g. code 2 zero-rated →
        // gstAmount 0 must post as 0, not the org default).
        const di = config?.documentInfo;
        const net = parseFloat(config?.subTotal ?? di?.subTotal ?? config?.summary?.subTotal ?? 'NaN');
        const tax = parseFloat(config?.gstAmount ?? di?.gstAmount ?? config?.summary?.taxAmount ?? config?.tax?.amount ?? 'NaN');
        const gross = parseFloat(config?.nettTotal ?? di?.nettTotal ?? config?.summary?.grandTotal ?? 'NaN');

        // Fallbacks if those fields aren't set: compute from items + the doc's
        // GST % (tax code / editor), else the org tax rate.
        const fallbackNet = itemsForTotal.reduce((sum: number, item: any) => {
          const amt = parseFloat(item.amount) || (parseFloat(item.quantity) * parseFloat(item.unitPrice)) || 0;
          return sum + amt;
        }, 0);
        const org = await this.prisma.organization.findUnique({ where: { id: organizationId }, select: { taxRate: true } });
        const docPct = parseFloat(di?.gstPercent);
        const orgRate = (Number.isFinite(docPct) ? docPct : (org?.taxRate ?? 0)) / 100;

        const netAmount = !Number.isNaN(net) ? net : fallbackNet;
        const taxAmount = !Number.isNaN(tax) ? tax : netAmount * orgRate;
        const grossAmount = !Number.isNaN(gross) ? gross : netAmount + taxAmount;

        console.log('📒 [GL auto-post] computed amounts', {
          docId: documentId,
          invoiceNumber: updatedDocument.name,
          customerName,
          itemCount: itemsForTotal.length,
          net: netAmount,
          tax: taxAmount,
          gross: grossAmount,
        });

        // No-draft model: the GL entry is normally posted at SAVE time now.
        // Confirm only posts as a fallback for documents saved before the
        // model change (no existing entry).
        const alreadyPosted = await this.journalAutoPost.alreadyPostedForDocument(organizationId, documentId, 'INVOICE');
        if (alreadyPosted) {
          console.log('📒 [GL auto-post] entry already posted at save — confirm skips GL', alreadyPosted.journalNumber);
        } else if (grossAmount <= 0) {
          console.warn('📒 [GL auto-post] grossAmount <= 0, skipping');
        } else {
          const subjectPosting = subjectPostingLines(config, await loadSubjectAccounts(this.prisma, organizationId), netAmount);
          const entry = await this.journalAutoPost.postFromInvoice({
            organizationId,
            documentId,
            invoiceNumber: updatedDocument.name || config?.documentNumber,
            entryDate: new Date(config?.date || (await orgTodayFor(this.prisma, organizationId))),
            customerName,
            netAmount,
            taxAmount,
            grossAmount,
            glRemarks: subjectPosting?.mode === 'subject' ? subjectPosting.lines[0].description : null,
            // Per-line revenue accounts from the Revenue Master File (config.items[].accountCode).
            // Tax-inclusive docs carry GROSS line amounts — scale them to net so the
            // revenue credits exclude GST (postFromInvoice expects line NET).
            revenueLines: (() => {
              // Split payment part: its net over the original invoice's revenue accounts. Null for every other invoice.
              const inclusive = di?.absorbTax === 'Y' || di?.absorbTax === true;
              const factor = inclusive && fallbackNet > 0 ? netAmount / fallbackNet : 1;
              // WCT: the Subject's type decides what posts (subject-type-account.ts). Null for everyone else.
              if (subjectPosting) return subjectPosting.lines.map((l) => ({ accountCode: l.accountCode, amount: l.lineIndex < 0 ? l.amount : Math.round(l.amount * factor * 100) / 100 }));
              const split = splitGlRevenueLines(config, netAmount);
              if (split) return split;
              return itemsForTotal.map((it: any) => ({
                accountCode: it.accountCode || it.revenueAccountCode || null,
                amount: Math.round((parseFloat(it.amount) || (parseFloat(it.quantity) * parseFloat(it.unitPrice)) || 0) * factor * 100) / 100,
              }));
            })(),
          });
          if (entry) {
            console.log('✅ [GL auto-post] journal entry created', {
              journalNumber: entry.journalNumber,
              entryId: entry.id,
              totalDebit: entry.totalDebit,
              totalCredit: entry.totalCredit,
            });
          } else {
            console.warn('⚠️ [GL auto-post] postFromInvoice returned null — see warnings above');
          }
        }
      } catch (error) {
        console.error('❌ [GL auto-post] failed for invoice', documentId, error);
      }

      return {
        success: true,
        document: updatedDocument,
        stockDeducted: shouldDeductStock,
        message: shouldDeductStock
          ? 'Invoice confirmed and stock deducted'
          : 'Invoice confirmed',
      };
    } catch (error) {
      console.error('❌ INVOICE CONFIRM: Error:', error);
      throw new HttpException(
        error.message || 'Failed to confirm Invoice',
        error.status || HttpStatus.INTERNAL_SERVER_ERROR
      );
    }
  }

  /**
   * Get payment summary for an invoice
   * Returns total amount, amount paid, and remaining balance
   */
  async getPaymentSummary(documentId: string, organizationId: string) {
    try {
      // Get the document
      const document = await this.prisma.document.findFirst({
        where: {
          id: documentId,
          organizationId,
        },
      });

      if (!document) {
        throw new HttpException('Document not found', HttpStatus.NOT_FOUND);
      }

      // Validate it's an invoice
      const invoiceTypes = ['INVOICE', 'TI', 'TI2'];
      if (!invoiceTypes.includes(document.type)) {
        throw new HttpException(
          'Payment summary is only available for invoices',
          HttpStatus.BAD_REQUEST,
        );
      }

      const config: any = document.config;
      const items = config?.items || [];

      // Native invoices total up their line items. Xero-imported invoices have
      // no line items — their authoritative gross/outstanding live on the
      // config (xeroGross / xeroBalance), set during migration + AR reconcile.
      const itemsTotal = items.reduce((sum: number, item: any) => {
        const amount =
          parseFloat(item.amount) ||
          parseFloat(item.quantity) * parseFloat(item.unitPrice) ||
          0;
        return sum + amount;
      }, 0);
      // ERP-imported invoices (common/erp-import.ts) work the same way: the live outstanding
      // stamp already includes what was paid in the ERP and every native payment since.
      const isXero = !!config?.xeroImported || isErpImported(config);
      // Native invoices: prefer the editor's GROSS (documentInfo.nettTotal —
      // items sum alone is the NET on tax-exclusive docs, so the summary
      // understated the balance by the GST portion).
      const nativeGross =
        parseFloat(config?.documentInfo?.nettTotal ?? config?.nettTotal ?? 'NaN') || itemsTotal;
      const invoiceAmount = isXero ? Number(grossStampOf(config) ?? itemsTotal) : nativeGross;

      // Native Payment rows recorded against this invoice.
      const payments = await this.prisma.payment.findMany({
        where: { documentId, organizationId },
      });
      const nativePaid = payments.reduce((sum, payment) => sum + parseFloat(payment.amount.toString()), 0);

      // For Xero invoices, outstanding = xeroBalance minus any NEW native
      // payments recorded since migration. For native invoices it's the usual
      // gross minus payments.
      let totalPaid: number;
      let remainingBalance: number;
      if (isXero) {
        // xeroBalance is maintained LIVE by updateInvoiceStatusAfterPayment —
        // already net of native payments (subtracting them again double-counted).
        const xeroBalance = Number(outstandingOf(config) ?? 0);
        remainingBalance = xeroBalance;
        totalPaid = invoiceAmount - remainingBalance;
      } else {
        totalPaid = nativePaid;
        remainingBalance = invoiceAmount - totalPaid;
      }

      return {
        success: true,
        invoiceAmount: parseFloat(invoiceAmount.toFixed(2)),
        totalPaid: parseFloat(totalPaid.toFixed(2)),
        remainingBalance: parseFloat(remainingBalance.toFixed(2)),
        invoiceNumber: document.name || `INV-${documentId.substring(0, 8)}`,
        status: document.status,
      };
    } catch (error) {
      console.error('Error getting payment summary:', error);
      throw new HttpException(
        error.message || 'Failed to get payment summary',
        error.status || HttpStatus.INTERNAL_SERVER_ERROR,
      );
    }
  }

  /**
   * "Sync to Xero" (editor toolbar, accounting context): push this document
   * to Xero with full accounting fidelity — doc type (INVOICE→ACCREC sales,
   * BILL→ACCPAY), real dates, per-line account codes resolved through
   * XeroAccountMapping, line tax types, tax-inclusive/exclusive per the org's
   * AccountingSetting. Re-syncing updates the same Xero document (the Xero id
   * is stamped into config on first sync).
   */
  // ---------- "Click to pay" public page helpers (guru 2026-08-06) ----------

  // Reusable: signed URL for the document PDF, generating + uploading it if
  // absent. `prefetched` lets sendInvoiceEmail pass what it already loaded;
  // the public-pay endpoint calls with nothing and we fetch here.
  /**
   * Design knobs for a document's PDF: its template's styleConfig, plus a
   * fetchable logo URL when the design asks for one. Templates are a cross-org
   * shared pool, so the lookup is by id alone (the document already points at
   * it). Never throws: a missing template means the stock look.
   */
  async designForTemplate(
    documentTemplateId: string | null | undefined,
    organization: any,
    doc?: { imported?: boolean; createdAt?: Date | string | null; isNew?: boolean; id?: string },
  ): Promise<{ design: any; logoUrl: string | null }> {
    let raw: any = null;
    let templateType: string | null = null;
    if (documentTemplateId) {
      const tpl = await this.prisma.documentTemplate.findUnique({ where: { id: documentTemplateId }, select: { styleConfig: true, type: true } }).catch(() => null);
      raw = tpl?.styleConfig;
      templateType = tpl?.type ?? null;
    }
    // WCT group (features.wctDocumentBrand, BC Air 2026-11-16): its stock invoice / DO print on the WCT layout in its brand.
    // Orgs without the setting: exactly the template's design, as before.
    const orgId: string | undefined = organization?.id;
    const features = orgId
      ? ((await this.prisma.organizationUIConfig.findUnique({ where: { organizationId: orgId }, select: { features: true } }).catch(() => null))?.features as any)
      : null;
    // Section-title numbering (features.snoSkipTitlesSince) depends on when the document was created.
    let docAge = doc;
    if (doc && !doc.isNew && !doc.createdAt && doc.id && features?.snoSkipTitlesSince) {
      const row = await this.prisma.document.findUnique({ where: { id: doc.id }, select: { createdAt: true } }).catch(() => null);
      docAge = { ...doc, createdAt: row?.createdAt ?? null };
    }
    const design = effectiveDesign(raw, templateType, features, docAge);
    let logoUrl: string | null = null;
    const key = organization?.logo;
    if (design.logoPosition !== 'none' && key) {
      logoUrl = /^(https?:|data:)/i.test(String(key)) ? String(key) : await this.s3Service.getSignedUrl(String(key), 3600).catch(() => null);
    }
    return { design, logoUrl };
  }

  /** Same, starting from a document id (the editor's generate-pdf call).
   *  A document not saved yet (the editor sends `temp_…`) has no row, so the
   *  editor also names the template it is working from — a new WCT quotation
   *  previews in its layout before the first save. */
  async designForDocument(documentId: string | undefined, organizationId: string, templateId?: string | null): Promise<{ design: any; logoUrl: string | null }> {
    const doc = documentId
      ? await this.prisma.document
          .findFirst({ where: { id: documentId, organizationId }, select: { documentTemplateId: true, config: true, createdAt: true, organization: { select: { id: true, logo: true } } } })
          .catch(() => null)
      : null;
    const org = doc?.organization ?? (await this.prisma.organization.findUnique({ where: { id: organizationId }, select: { id: true, logo: true } }).catch(() => null));
    const effectiveTemplateId = doc?.documentTemplateId || templateId || null;
    if (!effectiveTemplateId) return { design: resolveDesign(null), logoUrl: null };
    // No document id = not saved yet (the editor's first preview / print): a new document.
    return this.designForTemplate(effectiveTemplateId, org, { imported: isImportedDoc(doc?.config), createdAt: doc?.createdAt ?? null, isNew: !documentId });
  }

  /**
   * Server-rendered HTML for a document whose template uses a NAMED page
   * layout (design.layout = 'wct'), or null when it does not. The guest DO
   * link, the field app's Print DO and the signed-DO PDF call this so a WCT
   * delivery order prints as the client's paper (guru 2026-10-27: "how come
   * the DO isn't the template I sent you") instead of the portal's stock
   * sheet. `data` is the config the caller is allowed to show (the public
   * link passes its sanitised copy); `reports` are the DO's field reports —
   * the renderer draws the customer's sign-off and the proof photos from them.
   */
  /** Document.revisionNumber (0 = original, n = "Create Revision" n), or null. */
  async revisionNumberOf(documentId: string, organizationId: string): Promise<number | null> {
    const row = await this.prisma.document.findFirst({ where: { id: documentId, organizationId }, select: { revisionNumber: true } }).catch(() => null);
    return row?.revisionNumber ?? null;
  }

  async serverDocumentHtml(
    doc: { id: string; type: string; name?: string | null; documentTemplateId?: string | null; revisionNumber?: number | null; organization?: any },
    organizationId: string,
    data: any,
    reports: any[] = [],
  ): Promise<{ html: string; pdfOptions: ReturnType<typeof pdfOptionsFor> } | null> {
    const styled = await this.designForDocument(doc.id, organizationId, doc.documentTemplateId ?? null);
    if (!isNamedLayout(doc.type, styled.design)) return null;
    const org =
      doc.organization ??
      (await this.prisma.organization.findUnique({ where: { id: organizationId } }).catch(() => null)) ??
      {};
    const bucket = process.env.RESOURCE_BUCKET || 'aims-osiris';
    const region = process.env.AWS_REGION || 'ap-southeast-1';
    const renderData = {
      documentType: doc.type,
      ...(await this.withSalesPersonName(data || {})),
      name: doc.name ?? data?.name,
      revisionNumber: doc.revisionNumber ?? null,
      design: styled.design,
      logoUrl: styled.logoUrl,
      organization: org,
      company: org,
      maintenanceReports: Array.isArray(reports) ? reports : [],
      photoBaseUrl: `https://${bucket}.s3.${region}.amazonaws.com/`,
    };
    const html = this.pdfGeneratorService.generateInvoiceHtml(renderData);
    return html ? { html, pdfOptions: pdfOptionsFor(doc.type, renderData) } : null;
  }

  /** Manual order flow: a newly accepted quotation's job gets its draft DO + draft service report. Never throws. */
  /**
   * DO first (manual order flow, 2026-11-13): the office picks the units for a
   * job-less DO's product lines (one row per unit). Each product row gets its
   * unit (config.items[].inventoryItemId, so the DO's lines become unit rows),
   * the unit is reserved (instock -> reserved, guarded), and the DO's items are
   * re-synced. Completing the DO then moves them through the existing DO
   * deduction, once per line (deductedAt). Rows already holding a unit are kept.
   */
  async bindDoUnits(documentId: string, organizationId: string, units: Array<{ assetId?: string; inventoryId?: string }>) {
    const d = await this.prisma.document.findFirst({ where: { id: documentId, organizationId, type: { in: ['DELIVERY_ORDER', 'DO'] } }, select: { id: true, name: true, config: true } });
    if (!d) throw new HttpException('DO not found', HttpStatus.NOT_FOUND);
    const cfg: any = d.config || {};
    const items: any[] = Array.isArray(cfg.items) ? cfg.items.map((it: any) => ({ ...it })) : [];
    const slots = items.map((it, i) => ({ it, i })).filter((x) => x.it?.assetId && !x.it.inventoryItemId);
    if (!slots.length) return { bound: 0 };
    const picked = (Array.isArray(units) ? units : []).filter((u) => typeof u?.inventoryId === 'string' && u.inventoryId);
    if (picked.length !== slots.length) throw new HttpException(`Pick a unit for every product line (${slots.length} needed)`, HttpStatus.BAD_REQUEST);
    const ids = picked.map((u) => u.inventoryId as string);
    if (new Set(ids).size !== ids.length) throw new HttpException('The same unit is picked twice', HttpStatus.BAD_REQUEST);
    const invs = await this.prisma.inventory.findMany({ where: { id: { in: ids }, organizationId }, select: { id: true, assetId: true, status: true, sku: true, serialNumber: true } });
    const pool = [...invs];
    const assigned: Array<{ index: number; unit: (typeof invs)[number] }> = [];
    for (const sl of slots) {
      const k = pool.findIndex((u) => u.assetId === sl.it.assetId);
      if (k < 0) throw new HttpException(`Pick a unit of ${sl.it.description || 'the product'} for ${d.name || 'the DO'}`, HttpStatus.BAD_REQUEST);
      const [unit] = pool.splice(k, 1);
      if (unit.status !== InventoryStatus.instock) throw new HttpException(`Unit ${unit.serialNumber || unit.sku} is not in stock`, HttpStatus.BAD_REQUEST);
      assigned.push({ index: sl.i, unit });
    }
    await this.prisma.$transaction(async (tx) => {
      for (const a of assigned) {
        const r = await tx.inventory.updateMany({ where: { id: a.unit.id, organizationId, status: InventoryStatus.instock }, data: { status: InventoryStatus.reserved } });
        if (r.count !== 1) throw new HttpException(`Unit ${a.unit.serialNumber || a.unit.sku} was just taken, pick another`, HttpStatus.CONFLICT);
      }
      for (const a of assigned) items[a.index] = { ...items[a.index], inventoryItemId: a.unit.id, serialNumber: a.unit.serialNumber ?? a.unit.sku };
      await tx.document.update({ where: { id: d.id }, data: { config: { ...cfg, items } } });
    });
    await this.syncDocumentItems(d.id, { ...cfg, items }, organizationId);
    return { bound: assigned.length };
  }

  /**
   * Manual order flow, DO first: the order's draft DO (see DeliveriesService.prepareManualOrderDo),
   * made when the quotation is signed (staff Confirm and e-sign both call this). 2026-11-17: then
   * the order's draft invoice at once, as "Create invoice" (autoInvoiceAtSigning).
   * 2026-11-19 (disableAutoDraftDo / disableAutoDraftInvoice, manual flow only): each draft is skipped
   * when its flag is on, so signing can make the order only; the office then uses Add DO and Create
   * invoice, in either order. Returns null when no DO was made.
   */
  async prepareManualOrderDo(orderId: string, organizationId: string) {
    const off = await manualAutoDraftsOff(this.prisma, organizationId);
    const out = off.doOff ? null : await this.deliveriesService.prepareManualOrderDo(orderId, organizationId);
    if (!off.invoiceOff) await this.autoInvoiceAtSigning(orderId, organizationId);
    // A draft skipped: store the order's status now ("Quotation signed" with nothing made), not the new row's OPEN.
    if (off.doOff || off.invoiceOff) await refreshOrderStatus(this.prisma as any, organizationId, orderId);
    return out;
  }

  /**
   * Manual order flow (enableManualOrderFlow + enableWctOrders + enableWctOrderInvoice, 2026-11-17):
   * a signed quotation's order gets its DRAFT invoice straight away, exactly as the order page's
   * "Create invoice" (invoiceOrderFromQuotation: the quotation billed once, invoice first). Never
   * sent, never posted (postInvoicesOnConfirm unchanged). Skipped when the order already has an
   * invoice. Best-effort: never fails the signing. Every other org: no-op.
   */
  async autoInvoiceAtSigning(orderId: string, organizationId: string): Promise<{ id: string; name: string | null } | null> {
    try {
      if (!(await isManualOrderFlow(this.prisma, organizationId))) return null;
      if (!(await isOrgFeatureEnabled(this.prisma as any, organizationId, WCT_ORDER_INVOICE_FLAG))) return null;
      const order = await this.prisma.order.findFirst({ where: { id: orderId, organizationId }, select: { id: true, status: true, linkedDocuments: true, invoiceDocumentId: true } });
      if (!order || order.status === 'CANCELLED' || isImportedOrder(order) || (await this.liveOrderInvoice(organizationId, order))) return null;
      // The e-sign path is a public route: pin the org for the tenancy layer.
      const invoice: any = await runAsOrg(organizationId, () => this.invoiceOrderFromQuotation(orderId, organizationId));
      return invoice ? { id: invoice.id, name: invoice.name ?? null } : null;
    } catch (e: any) {
      console.warn(`[order invoice at signing] ${orderId}: ${e?.message}`);
      return null;
    }
  }

  /** The order's first invoice recorded on the order (not voided with a cancel), or null. */
  private async liveOrderInvoice(organizationId: string, order: { linkedDocuments?: unknown; invoiceDocumentId?: string | null }) {
    const ids = orderInvoiceIdsOf(order as any);
    if (!ids.length) return null;
    const rows = await this.prisma.document.findMany({ where: { organizationId, id: { in: ids }, type: 'INVOICE' }, select: { id: true, name: true, type: true, documentTemplateId: true, config: true, createdAt: true }, orderBy: { createdAt: 'asc' } });
    const live = rows.find((d: any) => (d.config as any)?.voided !== true);
    return live ? { id: live.id, name: live.name, type: live.type, documentTemplateId: live.documentTemplateId } : null;
  }

  async prepareManualOrderJob(deliveryId: string, organizationId: string) {
    try {
      return await this.deliveriesService.prepareManualOrderJob(deliveryId, organizationId);
    } catch {
      return null;
    }
  }

  /** WCT orders hub: the PDF URL of an order's source quotation (null when the order has none). */
  async orderQuotationPdfUrl(orderId: string, organizationId: string): Promise<string | null> {
    const order = await this.prisma.order.findFirst({ where: { id: orderId, organizationId }, select: { sourceQuotationId: true } });
    if (!order?.sourceQuotationId) return null;
    return (await this.getOrGeneratePdfUrl(order.sourceQuotationId, organizationId)) ?? null;
  }

  /** An invoice of this order (job / DO / order links, and every split part) as a PDF; null when it is not the order's. */
  async orderInvoicePdfUrl(orderId: string, documentId: string, organizationId: string): Promise<string | null> {
    const order = await this.prisma.order.findFirst({ where: { id: orderId, organizationId }, select: { id: true, linkedDocuments: true, invoiceDocumentId: true } });
    if (!order) return null;
    const [jobs, dos] = await Promise.all([
      this.prisma.delivery.findMany({ where: { organizationId, orderId }, select: { orderInvoiceId: true } }),
      this.prisma.document.findMany({ where: { organizationId, type: { in: ['DELIVERY_ORDER', 'DO'] }, config: { path: ['orderId'], equals: orderId } }, select: { config: true } }),
    ]);
    const ids = [
      ...new Set(
        [...orderInvoiceIdsOf(order as any), ...jobs.map((j) => j.orderInvoiceId), ...dos.map((d: any) => d.config?.orderInvoiceId)].filter(
          (v): v is string => typeof v === 'string' && !!v && !v.startsWith('claim:'),
        ),
      ),
    ];
    const rows = await invoiceRowsWithSplitParts(this.prisma as any, organizationId, ids, { type: { in: ['INVOICE', 'TI', 'TI2'] } });
    const row = rows.find((r) => r.id === documentId);
    if (!row) return null;
    // A draft still changes: render it fresh rather than from the S3 cache.
    return (await this.getOrGeneratePdfUrl(documentId, organizationId, undefined, ['draft', 'unconfirmed'].includes(String(row.status)))) ?? null;
  }

  async getOrGeneratePdfUrl(
    documentId: string,
    organizationId: string,
    prefetched?: { document: any; customer: any; documentInfo: any; items: any[]; config: any; isQuotation: boolean; dueDate?: string },
    // Skip the S3 cache and re-render. The cache is never invalidated on
    // document edit or layout change, so downloads that must reflect the
    // CURRENT document (bulk download, guru 2026-09-11) force-regenerate.
    forceRegenerate = false,
  ): Promise<string | undefined> {
    try {
      const docType =
        prefetched?.document?.type ??
        (await this.prisma.document.findFirst({ where: { id: documentId, organizationId }, select: { type: true } }))?.type;
      const s3Key = `documents/${organizationId}/${docType}/${documentId}.pdf`;
      try {
        if (forceRegenerate) throw new Error('regenerate requested');
        // getSignedUrl signs whether or not the object EXISTS — a missing PDF
        // came back as a valid-looking URL to an S3 NoSuchKey error (guru
        // 2026-08-06, pay page). HEAD-check before trusting it.
        const candidate = await this.s3Service.getSignedUrl(s3Key, 3600);
        const head = await fetch(candidate, { method: 'HEAD' });
        if (!head.ok) throw new Error('PDF missing');
        return candidate;
      } catch {
        let p = prefetched;
        if (!p) {
          const document = await this.prisma.document.findFirst({
            where: { id: documentId, organizationId },
            include: { organization: true },
          });
          if (!document) return undefined;
          const config: any = document.config || {};
          await this.stampPreparerTitle(config, organizationId);
    const documentInfo = config.documentInfo || { documentNumber: document.name };
          const items: any[] = Array.isArray(config.items) ? config.items : [];
          const dueDate = config.dueDate ? moment(config.dueDate).format('DD MMM YYYY') : undefined;
          // Title/labels follow the document type — this used to be hardcoded
          // false, so quotations rendered as "Tax Invoice".
          const isQuotation = ['QUOTATION', 'QO', 'QO1', 'QO2', 'QT'].includes(String(document.type).toUpperCase());
          p = {
            document,
            customer: config.customer || { name: config.customerName },
            // The document number lives on Document.name, not in config, so the
            // header showed a blank number without this fallback.
            documentInfo: { ...documentInfo, documentNumber: documentInfo?.documentNumber || document.name },
            items,
            config,
            isQuotation,
            dueDate,
          };
        }
        const styled = await this.designForTemplate(p.document.documentTemplateId, p.document.organization, { imported: isImportedDoc(p.document.config ?? p.config), createdAt: (p.document as any).createdAt ?? null, id: p.document.id });
        const renderData = {
          // Selects the ported portal layout for this type (falls back to the
          // legacy generic layout for types not ported yet).
          documentType: p.document.type,
          ...(await this.withSalesPersonName(p.config || {})),
          design: styled.design,
          logoUrl: styled.logoUrl,
          // The number lives on Document.name, not in config — the renderer
          // falls back to it for the "QUOTATION NO." / header line.
          name: p.document.name,
          organization: p.document.organization,
          // The generator reads `data.company` (never `data.organization`), so
          // without this the letterhead/GST/Tel block rendered empty.
          company: p.document.organization,
          customer: p.customer,
          documentInfo: p.documentInfo,
          items: p.items,
          config: p.config,
          isQuotation: p.isQuotation,
          dueDate: p.dueDate,
        };
        const html = this.pdfGeneratorService.generateInvoiceHtml(renderData);
        const pdfBuffer = await this.pdfGeneratorService.generatePdfFromHtml(html, pdfOptionsFor(p.document.type, renderData));
        const { key } = await this.s3Service.uploadPdf(organizationId, p.document.type, documentId, pdfBuffer);
        return await this.s3Service.getSignedUrl(key, 3600);
      }
    } catch (error) {
      console.error('Failed to get/generate PDF:', error);
      return undefined;
    }
  }

  // Bulk PDF download for the list pages' selection bar (guru 2026-09-11):
  // one selected doc → its PDF; several → one ZIP. Each file is named
  // "<document name> - <reference>.pdf" (reference omitted when blank).
  // PDFs come from the same getOrGeneratePdfUrl pipeline the email / pay
  // flows use, so the branded layout and the S3 cache are shared.
  async bulkDownloadPdfs(organizationId: string, rawIds: string[]) {
    if (!Array.isArray(rawIds) || rawIds.length === 0) {
      throw new HttpException('No documents selected', HttpStatus.BAD_REQUEST);
    }
    // Accept document NUMBERS as well as uuids. The list page sends uuids, but
    // anything working from a search result (the chat agent, a script) has the
    // number — "TI2202610-001" — and silently matched nothing before.
    const isUuid = (v: string) => /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(String(v));
    const names = rawIds.filter((v) => v && !isUuid(v)).map(String);
    let ids = rawIds.filter((v) => v && isUuid(v)).map(String);
    if (names.length) {
      const byName = await this.prisma.document.findMany({
        where: { organizationId, name: { in: names } },
        select: { id: true, name: true },
      });
      ids = [...ids, ...byName.map((d) => d.id)];
      const missing = names.filter((n) => !byName.some((d) => d.name === n));
      if (missing.length && !ids.length) {
        throw new HttpException(`No document found named ${missing.join(', ')}`, HttpStatus.BAD_REQUEST);
      }
    }
    if (!ids.length) {
      throw new HttpException('No documents selected', HttpStatus.BAD_REQUEST);
    }
    if (ids.length > 50) {
      throw new HttpException('Too many documents — select at most 50 at a time', HttpStatus.BAD_REQUEST);
    }
    const sanitize = (s: string) =>
      s
        .replace(/[\\/:*?"<>|]/g, '-')
        // ASCII-only: adm-zip doesn't set the UTF-8 filename flag, so e.g. an
        // em-dash in a reference shows as mojibake in some unzip tools.
        .replace(/[‒-―]/g, '-')
        .replace(/[‘’]/g, "'")
        .replace(/[“”]/g, "'")
        // eslint-disable-next-line no-control-regex
        .replace(/[^\x20-\x7E]/g, '')
        .replace(/\s+/g, ' ')
        .trim()
        .slice(0, 140);
    const files: { name: string; buffer: Buffer }[] = [];
    const failed: string[] = [];
    const used = new Set<string>();
    for (const id of ids) {
      const doc = await this.prisma.document.findFirst({
        where: { id, organizationId },
        select: { id: true, name: true, config: true },
      });
      if (!doc) {
        failed.push(id);
        continue;
      }
      const c: any = doc.config || {};
      const ref = documentReferenceOf(c);
      let base = sanitize(`${doc.name || doc.id}${ref ? ` - ${ref}` : ''}`) || doc.id;
      // Duplicate names (same number+ref twice) would silently overwrite
      // inside the zip — suffix them.
      if (used.has(base)) {
        let n = 2;
        while (used.has(`${base} (${n})`)) n += 1;
        base = `${base} (${n})`;
      }
      used.add(base);
      try {
        // Force-regenerate: the S3 PDF cache is never invalidated on edits or
        // layout changes, so a download must always reflect the current doc.
        const url = await this.getOrGeneratePdfUrl(doc.id, organizationId, undefined, true);
        if (!url) throw new Error('PDF generation failed');
        const res = await fetch(url);
        if (!res.ok) throw new Error(`PDF fetch failed (${res.status})`);
        files.push({ name: `${base}.pdf`, buffer: Buffer.from(await res.arrayBuffer()) });
      } catch (e) {
        console.error('[bulk-download] failed for', doc.id, e);
        failed.push(doc.name || doc.id);
      }
    }
    if (files.length === 0) {
      throw new HttpException('Could not generate a PDF for any of the selected documents', HttpStatus.INTERNAL_SERVER_ERROR);
    }
    if (files.length === 1) {
      return {
        success: true,
        filename: files[0].name,
        mime: 'application/pdf',
        base64: files[0].buffer.toString('base64'),
        failed,
      };
    }
    const zip = new AdmZip();
    for (const f of files) zip.addFile(f.name, f.buffer);
    return {
      success: true,
      filename: `invoices-${moment().format('YYYYMMDD-HHmm')}.zip`,
      mime: 'application/zip',
      base64: zip.toBuffer().toString('base64'),
      failed,
    };
  }

  // Mint (once) the unguessable public-pay token stored on the document.
  async ensurePayToken(documentId: string, organizationId: string): Promise<string | null> {
    const doc = await this.prisma.document.findFirst({ where: { id: documentId, organizationId }, select: { config: true } });
    if (!doc) return null;
    const c: any = doc.config || {};
    if (c.payToken) return c.payToken;
    const token = randomUUID();
    await this.prisma.document.update({ where: { id: documentId }, data: { config: { ...c, payToken: token } as any } });
    return token;
  }

  async syncToXero(documentId: string, organizationId: string, actor?: DocumentActor) {
    const doc = await this.prisma.document.findFirst({
      where: { id: documentId, organizationId },
      select: { id: true, name: true, type: true, status: true, config: true },
    });
    if (!doc) throw new HttpException('Document not found', HttpStatus.NOT_FOUND);
    if (!['INVOICE', 'TI', 'TI2', 'BILL'].includes(doc.type)) {
      throw new HttpException(`Only invoices and bills can be synced to Xero (this is a ${doc.type})`, HttpStatus.BAD_REQUEST);
    }
    const c: any = doc.config || {};
    const isSales = doc.type !== 'BILL';
    const items: any[] = Array.isArray(c.items) ? c.items : Array.isArray(c.lines) ? c.lines : [];
    if (!items.length) throw new HttpException('Document has no line items to sync', HttpStatus.BAD_REQUEST);

    // Account-code mapping: AIMS code → Xero code via confirmed XeroAccountMapping;
    // orgs whose CoA was pulled from Xero map 1:1 so same-code is the fallback.
    const mappings = await this.prisma.xeroAccountMapping.findMany({
      where: { organizationId },
      select: { aimsAccountCode: true, xeroAccountCode: true },
    });
    const codeMap = new Map(
      mappings
        .filter((m) => m.aimsAccountCode && m.xeroAccountCode)
        .map((m) => [m.aimsAccountCode as string, m.xeroAccountCode as string]),
    );

    // Tax-inclusive vs exclusive from the org's accounting settings.
    const setting = await this.prisma.accountingSetting.findUnique({
      where: { organizationId },
      select: { salesTaxInclusive: true, purchasesTaxInclusive: true },
    });
    const inclusive = isSales ? !!setting?.salesTaxInclusive : !!setting?.purchasesTaxInclusive;
    const totalTax = Number(c.gstAmount ?? c.taxAmount ?? c.xeroTax ?? 0) || 0;
    // The doc's own amounts-are choice (bill editor stores it) beats the org default.
    const docAmountsAre: string | undefined = c.amountsAre;
    const lineAmountTypes: 'Exclusive' | 'Inclusive' | 'NoTax' =
      docAmountsAre === 'INCLUSIVE' ? 'Inclusive'
      : docAmountsAre === 'NO_TAX' ? 'NoTax'
      : docAmountsAre === 'EXCLUSIVE' ? 'Exclusive'
      : totalTax === 0 ? 'NoTax' : inclusive ? 'Inclusive' : 'Exclusive';

    let contactName: string | null =
      (isSales ? c.customer?.name || c.customerName : c.supplier?.name || c.supplierName) || null;
    let contactEmail: string | null = (isSales ? c.customerEmail || c.customer?.email : c.supplier?.email) || null;
    // Native bills carry only supplierId — resolve the master record.
    if (!contactName && !isSales && c.supplierId) {
      const sup = await this.prisma.supplier.findFirst({ where: { id: c.supplierId, organizationId }, select: { name: true, email: true } });
      contactName = sup?.name || null;
      contactEmail = contactEmail || sup?.email || null;
    }
    if (!contactName && isSales && c.customerId) {
      const cust = await this.prisma.customer.findFirst({ where: { id: c.customerId, organizationId }, select: { name: true, email: true } });
      contactName = cust?.name || null;
      contactEmail = contactEmail || cust?.email || null;
    }
    if (!contactName) throw new HttpException('Document has no customer/supplier to sync as the Xero contact', HttpStatus.BAD_REQUEST);

    // Native bill lines reference ChartOfAccount by id (accountId), not code —
    // resolve ids → codes so the Xero mapping below can apply.
    const accountIds = [...new Set(items.map((it: any) => it.accountId).filter(Boolean))] as string[];
    const idToCode = new Map<string, string>();
    if (accountIds.length) {
      const accts = await this.prisma.chartOfAccount.findMany({
        where: { id: { in: accountIds }, organizationId },
        select: { id: true, code: true },
      });
      for (const a of accts) idToCode.set(a.id, a.code);
    }

    const toYmd = (v: any): string | undefined => {
      const d = v ? new Date(v) : null;
      return d && !isNaN(d.getTime()) ? d.toISOString().split('T')[0] : undefined;
    };

    const existingXeroId: string | null = (isSales ? c.xeroInvoiceId : c.xeroBillId) || null;
    const xeroInvoice = await this.xeroService.upsertDocumentInvoice(organizationId, {
      xeroId: existingXeroId,
      type: isSales ? 'ACCREC' : 'ACCPAY',
      contactName,
      contactEmail: contactEmail || undefined,
      date: toYmd(c.date ?? c.billDate) || new Date().toISOString().split('T')[0],
      dueDate: toYmd(c.dueDate),
      reference: documentReferenceOf(c) || c.poNo || c.qinRef || undefined,
      invoiceNumber: doc.name || undefined,
      lineAmountTypes,
      status: 'DRAFT', // land as Xero draft; approval stays a human decision in Xero
      lineItems: items.map((it: any) => {
        const aimsCode = it.accountCode ? String(it.accountCode) : it.accountId ? idToCode.get(it.accountId) : undefined;
        return {
          description: it.description || it.itemDescription || '(no description)',
          quantity: Number(it.quantity) || 1,
          unitAmount: Number(it.unitPrice ?? it.rate ?? it.amount) || 0,
          accountCode: aimsCode ? codeMap.get(aimsCode) || aimsCode : undefined,
          taxType: it.taxType || undefined, // omit → Xero applies the account's default rate
          taxAmount: it.taxAmount !== undefined && it.taxAmount !== null ? Number(it.taxAmount) : undefined,
        };
      }),
    });

    // Stamp the linkage so re-sync updates instead of duplicating.
    const stampKey = isSales ? 'xeroInvoiceId' : 'xeroBillId';
    await this.prisma.document.update({
      where: { id: doc.id },
      data: {
        config: {
          ...c,
          [stampKey]: xeroInvoice?.invoiceID || existingXeroId,
          xeroStatus: String(xeroInvoice?.status ?? 'DRAFT'),
          xeroSyncedAt: new Date().toISOString(),
          xeroSyncedBy: actor?.email || actor?.name || 'unknown',
        } as any,
      },
    });

    void this.logDocumentEvent({
      documentId: doc.id,
      organizationId,
      action: 'SENT',
      detail: `Synced to Xero as ${isSales ? 'sales invoice' : 'bill'} ${xeroInvoice?.invoiceNumber || doc.name} (${existingXeroId ? 'updated' : 'created'}, DRAFT)`,
      documentName: doc.name || undefined,
      actor,
    });

    return {
      success: true,
      action: existingXeroId ? 'updated' : 'created',
      xeroInvoiceId: xeroInvoice?.invoiceID,
      xeroInvoiceNumber: xeroInvoice?.invoiceNumber,
      xeroStatus: xeroInvoice?.status,
      lineAmountTypes,
    };
  }

  // ── Print HTML (shared by the on-screen preview and the server PDF) ──────
  /**
   * ID quotation "Prepared by" title: the PREPARER's actual role, never a
   * hardcoded Director (guru 2026-10-20 — Ryann is Designer-only; re-raised
   * 2026-11-08 because only the emailed-PDF path resolved it while the HTML
   * render path — editor preview, print, view pages, sign link — kept showing
   * Director). Resolved live so a promotion shows without editing old
   * documents.
   */
  private async stampPreparerTitle(config: any, organizationId: string) {
    const preparerId = config?.quote?.header?.designerUserId || config?.designerUserId;
    if (!config?.quote || !preparerId) return;
    try {
      const roles = await this.prisma.userRole.findMany({
        where: { userId: preparerId, organizationId, isActive: true },
        select: { role: { select: { name: true } } },
      });
      if (roles.length) {
        const tier = tierOfRoleNames(roles.map((r) => r.role.name));
        config.quote.header.designerTitle =
          tier === 'master' ? 'Director' : tier === 'senior' ? 'Senior Manager' : tier === 'junior' ? 'Junior Manager' : 'Designer';
      }
    } catch {
      /* keep the saved/default title */
    }
  }

  /**
   * Build the same data bag the emailed-PDF path uses and run it through the
   * document renderer. Used by GET /documents/:id/html so the ID quotation
   * editor's preview iframe shows exactly what the PDF will contain.
   */
  /**
   * The org's quotation print settings for the renderers: quotationGst
   * (enableQuotationGst: the GST row + nett total) and quotationTotalsToggle
   * (enableQuotationTotalsToggle: config.showTotals === false may hide the block).
   */
  async quotationRenderFlags(organizationId: string): Promise<{ quotationGst: boolean; quotationTotalsToggle: boolean }> {
    const [quotationGst, quotationTotalsToggle] = await Promise.all([
      isOrgFeatureEnabled(this.prisma, organizationId, QUOTATION_GST_FLAG),
      isOrgFeatureEnabled(this.prisma, organizationId, QUOTATION_TOTALS_TOGGLE_FLAG),
    ]);
    return { quotationGst, quotationTotalsToggle };
  }

  async renderDocumentHtml(documentId: string, organizationId: string, lang?: string): Promise<{ html: string; name: string | null; type: string }> {
    const document = await this.prisma.document.findFirst({
      where: { id: documentId, organizationId },
      include: { organization: true },
    });
    if (!document) throw new HttpException('Document not found', HttpStatus.NOT_FOUND);
    const config: any = document.config || {};
    await this.stampPreparerTitle(config, organizationId);
    // VO sheet: the payment-schedule panel must show TODAY's collection state,
    // not the confirm-time snapshot (guru 2026-10-10: a partial payment after
    // confirmation still printed as the full amount PENDING). Quantum figures
    // stay snapshotted — only the schedule rows refresh. Runs for DRAFT VOs
    // too, even before any consolidation was saved (guru 2026-11-08: a draft's
    // print skipped the Payment Schedule panel; every VO prints like a
    // confirmed one now).
    if (config.templateVariant === 'ID_VO' && document.projectId) {
      try {
        const ms = await this.prisma.projectMilestone.findMany({
          where: { projectId: document.projectId, organizationId, kind: 'milestone' },
          orderBy: { sortOrder: 'asc' },
          select: { label: true, amount: true, paidAmount: true },
        });
        if (ms.length) {
          config.consolidation = {
            ...(config.consolidation || {}),
            schedule: ms.map((m) => ({
              label: m.label,
              amount: Number(m.amount) || 0,
              paid: Number(m.paidAmount) || 0,
              collected: (Number(m.amount) || 0) > 0 && (Number(m.paidAmount) || 0) >= (Number(m.amount) || 0),
            })),
          };
        }
      } catch {
        /* keep the snapshot if the live read fails */
      }
    }
    const documentInfo = config.documentInfo || { documentNumber: document.name };
    const items: any[] = Array.isArray(config.items) ? config.items : [];
    const isQuotation = ['QUOTATION', 'QO', 'QO1', 'QO2', 'QT'].includes(String(document.type).toUpperCase());
    const styled = await this.designForTemplate(document.documentTemplateId, document.organization, { imported: isImportedDoc(document.config), createdAt: (document as any).createdAt ?? null, id: document.id });
    const renderFlags = isQuotation ? await this.quotationRenderFlags(organizationId) : null;
    const html = this.pdfGeneratorService.generateInvoiceHtml({
      documentType: document.type,
      lang: lang === 'zh' ? 'zh' : 'en',
      ...(await this.withSalesPersonName(config)),
      ...(renderFlags || {}),
      design: styled.design,
      logoUrl: styled.logoUrl,
      name: document.name,
      revisionNumber: (document as any).revisionNumber ?? null,
      organization: document.organization,
      company: document.organization,
      customer: config.customer || { name: config.customerName },
      documentInfo: { ...documentInfo, documentNumber: documentInfo?.documentNumber || document.name },
      items,
      config,
      isQuotation,
    });
    return { html, name: document.name, type: document.type };
  }

  /**
   * ID quotation Chinese print mode (guru 2026-09-19): collect every free-text
   * string in config.quote, AI-translate the ones not yet in config.quoteZh
   * ({ english: chinese } map) and cache the merged map on the document. Keyed
   * by the exact English string, so an edited line simply drops out of the
   * cache and gets translated on the next call — nothing is ever stale.
   */
  async translateIdQuotation(documentId: string, organizationId: string) {
    const document = await this.prisma.document.findFirst({
      where: { id: documentId, organizationId },
      select: { id: true, config: true },
    });
    if (!document) throw new HttpException('Document not found', HttpStatus.NOT_FOUND);
    const cfg: any = document.config || {};
    const quote: any = cfg.quote;
    if (!quote) throw new HttpException('Not an ID quotation', HttpStatus.BAD_REQUEST);

    const texts = new Set<string>();
    const add = (v: any) => {
      const t = String(v ?? '').trim();
      if (t) texts.add(t);
    };
    add(quote.header?.title);
    add(quote.header?.remarks);
    add(quote.header?.paymentTerms);
    for (const s of quote.sections || []) {
      add(s.title);
      for (const n of s.notes || []) add(n);
      for (const a of s.areas || []) {
        if (a.name && a.name !== 'General') add(a.name);
        for (const it of a.items || []) {
          add(it.description);
          for (const inc of it.includes || []) add(inc.text);
        }
      }
    }
    for (const d of quote.summary?.discounts || []) add(d.label);
    for (const pTerm of quote.terms?.paymentTerms || []) add(pTerm);
    for (const c of quote.terms?.clauses || []) add(c);

    const existing: Record<string, string> = cfg.quoteZh || {};
    const missing = [...texts].filter((t) => !existing[t]);
    if (!missing.length) return { translated: 0, cached: texts.size };

    const apiKey = process.env.ANTHROPIC_API_KEY;
    if (!apiKey) throw new HttpException('Translation is not configured (no AI key)', HttpStatus.SERVICE_UNAVAILABLE);
    const Anthropic = (await import('@anthropic-ai/sdk')).default;
    const client = new Anthropic({ apiKey });
    const res = await client.messages.create({
      model: 'claude-sonnet-5',
      max_tokens: 8000,
      system:
        'You translate interior-design renovation quotation lines from English to Simplified Chinese for a Singapore ID firm. ' +
        'Keep trade terms natural (木工 carpentry, 泥水 masonry, 防水 waterproofing, 人造石 quartz, 油漆 painting…), keep numbers, ' +
        'measurements, model codes and brand names EXACTLY as-is, and keep the register formal and contract-like. ' +
        'Input is a JSON array of strings; reply with ONLY a JSON array of the translations in the SAME order and length.',
      messages: [{ role: 'user', content: JSON.stringify(missing) }],
    });
    const raw = res.content
      .filter((b: any) => b.type === 'text')
      .map((b: any) => b.text)
      .join('');
    let out: string[];
    try {
      const jsonStart = raw.indexOf('[');
      out = JSON.parse(raw.slice(jsonStart, raw.lastIndexOf(']') + 1));
    } catch {
      throw new HttpException('Translation failed — could not parse AI output', HttpStatus.BAD_GATEWAY);
    }
    if (!Array.isArray(out) || out.length !== missing.length) {
      throw new HttpException('Translation failed — response length mismatch', HttpStatus.BAD_GATEWAY);
    }
    const merged = { ...existing };
    missing.forEach((src, i) => {
      if (typeof out[i] === 'string' && out[i].trim()) merged[src] = out[i].trim();
    });
    await this.prisma.document.update({
      where: { id: documentId },
      data: { config: { ...cfg, quoteZh: merged } },
    });
    return { translated: missing.length, cached: texts.size - missing.length };
  }

  /**
   * Margin guardrail breach on an ID quotation → bell notification to the
   * org's office users (management). Best-effort, idempotent per document.
   */
  async emitMarginAlert(
    documentId: string,
    organizationId: string,
    body: { marginPct?: number; floorPct?: number; lines?: string[] },
    actor?: DocumentActor,
  ) {
    const document = await this.prisma.document.findFirst({
      where: { id: documentId, organizationId },
      select: { id: true, name: true, type: true, config: true },
    });
    if (!document) throw new HttpException('Document not found', HttpStatus.NOT_FOUND);
    const cfg: any = document.config || {};
    const client = cfg?.quote?.header?.clientName || cfg?.customer?.name || '';
    const pct = typeof body.marginPct === 'number' ? `${body.marginPct.toFixed(1)}%` : 'below floor';
    const floor = typeof body.floorPct === 'number' ? `${body.floorPct}%` : 'the minimum';
    const who = actor?.name ? ` by ${actor.name}` : '';
    const lines = (body.lines || []).slice(0, 5);
    await this.notifications.emit({
      organizationId,
      kind: 'quote_margin_breach',
      title: `Quotation ${document.name || ''} margin ${pct} is below ${floor}`,
      body: `${client ? `${client} — ` : ''}saved${who}.${lines.length ? ` Low-margin lines: ${lines.join('; ')}` : ''}`,
      entityType: 'document',
      entityId: document.id,
      linkUrl: `/portal/sales/quotations/id/${document.id}`,
      // Management + the quotation's own designer (designer-only users get
      // ONLY notifications addressed to them).
      forUserId: cfg?.designerUserId || cfg?.quote?.header?.designerUserId || null,
    });
    return { ok: true };
  }
}

/**
 * Which side of the books a document faces: the one we ISSUE to a customer, or
 * the one a SUPPLIER issued to us. Credit and debit notes come in both
 * directions and move money opposite ways, so a list that mixes them has to say
 * which is which (guru 2026-11-12).
 *
 * A named supplier decides it — on a supplier's note the customer block, where
 * it exists, holds OUR OWN company as the recipient. null when neither side is
 * named (nothing to state rather than a wrong guess).
 */
export function counterpartyKind(config: any): 'CUSTOMER' | 'SUPPLIER' | null {
  if (config?.supplier?.id || config?.supplierId) return 'SUPPLIER';
  if (config?.customer?.id || config?.customerId) return 'CUSTOMER';
  return null;
}

/**
 * A document's issue date as YYYY-MM-DD: the editor's documentInfo.date, else
 * config.date / issueDate / invoiceDate (imports, trade invoices), else the
 * created date. DD/MM/YYYY values are turned round.
 */
export function documentIssueDate(config: any, createdAt: Date): string {
  const raw = [config?.documentInfo?.date, config?.date, config?.issueDate, config?.invoiceDate].find((v) => typeof v === 'string' && v.trim());
  if (raw) {
    const v = String(raw).trim();
    const iso = /^(\d{4})-(\d{2})-(\d{2})/.exec(v);
    if (iso) return `${iso[1]}-${iso[2]}-${iso[3]}`;
    const dmy = /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/.exec(v);
    if (dmy) return `${dmy[3]}-${dmy[2].padStart(2, '0')}-${dmy[1].padStart(2, '0')}`;
  }
  return createdAt.toISOString().slice(0, 10);
}
