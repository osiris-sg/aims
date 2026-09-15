import { ForbiddenException, HttpException, HttpStatus, Injectable } from '@nestjs/common';
import Anthropic from '@anthropic-ai/sdk';
import { PrismaService } from 'src/common/prisma.service';
import { PdfGeneratorService } from 'src/common/services/pdf-generator.service';
import { DocumentsService, DocumentActor } from '../documents/documents.service';
import { DocumentTemplatesService } from '../documentTemplates/documentTemplates.service';
import { OSIRIS_LOGO_DATA_URI } from './osiris-logo';

/**
 * SOW Builder — OSIRIS-INTERNAL tool (osirisadmin only, guru 2026-09-16).
 * Select the AIMS modules a prospective customer wants + a rough context
 * blurb (typed or dictated) → Claude drafts a Statement of Work in the house
 * format (modelled verbatim on the CIEL INTERIOR SOW) → PDF download, and
 * optionally a draft QUOTATION or INVOICE in the Osiris Technology org.
 */

// Osiris Technology Pte. Ltd. — same id in dev + prod (dev is a prod clone).
const OSIRIS_ORG_ID = 'd068f159-e45a-4da8-beaf-62e903f44141';
const OSIRIS_UEN = '202410096C';
const MODEL = 'claude-sonnet-5';

// Curated module catalog the page's checkboxes come from. `seed` gives the
// generator grounded, non-hallucinated capabilities per module.
export const SOW_MODULES: Array<{ key: string; name: string; seed: string }> = [
  { key: 'quotations', name: 'Quotations & Sales Documents', seed: 'Quotation builder with templatised line items, custom document numbering, revisions, client e-signature via secure link, PDF output matching the customer\'s existing format; quotation → sales order → delivery order → invoice paper trail.' },
  { key: 'invoicing', name: 'Invoicing, Payments & Receipts', seed: 'Formal invoices raised from signed quotations, progressive payment schedules, one-click send via WhatsApp/email with PayNow QR, official receipts, invoice locking after confirmation with credit/debit note corrections, public click-to-pay links.' },
  { key: 'accounting', name: 'Accounting & General Ledger', seed: 'Full double-entry GL with auto-posting from documents, Xero-style reports (P&L, Balance Sheet, Trial Balance, GST F5, aged receivables/payables), bank reconciliation, posting-review queue for the accountant, multi-currency, period close.' },
  { key: 'inventory', name: 'Inventory & Asset Tracking', seed: 'Serial-tracked units with QR/NFC tagging, stock card, rental/sale status, stock deduction on confirmed documents, parent-child assets, custom price tiers.' },
  { key: 'deliveries', name: 'Deliveries & Field App', seed: 'Delivery scheduling and runs, Android field app with NFC scanning and GPS, guest driver links with photo proof + customer e-signature, auto-created delivery orders and draft invoices on completion.' },
  { key: 'projects', name: 'Projects, Costing & Margins', seed: 'Project folders with deployments and linked documents, per-line cost/margin entry with configurable margin guardrails and management alerts, live project P&L, variation orders linked to the original quotation, supplier cost capture and 3-way checking.' },
  { key: 'leads', name: 'Lead Management & CRM', seed: 'Lead tracker with automatic capture from lead-platform emails, WhatsApp-driven assignment to salespeople/designers, status workflow, per-person conversion ratios, cost per lead and customer-acquisition-cost analytics.' },
  { key: 'scheduling', name: 'Project Scheduling & Client Calendar', seed: 'Per-project work-stage calendar from a standard stage library, client-facing live schedule link and PDF export, weekly schedule maintained by the team.' },
  { key: 'commissions', name: 'Commissions & Incentives', seed: 'Automatic commission computation per salesperson/designer from project profit, configurable rates with per-project overrides, signing incentives, commission advances with management approval and automatic offset.' },
  { key: 'marketing', name: 'Marketing & Acquisition Analytics', seed: 'Marketing dashboard for ad spend (Meta/TikTok), cost-per-lead and CAC reporting linked to the lead tracker, website inquiry capture, capture-everything-first metrics.' },
  { key: 'whatsapp_ai', name: 'WhatsApp & AI Assistance', seed: 'WhatsApp as an input channel (supplier invoices, site photos, delivery confirmations captured to the right project), AI document extraction from uploads, AI-assisted drafting with human verification, in-app AI guide assistant.' },
  { key: 'recurring', name: 'Recurring Billing', seed: 'Recurring invoice schedules (draft-for-review or fully automatic), metered billing with monthly readings, deployment-anchored rental chains.' },
  { key: 'doc_ai', name: 'Document Upload & AI Extraction', seed: 'Bulk upload of existing PDFs/images/ZIPs, AI extraction into drafts for review, supplier invoice intake via email with AI classification.' },
  { key: 'reports', name: 'Reports & Dashboards', seed: 'Management dashboards, report directory with favourites, CSV/print export on every report, activity log of all user actions.' },
];

export interface SowData {
  customerName: string;
  customerUen?: string;
  effectiveDate: string; // dd-mm-yyyy
  author?: string;
  versionDescription?: string;
  overview?: string;
  goalsIntro?: string;
  goals?: string[];
  scopeSections?: Array<{ letter: string; title: string; bullets: string[] }>;
  delivery?: string[];
  outOfScope?: string;
  customerRequirements?: string[];
  assumptions?: string[];
  fees: Array<{ item: string; description: string; fee: string }>;
  paymentSchedule?: string[];
  reviewPeriod?: string;
  nextReviewDate?: string;
}

@Injectable()
export class SowService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly pdfGen: PdfGeneratorService,
    private readonly documents: DocumentsService,
    private readonly templates: DocumentTemplatesService,
  ) {}

  assertOsirisAdmin(req: any) {
    if (!req?.isOsirisAdmin) throw new ForbiddenException('Osiris internal tool — osirisadmin only');
  }

  listModules() {
    return SOW_MODULES.map(({ key, name }) => ({ key, name }));
  }

  async generate(body: {
    customerName: string;
    customerUen?: string;
    effectiveDate?: string;
    modules: string[];
    context: string;
    fees?: Array<{ item: string; description: string; fee: string }>;
    paymentSchedule?: string;
    termNote?: string;
  }): Promise<SowData> {
    const apiKey = process.env.ANTHROPIC_API_KEY;
    if (!apiKey) throw new HttpException('ANTHROPIC_API_KEY not configured', HttpStatus.INTERNAL_SERVER_ERROR);
    const picked = SOW_MODULES.filter((m) => body.modules?.includes(m.key));
    if (!picked.length) throw new HttpException('Select at least one module', HttpStatus.BAD_REQUEST);
    if (!body.customerName?.trim()) throw new HttpException('Customer name is required', HttpStatus.BAD_REQUEST);

    const client = new Anthropic({ apiKey });
    const prompt = `You are drafting the VARIABLE sections of a Statement of Work (SOW) for Osiris Technology Pte. Ltd. ("Provider") covering a customisation of the AIMS business-management platform for a customer. The document boilerplate (approval tables, periodic review, service management/SLA) is fixed — you only write the parts below.

CUSTOMER: ${body.customerName}${body.customerUen ? ` (UEN ${body.customerUen})` : ''}
SELECTED AIMS MODULES (with grounded capability notes — do not invent capabilities beyond these plus the context):
${picked.map((m) => `- ${m.name}: ${m.seed}`).join('\n')}

CONTEXT FROM THE OSIRIS TEAM (rough notes about this customer's business and what they want; may be dictated/informal):
${body.context || '(none given)'}
${body.termNote ? `\nCOMMERCIAL/TERM NOTES: ${body.termNote}` : ''}

STYLE REFERENCE (from a real Osiris SOW — match this register and level of detail):
- Overview clause example: "…for the provisioning, customisation and ongoing support of the AIMS business management platform to run CIEL INTERIOR PTE. LTD.'s interior design operations, covering leads, quotations, variation orders, invoicing and payments, project costing and margins, project scheduling, designer commissions, and marketing analytics."
- Scope bullets are concrete and operational, e.g.: "Margin guardrails: any line item or overall quotation falling below the 15% minimum margin is flagged, requires the designer to enter a reason/remark, and triggers an alert to management."
- Goals bullets state business outcomes, e.g.: "Actual cost, charged price and margin are visible per line item and per project at all times".

Respond ONLY with JSON matching:
{
  "versionDescription": "Statement of Work: AIMS Platform Customisation for <short descriptor>",
  "overview": "one paragraph: This Agreement represents a Statement of Work (\\"SOW\\" or \\"Agreement\\") between Osiris Technology Pte. Ltd. and <CUSTOMER> for … covering <the areas>.",
  "goalsIntro": "one sentence: The goal of this Agreement is to …, so that:",
  "goals": ["4-6 outcome bullets tailored to the customer"],
  "scopeSections": [{"letter":"A","title":"<module-derived section title>","bullets":["3-6 concrete scope bullets, tailored with the context; use the customer's specifics (rates, workflows) when the context gives them"]}],
  "delivery": ["2-4 bullets: initial build timeline, refinement period, later phases — infer sensible defaults if the context doesn't say"],
  "outOfScope": "one sentence starting 'Out of scope for this SOW: …'",
  "customerRequirements": ["2-4 EXTRA customer-responsibility bullets specific to this engagement (reference materials, approvers, feedback) — generic payment/availability bullets are already in the boilerplate"],
  "assumptions": ["2-4 assumption bullets specific to this engagement"]
}
One scope section per selected module (merge closely-related modules if that reads better, but cover every selected module). British English, Singapore business context.`;

    const res = await client.messages.create({
      model: MODEL,
      max_tokens: 4000,
      messages: [{ role: 'user', content: prompt }],
    });
    const text = res.content.map((b: any) => (b.type === 'text' ? b.text : '')).join('');
    const jsonMatch = text.match(/\{[\s\S]*\}/);
    if (!jsonMatch) throw new HttpException('AI returned no JSON', HttpStatus.INTERNAL_SERVER_ERROR);
    let ai: any;
    try {
      ai = JSON.parse(jsonMatch[0]);
    } catch {
      throw new HttpException('AI returned invalid JSON', HttpStatus.INTERNAL_SERVER_ERROR);
    }

    const today = new Date();
    const dd = (n: number) => String(n).padStart(2, '0');
    const fmt = (d: Date) => `${dd(d.getDate())}-${dd(d.getMonth() + 1)}-${d.getFullYear()}`;
    const effective = body.effectiveDate || fmt(today);
    const next = new Date(today);
    next.setMonth(next.getMonth() + 6);

    return {
      customerName: body.customerName.trim(),
      customerUen: body.customerUen?.trim() || undefined,
      effectiveDate: effective,
      author: 'Kumaraguru',
      versionDescription: ai.versionDescription,
      overview: ai.overview,
      goalsIntro: ai.goalsIntro,
      goals: ai.goals || [],
      scopeSections: ai.scopeSections || [],
      delivery: ai.delivery || [],
      outOfScope: ai.outOfScope || '',
      customerRequirements: ai.customerRequirements || [],
      assumptions: ai.assumptions || [],
      fees: body.fees?.filter((f) => f.item?.trim()) || [],
      paymentSchedule: body.paymentSchedule
        ? body.paymentSchedule.split('\n').map((s) => s.trim()).filter(Boolean)
        : [],
      reviewPeriod: 'Bi-Yearly (6 months)',
      nextReviewDate: fmt(next),
    };
  }

  // ── HTML → PDF, replicating the house SOW layout ─────────────────────────
  renderHtml(d: SowData): string {
    const esc = (s: any) => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
    const ul = (items?: string[]) => (items?.length ? `<ul>${items.map((i) => `<li>${esc(i)}</li>`).join('')}</ul>` : '');
    const logo = `<div class="logo"><img src="${OSIRIS_LOGO_DATA_URI}" alt="OSIRIS" /></div>`;
    const footer = `<div class="foot">Osiris Technology Pte. Ltd.<br/>UEN ${OSIRIS_UEN}</div>`;
    const custFull = `${esc(d.customerName)}${d.customerUen ? ` (UEN ${esc(d.customerUen)})` : ''}`;

    const feesRows = (d.fees || [])
      .map((f) => `<tr><td>${esc(f.item)}</td><td>${esc(f.description)}</td><td>${esc(f.fee)}</td></tr>`)
      .join('');

    return `<!DOCTYPE html><html><head><meta charset="utf-8"><style>
      @page { margin: 20mm 18mm; }
      body { font-family: 'Times New Roman', Times, serif; font-size: 11.5pt; color: #000; line-height: 1.45; }
      .logo { text-align: right; margin-bottom: 24px; }
      .logo img { width: 150px; height: auto; }
      * { -webkit-print-color-adjust: exact; print-color-adjust: exact; }
      .page { page-break-after: always; }
      .titlebox { border: 1.5px solid #000; text-align: center; padding: 36px 24px; margin: 90px 30px 40px; }
      .titlebox h1 { font-size: 18pt; margin: 0 0 4px; }
      .titlebox .for { font-size: 15pt; font-style: italic; font-weight: 700; margin-bottom: 8px; }
      .titlebox .eff { font-weight: 700; margin-top: 18px; }
      table { border-collapse: collapse; width: 100%; margin: 8px 0 18px; }
      td, th { border: 1.2px solid #000; white-space: normal; padding: 5px 8px; text-align: left; vertical-align: top; font-size: 11pt; }
      th { font-weight: 700; }
      h2 { font-size: 13.5pt; margin: 22px 0 8px; }
      h3 { font-size: 12pt; font-weight: 400; margin: 16px 0 6px; }
      ul { margin: 6px 0 10px 22px; padding: 0; }
      li { margin-bottom: 5px; }
      .small { font-size: 10pt; font-style: italic; }
      .foot { text-align: center; font-size: 9.5pt; margin-top: 30px; }
      .toc li { margin-bottom: 3px; }
      .scope-title { font-weight: 700; margin: 12px 0 4px; }
    </style></head><body>

    <div class="page">
      ${logo}
      <div class="titlebox">
        <h1>Statement of Work (SOW)</h1>
        <div class="for">for ${esc(d.customerName)}</div>
        <div>by</div>
        <div style="font-size:13pt;">Osiris Technology Pte. Ltd.</div>
        <div class="eff">Effective Date: ${esc(d.effectiveDate)}</div>
      </div>
      <table><tr><th style="width:40%;">Document Owner:</th><td>OSIRIS TECHNOLOGY PTE. LTD.</td></tr></table>
      <p style="font-weight:700;margin-bottom:2px;">Version</p>
      <table><tr><th>Version</th><th>Date</th><th>Description</th><th>Author</th></tr>
      <tr><td>1.0</td><td style="white-space:nowrap;">${esc(d.effectiveDate)}</td><td>${esc(d.versionDescription)}</td><td>${esc(d.author || 'Kumaraguru')}</td></tr></table>
      <p style="font-weight:700;margin-bottom:2px;">Approval</p>
      <p class="small">(By signing below, all Approvers agree to all terms and conditions outlined in this Agreement.)</p>
      <table><tr><th>Approvers</th><th>Role</th><th>Signed</th><th>Approval Date</th></tr>
      <tr><td>OSIRIS TECHNOLOGY PTE. LTD.</td><td>Service Provider</td><td></td><td></td></tr>
      <tr><td>${custFull}</td><td>Customer</td><td></td><td></td></tr></table>
      ${footer}
    </div>

    <div class="page">
      ${logo}
      <h2>Table of Contents</h2>
      <ol class="toc">
        <li>Agreement Overview</li><li>Goals &amp; Objectives</li><li>Stakeholders</li><li>Periodic Review</li>
        <li>Service Agreement<ol style="list-style:none;margin-left:14px;">
          <li>5.1. Service Scope</li><li>5.2. Customer Requirements</li><li>5.3. Service Provider Requirements</li>
          <li>5.4. Service Assumptions</li><li>5.5. Fees &amp; Term</li></ol></li>
        <li>Service Management<ol style="list-style:none;margin-left:14px;">
          <li>6.1. Service Availability</li><li>6.2. Service Requests</li></ol></li>
      </ol>
      ${footer}
    </div>

    ${logo}
    <h2>1. Agreement Overview</h2>
    <p>${esc(d.overview)}</p>
    <p>This Agreement remains valid until superseded by a revised agreement mutually endorsed by the stakeholders.</p>
    <p>This Agreement outlines the parameters of all IT services covered as they are mutually understood by the primary stakeholders. This Agreement does not supersede current processes and procedures unless explicitly stated herein.</p>

    <h2>2. Goals &amp; Objectives</h2>
    <p>The purpose of this Agreement is to ensure that the proper elements and commitments are in place to provide consistent IT service support and delivery to the Customer(s) by the Service Provider(s).</p>
    <p>${esc(d.goalsIntro)}</p>
    ${ul(d.goals)}

    <h2>3. Stakeholders</h2>
    <p>The following Service Provider(s) and Customer(s) will be used as the basis of the Agreement and represent the primary stakeholders associated with this SOW:</p>
    <p>IT Service Provider(s): OSIRIS TECHNOLOGY PTE. LTD. (&ldquo;Provider&rdquo;)</p>
    <p>IT Customer(s): ${custFull} (&ldquo;Customer&rdquo;)</p>

    <h2>4. Periodic Review</h2>
    <p>This Agreement is valid from the Effective Date outlined herein and is valid until further notice. This Agreement should be reviewed at a minimum once per fiscal year; however, in lieu of a review during any period specified, the current Agreement will remain in effect.</p>
    <p>The Business Relationship Manager (&ldquo;Document Owner&rdquo;) is responsible for facilitating regular reviews of this document. Contents of this document may be amended as required, provided mutual agreement is obtained from the primary stakeholders and communicated to all affected parties. The Document Owner will incorporate all subsequent revisions and obtain mutual agreements / approvals as required.</p>
    <p>Business Relationship Manager: Osiris Technology Pte. Ltd.<br/>
    Review Period: ${esc(d.reviewPeriod)}<br/>
    Previous Review Date: ${esc(d.effectiveDate)}<br/>
    Next Review Date: ${esc(d.nextReviewDate)}</p>

    <h2>5. Service Agreement</h2>
    <p>The following detailed service parameters are the responsibility of the Service Provider in the ongoing support of this Agreement.</p>
    <h3>5.1. Service Scope</h3>
    <p>The following Services are covered by this Agreement:</p>
    <p style="font-weight:700;">Scope of Work:</p>
    ${(d.scopeSections || [])
      .map((s) => `<div class="scope-title">${esc(s.letter)}. ${esc(s.title)}</div>${ul(s.bullets)}`)
      .join('')}
    <p style="font-weight:700;">Delivery Approach &amp; Timeline:</p>
    ${ul(d.delivery)}
    <p>${esc(d.outOfScope)}</p>

    <h3>5.2. Customer Requirements</h3>
    <p>Customer responsibilities and/or requirements in support of this Agreement include:</p>
    ${ul(['Payment for all support costs at the agreed interval.', 'Reasonable availability of customer representative(s) when resolving a service related incident or request.', ...(d.customerRequirements || [])])}

    <h3>5.3. Service Provider Requirements</h3>
    <p>Service Provider responsibilities and/or requirements in support of this Agreement include:</p>
    ${ul(['Meeting response times associated with service related incidents.', 'Appropriate notification to Customer for all scheduled maintenance.', 'Delivery of the customisations in Section 5.1 and training/handholding of the Customer’s team during the refinement period.'])}

    <h3>5.4. Service Assumptions</h3>
    <p>Assumptions related to in-scope services and/or components include:</p>
    ${ul(['Changes to services will be communicated and documented to all stakeholders.', ...(d.assumptions || [])])}

    <h3>5.5. Fees &amp; Term</h3>
    <p>The following fees apply to the services covered by this Agreement:</p>
    <table><tr><th style="width:28%;">Item</th><th>Description</th><th style="width:20%;">Fee (SGD)</th></tr>${feesRows || '<tr><td colspan="3">To be agreed.</td></tr>'}</table>
    ${d.paymentSchedule?.length ? `<p style="font-weight:700;">Payment Schedule:</p>${ul(d.paymentSchedule)}` : ''}

    <h2>6. Service Management</h2>
    <p>Effective support of in-scope services is a result of maintaining consistent service levels. The following sections provide relevant details on service availability, monitoring of in-scope services and related components.</p>
    <h3>6.1. Service Availability</h3>
    <p>Coverage parameters specific to the service(s) covered in this Agreement are as follows:</p>
    ${ul(['Telephone support: 9:00 A.M. to 5:00 P.M. Monday - Friday. Calls received out of office hours will be forwarded to a mobile phone and best efforts will be made to answer / action the call, however there will be a backup answer phone service.', 'Email support: Monitored 9:00 A.M. to 5:00 P.M. Monday - Friday. Emails received outside of office hours will be collected, however no action can be guaranteed until the next working day.', 'Onsite assistance guaranteed within 72 hours during the business week.'])}
    <h3>6.2. Service Requests</h3>
    <p>In support of services outlined in this Agreement, the Service Provider will respond to service related incidents and/or requests submitted by the Customer within the following time frames:</p>
    ${ul(['0-8 hours (during business hours) for issues classified as High priority.', 'Within 48 hours for issues classified as Medium priority.', 'Within 5 working days for issues classified as Low priority.'])}
    <p>Remote assistance will be provided in-line with the above timescales dependent on the priority of the support request.</p>
    ${footer}
    </body></html>`;
  }

  async pdf(d: SowData): Promise<{ filename: string; base64: string }> {
    const html = this.renderHtml(d);
    const buf = await this.pdfGen.generatePdfFromHtml(html);
    return { filename: `AIMS SOW - ${d.customerName}.pdf`, base64: buf.toString('base64') };
  }

  // Create a draft QUOTATION or INVOICE in the OSIRIS org from the fee table.
  async createDocument(
    body: { type: 'QUOTATION' | 'INVOICE'; customerName: string; customerUen?: string; fees: Array<{ item: string; description: string; fee: string }> },
    actor?: DocumentActor,
  ) {
    const type = body.type === 'INVOICE' ? 'INVOICE' : 'QUOTATION';
    // Find-or-create the customer in the Osiris org.
    let customer = await this.prisma.customer.findFirst({
      where: { organizationId: OSIRIS_ORG_ID, name: { equals: body.customerName.trim(), mode: 'insensitive' } },
    });
    if (!customer) {
      customer = await this.prisma.customer.create({
        data: { organizationId: OSIRIS_ORG_ID, name: body.customerName.trim(), gstRegNo: body.customerUen || null },
      });
    }
    const tpl = await this.templates.getDocumentTemplateByType(type, OSIRIS_ORG_ID);
    if (!tpl?.id) throw new HttpException(`No ${type} template configured for the Osiris org`, HttpStatus.BAD_REQUEST);

    const parseFee = (f: string) => Number(String(f).replace(/[^0-9.]/g, '')) || 0;
    const items = (body.fees || [])
      .filter((f) => f.item?.trim())
      .map((f, i) => ({
        id: Date.now() + i,
        itemCode: '',
        description: `${f.item}${f.description ? `\n${f.description}` : ''}`,
        quantity: 1,
        unitPrice: parseFee(f.fee),
        amount: parseFee(f.fee),
      }));
    const subTotal = items.reduce((s, it) => s + it.amount, 0);

    const config = {
      date: new Date().toISOString(),
      customerId: customer.id,
      customer: { id: customer.id, name: customer.name, address: customer.address || '' },
      customerName: customer.name,
      billTo: customer.address || '',
      referenceNo: `AIMS SOW — ${customer.name}`,
      paymentTerms: '30 days',
      items,
      subTotal,
      gstAmount: 0,
      nettTotal: subTotal,
      taxApplicable: 'N',
    };
    const doc = await this.documents.createBasicDocument(tpl.id, type, OSIRIS_ORG_ID, config, undefined, actor);
    const created: any = (doc as any)?.data ?? doc;
    return { id: created?.id, name: created?.name, type, templateId: tpl.id };
  }
}
