/**
 * Variation Order (interior-design orgs) — print layout mirroring CIEL
 * INTERIOR's VO Excel sheet: client/contract header → "Additional Items"
 * (numbered, amount or Complimentary) with subtotal → "Removal of Items"
 * with subtotal → payment-schedule status panel + consolidation block
 * (latest quantum + additions − deductions = new quantum, collected,
 * balance payable) → acknowledgment signature block.
 *
 * Data: Document.config for a type VARIATION_ORDER doc —
 *   { templateVariant:'ID_VO', voNumber, contractNo, client:{...},
 *     vo:{ additions:[{description,amount,complimentary}], removals:[...] },
 *     consolidation:{ previousQuantum, additions, removals, newQuantum,
 *                     collected, balance, schedule:[{label,collected}] } }
 * The editor recomputes `consolidation` on every save so a printed draft is
 * as current as the project was at the last save.
 */
import { escapeHtml, formatDate, money } from './shared';

type VoLine = { description?: string; amount?: number | null; complimentary?: boolean };

const CSS = `
<style>
  .idvo { font-size: 12.5px; color: #111; }
  .idvo .brand { display:flex; justify-content:space-between; align-items:flex-start; margin-bottom: 14px; padding-bottom: 10px; border-bottom: 2px solid #111; }
  .idvo .brand img { max-height: 46px; max-width: 200px; object-fit: contain; }
  .idvo .brand .co { text-align:right; font-size: 11.5px; line-height: 1.45; color:#333; }
  .idvo .brand .co b { font-size: 14px; color:#111; letter-spacing:.3px; }
  .idvo .top { display:flex; justify-content:space-between; align-items:flex-start; margin-bottom: 14px; }
  .idvo .hdr .row { display:flex; font-size: 12.5px; line-height: 1.6; }
  .idvo .hdr .row .k { width: 128px; color:#555; flex: 0 0 128px; }
  .idvo .hdr .row .v { font-weight: 600; }
  .idvo .vo-title { font-size: 20px; font-weight: 800; letter-spacing: 1px; text-align:right; }
  .idvo .vo-no { text-align:right; color:#555; font-size: 12px; margin-top: 2px; }
  .idvo h2.grp { font-size: 13px; margin: 16px 0 6px; text-align:center; letter-spacing:.4px; }
  .idvo table.lines { width:100%; border-collapse: collapse; }
  .idvo table.lines td { padding: 4px 6px; vertical-align: top; font-size: 12.5px; line-height: 1.45; }
  .idvo td.no { width: 30px; color:#555; text-align:right; padding-right: 8px; }
  .idvo td.amt { width: 110px; text-align:right; white-space: nowrap; font-variant-numeric: tabular-nums; }
  .idvo .word { font-weight: 600; font-style: italic; color:#333; }
  .idvo tr.subtotal td { border-top: 1px solid #bbb; font-weight: 700; padding-top: 6px; }
  .idvo tr.subtotal td.lbl { text-align:right; color:#444; font-size: 11.5px; text-transform: uppercase; letter-spacing:.5px; }
  .idvo .panels { display:flex; gap: 28px; margin-top: 22px; page-break-inside: avoid; }
  .idvo .panel { flex:1; }
  .idvo .panel h3 { font-size: 12px; margin: 0 0 6px; letter-spacing:.4px; text-transform: uppercase; }
  .idvo table.kv { width:100%; border-collapse: collapse; }
  .idvo table.kv td { padding: 3px 6px; font-size: 12px; }
  .idvo table.kv td.v { text-align:right; font-variant-numeric: tabular-nums; white-space:nowrap; font-weight: 600; }
  .idvo table.kv tr.grand td { border-top: 2px solid #111; font-weight: 800; padding-top: 6px; }
  .idvo .stat { font-weight: 700; letter-spacing:.5px; font-size: 11px; }
  .idvo .stat.ok { color: #1b7f3b; }
  .idvo .stat.pending { color: #b06f00; }
  .idvo .ack { margin-top: 30px; page-break-inside: avoid; }
  .idvo .ack h3 { font-size: 12.5px; margin-bottom: 26px; }
  .idvo .sign { display:flex; justify-content:space-between; }
  .idvo .sign .blk { width: 45%; font-size: 12px; line-height: 1.5; }
  .idvo .sign .line { border-top: 1px solid #111; margin-top: 44px; padding-top: 4px; color:#444; font-size: 11px; }
</style>`;

const isNum = (v: any): v is number => typeof v === 'number' && isFinite(v);
const amt = (l: VoLine): string => (l.complimentary || !isNum(Number(l.amount)) || l.amount == null ? '<span class="word">Complimentary</span>' : money(Number(l.amount)));
const sumLines = (list: VoLine[] | undefined): number => (Array.isArray(list) ? list : []).reduce((s, l) => s + (l.complimentary ? 0 : Number(l.amount) || 0), 0);

function linesTable(title: string, list: VoLine[] | undefined, subtotalLabel: string): string {
  const rows = (Array.isArray(list) ? list : [])
    .map((l, i) => `<tr><td class="no">${i + 1}</td><td>${escapeHtml(l.description || '')}</td><td class="amt">${amt(l)}</td></tr>`)
    .join('');
  return `
  <h2 class="grp">${escapeHtml(title)}</h2>
  <table class="lines">
    <tbody>
      ${rows || '<tr><td class="no"></td><td style="color:#888;font-style:italic;">None</td><td class="amt"></td></tr>'}
      <tr class="subtotal"><td></td><td class="lbl">${escapeHtml(subtotalLabel)}</td><td class="amt">${money(sumLines(list))}</td></tr>
    </tbody>
  </table>`;
}

export function renderIdVoBody(data: any, organization: any): string {
  const org = organization || {};
  const client = data?.client || {};
  const vo = data?.vo || {};
  const cons = data?.consolidation || null;
  const additions = sumLines(vo.additions);
  const removals = sumLines(vo.removals);

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
  const top = `
  <div class="top">
    <div class="hdr">
      ${row('Homeowner', client.name)}
      ${row('Project Address', client.address)}
      ${row('Contract Number', data?.contractNo || data?.documentInfo?.documentNumber || '')}
      ${row('Agreement Date', client.agreementDate ? formatDate(client.agreementDate) : '')}
    </div>
    <div>
      <div class="vo-title">VARIATION ORDER</div>
      <div class="vo-no">${escapeHtml(data?.name || (data?.voNumber ? `VO${data.voNumber}` : ''))}${vo.confirmedAt ? ` · ${formatDate(vo.confirmedAt)}` : ''}</div>
    </div>
  </div>`;

  const schedule = Array.isArray(cons?.schedule) && cons.schedule.length
    ? `
  <div class="panel">
    <h3>Payment Schedule</h3>
    <table class="kv">
      ${cons.schedule.map((m: any) => `<tr><td>${escapeHtml(m.label || '')}</td><td class="v"><span class="stat ${m.collected ? 'ok' : 'pending'}">${m.collected ? 'COLLECTED' : 'PENDING'}</span></td></tr>`).join('')}
    </table>
  </div>`
    : '';

  const consolidation = `
  <div class="panel">
    <h3>Consolidation</h3>
    <table class="kv">
      <tr><td>Total Quantum As Per Latest Revised Quotation:</td><td class="v">${money(cons?.previousQuantum ?? 0)}</td></tr>
      <tr><td>Total Additional Items:</td><td class="v">${money(cons?.additions ?? additions)}</td></tr>
      <tr><td>Total Deducted Items:</td><td class="v">(${money(cons?.removals ?? removals)})</td></tr>
      <tr class="grand"><td>New Project Quantum As Of This Variation Order:</td><td class="v">S$ ${money(cons?.newQuantum ?? (cons?.previousQuantum ?? 0) + additions - removals)}</td></tr>
      <tr><td>Total Amount Collected To Date:</td><td class="v">${money(cons?.collected ?? 0)}</td></tr>
      <tr class="grand"><td>Balance Payable to Company:</td><td class="v">S$ ${money(cons?.balance ?? 0)}</td></tr>
    </table>
  </div>`;

  const ack = `
  <div class="ack">
    <h3>Acknowledgment</h3>
    <div class="sign">
      <div class="blk">
        <div class="line">Prepared by</div>
        <b>${escapeHtml(data?.designer || '')}</b><br/>
        ${escapeHtml(org.name || '')}
      </div>
      <div class="blk">
        <div class="line">Agreed &amp; accepted by client</div>
        ${escapeHtml(client.name || '')}<br/>Date: ______________________
      </div>
    </div>
  </div>`;

  return `${CSS}
  <div class="idvo">
    ${brand}
    ${top}
    ${linesTable('Additional Items', vo.additions, 'Subtotal')}
    ${linesTable('Removal of Items', vo.removals, 'Subtotal')}
    <div class="panels">${schedule}${consolidation}</div>
    ${ack}
  </div>`;
}
