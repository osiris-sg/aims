import { BadRequestException, ForbiddenException, Injectable } from '@nestjs/common';
import { PrismaService } from '../common/prisma.service';
import { grossOf } from '../common/document-money';
import { ClerkIdentityService } from '../clerk/clerk-identity.service';
import { groupOrgIds } from '../organizations/org-group';
import { aliasMapOf, SALESPERSON_ALIAS_ENTITY, SALESPERSON_ALIAS_FIELD } from '../sales-report/salesperson-resolver';
import { runAsOrg } from '../common/tenancy/tenant-context';
import { groupReadScope } from '../organizations/org-group';
import { cleanSettings, CommissionPerson, CommissionSettings, computeCommission, InvoiceIn, JOB_TYPES, PaymentIn, personOfLogin, RowOverride } from './commission';

// Commission report (guru 2026-11-28, flag enableCommissionReport). Reads what AIMS already holds:
//   payments   official receipts dated in the period (each invoice they pay), plus payments
//              recorded straight on an invoice with no receipt;
//   job type   the invoice lines' sales accounts (the org's service-type table, else the account's
//              own name: "CD REVENUE" is CD);
//   salesman   the invoice's Sales Person, else its quotation's, else the office's assignment, else
//              the old-ERP login that keyed the quotation when it is a salesperson's (an alias);
//   quotation  the ORDER the invoice sits on (every order names its quotation); with no order, the
//              invoice's source document, else its delivery order's;
//   cost       supplier invoices raised from the order's purchase orders, plus supplier invoice
//              lines tagged straight to the quotation.
// The rates and the per-row choices are the office's, kept per org in two CustomField rows (no new
// table): Commission / settings, and Commission / overrides:<YYYY-MM> per month of payment.

const ENTITY = 'Commission';
const INVOICE_TYPES = ['INVOICE', 'TI', 'TI2'];
const DO_TYPES = ['DELIVERY_ORDER', 'DO'];
const ISO = /^\d{4}-\d{2}-\d{2}$/;
const str = (v: unknown) => (typeof v === 'string' ? v.trim() : '');
/** A supplier invoice counted as a job's cost. */
interface JobBill { number: string; supplier: string; date: string; reference: string; amount: number; company: string }

@Injectable()
export class CommissionService {
  constructor(private readonly prisma: PrismaService, private readonly clerkIdentity?: ClerkIdentityService) {}

  private async assertOn(organizationId: string) {
    const ui = await this.prisma.organizationUIConfig.findUnique({ where: { organizationId }, select: { features: true } });
    const features: any = ui?.features || {};
    if (features.enableCommissionReport !== true) throw new ForbiddenException('The commission report is not switched on for this organization');
    return features;
  }

  private async readField(organizationId: string, fieldName: string): Promise<any> {
    const row = await this.prisma.customField.findFirst({ where: { organizationId, entityType: ENTITY, fieldName }, select: { options: true } });
    return row?.options ?? null;
  }

  private async writeField(organizationId: string, fieldName: string, label: string, options: any) {
    await this.prisma.customField.upsert({
      where: { organizationId_entityType_fieldName: { organizationId, entityType: ENTITY, fieldName } },
      update: { options },
      create: { organizationId, entityType: ENTITY, fieldName, displayLabel: label, fieldType: 'json', options, showInForm: false, showInList: false },
    });
  }

  /**
   * The accounts a salesperson row can be tied to (guru 2026-11-28: "they already have an account"):
   * the active users of this organization (and of its group), each with their salesman code and the
   * spellings the Sales report already knows them by. Picking one in Rates fills the row.
   */
  async peopleOptions(organizationId: string) {
    await this.assertOn(organizationId);
    const family = await groupOrgIds(this.prisma, organizationId);
    const orgIds = family.length ? family : [organizationId];
    const uos = await this.prisma.userOrganization.findMany({ where: { organizationId: { in: orgIds }, isActive: true }, select: { userId: true, salesmanCode: true, organizationId: true } });
    const clerk: Map<string, any> = this.clerkIdentity ? await this.clerkIdentity.toClerkUsers(uos.map((u) => u.userId)).catch(() => new Map()) : new Map();
    // The alias map the Sales report uses (text → user ids): a text that means ONE user is that user's spelling.
    const aliasRow = await this.prisma.customField.findFirst({ where: { organizationId, entityType: SALESPERSON_ALIAS_ENTITY, fieldName: SALESPERSON_ALIAS_FIELD, isActive: true }, select: { options: true } });
    const spellings = new Map<string, string[]>();
    for (const [text, ids] of aliasMapOf((aliasRow as any)?.options)) if (ids.length === 1) spellings.set(ids[0], [...(spellings.get(ids[0]) || []), text]);
    const out = new Map<string, { userId: string; name: string; aliases: string[] }>();
    for (const u of uos) {
      const c: any = clerk.get(u.userId);
      const name = c ? `${c.firstName || ''} ${c.lastName || ''}`.trim() || c.username || '' : '';
      if (!name) continue;
      const row = out.get(u.userId) || { userId: u.userId, name, aliases: [] as string[] };
      for (const a of [u.salesmanCode, ...(spellings.get(u.userId) || [])]) if (a && a.toLowerCase() !== name.toLowerCase() && !row.aliases.some((x) => x.toLowerCase() === a.toLowerCase())) row.aliases.push(a);
      out.set(u.userId, row);
    }
    return { people: Array.from(out.values()).sort((a, b) => a.name.localeCompare(b.name)) };
  }

  async getSettings(organizationId: string): Promise<CommissionSettings> {
    await this.assertOn(organizationId);
    return cleanSettings(await this.readField(organizationId, 'settings'));
  }

  async saveSettings(organizationId: string, body: any): Promise<CommissionSettings> {
    await this.assertOn(organizationId);
    const settings = cleanSettings(body);
    await this.writeField(organizationId, 'settings', 'Commission rates', settings);
    return settings;
  }

  /** Per-row choices, saved under the month of the payment so no row grows without end. */
  async saveOverrides(organizationId: string, body: { rows?: Array<{ key?: string; date?: string; rate?: number | null; exclude?: boolean; type?: string | null }> }) {
    await this.assertOn(organizationId);
    const byMonth = new Map<string, typeof body.rows>();
    for (const r of Array.isArray(body?.rows) ? body.rows : []) {
      if (!r?.key || !ISO.test(String(r.date || ''))) throw new BadRequestException('Each row needs its key and the payment date');
      const m = String(r.date).slice(0, 7);
      byMonth.set(m, [...(byMonth.get(m) || []), r]);
    }
    for (const [month, rows] of byMonth) {
      const map: Record<string, RowOverride> = { ...((await this.readField(organizationId, `overrides:${month}`)) || {}) };
      for (const r of rows || []) {
        const o: RowOverride = {};
        if (r.rate !== undefined && r.rate !== null && Number.isFinite(Number(r.rate))) o.rate = Math.max(0, Math.min(100, Number(r.rate)));
        if (r.exclude === true) o.exclude = true;
        if (r.type && (JOB_TYPES as readonly string[]).includes(String(r.type))) o.type = String(r.type);
        if (Object.keys(o).length) map[String(r.key)] = o;
        else delete map[String(r.key)];
      }
      await this.writeField(organizationId, `overrides:${month}`, `Commission row choices ${month}`, map);
    }
    return { saved: Array.from(byMonth.values()).reduce((n, r) => n + (r?.length || 0), 0) };
  }

  /**
   * The salesperson of a job AIMS has none for (over half of the imported invoices carry no
   * salesperson, and neither do their quotations). Kept by quotation number, so every later payment
   * of the same job is already attributed, and by invoice when the invoice has no quotation.
   * It is the office's assignment for commission only: the documents themselves are not changed.
   */
  async saveAssign(organizationId: string, body: { invoiceId?: string; quotation?: string; person?: string }) {
    await this.assertOn(organizationId);
    const invoiceId = str(body?.invoiceId);
    if (!invoiceId) throw new BadRequestException('Which invoice?');
    const person = str(body?.person).slice(0, 80);
    const map: Record<string, string> = { ...((await this.readField(organizationId, 'assign')) || {}) };
    const keys = [`inv:${invoiceId}`, ...(str(body?.quotation) ? [`quo:${str(body.quotation)}`] : [])];
    for (const k of keys) { if (person) map[k] = person; else delete map[k]; }
    await this.writeField(organizationId, 'assign', 'Commission salesperson assignments', map);
    return { ok: true, person: person || null };
  }

  private async overridesFor(organizationId: string, from: string, to: string): Promise<Record<string, RowOverride>> {
    const rows = await this.prisma.customField.findMany({
      where: { organizationId, entityType: ENTITY, fieldName: { gte: `overrides:${from.slice(0, 7)}`, lte: `overrides:${to.slice(0, 7)}` } },
      select: { options: true },
    });
    return Object.assign({}, ...rows.map((r) => (r.options as any) || {}));
  }

  /** account code → job type, from the org's service-type table, else from the account's name. */
  private async accountTypes(organizationId: string, features: any): Promise<(code: string) => string | null> {
    const map = new Map<string, string>();
    for (const t of Array.isArray(features?.serviceTypes) ? features.serviceTypes : []) {
      const type = String(t?.code || '').toUpperCase().split('/')[0];
      if (t?.accountCode && (JOB_TYPES as readonly string[]).includes(type)) map.set(String(t.accountCode), type);
    }
    if (!map.size) {
      const sales = await this.prisma.chartOfAccount.findMany({ where: { organizationId, code: { startsWith: '4' } }, select: { code: true, name: true } });
      for (const a of sales) {
        const m = String(a.name || '').toUpperCase().match(/\b(CD|AA|MV|VO|TS)\b/);
        if (m) map.set(a.code, m[1]);
      }
    }
    return (code: string) => map.get(code) || null;
  }

  /** The companies this report covers: the org alone, or a parent and its child companies when its group report is on. */
  private async scope(organizationId: string): Promise<{ group: boolean; orgs: Array<{ id: string; name: string }> }> {
    const s = await groupReadScope(this.prisma, organizationId, 'commissionReport');
    if (s.group) return s;
    const me = await this.prisma.organization.findUnique({ where: { id: organizationId }, select: { name: true } });
    return { group: false, orgs: [{ id: organizationId, name: me?.name ?? '' }] };
  }

  /**
   * One report for the request org, or for its whole group (guru 2026-11-28: "all companies are
   * compiled to one report in WCT org"). Each company's documents are read inside that company's
   * own tenancy context; the rates, the salesperson assignments and the per-row choices are the
   * request org's, so there is one set for the group. Read only across companies.
   */
  async report(organizationId: string, q: { from?: string; to?: string }) {
    await this.assertOn(organizationId);
    const from = String(q.from || '');
    const to = String(q.to || '');
    if (!ISO.test(from) || !ISO.test(to) || from > to) throw new BadRequestException('Give the period: from and to as YYYY-MM-DD');
    const [settings, assign, overrides, scope] = await Promise.all([
      this.readField(organizationId, 'settings').then(cleanSettings),
      this.readField(organizationId, 'assign').then((m) => (m || {}) as Record<string, string>),
      // A job fully paid in this period brings its EARLIER payments onto the report, so their row choices are needed too.
      this.overridesFor(organizationId, '0000-01', to),
      this.scope(organizationId),
    ]);
    const payments: PaymentIn[] = [];
    const invoices = new Map<string, InvoiceIn>();
    const costs = new Map<string, number>();
    const bills = new Map<string, JobBill[]>();
    for (const org of scope.orgs) {
      const part = await runAsOrg(org.id, () => this.loadOrg(org, from, to, assign, settings.people));
      payments.push(...part.payments);
      for (const [k, v] of part.invoices) invoices.set(k, v);
      for (const [k, v] of part.costs) costs.set(k, (costs.get(k) || 0) + v);
      for (const [k, v] of part.bills) bills.set(k, [...(bills.get(k) || []), ...v]);
    }
    // Each company has its own chart, so a line's job type is settled while its company is read.
    const typeOfAccount = (code: string) => (code.startsWith('type:') ? code.slice(5) : null);
    const out = computeCommission({ payments, from, to, invoices, costs, settings, overrides, typeOfAccount });
    return { from, to, settings, group: scope.group, companies: scope.orgs.map((o) => o.name), ...out, jobs: this.jobProofs(out, payments, invoices, costs, bills) };
  }

  /**
   * The proof behind each job on the report (guru 2026-11-28: "show the quotation / invoices under
   * each salesperson, that it is being paid, and the supplier invoices tagged to them, so the person
   * generating has quick proof the numbers are correct"): the quotation and its value, every
   * invoice raised against it with what is paid and owing, every payment received, and the supplier
   * invoices counted as its cost.
   */
  private jobProofs(out: ReturnType<typeof computeCommission>, payments: PaymentIn[], invoices: Map<string, InvoiceIn>, costs: Map<string, number>, bills: Map<string, JobBill[]>) {
    const R = (n: number) => Math.round((Number(n) || 0) * 100) / 100;
    const wanted = new Set<string>();
    for (const p of out.people) for (const r of p.rows) wanted.add(r.jobId);
    const jobOf = (inv: InvoiceIn) => (inv.quotation ? `q:${inv.quotation.id}` : `i:${inv.id}`);
    const proofs: Record<string, any> = {};
    for (const inv of invoices.values()) {
      const id = jobOf(inv);
      if (!wanted.has(id)) continue;
      const job = (proofs[id] ||= {
        quotation: inv.quotation?.number || '', value: inv.quotation?.net || inv.net, company: inv.company || '', customer: inv.customer,
        invoices: [] as any[], payments: [] as any[], supplierInvoices: inv.quotation ? bills.get(inv.quotation.id) || [] : [],
        cost: R(inv.quotation ? costs.get(inv.quotation.id) || 0 : 0), ...(out.jobs[id] || { received: 0, paidOn: null }),
      });
      const mine = payments.filter((p) => p.invoiceId === inv.id);
      const paidGross = R(mine.reduce((t, p) => t + p.amount, 0));
      job.invoices.push({ number: inv.number, net: R(inv.net), gross: R(inv.gross), received: paidGross, owing: R(Math.max(0, inv.gross - paidGross)) });
      for (const p of mine) job.payments.push({ date: p.date, receipt: p.number, invoice: inv.number, amount: R(p.amount), net: inv.gross > 0 && inv.net > 0 ? R((p.amount * inv.net) / inv.gross) : R(p.amount) });
    }
    for (const j of Object.values(proofs)) {
      j.invoices.sort((x: any, y: any) => String(x.number).localeCompare(String(y.number)));
      j.payments.sort((x: any, y: any) => String(x.date).localeCompare(String(y.date)));
      j.invoiced = R(j.invoices.reduce((t: number, x: any) => t + x.net, 0));
      j.margin = j.cost > 0 && j.value > 0 ? R(((j.value - j.cost) / j.value) * 100) : null;
    }
    return proofs;
  }

  private async loadOrg(org: { id: string; name: string }, from: string, to: string, assign: Record<string, string>, people: CommissionPerson[]) {
    const organizationId = org.id;
    const ui = await this.prisma.organizationUIConfig.findUnique({ where: { organizationId }, select: { features: true } });
    const typeOfAccount = await this.accountTypes(organizationId, ui?.features || {});
    const endOfTo = new Date(new Date(`${to}T00:00:00+08:00`).getTime() + 86400_000);
    // A void or a half-keyed receipt is not money received.
    const LIVE = `COALESCE(r.config->>'voided', '') <> 'true' AND COALESCE(r.config->>'incompleteReason', '') = ''`;

    // ── the invoices paid in the period ──
    const inPeriod: any[] = await this.prisma.$queryRawUnsafe(
      `SELECT DISTINCT x->>'documentId' AS doc FROM "Document" r, jsonb_array_elements(COALESCE(r.config->'allocations', '[]'::jsonb)) x
        WHERE r."organizationId" = $1 AND r.type = 'OFFICIAL_RECEIPT' AND r.config->>'date' >= $2 AND r.config->>'date' <= $3 AND ${LIVE}`,
      organizationId, from, to,
    );
    const directNow = await this.prisma.payment.findMany({
      where: { organizationId, receiptId: null, paymentDate: { gte: new Date(`${from}T00:00:00+08:00`), lt: endOfTo } },
      select: { documentId: true },
    });
    const periodIds = Array.from(new Set([...inPeriod.map((r) => String(r.doc)), ...directNow.map((p) => p.documentId)].filter(Boolean)));

    // ── their jobs: the order each invoice sits on names its quotation, and lists the job's other invoices ──
    // (guru 2026-11-28: "it's linked to the order which a quotation is linked to")
    const quoteIdOf = new Map<string, string>(); // invoice id → quotation id
    const posOfQuote = new Map<string, Set<string>>(); // quotation id → purchase order ids on its orders
    const jobIds = new Set(periodIds);
    if (periodIds.length) {
      const onOrders: any[] = await this.prisma.$queryRawUnsafe(
        `SELECT DISTINCT o."sourceQuotationId"::text AS quote FROM "Order" o, jsonb_array_elements(COALESCE(o."linkedDocuments"->'invoice', '[]'::jsonb)) i
          WHERE o."organizationId" = $1 AND o."sourceQuotationId" IS NOT NULL AND upper(COALESCE(o.status, '')) <> 'CANCELLED' AND i->>'id' = ANY($2::text[])`,
        organizationId, periodIds,
      );
      const quoteIdsNow = onOrders.map((r) => String(r.quote));
      if (quoteIdsNow.length) {
        const whole: any[] = await this.prisma.$queryRawUnsafe(
          `SELECT o."sourceQuotationId"::text AS quote, i->>'id' AS inv, o."linkedDocuments"->'po' AS po
             FROM "Order" o LEFT JOIN LATERAL jsonb_array_elements(COALESCE(o."linkedDocuments"->'invoice', '[]'::jsonb)) i ON true
            WHERE o."organizationId" = $1 AND upper(COALESCE(o.status, '')) <> 'CANCELLED' AND o."sourceQuotationId"::text = ANY($2::text[])`,
          organizationId, quoteIdsNow,
        );
        for (const r of whole) {
          if (r.inv) { if (!quoteIdOf.has(r.inv)) quoteIdOf.set(r.inv, r.quote); jobIds.add(String(r.inv)); }
          const set = posOfQuote.get(r.quote) || new Set<string>();
          for (const po of Array.isArray(r.po) ? r.po : []) if (po?.id) set.add(String(po.id));
          posOfQuote.set(r.quote, set);
        }
      }
    }
    const invoiceIds = Array.from(jobIds);

    // ── every payment of those invoices up to the end of the period (a job is paid for as a whole) ──
    const payments: PaymentIn[] = [];
    if (invoiceIds.length) {
      const recs: any[] = await this.prisma.$queryRawUnsafe(
        `SELECT r.id::text AS id, r.name, r.config->>'date' AS date, r.config->>'chequeNo' AS cheque, x->>'documentId' AS doc, (x->>'amount')::float8 AS amount
           FROM "Document" r, jsonb_array_elements(COALESCE(r.config->'allocations', '[]'::jsonb)) x
          WHERE r."organizationId" = $1 AND r.type = 'OFFICIAL_RECEIPT' AND r.config->>'date' <= $2 AND ${LIVE} AND x->>'documentId' = ANY($3::text[])`,
        organizationId, to, invoiceIds,
      );
      for (const r of recs) if (r.amount > 0) payments.push({ key: r.id, number: r.name || '', date: String(r.date).slice(0, 10), chequeNo: r.cheque || null, invoiceId: String(r.doc), amount: Number(r.amount) });
      const direct = await this.prisma.payment.findMany({
        where: { organizationId, receiptId: null, documentId: { in: invoiceIds }, paymentDate: { lt: endOfTo } },
        select: { id: true, documentId: true, amount: true, paymentDate: true, reference: true },
      });
      for (const p of direct) {
        if (!(p.amount > 0)) continue;
        payments.push({ key: p.id, number: 'Payment', date: new Date(p.paymentDate.getTime() + 8 * 3600_000).toISOString().slice(0, 10), chequeNo: p.reference || null, invoiceId: p.documentId, amount: p.amount });
      }
    }

    const invDocs = invoiceIds.length
      ? await this.prisma.document.findMany({ where: { organizationId, id: { in: invoiceIds }, type: { in: INVOICE_TYPES } }, select: { id: true, name: true, config: true } })
      : [];
    // With no order: the invoice's source document, else its delivery order's.
    const quoteNoOf = new Map<string, string>(); // invoice id → quotation number
    const doNoOf = new Map<string, string>(); // invoice id → delivery order number
    const isQuote = (n: string, type?: string) => /quot/i.test(type || '') || /^Q[-\d]/i.test(n);
    for (const d of invDocs) {
      if (quoteIdOf.has(d.id)) continue;
      const c: any = d.config || {};
      const src = str(c.sourceDocumentNumber);
      if (src && isQuote(src, str(c.sourceDocumentType))) quoteNoOf.set(d.id, src);
      else if (str(c.quotationNo)) quoteNoOf.set(d.id, str(c.quotationNo));
      else if (src) doNoOf.set(d.id, src);
      else if (str(c.erpImport?.ourDoNo)) doNoOf.set(d.id, str(c.erpImport.ourDoNo));
    }
    const doNos = Array.from(new Set(doNoOf.values()));
    const dos = doNos.length ? await this.prisma.document.findMany({ where: { organizationId, type: { in: DO_TYPES }, name: { in: doNos } }, select: { name: true, config: true } }) : [];
    const quoteOfDo = new Map<string, string>();
    for (const d of dos) {
      const c: any = d.config || {};
      const src = str(c.sourceDocumentNumber);
      const n = src && isQuote(src, str(c.sourceDocumentType)) ? src : str(c.quotationNo);
      if (n && d.name) quoteOfDo.set(d.name, n);
    }
    for (const [inv, doNo] of doNoOf) { const n = quoteOfDo.get(doNo); if (n) quoteNoOf.set(inv, n); }
    const quoteNos = Array.from(new Set(quoteNoOf.values()));
    const quoteIds = Array.from(new Set(quoteIdOf.values()));
    const quotes = quoteNos.length || quoteIds.length
      ? await this.prisma.document.findMany({ where: { organizationId, type: 'QUOTATION', OR: [{ name: { in: quoteNos } }, { id: { in: quoteIds } }] }, select: { id: true, name: true, config: true } })
      : [];
    const quoteByNo = new Map(quotes.map((d) => [d.name || '', d]));
    const quoteById = new Map(quotes.map((d) => [d.id, d]));

    // ── supplier cost of those jobs: invoices raised from the order's purchase orders, and lines tagged to the quotation ──
    const costs = new Map<string, number>();
    const bills = new Map<string, JobBill[]>();
    if (quotes.length) {
      const rows: any[] = await this.prisma.$queryRawUnsafe(
        `SELECT name, config FROM "Document" WHERE "organizationId" = $1 AND type = 'BILL'
            AND (config::text LIKE '%"quotationId"%' OR COALESCE(config->>'sourcePoId', '') <> '')`,
        organizationId,
      );
      const wanted = new Set(quotes.map((d) => d.id));
      const quoteOfPo = new Map<string, string>();
      for (const [quote, pos] of posOfQuote) for (const po of pos) quoteOfPo.set(po, quote);
      const add = (quote: string, b: any, amount: number) => {
        const c: any = b.config || {};
        costs.set(quote, (costs.get(quote) || 0) + amount);
        const list = bills.get(quote) || [];
        const same = list.find((x) => x.number === (b.name || ''));
        if (same) same.amount = Math.round((same.amount + amount) * 100) / 100;
        else list.push({ number: b.name || '', supplier: str(c.supplier?.name) || str(c.supplierName), date: String(c.billDate || c.date || '').slice(0, 10), reference: str(c.referenceNo) || str(c.reference), amount: Math.round(amount * 100) / 100, company: org.name });
        bills.set(quote, list);
      };
      for (const b of rows) {
        const c: any = b.config || {};
        if (c.voided || String(c.billStatus || '').toUpperCase() === 'VOID') continue;
        const sign = c.kind === 'SPR' ? -1 : 1; // a purchase return gives cost back
        // A supplier invoice raised from a purchase order of the job's order: the whole of it is that job's cost.
        const viaPo = quoteOfPo.get(String(c.sourcePoId || ''));
        if (viaPo) { add(viaPo, b, sign * (c.subtotal != null ? Number(c.subtotal) || 0 : (Number(c.totalAmount) || 0) - (Number(c.taxAmount) || 0))); continue; }
        for (const l of Array.isArray(c.lines) ? c.lines : []) {
          if (!l?.quotationId || !wanted.has(String(l.quotationId))) continue;
          add(String(l.quotationId), b, sign * ((Number(l.amount) || 0) - (c.amountsAre === 'INCLUSIVE' ? Number(l.taxAmount) || 0 : 0)));
        }
      }
    }

    const invoices = new Map<string, InvoiceIn>();
    for (const d of invDocs) {
      const c: any = d.config || {};
      const items: any[] = Array.isArray(c.items) ? c.items : [];
      const lineSum = items.reduce((s, it) => s + (Number(it?.amount) || 0), 0);
      const net = c.subTotal != null ? Number(c.subTotal) || 0 : lineSum;
      const quote = quoteById.get(quoteIdOf.get(d.id) || '') || quoteByNo.get(quoteNoOf.get(d.id) || '');
      const qc: any = quote?.config || {};
      invoices.set(d.id, {
        id: d.id,
        number: d.name || '',
        customer: str(c.customerName) || str(c.customer?.name),
        salesPerson:
          str(c.salesPerson) || str(c.documentInfo?.salesPerson) || str(qc.salesPerson) || str(qc.documentInfo?.salesPerson) ||
          str(assign[`quo:${quote?.name || ''}`]) || str(assign[`inv:${d.id}`]) ||
          // The old ERP's own record of who keyed the quotation, when that login is a salesperson's.
          personOfLogin(qc.erpImport?.coordinator, people) || personOfLogin(c.erpImport?.coordinator, people),
        subject: str(c.subject) || str(c.documentInfo?.subject),
        net,
        gross: Number(grossOf(c)) || net,
        lines: items.map((it) => {
          const type = it?.accountCode ? typeOfAccount(String(it.accountCode)) : null;
          return { amount: Number(it?.amount) || 0, accountCode: type ? `type:${type}` : null, description: it?.description || it?.name || '' };
        }),
        company: org.name,
        quotation: quote ? { id: quote.id, number: quote.name || '', net: qc.subTotal != null ? Number(qc.subTotal) || 0 : 0 } : null,
      });
    }
    return { payments, invoices, costs, bills };
  }
}
