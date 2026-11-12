/**
 * WCT "Vehicle / Lorry Usage & Repair Form" (enableWctVehicles, 2026-11-12):
 * one vehicle's usage log drawn as the paper form, for the PDF / print.
 *
 * A4 landscape. Pages are split here (by row height: a long repair text takes
 * more than one ruled line) so EVERY
 * page repeats the full header (letterhead, title, the vehicle block) with its
 * own "Page No : n of m"; the last page is padded with empty ruled rows so it
 * reads like the paper form, ready to be filled in by hand.
 */

const S3_PREFIX = process.env.S3_PUBLIC_URL ?? 'https://aims-osiris.s3.ap-southeast-1.amazonaws.com/';

/** Ruled lines per page; a row takes one line per ~55 characters of its longest text. */
export const ROWS_PER_PAGE = 12;
const LINE_CHARS = 55;
const rowLines = (u: { repairDetails: string | null; driverName: string }) =>
  Math.min(ROWS_PER_PAGE, Math.max(1, Math.ceil((u.repairDetails ?? '').length / LINE_CHARS), Math.ceil(u.driverName.length / 24)));

/** Rows split into pages by their lines; never an empty page except for an empty log. */
export function paginate<T extends { repairDetails: string | null; driverName: string }>(rows: T[]): Array<{ rows: T[]; spare: number }> {
  const pages: Array<{ rows: T[]; used: number }> = [{ rows: [], used: 0 }];
  for (const r of rows) {
    const need = rowLines(r);
    let page = pages[pages.length - 1];
    if (page.rows.length && page.used + need > ROWS_PER_PAGE) pages.push((page = { rows: [], used: 0 }));
    page.rows.push(r);
    page.used += need;
  }
  return pages.map((p) => ({ rows: p.rows, spare: Math.max(0, ROWS_PER_PAGE - p.used) }));
}

export type VehicleLogOrg = { name: string; logo?: string | null; address?: string | null; phoneNumber?: string | null; email?: string | null; registrationNumber?: string | null };

export type VehicleLogInput = {
  org: VehicleLogOrg;
  vehicle: { vehicleNo: string; model: string | null; coeExpiry: string | null; lifespanExpiry: string | null };
  /** Oldest first, as the paper is filled. Dates YYYY-MM-DD. */
  usages: Array<{
    driverName: string;
    startDate: string;
    startMileage: number;
    endDate: string | null;
    endMileage: number | null;
    repairDetails: string | null;
    repairApprovedBy: string | null;
    repairApprovedAt: string | null;
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
  h1 { font-size: 15px; text-align: center; margin: 8px 0 6px; letter-spacing: .5px; }
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
  .foot { display: flex; justify-content: space-between; font-size: 9px; color: #444; margin-top: 4px; }
`;

const COLS = `
  <colgroup>
    <col style="width:4%"><col style="width:14%"><col style="width:9%"><col style="width:9%">
    <col style="width:9%"><col style="width:9%"><col style="width:24%"><col style="width:12%"><col style="width:10%">
  </colgroup>`;

const HEAD = `
  <tr>
    <th>No.</th><th>Assigned Driver</th><th>Usage Start Date</th><th>Mileage at Start (km)</th>
    <th>Usage End Date</th><th>Mileage at End (km)</th><th>Damage / Issue / Repair Details</th>
    <th>Repair Approved By</th><th>Repair Approved Date</th>
  </tr>`;

export function buildVehicleLogHtml(input: VehicleLogInput): string {
  const { org, vehicle, usages } = input;
  const split = paginate(usages);
  const pages = split.length;
  const logo = url(org.logo);
  const contact = [org.phoneNumber ? `Tel: ${org.phoneNumber}` : '', org.email ? `Email: ${org.email}` : ''].filter(Boolean).join('  ·  ');

  const body: string[] = [];
  let no = 0;
  for (let p = 0; p < pages; p++) {
    const slice = split[p].rows;
    const rows = slice.map(
      (u) => `<tr>
        <td class="c">${++no}</td>
        <td>${esc(u.driverName)}</td>
        <td class="c">${paperDate(u.startDate)}</td>
        <td class="r">${km(u.startMileage)}</td>
        <td class="c">${paperDate(u.endDate)}</td>
        <td class="r">${km(u.endMileage)}</td>
        <td>${esc(u.repairDetails)}</td>
        <td>${esc(u.repairApprovedBy)}</td>
        <td class="c">${paperDate(u.repairApprovedAt)}</td>
      </tr>`,
    );
    // Blank ruled rows: the form stays fillable by hand.
    for (let i = 0; i < split[p].spare; i++) rows.push(`<tr>${'<td></td>'.repeat(9)}</tr>`);
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
      <h1>VEHICLE / LORRY USAGE &amp; REPAIR FORM</h1>
      <div class="veh">
        <div><b>Vehicle / Lorry No. :</b> ${esc(vehicle.vehicleNo)}</div>
        <div><b>Model :</b> ${esc(vehicle.model)}</div>
        <div><b>COE Expiry Date :</b> ${paperDate(vehicle.coeExpiry)}</div>
        <div><b>Vehicle Lifespan Expiry Date :</b> ${paperDate(vehicle.lifespanExpiry)}</div>
      </div>
      <table>${COLS}<thead>${HEAD}</thead><tbody>${rows.join('')}</tbody></table>
      <div class="foot"><span>${esc(vehicle.vehicleNo)} usage log</span><span>This is a computer-generated document.</span></div>
    </section>`);
  }
  return `<!doctype html><html><head><meta charset="utf-8"><title>${esc(vehicle.vehicleNo)} usage log</title><style>${STYLE}</style></head><body>${body.join('')}</body></html>`;
}
