import { DeliveriesService } from '../deliveries/deliveries.service';
import { Injectable, Logger } from '@nestjs/common';
import type Anthropic from '@anthropic-ai/sdk';
import { PrismaService } from '../common/prisma.service';
import { XeroSyncService } from '../xero-sync/xero-sync.service';
import { BankRecService } from '../bank-rec/bank-rec.service';
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
import { ProjectCostingService } from '../project-costing/project-costing.service';
import { RevenueItemsService } from '../revenue-items/revenue-items.service';
import { MarketingService } from '../marketing/marketing.service';
import { LeadsService } from '../leads/leads.service';
import { S3Service } from '../common/services/s3.service';
import { OperatorAuthService } from './operator-auth.service';
import { PublicDocumentService } from '../public-document/public-document.service';
import { OperatorContext, PendingAction } from './operator.types';
import { cleanText } from './text.util';
import { ActionLogService } from '../action-log/action-log.service';
import { runAsOrg } from '../common/tenancy/tenant-context';
import {
  compact,
  matchCustomer,
  matchItem,
  matchProject,
  orderLineCovers,
  parseLine,
  parseWhen,
  sameCustomer,
  sgtYmd,
} from './delivery-intake';

/** What a tool hands back to the loop. `pending` asks the caller to raise a
 *  confirm prompt instead of proceeding. */
export interface ToolOutcome {
  result: any;
  pending?: PendingAction;
  /** A document PDF to push to the user before the model's final text. */
  preview?: { documentId: string; url: string; filename: string; caption: string };
  /** A line the SYSTEM sends to the user as-is, before the model replies. For
   *  refusals that must never depend on the model's wording. */
  notice?: string;
}

/** What a confirmed card hands back: the reply, an optional document to send
 *  first, and a note for the model's history (ids, numbers). */
export interface PendingResult {
  ok: boolean;
  message: string;
  preview?: { url: string; filename: string; caption: string };
  note?: string;
}

interface ToolDef {
  name: string;
  description: string;
  permissions: string[];
  input_schema: Anthropic.Tool['input_schema'];
  run: (ctx: OperatorContext, args: any) => Promise<ToolOutcome>;
  /** The tool changes data. Calling it does NOT run it: execute() holds the
   *  call behind a Confirm card and runPending runs it on Confirm. A function
   *  decides per call (confirm_invoices_from_xero only writes without dryRun). */
  writes?: boolean | ((args: any) => boolean);
  /** The tool writes its own Activity Log row (this.log); otherwise runPending
   *  writes a generic one for it. */
  logs?: boolean;
}

/** What the card says a held tool call will do. */
const WRITE_VERBS: Record<string, string> = {
  create_customer: 'Create a new customer',
  update_customer: 'Update a customer',
  create_quotation: 'Create a DRAFT quotation',
  create_invoice: 'Create a DRAFT invoice',
  create_invoice_from_quotation: 'Raise a DRAFT invoice from a quotation',
  create_delivery_order: 'Create a DRAFT delivery order document',
  create_credit_note: 'Create a DRAFT credit note',
  edit_document: 'Edit a document',
  create_bill: 'Record a supplier bill (unposted)',
  set_appointment: 'Set a lead appointment',
  translate_quotation: 'Translate a quotation to Chinese',
  confirm_invoices_from_xero: "Pull Xero's approvals into AIMS: mark invoices paid, re-total to Xero, void duplicate journals",
};

/** Tools whose result is a document worth sending straight back as a preview. */
const DOC_CREATORS = new Set(['create_quotation', 'create_invoice', 'create_invoice_from_quotation', 'create_credit_note']);
const DOC_LABELS: Record<string, string> = {
  create_quotation: 'Quotation',
  create_invoice: 'Invoice',
  create_invoice_from_quotation: 'Invoice',
  create_credit_note: 'Credit note',
  create_delivery_order: 'Delivery order',
};
/** Activity Log resource + action chip for a confirmed tool call that does not log itself. */
const TOOL_LOG: Record<string, [string, string]> = {
  set_appointment: ['lead', 'UPDATE'],
  translate_quotation: ['document', 'TRANSLATE'],
  confirm_invoices_from_xero: ['xero-sync', 'CONFIRM'],
};

/** Legacy audit verbs → the Activity Log's semantic action chips. */
const ACTION_CHIPS: Record<string, string> = {
  CREATED: 'CREATE',
  EDITED: 'UPDATE',
  UPDATED: 'UPDATE',
  STATUS_CHANGED: 'CONFIRM',
  APPROVED: 'POST_GL',
  SENT: 'SEND',
  PAYMENT: 'PAYMENT',
  ERROR: 'ERROR',
};

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const round2 = (n: number) => Math.round((Number(n) || 0) * 100) / 100;

/**
 * Endpoints api_write must never reach: they post journals, move money, change
 * who can log in, or cannot be undone. Each has a dedicated tool with its own
 * preview and wording, and a hand-built body is not the way in. DELETE is
 * already excluded by the method whitelist; these catch the POST/PATCH verbs
 * that are just as final.
 */
const BLOCKED_WRITE_PATHS: RegExp[] = [
  /\/payments(\/|$)/i,
  /\/receipts(\/|$)/i,
  /\/journal(\/|$)/i,
  /\/bank-rec(\/|$)/i,
  /\/close(\/|$)/i,
  /\/posting-queue(\/|$)/i,
  /\/confirm(\/|$)/i,
  /\/post(\/|$)/i,
  /\/void(\/|$)/i,
  /\/delete(\/|$)/i,
  /\/organizations(\/|$)/i, // org + feature-flag changes stay an admin action
  /\/users(\/|$)/i,
  /\/roles(\/|$)/i,
  /\/permissions(\/|$)/i,
  /\/api-keys(\/|$)/i,
  /\/operator\/(link|identities)(\/|$)/i, // no self-granting a new identity
];

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
    private readonly costing: ProjectCostingService,
    private readonly revenueItems: RevenueItemsService,
    private readonly marketing: MarketingService,
    private readonly leads: LeadsService,
    private readonly deliveries: DeliveriesService,
    private readonly publicDocuments: PublicDocumentService,
    private readonly xeroSync: XeroSyncService,
    private readonly bankRec: BankRecService,
    private readonly s3: S3Service,
    private readonly auth: OperatorAuthService,
    private readonly actionLog: ActionLogService,
  ) {}

  /** Extract a just-uploaded invoice/receipt (project-agnostic) and store the
   *  original, so the turn's tools can turn it into a project cost. Returns the
   *  data to stamp on ctx.upload. Never throws — extraction failures still keep
   *  the stored file so the user can fill fields in manually. */
  async extractUpload(
    organizationId: string,
    dataUri: string,
    mimetype: string,
    filename?: string,
  ): Promise<OperatorContext['upload']> {
    const commaIdx = dataUri.indexOf(',');
    const raw = commaIdx >= 0 ? dataUri.slice(commaIdx + 1) : dataUri;
    const ext = mimetype.includes('pdf') ? 'pdf' : mimetype.includes('png') ? 'png' : mimetype.includes('webp') ? 'webp' : 'jpg';
    const safe = (filename || 'invoice').replace(/[^a-zA-Z0-9._-]/g, '_');
    const key = `project-costs/${organizationId}/whatsapp/${Date.now()}-${safe}.${ext}`;
    const media = (mimetype.includes('pdf')
      ? 'application/pdf'
      : mimetype.includes('png')
        ? 'image/png'
        : mimetype.includes('webp')
          ? 'image/webp'
          : 'image/jpeg') as any;
    const [attachmentUrl, extracted] = await Promise.all([
      this.s3.uploadFile(key, Buffer.from(raw, 'base64'), media).catch(() => null),
      this.bills.extractFromFile(organizationId, dataUri, media).catch(() => null as any),
    ]);
    const lines: any[] = Array.isArray(extracted?.lines) ? extracted.lines : [];
    const description = lines.length
      ? lines.map((l) => String(l.description || '').split('\n')[0]).filter(Boolean).slice(0, 4).join('; ')
      : extracted?.supplierName
        ? `${extracted.supplierName} invoice`
        : '';
    return {
      attachmentUrl,
      attachmentKey: attachmentUrl ? key : null,
      filename,
      extracted: {
        supplierName: extracted?.supplierName ?? null,
        invoiceNo: extracted?.billNumber ?? null,
        date: extracted?.billDate ?? null,
        amount: Number(extracted?.totalAmount ?? extracted?.subtotal) || null,
        description: description || null,
        currency: extracted?.currency ?? 'SGD',
        siteAddress: extracted?.siteAddress ?? null,
      },
      lines: Array.isArray(extracted?.lines) ? extracted.lines : null,
      taxAmount: Number(extracted?.taxAmount) || null,
    };
  }

  /**
   * Turn an uploaded PO/quotation into a SALES_ORDER so a held delivery run can
   * point at it. Lines keep whatever the extractor found (description/qty/price)
   * — a free-text line is still a valid Sale Order line here, and coded ones
   * are what a later invoice prices from.
   */
  async createSaleOrderFromUpload(
    ctx: OperatorContext,
    up: NonNullable<OperatorContext['upload']>,
    customerName?: string,
    projectId?: string,
  ): Promise<{ id: string; name: string } | null> {
    const template = await this.templates.getDocumentTemplateByType('SALES_ORDER', ctx.organizationId).catch(() => null);
    if (!template?.id) return null;
    const e: any = up.extracted || {};
    const items = (up.lines || []).map((l: any, i: number) => ({
      id: i + 1,
      description: String(l.description || '').trim(),
      quantity: Number(l.quantity) || 1,
      ...(Number(l.unitPrice) ? { unitPrice: Number(l.unitPrice) } : {}),
      ...(Number(l.amount) ? { amount: Number(l.amount) } : {}),
      ...(l.itemCode ? { itemCode: String(l.itemCode) } : {}),
    }));
    const config: any = {
      customer: customerName || e.supplierName || undefined,
      referenceNo: e.invoiceNo || undefined,
      date: e.date || new Date().toISOString(),
      items: items.length ? items : [{ id: 1, description: e.description || up.filename || 'Uploaded order', quantity: 1 }],
      ...(e.amount ? { nettTotal: e.amount } : {}),
      ...(up.attachmentUrl ? { sourceFileUrl: up.attachmentUrl } : {}),
    };
    const created: any = await this.documents
      .createBasicDocument(template.id, 'SALES_ORDER', ctx.organizationId, config, projectId, ctx.actor as any)
      .catch(() => null);
    if (!created?.id) return null;
    this.log(ctx, 'CREATED', 'document', created.id, created.name, `Sale Order from an uploaded PO via Operator (${ctx.channel})`);
    return { id: created.id, name: created.name };
  }

  /** Projects with their site address — for matching an uploaded invoice's
   *  site/project address to the right project. */
  async listProjectsForMatch(organizationId: string): Promise<Array<{ id: string; name: string; address: string | null; customer: string | null }>> {
    const rows = await this.prisma.project.findMany({
      where: { organizationId },
      select: { id: true, name: true, address: true, customer: { select: { name: true } } },
      orderBy: { createdAt: 'desc' },
      take: 50,
    });
    return rows.map((p) => ({ id: p.id, name: p.name, address: p.address ?? null, customer: p.customer?.name ?? null }));
  }

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
    // Every query runs as the operator's org: in per-org tenancy that picks the
    // org's own schema; in the plain layout it is a no-op.
    return runAsOrg(ctx.organizationId, async () => {
      try {
        // EVERY write goes through a Confirm card, no exceptions (guru
        // 2026-09-30). A writing tool is never run here: the call is held and
        // runPending runs it when the user confirms.
        const writes = typeof tool.writes === 'function' ? tool.writes(args || {}) : !!tool.writes;
        if (writes) return await this.holdToolCall(ctx, tool, args || {});
        return await tool.run(ctx, args || {});
      } catch (e: any) {
        this.logger.error(`tool ${name} failed: ${e.message}`);
        return { result: { error: e?.message || 'Tool failed' } };
      }
    });
  }

  /** Hold a writing tool's call behind a card that says, in plain words, what
   *  it will do. Ids are resolved to names; an id that does not exist in this
   *  org fails now rather than after the tap. */
  private async holdToolCall(ctx: OperatorContext, tool: ToolDef, args: any): Promise<ToolOutcome> {
    const org = ctx.organizationId;
    const lines: string[] = [];
    const assetName = async (id?: string) =>
      id ? (await this.prisma.asset.findFirst({ where: { id, organizationId: org }, select: { name: true } }))?.name : undefined;
    for (const [k, v] of Object.entries(args)) {
      if (v === undefined || v === null || v === '') continue;
      if (k === 'customerId') {
        const c = await this.prisma.customer.findFirst({ where: { id: String(v), organizationId: org }, select: { name: true } });
        if (!c) return { result: { error: 'Customer not found in this organization' } };
        lines.push(`Customer: ${c.name}`);
      } else if (k === 'supplierId') {
        const sup = await this.prisma.supplier.findFirst({ where: { id: String(v), organizationId: org }, select: { name: true } });
        if (!sup) return { result: { error: 'Supplier not found in this organization' } };
        lines.push(`Supplier: ${sup.name}`);
      } else if (k === 'documentId' || k === 'quotationId') {
        const d = await this.findDoc(org, String(v));
        if (!d) return { result: { error: 'Document not found in this organization' } };
        lines.push(`Document: ${d.name || d.id} (${d.type})`);
      } else if ((k === 'items' || k === 'lines' || k === 'addLines') && Array.isArray(v)) {
        if (tool.name === 'create_invoice_from_quotation') {
          lines.push(`Quotation lines: ${(v as any[]).join(', ')}`);
          continue;
        }
        lines.push(k === 'addLines' ? 'Add lines:' : 'Lines:');
        for (const it of v as any[]) {
          const what = (await assetName(it.itemId || it.assetId)) || it.description || 'item';
          const price = it.unitPrice != null ? ` @ ${it.unitPrice}` : it.amount != null ? ` = ${it.amount}` : '';
          lines.push(`• ${it.quantity ?? 1} x ${String(what).slice(0, 80)}${price}`);
        }
      } else if (k === 'lineEdits' && Array.isArray(v)) {
        for (const e of v as any[]) {
          const change = e.remove
            ? 'remove'
            : [
                e.find != null ? `"${e.find}" to "${e.replaceWith ?? ''}"` : null,
                e.description != null ? `text to "${String(e.description).slice(0, 80)}"` : null,
                e.quantity != null ? `qty ${e.quantity}` : null,
                e.unitPrice != null ? `price ${e.unitPrice}` : null,
              ]
                .filter(Boolean)
                .join(', ');
          lines.push(`• Line ${e.line}: ${change}`);
        }
      } else if (typeof v === 'object') {
        lines.push(`${k}: ${JSON.stringify(v).slice(0, 200)}`);
      } else {
        lines.push(`${k.replace(/([A-Z])/g, ' $1').replace(/^./, (x) => x.toUpperCase())}: ${String(v).slice(0, 200)}`);
      }
    }
    const pending: PendingAction = {
      kind: 'tool_call',
      summary: `${WRITE_VERBS[tool.name] || tool.name.replace(/_/g, ' ')}\n${lines.join('\n')}`.trim(),
      args: { tool: tool.name, input: args },
      createdAt: new Date().toISOString(),
    };
    return { result: { needsConfirmation: true, willDo: pending.summary }, pending };
  }

  // ── Tool table ─────────────────────────────────────────────────────────────

  private tools(): ToolDef[] {
    return [
      {
        name: 'bank_rec_checkpoint',
        description:
          "Say how far the bank reconciliation has got: for each bank account it compares Xero's closing balance with the AIMS GL month by month, and reports the last month both agree on plus the month to resume from. Use when asked 'where did we stop on the bank rec', 'is the bank reconciled', or 'which month do I start from'. It is a period marker — the open month still needs its lines ticked off in AIMS.",
        permissions: ['bankrec:read'],
        input_schema: {
          type: 'object',
          properties: {
            from: { type: 'string', description: 'Optional start date (YYYY-MM-DD). Defaults to 12 months back.' },
            to: { type: 'string', description: 'Optional end date (YYYY-MM-DD). Defaults to today.' },
          },
        },
        run: async (ctx, { from, to }) => {
          const r = await this.bankRec.xeroCheckpoints(ctx.organizationId, { from, to });
          return {
            result: {
              ...r,
              summary: r.resume
                .map((a: any) => `${a.account}: agreed through ${a.agreedThrough ?? 'never'}${a.resumeFrom ? `, resume from ${a.resumeFrom}` : ' (all months agree)'}`)
                .join(' · '),
            },
          };
        },
      },

      {
        name: 'confirm_invoices_from_xero',
        description:
          "Pull Xero's invoice approvals back into AIMS: for every invoice the accountant has AUTHORISED or PAID in Xero, match the AIMS totals to Xero, mark the AIMS document paid/pending payment, and void AIMS's own duplicate journal so the GL does not count it twice. Line items are never rewritten — differences come back as a mismatch list to read out. Use when asked to 'confirm the invoices from Xero', 'sync the approvals', or after the accountant says they have approved a batch. Pass dryRun:true first when the user wants to see what would change.",
        permissions: ['xerosync:create'],
        writes: (a: any) => !a?.dryRun,
        input_schema: {
          type: 'object',
          properties: {
            dryRun: { type: 'boolean', description: 'Report what would change without writing anything.' },
          },
        },
        run: async (ctx, { dryRun }) => {
          const r = await this.xeroSync.confirmFromXero(ctx.organizationId, { dryRun: !!dryRun });
          return {
            result: {
              ...r,
              summary: `${r.dryRun ? 'Would confirm' : 'Confirmed'} ${r.confirmed} invoice(s) · ${r.retotalled} re-totalled to Xero · ${r.journalsVoided} duplicate journal(s) voided · ${r.mismatches.length} mismatch(es) to check`,
            },
          };
        },
      },

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
        name: 'list_customers',
        description:
          'List the customers in this organization (most recent first), optionally filtered by a search term. Use when the user asks to see all / their customers or "how many customers".',
        permissions: ['customers:read'],
        input_schema: {
          type: 'object',
          properties: {
            query: { type: 'string', description: 'Optional name/code filter' },
            limit: { type: 'number', description: 'Max to return (default 20, max 50)' },
          },
        },
        run: async (ctx, { query, limit }) => {
          const res: any = await this.customers.getCustomers(
            { page: 1, limit: Math.min(Number(limit) || 20, 50), search: query || undefined } as any,
            ctx.organizationId,
          );
          const docs = res?.docs ?? res?.data?.docs ?? [];
          const total = res?.totalDocs ?? res?.total ?? res?.data?.totalDocs ?? docs.length;
          return {
            result: {
              total,
              showing: docs.length,
              customers: docs.map((c: any) => ({
                id: c.id,
                name: c.name,
                customerCode: c.customerCode,
                email: c.email,
                phone: c.phone,
              })),
            },
          };
        },
      },

      {
        name: 'create_customer',
        description: 'Create a new customer. Only call after find_customer returns no match and the user confirmed the name.',
        permissions: ['customers:create'],
        writes: true,
        logs: true,
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
        writes: true,
        logs: true,
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
          'Search products/assets by name, SKU or description. Every word must match, so spacing and punctuation do not matter ("lion 250" finds "LION-250"). Returns the item id and list price. Required to add a stock line to a document.',
        permissions: ['assets:read'],
        input_schema: {
          type: 'object',
          properties: { query: { type: 'string' } },
          required: ['query'],
        },
        run: async (ctx, { query }) => {
          // getAssets() matches the WHOLE phrase as one literal substring, which
          // is fine for a search box but wrong here: people type product names
          // loosely, so "Lion 250" missed "LION-250" and the agent could not
          // tell "not in the system" from "spelled differently". Require every
          // WORD instead, then rank whole-phrase hits first.
          const phrase = String(query || '').trim();
          const words = phrase.split(/\s+/).filter(Boolean);
          if (!words.length) return { result: [] };
          const docs = await this.prisma.asset.findMany({
            where: {
              organizationId: ctx.organizationId,
              deletedAt: null,
              AND: words.map((word) => ({
                OR: [
                  { name: { contains: word, mode: 'insensitive' as const } },
                  { skuKey: { contains: word, mode: 'insensitive' as const } },
                  { description: { contains: word, mode: 'insensitive' as const } },
                ],
              })),
            },
            select: { id: true, name: true, skuKey: true, description: true, price: true, uom: true },
            take: 8,
          });
          const hasPhrase = (a: any) =>
            [a.name, a.skuKey, a.description].some((f) =>
              String(f || '').toLowerCase().includes(phrase.toLowerCase()),
            );
          const ranked = [...docs].sort((a, b) => Number(hasPhrase(b)) - Number(hasPhrase(a)));
          return {
            result: ranked.slice(0, 5).map((a: any) => ({
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
        writes: true,
        logs: true,
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
        description: 'Generate the PDF for a document and send it to the user. Always do this before asking them to confirm. For a Delivery Order this returns a view-only link (viewLink) to the signed DO instead of a PDF: give the user that link.',
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
          // DELIVERY ORDERS are not rendered by the backend PDF: that generic
          // layout carries no customer signature, no proof of delivery and no
          // Pending lines, and it is cached. Share the SAME signed DO view the
          // field app prints instead, as a VIEW-ONLY link (it can never be used
          // to sign). No file is attached for a DO.
          if (['DO', 'DELIVERY_ORDER', 'RDO', 'RETURN_DELIVERY_ORDER'].includes(String(doc.type).toUpperCase())) {
            const link = await this.publicDocuments.getOrCreateViewOnlyLink(documentId, ctx.organizationId);
            return {
              result: {
                documentId,
                documentNumber: doc.name,
                viewLink: link.url,
                viewOnly: true,
                note: 'Delivery orders are shared as a view-only link to the signed DO (with its proof of delivery), not as a PDF file. Give the user this link.',
              },
            };
          }
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
        name: 'translate_quotation',
        description:
          'Translate an ID quotation to Simplified Chinese (中文). AI-translates every free-text line once and caches it on the document; afterwards the portal preview and the client sign link can toggle English/中文. Safe to re-run — only new/edited lines are translated again.',
        permissions: ['documents:update'],
        writes: true,
        input_schema: {
          type: 'object',
          properties: { documentId: { type: 'string' } },
          required: ['documentId'],
        },
        run: async (ctx, { documentId }) => {
          try {
            const r = await this.documents.translateIdQuotation(documentId, ctx.organizationId);
            return {
              result: {
                ...r,
                note: 'Done — the client preview and the sign link now offer an English/中文 toggle for this quotation.',
              },
            };
          } catch (e: any) {
            return { result: { error: e?.message || 'Translation failed' } };
          }
        },
      },

      {
        name: 'set_appointment',
        description:
          'Set (or clear) an appointment with a lead — it shows on the dashboard master calendar. Find the lead by name or phone number. datetime is ISO or "25 Sep 14:30" style; omit it with clear=true to remove.',
        permissions: ['documents:update'],
        writes: true,
        input_schema: {
          type: 'object',
          properties: {
            lead: { type: 'string', description: 'Lead name or phone number' },
            datetime: { type: 'string', description: 'When — e.g. "2026-09-26T14:30" or "26 Sep 2:30pm"' },
            note: { type: 'string' },
            clear: { type: 'boolean', description: 'true removes the appointment' },
          },
          required: ['lead'],
        },
        run: async (ctx, { lead, datetime, note, clear }) => {
          const q = String(lead || '').trim();
          const digits = q.replace(/\D/g, '');
          const found = await this.prisma.lead.findFirst({
            where: {
              organizationId: ctx.organizationId,
              OR: [
                { name: { contains: q, mode: 'insensitive' } },
                ...(digits ? [{ phone: { contains: digits } }, { whatsappPhone: { contains: digits } }, { phones: { has: digits } }] : []),
              ],
            },
            orderBy: { receivedAt: 'desc' },
          });
          if (!found) return { result: { error: `No lead matching "${q}"` } };
          if (clear) {
            await this.leads.update(found.id, ctx.organizationId, { appointmentAt: null, appointmentNote: null } as any, ctx.clerkUserId);
            return { result: { ok: true, leadId: found.id, lead: found.name, appointment: null } };
          }
          const at = datetime ? new Date(datetime) : null;
          if (!at || isNaN(at.getTime())) return { result: { error: 'Could not parse the date/time — try e.g. "2026-09-26 14:30"' } };
          await this.leads.update(found.id, ctx.organizationId, { appointmentAt: at.toISOString(), appointmentNote: note || null } as any, ctx.clerkUserId);
          return { result: { ok: true, leadId: found.id, lead: found.name, appointment: at.toISOString(), note: note || null } };
        },
      },

      {
        name: 'ad_performance',
        description:
          'Meta ads performance for this org (management only): spend, CPC, CPL, true CPL from AIMS leads, signed contract value and ROAS, per month and per campaign. Needs the org to have a connected ad account (CRM → Marketing).',
        permissions: ['whatsapp:read'],
        input_schema: {
          type: 'object',
          properties: { months: { type: 'number', description: 'How many months back (default 6)' } },
        },
        run: async (ctx, { months }) => {
          try {
            const o = await this.marketing.overview(ctx.organizationId, months || 6, ctx.clerkUserId);
            if (!o.connection?.connected) return { result: { error: 'No ad account connected — connect it in CRM → Marketing first.' } };
            return {
              result: {
                totals: o.totals,
                monthly: o.monthly.map((m: any) => ({ month: m.month, spend: m.spend, cpc: m.cpc, cpl: m.cpl, trueCpl: m.trueCpl, signed: m.converted, roas: m.roas })),
                topCampaigns: o.campaigns.slice(0, 5).map((c: any) => ({ name: c.name, spend: c.spend, cpc: c.cpc, cpl: c.cpl, avgWatchSec: c.avgWatchSec })),
              },
            };
          } catch (e: any) {
            return { result: { error: e?.message || 'Could not load ad performance' } };
          }
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
        writes: true,
        logs: true,
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
          'Raise an invoice from an existing quotation, carrying over its customer and line items and linking the two. ' +
          'Supports PROGRESS / MILESTONE billing: pass `lines` (the 1-based line numbers of the quote) to invoice only ' +
          'part of the quote now and the rest later — e.g. bill the setup line this month, the remaining line next month. ' +
          'Omit `lines` to invoice everything still unbilled. To choose lines, first call get_document on the quotation to ' +
          'read its numbered line items, then map the user\'s intent ("bill the 2.8k", "bill the setup") to those line numbers. ' +
          'Already-billed lines are tracked across invoices, so the same line is never billed twice and you can keep billing ' +
          'the remainder until the quote is fully invoiced.',
        permissions: ['documents:create-basic'],
        writes: true,
        logs: true,
        input_schema: {
          type: 'object',
          properties: {
            quotationId: { type: 'string', description: 'Quotation document id or number' },
            lines: {
              type: 'array',
              items: { type: 'integer' },
              description:
                '1-based line numbers of the quotation to bill now (as shown by get_document). Omit to bill all lines not yet invoiced.',
            },
          },
          required: ['quotationId'],
        },
        run: async (ctx, { quotationId, lines }) => {
          const quote = await this.findDoc(ctx.organizationId, quotationId);
          if (!quote) return { result: { error: 'Quotation not found in this organization' } };
          if (String(quote.type).toUpperCase() !== 'QUOTATION') {
            return { result: { error: `${quote.name} is a ${quote.type}, not a quotation.` } };
          }

          const qcfg: any = (quote.config as any) || {};
          const quoteItems: any[] = qcfg.items || qcfg.documentInfo?.items || [];
          if (!quoteItems.length) return { result: { error: `${quote.name} has no line items to bill.` } };
          const N = quoteItems.length;

          // Work out which quote lines are already billed, across every invoice
          // raised from this quote.
          const { billed, billedBy, remaining, childNames } = await this.billedLinesForQuote(
            ctx.organizationId,
            quote.id,
            N,
          );

          // Resolve the requested lines.
          let requested: number[];
          if (Array.isArray(lines) && lines.length) {
            requested = [...new Set(lines.map((n: any) => Number(n)))];
            const bad = requested.filter((n) => !Number.isInteger(n) || n < 1 || n > N);
            if (bad.length) {
              return { result: { error: `Line(s) ${bad.join(', ')} are out of range. This quote has ${N} line(s).` } };
            }
            const clash = requested.filter((n) => billed.has(n));
            if (clash.length) {
              return {
                result: {
                  error: `Line(s) ${clash.map((n) => `${n} (already on ${billedBy.get(n)})`).join('; ')} are already billed. Remaining unbilled: ${remaining.length ? remaining.join(', ') : 'none'}.`,
                },
              };
            }
          } else {
            if (!remaining.length) {
              return {
                result: {
                  error: `${quote.name} is already fully billed (invoices: ${childNames.join(', ')}).`,
                },
              };
            }
            requested = remaining;
          }

          const template = await this.templates.getDocumentTemplateByType('INVOICE', ctx.organizationId);
          const templateId = (template as any)?.id ?? (template as any)?.data?.id;
          if (!templateId) return { result: { error: 'No INVOICE template configured for this organization' } };

          const selectedItems = requested.map((n) => quoteItems[n - 1]);

          // Recompute totals for just the billed lines, using the quote's own tax
          // settings so the maths matches the quote exactly.
          const gstPercent = Number(qcfg.gstPercent ?? 9) || 0;
          const taxApplicable = qcfg.taxApplicable === 'N' ? 'N' : 'Y';
          const absorbTax = qcfg.absorbTax === 'Y' ? 'Y' : 'N';
          const grossTotal = round2(selectedItems.reduce((s, it) => s + (Number(it.amount) || 0), 0));
          const subTotal = grossTotal;
          const gstAmount =
            taxApplicable === 'N'
              ? 0
              : absorbTax === 'Y'
                ? round2((subTotal * gstPercent) / (100 + gstPercent))
                : round2((subTotal * gstPercent) / 100);
          const nettTotal = absorbTax === 'Y' || taxApplicable === 'N' ? subTotal : round2(subTotal + gstAmount);
          const totals = { subTotal, gstAmount, nettTotal, grossTotal, discountAmount: 0 };

          const partial = requested.length < N;
          const config: any = {
            ...qcfg,
            items: selectedItems,
            ...totals,
            date: new Date().toISOString().slice(0, 10),
            sourceDocumentId: quote.id,
            sourceDocumentNumber: quote.name ?? undefined,
            sourceDocumentType: 'QUOTATION',
            billedSourceLines: requested, // per-line tracking for progress billing
            documentInfo: { ...(qcfg.documentInfo || {}), ...totals, items: selectedItems },
          };
          // Let the invoice take its own fresh number, not the quote's.
          delete config.documentNumber;
          if (config.documentInfo) delete config.documentInfo.documentNumber;

          const created: any = await this.documents.createBasicDocument(
            templateId,
            'INVOICE',
            ctx.organizationId,
            config,
            (quote as any).projectId ?? undefined,
            ctx.actor,
          );
          const doc = created?.data ?? created;
          const billedDesc = requested.map((n) => ({
            line: n,
            description: (quoteItems[n - 1]?.description || '').slice(0, 60),
            amount: quoteItems[n - 1]?.amount,
          }));
          const stillRemaining = remaining.filter((n) => !requested.includes(n));
          this.log(
            ctx,
            'CREATED',
            'document',
            doc?.id,
            doc?.name,
            `Invoice raised from ${quote.name}${partial ? ` (lines ${requested.join(', ')})` : ''} via Operator`,
          );
          return {
            result: {
              documentId: doc?.id,
              documentNumber: doc?.name,
              fromQuotation: quote.name,
              status: doc?.status || 'unconfirmed',
              billed: billedDesc,
              nettTotal,
              partial,
              remainingLines: stillRemaining.map((n) => ({
                line: n,
                description: (quoteItems[n - 1]?.description || '').slice(0, 60),
                amount: quoteItems[n - 1]?.amount,
              })),
            },
          };
        },
      },

      {
        name: 'get_document_link',
        description:
          'Return a direct link to open a document in the AIMS app (the full portal editor), so the user can view or edit it themselves in the UI. Use when the user asks for the app link / edit link, or wants to make a change that is easier to do in the app.',
        permissions: ['documents:read'],
        input_schema: {
          type: 'object',
          properties: { numberOrId: { type: 'string', description: 'Document number or id' } },
          required: ['numberOrId'],
        },
        run: async (ctx, { numberOrId }) => {
          const doc = await this.findDoc(ctx.organizationId, numberOrId);
          if (!doc) return { result: { error: 'Document not found in this organization' } };
          // The editor lives on the PORTAL (app.ai-ms.io), NOT APP_URL — that env
          // points at the landing domain (ai-ms.io) in prod.
          const base = (process.env.PORTAL_URL || 'https://app.ai-ms.io').replace(/\/+$/, '');
          // Portal editor route: /portal/documents/{TYPE}/{templateId}/{documentId}
          const url = `${base}/portal/documents/${doc.type}/${doc.documentTemplateId}/${doc.id}`;
          return { result: { documentNumber: doc.name, type: doc.type, url } };
        },
      },

      {
        name: 'edit_document',
        description:
          'Edit an EXISTING unconfirmed/draft document in place. For a SMALL wording change (e.g. "two (2)" to "one (1)"), use lineEdits with find/replaceWith so the rest of the text is preserved exactly — NEVER retype the whole description from memory. Use the `description` field only to rewrite a whole line. Also supports changing quantity/unitPrice, removing a line, adding lines, and notes/PO/reference. Totals recompute automatically. ALWAYS call get_document first to read the full current line text, then edit. Confirmed/posted documents need a revision in the app (the tool will say so).',
        permissions: ['documents:update'],
        writes: true,
        logs: true,
        input_schema: {
          type: 'object',
          properties: {
            documentId: { type: 'string', description: 'Document number or id' },
            lineEdits: {
              type: 'array',
              description: 'Edits to existing lines, referenced by 1-based line number (from get_document).',
              items: {
                type: 'object',
                properties: {
                  line: { type: 'integer', description: '1-based line number to edit' },
                  find: {
                    type: 'string',
                    description:
                      'For a SURGICAL wording change, the exact substring to find in this line (e.g. "two (2) month"). Preferred over `description` when only part of the text changes — it leaves the rest of the wording untouched.',
                  },
                  replaceWith: { type: 'string', description: 'What to replace `find` with (e.g. "one (1) month").' },
                  description: {
                    type: 'string',
                    description:
                      'Replace the ENTIRE line description. Only use when rewriting the whole line; for a small change use find/replaceWith instead so you never lose the original wording.',
                  },
                  quantity: { type: 'number' },
                  unitPrice: { type: 'number' },
                  remove: { type: 'boolean', description: 'true to delete this line' },
                },
                required: ['line'],
              },
            },
            addLines: {
              type: 'array',
              description: 'New lines to append.',
              items: {
                type: 'object',
                properties: {
                  description: { type: 'string' },
                  quantity: { type: 'number' },
                  unitPrice: { type: 'number' },
                  isService: { type: 'boolean' },
                },
                required: ['description', 'quantity', 'unitPrice'],
              },
            },
            notes: { type: 'string' },
            poNo: { type: 'string' },
            referenceNo: { type: 'string' },
            customerAddress: {
              type: 'string',
              description: "Bill-to address shown on the PDF. Use this when the user says the address is missing or wrong on a document.",
            },
            customerName: { type: 'string', description: 'Bill-to name shown on the PDF.' },
            syncCustomerFromMaster: {
              type: 'boolean',
              description:
                "Re-copy name/address/email from the customer's record in Customers onto this document. Use when the details are blank on the document but correct in the customer record — that is the usual cause of a missing address, and it beats retyping it.",
            },
          },
          required: ['documentId'],
        },
        run: async (ctx, { documentId, lineEdits, addLines, notes, poNo, referenceNo, customerAddress, customerName, syncCustomerFromMaster }) => {
          const doc = await this.findDoc(ctx.organizationId, documentId);
          if (!doc) return { result: { error: 'Document not found in this organization' } };
          const locked = ['confirmed', 'paid', 'pending_payment'];
          if (locked.includes(String(doc.status))) {
            return {
              result: {
                error: `${doc.name} is ${doc.status} and can't be edited. Confirmed documents need a revision (do that in the app).`,
              },
            };
          }

          const cfg: any = (doc.config as any) || {};
          const items: any[] = Array.isArray(cfg.items) ? cfg.items.map((it: any) => ({ ...it })) : [];
          const N = items.length;
          const gstPercent = Number(cfg.gstPercent ?? 9) || 0;

          // Apply edits to existing lines by 1-based number.
          for (const e of lineEdits || []) {
            const idx = Number(e.line) - 1;
            if (idx < 0 || idx >= N || !items[idx]) {
              return { result: { error: `Line ${e.line} is out of range. This document has ${N} line(s).` } };
            }
            if (e.remove) {
              items[idx] = null;
              continue;
            }
            const it = items[idx];
            if (e.find != null && e.find !== '') {
              // Surgical swap — preserve the rest of the wording exactly (do NOT
              // run cleanText over it, or we'd alter the untouched original text).
              it.description = String(it.description ?? '').split(String(e.find)).join(String(e.replaceWith ?? ''));
            } else if (e.description != null) {
              it.description = cleanText(String(e.description));
            }
            if (e.quantity != null) it.quantity = Number(e.quantity);
            if (e.unitPrice != null) it.unitPrice = Number(e.unitPrice);
            const disc = Number(it.discount) || 0;
            it.amount = round2((Number(it.quantity) || 0) * (Number(it.unitPrice) || 0) * (1 - disc / 100));
          }
          let nextItems = items.filter(Boolean);

          // Append any new lines.
          for (const [i, a] of (addLines || []).entries()) {
            const quantity = Number(a.quantity) || 0;
            const unitPrice = Number(a.unitPrice) || 0;
            nextItems.push({
              id: Date.now() + i,
              inventoryItemId: '',
              isService: a.isService !== false, // typed-in lines default to service
              itemCode: '',
              description: cleanText(String(a.description || '')),
              uom: a.isService === false ? 'PCS' : 'HR',
              quantity,
              unitPrice,
              discount: 0,
              amount: round2(quantity * unitPrice),
              tax: gstPercent,
              accountCode: null,
            });
          }

          if (!nextItems.length) {
            return { result: { error: 'That would remove every line. A document needs at least one line.' } };
          }

          // Recompute totals from the document's own tax settings.
          const taxApplicable = cfg.taxApplicable === 'N' ? 'N' : 'Y';
          const absorbTax = cfg.absorbTax === 'Y' ? 'Y' : 'N';
          const grossTotal = round2(nextItems.reduce((s, it) => s + (Number(it.amount) || 0), 0));
          const subTotal = grossTotal;
          const gstAmount =
            taxApplicable === 'N'
              ? 0
              : absorbTax === 'Y'
                ? round2((subTotal * gstPercent) / (100 + gstPercent))
                : round2((subTotal * gstPercent) / 100);
          const nettTotal = absorbTax === 'Y' || taxApplicable === 'N' ? subTotal : round2(subTotal + gstAmount);
          const totals = { subTotal, gstAmount, nettTotal, grossTotal, discountAmount: 0 };

          // Bill-to details. The PDF reads the TOP-LEVEL customerAddress, while
          // cfg.customer.address is the nested copy — both are written so the
          // document and its preview agree. A document created before the
          // customer record had an address keeps a null here forever, which is
          // the usual reason an address "doesn't show": syncCustomerFromMaster
          // re-copies it rather than making the user retype it.
          const custPatch: any = {};
          let addr = customerAddress != null ? String(customerAddress) : undefined;
          let cname = customerName != null ? String(customerName) : undefined;
          let cemail: string | undefined;
          if (syncCustomerFromMaster) {
            const custId = cfg.customerId || cfg.customer?.id;
            const master = custId
              ? await this.prisma.customer.findFirst({
                  where: { id: String(custId), organizationId: ctx.organizationId },
                  select: { name: true, address: true, email: true },
                })
              : null;
            if (!master) {
              return { result: { error: 'This document has no linked customer record to copy details from. Pass customerAddress instead.' } };
            }
            addr = addr ?? (master.address || undefined);
            cname = cname ?? (master.name || undefined);
            cemail = master.email || undefined;
          }
          if (addr !== undefined) {
            custPatch.customerAddress = addr;
            custPatch.customer = { ...(cfg.customer || {}), address: addr };
          }
          if (cname !== undefined) {
            custPatch.customerName = cname;
            custPatch.customer = { ...(custPatch.customer || cfg.customer || {}), name: cname };
          }
          if (cemail !== undefined) {
            custPatch.customerEmail = cemail;
            custPatch.customer = { ...(custPatch.customer || cfg.customer || {}), email: cemail };
          }

          const newCfg: any = {
            ...cfg,
            items: nextItems,
            ...totals,
            ...(notes != null ? { note: cleanText(String(notes)) } : {}),
            ...(poNo != null ? { poNo: String(poNo) } : {}),
            ...(referenceNo != null ? { referenceNo: String(referenceNo) } : {}),
            ...custPatch,
            documentInfo: { ...(cfg.documentInfo || {}), ...totals, items: nextItems },
          };
          await this.prisma.document.update({ where: { id: doc.id }, data: { config: newCfg } });
          this.log(ctx, 'EDITED', 'document', doc.id, doc.name, `Edited via Operator (${ctx.channel})`);
          return {
            result: {
              documentId: doc.id,
              documentNumber: doc.name,
              status: doc.status,
              lines: nextItems.map((it, i) => ({
                line: i + 1,
                description: String(it.description ?? '').slice(0, 4000),
                quantity: it.quantity,
                unitPrice: it.unitPrice,
                amount: it.amount,
              })),
              nettTotal,
            },
          };
        },
      },

      {
        name: 'add_project_cost',
        description:
          "Record a supplier/cost invoice against a project's COSTING table (interior-design / project jobs). Use this right after the user uploads an invoice photo/PDF — the extracted supplier, invoice number, date and amount are already available on the upload. Project selection: if the org has only ONE project, use it WITHOUT asking; if several, call list_projects and pick the best match from the supplier/description, or ask which. Shows a preview and asks the user to confirm before saving; the original file is attached automatically.",
        permissions: ['projects:update'],
        input_schema: {
          type: 'object',
          properties: {
            projectId: { type: 'string', description: 'Project id (from list_projects) to charge the cost to' },
            supplierName: { type: 'string', description: 'Override the extracted supplier, if needed' },
            amount: { type: 'number', description: 'Override the extracted amount, if needed' },
            invoiceNo: { type: 'string' },
            date: { type: 'string', description: 'YYYY-MM-DD' },
            description: { type: 'string' },
          },
          required: ['projectId'],
        },
        run: async (ctx, args) => {
          const proj = await this.prisma.project.findFirst({
            where: { id: args.projectId, organizationId: ctx.organizationId },
            select: { id: true, name: true, designerUserId: true },
          });
          if (!proj || (this.designerOnly(ctx) && proj.designerUserId !== ctx.clerkUserId)) {
            return { result: { error: 'Project not found in this organization' } };
          }
          const up = ctx.upload;
          const amount = Number(args.amount ?? up?.extracted.amount) || 0;
          if (!(amount > 0)) {
            return { result: { error: 'I could not read an amount from the invoice. Tell me the amount to record.' } };
          }
          const supplierName = args.supplierName ?? up?.extracted.supplierName ?? null;
          const invoiceNo = args.invoiceNo ?? up?.extracted.invoiceNo ?? null;
          const date = args.date ?? up?.extracted.date ?? null;
          const description =
            args.description ?? up?.extracted.description ?? (supplierName ? `${supplierName} invoice` : 'Project cost');
          const cur = up?.extracted.currency || 'SGD';
          const pending: PendingAction = {
            kind: 'add_project_cost',
            summary: `Add cost to ${proj.name}: ${supplierName || 'supplier'} ${invoiceNo ? '(' + invoiceNo + ') ' : ''}${cur} ${amount.toFixed(2)}`,
            args: {
              projectId: proj.id,
              projectName: proj.name,
              supplierName,
              invoiceNo,
              date,
              description,
              amount,
              currency: up?.extracted.currency ?? 'SGD',
              lines: up?.lines ?? null,
              taxAmount: up?.taxAmount ?? null,
              attachmentUrl: up?.attachmentUrl ?? null,
              attachmentKey: up?.attachmentKey ?? null,
            },
            createdAt: new Date().toISOString(),
          };
          return {
            result: {
              needsConfirmation: true,
              project: proj.name,
              supplierName,
              invoiceNo,
              amount,
              willAttachOriginal: !!up?.attachmentUrl,
            },
            pending,
          };
        },
      },

      {
        name: 'edit_schedule',
        description:
          "Change a project's weekly renovation schedule with natural language — add activities to the calendar, move or remove them, or shift the whole schedule by N days (site delays). Pass the user's instruction VERBATIM (voice notes arrive already transcribed). Project selection: single-project org → use it without asking; else list_projects and match, or ask. Returns a preview of the changes; the user must confirm before anything is written.",
        permissions: ['projects:update'],
        input_schema: {
          type: 'object',
          properties: {
            projectId: { type: 'string', description: 'Project id (from list_projects)' },
            instruction: { type: 'string', description: "The user's schedule request, verbatim — e.g. 'add painting 20 to 22 Sept', 'move tiling to next Monday', 'push everything back 2 days'" },
          },
          required: ['projectId', 'instruction'],
        },
        run: async (ctx, args) => {
          const proj = await this.prisma.project.findFirst({
            where: { id: args.projectId, organizationId: ctx.organizationId },
            select: { id: true, name: true, designerUserId: true },
          });
          if (!proj || (this.designerOnly(ctx) && proj.designerUserId !== ctx.clerkUserId)) {
            return { result: { error: 'Project not found in this organization' } };
          }
          const plan = await this.costing.scheduleAssist(proj.id, ctx.organizationId, String(args.instruction || ''));
          if (!plan.ops.length) {
            return { result: { needsClarification: true, question: plan.summary || 'I could not match that to the schedule — can you rephrase?' } };
          }
          const pending: PendingAction = {
            kind: 'edit_schedule',
            summary: `Schedule of ${proj.name}: ${plan.summary || plan.lines.join('; ')}`,
            args: { projectId: proj.id, projectName: proj.name, ops: plan.ops, lines: plan.lines },
            createdAt: new Date().toISOString(),
          };
          return { result: { needsConfirmation: true, project: proj.name, changes: plan.lines, summary: plan.summary }, pending };
        },
      },

      {
        name: 'import_price_list',
        description:
          "Import a CONTRACTOR/SUPPLIER PRICE LIST the user just uploaded (PDF or photo) into the Work Library as reusable work items with unit COSTS. Use when the user says an uploaded file is a price list / rate card / to be added to the work library — NOT for supplier invoices (those are add_project_cost). Parses the file and shows a preview; the user must confirm before anything is created.",
        permissions: ['accounting:update'],
        input_schema: {
          type: 'object',
          properties: { supplierName: { type: 'string', description: "The contractor's name, if the user said it (else auto-detected)" } },
        },
        run: async (ctx, args) => {
          // The file comes from this turn's upload, or the one stashed when the
          // upload didn't look like an invoice.
          let up = ctx.upload || null;
          if (!up?.attachmentKey) {
            const sess: any = await this.prisma.operatorSession.findFirst({
              where: { channel: ctx.channel, channelUserId: ctx.channelUserId },
              orderBy: { updatedAt: 'desc' },
            });
            up = sess?.state?.pendingUpload || null;
          }
          if (!up?.attachmentKey) return { result: { error: 'Send me the price list first (PDF or photo), then ask me to add it to the work library.' } };
          const buffer = await this.s3.downloadFile(up.attachmentKey);
          const ext = String(up.attachmentKey).split('.').pop()?.toLowerCase() || 'pdf';
          const mime = ext === 'pdf' ? 'application/pdf' : ext === 'png' ? 'image/png' : 'image/jpeg';
          const parsed = await this.revenueItems.importPricelist(ctx.organizationId, {
            file: `data:${mime};base64,${buffer.toString('base64')}`,
            filename: up.filename,
            supplierName: args.supplierName || undefined,
          });
          // Supplier already in the library → this is an UPDATE: existing
          // items get the new costs in place instead of being duplicated.
          const isUpdate = !!parsed.existing?.count;
          const pending: PendingAction = {
            kind: 'import_price_list',
            summary: isUpdate
              ? `Update ${parsed.supplierName}'s price list in the Work Library (${parsed.existing.priceChanges.length} price change(s), ${parsed.existing.added} new item(s))`
              : `Add ${parsed.items.length} work item(s) from ${parsed.supplierName || 'the price list'} to the Work Library`,
            args: { supplierName: parsed.supplierName, items: parsed.items, mode: isUpdate ? 'update' : 'add' },
            createdAt: new Date().toISOString(),
          };
          return {
            result: {
              needsConfirmation: true,
              supplierName: parsed.supplierName,
              trade: parsed.trade,
              itemCount: parsed.items.length,
              ...(isUpdate
                ? {
                    existing: {
                      note: `${parsed.supplierName} already has ${parsed.existing.count} item(s) in the library — confirming UPDATES them in place (no duplicates).`,
                      priceChanges: parsed.existing.priceChanges.slice(0, 8).map((c: any) => `${c.name}: $${c.from ?? '—'} → $${c.to}`),
                      newItems: parsed.existing.added,
                      unchanged: parsed.existing.unchanged,
                      noLongerListed: parsed.existing.missingCount,
                    },
                  }
                : {}),
              sample: parsed.items.slice(0, 8).map((i: any) => `${i.name} — $${i.unitCost}/${i.uom} (${i.section})`),
              conditions: parsed.conditions,
              note: 'Prices land as unit COSTS; selling prices are set later in the Work Library or per quotation.',
            },
            pending,
          };
        },
      },

      {
        name: 'api_docs',
        description:
          "Search the FULL AIMS REST API — every endpoint the web dashboard itself uses, reads AND writes. Use this whenever the user asks for something no dedicated tool covers (commissions, dashboards, reports, schedules, quests, leads, budgets, any screen's data or action): search here first, then api_get to read or api_write to change. Returns '<METHOD> <path> — <what it does> {field*:type}' lines ('*' = required; the body shape is shown when the endpoint documents one).",
        permissions: [],
        input_schema: {
          type: 'object',
          properties: {
            query: { type: 'string', description: "Keywords to match against endpoint paths/summaries, e.g. 'commission', 'dashboard', 'schedule', 'aged', 'profit'" },
          },
          required: ['query'],
        },
        run: async (_ctx, args) => {
          const lines = await this.apiCatalog();
          const terms = String(args.query || '').toLowerCase().split(/\s+/).filter(Boolean);
          const hits = terms.length ? lines.filter((l) => terms.some((t) => l.toLowerCase().includes(t))) : [];
          return {
            result: {
              endpoints: hits.slice(0, 60),
              ...(hits.length ? {} : { hint: 'No match — try broader keywords, or list_projects/list_recent_documents. Useful areas: /id-projects/dashboard (designer revenue & commissions), /projects/{id}/costing (project P&L incl. commission), /projects/{id}/schedule, /projects/{id}/quest.' }),
            },
          };
        },
      },

      {
        name: 'api_get',
        description:
          "Fetch any GET endpoint of the AIMS API as this user — the same data their dashboard shows, with their real permissions enforced. Find the path with api_docs first. Path params in {braces} must be replaced with real ids (e.g. from list_projects). Read-only: writes still go through the dedicated tools.",
        permissions: [],
        input_schema: {
          type: 'object',
          properties: {
            path: { type: 'string', description: "Absolute API path starting with /, query string allowed — e.g. '/id-projects/dashboard' or '/projects/<id>/costing'" },
          },
          required: ['path'],
        },
        run: async (ctx, args) => {
          const secret = process.env.INTERNAL_API_SECRET;
          if (!secret) return { result: { error: 'Internal API access is not configured on this server (INTERNAL_API_SECRET missing).' } };
          const path = String(args.path || '');
          if (!path.startsWith('/') || path.includes('..') || /:\/\//.test(path)) return { result: { error: 'Path must be an absolute API path like /projects/<id>/costing' } };
          if (/\{[^}]+\}/.test(path)) return { result: { error: 'Replace the {param} placeholders with real ids first (use list_projects etc.).' } };
          const ts = Date.now();
          const crypto = require('crypto');
          const sig = crypto.createHmac('sha256', secret).update(`${ctx.clerkUserId}.${ts}`).digest('hex');
          const port = process.env.PORT || 4040;
          const res = await fetch(`http://127.0.0.1:${port}${path}`, {
            // x-active-org-id keeps the self-call in the operator session's org:
            // admins (whose membership org differs from the org they're acting
            // in) would otherwise read their own org's data. The guard ignores
            // the header for non-admin users, whose membership org is ctx's.
            headers: { 'x-operator-internal': `${ctx.clerkUserId}.${ts}.${sig}`, 'x-active-org-id': ctx.organizationId },
          });
          const text = await res.text();
          if (!res.ok) return { result: { error: `${res.status} ${text.slice(0, 500)}` } };
          let body: any = text;
          try {
            body = JSON.parse(text);
          } catch {
            /* non-JSON stays as text */
          }
          let out = JSON.stringify(body);
          const truncated = out.length > 14000;
          if (truncated) out = out.slice(0, 14000);
          return { result: { path, data: truncated ? out + '…[truncated — ask for a narrower endpoint or add query filters]' : body } };
        },
      },

      {
        name: 'api_write',
        description:
          "Call any POST/PATCH/PUT endpoint of the AIMS API as this user, for actions no dedicated tool covers. Find the path AND its body fields with api_docs first. NEVER fires immediately: it returns a summary the user must confirm, so always tell them what you are about to do. Their permissions are enforced. Money and irreversible actions (confirming invoices, posting bills, recording payments, deleting) are BLOCKED here on purpose — use the dedicated tools for those.",
        permissions: [],
        input_schema: {
          type: 'object',
          properties: {
            method: { type: 'string', description: 'POST, PATCH or PUT' },
            path: { type: 'string', description: "Absolute API path starting with /, e.g. '/projects/<id>/schedule'. Replace any {param} with a real id." },
            body: { type: 'object', description: 'JSON request body, built from the field list api_docs returned.' },
            summary: { type: 'string', description: 'One plain sentence telling the user what this will change, shown to them before it runs.' },
          },
          required: ['method', 'path', 'summary'],
        },
        run: async (ctx, args) => {
          const method = String(args.method || '').toUpperCase();
          if (!['POST', 'PATCH', 'PUT'].includes(method)) {
            return { result: { error: 'method must be POST, PATCH or PUT.' } };
          }
          const path = String(args.path || '');
          if (!path.startsWith('/') || path.includes('..') || /:\/\//.test(path)) {
            return { result: { error: 'Path must be an absolute API path like /projects/<id>/schedule' } };
          }
          if (/\{[^}]+\}/.test(path)) {
            return { result: { error: 'Replace the {param} placeholders with real ids first.' } };
          }
          if (BLOCKED_WRITE_PATHS.some((re) => re.test(path))) {
            return {
              result: {
                error:
                  'That endpoint moves money or is irreversible, so it is not reachable this way. Use the dedicated tool (confirm_invoice, post_bill, record_payment) instead.',
              },
            };
          }
          // Held, never executed here. The user taps Confirm and runPending()
          // makes the call — same gate every risky tool already uses.
          const pending: PendingAction = {
            kind: 'api_write',
            summary: String(args.summary || `${method} ${path}`),
            args: { method, path, body: args.body || {} },
            createdAt: new Date().toISOString(),
          };
          return { result: { needsConfirmation: true, willCall: `${method} ${path}`, summary: pending.summary }, pending };
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
        writes: true,
        logs: true,
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
        name: 'schedule_delivery',
        description:
          'Schedule a REAL delivery run (the Deliveries module) from a staff message. Pass the pieces AS WRITTEN: when ("Tomorrow morning"), customer ("CNQC"), location ("lentor garten"), and each item line ("1 unit Lion 375"). The tool matches customer, project, catalog items and the open sales order itself, and returns EITHER a Confirm card (then STOP) OR questions to put to the user. Answer them by calling again with the same inputs plus customerId / projectId / items[{line, assetId}] or items[{line, freeTyped:true}] / saleOrderId / doContactId. Items carry NO prices. Only a SALES ORDER can be attached; quotations are refused. With no sales order the card says so and confirming saves a DRAFT run (no DO).',
        permissions: ['documents:create-basic'],
        input_schema: {
          type: 'object',
          properties: {
            message: { type: 'string', description: "The user's own words for this delivery, VERBATIM: the original message plus any later corrections. The tool reads order numbers out of it itself." },
            when: { type: 'string', description: 'The date words as written: "Tomorrow morning", "Thursday 2pm", "30 Sep". Morning = 09:00, afternoon = 14:00 (Singapore).' },
            customer: { type: 'string', description: 'Customer as written, e.g. "CNQC" (short name, code or full name).' },
            customerId: { type: 'string', description: 'Only once a question has been answered, from the options the tool gave.' },
            location: { type: 'string', description: 'Site / location as written, e.g. "lentor garten". Matched against the customer\'s projects.' },
            projectId: { type: 'string', description: 'Only once a question has been answered, from the options the tool gave.' },
            lines: { type: 'array', items: { type: 'string' }, description: 'Each item line as written: "1 unit Lion 375", "60 es DG".' },
            items: {
              type: 'array',
              description: 'Answers about specific lines (1-based `line` into `lines`): assetId from the options, or freeTyped:true to keep the line as typed. May also change quantity.',
              items: {
                type: 'object',
                properties: {
                  line: { type: 'integer' },
                  assetId: { type: 'string' },
                  freeTyped: { type: 'boolean' },
                  quantity: { type: 'number' },
                  description: { type: 'string', description: 'Only for a brand new line not in `lines`.' },
                },
              },
            },
            saleOrderNumber: { type: 'string', description: "A sales order NUMBER the user gave, e.g. 'SO202609-0002'. Exact match. Quotation numbers are refused." },
            saleOrderId: { type: 'string', description: 'Only once a question has been answered, from the options the tool gave.' },
            doContactId: { type: 'string', description: 'Change the DO contact to this customer contact (from the options the tool gave).' },
            siteAddress: { type: 'string', description: 'Only when the user gives an address that differs from the project\'s.' },
            notes: { type: 'string', description: 'Anything else for the office or the rider, e.g. "call Mr Tan on arrival".' },
            poNumber: { type: 'string', description: "Optional display text for the DO's PO No. Defaults to the sales order's number." },
            scheduledFor: { type: 'string', description: 'Older form of `when` (ISO with +08:00). Prefer `when`.' },
            noProject: { type: 'boolean', description: 'The user chose to save it without a project (DRAFT).' },
            noSaleOrder: { type: 'boolean', description: 'The user chose to save it without a sales order (DRAFT).' },
          },
          required: ['message'],
        },
        run: async (ctx, args) => this.scheduleDeliveryCard(ctx, args),
      },

      {
        name: 'ask_choice',
        description:
          "Ask the user to pick between options, shown as tappable buttons. USE THIS INSTEAD of writing choices out as '1. ... 2. ...' in your reply — tapping beats typing. Max 3 options, each at most 20 characters (the channel's limit), so keep them terse ('Use SO202609-0002', 'Upload the PO', 'Save as draft'). Their tap comes back as the next message. Do not use it for a straight yes/no on an action you are about to take — those already get their own Confirm button.",
        permissions: [],
        input_schema: {
          type: 'object',
          properties: {
            question: { type: 'string', description: 'One short line. State the gap, not the background.' },
            options: { type: 'array', items: { type: 'string' }, description: 'Up to 3 short labels, <=20 chars each.' },
          },
          required: ['question', 'options'],
        },
        run: async (_ctx, args) => {
          const options = (args.options || []).map((o: any) => String(o)).filter(Boolean).slice(0, 3);
          if (options.length < 2) return { result: { error: 'Give at least 2 options, or just ask in your reply.' } };
          return {
            result: { shown: true },
            choice: { question: String(args.question || 'Which one?'), options },
          } as any;
        },
      },

      {
        name: 'find_sales_order',
        description:
          "Find open Sales Orders, e.g. to answer which order a delivery is against. Narrow by project, customer name, or a number fragment ('SO2026', 'PO2512032'). Only sales orders are listed: a delivery can never be scheduled against a quotation.",
        permissions: ['documents:read'],
        input_schema: {
          type: 'object',
          properties: {
            projectId: { type: 'string', description: 'Restrict to one project.' },
            customerName: { type: 'string', description: "Restrict to orders whose stored customer matches, e.g. 'Tenda'." },
            query: { type: 'string', description: 'Part of the order number or reference, e.g. "SO2026" or "PO2512032".' },
          },
        },
        run: async (ctx, args) => {
          const q = String(args.query || '').trim();
          const docs = await this.prisma.document.findMany({
            where: {
              organizationId: ctx.organizationId,
              // Sales orders only (guru 2026-09-30: quotations are never
              // accepted for a delivery).
              type: 'SALES_ORDER',
              ...(args.projectId ? { projectId: String(args.projectId) } : {}),
              ...(q ? { name: { contains: q, mode: 'insensitive' as const } } : {}),
            },
            orderBy: { createdAt: 'desc' },
            take: 25,
            select: { id: true, name: true, type: true, status: true, createdAt: true, config: true, projectId: true },
          });
          // The customer lives inside config (Document has no customerId column),
          // so it is filtered here rather than in the query.
          const wanted = String(args.customerName || '').trim().toLowerCase();
          const customerOf = (d: any) => {
            const c = d.config?.customer;
            return String(typeof c === 'string' ? c : c?.name || c?.customerName || '');
          };
          const matched = wanted
            ? docs.filter((d: any) => customerOf(d).toLowerCase().includes(wanted))
            : docs;
          return {
            result: matched.slice(0, 10).map((d: any) => ({
              id: d.id,
              number: d.name,
              status: d.status,
              date: d.createdAt?.toISOString?.().slice(0, 10),
              customer: customerOf(d) || null,
              projectId: d.projectId,
              // Lines are usually free text with no codes, so show them: it is
              // how the user recognises which order they meant.
              lines: (d.config?.items || []).slice(0, 4).map((it: any) => String(it.description || '').slice(0, 70)),
              lineCount: (d.config?.items || []).length,
            })),
          };
        },
      },

      {
        name: 'list_deliveries',
        description:
          'List delivery runs by date range, status and customer: "what deliveries are on tomorrow", "pending deliveries for CNQC", "drafts this week". Dates are Singapore days; defaults to today and the next 7 days. Read-only.',
        permissions: ['maintenance-reports:read'],
        input_schema: {
          type: 'object',
          properties: {
            from: { type: 'string', description: 'First day, YYYY-MM-DD or words ("today", "tomorrow", "Monday").' },
            to: { type: 'string', description: 'Last day (inclusive), same forms. Defaults to `from` + 7 days.' },
            status: { type: 'string', enum: ['scheduled', 'in_progress', 'delivered', 'completed', 'cancelled', 'draft'], description: '"draft" = office drafts not yet booked.' },
            customer: { type: 'string', description: 'Customer name, short name or code.' },
            limit: { type: 'number', description: 'Max rows (default 20, max 50).' },
          },
        },
        run: async (ctx, args) => this.listDeliveries(ctx, args),
      },

      {
        name: 'create_delivery_order',
        description:
          'Create a DRAFT delivery order DOCUMENT only (no delivery run, no rider, no date). For "schedule/send/deliver tomorrow" requests ALWAYS use schedule_delivery instead. Rental DOs carry quantities, not prices — omit unitPrice unless the user gave one.',
        permissions: ['documents:create-basic'],
        writes: true,
        logs: true,
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
        writes: true,
        logs: true,
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
          // Designer-only users are row-scoped to their own projects, same as
          // the portal list and the HTTP DesignerProjectScopeGuard.
          if (this.designerOnly(ctx)) {
            const rows = await this.prisma.project.findMany({
              where: {
                organizationId: ctx.organizationId,
                designerUserId: ctx.clerkUserId,
                ...(query ? { name: { contains: String(query), mode: 'insensitive' } } : {}),
              },
              orderBy: { createdAt: 'desc' },
              take: Math.min(Number(limit) || 10, 25),
              select: { id: true, name: true, status: true, customer: { select: { name: true } } },
            });
            return { result: rows.map((p) => ({ id: p.id, name: p.name, status: p.status, customer: p.customer?.name })) };
          }
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
          const items: any[] = Array.isArray(cfg.items) ? cfg.items : cfg.documentInfo?.items || [];
          // Numbered lines so the model can reference them for progress billing.
          const lines = items.map((it, i) => ({
            line: i + 1,
            // FULL description — the model needs the complete text to edit it
            // (truncating here made edits overwrite blindly and lose wording).
            description: String(it.description ?? it.itemCode ?? '').slice(0, 4000),
            quantity: it.quantity,
            unitPrice: it.unitPrice,
            amount: it.amount,
          }));
          const result: any = {
            id: doc.id,
            documentNumber: doc.name,
            type: doc.type,
            status: doc.status,
            customer: cfg.customerName || cfg.customer?.name,
            subTotal: cfg.subTotal ?? cfg.documentInfo?.subTotal,
            gstAmount: cfg.gstAmount ?? cfg.documentInfo?.gstAmount,
            nettTotal: cfg.nettTotal ?? cfg.documentInfo?.nettTotal,
            lines,
            createdAt: doc.createdAt,
          };
          // For quotations, surface how much has already been invoiced so the
          // model can bill "the rest" and answer "what's left on this quote".
          if (String(doc.type).toUpperCase() === 'QUOTATION' && items.length) {
            const { billed, remaining, childNames } = await this.billedLinesForQuote(
              ctx.organizationId,
              doc.id,
              items.length,
            );
            result.billing = {
              billedLines: [...billed].sort((a, b) => a - b),
              remainingLines: remaining,
              invoices: childNames,
              fullyBilled: remaining.length === 0,
            };
          }
          return { result };
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
  // ── schedule_delivery: from a staff message to a Confirm card ────────────

  /**
   * Turn what staff typed into either questions or a card. Matching rule for
   * customer, project, item and sales order alike: ONE strong match is used,
   * several or none become a question. Nothing is guessed and nothing is
   * written here: the run is created only by runPending, on Confirm.
   */
  private async scheduleDeliveryCard(ctx: OperatorContext, args: any): Promise<ToolOutcome> {
    const org = ctx.organizationId;
    const questions: Array<Record<string, any>> = [];
    const txt = (v: any) => String(v ?? '').trim();

    // Customer: name, customer code (the short name) and aliases (CNQC).
    const custSelect = { id: true, name: true, customerCode: true, address: true } as const;
    let customer: { id: string; name: string; customerCode: string | null; address: string | null } | null = null;
    if (args.customerId) {
      customer = await this.prisma.customer.findFirst({ where: { id: String(args.customerId), organizationId: org }, select: custSelect });
      if (!customer) return { result: { error: 'Customer not found in this organization' } };
    } else if (txt(args.customer)) {
      const all = await this.prisma.customer.findMany({ where: { organizationId: org }, select: custSelect });
      const m = matchCustomer(txt(args.customer), all);
      if (m.kind === 'one') customer = m.row;
      else {
        const opts = m.kind === 'several' ? m.rows : m.suggestions;
        questions.push({
          about: 'customer',
          question:
            m.kind === 'several'
              ? `Several customers match "${txt(args.customer)}". Which one?`
              : `No customer matches "${txt(args.customer)}".${opts.length ? ' Did you mean one of these?' : " What is the customer's name?"}`,
          options: opts.slice(0, 5).map((c) => ({ customerId: c.id, name: c.name })),
        });
      }
    } else {
      questions.push({ about: 'customer', question: 'Which customer is this for?' });
    }

    // When: date words in Singapore time.
    const whenText = txt(args.when) || txt(args.scheduledFor);
    const when = parseWhen(whenText);
    if (!when) {
      questions.push({ about: 'when', question: whenText ? `I couldn't read a day in "${whenText}". Which day and time?` : 'Which day and time?' });
    } else if (when.ymd < sgtYmd()) {
      questions.push({ about: 'when', question: `${when.label} is in the past. Which day?` });
    }

    // Items: each line = quantity + text, matched to the catalog.
    type Line = { line: number; raw: string; quantity: number; text: string; assetId?: string; freeTyped?: boolean };
    const lines: Line[] = (Array.isArray(args.lines) ? args.lines : []).map((raw: any, i: number) => ({ line: i + 1, ...parseLine(String(raw)) }));
    for (const o of Array.isArray(args.items) ? args.items : []) {
      const n = Number(o?.line);
      const target = Number.isInteger(n) && n >= 1 ? lines[n - 1] : undefined;
      if (target) {
        if (o.assetId) Object.assign(target, { assetId: String(o.assetId), freeTyped: false });
        if (o.freeTyped) Object.assign(target, { assetId: undefined, freeTyped: true });
        if (o.quantity != null) target.quantity = Number(o.quantity);
      } else {
        const p = parseLine(txt(o?.description));
        lines.push({
          line: lines.length + 1,
          raw: p.raw,
          text: p.text,
          quantity: o?.quantity != null ? Number(o.quantity) : p.quantity,
          assetId: o?.assetId || undefined,
          freeTyped: !!o?.freeTyped,
        });
      }
    }
    const catalog = await this.prisma.asset.findMany({
      where: { organizationId: org, deletedAt: null },
      select: { id: true, name: true, skuKey: true },
    });
    const byId = new Map(catalog.map((a) => [a.id, a]));
    type Resolved = { line: number; quantity: number; text: string; asset?: { id: string; name: string; skuKey: string | null } };
    const resolved: Resolved[] = [];
    for (const l of lines) {
      if (!Number.isInteger(l.quantity) || l.quantity < 1) {
        questions.push({ about: 'item', line: l.line, question: `Line ${l.line} "${l.raw}": how many? (a whole number)` });
      } else if (l.assetId) {
        const a = byId.get(l.assetId);
        if (!a) return { result: { error: `The item picked for line ${l.line} is not in this organization's catalog.` } };
        resolved.push({ line: l.line, quantity: l.quantity, text: l.text, asset: a });
      } else if (!l.text) {
        questions.push({ about: 'item', line: l.line, question: `Line ${l.line}: which item?` });
      } else if (l.freeTyped) {
        resolved.push({ line: l.line, quantity: l.quantity, text: l.text });
      } else {
        const v = matchItem(l.text, catalog);
        if (v.kind === 'sure') resolved.push({ line: l.line, quantity: l.quantity, text: l.text, asset: v.asset });
        else if (v.kind === 'unsure') {
          questions.push({
            about: 'item',
            line: l.line,
            question: `Line ${l.line} "${l.raw}": did you mean ${v.options.map((o) => o.name).join(' or ')}? Or keep it as typed.`,
            options: v.options.map((o) => ({ assetId: o.id, name: o.name })),
          });
        } else resolved.push({ line: l.line, quantity: l.quantity, text: l.text }); // not in the catalog: free-typed
      }
    }
    if (!lines.length) questions.push({ about: 'item', question: 'What is being delivered?' });

    // Project / site: the location against THAT customer's projects.
    let project: { id: string; name: string; address: string | null } | null = null;
    let customerProjectIds = new Set<string>();
    if (customer) {
      const projects = await this.prisma.project.findMany({
        where: { organizationId: org, customerId: customer.id },
        select: { id: true, name: true, address: true },
        orderBy: { createdAt: 'desc' },
      });
      customerProjectIds = new Set(projects.map((p) => p.id));
      const projectOptions = (rows: typeof projects) => rows.slice(0, 5).map((p) => ({ projectId: p.id, name: p.name, address: p.address }));
      if (args.projectId) {
        project = projects.find((p) => p.id === String(args.projectId)) ?? null;
        if (!project) return { result: { error: `That project is not one of ${customer.name}'s projects.` } };
      } else if (args.noProject || !projects.length) {
        project = null; // saved as a DRAFT without one
      } else if (txt(args.location)) {
        const m = matchProject(txt(args.location), projects);
        if (m.kind === 'one') project = m.row;
        else {
          questions.push({
            about: 'project',
            question:
              m.kind === 'several'
                ? `Several of ${customer.name}'s projects match "${txt(args.location)}". Which one?`
                : `None of ${customer.name}'s projects matches "${txt(args.location)}". Is it one of these, or save it as a DRAFT without a project?`,
            options: projectOptions(m.kind === 'several' ? m.rows : m.suggestions.length ? m.suggestions : projects),
          });
        }
      } else if (projects.length === 1) {
        project = projects[0];
      } else {
        questions.push({ about: 'project', question: `Which of ${customer.name}'s projects (site) is this for?`, options: projectOptions(projects) });
      }
    }

    // Sales order: explicit number = exact + must be this customer's; else the
    // open SALES_ORDERs for the customer (+ project) that cover the items.
    // Quotations are never accepted.
    let saleOrder: { id: string; name: string } | null = null;
    let explicitSo = txt(args.saleOrderId) || txt(args.saleOrderNumber);
    // Order numbers are read out of the message itself as well, so a number the
    // model dropped (or a quotation it quietly left out) is still seen. A
    // quotation named there is refused out loud, never silently swapped for
    // whatever sales order the auto-match would have found.
    if (customer && !explicitSo && !args.noSaleOrder && txt(args.message)) {
      const refs = [...new Set(txt(args.message).match(/\b(?=[A-Za-z0-9/-]*\d)(?=[A-Za-z0-9/-]*[A-Za-z])[A-Za-z0-9][A-Za-z0-9/-]{4,}\b/g) || [])].slice(0, 10);
      const named = refs.length
        ? await this.prisma.document.findMany({
            where: { organizationId: org, OR: refs.map((r) => ({ name: { equals: r, mode: 'insensitive' as const } })) },
            select: { name: true, type: true },
          })
        : [];
      const so = named.find((d) => d.type === 'SALES_ORDER');
      const quote = named.find((d) => ['QUOTATION', 'QO', 'QO1', 'QO2', 'QT'].includes(String(d.type)));
      if (so?.name) explicitSo = so.name;
      else if (quote?.name) explicitSo = quote.name;
    }
    if (customer && explicitSo) {
      const byUuid = !!args.saleOrderId && UUID_RE.test(txt(args.saleOrderId)) && explicitSo === txt(args.saleOrderId);
      const doc = await this.prisma.document.findFirst({
        where: {
          organizationId: org,
          ...(byUuid ? { id: txt(args.saleOrderId) } : { name: { equals: explicitSo, mode: 'insensitive' as const } }),
        },
        select: { id: true, name: true, type: true, status: true, config: true, projectId: true },
      });
      if (!doc) return { result: { error: `No sales order numbered "${explicitSo}" in this organization.` } };
      if (doc.type !== 'SALES_ORDER') {
        const what = ['QUOTATION', 'QO', 'QO1', 'QO2', 'QT'].includes(String(doc.type)) ? 'a quotation' : `a ${doc.type}`;
        return {
          result: {
            error: `${doc.name} is ${what}, and quotations are never accepted for a delivery. The user has already been told that. Offer: send the sales order number, or save it as a DRAFT without one.`,
            refused: 'quotation',
          },
          notice: `${doc.name} is ${what}. A delivery is booked against a sales order only, never a quotation, so it was not used.`,
        };
      }
      const cfg: any = doc.config || {};
      if (!sameCustomer(customer, cfg) && !(doc.projectId && customerProjectIds.has(doc.projectId))) {
        const theirs = typeof cfg.customer === 'string' ? cfg.customer : cfg.customer?.name || cfg.customerName;
        return { result: { error: `${doc.name} is not ${customer.name}'s sales order${theirs ? ` (it is for ${theirs})` : ''}.` } };
      }
      saleOrder = { id: doc.id, name: doc.name || doc.id };
    } else if (customer && !args.noSaleOrder) {
      const orders = await this.prisma.document.findMany({
        // Every sales order counts as open: DocumentStatus has no closed/void
        // state for an order (documents are deleted, not voided).
        where: { organizationId: org, type: 'SALES_ORDER' },
        select: { id: true, name: true, config: true, projectId: true },
        orderBy: { createdAt: 'desc' },
        take: 300,
      });
      const catalogLines = resolved.filter((r) => r.asset);
      const fits = orders.filter((d) => {
        const cfg: any = d.config || {};
        if (!sameCustomer(customer!, cfg) && !(d.projectId && customerProjectIds.has(d.projectId))) return false;
        if (project && d.projectId && d.projectId !== project.id) return false;
        const soLines: any[] = [...(cfg.items || []), ...(cfg.documentInfo?.items || [])];
        return catalogLines.every((r) => soLines.some((li) => orderLineCovers(li, r.asset!)));
      });
      if (fits.length === 1) saleOrder = { id: fits[0].id, name: fits[0].name || fits[0].id };
      else if (fits.length > 1) {
        questions.push({
          about: 'saleOrder',
          question: `${fits.length} open sales orders for ${customer.name} cover these items. Which one?`,
          options: fits.slice(0, 5).map((d) => ({ saleOrderId: d.id, number: d.name })),
        });
      }
    }

    // DO contact: the project's (DO role, else primary, else first), changeable.
    let doContact: { id: string; name: string; phone: string | null } | null = null;
    let contactsDto: Array<{ contactId: string; group: string | null }> | undefined;
    let contactOptions: Array<{ doContactId: string; name: string; phone: string | null }> = [];
    if (customer) {
      const contacts = await this.prisma.customerContact.findMany({
        where: { customerId: customer.id },
        select: { id: true, name: true, phone: true },
        orderBy: { createdAt: 'asc' },
        take: 20,
      });
      contactOptions = contacts.map((c) => ({ doContactId: c.id, name: c.name, phone: c.phone }));
      if (project) {
        const links = await this.prisma.projectContact.findMany({
          where: { projectId: project.id },
          orderBy: { createdAt: 'asc' },
          select: { customerContactId: true, group: true, customerContact: { select: { id: true, name: true, phone: true, isPrimary: true } } },
        });
        const pick = links.find((l) => l.group === 'DO') ?? links.find((l) => l.customerContact?.isPrimary) ?? links[0];
        doContact = pick?.customerContact ?? null;
        if (args.doContactId) {
          const c = contacts.find((x) => x.id === String(args.doContactId));
          if (!c) return { result: { error: `That contact is not one of ${customer.name}'s contacts.` } };
          doContact = c;
          contactsDto = [
            ...links.filter((l) => l.group !== 'DO').map((l) => ({ contactId: l.customerContactId, group: l.group })),
            { contactId: c.id, group: 'DO' },
          ];
        }
      }
    }

    if (questions.length) {
      return {
        result: {
          needsAnswers: true,
          questions,
          understood: {
            customer: customer?.name ?? null,
            project: project?.name ?? null,
            when: when?.label ?? null,
            items: resolved.map((r) => `${r.quantity} x ${r.asset ? r.asset.name : `${r.text} (free-typed)`}`),
            saleOrder: saleOrder?.name ?? null,
          },
          note: 'Nothing is booked yet. Ask these in ONE short message, then call schedule_delivery again with the same inputs plus the answers.',
        },
      };
    }

    const isDraft = !project || !saleOrder;
    const site = txt(args.siteAddress) || project?.address || '';
    const notes = txt(args.notes) ? cleanText(txt(args.notes)) : '';
    const dto: any = {
      isDraft,
      projectId: project?.id,
      customerId: customer!.id,
      scheduledFor: when!.iso,
      ...(site ? { address: site } : {}),
      ...(notes ? { notes } : {}),
      ...(saleOrder ? { saleOrderId: saleOrder.id, poNumber: txt(args.poNumber) || saleOrder.name } : txt(args.poNumber) ? { poNumber: txt(args.poNumber) } : {}),
      ...(contactsDto ? { contacts: contactsDto } : {}),
      items: resolved.map((r) => (r.asset ? { assetId: r.asset.id, quantity: r.quantity } : { description: cleanText(r.text), quantity: r.quantity })),
    };
    const label = (a: { name: string; skuKey: string | null }) => {
      const code = (a.skuKey || '').trim();
      // "LION250 (LION250)" reads as a bug: show the code only when it adds something.
      return !code || a.name.replace(/\s+/g, '').toLowerCase() === code.replace(/\s+/g, '').toLowerCase() ? a.name : `${a.name} (${code})`;
    };
    const draftNotes = [
      !saleOrder && 'there is no sales order: send the SO number or upload the PO to book it',
      !project && 'there is no project: the office adds one in Deliveries',
    ].filter(Boolean);
    const summary =
      [
        `🚚 Delivery for ${customer!.name}`,
        `When: ${when!.label}${when!.timeFrom === 'default' ? ' (no time given)' : ''}`,
        `Project: ${project?.name ?? '(none)'}`,
        `Site: ${site || project?.name || '(none)'}`,
        'Items:',
        ...resolved.map((r) => `• ${r.quantity} x ${r.asset ? `${label(r.asset)} (catalog)` : `${cleanText(r.text)} (free-typed)`}`),
        `Sales order: ${saleOrder ? saleOrder.name : 'No sales order found'}`,
        `DO contact: ${doContact ? `${doContact.name}${doContact.phone ? ` (${doContact.phone})` : ''}` : '(none on the project)'}`,
        ...(notes ? [`Notes: ${notes}`] : []),
      ].join('\n') + (isDraft ? `\n\nConfirming saves a DRAFT run (no DO): ${draftNotes.join('; ')}.` : '');

    const pending: PendingAction = {
      kind: 'schedule_delivery',
      summary,
      args: { dto, customerName: customer!.name, isDraft },
      createdAt: new Date().toISOString(),
    };
    return {
      result: {
        needsConfirmation: true,
        card: summary,
        // For "change the DO contact to …": pass doContactId from these.
        contactOptions: contactOptions.slice(0, 10),
      },
      pending,
    };
  }

  /** Read-only: delivery runs in a Singapore date range, by status/customer. */
  private async listDeliveries(ctx: OperatorContext, args: any): Promise<ToolOutcome> {
    const org = ctx.organizationId;
    const day = (w: any) => {
      const v = String(w ?? '').trim();
      if (!v) return null;
      if (/^\d{4}-\d{2}-\d{2}$/.test(v)) return v;
      return parseWhen(v)?.ymd ?? null;
    };
    const from = day(args.from) ?? sgtYmd();
    const to = day(args.to) ?? new Date(Date.parse(`${from}T00:00:00Z`) + 7 * 864e5).toISOString().slice(0, 10);
    const start = new Date(`${from}T00:00:00+08:00`);
    const end = new Date(new Date(`${to}T00:00:00+08:00`).getTime() + 864e5);
    let customerIds: string[] | undefined;
    if (String(args.customer || '').trim()) {
      const all = await this.prisma.customer.findMany({ where: { organizationId: org }, select: { id: true, name: true, customerCode: true } });
      const m = matchCustomer(String(args.customer), all);
      if (m.kind === 'one') customerIds = [m.row.id];
      else if (m.kind === 'several') customerIds = m.rows.map((c) => c.id);
      else return { result: { error: `No customer matches "${args.customer}".`, didYouMean: m.suggestions.map((c) => c.name) } };
    }
    const status = String(args.status || '').trim();
    const rows = await this.prisma.delivery.findMany({
      where: {
        organizationId: org,
        OR: [{ scheduledFor: { gte: start, lt: end } }, { scheduledFor: null, createdAt: { gte: start, lt: end } }],
        ...(status === 'draft' ? { isDraft: true } : status ? { status: status as any, isDraft: false } : {}),
        ...(customerIds ? { customerId: { in: customerIds } } : {}),
      },
      orderBy: [{ scheduledFor: 'asc' }, { deliveryNumber: 'asc' }],
      take: Math.min(Number(args.limit) || 20, 50),
      select: {
        id: true,
        deliveryNumber: true,
        status: true,
        isDraft: true,
        direction: true,
        scheduledFor: true,
        siteAddress: true,
        notes: true,
        customer: { select: { name: true } },
        project: { select: { name: true } },
        items: { select: { description: true, quantity: true }, orderBy: { sortOrder: 'asc' } },
      },
    });
    return {
      result: {
        from,
        to,
        count: rows.length,
        deliveries: rows.map((r) => {
          const counts = new Map<string, number>();
          for (const it of r.items) counts.set(it.description || 'item', (counts.get(it.description || 'item') || 0) + (it.quantity || 1));
          return {
            number: r.deliveryNumber,
            when: r.scheduledFor
              ? new Date(r.scheduledFor).toLocaleString('en-GB', { weekday: 'short', day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit', timeZone: 'Asia/Singapore' })
              : null,
            status: r.isDraft ? 'draft' : r.status,
            direction: r.direction,
            customer: r.customer?.name ?? null,
            project: r.project?.name ?? null,
            site: r.siteAddress,
            items: [...counts].map(([d, q]) => `${q} x ${d}`).join(', '),
            notes: r.notes,
          };
        }),
      },
    };
  }

  /** A run already booked from this very card (same customer, project, time,
   *  draft-ness and items, in the last 15 minutes)? Last line of defence behind
   *  the session guards, e.g. a replay on another server instance. */
  private async findDuplicateRun(organizationId: string, dto: any): Promise<{ id: string; deliveryNumber: number } | null> {
    if (!dto?.scheduledFor || !dto?.customerId) return null;
    const runs = await this.prisma.delivery.findMany({
      where: {
        organizationId,
        customerId: dto.customerId,
        projectId: dto.projectId ?? null,
        isDraft: !!dto.isDraft,
        scheduledFor: new Date(dto.scheduledFor),
        createdAt: { gte: new Date(Date.now() - 15 * 60_000) },
      },
      select: { id: true, deliveryNumber: true, items: { select: { assetId: true, description: true, quantity: true } } },
    });
    const sig = (rows: Array<{ assetId?: string | null; description?: string | null; quantity?: number | null }>) => {
      const m = new Map<string, number>();
      for (const r of rows) {
        const k = r.assetId || `t:${compact(r.description)}`;
        m.set(k, (m.get(k) || 0) + (Number(r.quantity) || 1));
      }
      return [...m].sort(([a], [b]) => a.localeCompare(b)).map(([k, q]) => `${k}=${q}`).join('|');
    };
    const want = sig(dto.items || []);
    return runs.find((r) => sig(r.items) === want) ?? null;
  }

  /** The confirmation line for a held tool call that has just run. */
  private doneText(name: string, r: any): string {
    switch (name) {
      case 'create_customer':
        return `Customer ${r.name}${r.customerCode ? ` (${r.customerCode})` : ''} created.`;
      case 'update_customer':
        return `Customer ${r.name} updated (${(r.updated || []).join(', ')}).`;
      case 'create_bill':
        return `Bill ${r.billNumber} recorded, unposted. Ask me to post it when it should go to the ledger.`;
      case 'edit_document':
        return `${r.documentNumber} updated. Total now ${r.nettTotal}.`;
      case 'set_appointment':
        return r.appointment
          ? `Appointment with ${r.lead} set for ${new Date(r.appointment).toLocaleString('en-GB', { weekday: 'short', day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit', timeZone: 'Asia/Singapore' })}.`
          : `Appointment with ${r.lead} cleared.`;
      case 'translate_quotation':
        return r.note || 'Translated.';
      case 'confirm_invoices_from_xero':
        return r.summary || 'Done.';
      default:
        if (r.documentNumber) {
          return `${DOC_LABELS[name] || 'Document'} ${r.documentNumber} created as a draft${r.nettTotal != null ? `, total ${r.nettTotal}` : ''}.`;
        }
        return 'Done.';
    }
  }

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

  /**
   * Progress-billing tracker: which 1-based lines of a quotation have already
   * been invoiced, across every invoice raised from it. A legacy full-copy
   * invoice (no `billedSourceLines` marker) counts as having billed ALL lines.
   */
  private async billedLinesForQuote(organizationId: string, quoteId: string, lineCount: number) {
    const children = await this.prisma.document.findMany({
      where: {
        organizationId,
        type: 'INVOICE',
        config: { path: ['sourceDocumentId'], equals: quoteId },
      },
      select: { name: true, config: true },
    });
    const billed = new Set<number>();
    const billedBy = new Map<number, string>();
    for (const ch of children) {
      const marker = (ch.config as any)?.billedSourceLines;
      const covered: number[] = Array.isArray(marker)
        ? marker.map((n: any) => Number(n))
        : Array.from({ length: lineCount }, (_, i) => i + 1);
      for (const n of covered) {
        billed.add(n);
        if (!billedBy.has(n)) billedBy.set(n, ch.name || 'an invoice');
      }
    }
    const remaining = Array.from({ length: lineCount }, (_, i) => i + 1).filter((n) => !billed.has(n));
    return { billed, billedBy, remaining, childNames: [...new Set(children.map((c) => c.name))] };
  }

  /** Execute a held action after the user confirms it in chat. */
  /** True when the user's ONLY active role in this org is Designer — such
   *  users are row-scoped to projects where they are the designer in charge
   *  (mirrors the portal lists and the HTTP DesignerProjectScopeGuard). */
  private designerOnly(ctx: OperatorContext): boolean {
    if (ctx.isOsirisAdmin) return false;
    const names = ctx.roles.map((r) => r.name);
    return names.length > 0 && names.every((n) => n === 'Designer');
  }

  /** Signed loopback call to our own API, as this user, in this org. */
  private async selfCall(ctx: OperatorContext, method: string, path: string, body?: any) {
    const secret = process.env.INTERNAL_API_SECRET;
    if (!secret) throw new Error('Internal API access is not configured on this server (INTERNAL_API_SECRET missing).');
    const ts = Date.now();
    const crypto = require('crypto');
    // A write is signed over the method and path too, so the header cannot be
    // replayed against a different endpoint. The guard rebuilds the same string.
    const verb = String(method || 'GET').toUpperCase();
    const payload =
      verb === 'GET' ? `${ctx.clerkUserId}.${ts}` : `${ctx.clerkUserId}.${ts}.${verb}.${String(path).split('?')[0]}`;
    const sig = crypto.createHmac('sha256', secret).update(payload).digest('hex');
    const port = process.env.PORT || 4040;
    const res = await fetch(`http://127.0.0.1:${port}${path}`, {
      method,
      headers: {
        'x-operator-internal': `${ctx.clerkUserId}.${ts}.${sig}`,
        'x-active-org-id': ctx.organizationId,
        ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}),
      },
      ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
    });
    const text = await res.text();
    let parsed: any = text;
    try {
      parsed = JSON.parse(text);
    } catch {
      /* non-JSON stays as text */
    }
    return { ok: res.ok, status: res.status, body: parsed, text };
  }

  /** Condensed GET-endpoint catalog from the server's own Swagger doc (the
   *  full dashboard API), cached for an hour — feeds the api_docs tool. */
  private apiCatalogCache: { at: number; lines: string[] } | null = null;
  private async apiCatalog(): Promise<string[]> {
    if (this.apiCatalogCache && Date.now() - this.apiCatalogCache.at < 3600_000) return this.apiCatalogCache.lines;
    const port = process.env.PORT || 4040;
    const doc: any = await (await fetch(`http://127.0.0.1:${port}/api-json`)).json();
    const schemas = doc?.components?.schemas || {};
    // Flatten a DTO $ref into "field:type, field:type" so the agent can build a
    // body without a second round-trip. Only ~26% of write endpoints document
    // one; the rest fall back to the 400 validation message on a failed try.
    const fieldsOf = (op: any): string => {
      const sch = op?.requestBody?.content?.['application/json']?.schema;
      const ref = sch?.$ref || sch?.items?.$ref;
      const def = ref ? schemas[String(ref).split('/').pop()!] : sch;
      const props = def?.properties;
      if (!props) return '';
      const req: string[] = def?.required || [];
      const parts = Object.entries<any>(props)
        .slice(0, 25)
        .map(([k, v]) => `${k}${req.includes(k) ? '*' : ''}:${v?.type || v?.$ref?.split('/').pop() || 'any'}`);
      return parts.length ? ` {${parts.join(', ')}}` : '';
    };
    const lines: string[] = [];
    for (const [path, methods] of Object.entries<any>(doc?.paths || {})) {
      for (const [m, op] of Object.entries<any>(methods || {})) {
        const method = m.toUpperCase();
        if (!['GET', 'POST', 'PATCH', 'PUT'].includes(method)) continue;
        const summary = op?.summary || '';
        const tag = op?.tags?.[0] || '';
        const body = method === 'GET' ? '' : fieldsOf(op);
        lines.push(`${method} ${path}${summary ? ` — ${summary}` : ''}${tag ? ` [${tag}]` : ''}${body}`);
      }
    }
    this.apiCatalogCache = { at: Date.now(), lines };
    return lines;
  }

  async runPending(ctx: OperatorContext, pending: PendingAction): Promise<PendingResult> {
    // The org the card was made in is the org it runs in (per-org tenancy
    // routes every query by it; in the plain layout this is a no-op).
    return runAsOrg(ctx.organizationId, () => this.runPendingInOrg(ctx, pending));
  }

  private async runPendingInOrg(ctx: OperatorContext, pending: PendingAction): Promise<PendingResult> {
    if (pending.kind === 'tool_call') {
      const { tool: name, input } = pending.args || {};
      const tool = this.tools().find((t) => t.name === name);
      if (!tool) return { ok: false, message: 'That action is no longer available, nothing was changed.' };
      if (!this.auth.hasPermission(ctx, tool.permissions)) {
        return { ok: false, message: `You no longer have permission to ${String(name).replace(/_/g, ' ')}, nothing was changed.` };
      }
      const out = await tool.run(ctx, input || {});
      const r: any = out?.result ?? {};
      if (r.error) return { ok: false, message: `Nothing was changed: ${r.error}` };
      if (!tool.logs) {
        const [resource, chip] = TOOL_LOG[name] || ['operator', 'UPDATE'];
        this.log(ctx, 'UPDATED', resource, r.documentId || r.leadId || r.id, r.documentNumber || r.lead, `${name} via Operator (${ctx.channel})`, chip);
      }
      let preview: PendingResult['preview'];
      if (DOC_CREATORS.has(name) && r.documentId) {
        const pv = await this.tools()
          .find((t) => t.name === 'preview_document')!
          .run(ctx, { documentId: r.documentId })
          .catch(() => null);
        if (pv?.preview) preview = pv.preview;
      }
      return { ok: true, message: `✅ ${this.doneText(name, r)}`, preview, note: JSON.stringify(r).slice(0, 1500) };
    }

    if (pending.kind === 'schedule_delivery') {
      const { customerName } = pending.args || {};
      const dto: any = { ...(pending.args?.dto || {}) };
      let isDraft = !!pending.args?.isDraft;
      // Idempotency: the session guards stop a second "ok" in this process;
      // this stops the same card booking twice from anywhere else.
      const dup = await this.findDuplicateRun(ctx.organizationId, dto);
      if (dup) return { ok: true, message: `Already done: delivery #${dup.deliveryNumber} for ${customerName} exists, nothing was repeated.` };
      // A PO uploaded while the card was held becomes its sales order HERE, on
      // Confirm, never before (every write goes through a card).
      if (pending.args?.soUpload && !dto.saleOrderId) {
        const so = await this.createSaleOrderFromUpload(ctx, pending.args.soUpload, customerName, dto.projectId);
        if (!so) return { ok: false, message: "I couldn't create the sales order from that upload, so nothing was booked. Send the SO number instead." };
        dto.saleOrderId = so.id;
        dto.poNumber = dto.poNumber || so.name;
        isDraft = !dto.projectId;
        dto.isDraft = isDraft;
      }
      const run: any = await this.deliveries.createScheduled(dto, ctx.organizationId);
      const ref = run?.deliveryNumber != null ? `#${run.deliveryNumber}` : run?.id;
      this.log(
        ctx,
        'CREATED',
        'delivery',
        run?.id,
        ref,
        `Delivery ${isDraft ? 'saved as a draft' : 'scheduled'} via Operator (${ctx.channel})`,
        isDraft ? 'CREATE_DRAFT' : 'SCHEDULE',
      );
      return {
        ok: true,
        message: isDraft
          ? `✅ Saved as a DRAFT run for ${customerName} (${ref}). It is not booked yet: ${dto.saleOrderId ? 'it needs a project' : 'it needs a sales order'} before it goes live.`
          : `✅ Delivery ${ref} scheduled for ${customerName}.`,
        note: `deliveryId ${run?.id}`,
      };
    }

    if (pending.kind === 'api_write') {
      const { method, path, body } = pending.args || {};
      // Re-check the denylist here too: the pending action is held in session
      // state between the tool call and the tap, so the gate must sit on the
      // side that actually performs the call, not only where it was drafted.
      if (BLOCKED_WRITE_PATHS.some((re) => re.test(String(path)))) {
        return { ok: false, message: 'That endpoint is not reachable this way. Use the dedicated tool for it.' };
      }
      const res = await this.selfCall(ctx, method, path, body);
      if (!res.ok) {
        // class-validator returns field-level messages, which is the agent's
        // feedback loop on endpoints that do not document a body schema. A bare
        // `throw new BadRequestException()` yields the useless string "Bad
        // Request Exception", so fall through to anything else the body holds
        // and always name the call — "(400): Bad Request Exception" left both
        // the user and the next debugger with nothing to go on.
        const b: any = res.body || {};
        const parts = [
          Array.isArray(b.message) ? b.message.join('; ') : typeof b.message === 'string' ? b.message : '',
          typeof b.error === 'string' ? b.error : '',
          b.detail || b.description || '',
        ].filter((x) => x && x !== 'Bad Request Exception');
        const detail = parts.join(' — ') || String(res.text || '').slice(0, 300) || 'no reason given';
        this.logger.warn(`api_write ${method} ${path} -> ${res.status}: ${String(res.text || '').slice(0, 500)}`);
        return { ok: false, message: `${method} ${path} failed (${res.status}): ${detail}` };
      }
      this.log(ctx, 'UPDATED', 'api', undefined, String(path), `${method} ${path} via Operator (${ctx.channel})`);
      return { ok: true, message: `✅ Done. ${pending.summary}` };
    }

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

    if (pending.kind === 'edit_schedule') {
      const a = pending.args || {};
      const res = await this.costing.scheduleAssistApply(a.projectId, ctx.organizationId, a.ops || []);
      this.log(ctx, 'EDITED', 'project', a.projectId, a.projectName, `Schedule updated via Operator (${ctx.channel})`);
      const lines: string[] = Array.isArray(a.lines) ? a.lines : [];
      return { ok: true, message: `🗓 Schedule of ${a.projectName} updated (${res.applied} change${res.applied === 1 ? '' : 's'}):\n${lines.map((l) => `• ${l}`).join('\n')}` };
    }

    if (pending.kind === 'import_price_list') {
      const a = pending.args || {};
      const res = await this.revenueItems.importPricelistApply(ctx.organizationId, { supplierName: a.supplierName || null, mode: a.mode || 'add', items: a.items || [] });
      this.log(ctx, 'CREATED', 'revenue-item', undefined, a.supplierName, `Price list imported via Operator (${ctx.channel})`, 'IMPORT');
      const parts = [res.updated ? `${res.updated} updated` : null, res.created ? `${res.created} added` : null].filter(Boolean).join(', ');
      return {
        ok: true,
        message: `📚 ${a.supplierName || 'Price list'} → Work Library: ${parts || 'no changes'}${res.newSections.length ? ` (new sections: ${res.newSections.join(', ')})` : ''}. Review in Master Files → Work Library.`,
      };
    }

    if (pending.kind === 'add_project_cost') {
      const a = pending.args || {};
      const cost: any = await this.costing.addCost(
        a.projectId,
        ctx.organizationId,
        {
          date: a.date || undefined,
          supplierName: a.supplierName || undefined,
          description: a.description || 'Project cost',
          invoiceNo: a.invoiceNo || undefined,
          amount: Number(a.amount),
          attachmentUrl: a.attachmentUrl || undefined,
          attachmentKey: a.attachmentKey || undefined,
          source: 'whatsapp',
          // Costs filed by chat land as PENDING so a human approves them in the
          // app before they count as final — never auto-approved.
          status: 'pending',
        } as any,
        ctx.actor.name,
      );
      // Also create a linked Bill (AP) DRAFT — unconfirmed, so it does NOT post
      // to the ledger until reviewed. Links to the project cost via inboundMeta.
      let billInfo = '';
      try {
        const rawLines: any[] = Array.isArray(a.lines) && a.lines.length ? a.lines : [];
        const lines =
          rawLines.length > 0
            ? rawLines.map((l) => ({
                description: String(l.description || '').slice(0, 1000),
                quantity: Number(l.quantity) || undefined,
                unitPrice: Number(l.unitPrice) || undefined,
                amount: Number(l.amount) || 0,
              }))
            : [{ description: a.description || `${a.supplierName || 'Supplier'} invoice`, amount: Number(a.amount) }];
        const hasTax = Number(a.taxAmount) > 0;
        const bill: any = await this.bills.create(
          ctx.organizationId,
          ctx.actor.id,
          {
            supplierName: a.supplierName || 'Unknown Supplier',
            billNumber: a.invoiceNo || `WA-${Date.now().toString().slice(-8)}`,
            billDate: a.date || new Date().toISOString().slice(0, 10),
            description: (a.description || '').slice(0, 500) || undefined,
            lines,
            taxAmount: hasTax ? Number(a.taxAmount) : undefined,
            amountsAre: hasTax ? 'INCLUSIVE' : 'NO_TAX',
            inboundChannel: 'UPLOAD',
            inboundMeta: { source: 'whatsapp', projectCostId: cost?.id, projectId: a.projectId, projectName: a.projectName },
          } as any,
          { postOnSave: false }, // DRAFT — no GL post until reviewed
        );
        const b = bill?.data ?? bill;
        const billNo = b?.billNumber || b?.name;
        // Attach the SAME S3 file we already stored (no re-upload) so the bill
        // reviewer sees the original invoice.
        if (b?.id && a.attachmentKey) {
          const ext = String(a.attachmentKey).split('.').pop()?.toLowerCase() || '';
          const mimeType =
            ext === 'pdf' ? 'application/pdf' : ext === 'png' ? 'image/png' : ext === 'webp' ? 'image/webp' : 'image/jpeg';
          const fileName = String(a.attachmentKey).split('/').pop() || `invoice.${ext || 'pdf'}`;
          await this.bills
            .addAttachments(
              ctx.organizationId,
              b.id,
              [{ fileKey: a.attachmentKey, fileName, mimeType, label: 'Original invoice (WhatsApp upload)' }],
              ctx.actor.id,
            )
            .catch(() => null);
        }
        if (cost?.id && b?.id) {
          await this.prisma.projectCost
            .update({ where: { id: cost.id }, data: { notes: `Linked to Bill draft ${billNo || b.id}` } })
            .catch(() => null);
        }
        // Provenance goes in the AUDIT LOG, never in the line description.
        if (b?.id) {
          this.log(ctx, 'CREATED', 'document', b.id, billNo, `Bill draft created from a WhatsApp invoice upload via Operator (${ctx.channel})`);
        }
        billInfo = billNo ? ` + created Bill draft ${billNo} (unconfirmed — review in Bills)` : '';
      } catch (e: any) {
        this.log(ctx, 'ERROR', 'bill', undefined, a.projectName, `Linked bill draft failed: ${e?.message}`);
        billInfo = " (couldn't create the linked Bill draft — the cost is saved; add the bill manually if needed)";
      }

      this.log(ctx, 'CREATED', 'project-cost', cost?.id, a.projectName, `Cost ${a.amount} added to ${a.projectName} via Operator (${ctx.channel})`);
      return {
        ok: true,
        message: `✅ Added ${a.supplierName ? a.supplierName + ' ' : ''}${Number(a.amount).toFixed(2)} to ${a.projectName}'s costing as PENDING APPROVAL${a.attachmentUrl ? ' (invoice attached)' : ''}${billInfo}. Approve it in the app to finalise.`,
      };
    }

    if (pending.kind === 'confirm_quotation') {
      const doc = await this.prisma.document.findFirst({
        where: { id: pending.documentId!, organizationId: ctx.organizationId },
        select: { id: true, name: true, type: true, status: true },
      });
      if (!doc) return { ok: false, message: 'That document no longer exists.' };
      if (doc.status === 'confirmed') return { ok: true, message: `${doc.type} ${doc.name} was already confirmed.` };
      // A quotation confirm is a PURE status transition — no GL posting, no stock
      // movement, no numbering side effects — so flip the status directly. The
      // heavy updateDocument path reconstructs `config`, and with no config sent
      // it throws (rejects the edit) / risks wiping the items, which is what left
      // this stuck on 'unconfirmed' before.
      await this.prisma.document.update({
        where: { id: doc.id },
        data: { status: 'confirmed' },
      });
      this.log(ctx, 'STATUS_CHANGED', 'document', doc.id, doc.name, `Confirmed via Operator (${ctx.channel})`);
      return { ok: true, message: `✅ ${doc.type} ${doc.name} confirmed.` };
    }
    return { ok: false, message: 'Nothing to confirm.' };
  }

  /**
   * Every Operator write lands twice: the legacy AuditLog (document history)
   * and the Activity Log, as the LINKED STAFF USER (not "System creation"),
   * channel whatsapp/telegram, with a semantic action chip and the resource id.
   * The webhook request itself only shows as a system row, so without this the
   * Activity Log could not say who booked a delivery from chat.
   */
  private log(
    ctx: OperatorContext,
    action: string,
    resource: string,
    resourceId?: string,
    resourceName?: string,
    detail?: string,
    chip?: string,
  ) {
    void this.actionLog.log({
      actorType: 'USER',
      actorId: ctx.clerkUserId || ctx.actor.id || 'operator',
      actorName: ctx.actor.name ?? null,
      actorEmail: ctx.actor.email ?? null,
      organizationId: ctx.organizationId,
      channel: ctx.channel,
      method: 'CHAT',
      path: `/operator/${ctx.channel}`,
      action: chip || ACTION_CHIPS[action] || action,
      resource,
      resourceId: resourceId ?? null,
      details: { via: 'operator', name: resourceName, detail },
      status: action === 'ERROR' ? 'FAILURE' : 'SUCCESS',
    });
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
