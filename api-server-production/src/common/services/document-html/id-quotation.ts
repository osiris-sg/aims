/**
 * Interior-design quotation ("Letter of Intent & Appointment for Renovation
 * Works") — the client-facing print layout for documents saved by the ID
 * quotation editor (config.templateVariant === 'ID', config.quote = tree).
 *
 * Structure mirrors CIEL INTERIOR's Excel contract verbatim (they sign on it):
 *   title line → client / contract header grid → lettered trade sections →
 *   room/area sub-headings → numbered items with "* Includes …" bullets →
 *   section subtotals → Total / Professional Design Fee / discounts / Grand
 *   Total → General Terms & Conditions (payment terms A–E + clauses) →
 *   signature block (designer / "Agreed & accepted by client").
 * Internal columns (cost, margin) are NEVER rendered here.
 *
 * Shared by the on-screen preview (GET /documents/:id/html → iframe) and the
 * server PDF, so what the designer sees is exactly what the client gets.
 */
import { escapeHtml, formatDate, money } from './shared';

type Include = { text: string; qty?: number | null; amount?: number | null; pricingMode?: string | null };
type Item = {
  no?: number;
  description: string;
  qty?: number | null;
  uom?: string | null;
  amount?: number | null;
  pricingMode?: string | null; // priced | inclusive | complimentary
  includes?: Include[];
};
type Area = { name?: string | null; items: Item[] };
type Section = { letter?: string | null; title: string; notes?: string[]; areas: Area[] };
type Quote = {
  header?: Record<string, any>;
  sections?: Section[];
  summary?: { designFeePct?: number | null; discounts?: Array<{ label: string; amount: number }> };
  terms?: { paymentTerms?: string[]; clauses?: string[] };
  /** Set by the public /sign flow: { name, image (PNG data URL), signedAt, ip }. */
  clientSignature?: { name?: string; image?: string; signedAt?: string; ip?: string | null } | null;
  /** Designer counter-signature (office side, after the client signs). */
  designerSignature?: { name?: string; image?: string; signedAt?: string } | null;
};

const CSS = `
<style>
  .idq { font-size: 12.5px; color: #111; }
  .idq h1 { font-size: 13.5px; font-weight: 700; margin: 0 0 10px; letter-spacing: .2px; }
  .idq .brand { display:flex; justify-content:space-between; align-items:flex-start; margin-bottom: 14px; padding-bottom: 10px; border-bottom: 2px solid #111; }
  .idq .brand img { max-height: 46px; max-width: 200px; object-fit: contain; }
  .idq .brand .co { text-align:right; font-size: 11.5px; line-height: 1.45; color:#333; }
  .idq .brand .co b { font-size: 14px; color:#111; letter-spacing:.3px; }
  .idq .hdr { display:grid; grid-template-columns: 1fr 1fr; gap: 4px 28px; margin-bottom: 14px; }
  .idq .hdr .row { display:flex; font-size: 12.5px; line-height: 1.5; }
  .idq .hdr .row .k { width: 118px; color:#555; flex: 0 0 118px; }
  .idq .hdr .row .v { flex:1; font-weight: 600; white-space: pre-line; }
  .idq table.lines { width:100%; border-collapse: collapse; }
  .idq table.lines th { font-size: 11px; text-transform: uppercase; letter-spacing:.6px; color:#444; border-bottom: 1.5px solid #111; padding: 6px 6px; text-align:left; }
  .idq table.lines td { padding: 4px 6px; vertical-align: top; font-size: 12.5px; border: none; line-height: 1.45; }
  .idq td.no { width: 32px; color:#555; text-align:right; padding-right: 8px; }
  .idq td.qty { width: 84px; text-align:center; white-space: nowrap; }
  .idq td.amt { width: 110px; text-align:right; white-space: nowrap; font-variant-numeric: tabular-nums; }
  .idq tr.section td { background:#f1f1f1; font-weight:700; font-size: 12.5px; padding: 7px 6px; border-top: 1px solid #ddd; page-break-after: avoid; }
  .idq tr.section td .letter { display:inline-block; min-width: 18px; margin-right: 8px; color:#111; }
  .idq tr.note td { color:#555; font-style: italic; font-size: 11.5px; padding-top: 2px; padding-bottom: 2px; }
  .idq tr.area td { font-weight: 700; text-decoration: underline; text-underline-offset: 3px; padding-top: 8px; page-break-after: avoid; }
  .idq tr.item td.desc { white-space: pre-line; }
  .idq tr.inc td.desc { padding-left: 22px; color:#333; }
  .idq tr.inc td.desc::before { content: "* "; color:#777; }
  .idq tr.subtotal td { border-top: 1px solid #bbb; font-weight: 600; padding-top: 6px; padding-bottom: 10px; }
  .idq tr.subtotal td.lbl { text-align:right; color:#444; font-size: 11.5px; text-transform: uppercase; letter-spacing: .5px; }
  .idq .word { font-weight: 600; font-style: italic; color:#333; }
  .idq .totals { margin-top: 14px; display:flex; justify-content:flex-end; page-break-inside: avoid; }
  .idq .totals table { width: 320px; border-collapse: collapse; }
  .idq .totals td { padding: 4px 8px; font-size: 12.5px; border:none; }
  .idq .totals td.v { text-align:right; font-variant-numeric: tabular-nums; white-space:nowrap; }
  .idq .totals tr.grand td { border-top: 2px solid #111; font-weight: 700; font-size: 14px; padding-top: 8px; }
  .idq .terms { page-break-before: always; }
  .idq .terms h2 { font-size: 13px; margin: 0 0 8px; letter-spacing:.3px; }
  .idq .terms h3 { font-size: 12px; margin: 10px 0 4px; }
  .idq .terms ol { margin: 0; padding-left: 18px; }
  .idq .terms li { margin-bottom: 5px; font-size: 11.5px; line-height: 1.5; }
  .idq .pay { display:grid; grid-template-columns: 1fr 1fr; gap: 2px 24px; margin-bottom: 8px; font-size: 11.5px; }
  .idq .sign { display:flex; justify-content:space-between; margin-top: 34px; page-break-inside: avoid; }
  .idq .sign .blk { width: 45%; font-size: 12px; line-height: 1.5; }
  .idq .sign .line { border-top: 1px solid #111; margin-top: 44px; padding-top: 4px; color:#444; font-size: 11px; }
  .idq .sign img + .line { margin-top: 0; }
</style>`;

const isNum = (v: any): v is number => typeof v === 'number' && isFinite(v);

function amountCell(mode: string | null | undefined, amount: number | null | undefined): string {
  if (mode === 'inclusive') return '<span class="word">Inclusive</span>';
  if (mode === 'complimentary') return '<span class="word">Complimentary</span>';
  return isNum(amount) ? money(amount) : '';
}

function qtyText(qty: any, uom: any): string {
  if (qty == null || qty === '') return '';
  const n = Number(qty);
  const u = String(uom || '').trim();
  const q = isNum(n) ? (Number.isInteger(n) ? String(n) : String(n)) : String(qty);
  if (!u || u === 'nos') return q;
  if (u === 'trip') return `${q.padStart(2, '0')} Trip${n === 1 ? '' : 's'}`;
  return `${q}${u}`;
}

export function idQuoteTotals(quote: Quote) {
  const sections = quote.sections || [];
  const sectionTotals = sections.map((s) =>
    (s.areas || []).reduce(
      (acc, a) =>
        acc +
        (a.items || []).reduce((x, it) => {
          if (it.pricingMode && it.pricingMode !== 'priced') return x;
          const inc = (it.includes || []).reduce((y, i) => y + (i.pricingMode === 'priced' && isNum(i.amount) ? i.amount : 0), 0);
          return x + (isNum(it.amount) ? it.amount : 0) + inc;
        }, 0),
      0,
    ),
  );
  const total = sectionTotals.reduce((a, b) => a + b, 0);
  const feePct = Number(quote.summary?.designFeePct) || 0;
  const designFee = Math.round(total * feePct) / 100;
  const discounts = (quote.summary?.discounts || []).filter((d) => isNum(Number(d.amount)) && Number(d.amount) !== 0);
  const discountTotal = discounts.reduce((a, d) => a + Number(d.amount), 0);
  const grand = total + designFee - discountTotal;
  return { sectionTotals, total, feePct, designFee, discounts, discountTotal, grand };
}

export function renderIdQuotationBody(data: any, organization: any): string {
  const quote: Quote = data?.quote || {};
  const h = quote.header || {};
  const org = organization || {};
  const t = idQuoteTotals(quote);
  const docNumber = h.contractNo || data?.documentInfo?.documentNumber || data?.name || '';

  const brand = `
  <div class="brand">
    <div>${org.logo ? `<img src="${escapeHtml(org.logo)}" alt="" />` : `<b style="font-size:16px;">${escapeHtml(org.name || '')}</b>`}</div>
    <div class="co">
      <b>${escapeHtml(org.name || '')}</b><br/>
      ${org.registrationNumber ? `UEN ${escapeHtml(org.registrationNumber)}<br/>` : ''}
      ${org.address ? `${escapeHtml(org.address)}<br/>` : ''}
      ${org.phoneNumber ? `Tel: ${escapeHtml(org.phoneNumber)}` : ''}
    </div>
  </div>`;

  const row = (k: string, v: any) => `<div class="row"><span class="k">${escapeHtml(k)}</span><span class="v">${escapeHtml(v ?? '') || '&nbsp;'}</span></div>`;
  const header = `
  <h1>${escapeHtml(h.title || 'RE: Letter of Intent & Appointment for Renovation Works at the below mentioned new address')}</h1>
  <div class="hdr">
    <div>
      ${row('Client', h.clientName)}
      ${row('NRIC No', h.nric || '-')}
      ${row('Address', h.address)}
      ${row('Contact', h.contact)}
    </div>
    <div>
      ${row('Contract Number', docNumber)}
      ${row('Agreement Date', h.agreementDate ? formatDate(h.agreementDate) : '')}
      ${row('Remarks', h.remarks)}
      ${row('Designer', h.designer)}
      ${row('Payment Terms', h.paymentTerms || 'As Mentioned Below')}
    </div>
  </div>`;

  // ── lines ───────────────────────────────────────────────────────────────
  const rows: string[] = [];
  (quote.sections || []).forEach((s, si) => {
    rows.push(
      `<tr class="section"><td colspan="4"><span class="letter">${escapeHtml(s.letter || '')}</span>${escapeHtml(s.title || '')}</td></tr>`,
    );
    for (const n of s.notes || []) rows.push(`<tr class="note"><td></td><td colspan="3">* ${escapeHtml(n)}</td></tr>`);
    let no = 0;
    for (const a of s.areas || []) {
      if (a.name && a.name !== 'General') rows.push(`<tr class="area"><td></td><td colspan="3">${escapeHtml(a.name)}</td></tr>`);
      for (const it of a.items || []) {
        no += 1;
        rows.push(
          `<tr class="item"><td class="no">${no}</td><td class="desc">${escapeHtml(it.description || '')}</td><td class="qty">${escapeHtml(qtyText(it.qty, it.uom))}</td><td class="amt">${amountCell(it.pricingMode, it.amount)}</td></tr>`,
        );
        for (const inc of it.includes || []) {
          const incAmt = inc.pricingMode === 'priced' ? amountCell('priced', inc.amount) : inc.pricingMode === 'inclusive' ? amountCell('inclusive', null) : '';
          rows.push(
            `<tr class="inc"><td></td><td class="desc">${escapeHtml(inc.text || '')}</td><td class="qty">${inc.qty != null && inc.qty !== 1 ? escapeHtml(String(inc.qty)) : ''}</td><td class="amt">${incAmt}</td></tr>`,
          );
        }
      }
    }
    rows.push(`<tr class="subtotal"><td></td><td colspan="2" class="lbl">Sub Total — ${escapeHtml(s.title || '')}</td><td class="amt">${money(t.sectionTotals[si] || 0)}</td></tr>`);
  });

  const table = `
  <table class="lines">
    <thead><tr><th style="text-align:right;">#</th><th>Description</th><th style="text-align:center;">Quantity</th><th style="text-align:right;">Amount (S$)</th></tr></thead>
    <tbody>${rows.join('')}</tbody>
  </table>`;

  // ── totals ──────────────────────────────────────────────────────────────
  const totals = `
  <div class="totals"><table>
    <tr><td>Total Amount</td><td class="v">${money(t.total)}</td></tr>
    ${t.feePct > 0 ? `<tr><td>Professional Design Fee ${escapeHtml(String(t.feePct))}%</td><td class="v">${money(t.designFee)}</td></tr>` : ''}
    ${t.discounts.map((d) => `<tr><td>${escapeHtml(d.label || 'Discount')}</td><td class="v">(${money(Number(d.amount))})</td></tr>`).join('')}
    <tr class="grand"><td>Grand Total</td><td class="v">S$ ${money(t.grand)}</td></tr>
  </table></div>`;

  // ── terms ───────────────────────────────────────────────────────────────
  const pay = quote.terms?.paymentTerms || [];
  const clauses = quote.terms?.clauses || [];
  const terms =
    pay.length || clauses.length
      ? `
  <div class="terms">
    <h2>GENERAL TERMS &amp; CONDITIONS (without prejudice)</h2>
    ${pay.length ? `<h3>Payment Terms for Renovation contract</h3><div class="pay">${pay.map((p) => `<div>${escapeHtml(p)}</div>`).join('')}</div>` : ''}
    ${clauses.length ? `<ol>${clauses.map((c) => `<li>${escapeHtml(c)}</li>`).join('')}</ol>` : ''}
  </div>`
      : '';

  // Client e-signature (set by the public /sign/<token> flow) — the image sits
  // above the acceptance line, with the signer's name and timestamp.
  const cs: any = data?.clientSignature || quote?.clientSignature || null;
  const safeImg = cs?.image && /^data:image\/(png|jpeg);base64,[A-Za-z0-9+/=]+$/.test(cs.image) ? cs.image : null;
  const signedOn = cs?.signedAt ? formatDate(cs.signedAt) : '';
  const clientBlock = cs
    ? `${safeImg ? `<img src="${safeImg}" alt="signature" style="max-height:56px;max-width:220px;display:block;margin-bottom:2px;" />` : ''}
       <div class="line">Agreed &amp; accepted by client</div>
       <b>${escapeHtml(cs.name || h.clientName || '')}</b><br/>Date: ${escapeHtml(signedOn)} <span style="color:#666;font-size:10.5px;">(signed electronically)</span>`
    : `<div class="line">Agreed &amp; accepted by client</div>
       ${escapeHtml(h.clientName || '')}<br/>Date: ______________________`;

  const ds: any = data?.designerSignature || quote?.designerSignature || null;
  const dsImg = ds?.image && /^data:image\/(png|jpeg);base64,[A-Za-z0-9+/=]+$/.test(ds.image) ? ds.image : null;
  const preparedBlock = ds
    ? `${dsImg ? `<img src="${dsImg}" alt="signature" style="max-height:56px;max-width:220px;display:block;margin-bottom:2px;" />` : ''}
       <div class="line">Prepared by</div>
       <b>${escapeHtml(ds.name || h.designer || '')}</b>${h.designerPhone ? `<br/>${escapeHtml(h.designerPhone)}` : ''}<br/>
       ${escapeHtml(org.name || '')}<br/>Date: ${ds.signedAt ? escapeHtml(formatDate(ds.signedAt)) : ''}`
    : `<div class="line">Prepared by</div>
      <b>${escapeHtml(h.designer || '')}</b>${h.designerPhone ? `<br/>${escapeHtml(h.designerPhone)}` : ''}<br/>
      ${escapeHtml(org.name || '')}<br/>Director`;

  const sign = `
  <div class="sign">
    <div class="blk">
      ${preparedBlock}
    </div>
    <div class="blk">
      ${clientBlock}
    </div>
  </div>`;

  return `${CSS}<div class="idq">${brand}${header}${table}${totals}${sign}${terms}</div>`;
}
