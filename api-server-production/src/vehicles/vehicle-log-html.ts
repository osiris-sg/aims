/**
 * WCT vehicle LOG BOOK in the paper "Vehicle / Lorry Usage & Repair Form" layout (enableWctVehicles, 2026-11-12; log entries 2026-11-16):
 * one vehicle's log entries drawn as the paper form, for the PDF / print, with the grand total on the last page.
 *
 * A4 landscape. Pages are split here (by row height: a long repair text takes
 * more than one ruled line) so EVERY
 * page repeats the full header (letterhead, title, the vehicle block) with its
 * own "Page No : n of m"; the last page is padded with empty ruled rows so it
 * reads like the paper form, ready to be filled in by hand.
 */

const S3_PREFIX = process.env.S3_PUBLIC_URL ?? 'https://aims-osiris.s3.ap-southeast-1.amazonaws.com/';

/** Ruled lines per page; a row takes one line per ~60 characters of its longest text. */
export const ROWS_PER_PAGE = 12;
const LINE_CHARS = 60;
const rowLines = (u: { details: string | null; driverName: string | null }) =>
  Math.min(ROWS_PER_PAGE, Math.max(1, Math.ceil((u.details ?? '').length / LINE_CHARS), Math.ceil((u.driverName ?? '').length / 22)));

/** Rows split into pages by their lines; never an empty page except for an empty log. */
export function paginate<T extends { details: string | null; driverName: string | null }>(rows: T[]): Array<{ rows: T[]; spare: number }> {
  const pages: Array<{ rows: T[]; used: number }> = [{ rows: [], used: 0 }];
  for (const r of rows) {
    const need = rowLines(r);
    let page = pages[pages.length - 1];
    if (page.rows.length && page.used + need > ROWS_PER_PAGE) pages.push((page = { rows: [], used: 0 }));
    page.rows.push(r);
    page.used += need;
  }
  // The last page keeps a line for the grand total.
  const last = pages[pages.length - 1];
  if (last.rows.length && last.used + 1 > ROWS_PER_PAGE) pages.push({ rows: [], used: 0 });
  return pages.map((p, i) => ({ rows: p.rows, spare: Math.max(0, ROWS_PER_PAGE - p.used - (i === pages.length - 1 ? 1 : 0)) }));
}

export type VehicleLogOrg = { name: string; logo?: string | null; address?: string | null; phoneNumber?: string | null; email?: string | null; registrationNumber?: string | null };

export type VehicleLogInput = {
  org: VehicleLogOrg;
  vehicle: { vehicleNo: string; model: string | null; coeExpiry: string | null; lifespanExpiry: string | null };
  /** "Type: Fuel · From 2026-01-01" when the page's filters are on; printed under the title. */
  filterLine?: string | null;
  /** Oldest first, as the paper is filled. Dates YYYY-MM-DD. */
  entries: Array<{
    date: string;
    type: string;
    details: string | null;
    driverName: string | null;
    mileage: number | null;
    amount: number | null;
    approvedBy: string | null;
    approvedAt: string | null;
  }>;
  printedOn: string; // YYYY-MM-DD
};

const esc = (v: unknown): string =>
  v == null ? '' : String(v).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

const url = (key: unknown): string => {
  const k = String(key ?? '').trim();
  if (!k) return '';
  return /^(data:|https?:\/\/)/i.test(k) ? k : `${S3_PREFIX}${k}`;
};

/** dd/mm/yyyy, the paper's date form. */
export const paperDate = (v: string | null | undefined): string => {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(v ?? '');
  return m ? `${m[3]}/${m[2]}/${m[1]}` : '';
};

const km = (n: number | null | undefined) => (n == null ? '' : `${n.toLocaleString('en-SG')}`);
export const money = (n: number | null | undefined) => (n == null ? '' : n.toLocaleString('en-SG', { minimumFractionDigits: 2, maximumFractionDigits: 2 }));

const STYLE = `
  @page { size: A4 landscape; margin: 0; }
  * { box-sizing: border-box; }
  body { margin: 0; font-family: Arial, Helvetica, sans-serif; color: #111; font-size: 11px; }
  .page { width: 297mm; height: 210mm; padding: 10mm 12mm; display: flex; flex-direction: column; page-break-after: always; break-after: page; overflow: hidden; }
  .page:last-child { page-break-after: auto; break-after: auto; }
  .lh { display: flex; align-items: center; gap: 12px; border-bottom: 2px solid #111; padding-bottom: 6px; }
  .lh img { max-height: 46px; max-width: 160px; object-fit: contain; }
  .lh .co { font-weight: 700; font-size: 14px; letter-spacing: .3px; }
  .lh .sub { font-size: 10px; color: #333; line-height: 1.4; }
  .lh .pg { margin-left: auto; text-align: right; font-size: 10px; white-space: nowrap; }
  h1 { font-size: 15px; text-align: center; margin: 8px 0 4px; letter-spacing: .5px; }
  .flt { text-align: center; font-size: 10px; color: #333; margin-bottom: 4px; }
  .veh { display: grid; grid-template-columns: 1fr 1fr; border: 1px solid #111; margin-bottom: 6px; }
  .veh div { padding: 5px 8px; border-bottom: 1px solid #111; display: flex; gap: 8px; }
  .veh div:nth-child(odd) { border-right: 1px solid #111; }
  .veh div:nth-last-child(-n+2) { border-bottom: 0; }
  .veh b { white-space: nowrap; }
  table { width: 100%; border-collapse: collapse; table-layout: fixed; flex: 1; }
  th, td { border: 1px solid #111; padding: 4px 5px; vertical-align: top; }
  th { background: #eee; font-size: 10px; text-align: center; }
  td { height: 9.6mm; font-size: 10.5px; word-wrap: break-word; }
  td.c { text-align: center; } td.r { text-align: right; }
  tr.tot td { font-weight: 700; border-top: 3px double #111; }
  .foot { display: flex; justify-content: space-between; font-size: 9px; color: #444; margin-top: 4px; }
`;

const COLS = `
  <colgroup>
    <col style="width:4%"><col style="width:9%"><col style="width:13%"><col style="width:27%">
    <col style="width:12%"><col style="width:8%"><col style="width:9%"><col style="width:10%"><col style="width:8%">
  </colgroup>`;

const HEAD = `
  <tr>
    <th>No.</th><th>Date</th><th>Type</th><th>Details</th><th>Driver</th>
    <th>Mileage (km)</th><th>Amount (SGD)</th><th>Repair Approved By</th><th>Repair Approved Date</th>
  </tr>`;

export function buildVehicleLogHtml(input: VehicleLogInput): string {
  const { org, vehicle, entries } = input;
  const split = paginate(entries);
  const pages = split.length;
  const logo = url(org.logo);
  const contact = [org.phoneNumber ? `Tel: ${org.phoneNumber}` : '', org.email ? `Email: ${org.email}` : ''].filter(Boolean).join('  ·  ');
  const total = Math.round(entries.reduce((t, e) => t + (e.amount ?? 0), 0) * 100) / 100;

  const body: string[] = [];
  let no = 0;
  for (let p = 0; p < pages; p++) {
    const slice = split[p].rows;
    const rows = slice.map(
      (u) => `<tr>
        <td class="c">${++no}</td>
        <td class="c">${paperDate(u.date)}</td>
        <td>${esc(u.type)}</td>
        <td>${esc(u.details)}</td>
        <td>${esc(u.driverName)}</td>
        <td class="r">${km(u.mileage)}</td>
        <td class="r">${money(u.amount)}</td>
        <td>${esc(u.approvedBy)}</td>
        <td class="c">${paperDate(u.approvedAt)}</td>
      </tr>`,
    );
    // Blank ruled rows: the form stays fillable by hand.
    for (let i = 0; i < split[p].spare; i++) rows.push(`<tr>${'<td></td>'.repeat(9)}</tr>`);
    // Grand total on the last page (double-ruled).
    if (p === pages - 1) rows.push(`<tr class="tot"><td colspan="6" class="r">TOTAL</td><td class="r">${money(total)}</td><td></td><td></td></tr>`);
    body.push(`<section class="page">
      <div class="lh">
        ${logo ? `<img src="${esc(logo)}" alt="" />` : ''}
        <div>
          <div class="co">${esc(org.name.toUpperCase())}</div>
          ${org.address ? `<div class="sub">${esc(org.address)}</div>` : ''}
          ${contact ? `<div class="sub">${esc(contact)}</div>` : ''}
          ${org.registrationNumber ? `<div class="sub">UEN: ${esc(org.registrationNumber)}</div>` : ''}
        </div>
        <div class="pg">Date : ${paperDate(input.printedOn)}<br/>Page No : ${p + 1} of ${pages}</div>
      </div>
      <h1>VEHICLE / LORRY LOG BOOK</h1>
      ${input.filterLine ? `<div class="flt">${esc(input.filterLine)}</div>` : ''}
      <div class="veh">
        <div><b>Vehicle / Lorry No. :</b> ${esc(vehicle.vehicleNo)}</div>
        <div><b>Model :</b> ${esc(vehicle.model)}</div>
        <div><b>COE Expiry Date :</b> ${paperDate(vehicle.coeExpiry)}</div>
        <div><b>Vehicle Lifespan Expiry Date :</b> ${paperDate(vehicle.lifespanExpiry)}</div>
      </div>
      <table>${COLS}<thead>${HEAD}</thead><tbody>${rows.join('')}</tbody></table>
      <div class="foot"><span>${esc(vehicle.vehicleNo)} log book</span><span>This is a computer-generated document.</span></div>
    </section>`);
  }
  return `<!doctype html><html><head><meta charset="utf-8"><title>${esc(vehicle.vehicleNo)} log book</title><style>${STYLE}</style></head><body>${body.join('')}</body></html>`;
}
