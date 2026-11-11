/**
 * "Legacy DO" layout — the delivery order drawn to match the previous
 * accounting software's print preview (guru 2026-11-12, PT. Ekasindo Inti
 * Semesta's DO 151307 as the sample): no letterhead (pre-printed paper), the
 * document code top right, Bill To at the left with the title block at the
 * right (DELIVERY ORDER, NPWP / tax number, the number in bold, Date, P/O No.,
 * Terms, Salesman, Customer), an Attn line, then Item · Description · Quantity
 * · uom · Remarks under a single rule, and a pinned footer of "Goods Received
 * In Good Order & Condition" beside the company name over a double rule.
 *
 * Chosen by the template's design knob `layout: 'legacy-do'` (Admin → org →
 * Manage Templates → Design → Layout). Only delivery orders use it; every
 * other type on the same template keeps the standard frame. Like the WCT
 * layout it is the single source for the editor preview (iframe of
 * POST /documents/preview-html) and the PDF. The font knob applies (the
 * paper is Calibri).
 */
import { DocumentDesign } from './design';
import { billToText, descriptionText, escapeHtml, makeDi } from './shared';

const CSS = `
<style>
  .ldo { font-size: 13px; color: #000; line-height: 1.5; display: flex; flex-direction: column; min-height: 257mm; }
  .ldo p { margin: 0; }
  .ldo .code { text-align: right; font-size: 12.5px; margin-bottom: 2px; }
  .ldo .top { display: flex; justify-content: space-between; gap: 24px; align-items: flex-start; }
  .ldo .bill { flex: 1; min-width: 0; padding-top: 26px; }
  .ldo .bill .lbl { font-weight: 700; }
  .ldo .bill .nm { font-weight: 700; font-size: 14px; margin-top: 6px; white-space: pre-line; }
  .ldo .hdr { width: 300px; flex: 0 0 300px; }
  .ldo .hdr .title { font-weight: 700; font-size: 20px; letter-spacing: .3px; line-height: 1.2; }
  .ldo .hdr .kv { display: grid; grid-template-columns: 96px 12px 1fr; column-gap: 4px; row-gap: 3px; margin-top: 4px; }
  .ldo .hdr .kv .k { white-space: nowrap; }
  .ldo .hdr .kv .c { text-align: center; }
  .ldo .hdr .kv .v { white-space: nowrap; }
  .ldo .hdr .kv .no { font-weight: 700; font-size: 15px; }
  .ldo .hdr .kv .ttl { font-weight: 700; }
  .ldo .attn { margin-top: 14px; }
  .ldo .attn b { font-weight: 400; margin-right: 10px; }
  table.ldo-lines { width: 100%; border-collapse: collapse; margin-top: 4px; }
  table.ldo-lines th { border: none; border-bottom: 1.5px solid #000; padding: 4px 6px; font-weight: 700; font-size: 13px; text-align: left; white-space: nowrap; }
  table.ldo-lines th.c { text-align: center; }
  table.ldo-lines th.r { text-align: right; }
  table.ldo-lines td { border: none; padding: 8px 6px 2px; font-size: 13px; vertical-align: top; }
  table.ldo-lines tbody tr { page-break-inside: avoid; break-inside: avoid; }
  table.ldo-lines td.item { width: 40px; text-align: center; }
  table.ldo-lines td.qty { width: 72px; text-align: right; white-space: nowrap; font-variant-numeric: tabular-nums; }
  table.ldo-lines td.uom { width: 52px; }
  table.ldo-lines td.rem { width: 120px; }
  table.ldo-lines td.desc p { white-space: pre-wrap; line-height: 1.9; }
  .ldo .foot { margin-top: auto; padding-top: 24px; page-break-inside: avoid; break-inside: avoid; }
  .ldo .foot .dbl { border-top: 1.5px solid #000; border-bottom: 1.5px solid #000; height: 4px; margin-bottom: 10px; }
  .ldo .foot .row { display: flex; justify-content: space-between; gap: 24px; align-items: flex-start; }
  .ldo .foot .co { font-weight: 700; text-transform: uppercase; padding-right: 40px; }
  .ldo .remarks { margin-top: 14px; }
  .ldo .footnote { margin-top: 10px; font-size: 11px; color: #444; }
</style>`;

const first = (...vals: any[]): string => {
  for (const v of vals) {
    if (v === undefined || v === null) continue;
    const s = String(v).trim();
    if (s) return s;
  }
  return '';
};

const paperDate = (v: any): string => {
  if (!v) return '';
  const d = new Date(v);
  if (isNaN(d.getTime())) return String(v);
  const p = (n: number) => String(n).padStart(2, '0');
  return `${p(d.getDate())}/${p(d.getMonth() + 1)}/${d.getFullYear()}`;
};

const qtyText = (q: any): string => {
  const n = Number(q);
  if (!isFinite(n)) return escapeHtml(q ?? '');
  return Number.isInteger(n) ? String(n) : n.toFixed(2);
};

/** Salesman: the picker stores a code or a name; the name is on the salesman row when the editor resolved it. */
function salesmanOf(data: any, di: (k: string, d?: any) => any): string {
  const sp = di('salesPerson');
  if (sp && typeof sp === 'object') return first(sp.name, sp.code);
  return first(data?.salesPersonName, data?.salesmanName, sp, di('salesman'));
}

export function renderLegacyDoBody(data: any, organization: any, design: DocumentDesign): string {
  const di = makeDi(data);
  const org = organization || data?.organization || {};
  const company = data?.company || {};
  const items: any[] = (Array.isArray(data?.items) ? data.items : []).filter((it: any) => it && !it.isTagGroup);
  const docNumber = first(di('documentNumber'), data?.name);
  const customer = data?.customer || {};
  const billName = first(customer.name, data?.customerName);
  const billAddr = billToText(first(data?.billTo, customer.address, data?.customerAddress), billName);
  const attention = first(di('contact'), di('contactName'), data?.attention?.name, data?.deliveryAddress?.attention, customer.contactPerson);
  const taxNo = first(org?.gstRegNo, org?.taxRegNo, org?.registrationNumber, company.gstRegNo);
  const customerCode = first(customer.customerCode, data?.customerCode, di('customerCode'));
  const terms = first(di('paymentTerms'), di('terms'), customer.paymentTerms, customer.terms);
  const poNo = first(di('poNo'), di('poNumber'), di('purchaseOrderNo'), data?.poNumber);
  const remarks = first(data?.remarks, di('remarks'));
  const footerMessage = first(di('footerMessage'), data?.footerMessage);
  const companyName = first(org?.name, company.name);

  // Columns: the paper's five, unless the template reorders / relabels them.
  const defaults = ['no', 'description', 'quantity', 'uom', 'remarks'];
  const labelsDefault: Record<string, string> = { no: 'Item', description: 'Description', quantity: 'Quantity', uom: 'uom', remarks: 'Remarks' };
  const internal: string[] = Array.isArray(data?.internalColumns) ? data.internalColumns : ['discountPrice', 'costPrice', 'unitPrice', 'amount'];
  const order: string[] = Array.isArray(data?.tableColumnOrder) && data.tableColumnOrder.length ? data.tableColumnOrder : defaults;
  const columns = order.filter((c) => !internal.includes(c));
  const labels: Record<string, string> = { ...labelsDefault, ...(data?.columnLabels || {}) };
  const cls = (c: string) => (c === 'no' ? 'item' : c === 'quantity' ? 'qty' : c === 'uom' ? 'uom' : c === 'remarks' ? 'rem' : c === 'description' ? 'desc' : '');
  const headCls = (c: string) => (c === 'quantity' ? 'r' : c === 'no' ? 'c' : '');
  const value = (c: string, it: any, i: number): string => {
    switch (c) {
      case 'no':
        return String(i + 1);
      case 'description':
        return descriptionText(it.description || it.name || '');
      case 'quantity':
        return qtyText(it.quantity);
      case 'uom':
        return escapeHtml(it.uom || '');
      case 'remarks':
        return escapeHtml(it.remarks ?? it.remark ?? '');
      default:
        return escapeHtml(it[c] ?? '');
    }
  };
  const head = columns.map((c) => `<th class="${headCls(c)}">${escapeHtml(labels[c] || c)}</th>`).join('');
  const rows = items
    .map((it, i) =>
      it.isGroupHeader
        ? `<tr><td colspan="${columns.length}" style="font-weight:700;">${escapeHtml(it.description || '')}</td></tr>`
        : `<tr>${columns.map((c) => `<td class="${cls(c)}">${value(c, it, i)}</td>`).join('')}</tr>`,
    )
    .join('');

  const kv = (k: string, v: string, extra = '') => `<span class="k ${extra}">${escapeHtml(k)}</span><span class="c">:</span><span class="v ${extra}">${escapeHtml(v)}</span>`;
  const headerBlock = `
    <div class="hdr">
      <div class="title">${escapeHtml(design.titleText || 'DELIVERY ORDER')}</div>
      <div class="kv">
        ${taxNo ? kv('NPWP No.', taxNo) : ''}
        <span class="k ttl">DELIVERY ORDER</span><span class="c"></span><span class="v no">${escapeHtml(docNumber)}</span>
        ${kv('Date', paperDate(di('date')))}
        ${kv('P/O No.', poNo)}
        ${kv('Terms', terms)}
        ${kv('Salesman', salesmanOf(data, di))}
        ${kv('Customer', customerCode)}
      </div>
    </div>`;

  return `${CSS}<div class="ldo">
    <div class="code">DO ${escapeHtml(docNumber)}</div>
    <div class="top">
      <div class="bill"><span class="lbl">Bill To &nbsp;&nbsp;:</span><div class="nm">${escapeHtml(billName)}${billAddr ? `\n${escapeHtml(billAddr)}` : ''}</div></div>
      ${headerBlock}
    </div>
    <div class="attn"><b>Attn:</b>${escapeHtml(attention)}</div>
    <table class="ldo-lines"><thead><tr>${head}</tr></thead><tbody>${rows}</tbody></table>
    ${remarks ? `<div class="remarks"><b>Remarks:</b> ${escapeHtml(remarks)}</div>` : ''}
    <div class="foot">
      <div class="dbl"></div>
      <div class="row"><div>Goods Received In Good Order &amp; Condition</div><div class="co">${escapeHtml(companyName)}</div></div>
      ${footerMessage ? `<div class="footnote">${escapeHtml(footerMessage)}</div>` : ''}
      ${design.footerText ? `<div class="footnote" style="text-align:center;">${escapeHtml(design.footerText)}</div>` : ''}
    </div>
  </div>`;
}
