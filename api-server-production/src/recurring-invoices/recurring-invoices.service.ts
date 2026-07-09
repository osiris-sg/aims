import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../common/prisma.service';
import { DocumentsService } from '../documents/documents.service';

export type Frequency = 'DAILY' | 'WEEKLY' | 'MONTHLY' | 'QUARTERLY' | 'YEARLY';

const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
const pad2 = (n: number) => String(n).padStart(2, '0');

function advanceDate(d: Date, freq: Frequency): Date {
  const next = new Date(d);
  switch (freq) {
    case 'DAILY': next.setDate(next.getDate() + 1); break;
    case 'WEEKLY': next.setDate(next.getDate() + 7); break;
    case 'MONTHLY': next.setMonth(next.getMonth() + 1); break;
    case 'QUARTERLY': next.setMonth(next.getMonth() + 3); break;
    case 'YEARLY': next.setFullYear(next.getFullYear() + 1); break;
  }
  return next;
}

// Resolve {TOKEN}s in the invoice text against the run date, so the wording
// changes each period ("Services for {MONTH YEAR}" → "Services for July 2026").
export function resolveText(str: string, date: Date): string {
  const y = date.getFullYear();
  const m = date.getMonth(); // 0-based
  const nextM = (m + 1) % 12, nextY = m === 11 ? y + 1 : y;
  const prevM = (m + 11) % 12, prevY = m === 0 ? y - 1 : y;
  const map: Record<string, string> = {
    MONTH: MONTHS[m],
    'MONTH SHORT': MONTHS[m].slice(0, 3),
    'MONTH YEAR': `${MONTHS[m]} ${y}`,
    PERIOD: `${MONTHS[m].slice(0, 3)} ${y}`,
    YEAR: String(y),
    DAY: pad2(date.getDate()),
    DATE: `${pad2(date.getDate())}/${pad2(m + 1)}/${y}`,
    'NEXT MONTH': MONTHS[nextM],
    'NEXT MONTH YEAR': `${MONTHS[nextM]} ${nextY}`,
    'PREV MONTH': MONTHS[prevM],
    'PREV MONTH YEAR': `${MONTHS[prevM]} ${prevY}`,
  };
  return str.replace(/\{([A-Z ]+)\}/g, (whole, tok: string) => (tok in map ? map[tok] : whole));
}

// Walk the config, replacing tokens in every string value.
function resolveConfig(config: any, date: Date): any {
  if (config == null) return config;
  if (typeof config === 'string') return resolveText(config, date);
  if (Array.isArray(config)) return config.map((v) => resolveConfig(v, date));
  if (typeof config === 'object') {
    const out: any = {};
    for (const [k, v] of Object.entries(config)) out[k] = resolveConfig(v, date);
    return out;
  }
  return config;
}

@Injectable()
export class RecurringInvoicesService {
  private readonly logger = new Logger(RecurringInvoicesService.name);
  constructor(
    private readonly prisma: PrismaService,
    private readonly documents: DocumentsService,
  ) {}

  // ---------- CRUD ----------
  list(organizationId: string) {
    return this.prisma.recurringInvoiceTemplate.findMany({
      where: { organizationId },
      orderBy: [{ isActive: 'desc' }, { nextRunDate: 'asc' }],
    });
  }

  async findOne(organizationId: string, id: string) {
    const row = await this.prisma.recurringInvoiceTemplate.findFirst({ where: { id, organizationId } });
    if (!row) throw new NotFoundException('Recurring invoice not found');
    return row;
  }

  create(organizationId: string, dto: any, userId?: string) {
    return this.prisma.recurringInvoiceTemplate.create({
      data: {
        organizationId,
        name: dto.name,
        customerId: dto.customerId,
        documentTemplateId: dto.documentTemplateId,
        numberFormatId: dto.numberFormatId ?? null,
        config: dto.config ?? {},
        frequency: dto.frequency || 'MONTHLY',
        nextRunDate: new Date(dto.nextRunDate),
        endDate: dto.endDate ? new Date(dto.endDate) : null,
        // Draft-first by default — metered rentals must never auto-fire a wrong invoice.
        autoSend: dto.autoSend ?? false,
        isActive: dto.isActive ?? true,
        projectId: dto.projectId ?? null,
        projectDeploymentId: dto.projectDeploymentId ?? null,
        sourceDocumentId: dto.sourceDocumentId ?? null,
        createdBy: userId ?? null,
      },
    });
  }

  async update(organizationId: string, id: string, dto: any) {
    await this.findOne(organizationId, id);
    return this.prisma.recurringInvoiceTemplate.update({
      where: { id },
      data: {
        name: dto.name ?? undefined,
        customerId: dto.customerId ?? undefined,
        documentTemplateId: dto.documentTemplateId ?? undefined,
        numberFormatId: dto.numberFormatId !== undefined ? dto.numberFormatId : undefined,
        config: dto.config ?? undefined,
        frequency: dto.frequency ?? undefined,
        nextRunDate: dto.nextRunDate ? new Date(dto.nextRunDate) : undefined,
        endDate: dto.endDate !== undefined ? (dto.endDate ? new Date(dto.endDate) : null) : undefined,
        autoSend: dto.autoSend ?? undefined,
        isActive: dto.isActive ?? undefined,
        projectId: dto.projectId !== undefined ? dto.projectId : undefined,
        projectDeploymentId: dto.projectDeploymentId !== undefined ? dto.projectDeploymentId : undefined,
        sourceDocumentId: dto.sourceDocumentId !== undefined ? dto.sourceDocumentId : undefined,
      },
    });
  }

  async remove(organizationId: string, id: string) {
    await this.prisma.recurringInvoiceTemplate.deleteMany({ where: { id, organizationId } });
    return { ok: true };
  }

  // ---------- generation ----------
  // Generate ONE invoice from a template for the given run date.
  // Draft-first (autoSend=false, the default): create a DRAFT for review — the
  // user fills period-specific details (e.g. meter readings), then confirms
  // manually (which posts the GL). Fully automatic (autoSend=true): confirm
  // (posts to GL) → email (best-effort). Returns the created document.
  async generateOne(organizationId: string, template: any, runDate: Date, userId?: string) {
    const config = resolveConfig(template.config || {}, runDate);
    config.customerId = template.customerId;
    if (template.numberFormatId) config.numberFormatId = template.numberFormatId;

    // Trade in the customer's master-file currency (GL converts on posting).
    const customerMaster = await this.prisma.customer.findUnique({
      where: { id: template.customerId },
      select: { currency: true },
    });
    if (customerMaster?.currency) config.currency = customerMaster.currency;

    // GST + totals: the document preview shows tax from each line's `tax` %
    // while the GL fallback posts at the org rate — set both explicitly so the
    // printed invoice and the journal entry always carry the same amounts.
    const org = await this.prisma.organization.findUnique({ where: { id: organizationId }, select: { taxRate: true } });
    const orgRate = org?.taxRate ?? 0;
    const items: any[] = Array.isArray(config.items) ? config.items : [];
    for (const it of items) if (it && it.tax == null) it.tax = orgRate;
    const lineAmount = (it: any) => parseFloat(it.amount) || (parseFloat(it.quantity) * parseFloat(it.unitPrice)) || 0;
    const net = items.reduce((s, it) => s + lineAmount(it), 0);
    const gst = +items.reduce((s, it) => s + lineAmount(it) * ((it.tax || 0) / 100), 0).toFixed(2);
    config.subTotal = net;
    config.gstAmount = gst;
    config.nettTotal = +(net + gst).toFixed(2);

    const doc = await this.documents.createBasicDocument(
      template.documentTemplateId,
      'INVOICE',
      organizationId,
      config,
      undefined,
      // Attribution for the document-history "Created" entry.
      { id: userId, name: 'Recurring invoices' },
    );
    // Chain the generated invoice onto the template's project/deployment so it
    // shows on the DeploymentCard and rolls into the project's billed totals.
    if (template.projectId || template.projectDeploymentId) {
      await this.prisma.document.update({
        where: { id: doc.id },
        data: {
          ...(template.projectId ? { projectId: template.projectId } : {}),
          ...(template.projectDeploymentId ? { projectDeploymentId: template.projectDeploymentId } : {}),
        },
      });
    }
    if (template.autoSend) {
      // Fully automatic: confirm via confirmInvoice — the generic updateDocument
      // confirm gate deliberately excludes invoices, so it never posts them to
      // the GL — then email (best-effort, never blocks generation/posting).
      await this.documents.confirmInvoice(doc.id, { fromInvoiceNo: '', toInvoiceNo: '' }, organizationId);
      try {
        const customer = await this.prisma.customer.findFirst({ where: { id: template.customerId, organizationId }, select: { email: true } });
        if (customer?.email) {
          await this.documents.sendInvoiceEmail(doc.id, { to: [customer.email] } as any, organizationId);
        } else {
          this.logger.warn(`[recurring] no email for customer ${template.customerId}; generated ${doc.id} but did not send`);
        }
      } catch (e: any) {
        this.logger.error(`[recurring] email failed for doc ${doc.id}: ${e?.message || e}`);
      }
    }
    // Draft-first: leave the invoice as a draft — no confirm, no GL post, no
    // email. It appears in the invoice list for review; confirming it there
    // posts the GL exactly like any hand-made invoice.
    return doc;
  }

  // Lazy scheduler — called on Finance Hub load (like recurring journals). For
  // every active template whose nextRunDate has passed, generate + advance.
  async runDue(organizationId: string) {
    const now = new Date();
    const due = await this.prisma.recurringInvoiceTemplate.findMany({
      where: { organizationId, isActive: true, nextRunDate: { lte: now } },
    });
    const results: Array<{ id: string; ok: boolean; documentId?: string; error?: string }> = [];
    for (const t of due) {
      // Respect end date — deactivate instead of running.
      if (t.endDate && new Date(t.endDate) < t.nextRunDate) {
        await this.prisma.recurringInvoiceTemplate.update({ where: { id: t.id }, data: { isActive: false } });
        continue;
      }
      try {
        const doc = await this.generateOne(organizationId, t, t.nextRunDate);
        // Advance ONLY after a successful generation (draft or confirmed —
        // one document per period; email is best-effort either way).
        await this.prisma.recurringInvoiceTemplate.update({
          where: { id: t.id },
          data: { lastRunAt: now, lastRunDocumentId: doc.id, nextRunDate: advanceDate(t.nextRunDate, t.frequency as Frequency) },
        });
        results.push({ id: t.id, ok: true, documentId: doc.id });
      } catch (e: any) {
        // Leave nextRunDate so it retries next load (no document was posted).
        this.logger.error(`[recurring] generate failed for template ${t.id}: ${e?.message || e}`);
        results.push({ id: t.id, ok: false, error: e?.message || String(e) });
      }
    }
    return results;
  }
}
