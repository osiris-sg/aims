import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { PrismaService } from '../common/prisma.service';
import { DocumentsService } from '../documents/documents.service';
import { ActionLogService } from '../action-log/action-log.service';

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
const ordinal = (n: number) => {
  const v = n % 100;
  const suffix = v >= 11 && v <= 13 ? 'th' : ['th', 'st', 'nd', 'rd'][n % 10] || 'th';
  return `${n}${suffix}`;
};

export function resolveText(str: string, date: Date, runNo?: number): string {
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
    // Rental-period ranges (guru 2026-08-07): first/last day of the month as
    // dd/mm/yyyy — "Rental period from {PREV MONTH START} to {PREV MONTH END}"
    // → "01/07/2026 to 31/07/2026" on an August run. Plus numeric months.
    'MONTH NO': pad2(m + 1),
    'PREV MONTH NO': pad2(prevM + 1),
    'MONTH START': `01/${pad2(m + 1)}/${y}`,
    'MONTH END': `${pad2(new Date(y, m + 1, 0).getDate())}/${pad2(m + 1)}/${y}`,
    'PREV MONTH START': `01/${pad2(prevM + 1)}/${prevY}`,
    'PREV MONTH END': `${pad2(new Date(prevY, prevM + 1, 0).getDate())}/${pad2(prevM + 1)}/${prevY}`,
    // Rental month counter (guru 2026-08-07): {NTH} → "17th", {RUN NO} → "17".
    ...(runNo != null ? { NTH: ordinal(runNo), 'RUN NO': String(runNo) } : {}),
  };
  return str.replace(/\{([A-Z ]+)\}/g, (whole, tok: string) => (tok in map ? map[tok] : whole));
}

// Walk the config, replacing tokens in every string value.
function resolveConfig(config: any, date: Date, runNo?: number): any {
  if (config == null) return config;
  if (typeof config === 'string') return resolveText(config, date, runNo);
  if (Array.isArray(config)) return config.map((v) => resolveConfig(v, date, runNo));
  if (typeof config === 'object') {
    const out: any = {};
    for (const [k, v] of Object.entries(config)) out[k] = resolveConfig(v, date, runNo);
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
    private readonly actionLog: ActionLogService,
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

  // Reserved-slot assignment (guru 2026-08-27): slots are customer-alphabetical.
  // A new template SLOTS INTO its customer's position — shifting later chains'
  // slots +1 — ONLY while every invoice of the current month generated from
  // these slots is still an unsent draft. Once any is sent/authorised the
  // series is frozen: the new template appends at the end instead.
  private slotOf(cfg: any): number | null {
    const m = /\{MONTH NO\}(\d{3})$/.exec(String(cfg?.documentNumber || ''));
    return m ? parseInt(m[1], 10) : null;
  }

  private async assignReservedSlot(organizationId: string, customerId: string, newId: string) {
    const tpls = await this.prisma.recurringInvoiceTemplate.findMany({ where: { organizationId }, orderBy: { code: 'asc' } });
    const slotted = tpls.filter((t) => t.id !== newId && this.slotOf(t.config));
    if (!slotted.length) return; // no slot scheme in this org
    const custIds = [...new Set(tpls.map((t) => t.customerId))];
    const customers = await this.prisma.customer.findMany({ where: { id: { in: custIds } }, select: { id: true, name: true } });
    const cname = new Map(customers.map((c) => [c.id, c.name || '']));
    // Is the current month frozen? Any doc on a reserved number this month
    // that is no longer an unsent draft locks the series.
    const now = new Date();
    const prefix = `BI${now.getFullYear()}${String(now.getMonth() + 1).padStart(2, '0')}`;
    const maxSlot = Math.max(...slotted.map((t) => this.slotOf(t.config)!));
    const monthDocs = await this.prisma.document.findMany({
      where: { organizationId, type: 'INVOICE', name: { startsWith: prefix } },
      select: { name: true, status: true, config: true },
    });
    // POSITIONAL freeze (guru 2026-08-27): a sent invoice freezes only slots
    // up to ITS number. Highest sent slot S → slots 1..S are immutable; the
    // region after S can still re-deal. A new chain whose alphabetical
    // position falls after S splices in; one that belongs inside 1..S can't —
    // it appends at the end instead.
    const nameRe = new RegExp('^' + prefix + '(\\d{3})$');
    let highestSent = 0;
    for (const d of monthDocs) {
      const m = nameRe.exec(d.name || '');
      if (!m) continue;
      const slot = parseInt(m[1], 10);
      if (slot > maxSlot) continue;
      const xs = String((d.config as any)?.xeroStatus || '').toUpperCase();
      const sent = !['draft', 'unconfirmed'].includes(String(d.status)) || ['AUTHORISED', 'PAID'].includes(xs) || Boolean((d.config as any)?.sentAt);
      if (sent && slot > highestSent) highestSent = slot;
    }
    // alphabetical target order over all slotted templates + the new one
    const all = tpls.filter((t) => t.id === newId || this.slotOf(t.config));
    all.sort((a, b) => {
      const ca = (cname.get(a.customerId) || '').toLowerCase();
      const cb = (cname.get(b.customerId) || '').toLowerCase();
      if (ca !== cb) return ca.localeCompare(cb);
      const sa = this.slotOf(a.config) ?? 999;
      const sb = this.slotOf(b.config) ?? 999;
      return sa - sb;
    });
    const newPos = all.findIndex((t) => t.id === newId) + 1; // 1-based would-be slot
    if (highestSent > 0 && newPos <= highestSent) {
      await this.updateSlot(newId, maxSlot + 1);
      this.logger.log(`[slots] insertion point ${newPos} inside frozen zone (sent up to ${highestSent}) — appended at ${maxSlot + 1}`);
      return;
    }
    // splice: slots 1..highestSent untouched; re-deal highestSent+1..N over the
    // unfrozen templates (alphabetical order), new one landing in its place.
    const frozenIds = new Set(all.filter((t) => t.id !== newId && (this.slotOf(t.config) ?? 999) <= highestSent).map((t) => t.id));
    let next = highestSent;
    for (const t of all) {
      if (frozenIds.has(t.id)) continue;
      next++;
      await this.updateSlot(t.id, next);
    }
    this.logger.log(`[slots] spliced at position ${newPos}; re-dealt slots ${highestSent + 1}..${next} (frozen: 1..${highestSent})`);
  }

  private async updateSlot(id: string, slot: number) {
    const t = await this.prisma.recurringInvoiceTemplate.findUnique({ where: { id } });
    if (!t) return;
    const c: any = t.config || {};
    const num = `BI{YEAR}{MONTH NO}${String(slot).padStart(3, '0')}`;
    if (c.documentNumber === num) return;
    await this.prisma.recurringInvoiceTemplate.update({ where: { id }, data: { config: { ...c, documentNumber: num } } });
  }

  async create(organizationId: string, dto: any, userId?: string) {
    const row = await this.prisma.recurringInvoiceTemplate.create({
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
        nextRunNo: Number(dto.nextRunNo) || 1,
        createdBy: userId ?? null,
      },
    });
    // Auto-assign the next REC code + reserved number slot.
    try {
      if (!row.code) {
        const count = await this.prisma.recurringInvoiceTemplate.count({ where: { organizationId } });
        await this.prisma.recurringInvoiceTemplate.update({ where: { id: row.id }, data: { code: `REC-${String(count).padStart(3, '0')}` } });
      }
      await this.assignReservedSlot(organizationId, row.customerId, row.id);
    } catch (e: any) {
      this.logger.warn(`[slots] assignment failed (non-fatal): ${e?.message || e}`);
    }
    return this.prisma.recurringInvoiceTemplate.findUnique({ where: { id: row.id } });
  }

  async update(organizationId: string, id: string, dto: any) {
    const existing = await this.findOne(organizationId, id);
    // The edit dialog sends a REBUILT config (items/reference/notes only) — a
    // wholesale replace would wipe server-managed fields: the reserved number
    // slot, billTo/address, tax coding, terms. Merge those back (guru 2026-08-27).
    if (dto.config && existing.config) {
      const prev: any = existing.config;
      const KEEP = ['documentNumber', 'billTo', 'customerAddress', 'paymentTerms', 'taxApplicable', 'gstPercent', 'currency', 'subTotal', 'gstAmount', 'nettTotal', 'note'];
      for (const k of KEEP) if (dto.config[k] === undefined && prev[k] !== undefined) dto.config[k] = prev[k];
      dto.config.documentInfo = { ...(prev.documentInfo || {}), ...(dto.config.documentInfo || {}) };
    }
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
        nextRunNo: dto.nextRunNo !== undefined ? Number(dto.nextRunNo) || 1 : undefined,
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
  // Manual "Generate now" = a REAL run: same generation + full bookkeeping
  // (lastRun fields, schedule advance, {NTH} counter increment) so it can't
  // double up with the scheduled sweep (guru 2026-08-07).
  async runOnce(organizationId: string, id: string, userId?: string) {
    const t = await this.findOne(organizationId, id);
    const now = new Date();
    const doc = await this.generateOne(organizationId, t, now, userId);
    await this.prisma.recurringInvoiceTemplate.update({
      where: { id: t.id },
      data: {
        lastRunAt: now,
        lastRunDocumentId: doc.id,
        nextRunDate: advanceDate(t.nextRunDate, t.frequency as Frequency),
        nextRunNo: { increment: 1 },
      },
    });
    return doc;
  }

  async generateOne(organizationId: string, template: any, runDate: Date, userId?: string) {
    const config = resolveConfig(template.config || {}, runDate, template.nextRunNo ?? 1);
    // Email overrides (guru 2026-08-06) live on the schedule, not the invoice —
    // pull them out (token-resolved) before the document config is stored.
    const emailPrefs: any = config.email || null;
    delete config.email;
    config.customerId = template.customerId;
    // Invoice date = the run date (page/email showed "—" without it).
    if (!config.date) config.date = runDate.toISOString().slice(0, 10);
    if (template.numberFormatId) config.numberFormatId = template.numberFormatId;
    // The schedule's Reference lands in config.reference (list column), but
    // the editor + printed doc read documentInfo.referenceNo — mirror it so
    // the field shows everywhere (guru 2026-08-11).
    if (config.reference && !config.documentInfo?.referenceNo) {
      config.documentInfo = { ...(config.documentInfo || {}), referenceNo: config.reference };
    }

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

    // Reserved running number (guru 2026-08-27): templates carry
    // config.documentNumber like "BI{YEAR}{MONTH NO}001" — resolveConfig has
    // already turned it into e.g. "BI202609001", so each schedule owns the
    // same slot in every month's series and the number is known BEFORE the
    // run. Passed as nameOverride so createBasicDocument skips the sequence.
    const reservedNumber = typeof config.documentNumber === 'string' && config.documentNumber.trim() ? config.documentNumber.trim() : undefined;
    // The printed invoice header (TI2 variant) reads documentInfo.documentNumber
    // + documentInfo.date — mirror them so the generated draft prints complete.
    config.documentInfo = { ...(config.documentInfo || {}), ...(reservedNumber ? { documentNumber: reservedNumber } : {}), date: config.documentInfo?.date || runDate.toISOString().slice(0, 10) };
    const doc = await this.documents.createBasicDocument(
      template.documentTemplateId,
      'INVOICE',
      organizationId,
      config,
      undefined,
      // Attribution for the document-history "Created" entry.
      { id: userId, name: 'Recurring invoices' },
      reservedNumber,
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
        const customer = await this.prisma.customer.findFirst({ where: { id: template.customerId, organizationId }, select: { name: true, email: true } });
        // Recipients: schedule overrides win; else the customer's saved email.
        const to: string[] = emailPrefs?.to?.length ? emailPrefs.to : customer?.email ? [customer.email] : [];
        if (to.length) {
          // Subject/body: overrides (tokens already resolved) or a composed
          // default — previously these were sent UNDEFINED.
          const org = await this.prisma.organization.findUnique({ where: { id: organizationId }, select: { name: true } });
          const total = Number(config.nettTotal) || 0;
          const curr = (config.currency || 'SGD').toUpperCase();
          const subject = emailPrefs?.subject || `Invoice ${doc.name} from ${org?.name || ''}`.trim();
          const message =
            emailPrefs?.message ||
            `Hi ${customer?.name || 'there'},

Please find attached the invoice ${doc.name} amounting to ${curr} ${total.toFixed(2)}.

If you have any questions, please don't hesitate to contact us.

Best regards,
${org?.name || ''}`;
          await this.documents.sendInvoiceEmail(
            doc.id,
            { to, cc: emailPrefs?.cc?.length ? emailPrefs.cc : undefined, bcc: emailPrefs?.bcc?.length ? emailPrefs.bcc : undefined, subject, message } as any,
            organizationId,
          );
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
  // Background scheduler (guru 2026-08-06: runs must fire AT their set time,
  // not on next page load). Sweeps every 2 minutes for orgs with due active
  // schedules and runs them. Single-instance deploys only — if the API ever
  // scales out, this needs a lock.
  @Cron('*/2 * * * *')
  async runDueAllOrgs() {
    try {
      const due = await this.prisma.recurringInvoiceTemplate.findMany({
        where: { isActive: true, nextRunDate: { lte: new Date() } },
        select: { organizationId: true },
        distinct: ['organizationId'],
      });
      for (const d of due) {
        try {
          const r: any = await this.runDue(d.organizationId);
          const n = Array.isArray(r?.generated) ? r.generated.length : r?.generatedCount ?? '?';
          this.logger.log(`[cron] runDue org=${d.organizationId} generated=${n}`);
          if (typeof n === 'number' ? n > 0 : true) {
            this.actionLog.system('recurring-invoices', 'CREATE', 'documents', {
              organizationId: d.organizationId,
              details: { note: `Recurring invoice run generated ${n} invoice(s)`, generated: Array.isArray(r?.generated) ? r.generated : undefined },
            });
          }
        } catch (e: any) {
          this.logger.error(`[cron] runDue failed org=${d.organizationId}: ${e?.message || e}`);
        }
      }
    } catch (e: any) {
      this.logger.error(`[cron] sweep failed: ${e?.message || e}`);
    }
  }

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
          data: { lastRunAt: now, lastRunDocumentId: doc.id, nextRunDate: advanceDate(t.nextRunDate, t.frequency as Frequency), nextRunNo: { increment: 1 } },
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
