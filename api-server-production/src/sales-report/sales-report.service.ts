import { BadRequestException, ForbiddenException, Injectable } from '@nestjs/common';
import { PrismaService } from '../common/prisma.service';
import { isOrgFeatureEnabled, SALES_REPORT_FLAG } from '../common/org-features';
import { ClerkIdentityService } from '../clerk/clerk-identity.service';
import {
  QUOTATION_CATEGORY_KEY,
  UNCATEGORISED,
  categoryLabel,
  cleanQuotationCategories,
  isQuotationCategoryEnabled,
  quotationCategories,
  saveQuotationCategories,
} from './quotation-category';
import {
  ReportRow,
  ReportScope,
  Salesman,
  amountExclGst,
  isoDateOrNull,
  quotationStatus,
  reportScope,
  salespeopleOf,
  summarise,
} from './sales-report';

const QUOTATION_TYPES = ['QUOTATION', 'QO', 'QO1', 'QO2', 'QT'];
const MAX_ROWS = 20000;

export interface ReportViewer {
  userId: string;
  isOsirisAdmin?: boolean;
}

/** The raw row the report query returns (only the config fields it needs, never the lines). */
interface QuoteRow {
  id: string;
  name: string | null;
  status: string;
  templateId: string | null;
  date: string;
  salesPerson: string | null;
  customer: string | null;
  subject: string | null;
  category: string | null;
  nettTotal: string | null;
  gstAmount: string | null;
  subTotal: string | null;
  discountAmount: string | null;
  itemsTotal: string | null;
  cancelled: boolean;
  signed: boolean;
  imported: boolean;
  erpStatus: string | null;
}

@Injectable()
export class SalesReportService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly clerkIdentity: ClerkIdentityService,
  ) {}

  // ── quotation categories (Settings) ──────────────────────────────────────

  async categories(organizationId: string) {
    const enabled = await isQuotationCategoryEnabled(this.prisma, organizationId);
    return { enabled, options: enabled ? await quotationCategories(this.prisma, organizationId) : [], uncategorised: UNCATEGORISED };
  }

  async saveCategories(organizationId: string, body: { options?: unknown }) {
    if (!(await isQuotationCategoryEnabled(this.prisma, organizationId))) throw new BadRequestException('Quotation categories are not enabled for this organisation');
    const options = cleanQuotationCategories(body?.options);
    return { enabled: true, options: await saveQuotationCategories(this.prisma, organizationId, options), uncategorised: UNCATEGORISED };
  }

  // ── the report ───────────────────────────────────────────────────────────

  /** The viewer's scope from their roles in this org (all of them: multi-role orgs hold several). */
  async scopeOf(organizationId: string, viewer: ReportViewer): Promise<ReportScope> {
    if (viewer.isOsirisAdmin) return 'all';
    const rows = await this.prisma.userRole.findMany({
      where: { userId: viewer.userId, organizationId, isActive: true },
      select: { role: { select: { name: true } } },
    });
    return reportScope(rows.map((r: any) => r.role?.name || ''));
  }

  /** The org's people with their names (Clerk), for the picker and for resolving codes / ids / free text. */
  private async salesmen(organizationId: string): Promise<Salesman[]> {
    const uos = await this.prisma.userOrganization.findMany({ where: { organizationId }, select: { userId: true, salesmanCode: true } });
    const clerk = await this.clerkIdentity.toClerkUsers(uos.map((u) => u.userId)).catch(() => new Map());
    return uos.map((u) => {
      const c: any = clerk.get(u.userId);
      const name = c ? `${c.firstName || ''} ${c.lastName || ''}`.trim() || c.username || c.emailAddresses?.[0]?.emailAddress || '' : '';
      return { userId: u.userId, code: u.salesmanCode || '', name };
    });
  }

  private async quotations(organizationId: string, from: string | null, to: string | null): Promise<QuoteRow[]> {
    // The quotation date: the list key (yyyy-MM-dd), else the config date, else the day it was made.
    const rows: QuoteRow[] = await this.prisma.$queryRawUnsafe(
      `SELECT * FROM (
         SELECT d.id::text AS id, d.name, d.status::text AS status, d."documentTemplateId" AS "templateId",
           COALESCE(NULLIF(d."listIssueDate", ''), LEFT(NULLIF(d.config->>'date', ''), 10), LEFT(NULLIF(d.config->'documentInfo'->>'date', ''), 10), to_char(d."createdAt", 'YYYY-MM-DD')) AS date,
           COALESCE(NULLIF(d.config->>'salesPerson', ''), NULLIF(d.config->'documentInfo'->>'salesPerson', '')) AS "salesPerson",
           COALESCE(NULLIF(d.config->>'customerName', ''), NULLIF(d.config->'customer'->>'name', ''), NULLIF(d.config->'erpImport'->>'erpCustomer', ''),
             (SELECT c.name FROM "Customer" c WHERE c."organizationId" = d."organizationId" AND c.id::text = d.config->>'customerId' LIMIT 1)) AS customer,
           COALESCE(NULLIF(d.config->>'subject', ''), NULLIF(d.config->'documentInfo'->>'subject', '')) AS subject,
           d.config->>'${QUOTATION_CATEGORY_KEY}' AS category,
           COALESCE(d.config->>'nettTotal', d.config->'documentInfo'->>'nettTotal') AS "nettTotal",
           COALESCE(d.config->>'gstAmount', d.config->'documentInfo'->>'gstAmount') AS "gstAmount",
           COALESCE(d.config->>'subTotal', d.config->'documentInfo'->>'subTotal') AS "subTotal",
           COALESCE(d.config->>'discountAmount', d.config->'documentInfo'->>'discountAmount') AS "discountAmount",
           (SELECT SUM((i->>'amount')::numeric)::text FROM jsonb_array_elements(CASE WHEN jsonb_typeof(d.config->'items') = 'array' THEN d.config->'items' ELSE '[]'::jsonb END) i
              WHERE (i->>'amount') ~ '^-?[0-9]+(\\.[0-9]+)?$') AS "itemsTotal",
           (COALESCE(d.config->>'cancelled', '') = 'true' OR COALESCE(d.config->>'voided', '') = 'true') AS cancelled,
           (d.config ? 'clientSignature' AND jsonb_typeof(d.config->'clientSignature') = 'object') AS signed,
           (d.config ? 'erpImport') AS imported,
           d.config->'erpImport'->>'status' AS "erpStatus"
         FROM "Document" d
         WHERE d."organizationId" = $1 AND d.type = ANY($2::text[])
       ) q
       WHERE ($3::text IS NULL OR q.date >= $3) AND ($4::text IS NULL OR q.date <= $4)
       ORDER BY q.date, q.name
       LIMIT ${MAX_ROWS}`,
      organizationId,
      QUOTATION_TYPES,
      from,
      to,
    );
    return rows;
  }

  /** Native quotations' sign links, emails and orders (imported ones carry their ERP status instead). */
  private async nativeFacts(organizationId: string, ids: string[]) {
    const signLinks = new Set<string>();
    const emailed = new Set<string>();
    const orders = new Map<string, string>();
    if (!ids.length) return { signLinks, emailed, orders };
    const [links, sent, ords] = await Promise.all([
      this.prisma.documentSignLink.findMany({ where: { documentId: { in: ids } }, select: { documentId: true } }).catch(() => []),
      this.prisma.auditLog
        .findMany({ where: { organizationId, resource: 'document', action: 'SENT', resourceId: { in: ids } }, select: { resourceId: true } })
        .catch(() => []),
      this.prisma.order
        .findMany({ where: { organizationId, sourceQuotationId: { in: ids } }, select: { sourceQuotationId: true, status: true, createdAt: true }, orderBy: { createdAt: 'asc' } })
        .catch(() => []),
    ]);
    for (const l of links as any[]) signLinks.add(l.documentId);
    for (const a of sent as any[]) if (a.resourceId) emailed.add(a.resourceId);
    // The latest order wins (a cancelled order followed by a new one reads as the new one).
    for (const o of ords as any[]) if (o.sourceQuotationId) orders.set(o.sourceQuotationId, o.status || 'OPEN');
    return { signLinks, emailed, orders };
  }

  async report(organizationId: string, viewer: ReportViewer, query: { salesperson?: string; from?: string; to?: string }) {
    if (!(await isOrgFeatureEnabled(this.prisma, organizationId, SALES_REPORT_FLAG))) throw new BadRequestException('The sales report is not enabled for this organisation');
    const scope = await this.scopeOf(organizationId, viewer);
    if (scope === 'none') throw new ForbiddenException('The sales report is for Admin, Accounting and Sales');
    const from = isoDateOrNull(query.from);
    const to = isoDateOrNull(query.to);
    if (from && to && from > to) throw new BadRequestException('The From date is after the To date');

    const salesmen = await this.salesmen(organizationId);
    const all = await this.quotations(organizationId, from, to);
    const facts = await this.nativeFacts(organizationId, all.filter((q) => !q.imported).map((q) => q.id));

    // Sales only: their own quotations, whatever was asked for.
    const ownKey = `u:${viewer.userId}`;
    const wanted = scope === 'own' ? ownKey : String(query.salesperson || '').trim();

    const people = new Map<string, string>();
    const rows: Array<ReportRow & { templateId: string | null; salespeople: string[] }> = [];
    for (const q of all) {
      const refs = salespeopleOf(q.salesPerson, salesmen);
      for (const r of refs) if (r.key && !people.has(r.key)) people.set(r.key, r.label);
      const keys = refs.map((r) => r.key);
      if (wanted && !keys.includes(wanted)) continue;
      rows.push({
        id: q.id,
        number: q.name || '',
        date: q.date,
        customer: q.customer || '',
        subject: q.subject || '',
        category: categoryLabel(q.category),
        amount: amountExclGst(q),
        status: quotationStatus({
          status: q.status,
          cancelled: q.cancelled,
          signed: q.signed,
          imported: q.imported,
          erpStatus: q.erpStatus,
          orderStatus: facts.orders.get(q.id) ?? null,
          hasSignLink: facts.signLinks.has(q.id),
          emailed: facts.emailed.has(q.id),
        }),
        templateId: q.templateId,
        salespeople: refs.map((r) => r.label),
      });
    }

    // The picker: every salesperson seen in the range plus the org's coded salesmen (Sales only: just themselves).
    for (const m of salesmen) if (m.code && m.name && !people.has(`u:${m.userId}`)) people.set(`u:${m.userId}`, m.name);
    const me = salesmen.find((m) => m.userId === viewer.userId);
    const salespeople =
      scope === 'own'
        ? [{ key: ownKey, label: me?.name || people.get(ownKey) || 'Me' }]
        : [...people.entries()].map(([key, label]) => ({ key, label })).sort((a, b) => a.label.localeCompare(b.label));

    const summary = summarise(rows, UNCATEGORISED);
    return {
      scope,
      salesperson: wanted || null,
      from,
      to,
      salespeople,
      rows,
      summary,
      truncated: all.length >= MAX_ROWS,
    };
  }
}
