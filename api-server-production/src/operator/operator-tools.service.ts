import { Injectable, Logger } from '@nestjs/common';
import type Anthropic from '@anthropic-ai/sdk';
import { PrismaService } from '../common/prisma.service';
import { AuditService } from '../common/audit.service';
import { CustomersService } from '../customers/customers.service';
import { AssetsService } from '../assets/assets.service';
import { DocumentsService } from '../documents/documents.service';
import { DocumentTemplatesService } from '../documentTemplates/documentTemplates.service';
import { PriceHistoryService } from '../price-history/price-history.service';
import { PaymentsService } from '../payments/payments.service';
import { ReceiptsService } from '../receipts/receipts.service';
import { XeroReportsService } from '../statements/xero-reports.service';
import { StatementsService } from '../statements/statements.service';
import { SuppliersService } from '../suppliers/suppliers.service';
import { BillsService } from '../bills/bills.service';
import { InventoriesService } from '../inventories/inventories.service';
import { ProjectsService } from '../projects/projects.service';
import { OperatorAuthService } from './operator-auth.service';
import { OperatorContext, PendingAction } from './operator.types';
import { cleanText } from './text.util';

/** What a tool hands back to the loop. `pending` asks the caller to raise a
 *  confirm prompt instead of proceeding. */
export interface ToolOutcome {
  result: any;
  pending?: PendingAction;
  /** A document PDF to push to the user before the model's final text. */
  preview?: { documentId: string; url: string; filename: string; caption: string };
}

interface ToolDef {
  name: string;
  description: string;
  permissions: string[];
  /** True when the tool writes — audited, and blocked for unconfirmed drafts. */
  input_schema: Anthropic.Tool['input_schema'];
  run: (ctx: OperatorContext, args: any) => Promise<ToolOutcome>;
}

const round2 = (n: number) => Math.round((Number(n) || 0) * 100) / 100;

@Injectable()
export class OperatorToolsService {
  private readonly logger = new Logger(OperatorToolsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly customers: CustomersService,
    private readonly assets: AssetsService,
    private readonly documents: DocumentsService,
    private readonly templates: DocumentTemplatesService,
    private readonly priceHistory: PriceHistoryService,
    private readonly payments: PaymentsService,
    private readonly receipts: ReceiptsService,
    private readonly xeroReports: XeroReportsService,
    private readonly statements: StatementsService,
    private readonly suppliers: SuppliersService,
    private readonly bills: BillsService,
    private readonly inventories: InventoriesService,
    private readonly projects: ProjectsService,
    private readonly auth: OperatorAuthService,
  ) {}

  /** Tool definitions handed to Claude (schema only — no implementations). */
  definitions(ctx: OperatorContext): Anthropic.Tool[] {
    return this.tools()
      .filter((t) => this.auth.hasPermission(ctx, t.permissions))
      .map((t) => ({ name: t.name, description: t.description, input_schema: t.input_schema }));
  }

  async execute(ctx: OperatorContext, name: string, args: any): Promise<ToolOutcome> {
    const tool = this.tools().find((t) => t.name === name);
    if (!tool) return { result: { error: `Unknown tool ${name}` } };
    if (!this.auth.hasPermission(ctx, tool.permissions)) {
      return { result: { error: `You do not have permission to ${name} (needs ${tool.permissions.join(', ')}).` } };
    }
    try {
      return await tool.run(ctx, args || {});
    } catch (e: any) {
      this.logger.error(`tool ${name} failed: ${e.message}`);
      return { result: { error: e?.message || 'Tool failed' } };
    }
  }

  // ── Tool table ─────────────────────────────────────────────────────────────

  private tools(): ToolDef[] {
    return [
      {
        name: 'find_customer',
        description: 'Search customers in this organization by name, code, email or phone. Use before creating any document.',
        permissions: ['customers:read'],
        input_schema: {
          type: 'object',
          properties: { query: { type: 'string', description: 'Name or code to search for' } },
          required: ['query'],
        },
        run: async (ctx, { query }) => {
          const res: any = await this.customers.getCustomers({ page: 1, limit: 5, search: query } as any, ctx.organizationId);
          const docs = res?.docs ?? res?.data?.docs ?? [];
          return {
            result: docs.map((c: any) => ({
              id: c.id,
              name: c.name,
              customerCode: c.customerCode,
              address: c.address,
              email: c.email,
            })),
          };
        },
      },

      {
        name: 'create_customer',
        description: 'Create a new customer. Only call after find_customer returns no match and the user confirmed the name.',
        permissions: ['customers:create'],
        input_schema: {
          type: 'object',
          properties: {
            name: { type: 'string' },
            address: { type: 'string' },
            email: { type: 'string' },
            phone: { type: 'string' },
          },
          required: ['name'],
        },
        run: async (ctx, args) => {
          const created: any = await this.customers.createCustomers(args as any, ctx.organizationId);
          const c = created?.data ?? created;
          this.log(ctx, 'CREATED', 'customer', c?.id, c?.name, 'Created via Operator');
          return { result: { id: c?.id, name: c?.name, customerCode: c?.customerCode } };
        },
      },

      {
        name: 'update_customer',
        description:
          "Update an existing customer's details (name, address, email, phone). Use this to correct or rename a customer instead of creating a duplicate. Only pass the fields being changed.",
        permissions: ['customers:update'],
        input_schema: {
          type: 'object',
          properties: {
            customerId: { type: 'string', description: 'Customer id from find_customer' },
            name: { type: 'string' },
            address: { type: 'string' },
            email: { type: 'string' },
            phone: { type: 'string' },
          },
          required: ['customerId'],
        },
        run: async (ctx, args) => {
          const existing = await this.prisma.customer.findFirst({
            where: { id: args.customerId, organizationId: ctx.organizationId },
            select: { id: true, name: true },
          });
          if (!existing) return { result: { error: 'Customer not found in this organization' } };

          // Only send through the fields actually being changed.
          const patch: any = { id: existing.id };
          for (const f of ['name', 'address', 'email', 'phone']) {
            if (args[f] !== undefined && args[f] !== null && String(args[f]).trim() !== '') {
              patch[f] = cleanText(args[f]);
            }
          }
          if (Object.keys(patch).length === 1) {
            return { result: { error: 'Nothing to update. Provide at least one field.' } };
          }

          const updated: any = await this.customers.updateCustomers(patch, ctx.organizationId);
          const c = updated?.data ?? updated;
          const changed = Object.keys(patch).filter((k) => k !== 'id');
          this.log(
            ctx,
            'EDITED',
            'customer',
            existing.id,
            c?.name || existing.name,
            `Updated ${changed.join(', ')} via Operator (was "${existing.name}")`,
          );
          return {
            result: { id: existing.id, previousName: existing.name, name: c?.name ?? patch.name ?? existing.name, updated: changed },
          };
        },
      },

      {
        name: 'find_item',
        description:
          'Search products/assets by name, SKU or description. Returns the item id and list price. Required to add a stock line to a document.',
        permissions: ['assets:read'],
        input_schema: {
          type: 'object',
          properties: { query: { type: 'string' } },
          required: ['query'],
        },
        run: async (ctx, { query }) => {
          const res: any = await this.assets.getAssets({ page: 1, limit: 5, search: query } as any, ctx.organizationId);
          const docs = res?.docs ?? [];
          return {
            result: docs.map((a: any) => ({
              id: a.id, // used as items[].inventoryItemId (Asset id — products mode)
              name: a.name,
              skuKey: a.skuKey,
              description: a.description,
              price: a.price,
              uom: a.uom || 'PCS',
            })),
          };
        },
      },

      {
        name: 'create_quotation',
        description:
          'Create a DRAFT quotation for a customer. Provide resolved customerId and line items. Prices are looked up automatically when unitPrice is omitted. The draft is NOT sent or confirmed. Always preview it and ask the user to confirm.',
        permissions: ['documents:create-basic'],
        input_schema: {
          type: 'object',
          properties: {
            customerId: { type: 'string', description: 'Customer id from find_customer/create_customer' },
            items: {
              type: 'array',
              description: 'Line items',
              items: {
                type: 'object',
                properties: {
                  itemId: { type: 'string', description: 'Asset id from find_item. Omit for a service/labour line.' },
                  description: { type: 'string' },
                  quantity: { type: 'number' },
                  unitPrice: { type: 'number', description: 'Optional. Defaults to last sold price, else list price' },
                  discount: { type: 'number', description: 'Percent, optional' },
                  isService: { type: 'boolean', description: 'True for labour/service lines with no stock item' },
                },
                required: ['quantity'],
              },
            },
            poNo: { type: 'string' },
            notes: { type: 'string' },
          },
          required: ['customerId', 'items'],
        },
        run: async (ctx, args) => this.createSalesDraft(ctx, 'QUOTATION', args),
      },

      {
        name: 'preview_document',
        description: 'Generate the PDF for a document and send it to the user. Always do this before asking them to confirm.',
        permissions: ['documents:read'],
        input_schema: {
          type: 'object',
          properties: { documentId: { type: 'string' } },
          required: ['documentId'],
        },
        run: async (ctx, { documentId }) => {
          const doc = await this.prisma.document.findFirst({
            where: { id: documentId, organizationId: ctx.organizationId },
            select: { id: true, name: true, type: true, config: true },
          });
          if (!doc) return { result: { error: 'Document not found in this organization' } };
          const url = await this.documents.getOrGeneratePdfUrl(documentId, ctx.organizationId);
          if (!url) return { result: { error: 'Could not generate a PDF for this document' } };
          const cfg: any = doc.config || {};
          const total = cfg.nettTotal ?? cfg.documentInfo?.nettTotal ?? 0;
          return {
            result: { documentId, documentNumber: doc.name, total, sent: true },
            preview: {
              documentId,
              url,
              filename: `${doc.name || doc.type}.pdf`,
              caption: `${doc.type} ${doc.name || ''} | ${cfg.customerName || cfg.customer?.name || ''} | total ${total}`,
            },
          };
        },
      },

      {
        name: 'confirm_document',
        description:
          'Finalize a DRAFT document (quotation, DO, etc). This is irreversible and locks the document. Requires the user to have explicitly confirmed.',
        permissions: ['documents:update'],
        input_schema: {
          type: 'object',
          properties: { documentId: { type: 'string' } },
          required: ['documentId'],
        },
        run: async (ctx, { documentId }) => {
          const doc = await this.prisma.document.findFirst({
            where: { id: documentId, organizationId: ctx.organizationId },
            select: { id: true, name: true, type: true, status: true, config: true },
          });
          if (!doc) return { result: { error: 'Document not found in this organization' } };
          if (doc.status === 'confirmed') return { result: { alreadyConfirmed: true, documentNumber: doc.name } };
          const cfg: any = doc.config || {};
          // Held for explicit user confirmation — never auto-confirmed.
          return {
            result: { needsConfirmation: true, documentNumber: doc.name, type: doc.type },
            pending: {
              kind: 'confirm_quotation',
              documentId: doc.id,
              documentType: doc.type,
              summary: `Confirm ${doc.type} ${doc.name || ''} for ${cfg.customerName || cfg.customer?.name || 'customer'}. Total: ${cfg.nettTotal ?? cfg.documentInfo?.nettTotal ?? 0}`,
              createdAt: new Date().toISOString(),
            },
          };
        },
      },

      {
        name: 'create_invoice',
        description:
          'Create a DRAFT invoice for a customer, same arguments as create_quotation. Does NOT post to the ledger until confirmed.',
        permissions: ['documents:create-basic'],
        input_schema: {
          type: 'object',
          properties: {
            customerId: { type: 'string' },
            items: {
              type: 'array',
              items: {
                type: 'object',
                properties: {
                  itemId: { type: 'string' },
                  description: { type: 'string' },
                  quantity: { type: 'number' },
                  unitPrice: { type: 'number' },
                  discount: { type: 'number' },
                  isService: { type: 'boolean' },
                },
                required: ['quantity'],
              },
            },
            poNo: { type: 'string' },
            notes: { type: 'string' },
          },
          required: ['customerId', 'items'],
        },
        run: async (ctx, args) => this.createSalesDraft(ctx, 'INVOICE', args),
      },

      {
        name: 'create_invoice_from_quotation',
        description:
          'Raise an invoice from an existing quotation, carrying over its customer and line items and linking the two. Use when the customer accepts a quote.',
        permissions: ['documents:create-basic'],
        input_schema: {
          type: 'object',
          properties: { quotationId: { type: 'string', description: 'Quotation document id or number' } },
          required: ['quotationId'],
        },
        run: async (ctx, { quotationId }) => {
          const quote = await this.findDoc(ctx.organizationId, quotationId);
          if (!quote) return { result: { error: 'Quotation not found in this organization' } };

          // Idempotency: don't raise a second invoice from the same quotation.
          const existing = await this.prisma.document.findFirst({
            where: {
              organizationId: ctx.organizationId,
              type: 'INVOICE',
              config: { path: ['sourceDocumentId'], equals: quote.id },
            },
            select: { id: true, name: true },
          });
          if (existing) {
            return { result: { alreadyExists: true, documentId: existing.id, documentNumber: existing.name } };
          }

          const template = await this.templates.getDocumentTemplateByType('INVOICE', ctx.organizationId);
          const templateId = (template as any)?.id ?? (template as any)?.data?.id;
          if (!templateId) return { result: { error: 'No INVOICE template configured for this organization' } };

          // Carry the whole quotation config over, restamp date + lineage.
          const config: any = {
            ...((quote.config as any) || {}),
            date: new Date().toISOString().slice(0, 10),
            sourceDocumentId: quote.id,
            sourceDocumentNumber: quote.name ?? undefined,
            sourceDocumentType: 'QUOTATION',
          };
          const created: any = await this.documents.createBasicDocument(
            templateId,
            'INVOICE',
            ctx.organizationId,
            config,
            (quote as any).projectId ?? undefined,
            ctx.actor,
          );
          const doc = created?.data ?? created;
          this.log(ctx, 'CREATED', 'document', doc?.id, doc?.name, `Invoice raised from ${quote.name} via Operator`);
          return {
            result: {
              documentId: doc?.id,
              documentNumber: doc?.name,
              fromQuotation: quote.name,
              status: doc?.status || 'unconfirmed',
              nettTotal: config.nettTotal ?? config.documentInfo?.nettTotal,
            },
          };
        },
      },

      {
        name: 'confirm_invoice',
        description:
          'Finalize an invoice. This deducts stock and POSTS THE DOUBLE-ENTRY JOURNAL to the ledger and is irreversible. Always requires the user to confirm.',
        permissions: ['documents:update'],
        input_schema: {
          type: 'object',
          properties: { documentId: { type: 'string' } },
          required: ['documentId'],
        },
        run: async (ctx, { documentId }) => {
          const doc = await this.findDoc(ctx.organizationId, documentId);
          if (!doc) return { result: { error: 'Invoice not found in this organization' } };
          if (!['INVOICE', 'TI', 'TI2'].includes(String(doc.type).toUpperCase())) {
            return { result: { error: `${doc.name} is a ${doc.type}, not an invoice. Use confirm_document instead.` } };
          }
          if (doc.status !== 'unconfirmed' && doc.status !== 'draft') {
            return { result: { alreadyConfirmed: true, documentNumber: doc.name, status: doc.status } };
          }
          const cfg: any = doc.config || {};
          return {
            result: { needsConfirmation: true, documentNumber: doc.name, willPostToLedger: true },
            pending: {
              kind: 'confirm_invoice',
              documentId: doc.id,
              documentType: doc.type,
              summary: `Confirm INVOICE ${doc.name} for ${cfg.customerName || cfg.customer?.name || 'customer'}. Total: ${cfg.nettTotal ?? cfg.documentInfo?.nettTotal ?? 0}. This posts to the ledger.`,
              createdAt: new Date().toISOString(),
            },
          };
        },
      },

      {
        name: 'list_open_invoices',
        description: "List a customer's unpaid invoices with outstanding amounts. Use to answer 'what does X owe' and before recording a payment.",
        permissions: ['documents:read'],
        input_schema: {
          type: 'object',
          properties: { customerId: { type: 'string' } },
          required: ['customerId'],
        },
        run: async (ctx, { customerId }) => {
          const open = await this.receipts.openInvoices(ctx.organizationId, customerId);
          const total = (open || []).reduce((s: number, o: any) => s + (Number(o.outstanding) || 0), 0);
          return { result: { invoices: open, totalOutstanding: round2(total) } };
        },
      },

      {
        name: 'record_payment',
        description:
          'Record a customer payment against ONE invoice. Moves money in the books, so it always requires the user to confirm.',
        permissions: ['payments:create'],
        input_schema: {
          type: 'object',
          properties: {
            customerId: { type: 'string' },
            documentId: { type: 'string', description: 'The invoice being paid' },
            amount: { type: 'number' },
            paymentMethod: { type: 'string', description: 'e.g. BANK TRANSFER, PAYNOW, CHEQUE, CASH' },
            paymentDate: { type: 'string', description: 'ISO date; defaults to today' },
            reference: { type: 'string' },
          },
          required: ['customerId', 'documentId', 'amount'],
        },
        run: async (ctx, args) => {
          const doc = await this.findDoc(ctx.organizationId, args.documentId);
          if (!doc) return { result: { error: 'Invoice not found in this organization' } };
          const cfg: any = doc.config || {};
          return {
            result: { needsConfirmation: true, documentNumber: doc.name, amount: args.amount },
            pending: {
              kind: 'record_payment',
              documentId: doc.id,
              summary: `Record payment of ${args.amount} against ${doc.name} (${cfg.customerName || cfg.customer?.name || 'customer'})`,
              args: { ...args, documentId: doc.id },
              createdAt: new Date().toISOString(),
            },
          };
        },
      },

      {
        name: 'aged_receivables',
        description: 'Aged receivables summary for the organization: who owes what, bucketed by age.',
        permissions: ['documents:read'],
        input_schema: { type: 'object', properties: { asOf: { type: 'string', description: 'ISO date, optional' } } },
        run: async (ctx, { asOf }) => {
          const rep: any = await this.xeroReports.aged(ctx.organizationId, 'receivable', { level: 'summary', asOf });
          const data = rep?.data ?? rep;
          const rows = (data?.rows || []).slice(0, 20).map((r: any) => ({
            contact: r.contactName,
            total: r.total,
            buckets: r.buckets,
          }));
          return { result: { grandTotal: data?.grandTotal, rows } };
        },
      },

      // ── Purchasing / AP ────────────────────────────────────────────────────
      {
        name: 'find_supplier',
        description: 'Search suppliers by name or code. Use before creating a bill or purchase order.',
        permissions: ['suppliers:read'],
        input_schema: { type: 'object', properties: { query: { type: 'string' } }, required: ['query'] },
        run: async (ctx, { query }) => {
          const res: any = await this.suppliers.getSuppliers({ page: 1, limit: 5, search: query } as any, ctx.organizationId);
          const docs = res?.docs ?? res?.data?.docs ?? [];
          return {
            result: docs.map((s: any) => ({ id: s.id, name: s.name, supplierCode: s.supplierCode, email: s.email })),
          };
        },
      },

      {
        name: 'list_bills',
        description: 'List supplier bills (accounts payable), optionally filtered by status or supplier.',
        permissions: ['bills:read'],
        input_schema: {
          type: 'object',
          properties: {
            status: { type: 'string', description: 'e.g. unconfirmed, awaiting_payment, paid, void' },
            supplierId: { type: 'string' },
            limit: { type: 'number' },
          },
        },
        run: async (ctx, { status, supplierId, limit }) => {
          const res: any = await this.bills.list(ctx.organizationId, {
            status,
            supplierId,
            limit: Math.min(Number(limit) || 10, 25),
          });
          const rows = (res?.data ?? res ?? []).slice(0, 25).map((b: any) => ({
            id: b.id,
            billNumber: b.billNumber ?? b.name,
            supplier: b.supplierName ?? b.supplier?.name,
            date: b.billDate ?? b.date,
            total: b.totalAmount ?? b.total,
            status: b.status,
          }));
          return { result: rows };
        },
      },

      {
        name: 'create_bill',
        description:
          'Record a supplier bill (accounts payable). Creates it UNPOSTED for review. Use post_bill afterwards to put it in the ledger.',
        permissions: ['bills:create'],
        input_schema: {
          type: 'object',
          properties: {
            supplierId: { type: 'string', description: 'From find_supplier' },
            supplierName: { type: 'string', description: 'Used only when supplierId is unknown' },
            billNumber: { type: 'string', description: "The supplier's own invoice number" },
            billDate: { type: 'string', description: 'ISO date' },
            dueDate: { type: 'string' },
            reference: { type: 'string' },
            lines: {
              type: 'array',
              items: {
                type: 'object',
                properties: {
                  description: { type: 'string' },
                  quantity: { type: 'number' },
                  unitPrice: { type: 'number' },
                  amount: { type: 'number' },
                  accountCode: { type: 'string' },
                },
              },
            },
          },
          required: ['billNumber', 'billDate'],
        },
        run: async (ctx, args) => {
          const created: any = await this.bills.create(
            ctx.organizationId,
            ctx.actor.id,
            {
              supplierId: args.supplierId,
              supplierName: args.supplierName ? cleanText(args.supplierName) : undefined,
              billNumber: cleanText(args.billNumber),
              billDate: args.billDate,
              dueDate: args.dueDate,
              reference: args.reference ? cleanText(args.reference) : undefined,
              lines: (args.lines || []).map((l: any) => ({
                ...l,
                description: cleanText(l.description || ''),
              })),
            } as any,
            // Machine intake: leave it for review rather than posting silently.
            { postOnSave: false } as any,
          );
          const b = created?.data ?? created;
          this.log(ctx, 'CREATED', 'document', b?.id, b?.billNumber ?? b?.name, 'Bill created via Operator');
          return { result: { id: b?.id, billNumber: b?.billNumber ?? b?.name, status: b?.status ?? 'unconfirmed' } };
        },
      },

      {
        name: 'post_bill',
        description: 'Post a bill to the general ledger. This creates the journal entry and is irreversible, so it needs confirmation.',
        permissions: ['bills:update'],
        input_schema: { type: 'object', properties: { billId: { type: 'string' } }, required: ['billId'] },
        run: async (ctx, { billId }) => {
          const bill = await this.prisma.document.findFirst({
            where: { id: billId, organizationId: ctx.organizationId, type: 'BILL' },
            select: { id: true, name: true, status: true, config: true },
          });
          if (!bill) return { result: { error: 'Bill not found in this organization' } };
          const cfg: any = bill.config || {};
          return {
            result: { needsConfirmation: true, billNumber: bill.name, willPostToLedger: true },
            pending: {
              kind: 'post_bill',
              documentId: bill.id,
              summary: `Post BILL ${bill.name} from ${cfg.supplierName || cfg.supplier?.name || 'supplier'} to the ledger. Total: ${cfg.totalAmount ?? cfg.nettTotal ?? 0}`,
              createdAt: new Date().toISOString(),
            },
          };
        },
      },

      // ── Other document types ───────────────────────────────────────────────
      {
        name: 'create_delivery_order',
        description:
          'Create a DRAFT delivery order (DO) for a customer, usually from a confirmed quotation. Same line item format as create_quotation.',
        permissions: ['documents:create-basic'],
        input_schema: {
          type: 'object',
          properties: {
            customerId: { type: 'string' },
            items: {
              type: 'array',
              items: {
                type: 'object',
                properties: {
                  itemId: { type: 'string' },
                  description: { type: 'string' },
                  quantity: { type: 'number' },
                  unitPrice: { type: 'number' },
                  isService: { type: 'boolean' },
                },
                required: ['quantity'],
              },
            },
            notes: { type: 'string' },
          },
          required: ['customerId', 'items'],
        },
        run: async (ctx, args) => this.createSalesDraft(ctx, 'DO' as any, args),
      },

      {
        name: 'create_credit_note',
        description:
          'Create a DRAFT credit note for a customer (refund or reduction of a previous invoice). Confirming it posts a reversing journal.',
        permissions: ['documents:create-basic'],
        input_schema: {
          type: 'object',
          properties: {
            customerId: { type: 'string' },
            items: {
              type: 'array',
              items: {
                type: 'object',
                properties: {
                  itemId: { type: 'string' },
                  description: { type: 'string' },
                  quantity: { type: 'number' },
                  unitPrice: { type: 'number' },
                  isService: { type: 'boolean' },
                },
                required: ['quantity'],
              },
            },
            notes: { type: 'string' },
          },
          required: ['customerId', 'items'],
        },
        run: async (ctx, args) => this.createSalesDraft(ctx, 'CREDIT_NOTE' as any, args),
      },

      // ── Inventory / projects / reporting ───────────────────────────────────
      {
        name: 'check_stock',
        description: 'Check stock on hand for an item, by name, SKU or serial number.',
        permissions: ['inventories:read'],
        input_schema: { type: 'object', properties: { query: { type: 'string' } }, required: ['query'] },
        run: async (ctx, { query }) => {
          const res: any = await this.inventories.getInventories(
            { page: 1, limit: 10, search: query } as any,
            ctx.organizationId,
          );
          const docs = res?.docs ?? [];
          const byStatus: Record<string, number> = {};
          for (const d of docs) byStatus[d.status || 'unknown'] = (byStatus[d.status || 'unknown'] || 0) + 1;
          return {
            result: {
              matched: res?.totalDocuments ?? docs.length,
              byStatus,
              sample: docs.slice(0, 5).map((d: any) => ({
                sku: d.sku,
                serialNumber: d.serialNumber,
                status: d.status,
                item: d.asset?.name,
              })),
            },
          };
        },
      },

      {
        name: 'list_projects',
        description: 'List projects in this organization, optionally filtered by a search term.',
        permissions: ['projects:read'],
        input_schema: { type: 'object', properties: { query: { type: 'string' }, limit: { type: 'number' } } },
        run: async (ctx, { query, limit }) => {
          const res: any = await this.projects.getProjects(
            { page: 1, limit: Math.min(Number(limit) || 10, 25), search: query } as any,
            ctx.organizationId,
          );
          const docs = res?.docs ?? [];
          return {
            result: docs.map((p: any) => ({ id: p.id, name: p.name, status: p.status, customer: p.customer?.name })),
          };
        },
      },

      {
        name: 'sales_by_customer',
        description: 'Sales totals grouped by customer for a date range. Use for "who are our biggest customers" style questions.',
        permissions: ['documents:read'],
        input_schema: {
          type: 'object',
          properties: { startDate: { type: 'string' }, endDate: { type: 'string' } },
        },
        run: async (ctx, { startDate, endDate }) => {
          const res: any = await this.statements.salesByCustomer(ctx.organizationId, startDate, endDate);
          const data = res?.data ?? res;
          const rows = (Array.isArray(data) ? data : data?.rows || []).slice(0, 20);
          return { result: rows };
        },
      },

      {
        name: 'aged_payables',
        description: 'Aged payables summary: what this organization owes suppliers, bucketed by age.',
        permissions: ['bills:read'],
        input_schema: { type: 'object', properties: { asOf: { type: 'string' } } },
        run: async (ctx, { asOf }) => {
          const rep: any = await this.xeroReports.aged(ctx.organizationId, 'payable', { level: 'summary', asOf });
          const data = rep?.data ?? rep;
          return {
            result: {
              grandTotal: data?.grandTotal,
              rows: (data?.rows || []).slice(0, 20).map((r: any) => ({ contact: r.contactName, total: r.total })),
            },
          };
        },
      },

      {
        name: 'gst_report',
        description: 'GST summary for a period: output tax, input tax and the net position.',
        permissions: ['documents:read'],
        input_schema: {
          type: 'object',
          properties: { from: { type: 'string' }, to: { type: 'string' } },
        },
        run: async (ctx, { from, to }) => {
          const rep: any = await this.xeroReports.gstReport(ctx.organizationId, { from, to });
          return { result: rep?.data ?? rep };
        },
      },

      {
        name: 'email_document',
        description:
          'Email an invoice or quotation (with its PDF attached) to one or more recipients. Only invoices and quotations can be emailed. This sends externally, so it is confirmed before sending.',
        permissions: ['documents:send-email'],
        input_schema: {
          type: 'object',
          properties: {
            documentId: { type: 'string', description: 'Invoice/quotation id or number' },
            to: { type: 'array', items: { type: 'string' }, description: 'Recipient email address(es)' },
            cc: { type: 'array', items: { type: 'string' } },
            subject: { type: 'string', description: 'Optional; a sensible default is used if omitted' },
            message: { type: 'string', description: 'Optional email body; a sensible default is used if omitted' },
          },
          required: ['documentId', 'to'],
        },
        run: async (ctx, args) => {
          const doc = await this.findDoc(ctx.organizationId, args.documentId);
          if (!doc) return { result: { error: 'Document not found in this organization' } };
          const t = String(doc.type).toUpperCase();
          if (!['INVOICE', 'TI', 'TI2', 'QUOTATION', 'QO', 'QO1', 'QO2', 'QT'].includes(t)) {
            return { result: { error: `Only invoices and quotations can be emailed. ${doc.name} is a ${doc.type}.` } };
          }
          const to = (Array.isArray(args.to) ? args.to : [args.to]).map((x: any) => String(x).trim()).filter(Boolean);
          if (!to.length) return { result: { error: 'At least one recipient email is required.' } };
          const cfg: any = doc.config || {};
          const kind = ['QUOTATION', 'QO', 'QO1', 'QO2', 'QT'].includes(t) ? 'Quotation' : 'Invoice';
          return {
            result: { needsConfirmation: true, documentNumber: doc.name, to },
            pending: {
              kind: 'email_document',
              documentId: doc.id,
              summary: `Email ${kind} ${doc.name} (${cfg.customerName || cfg.customer?.name || ''}) to ${to.join(', ')}`,
              args: {
                to,
                cc: Array.isArray(args.cc) ? args.cc : undefined,
                subject: args.subject ? cleanText(args.subject) : `${kind} ${doc.name} from ${ctx.organizationName}`,
                message: args.message
                  ? cleanText(args.message)
                  : `Dear ${cfg.customerName || cfg.customer?.name || 'Customer'},\n\nPlease find attached ${kind.toLowerCase()} ${doc.name}.\n\nThank you.`,
              },
              createdAt: new Date().toISOString(),
            },
          };
        },
      },

      {
        name: 'get_document',
        description: 'Fetch a document by its number (e.g. QO2026-001) or id, with its customer, totals and status.',
        permissions: ['documents:read'],
        input_schema: {
          type: 'object',
          properties: { numberOrId: { type: 'string' } },
          required: ['numberOrId'],
        },
        run: async (ctx, { numberOrId }) => {
          const doc = await this.findDoc(ctx.organizationId, numberOrId);
          if (!doc) return { result: { error: 'Not found' } };
          const cfg: any = doc.config || {};
          return {
            result: {
              id: doc.id,
              documentNumber: doc.name,
              type: doc.type,
              status: doc.status,
              customer: cfg.customerName || cfg.customer?.name,
              subTotal: cfg.subTotal ?? cfg.documentInfo?.subTotal,
              gstAmount: cfg.gstAmount ?? cfg.documentInfo?.gstAmount,
              nettTotal: cfg.nettTotal ?? cfg.documentInfo?.nettTotal,
              itemCount: Array.isArray(cfg.items) ? cfg.items.length : 0,
              createdAt: doc.createdAt,
            },
          };
        },
      },

      {
        name: 'list_recent_documents',
        description: 'List this organization\'s most recent documents, optionally filtered by type (QUOTATION, INVOICE, DO...).',
        permissions: ['documents:read'],
        input_schema: {
          type: 'object',
          properties: { type: { type: 'string' }, limit: { type: 'number' } },
        },
        run: async (ctx, { type, limit }) => {
          const docs = await this.prisma.document.findMany({
            where: { organizationId: ctx.organizationId, ...(type ? { type } : {}) },
            orderBy: { createdAt: 'desc' },
            take: Math.min(Number(limit) || 5, 20),
            select: { id: true, name: true, type: true, status: true, config: true },
          });
          return {
            result: docs.map((d) => {
              const cfg: any = d.config || {};
              return {
                id: d.id,
                documentNumber: d.name,
                type: d.type,
                status: d.status,
                customer: cfg.customerName || cfg.customer?.name,
                total: cfg.nettTotal ?? cfg.documentInfo?.nettTotal,
              };
            }),
          };
        },
      },
    ];
  }

  // ── Document building ──────────────────────────────────────────────────────

  /**
   * Build and persist a sales draft. The backend performs NO pricing and NO
   * totals maths on this path (the portal editor does it client-side), so
   * everything is computed here — see AIMS_OPERATOR_AGENT_PLAN.md §9.3.
   */
  private async createSalesDraft(ctx: OperatorContext, type: 'QUOTATION' | 'INVOICE', args: any): Promise<ToolOutcome> {
    const customer = await this.prisma.customer.findFirst({
      where: { id: args.customerId, organizationId: ctx.organizationId },
    });
    if (!customer) return { result: { error: 'Customer not found in this organization' } };

    const org = await this.prisma.organization.findUnique({
      where: { id: ctx.organizationId },
      select: { name: true, address: true, phoneNumber: true, registrationNumber: true, taxRate: true, taxApplicable: true, absorbTax: true, defaultCurrency: true },
    });

    const gstPercent = Number(org?.taxRate ?? 9) || 0;
    // The org stores booleans; the document config uses 'Y'/'N' STRINGS.
    const taxApplicable = org?.taxApplicable === false ? 'N' : 'Y';
    const absorbTax = org?.absorbTax === true ? 'Y' : 'N';

    const items: any[] = [];
    for (const [i, raw] of (args.items || []).entries()) {
      const quantity = Number(raw.quantity) || 0;
      let unitPrice = raw.unitPrice != null ? Number(raw.unitPrice) : undefined;
      let asset: any = null;

      if (raw.itemId) {
        asset = await this.prisma.asset.findFirst({
          where: { id: raw.itemId, organizationId: ctx.organizationId },
          select: { id: true, name: true, skuKey: true, description: true, price: true, uom: true, salesAccountCode: true },
        });
        if (!asset) return { result: { error: `Item ${raw.itemId} not found in this organization` } };
        if (unitPrice == null) {
          // Prefer what this customer last paid, else the list price.
          const last = await this.priceHistory
            .getLastSoldPrice(asset.id, ctx.organizationId, customer.id)
            .catch(() => null);
          unitPrice = Number(last?.unitPrice ?? asset.price ?? 0);
        }
      }
      if (unitPrice == null) unitPrice = 0;

      const discount = Number(raw.discount) || 0;
      const amount = round2(quantity * unitPrice * (1 - discount / 100));
      const isService = !!raw.isService || !raw.itemId;

      items.push({
        id: Date.now() + i,
        inventoryItemId: asset ? asset.id : '', // Asset id (products mode); '' for service lines
        ...(isService ? { isService: true } : {}),
        itemCode: cleanText(asset?.skuKey || raw.itemCode || ''),
        description: cleanText(raw.description || asset?.description || asset?.name || ''),
        uom: asset?.uom || raw.uom || (isService ? 'HR' : 'PCS'),
        quantity,
        unitPrice, // NOT `price` — every reader uses unitPrice
        discount,
        amount, // caller-supplied; nothing derives it on write
        tax: gstPercent,
        accountCode: asset?.salesAccountCode || null,
      });
    }

    const grossTotal = round2(items.reduce((s, it) => s + (Number(it.amount) || 0), 0));
    const subTotal = grossTotal;
    const gstAmount =
      taxApplicable === 'N'
        ? 0
        : absorbTax === 'Y'
          ? round2((subTotal * gstPercent) / (100 + gstPercent))
          : round2((subTotal * gstPercent) / 100);
    const nettTotal = absorbTax === 'Y' || taxApplicable === 'N' ? subTotal : round2(subTotal + gstAmount);

    const today = new Date();
    const dateStr = today.toISOString().slice(0, 10);
    const dueStr = new Date(today.getTime() + 30 * 86400_000).toISOString().slice(0, 10);
    const currency = org?.defaultCurrency || 'SGD';

    const totals = { subTotal, gstAmount, nettTotal, grossTotal, discountAmount: 0 };
    const shared = {
      date: dateStr,
      currency,
      gstPercent,
      taxApplicable,
      absorbTax,
      poNo: args.poNo || '',
      referenceNo: args.referenceNo || '',
    };

    // Totals/date live BOTH at top level and under documentInfo — different
    // readers prefer different placements.
    const config: any = {
      company: { name: org?.name, address: org?.address, phoneNumber: org?.phoneNumber },
      gstRegNo: org?.registrationNumber || undefined,

      customerId: customer.id,
      customer: {
        id: customer.id,
        name: customer.name,
        address: (customer as any).address,
        email: (customer as any).email,
        customerCode: (customer as any).customerCode,
      },
      customerName: customer.name,
      customerCode: (customer as any).customerCode,
      customerAddress: (customer as any).address,
      customerEmail: (customer as any).email,

      items,
      ...shared,
      ...totals,
      dueDate: dueStr,
      note: args.notes ? cleanText(args.notes) : undefined,
      documentInfo: { ...shared, ...totals },
    };

    const template = await this.templates.getDocumentTemplateByType(type, ctx.organizationId);
    const templateId = (template as any)?.id ?? (template as any)?.data?.id;
    if (!templateId) return { result: { error: `No ${type} template configured for this organization` } };

    const created: any = await this.documents.createBasicDocument(
      templateId,
      type,
      ctx.organizationId,
      config,
      undefined,
      ctx.actor,
    );
    const doc = created?.data ?? created;

    this.log(ctx, 'CREATED', 'document', doc?.id, doc?.name, `Created ${type} via Operator (${ctx.channel})`);

    return {
      result: {
        documentId: doc?.id,
        documentNumber: doc?.name,
        type,
        status: doc?.status || 'unconfirmed',
        customer: customer.name,
        lineCount: items.length,
        subTotal,
        gstAmount,
        nettTotal,
      },
    };
  }

  /** Resolve a document by id OR document number, scoped to the org.
   *  `id` is a uuid column — passing a document number like "QO1202608-001"
   *  makes Postgres throw 22P02, so only match on id when it IS a uuid. */
  private async findDoc(organizationId: string, idOrNumber: string) {
    const key = String(idOrNumber ?? '').trim();
    const isUuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(key);
    return this.prisma.document.findFirst({
      where: {
        organizationId,
        ...(isUuid ? { id: key } : { name: { equals: key, mode: 'insensitive' } }),
      },
      select: {
        id: true,
        name: true,
        type: true,
        status: true,
        config: true,
        documentTemplateId: true,
        projectId: true,
        createdAt: true,
      },
    });
  }

  /** Execute a held action after the user confirms it in chat. */
  async runPending(ctx: OperatorContext, pending: PendingAction): Promise<{ ok: boolean; message: string }> {
    if (pending.kind === 'post_bill') {
      const bill = await this.prisma.document.findFirst({
        where: { id: pending.documentId!, organizationId: ctx.organizationId, type: 'BILL' },
        select: { id: true, name: true },
      });
      if (!bill) return { ok: false, message: 'That bill no longer exists.' };
      await this.bills.post(ctx.organizationId, bill.id, ctx.actor.id);
      this.log(ctx, 'APPROVED', 'document', bill.id, bill.name, `Bill posted via Operator (${ctx.channel})`);
      return { ok: true, message: `✅ Bill ${bill.name} posted to the ledger.` };
    }

    if (pending.kind === 'email_document') {
      const a = pending.args || {};
      await this.documents.sendInvoiceEmail(
        pending.documentId!,
        { to: a.to, cc: a.cc, subject: a.subject, message: a.message } as any,
        ctx.organizationId,
        ctx.actor,
      );
      this.log(ctx, 'SENT', 'document', pending.documentId, undefined, `Emailed to ${(a.to || []).join(', ')} via Operator (${ctx.channel})`);
      return { ok: true, message: `✅ Emailed to ${(a.to || []).join(', ')}.` };
    }

    if (pending.kind === 'confirm_invoice') {
      const doc = await this.findDoc(ctx.organizationId, pending.documentId!);
      if (!doc) return { ok: false, message: 'That invoice no longer exists.' };
      if (doc.status !== 'unconfirmed' && doc.status !== 'draft') {
        return { ok: true, message: `${doc.name} was already confirmed.` };
      }
      // Deducts stock (unless derived from another doc) and auto-posts the GL.
      await this.documents.confirmInvoice(
        doc.id,
        { fromInvoiceNo: doc.name || '', toInvoiceNo: doc.name || '' },
        ctx.organizationId,
        ctx.actor,
      );
      this.log(ctx, 'STATUS_CHANGED', 'document', doc.id, doc.name, `Invoice confirmed + posted via Operator (${ctx.channel})`);
      return { ok: true, message: `✅ Invoice ${doc.name} confirmed and posted to the ledger.` };
    }

    if (pending.kind === 'record_payment') {
      const a = pending.args || {};
      const created: any = await this.payments.create(
        {
          customerId: a.customerId,
          documentId: a.documentId,
          amount: Number(a.amount),
          paymentDate: a.paymentDate || new Date().toISOString(),
          paymentMethod: a.paymentMethod || 'BANK TRANSFER',
          reference: a.reference,
        } as any,
        ctx.organizationId,
        ctx.actor.id,
      );
      const pay = created?.data ?? created;
      // PaymentsService does not write an audit log of its own.
      this.log(ctx, 'PAYMENT', 'document', a.documentId, undefined, `Payment ${a.amount} recorded via Operator (${ctx.channel})`);
      return { ok: true, message: `✅ Payment of ${a.amount} recorded${pay?.document?.name ? ` against ${pay.document.name}` : ''}.` };
    }

    if (pending.kind === 'confirm_quotation') {
      const doc = await this.prisma.document.findFirst({
        where: { id: pending.documentId!, organizationId: ctx.organizationId },
        select: { id: true, name: true, type: true, status: true, documentTemplateId: true },
      });
      if (!doc) return { ok: false, message: 'That document no longer exists.' };
      if (doc.status === 'confirmed') return { ok: true, message: `${doc.type} ${doc.name} was already confirmed.` };
      // Confirm WITHOUT sending config — updateDocument rejects config edits on
      // a confirmed doc, and we only want the status transition here.
      await this.documents.updateDocument(
        { id: doc.id, type: doc.type, status: 'confirmed', documentTemplateId: doc.documentTemplateId } as any,
        ctx.organizationId,
        ctx.actor,
      );
      this.log(ctx, 'STATUS_CHANGED', 'document', doc.id, doc.name, `Confirmed via Operator (${ctx.channel})`);
      return { ok: true, message: `✅ ${doc.type} ${doc.name} confirmed.` };
    }
    return { ok: false, message: 'Nothing to confirm.' };
  }

  private log(
    ctx: OperatorContext,
    action: string,
    resource: string,
    resourceId?: string,
    resourceName?: string,
    detail?: string,
  ) {
    this.audit
      .logAction({
        userId: ctx.actor.id || 'operator',
        userName: ctx.actor.name,
        userEmail: ctx.actor.email,
        action,
        resource,
        resourceId,
        resourceName,
        organizationId: ctx.organizationId,
        details: { detail, channel: ctx.channel, via: 'operator' },
      })
      .catch(() => null);
  }
}
