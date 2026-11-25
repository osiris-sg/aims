import { Injectable } from '@nestjs/common';
import { PrismaService } from '../common/prisma.service';

// Legacy "Sales Report" menu (guru 2026-11-25, Chong Aik parity). Each report
// aggregates ISSUED invoices (status pending_payment / paid / partially_paid /
// overdue / confirmed) over a date range, by a dimension:
//   customer  → config.customerId  (code/name from the Customer master)
//   salesman  → config.salesmanCode (sparse — not keyed on every org)
//   product   → line.assetId / itemCode (name = line description)
//   category  → line.category
// Totals per group: Total Sales (net, ex-GST), Total Cost (COGS), Nett Profit,
// Profit % (null → the legacy "***.**" mask when sales is 0). "Product cost
// increased by %" multiplies the cost side to model a cost rise.

type Dimension = 'customer' | 'salesman' | 'product' | 'category';

const INVOICE_TYPES = ['INVOICE', 'TI', 'TI2'];
const ISSUED = new Set(['pending_payment', 'paid', 'partially_paid', 'overdue', 'confirmed', 'partial']);
const R = (n: number) => Math.round((Number(n) || 0) * 100) / 100;

export interface SummaryFilters {
  dimension: Dimension;
  from?: string;
  to?: string;
  codeFrom?: string;
  codeTo?: string;
  sort?: 'asc' | 'desc';
  costUpliftPct?: number;
}

export interface SummaryRow {
  code: string;
  name: string;
  totalSales: number;
  totalCost: number;
  nettProfit: number;
  profitPct: number | null; // null = legacy "***.**"
}

@Injectable()
export class SalesReportsService {
  constructor(private readonly prisma: PrismaService) {}

  private sumLineSales(cfg: any): number {
    if (cfg?.subTotal != null) return Number(cfg.subTotal) || 0;
    return (cfg?.items || []).reduce((s: number, it: any) => s + (Number(it.amount) || 0), 0);
  }
  private sumLineCost(cfg: any): number {
    if (cfg?.totalCost != null) return Number(cfg.totalCost) || 0;
    return (cfg?.items || []).reduce((s: number, it: any) => s + (Number(it.totalCost) || 0), 0);
  }

  async summary(organizationId: string, f: SummaryFilters): Promise<{ rows: SummaryRow[]; totals: Omit<SummaryRow, 'code' | 'name' | 'profitPct'> & { profitPct: number | null } }> {
    const invoices = await this.prisma.document.findMany({
      where: { organizationId, type: { in: INVOICE_TYPES } },
      select: { status: true, config: true },
    });

    let custMap = new Map<string, { code: string; name: string }>();
    if (f.dimension === 'customer') {
      const custs: any[] = await this.prisma.customer.findMany({ where: { organizationId }, select: { id: true, customerCode: true, name: true } });
      custMap = new Map(custs.map((c) => [c.id, { code: c.customerCode || '', name: c.name || '' }]));
    }

    const g = new Map<string, { code: string; name: string; sales: number; cost: number }>();
    const add = (key: string, code: string, name: string, sales: number, cost: number) => {
      const r = g.get(key) || { code, name, sales: 0, cost: 0 };
      r.sales += sales; r.cost += cost;
      if (!r.code && code) r.code = code;
      if (!r.name && name) r.name = name;
      g.set(key, r);
    };

    for (const inv of invoices) {
      if (!ISSUED.has(String(inv.status || '').toLowerCase())) continue;
      const cfg: any = inv.config || {};
      const d = String(cfg.date || cfg.documentInfo?.date || '').slice(0, 10);
      if (f.from && d && d < f.from) continue;
      if (f.to && d && d > f.to) continue;

      if (f.dimension === 'customer') {
        const id = cfg.customerId || cfg.customer?.id || 'unknown';
        const info = custMap.get(id) || { code: String(cfg.customerCode || ''), name: String(cfg.customerName || cfg.customer?.name || 'Unknown') };
        add(id, info.code, info.name, this.sumLineSales(cfg), this.sumLineCost(cfg));
      } else if (f.dimension === 'salesman') {
        const code = String(cfg.salesmanCode || cfg.salesmanId || cfg.salesman || '').trim() || '(none)';
        add(code, code === '(none)' ? '' : code, String(cfg.salesmanName || ''), this.sumLineSales(cfg), this.sumLineCost(cfg));
      } else {
        for (const it of (cfg.items || [])) {
          const sales = Number(it.amount) || 0;
          const cost = Number(it.totalCost) || Number(it.costPrice) * Number(it.quantity) || 0;
          if (f.dimension === 'product') {
            const key = String(it.assetId || it.itemCode || it.sku || it.description || '').trim();
            if (!key) continue;
            add(key, String(it.itemCode || it.sku || ''), String(it.description || ''), sales, cost);
          } else { // category
            const cat = String(it.category || '(uncategorised)').trim();
            add(cat, cat, cat, sales, cost);
          }
        }
      }
    }

    const uplift = 1 + (Number(f.costUpliftPct) || 0) / 100;
    let rows: SummaryRow[] = [...g.values()].map((r) => {
      const totalCost = R(r.cost * uplift);
      const totalSales = R(r.sales);
      const nettProfit = R(totalSales - totalCost);
      return { code: r.code, name: r.name, totalSales, totalCost, nettProfit, profitPct: totalSales > 0 ? R((nettProfit / totalSales) * 100) : null };
    });

    if (f.codeFrom || f.codeTo) {
      const a = (f.codeFrom || f.codeTo || '').toUpperCase();
      const b = (f.codeTo || f.codeFrom || '').toUpperCase();
      const [lo, hi] = a.localeCompare(b) <= 0 ? [a, b] : [b, a];
      rows = rows.filter((r) => { const c = (r.code || '').toUpperCase(); return c && c >= lo && c <= hi; });
    }
    rows.sort((x, y) => (x.code || '').localeCompare(y.code || '') || (x.name || '').localeCompare(y.name || ''));
    if (f.sort === 'desc') rows.reverse();

    const totalSales = R(rows.reduce((s, r) => s + r.totalSales, 0));
    const totalCost = R(rows.reduce((s, r) => s + r.totalCost, 0));
    const nettProfit = R(totalSales - totalCost);
    return { rows, totals: { totalSales, totalCost, nettProfit, profitPct: totalSales > 0 ? R((nettProfit / totalSales) * 100) : null } };
  }

  private inRange(d: string, from?: string, to?: string) {
    if (from && d && d < from) return false;
    if (to && d && d > to) return false;
    return true;
  }

  // ---- Detailed analysis: every sales line, grouped by the dimension ----
  async detailed(organizationId: string, f: { dimension: Dimension; from?: string; to?: string; codeFrom?: string; codeTo?: string }) {
    const invoices = await this.prisma.document.findMany({ where: { organizationId, type: { in: INVOICE_TYPES } }, select: { name: true, status: true, config: true } });
    let custMap = new Map<string, { code: string; name: string }>();
    if (f.dimension === 'customer') {
      const custs: any[] = await this.prisma.customer.findMany({ where: { organizationId }, select: { id: true, customerCode: true, name: true } });
      custMap = new Map(custs.map((c) => [c.id, { code: c.customerCode || '', name: c.name || '' }]));
    }
    type Line = { date: string; docNo: string; itemCode: string; description: string; qty: number; sales: number; cost: number; profit: number };
    const groups = new Map<string, { code: string; name: string; lines: Line[]; sales: number; cost: number }>();
    for (const inv of invoices) {
      if (!ISSUED.has(String(inv.status || '').toLowerCase())) continue;
      const cfg: any = inv.config || {};
      const d = String(cfg.date || '').slice(0, 10);
      if (!this.inRange(d, f.from, f.to)) continue;
      const docNo = (inv as any).name || cfg.documentInfo?.documentNumber || '';
      for (const it of (cfg.items || [])) {
        const sales = Number(it.amount) || 0;
        const cost = Number(it.totalCost) || (Number(it.costPrice) || 0) * (Number(it.quantity) || 0);
        let key = '', code = '', name = '';
        if (f.dimension === 'customer') { const id = cfg.customerId || cfg.customer?.id || 'unknown'; const info = custMap.get(id) || { code: String(cfg.customerCode || ''), name: String(cfg.customerName || 'Unknown') }; key = id; code = info.code; name = info.name; }
        else if (f.dimension === 'salesman') { code = String(cfg.salesmanCode || cfg.salesmanId || '').trim() || '(none)'; key = code; name = code === '(none)' ? '' : code; }
        else if (f.dimension === 'product') { key = String(it.assetId || it.itemCode || it.sku || '').trim(); code = String(it.itemCode || it.sku || ''); name = String(it.description || ''); if (!key) continue; }
        else { const cat = String(it.category || '(uncategorised)').trim(); key = cat; code = cat; name = cat; }
        const g = groups.get(key) || { code, name, lines: [], sales: 0, cost: 0 };
        g.lines.push({ date: d, docNo, itemCode: String(it.itemCode || it.sku || ''), description: String(it.description || ''), qty: Number(it.quantity) || 0, sales: R(sales), cost: R(cost), profit: R(sales - cost) });
        g.sales += sales; g.cost += cost;
        if (!g.code && code) g.code = code; if (!g.name && name) g.name = name;
        groups.set(key, g);
      }
    }
    let out = [...groups.values()].map((g) => ({ code: g.code, name: g.name, lines: g.lines.sort((a, b) => a.date.localeCompare(b.date)), subtotal: { sales: R(g.sales), cost: R(g.cost), profit: R(g.sales - g.cost) } }));
    if (f.codeFrom || f.codeTo) { const a = (f.codeFrom || f.codeTo || '').toUpperCase(), b = (f.codeTo || f.codeFrom || '').toUpperCase(); const [lo, hi] = a.localeCompare(b) <= 0 ? [a, b] : [b, a]; out = out.filter((x) => { const c = (x.code || '').toUpperCase(); return c && c >= lo && c <= hi; }); }
    out.sort((x, y) => (x.code || '').localeCompare(y.code || ''));
    const sales = R(out.reduce((s, g) => s + g.subtotal.sales, 0));
    const cost = R(out.reduce((s, g) => s + g.subtotal.cost, 0));
    return { groups: out, totals: { sales, cost, profit: R(sales - cost) } };
  }

  // ---- Document listings (Quotation / DO / Invoice / Outstanding) ----
  async listing(organizationId: string, f: { type: 'quotation' | 'do' | 'invoice' | 'outstanding'; from?: string; to?: string }) {
    const TYPES: Record<string, string[]> = { quotation: ['QUOTATION', 'QO', 'QO1', 'QO2', 'QT'], do: ['DELIVERY_ORDER', 'DO'], invoice: INVOICE_TYPES, outstanding: INVOICE_TYPES };
    const docs = await this.prisma.document.findMany({ where: { organizationId, type: { in: TYPES[f.type] } }, select: { name: true, status: true, config: true } });
    const rows: any[] = [];
    for (const doc of docs) {
      const cfg: any = doc.config || {};
      const st = String(doc.status || '').toLowerCase();
      if (st === 'void' || st === 'voided' || st === 'cancelled') continue;
      const d = String(cfg.date || '').slice(0, 10);
      if (!this.inRange(d, f.from, f.to)) continue;
      const amount = Number(cfg.nettTotal ?? cfg.totalWithTax ?? cfg.subTotal) || 0;
      const base = { number: (doc as any).name || cfg.documentInfo?.documentNumber || '', date: d, customer: String(cfg.customerName || cfg.customer?.name || ''), subject: String(cfg.documentInfo?.subject || cfg.subject || ''), amount: R(amount), status: String(doc.status || '') };
      if (f.type === 'outstanding') {
        if (st === 'paid' || st === 'draft') continue;
        const bal = cfg.outstandingBalance != null ? Number(cfg.outstandingBalance) : amount - (Number(cfg.paidToDate) || 0);
        if (bal <= 0.005) continue;
        rows.push({ ...base, paid: R(Number(cfg.paidToDate) || 0), balance: R(bal) });
      } else {
        if ((f.type === 'invoice' || f.type === 'do') && st === 'draft') continue;
        rows.push(base);
      }
    }
    rows.sort((a, b) => (a.date || '').localeCompare(b.date || '') || (a.number || '').localeCompare(b.number || ''));
    const total = R(rows.reduce((s, r) => s + (f.type === 'outstanding' ? r.balance : r.amount), 0));
    return { rows, total };
  }

  // ---- Last Sold: each item's most recent sale ----
  async lastSold(organizationId: string, f: { from?: string; to?: string }) {
    const invoices = await this.prisma.document.findMany({ where: { organizationId, type: { in: INVOICE_TYPES } }, select: { status: true, config: true } });
    const map = new Map<string, { code: string; description: string; date: string; customer: string; qty: number; price: number }>();
    for (const inv of invoices) {
      if (!ISSUED.has(String(inv.status || '').toLowerCase())) continue;
      const cfg: any = inv.config || {};
      const d = String(cfg.date || '').slice(0, 10);
      if (!this.inRange(d, f.from, f.to)) continue;
      const cust = String(cfg.customerName || cfg.customer?.name || '');
      for (const it of (cfg.items || [])) {
        const key = String(it.assetId || it.itemCode || it.sku || '').trim(); if (!key) continue;
        const prev = map.get(key);
        if (!prev || d > prev.date) map.set(key, { code: String(it.itemCode || it.sku || ''), description: String(it.description || ''), date: d, customer: cust, qty: Number(it.quantity) || 0, price: Number(it.unitPrice) || 0 });
      }
    }
    const rows = [...map.values()].sort((a, b) => (a.code || '').localeCompare(b.code || ''));
    return { rows };
  }

  // ---- Slow Moving: items ranked by how little they sold in a window ----
  async slowMoving(organizationId: string, f: { asOf?: string; months?: number }) {
    const asOf = (f.asOf || new Date().toISOString().slice(0, 10)).slice(0, 10);
    const months = Number(f.months) || 6;
    const since = (() => { const d = new Date(asOf); d.setMonth(d.getMonth() - months); return d.toISOString().slice(0, 10); })();
    const invoices = await this.prisma.document.findMany({ where: { organizationId, type: { in: INVOICE_TYPES } }, select: { status: true, config: true } });
    const sold = new Map<string, { qty: number; last: string; code: string; desc: string }>();
    for (const inv of invoices) {
      if (!ISSUED.has(String(inv.status || '').toLowerCase())) continue;
      const cfg: any = inv.config || {};
      const d = String(cfg.date || '').slice(0, 10);
      if (d && d > asOf) continue;
      for (const it of (cfg.items || [])) {
        const key = String(it.assetId || it.itemCode || it.sku || '').trim(); if (!key) continue;
        const rec = sold.get(key) || { qty: 0, last: '', code: String(it.itemCode || it.sku || ''), desc: String(it.description || '') };
        if (d >= since && d <= asOf) rec.qty += Number(it.quantity) || 0;
        if (d > rec.last) rec.last = d;
        sold.set(key, rec);
      }
    }
    const assets: any[] = await this.prisma.asset.findMany({ where: { organizationId }, select: { id: true, name: true, description: true, quantity: true } });
    const rows = assets.map((a) => {
      const rec = sold.get(a.id);
      return { code: rec?.code || '', description: a.name || a.description || rec?.desc || '', onHand: Number(a.quantity) || 0, qtySold: rec?.qty || 0, lastSold: rec?.last || '' };
    }).filter((r) => r.onHand > 0 || r.qtySold > 0);
    rows.sort((x, y) => x.qtySold - y.qtySold || (x.lastSold || '').localeCompare(y.lastSold || ''));
    return { rows, meta: { asOf, since, months } };
  }
}
