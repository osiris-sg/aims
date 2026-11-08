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

  /** The month's tally + totals (the sheet's tab). No month → current month. */
  async list(organizationId: string, q: { month?: string; status?: string }) {
    const month = /^\d{4}-\d{2}$/.test(q.month || '') ? (q.month as string) : this.monthOf(new Date());
    const where: any = { organizationId, month };
    if (q.status === 'to_pay' || q.status === 'paid' || q.status === 'withholding') where.status = q.status;
    const rows = await this.prisma.payableInvoice.findMany({
      where,
      orderBy: [{ supplierName: 'asc' }, { createdAt: 'asc' }],
    });
    const sum = (list: any[]) => this.round2(list.reduce((s, r) => s + (Number(r.paymentAmount) || 0), 0));
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
      totals: { toPay: sum(toPay), withheld: sum(withheld), paid: sum(paid), all: sum(rows), toPayCount: toPay.length, withheldCount: withheld.length, paidCount: paid.length },
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

  /** Payment date set = PAID (the sheet's convention). */
  async markPaid(organizationId: string, id: string, dto: { paymentDate?: string; approvedBy?: string } = {}, actorName?: string | null) {
    const row = await this.prisma.payableInvoice.findFirst({ where: { id, organizationId } });
    if (!row) throw new NotFoundException('Payable not found');
    return this.prisma.payableInvoice.update({
      where: { id: row.id },
      data: {
        status: 'paid',
        paymentDate: dto.paymentDate ? new Date(dto.paymentDate) : new Date(),
        approvedBy: dto.approvedBy?.trim() || row.approvedBy || actorName || null,
      },
    });
  }

  async markUnpaid(organizationId: string, id: string) {
    const row = await this.prisma.payableInvoice.findFirst({ where: { id, organizationId } });
    if (!row) throw new NotFoundException('Payable not found');
    return this.prisma.payableInvoice.update({ where: { id: row.id }, data: { status: 'to_pay', paymentDate: null } });
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
