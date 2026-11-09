import { BadRequestException, Body, Controller, Get, Param, ParseUUIDPipe, Patch, Post, Req, UploadedFile, UseGuards, UseInterceptors } from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { RequiresModule } from '../auth/decorators/requires-module.decorator';
import { ClerkAuthGuard } from '../auth/clerk-auth.guard';
import { Permissions } from '../auth/decorators/permissions.decorator';
import { TradeInvoiceLayoutService } from './trade-invoice-layout.service';
import { actorOf, orgIdOf, TradeRequest } from './shipments.request';
import { decodeUploadName, resolveTradeFileMime, TRADE_FILE_EXTENSIONS, TRADE_FILE_MAX_BYTES } from './shipments.rules';
import { ClientsService } from './clients.service';

const partyOf = (kind: string): 'customer' | 'supplier' => (kind === 'suppliers' ? 'supplier' : 'customer');
const UPLOAD_OPTS = {
  limits: { fileSize: TRADE_FILE_MAX_BYTES, files: 1 },
  fileFilter: (_req: unknown, file: Express.Multer.File, callback: (e: Error | null, ok: boolean) => void) => {
    if (!resolveTradeFileMime(decodeUploadName(file.originalname), file.mimetype)) return callback(new BadRequestException(`File type not allowed. Allowed: ${TRADE_FILE_EXTENSIONS.join(', ')}`), false);
    callback(null, true);
  },
};

/** Round AM — Clients (Customers · Suppliers) for SHIPMENTS orgs: lists, profiles, per-customer document formats. */
@RequiresModule('SHIPMENTS')
@Controller('trade-clients')
@UseGuards(ClerkAuthGuard)
export class ClientsController {
  constructor(
    private readonly clients: ClientsService,
    private readonly layout: TradeInvoiceLayoutService,
  ) {}

  @Get('customers')
  @Permissions('shipments:read')
  customers(@Req() req: TradeRequest) {
    return this.clients.customers(orgIdOf(req));
  }

  @Get('customers/:id')
  @Permissions('shipments:read')
  customer(@Param('id', ParseUUIDPipe) id: string, @Req() req: TradeRequest) {
    return this.clients.customer(orgIdOf(req), id);
  }

  @Get('suppliers')
  @Permissions('shipments:read')
  suppliers(@Req() req: TradeRequest) {
    return this.clients.suppliers(orgIdOf(req));
  }

  @Get('suppliers/:id')
  @Permissions('shipments:read')
  supplier(@Param('id', ParseUUIDPipe) id: string, @Req() req: TradeRequest) {
    return this.clients.supplier(orgIdOf(req), id);
  }

  // ── Round AY part 3: add / edit a customer or supplier, shipping lines ──
  @Post('customers')
  @Permissions('customers:create')
  createCustomer(@Body() body: Record<string, unknown>, @Req() req: TradeRequest) {
    return this.clients.createCustomer(orgIdOf(req), body ?? {});
  }

  @Patch('customers/:id/details')
  @Permissions('customers:update')
  updateCustomer(@Param('id', ParseUUIDPipe) id: string, @Body() body: Record<string, unknown>, @Req() req: TradeRequest) {
    return this.clients.updateCustomerDetails(orgIdOf(req), id, body ?? {});
  }

  @Post('suppliers')
  @Permissions('suppliers:create')
  createSupplier(@Body() body: Record<string, unknown>, @Req() req: TradeRequest) {
    return this.clients.createSupplier(orgIdOf(req), body ?? {});
  }

  @Patch('suppliers/:id/details')
  @Permissions('suppliers:update')
  updateSupplier(@Param('id', ParseUUIDPipe) id: string, @Body() body: Record<string, unknown>, @Req() req: TradeRequest) {
    return this.clients.updateSupplierDetails(orgIdOf(req), id, body ?? {});
  }

  // Round AZ: Clients → Logistics (every logistics company, typed); /shipping-lines is round AY's path, kept as an alias.
  @Get(['logistics', 'shipping-lines'])
  @Permissions('shipments:read')
  shippingLines(@Req() req: TradeRequest) {
    return this.clients.shippingLines(orgIdOf(req));
  }

  @Post(['logistics', 'shipping-lines'])
  @Permissions('shipments:update')
  addShippingLine(@Body() body: unknown, @Req() req: TradeRequest) {
    return this.clients.saveShippingLine(orgIdOf(req), null, body);
  }

  @Patch(['logistics/:code', 'shipping-lines/:code'])
  @Permissions('shipments:update')
  updateShippingLine(@Param('code') code: string, @Body() body: unknown, @Req() req: TradeRequest) {
    if (!/^[A-Z0-9_]{2,40}$/.test(code)) throw new BadRequestException('Unknown logistics company');
    return this.clients.saveShippingLine(orgIdOf(req), code, body);
  }

  /** Round AY: what a process change would do to the customer's open orders / shipments (read-only). */
  @Post('customers/:id/process/preview')
  @Permissions('shipments:read')
  processPreview(@Param('id', ParseUUIDPipe) id: string, @Body() body: { skipSteps?: string[] }, @Req() req: TradeRequest) {
    return this.clients.processImpact(orgIdOf(req), id, body?.skipSteps ?? []);
  }

  /** Round AY: save which steps are part of the customer's process. */
  @Patch('customers/:id/process')
  @Permissions('shipments:update')
  async updateProcess(@Param('id', ParseUUIDPipe) id: string, @Body() body: { skipSteps?: string[] }, @Req() req: TradeRequest) {
    const res = await this.clients.updateProcess(orgIdOf(req), id, body?.skipSteps ?? []);
    (req as any).actionLogResult = { skipSteps: res.impact.skipSteps, hidden: res.impact.hidden.length, shown: res.impact.shown.length, completes: res.impact.completes };
    return res;
  }

  /** Round BG: what the customer's due-date rules would change on its open orders (read-only). */
  @Post('customers/:id/due-rules/preview')
  @Permissions('shipments:read')
  dueRulesPreview(@Param('id', ParseUUIDPipe) id: string, @Body() body: { dueRules?: unknown }, @Req() req: TradeRequest) {
    return this.clients.dueRulesPreview(orgIdOf(req), id, body?.dueRules ?? {});
  }

  /** Round BG: save the customer's due-date rules (step code → rule; a step left out uses the default). */
  @Patch('customers/:id/due-rules')
  @Permissions('shipments:update')
  async updateDueRules(@Param('id', ParseUUIDPipe) id: string, @Body() body: { dueRules?: unknown }, @Req() req: TradeRequest) {
    const res = await this.clients.updateDueRules(orgIdOf(req), id, body?.dueRules ?? {});
    (req as any).actionLogResult = { from: res.from, to: res.to, dueDatesMoved: res.changes.length };
    return res;
  }

  /** Document formats: generator (Customer COA / PL), language, 宛先, note — saved on the customer profile. */
  @Patch('customers/:id/formats/:docType')
  @Permissions('shipments:update')
  updateFormat(@Param('id', ParseUUIDPipe) id: string, @Param('docType') docType: string, @Body() body: { generator?: string | null; language?: string | null; addressee?: string | null; notes?: string | null; si?: unknown }, @Req() req: TradeRequest) {
    return this.clients.updateFormat(orgIdOf(req), id, docType, body ?? {});
  }

  // ── Round BN: 請求書 layout (seal / From block placement) ──────────────
  /** The org default, this customer's override, what is in force, and the customer's invoices to preview on. */
  @Get('customers/:id/formats/INVOICE/layout')
  @Permissions('shipments:read')
  invoiceLayout(@Param('id', ParseUUIDPipe) id: string, @Req() req: TradeRequest) {
    return this.layout.view(orgIdOf(req), id);
  }

  /** This customer's own placement ({ layout } — null / {} = follow the org default). */
  @Patch('customers/:id/formats/INVOICE/layout')
  @Permissions('shipments:update')
  async saveInvoiceLayout(@Param('id', ParseUUIDPipe) id: string, @Body() body: { layout?: unknown }, @Req() req: TradeRequest) {
    const r = await this.layout.save(orgIdOf(req), 'customer', id, body?.layout ?? null, actorOf(req));
    (req as any).actionLogResult = { scope: 'customer', before: r.before, after: r.after, changes: r.changes };
    return this.layout.view(orgIdOf(req), id);
  }

  /** The org default for every customer without its own ({ layout, customerId? } — customerId only picks the view returned). */
  @Patch('invoice-layout')
  @Permissions('shipments:update')
  async saveOrgInvoiceLayout(@Body() body: { layout?: unknown; customerId?: string }, @Req() req: TradeRequest) {
    const r = await this.layout.save(orgIdOf(req), 'org', null, body?.layout ?? null, actorOf(req));
    (req as any).actionLogResult = { scope: 'org', before: r.before, after: r.after, changes: r.changes };
    return body?.customerId ? this.layout.view(orgIdOf(req), body.customerId) : r;
  }

  /** Live preview: a candidate placement on one of the customer's real invoices (DRAFT watermark). Read-only. */
  @Post('customers/:id/formats/INVOICE/layout-preview')
  @Permissions('shipments:read')
  previewInvoiceLayout(@Param('id', ParseUUIDPipe) id: string, @Body() body: { docId?: string; layout?: unknown }, @Req() req: TradeRequest) {
    if (!body?.docId) throw new BadRequestException('Pick an invoice to preview on');
    return this.layout.preview(orgIdOf(req), id, body.docId, body.layout);
  }

  /** Round BF: multipart "file" — ADH's own .xlsx for the 出庫・納入依頼書 ("Download .xlsx" fills it). */
  @Post('customers/:id/formats/SHIPPING_INSTRUCTIONS/xlsx-template')
  @Permissions('shipments:update')
  @UseInterceptors(FileInterceptor('file', { limits: { fileSize: TRADE_FILE_MAX_BYTES, files: 1 } }))
  async setSiTemplate(@Param('id', ParseUUIDPipe) id: string, @UploadedFile() file: Express.Multer.File, @Req() req: TradeRequest) {
    const r = await this.clients.setSiTemplate(orgIdOf(req), id, file, actorOf(req));
    (req as any).actionLogResult = r.siTemplate;
    return r;
  }

  /** Stop using the template (kept, hidden). */
  @Patch('customers/:id/formats/SHIPPING_INSTRUCTIONS/xlsx-template/hide')
  @Permissions('shipments:update')
  hideSiTemplate(@Param('id', ParseUUIDPipe) id: string, @Req() req: TradeRequest) {
    return this.clients.hideSiTemplate(orgIdOf(req), id);
  }

  /** The template's field → cell mapping. Read-only. */
  @Get('customers/:id/formats/SHIPPING_INSTRUCTIONS/xlsx-template/mapping')
  @Permissions('shipments:read')
  siTemplateMapping(@Param('id', ParseUUIDPipe) id: string, @Req() req: TradeRequest) {
    return this.clients.siTemplateMapping(orgIdOf(req), id);
  }

  // ── Round BA: Products / Packing (customers and suppliers) ─────────────
  /** New order: every customer's / supplier's products and the supplier products that fit each customer product. */
  @Get('products')
  @Permissions('shipments:read')
  productCatalog(@Req() req: TradeRequest) {
    return this.clients.productCatalog(orgIdOf(req));
  }

  /** Order / shipment pages: the customer's packing notes, photos and linked issues. */
  @Get('customers/:id/packing')
  @Permissions('shipments:read')
  packingFor(@Param('id', ParseUUIDPipe) id: string, @Req() req: TradeRequest) {
    return this.clients.packingFor(orgIdOf(req), id);
  }

  @Post(':kind(customers|suppliers)/:id/products')
  @Permissions('shipments:update')
  addProduct(@Param('kind') kind: string, @Param('id', ParseUUIDPipe) id: string, @Body() body: unknown, @Req() req: TradeRequest) {
    return this.clients.saveProduct(orgIdOf(req), partyOf(kind), id, null, body);
  }

  @Patch(':kind(customers|suppliers)/:id/products/:productId')
  @Permissions('shipments:update')
  updateProduct(@Param('kind') kind: string, @Param('id', ParseUUIDPipe) id: string, @Param('productId', ParseUUIDPipe) productId: string, @Body() body: unknown, @Req() req: TradeRequest) {
    return this.clients.saveProduct(orgIdOf(req), partyOf(kind), id, productId, body);
  }

  /** Hide a product ({ hidden: false } shows it again) — kept, never deleted. */
  @Patch(':kind(customers|suppliers)/:id/products/:productId/hide')
  @Permissions('shipments:update')
  hideProduct(@Param('kind') kind: string, @Param('id', ParseUUIDPipe) id: string, @Param('productId', ParseUUIDPipe) productId: string, @Body() body: { hidden?: boolean }, @Req() req: TradeRequest) {
    return this.clients.hideProduct(orgIdOf(req), partyOf(kind), id, productId, body?.hidden !== false);
  }

  /** Multipart "file" (+ caption, takenOn): a spec sheet (slot "spec") or packing photo (slot "packing") on one product. */
  @Post(':kind(customers|suppliers)/:id/products/:productId/files/:slot')
  @Permissions('shipments:update')
  @UseInterceptors(FileInterceptor('file', UPLOAD_OPTS))
  addProductFile(
    @Param('kind') kind: string,
    @Param('id', ParseUUIDPipe) id: string,
    @Param('productId', ParseUUIDPipe) productId: string,
    @Param('slot') slot: string,
    @UploadedFile() file: Express.Multer.File,
    @Body() body: { caption?: string; takenOn?: string },
    @Req() req: TradeRequest,
  ) {
    return this.clients.addProductFile(orgIdOf(req), partyOf(kind), id, productId, slot, file, body ?? {}, actorOf(req));
  }

  /** Multipart "file" (+ caption, takenOn): a photo in the company's Packing gallery. */
  @Post(':kind(customers|suppliers)/:id/packing/images')
  @Permissions('shipments:update')
  @UseInterceptors(FileInterceptor('file', UPLOAD_OPTS))
  addPackingImage(@Param('kind') kind: string, @Param('id', ParseUUIDPipe) id: string, @UploadedFile() file: Express.Multer.File, @Body() body: { caption?: string; takenOn?: string }, @Req() req: TradeRequest) {
    return this.clients.addPackingImage(orgIdOf(req), partyOf(kind), id, file, body ?? {}, actorOf(req));
  }

  /** Packing notes and linked issue ids. */
  @Patch(':kind(customers|suppliers)/:id/packing')
  @Permissions('shipments:update')
  savePacking(@Param('kind') kind: string, @Param('id', ParseUUIDPipe) id: string, @Body() body: unknown, @Req() req: TradeRequest) {
    return this.clients.savePacking(orgIdOf(req), partyOf(kind), id, body);
  }

  /** Hide a spec sheet / packing photo (kept). */
  @Patch(':kind(customers|suppliers)/:id/files/:fileId/hide')
  @Permissions('shipments:update')
  hideProfileFile(@Param('kind') kind: string, @Param('id', ParseUUIDPipe) id: string, @Param('fileId', ParseUUIDPipe) fileId: string, @Req() req: TradeRequest) {
    return this.clients.hideProfileFile(orgIdOf(req), partyOf(kind), id, fileId);
  }

  @Get(':kind(customers|suppliers)/:id/files/:fileId/url')
  @Permissions('shipments:read')
  profileFileUrl(@Param('kind') kind: string, @Param('id', ParseUUIDPipe) id: string, @Param('fileId', ParseUUIDPipe) fileId: string, @Req() req: TradeRequest) {
    return this.clients.profileFileUrl(orgIdOf(req), partyOf(kind), id, fileId);
  }

  /** Multipart "file": a sample / template the customer gave for this document. */
  @Post('customers/:id/formats/:docType/samples')
  @Permissions('shipments:update')
  @UseInterceptors(
    FileInterceptor('file', {
      limits: { fileSize: TRADE_FILE_MAX_BYTES, files: 1 },
      fileFilter: (_req, file, callback) => {
        if (!resolveTradeFileMime(decodeUploadName(file.originalname), file.mimetype)) return callback(new BadRequestException(`File type not allowed. Allowed: ${TRADE_FILE_EXTENSIONS.join(', ')}`), false);
        callback(null, true);
      },
    }),
  )
  addSample(@Param('id', ParseUUIDPipe) id: string, @Param('docType') docType: string, @UploadedFile() file: Express.Multer.File, @Req() req: TradeRequest) {
    return this.clients.addSample(orgIdOf(req), id, docType, file, actorOf(req));
  }

  /** Hide a sample (kept, never deleted). */
  @Patch('customers/:id/formats/:docType/samples/:sampleId/hide')
  @Permissions('shipments:update')
  hideSample(@Param('id', ParseUUIDPipe) id: string, @Param('docType') docType: string, @Param('sampleId', ParseUUIDPipe) sampleId: string, @Req() req: TradeRequest) {
    return this.clients.hideSample(orgIdOf(req), id, docType, sampleId);
  }

  @Get('customers/:id/formats/:docType/samples/:sampleId/url')
  @Permissions('shipments:read')
  sampleUrl(@Param('id', ParseUUIDPipe) id: string, @Param('docType') docType: string, @Param('sampleId', ParseUUIDPipe) sampleId: string, @Req() req: TradeRequest) {
    return this.clients.sampleUrl(orgIdOf(req), id, docType, sampleId);
  }

  @Get('customers/:id/preview-shipments')
  @Permissions('shipments:read')
  previewShipments(@Param('id', ParseUUIDPipe) id: string, @Req() req: TradeRequest) {
    return this.clients.previewShipments(orgIdOf(req), id);
  }

  /** Read-only: the document of a real shipment in this format (PDF, and SUS's .xlsx) — logged as a VIEW. */
  @Post('customers/:id/formats/:docType/preview')
  @Permissions('shipments:read')
  preview(@Param('id', ParseUUIDPipe) id: string, @Param('docType') docType: string, @Body() body: { shipmentId?: string; generator?: string | null }, @Req() req: TradeRequest) {
    return this.clients.preview(orgIdOf(req), id, docType, body ?? {});
  }
}
