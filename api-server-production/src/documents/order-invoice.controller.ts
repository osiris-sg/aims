import { Body, Controller, Get, HttpException, HttpStatus, Param, Post, Query, Req, UseGuards } from '@nestjs/common';
import { ClerkAuthGuard } from 'src/auth/clerk-auth.guard';
import { Permissions } from 'src/auth/decorators/permissions.decorator';
import { DocumentsService } from './documents.service';

/**
 * WCT invoice per order (enableWctOrderInvoice, 2026-11-01): the admin's
 * "Invoice now" on the order page. Lives in the documents module because the
 * invoice is built by DocumentsService (pricing ladder, numbering, GL post);
 * the Orders module can't depend on it (DocumentsService already depends on
 * OrdersService). Same /orders prefix as OrdersController.
 */
@Controller('orders')
@UseGuards(ClerkAuthGuard)
export class OrderInvoiceController {
  constructor(private readonly documents: DocumentsService) {}

  /**
   * WCT orders hub (2026-11-13): the order's quotation as a PDF (the signed
   * one once the customer signed), for the order page's Documents list. Only
   * the order's own quotation; the same cached render the pay / sign pages use.
   */
  @Get(':id/quotation-pdf')
  @Permissions('orders:read')
  async quotationPdf(@Param('id') id: string, @Req() req: any) {
    const orgId = req.userOrganization?.id;
    if (!orgId) throw new HttpException('User is not assigned to any organization', HttpStatus.FORBIDDEN);
    const url = await this.documents.orderQuotationPdfUrl(id, orgId);
    if (!url) throw new HttpException('The quotation PDF is not available', HttpStatus.NOT_FOUND);
    return { url };
  }

  /**
   * Order page Documents (2026-11-17): one of the order's invoices (every split
   * part too) as a PDF. Only an invoice of this order; a draft is re-rendered.
   */
  @Get(':id/invoice-pdf')
  @Permissions('orders:read')
  async invoicePdf(@Param('id') id: string, @Query('documentId') documentId: string, @Req() req: any) {
    const orgId = req.userOrganization?.id;
    if (!orgId) throw new HttpException('User is not assigned to any organization', HttpStatus.FORBIDDEN);
    const url = documentId ? await this.documents.orderInvoicePdfUrl(id, documentId, orgId) : null;
    if (!url) throw new HttpException('The invoice PDF is not available', HttpStatus.NOT_FOUND);
    return { url };
  }

  /**
   * Imported orders (2026-11-19): "Create invoice" on a part-billed imported order. A NATIVE draft invoice for
   * what is left on the quotation (normal numbering; posts per postInvoicesOnConfirm when confirmed), linked to
   * the order. The quotation and the imported invoices are not touched. Round 36: an AIMS order of an org with
   * invoicing per order too, while it is billed below its quotation total; the number is always the org's next
   * INV number (a `number` in the body is ignored).
   */
  @Post(':id/invoice-remaining')
  @Permissions('documents:update')
  async invoiceRemaining(@Param('id') id: string, @Body() body: any, @Req() req: any) {
    const orgId = req.userOrganization?.id;
    if (!orgId) throw new HttpException('User is not assigned to any organization', HttpStatus.FORBIDDEN);
    const inv: any = await this.documents.invoiceImportedOrderRemainder(id, orgId, { lines: Array.isArray(body?.lines) ? body.lines : null });
    return { id: inv.id, name: inv.name, type: 'INVOICE', href: `/portal/documents/INVOICE/${inv.documentTemplateId}/${inv.id}` };
  }

  /**
   * Orders list "+" Quotation (round 38, WCT orders): a new draft quotation for an AIMS order with none, prefilled
   * with the order's customer and site; its first save links it to the order. Activity Log: CREATE on orders with
   * the quotation and order in the result.
   */
  @Post(':id/new-quotation')
  @Permissions('orders:update', 'documents:create-basic')
  async newQuotation(@Param('id') id: string, @Req() req: any) {
    const orgId = req.userOrganization?.id;
    if (!orgId) throw new HttpException('User is not assigned to any organization', HttpStatus.FORBIDDEN);
    const u: any = req.user || {};
    const out = await this.documents.newQuotationForOrder(id, orgId, { id: u.id, name: [u.firstName, u.lastName].filter(Boolean).join(' ').trim() || undefined, email: u.emailAddresses?.[0]?.emailAddress ?? u.email ?? undefined } as any);
    req.actionLogResult = { created: `Quotation ${out.name ?? out.id}`, forOrder: out.orderNumber, linksOnSave: true };
    return out;
  }

  @Post(':id/invoice-now')
  @Permissions('documents:update')
  async invoiceNow(@Param('id') id: string, @Req() req: any) {
    const orgId = req.userOrganization?.id;
    if (!orgId) throw new Error('User is not assigned to any organization');
    const u: any = req.user || {};
    const invoice: any = await this.documents.invoiceOrder(id, orgId, {
      trigger: 'now',
      actor: { id: u.id, name: [u.firstName, u.lastName].filter(Boolean).join(' ').trim() || undefined },
    });
    if (!invoice) return null;
    // covered: the quotation is already billed and these jobs added nothing on top, so no new invoice was made.
    // existing: the order already had its invoice (made at signing): the page opens it instead of a second one.
    if (invoice.existing) return { id: invoice.id, name: invoice.name, type: invoice.type, existing: true, href: `/portal/documents/${invoice.type ?? 'INVOICE'}/${invoice.documentTemplateId}/${invoice.id}` };
    return invoice.covered
      ? { id: invoice.id, name: invoice.name, type: invoice.type, covered: true, jobNumbers: invoice.jobNumbers ?? [] }
      : { id: invoice.id, name: invoice.name, type: invoice.type };
  }
}
