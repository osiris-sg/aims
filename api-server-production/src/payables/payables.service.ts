import { BadRequestException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../common/prisma.service';
import { S3Service } from '../common/services/s3.service';
import { BillsService } from '../bills/bills.service';
import { OrgRulesService } from '../org-rules/org-rules.service';
import { ActionLogService } from '../action-log/action-log.service';

/**
 * Monthly supplier payables (Summer 2026-11-02): the AIMS version of CIEL's
 * "Bi Weekly Outgoing Payments" Google sheet. Invoices posted in the bills
 * WhatsApp group arrive via the group bridge (ingestGroupMessage), are
 * AI-read, and land on the month's tally as TO PAY; setting a payment date
 * marks them PAID. Columns mirror the sheet: invoice no · contractor · site
 * address · invoice amount · retention % · payment amount · payment date ·
 * remarks · submitted by.
 */
@Injectable()
export class PayablesService {
  private readonly logger = new Logger(PayablesService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly s3: S3Service,
    private readonly bills: BillsService,
    private readonly orgRules: OrgRulesService,
    private readonly actionLog: ActionLogService,
  ) {}

  private monthOf(d: Date): string {
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
  }

  private round2(n: number): number {
    return Math.round((Number(n) || 0) * 100) / 100;
  }

  /** payment amount = invoice × (1 − retention%) — the sheet's F column. */
  private payAmount(invoiceAmount: number, percentage: number | null | undefined): number {
    const pct = percentage == null ? 0 : Number(percentage) || 0;
    return this.round2((Number(invoiceAmount) || 0) * (1 - pct / 100));
  }

  /**
   * Materialise standing lines onto the CURRENT month the first time it is
   * opened (guru 2026-11-08): active RecurringPayable templates (rent etc. —
   * once per month each, a deleted month-row is NOT recreated) and APPROVED
   * designer advances that aren't on the tally yet.
   */
  private async materialize(organizationId: string, month: string) {
    if (month !== this.monthOf(new Date())) return;
    const templates = await this.prisma.recurringPayable.findMany({ where: { organizationId, active: true } });
    for (const t of templates) {
      if (t.lastMonth && t.lastMonth >= month) continue;
      const day = Math.min(Math.max(Number(t.dayOfMonth) || 1, 1), 28);
      await this.prisma.payableInvoice.create({
        data: {
          organizationId,
          month,
          supplierName: t.supplierName,
          siteAddress: t.description || null,
          invoiceDate: new Date(`${month}-${String(day).padStart(2, '0')}T00:00:00.000Z`),
          invoiceAmount: this.round2(t.amount),
          percentage: t.percentage,
          paymentAmount: this.payAmount(t.amount, t.percentage),
          source: 'recurring',
          recurringId: t.id,
        },
      });
      await this.prisma.recurringPayable.update({ where: { id: t.id }, data: { lastMonth: month } });
    }
    // Approved advances (the sheet's "Advance (Recorded and approved in AIMS)"
    // lines): one payable row per advance, payee = the designer.
    const advances = await this.prisma.designerAdvance.findMany({ where: { organizationId, status: 'approved' } });
    for (const a of advances) {
      const exists = await this.prisma.payableInvoice.findFirst({ where: { organizationId, advanceId: a.id }, select: { id: true } });
      if (exists) continue;
      await this.prisma.payableInvoice.create({
        data: {
          organizationId,
          month,
          invoiceNo: 'ADV',
          supplierName: a.requestedByName || 'Designer',
          siteAddress: `Advance${a.projectName ? ` — ${a.projectName}` : a.reason ? ` — ${a.reason}` : ''} (approved in AIMS)`,
          invoiceDate: (a as any).decidedAt || a.createdAt,
          invoiceAmount: this.round2(a.amount),
          percentage: null,
          paymentAmount: this.round2(a.amount),
          source: 'advance',
          advanceId: a.id,
          projectId: a.projectId || null,
          projectName: a.projectName || null,
        },
      });
    }
  }

  /** The month's tally + totals (the sheet's tab). No month → current month. */
  async list(organizationId: string, q: { month?: string; status?: string }) {
    const month = /^\d{4}-\d{2}$/.test(q.month || '') ? (q.month as string) : this.monthOf(new Date());
    await this.materialize(organizationId, month).catch((e) => this.logger.warn(`materialize failed: ${(e as Error).message}`));
    const where: any = { organizationId, month };
    if (q.status === 'to_pay' || q.status === 'paid' || q.status === 'withholding') where.status = q.status;
    const rows = await this.prisma.payableInvoice.findMany({
      where,
      orderBy: [{ supplierName: 'asc' }, { createdAt: 'asc' }],
    });
    const sum = (list: any[]) => this.round2(list.reduce((s, r) => s + (Number(r.paymentAmount) || 0), 0));
    // Rebate total (guru 2026-11-08): the retention the firm keeps — invoice × %.
    const rebate = this.round2(rows.reduce((s, r) => s + (Number(r.invoiceAmount) || 0) * ((Number(r.percentage) || 0) / 100), 0));
    const toPay = rows.filter((r) => r.status !== 'paid' && r.status !== 'withholding');
    const withheld = rows.filter((r) => r.status === 'withholding');
    const paid = rows.filter((r) => r.status === 'paid');
    // Months that have rows, for the tab strip (newest first).
    const monthsRaw = await this.prisma.payableInvoice.findMany({
      where: { organizationId },
      select: { month: true },
      distinct: ['month'],
      orderBy: { month: 'desc' },
      take: 24,
    });
    return {
      month,
      months: monthsRaw.map((m) => m.month),
      rows,
      totals: { toPay: sum(toPay), withheld: sum(withheld), paid: sum(paid), all: sum(rows), rebate, toPayCount: toPay.length, withheldCount: withheld.length, paidCount: paid.length },
    };
  }

  /** Manual row (the sheet also carries hand-typed lines like "ADV loan"). */
  async create(organizationId: string, dto: any, actorName?: string | null) {
    const invoiceAmount = this.round2(Number(dto.invoiceAmount) || 0);
    const percentage = dto.percentage == null || dto.percentage === '' ? null : Number(dto.percentage);
    let projectName = dto.projectName || null;
    if (dto.projectId && !projectName) {
      const p = await this.prisma.project.findFirst({ where: { id: dto.projectId, organizationId }, select: { name: true } });
      if (!p) throw new BadRequestException('Unknown project');
      projectName = p.name;
    }
    const row = await this.prisma.payableInvoice.create({
      data: {
        organizationId,
        month: /^\d{4}-\d{2}$/.test(dto.month || '') ? dto.month : this.monthOf(new Date()),
        invoiceNo: dto.invoiceNo?.trim() || null,
        supplierName: dto.supplierName?.trim() || null,
        siteAddress: dto.siteAddress?.trim() || null,
        invoiceDate: dto.invoiceDate ? new Date(dto.invoiceDate) : null,
        invoiceAmount,
        percentage,
        paymentAmount: dto.paymentAmount != null && dto.paymentAmount !== '' ? this.round2(Number(dto.paymentAmount)) : this.payAmount(invoiceAmount, percentage),
        remarks: dto.remarks?.trim() || null,
        submittedBy: dto.submittedBy?.trim() || actorName || null,
        source: 'manual',
        projectId: dto.projectId || null,
        projectName,
      },
    });
    return row;
  }

  /** Light project list for the "link to project" picker — Summer's check
   *  that each invoice's site address is really one of the designers' jobs. */
  async projectOptions(organizationId: string) {
    const rows = await this.prisma.project.findMany({
      where: { organizationId },
      select: { id: true, name: true, address: true, status: true, customer: { select: { name: true } } },
      orderBy: { name: 'asc' },
      take: 500,
    });
    return rows.map((p) => ({ id: p.id, name: p.name, address: p.address, status: p.status, clientName: p.customer?.name || null }));
  }

  /** Edit the sheet's cells. Amount/percentage changes re-derive the payment
   *  amount unless the caller sets paymentAmount explicitly. */
  async update(organizationId: string, id: string, dto: any) {
    const row = await this.prisma.payableInvoice.findFirst({ where: { id, organizationId } });
    if (!row) throw new NotFoundException('Payable not found');
    const data: any = {};
    for (const k of ['invoiceNo', 'supplierName', 'siteAddress', 'remarks', 'submittedBy', 'approvedBy', 'projectId', 'projectName'] as const) {
      if (dto[k] !== undefined) data[k] = dto[k] === '' ? null : dto[k];
    }
    // projectId set without a name → fill the name from the project itself
    // (and a cleared projectId always clears the stale name).
    if (data.projectId === null) data.projectName = null;
    else if (data.projectId && dto.projectName === undefined) {
      const p = await this.prisma.project.findFirst({ where: { id: data.projectId, organizationId }, select: { name: true } });
      if (!p) throw new BadRequestException('Unknown project');
      data.projectName = p.name;
    }
    if (dto.month !== undefined && /^\d{4}-\d{2}$/.test(dto.month)) data.month = dto.month;
    if (dto.invoiceDate !== undefined) data.invoiceDate = dto.invoiceDate ? new Date(dto.invoiceDate) : null;
    if (dto.invoiceAmount !== undefined) data.invoiceAmount = this.round2(Number(dto.invoiceAmount) || 0);
    if (dto.percentage !== undefined) data.percentage = dto.percentage === '' || dto.percentage == null ? null : Number(dto.percentage);
    if (dto.paymentAmount !== undefined && dto.paymentAmount !== '') {
      data.paymentAmount = this.round2(Number(dto.paymentAmount) || 0);
    } else if (data.invoiceAmount !== undefined || data.percentage !== undefined) {
      data.paymentAmount = this.payAmount(
        data.invoiceAmount !== undefined ? data.invoiceAmount : row.invoiceAmount,
        data.percentage !== undefined ? data.percentage : row.percentage,
      );
    }
    return this.prisma.payableInvoice.update({ where: { id: row.id }, data });
  }

  /** Payment date set = PAID (the sheet's convention). An advance row keeps
   *  the DesignerAdvance in sync (approved → paid). */
  async markPaid(organizationId: string, id: string, dto: { paymentDate?: string; approvedBy?: string } = {}, actorName?: string | null) {
    const row = await this.prisma.payableInvoice.findFirst({ where: { id, organizationId } });
    if (!row) throw new NotFoundException('Payable not found');
    const updated = await this.prisma.payableInvoice.update({
      where: { id: row.id },
      data: {
        status: 'paid',
        paymentDate: dto.paymentDate ? new Date(dto.paymentDate) : new Date(),
        approvedBy: dto.approvedBy?.trim() || row.approvedBy || actorName || null,
      },
    });
    if (row.advanceId) {
      await this.prisma.designerAdvance
        .updateMany({ where: { id: row.advanceId, organizationId, status: 'approved' }, data: { status: 'paid' } })
        .catch(() => null);
    }
    return updated;
  }

  async markUnpaid(organizationId: string, id: string) {
    const row = await this.prisma.payableInvoice.findFirst({ where: { id, organizationId } });
    if (!row) throw new NotFoundException('Payable not found');
    if (row.advanceId) {
      await this.prisma.designerAdvance
        .updateMany({ where: { id: row.advanceId, organizationId, status: 'paid' }, data: { status: 'approved' } })
        .catch(() => null);
    }
    return this.prisma.payableInvoice.update({ where: { id: row.id }, data: { status: 'to_pay', paymentDate: null } });
  }

  // ── Recurring payables (guru 2026-11-08: rent etc.) ───────────────────
  async listRecurring(organizationId: string) {
    return this.prisma.recurringPayable.findMany({ where: { organizationId }, orderBy: [{ active: 'desc' }, { supplierName: 'asc' }] });
  }

  async createRecurring(organizationId: string, dto: any) {
    const amount = this.round2(Number(dto.amount) || 0);
    if (!(amount > 0)) throw new BadRequestException('Amount must be greater than zero');
    if (!dto.supplierName?.trim()) throw new BadRequestException('Who is this paid to?');
    return this.prisma.recurringPayable.create({
      data: {
        organizationId,
        supplierName: dto.supplierName.trim(),
        description: dto.description?.trim() || null,
        amount,
        percentage: dto.percentage === '' || dto.percentage == null ? null : Number(dto.percentage),
        dayOfMonth: dto.dayOfMonth ? Math.min(Math.max(Number(dto.dayOfMonth) || 1, 1), 28) : null,
      },
    });
  }

  async updateRecurring(organizationId: string, id: string, dto: any) {
    const t = await this.prisma.recurringPayable.findFirst({ where: { id, organizationId } });
    if (!t) throw new NotFoundException('Recurring payable not found');
    const data: any = {};
    if (dto.supplierName !== undefined) data.supplierName = String(dto.supplierName).trim();
    if (dto.description !== undefined) data.description = dto.description?.trim() || null;
    if (dto.amount !== undefined) data.amount = this.round2(Number(dto.amount) || 0);
    if (dto.percentage !== undefined) data.percentage = dto.percentage === '' || dto.percentage == null ? null : Number(dto.percentage);
    if (dto.dayOfMonth !== undefined) data.dayOfMonth = dto.dayOfMonth ? Math.min(Math.max(Number(dto.dayOfMonth) || 1, 1), 28) : null;
    if (dto.active !== undefined) data.active = !!dto.active;
    return this.prisma.recurringPayable.update({ where: { id: t.id }, data });
  }

  async removeRecurring(organizationId: string, id: string) {
    const t = await this.prisma.recurringPayable.findFirst({ where: { id, organizationId } });
    if (!t) throw new NotFoundException('Recurring payable not found');
    await this.prisma.recurringPayable.delete({ where: { id: t.id } });
    return { deleted: true };
  }

  /** WITHHOLDING — the sheet's ORANGE rows (guru 2026-11-08): payment is
   *  deliberately held back (dispute, rework, pending approval). Not paid and
   *  not counted in the To-pay total; release via unpay or pay. */
  async markWithheld(organizationId: string, id: string) {
    const row = await this.prisma.payableInvoice.findFirst({ where: { id, organizationId } });
    if (!row) throw new NotFoundException('Payable not found');
    return this.prisma.payableInvoice.update({ where: { id: row.id }, data: { status: 'withholding', paymentDate: null } });
  }

  async remove(organizationId: string, id: string) {
    const row = await this.prisma.payableInvoice.findFirst({ where: { id, organizationId } });
    if (!row) throw new NotFoundException('Payable not found');
    await this.prisma.payableInvoice.delete({ where: { id: row.id } });
    return { deleted: true };
  }

  // ── WhatsApp group intake (bridge → /whatsapp/group-ingest) ───────────
  /**
   * One group message from the bills group. Every attachment is stored and
   * AI-read into a TO PAY row on the current month's tally. A plain text
   * containing "paid" marks matching open invoice numbers as paid (the way
   * the office announces payments in the group).
   */
  async ingestGroupMessage(
    organizationId: string,
    msg: { groupId?: string; from?: string; body?: string; media?: Array<{ dataUri: string; mimetype?: string; filename?: string }> },
  ) {
    const media = Array.isArray(msg.media) ? msg.media.filter((m) => m?.dataUri) : [];
    const results: any[] = [];

    for (const m of media) {
      try {
        results.push(await this.ingestOne(organizationId, msg, m));
      } catch (e) {
        this.logger.warn(`group-ingest attachment failed: ${(e as Error).message}`);
        results.push({ ok: false, error: (e as Error).message });
      }
    }

    // "paid <invoice no>" in the group closes the loop without opening AIMS.
    let markedPaid: string[] = [];
    if (!media.length && /\bpaid\b/i.test(msg.body || '')) {
      markedPaid = await this.markPaidFromText(organizationId, msg.body || '');
    }

    if (results.length || markedPaid.length) {
      this.actionLog.system('whatsapp-group-ingest', markedPaid.length ? 'PAY' : 'CREATE', 'payable', {
        organizationId,
        details: {
          detail: results.length
            ? `${results.filter((r) => r.ok !== false).length} invoice(s) from the bills group queued on the payables tally`
            : `Marked paid from group text: ${markedPaid.join(', ')}`,
          groupId: msg.groupId || null,
          from: msg.from || null,
        },
      });
    }
    return { ok: true, created: results, markedPaid };
  }

  private async ingestOne(
    organizationId: string,
    msg: { groupId?: string; from?: string; body?: string },
    m: { dataUri: string; mimetype?: string; filename?: string },
  ) {
    const mimetype = m.mimetype || (m.dataUri.match(/^data:([a-zA-Z/+.-]+);base64,/)?.[1] ?? 'image/jpeg');
    if (!/pdf|png|jpe?g|webp/i.test(mimetype)) return { ok: false, skipped: `unsupported type ${mimetype}` };
    const media = (mimetype.includes('pdf')
      ? 'application/pdf'
      : mimetype.includes('png')
        ? 'image/png'
        : mimetype.includes('webp')
          ? 'image/webp'
          : 'image/jpeg') as 'application/pdf' | 'image/png' | 'image/webp' | 'image/jpeg';
    const commaIdx = m.dataUri.indexOf(',');
    const raw = commaIdx >= 0 ? m.dataUri.slice(commaIdx + 1) : m.dataUri;
    const ext = media === 'application/pdf' ? 'pdf' : media.split('/')[1];
    const safe = (m.filename || 'invoice').replace(/[^a-zA-Z0-9._-]/g, '_');
    const key = `payables/${organizationId}/${Date.now()}-${safe}.${ext}`;

    const [attachmentUrl, extracted] = await Promise.all([
      this.s3.uploadFile(key, Buffer.from(raw, 'base64'), media as any).catch(() => null),
      this.bills.extractFromFile(organizationId, m.dataUri, media).catch(() => null as any),
    ]);

    const invoiceAmount = this.round2(Number(extracted?.totalAmount) || 0);
    // Default retention = the org's standing supplier rebate % (CIEL: 10) —
    // editable per row on the sheet, and not applied when nothing was read.
    const rules = await this.orgRules.rulesOf(organizationId).catch(() => null);
    const percentage = invoiceAmount > 0 && rules?.rebatePct != null ? Number(rules.rebatePct) : null;

    // Same site-address → project matcher the cost intake uses.
    let projectId: string | null = null;
    let projectName: string | null = null;
    const siteAddress = extracted?.siteAddress || null;
    if (siteAddress) {
      try {
        const projects = await this.prisma.project.findMany({
          where: { organizationId, status: { not: 'completed' } },
          select: { id: true, name: true, address: true },
        });
        const { matchProjectByAddress } = await import('../common/address-match');
        const match = matchProjectByAddress(siteAddress, projects.map((p) => ({ ...p, customer: null })));
        if (match) {
          projectId = match.id;
          projectName = match.name;
        }
      } catch {
        /* match is best-effort */
      }
    }

    const row = await this.prisma.payableInvoice.create({
      data: {
        organizationId,
        month: this.monthOf(new Date()),
        invoiceNo: extracted?.billNumber || null,
        supplierName: extracted?.supplierName || null,
        siteAddress,
        invoiceDate: extracted?.billDate ? new Date(extracted.billDate) : null,
        invoiceAmount,
        percentage,
        paymentAmount: this.payAmount(invoiceAmount, percentage),
        remarks: (msg.body || '').trim().slice(0, 300) || null,
        attachmentUrl,
        attachmentKey: attachmentUrl ? key : null,
        filename: m.filename || null,
        source: 'whatsapp-group',
        groupId: msg.groupId || null,
        postedBy: msg.from || null,
        projectId,
        projectName,
      },
    });
    this.logger.log(`payable from group ${msg.groupId || '?'}: ${row.supplierName || 'supplier?'} ${row.invoiceNo || ''} S$ ${row.invoiceAmount.toFixed(2)}`);
    return { ok: true, id: row.id, invoiceNo: row.invoiceNo, supplierName: row.supplierName, invoiceAmount: row.invoiceAmount, projectName };
  }

  // ── Bank-payment upload (guru 2026-11-08): "if they upload the payment
  // page of a bank, auto match to a supplier and show them the outstanding
  // SIN and they can select what they paid and what % of each." ────────────

  /** AI-read a bank payment confirmation page (screenshot or PDF). */
  async extractPayment(dataUri: string, mimetype?: string) {
    const apiKey = process.env.ANTHROPIC_API_KEY;
    if (!apiKey) throw new BadRequestException('Payment extraction not configured (missing ANTHROPIC_API_KEY)');
    const commaIdx = dataUri.indexOf(',');
    const headerMatch = dataUri.match(/^data:([a-zA-Z/+.-]+);base64,/);
    const data = commaIdx >= 0 && headerMatch ? dataUri.slice(commaIdx + 1) : dataUri;
    const media = String(headerMatch?.[1] || mimetype || 'image/jpeg');
    const { default: Anthropic } = await import('@anthropic-ai/sdk');
    const client = new Anthropic({ apiKey });
    const system = `You are reading a BANK PAYMENT page (a transfer/payment confirmation screenshot or PDF from internet banking). Output ONLY strict JSON:
  - "payeeName": string or null — who was PAID (beneficiary / payee / to)
  - "amount": number or null — the payment amount
  - "currency": ISO code, default "SGD"
  - "paymentDate": YYYY-MM-DD or null — the value/transaction date
  - "reference": string or null — transaction/reference number
  - "bank": string or null — the paying bank (UOB, DBS, OCBC…)
  - "status": string or null — e.g. Successful / Pending, verbatim
Use null when unreadable. No prose outside the JSON.`;
    const content: any[] = [
      media.includes('pdf')
        ? { type: 'document', source: { type: 'base64', media_type: 'application/pdf', data } }
        : { type: 'image', source: { type: 'base64', media_type: media, data } },
      { type: 'text', text: 'Extract the bank payment per the system schema.' },
    ];
    const response = await client.messages.create({ model: 'claude-sonnet-4-6', max_tokens: 1024, system, messages: [{ role: 'user', content }] });
    const text = (response.content.find((b: any) => b.type === 'text') as any)?.text || '{}';
    const json = text.match(/\{[\s\S]*\}/)?.[0] || '{}';
    try {
      return JSON.parse(json);
    } catch {
      throw new BadRequestException('Could not read the payment page');
    }
  }

  /** Fuzzy supplier-name match: lowercase, strip legal suffixes, token overlap. */
  private supplierScore(payee: string, supplier: string): number {
    const norm = (s: string) =>
      s
        .toLowerCase()
        .replace(/[^a-z0-9 ]/g, ' ')
        .split(/\s+/)
        .filter((t) => t && !['pte', 'ltd', 'llp', 'llc', 'private', 'limited', 'co', 'company', 'the', 'sg', 'singapore', 'srl', 'spa', 'gmbh', 'inc'].includes(t));
    const a = norm(payee);
    const b = norm(supplier);
    if (!a.length || !b.length) return 0;
    const hit = a.filter((t) => b.some((x) => x === t || x.startsWith(t) || t.startsWith(x))).length;
    return hit / Math.max(a.length, b.length);
  }

  /**
   * Upload a bank payment page → the extracted payment, the best-matching
   * supplier (by payee name vs suppliers with OPEN rows), candidates, and
   * every open (to-pay / withheld) row so the caller can tick what was paid.
   */
  async matchPayment(organizationId: string, body: { dataUri: string; mimetype?: string }) {
    if (!body?.dataUri) throw new BadRequestException('Attach the bank payment page');
    const payment = await this.extractPayment(body.dataUri, body.mimetype);
    const open = await this.prisma.payableInvoice.findMany({
      where: { organizationId, status: { in: ['to_pay', 'withholding'] } },
      orderBy: [{ month: 'desc' }, { supplierName: 'asc' }, { createdAt: 'asc' }],
      take: 500,
    });
    const suppliers = [...new Set(open.map((r) => r.supplierName).filter(Boolean))] as string[];
    const scored = suppliers
      .map((s) => ({ supplier: s, score: payment?.payeeName ? this.supplierScore(String(payment.payeeName), s) : 0 }))
      .sort((a, b) => b.score - a.score);
    const best = scored[0]?.score >= 0.4 ? scored[0].supplier : null;
    return {
      payment,
      supplier: best,
      candidates: scored.filter((s) => s.score > 0).slice(0, 5),
      suppliers,
      rows: open,
    };
  }

  /**
   * Settle the ticked rows against a bank payment: optional per-row retention
   * % change (re-derives the payment amount), then PAID on the payment date.
   */
  async settle(
    organizationId: string,
    body: { rows: Array<{ id: string; percentage?: number | null }>; paymentDate?: string; reference?: string | null },
    actorName?: string | null,
  ) {
    const picks = Array.isArray(body?.rows) ? body.rows : [];
    if (!picks.length) throw new BadRequestException('Tick at least one invoice');
    const date = body.paymentDate ? new Date(body.paymentDate) : new Date();
    let updated = 0;
    for (const p of picks) {
      const row = await this.prisma.payableInvoice.findFirst({ where: { id: p.id, organizationId } });
      if (!row) continue;
      const percentage = p.percentage === undefined ? row.percentage : p.percentage === null ? null : Number(p.percentage);
      // Only re-derive the payment amount when the retention % ACTUALLY
      // CHANGED. A hand-typed row ("Add payable" — a loan, an ad-hoc payment)
      // carries a payment amount that is NOT invoice x (1-%), and its invoice
      // amount is often 0: recomputing unconditionally zeroed it the moment it
      // was settled, which took the money out of the Paid and MONTH TOTAL
      // figures. markPaid() never touched paymentAmount; settling now matches.
      const pctChanged = (percentage ?? null) !== (row.percentage ?? null);
      await this.prisma.payableInvoice.update({
        where: { id: row.id },
        data: {
          percentage,
          ...(pctChanged ? { paymentAmount: this.payAmount(row.invoiceAmount, percentage) } : {}),
          status: 'paid',
          paymentDate: date,
          approvedBy: row.approvedBy || actorName || null,
          remarks: row.remarks || (body.reference ? `Bank ref ${body.reference}` : row.remarks),
        },
      });
      updated++;
    }
    // The HTTP interceptor logs this as SETTLE (VERB_ACTIONS 'settle') — no
    // extra system row needed.
    return { updated };
  }

  /** "paid SGPO-0122 and 26304" → those open rows get today's payment date. */
  private async markPaidFromText(organizationId: string, body: string): Promise<string[]> {
    const open = await this.prisma.payableInvoice.findMany({
      where: { organizationId, status: 'to_pay', invoiceNo: { not: null } },
      select: { id: true, invoiceNo: true },
      take: 500,
    });
    const text = body.toLowerCase();
    const hit = open.filter((r) => r.invoiceNo && r.invoiceNo.length >= 3 && text.includes(r.invoiceNo.toLowerCase()));
    if (!hit.length) return [];
    await this.prisma.payableInvoice.updateMany({
      where: { id: { in: hit.map((h) => h.id) } },
      data: { status: 'paid', paymentDate: new Date() },
    });
    return hit.map((h) => h.invoiceNo as string);
  }
}
