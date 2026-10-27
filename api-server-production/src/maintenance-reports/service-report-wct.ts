/**
 * WCT (S) Systems SERVICE REPORT — the paper (report #012392, 12 pages) as
 * HTML for Puppeteer, and the same HTML for the office page's preview and the
 * field app's print. One renderer, so every copy of a report is the same
 * document (the DO/quotation/invoice follow the same rule in document-html/wct.ts).
 *
 * Page shape:
 *   letterhead (logo · company block · accreditation line) over a red rule —
 *   REPEATED ON EVERY PAGE (outer table thead, which Chromium repeats)
 *   p1  "#012392" · SERVICE REPORT · Company / Location box · Date of
 *       Servicing · "Type of Service/Job –" tick table (Chemical Degreasing |
 *       De-Dusting Work, then Additions and Alterations Work) · remarks
 *   p2  the cover letter, contacts, Mission / Vision / Drive, signatory
 *   p3… one page per photo section: Unit Location, each equipment's Before /
 *       After grid with its ✓ work lines, Area Cleaning
 *   then the SCDF / NEA advisory, the cleaning-frequency table and the closing
 *   lines (English + Chinese).
 *   "Page n of N" and the TEL / WEBSITE / EMAIL / ADDRESS line come from
 *   Puppeteer's footer (wctServicePdfOptions) — only the print engine knows
 *   the page count.
 */

import {
  WCT_ADVISORY,
  WCT_CLOSING,
  WCT_CONTACTS,
  WCT_COVER_LETTER,
  WCT_FREQUENCY,
  WCT_JOB_TYPE_GROUPS,
  WCT_SIGNATORY,
  WCT_VALUES,
  wctLineTicked,
  wctReportNumber,
  wctScopeSentence,
  wctSectionsFor,
  type WctPhotoSection,
  type WctSectionResult,
  type WctServiceData,
} from './msr-templates';

const S3_PREFIX = process.env.S3_PUBLIC_URL ?? 'https://aims-osiris.s3.ap-southeast-1.amazonaws.com/';

const esc = (v: unknown): string =>
  v == null
    ? ''
    : String(v).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

const url = (key: unknown): string => {
  const k = String(key ?? '').trim();
  if (!k) return '';
  return /^(data:|https?:\/\/)/i.test(k) ? k : `${S3_PREFIX}${k}`;
};

/** dd/mm/yyyy — the paper's date form. Accepts ISO dates and Date strings. */
const paperDate = (v: unknown): string => {
  if (!v) return '';
  const s = String(v);
  const iso = /^(\d{4})-(\d{2})-(\d{2})/.exec(s);
  if (iso) return `${iso[3]}/${iso[2]}/${iso[1]}`;
  const d = new Date(s);
  if (Number.isNaN(d.getTime())) return s;
  const p = (n: number) => String(n).padStart(2, '0');
  return `${p(d.getDate())}/${p(d.getMonth() + 1)}/${d.getFullYear()}`;
};

/** Letterhead + footer fields, read from the owning Organization row. */
export interface WctOrgProfile {
  name: string;
  address?: string | null;
  phoneNumber?: string | null;
  email?: string | null;
  website?: string | null;
  registrationNumber?: string | null;
  logo?: string | null;
}

export interface WctServiceReportInput {
  reportNumber: number | null;
  technicianName: string | null;
  serviceData: {
    customerName?: string | null;
    jobLocation?: string | null;
    serviceDate?: string | null;
    remarks?: string | null;
    wct?: WctServiceData | null;
  } | null;
  org: WctOrgProfile;
}

const CSS = `
  * { margin: 0; padding: 0; box-sizing: border-box; }
  body { font-family: Calibri, Carlito, Arial, sans-serif; font-size: 12.5px; color: #000; background: #fff; line-height: 1.35; }
  /* On SCREEN (the office page's and the field app's iframe) nothing else
     supplies the page margins the PDF gets from Puppeteer, so the paper hugged
     the edges (guru 2026-10-27). Print / PDF keep their own margins. */
  @media screen { body { padding: 12mm 14mm; } }
  table.sheet { width: 100%; border-collapse: collapse; }
  table.sheet > thead { display: table-header-group; }
  table.sheet > thead > tr > td, table.sheet > tbody > tr > td { padding: 0; border: none; vertical-align: top; }
  .lh { display: flex; align-items: flex-start; gap: 16px; padding-bottom: 4px; border-bottom: 2px solid #d12a1e; margin-bottom: 10px; }
  .lh img.logo { max-height: 70px; max-width: 220px; object-fit: contain; display: block; }
  .lh .co { flex: 1; font-size: 11px; line-height: 1.45; }
  .lh .co .nm { color: #d12a1e; font-weight: 700; font-size: 12.5px; }
  .lh .co a { color: #000; text-decoration: underline; }
  .lh .acc { font-size: 9px; color: #444; text-align: right; line-height: 1.3; align-self: center; white-space: nowrap; }
  .lh .acc b { display: block; font-size: 12px; color: #000; }
  .pg { page-break-before: always; break-before: page; }
  .no { text-align: right; font-weight: 700; font-size: 15px; margin: 2px 0 8px; }
  .title { text-align: center; font-weight: 700; font-size: 15.5px; letter-spacing: .3px; margin-bottom: 14px; }
  .client { border: 2px dashed #e07c2e; padding: 6px 10px; display: grid; grid-template-columns: 96px 1fr; row-gap: 2px; font-size: 15px; margin-bottom: 22px; }
  .client .k { font-weight: 400; }
  .client .k::after { content: " :"; }
  .client .v { color: #333; }
  .dos { font-size: 15px; margin: 6px 0 26px; }
  .dos b { font-weight: 400; }
  .jt-head { font-size: 15px; margin-bottom: 8px; }
  table.jt { width: 100%; border-collapse: collapse; table-layout: fixed; }
  table.jt th, table.jt td { border: 1px solid #999; padding: 3px 6px; vertical-align: top; font-size: 13px; }
  table.jt th { font-weight: 400; text-align: center; text-decoration: underline; padding: 5px 6px; }
  table.jt th.band { text-decoration: underline; }
  table.jt td.mk { width: 48px; text-align: center; vertical-align: middle; }
  table.jt td.lbl .sub { padding-left: 4px; }
  table.jt td.lbl .sub::before { content: "-  "; }
  table.jt td.lbl .note { color: #d12a1e; font-style: italic; font-size: 10.5px; }
  .stamp { display: inline-flex; width: 24px; height: 24px; border-radius: 50%; border: 2.5px solid #c0392b; color: #c0392b; align-items: center; justify-content: center; font-weight: 700; font-size: 15px; line-height: 1; background: #fbeae8; }
  .remarks { margin-top: 22px; }
  .remarks .h { font-size: 15px; margin-bottom: 6px; }
  .remarks .box { border: 1px solid #999; min-height: 54px; padding: 6px 8px; white-space: pre-wrap; font-size: 13px; }
  /* cover letter */
  .letter p { margin-bottom: 11px; font-size: 13px; }
  .letter .sal { margin-bottom: 26px; }
  .letter u { text-decoration: underline; }
  .contacts { display: grid; grid-template-columns: 1fr 1fr; column-gap: 24px; row-gap: 6px; font-size: 12.5px; font-style: italic; margin: 6px 0 10px; }
  .contacts a { color: #1a4fd6; }
  .contacts .one { grid-column: 1 / span 2; text-align: center; }
  .values { display: grid; grid-template-columns: 1fr 1fr 1fr; column-gap: 18px; margin: 26px 0 30px; }
  .values .t { text-align: center; font-weight: 700; color: #555; margin-bottom: 6px; font-size: 12px; }
  .values .x { text-align: center; color: #666; font-size: 10px; line-height: 1.5; }
  .signoff { font-size: 13px; margin-top: 8px; }
  .signoff .scr { font-family: "Brush Script MT", "Segoe Script", cursive; font-size: 26px; margin: 10px 0 6px; }
  .signoff .role { font-weight: 700; font-style: italic; margin-bottom: 8px; }
  .signoff .co { color: #d12a1e; font-weight: 700; margin-bottom: 10px; }
  .signoff a { color: #1a4fd6; }
  /* photo pages */
  .sec-h { font-family: "Arial Narrow", Arial, sans-serif; font-size: 15px; margin: 20px 0 20px 36px; }
  .sec-h u { font-weight: 700; text-decoration: underline; }
  .sec { border: 2px dashed #aaa; padding: 6px; margin: 0 36px; }
  .sec .cap { text-align: center; font-family: "Arial Narrow", Arial, sans-serif; font-size: 15px; margin: 2px 0 6px; }
  .sec .tag { display: inline-block; font-family: "Times New Roman", serif; font-weight: 700; font-size: 15px; padding: 0 6px; }
  .sec .tag.before { background: #ffff00; }
  .sec .tag.after { background: #39e62d; }
  .grid { display: grid; grid-template-columns: 1fr 1fr; gap: 6px; margin: 4px 2px; }
  .grid .ph { width: 100%; aspect-ratio: 4 / 3; overflow: hidden; background: #f2f2f2; }
  .grid .ph img { width: 100%; height: 100%; object-fit: cover; display: block; }
  .grid.one { grid-template-columns: 1fr; }
  .grid.one .ph { aspect-ratio: 4 / 3; }
  /* Laid out by how many photos there are (guru 2026-10-27): one sits in the
     middle at reading size, two side by side, three as a pair with the third
     centred underneath, four as a 2×2 block. */
  .grid.n1 { grid-template-columns: minmax(0, 62%); justify-content: center; }
  .grid.n3 .ph:last-child { grid-column: 1 / span 2; width: 50%; justify-self: center; }
  .lines { padding: 6px 8px 2px 28px; font-size: 13.5px; }
  .lines div::before { content: "\\2713  "; }
  .lines div.off { color: #999; }
  .lines div.off::before { content: "\\2610  "; }
  /* advisory */
  .adv-h { font-family: "Arial Narrow", Arial, sans-serif; font-size: 15px; margin-bottom: 10px; }
  .adv-h small { font-size: 10px; }
  .adv { border: 2px dashed #aaa; padding: 10px 14px; margin-bottom: 14px; }
  .adv .ttl { display: inline-block; font-weight: 700; font-size: 17px; padding: 2px 10px; margin-bottom: 8px; }
  .adv .ttl.y { background: #ffff00; }
  .adv .ttl.g { background: #39e62d; }
  .adv ol { padding-left: 22px; font-size: 12.5px; }
  .adv ol li { margin-bottom: 4px; }
  .adv ol li.big { font-size: 15px; font-weight: 700; }
  .adv ul { padding-left: 22px; font-size: 12.5px; list-style: none; }
  .adv ul li::before { content: "\\2713  "; }
  .adv .src { font-size: 10px; color: #555; margin-top: 6px; text-align: right; }
  table.nea { width: 100%; border-collapse: collapse; font-size: 11px; }
  table.nea th, table.nea td { border: 1px solid #c9a227; padding: 3px 6px; }
  table.nea th { background: #ffe08a; text-align: left; }
  table.nea td.f { text-align: center; }
  table.nea tr.hl td { outline: 2px solid #d12a1e; font-weight: 700; }
  /* frequency */
  .frq-h { font-family: "Arial Narrow", Arial, sans-serif; font-size: 15px; margin-bottom: 26px; }
  table.frq { width: 100%; border-collapse: collapse; font-family: "Arial Narrow", Arial, sans-serif; font-size: 14px; }
  table.frq th, table.frq td { border: 1px solid #999; padding: 10px 8px 16px; vertical-align: top; text-align: left; font-weight: 400; }
  table.frq th.c { text-align: center; }
  table.frq td.f { width: 24%; }
  .close { text-align: center; font-size: 15px; margin: 150px 0 40px; line-height: 1.5; }
  .close.zh { font-size: 15.5px; margin-top: 0; }
  .wm { position: relative; }
`;

function letterhead(org: WctOrgProfile): string {
  const logo = url(org.logo);
  const lines = [
    org.address ? esc(org.address) : '',
    [org.phoneNumber ? `Tel : ${esc(org.phoneNumber)}` : '', org.email ? `Email : ${esc(org.email)}` : ''].filter(Boolean).join(' '),
    org.website ? `Website : <a>${esc(org.website)}</a>` : '',
  ].filter(Boolean);
  return `
  <div class="lh">
    ${logo ? `<img class="logo" src="${esc(logo)}" alt="" />` : ''}
    <div class="co"><div class="nm">${esc(org.name).toUpperCase()}</div>${lines.map((l) => `<div>${l}</div>`).join('')}</div>
    ${org.registrationNumber ? `<div class="acc"><b>bizSAFE · BCA</b>Registered<br/>UEN: ${esc(org.registrationNumber)}</div>` : ''}
  </div>`;
}

/** The side-by-side Chemical Degreasing | De-Dusting table and the Additions band. */
function jobTypeTable(ticked: Set<string>): string {
  const [chem, dust, adds] = WCT_JOB_TYPE_GROUPS;
  const stamp = (id: string) => (ticked.has(id) ? '<span class="stamp">&#10003;</span>' : '');
  const cell = (it: { id: string; label: string; sub?: string; note?: string } | undefined) =>
    it
      ? `<td class="lbl">${esc(it.label)}${it.sub ? `<div class="sub">${esc(it.sub)}</div>` : ''}${it.note ? `<div class="note">${esc(it.note)}</div>` : ''}</td><td class="mk">${stamp(it.id)}</td>`
      : '<td class="lbl"></td><td class="mk"></td>';
  const rows = Math.max(chem.items.length, dust.items.length);
  let body = '';
  for (let i = 0; i < rows; i++) body += `<tr>${cell(chem.items[i])}${cell(dust.items[i])}</tr>`;
  const addRows = adds.items.map((it) => `<tr><td class="lbl" colspan="3">${esc(it.label)}</td><td class="mk">${stamp(it.id)}</td></tr>`).join('');
  return `
  <table class="jt">
    <colgroup><col style="width:41%"/><col style="width:9%"/><col style="width:41%"/><col style="width:9%"/></colgroup>
    <thead><tr><th colspan="2">${esc(chem.title)}</th><th colspan="2">${esc(dust.title)}</th></tr></thead>
    <tbody>${body}
      <tr><th class="band" colspan="4">${esc(adds.title)}</th></tr>
      ${addRows}
    </tbody>
  </table>`;
}

function photoGrid(keys: readonly string[] | undefined, single: boolean): string {
  const list = (keys ?? []).filter((k) => typeof k === 'string' && k && !k.startsWith('data:')).slice(0, 4);
  if (!list.length) return `<div class="grid${single ? ' one' : ''}"><div class="ph"></div></div>`;
  const one = single && list.length === 1;
  const cls = `grid${one ? ' one' : ''} n${list.length}`;
  return `<div class="${cls}">${list.map((k) => `<div class="ph"><img src="${esc(url(k))}" alt="" /></div>`).join('')}</div>`;
}

function sectionPage(s: WctPhotoSection, r: WctSectionResult | undefined): string {
  const lines = s.lines.map((l, i) => `<div class="${wctLineTicked(r, i) ? '' : 'off'}">${esc(l)}</div>`).join('');
  const heading = s.subject ? `${esc(s.heading)} <u>${esc(s.subject)}</u> -` : `${esc(s.heading)} -`;
  const body =
    s.mode === 'before-after'
      ? `<div class="cap"><span class="tag before">Before</span></div>${photoGrid(r?.before, false)}
         <div class="cap"><span class="tag after">After</span></div>${photoGrid(r?.after, false)}`
      : s.id === 'UNIT_LOCATION'
        ? `<div class="cap">${esc(s.heading)} -</div>${photoGrid(r?.photos, true)}`
        : photoGrid(r?.photos, true);
  return `
  <div class="pg">
    ${s.id === 'UNIT_LOCATION' ? '<div style="height:70px"></div>' : `<div class="sec-h">${heading}</div>`}
    <div class="sec">${body}<div class="lines">${lines}</div></div>
  </div>`;
}

function coverLetter(jobTypes: readonly string[], org: WctOrgProfile): string {
  const L = WCT_COVER_LETTER;
  const link = (v: string) => (v.includes('@') ? `<a href="mailto:${esc(v)}">${esc(v)}</a>` : `<a href="https://${esc(v)}">${esc(v)}</a>`);
  const contacts = WCT_CONTACTS.map((c, i) =>
    i === WCT_CONTACTS.length - 1
      ? `<div class="one">${esc(c.label)} – ${link(c.value)}</div>`
      : `<div>${esc(c.label)} – ${link(c.value)}</div>`,
  ).join('');
  const values = WCT_VALUES.map((v) => `<div><div class="t">${esc(v.title)}</div><div class="x">${esc(v.text)}</div></div>`).join('');
  return `
  <div class="pg letter">
    <p class="sal">${esc(L.salutation)}</p>
    <p>${esc(L.opening)}</p>
    <p>${esc(L.scheduled).replace('for the date mentioned above', '<b><u>for the date mentioned above</u></b>')}</p>
    <p>${esc(wctScopeSentence(jobTypes))}</p>
    <p>${esc(L.photos)}</p>
    <p>${esc(L.insight)}</p>
    <p>${esc(L.thanks)}</p>
    <p style="margin-top:22px">${esc(L.attention).replace('immediate effect', '<b>immediate effect</b>')}</p>
    <div class="contacts">${contacts}</div>
    <div class="values">${values}</div>
    <div class="signoff">
      <div>${esc(WCT_SIGNATORY.regards)}</div>
      <div class="scr">${esc(WCT_SIGNATORY.name)}</div>
      <div class="role">${esc(WCT_SIGNATORY.title)}</div>
      <div class="co">${esc(org.name).toUpperCase()}</div>
      <div>Email: <a href="mailto:${esc(WCT_SIGNATORY.email)}">${esc(WCT_SIGNATORY.email)}</a> &nbsp;; &nbsp;Website: ${org.website ? `<a href="https://${esc(org.website)}">${esc(org.website)}</a>` : ''}</div>
    </div>
  </div>`;
}

function advisoryPage(): string {
  const A = WCT_ADVISORY;
  const ked = A.ked.points.map((p, i) => `<li class="${i === 2 ? 'big' : ''}">${esc(p)}</li>`).join('');
  const enf = A.enforcement.points.map((p) => `<li>${esc(p)}</li>`).join('');
  const nea = A.nea.rows
    .map(([what, freq]) => `<tr class="${what === A.nea.highlight ? 'hl' : ''}"><td>${esc(what)}</td><td class="f">${esc(freq)}</td></tr>`)
    .join('');
  return `
  <div class="pg">
    <div class="adv-h">${esc(A.heading)} <small>${esc(A.source)}</small></div>
    <div class="adv"><div class="ttl y">${esc(A.ked.title)}</div><ol>${ked}</ol><div class="src">SCDF</div></div>
    <div class="adv"><div class="ttl g">${esc(A.enforcement.title)}</div><ul>${enf}</ul><div class="src">SCDF</div></div>
    <div class="adv">
      <table class="nea"><thead><tr><th>Areas identified</th><th style="text-align:center">Recommended minimum frequency</th></tr></thead><tbody>${nea}</tbody></table>
      <div class="src">NEA</div>
    </div>
  </div>`;
}

function frequencyPage(): string {
  const F = WCT_FREQUENCY;
  const rows = F.rows.map(([k, v]) => `<tr><td>${esc(k)}</td><td class="f">${esc(v)}</td></tr>`).join('');
  return `
  <div class="pg">
    <div class="frq-h">${esc(F.heading)}</div>
    <table class="frq">
      <thead>
        <tr><th class="c" colspan="2">${esc(F.title)}</th></tr>
        <tr><th>${esc(F.columns[0])}</th><th>${esc(F.columns[1])}</th></tr>
      </thead>
      <tbody>${rows}</tbody>
    </table>
    <div class="close">${esc(WCT_CLOSING.en)}</div>
    <div class="close zh">${esc(WCT_CLOSING.zh)}</div>
  </div>`;
}

export function buildWctServiceReportHtml(input: WctServiceReportInput): string {
  const sd = input.serviceData ?? {};
  const wct: WctServiceData = sd.wct ?? { jobTypes: [], sections: {} };
  const ticked = new Set(wct.jobTypes ?? []);
  const sections = wctSectionsFor(wct.jobTypes).map((s) => sectionPage(s, wct.sections?.[s.id]));

  const page1 = `
    <div class="no">${esc(wctReportNumber(input.reportNumber))}</div>
    <div class="title">SERVICE REPORT</div>
    <div class="client">
      <div class="k">Company</div><div class="v">${esc(sd.customerName)}</div>
      <div class="k">Location</div><div class="v">${esc(sd.jobLocation)}</div>
    </div>
    <div class="dos"><b>Date of Servicing :</b> ${esc(paperDate(sd.serviceDate))}</div>
    <div class="jt-head">Type of Service/Job –</div>
    ${jobTypeTable(ticked)}
    ${sd.remarks ? `<div class="remarks"><div class="h">Remarks –</div><div class="box">${esc(sd.remarks)}</div></div>` : ''}`;

  return `<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <title>Service Report ${esc(wctReportNumber(input.reportNumber))}</title>
  <style>${CSS}</style>
</head>
<body>
  <table class="sheet">
    <thead><tr><td>${letterhead(input.org)}</td></tr></thead>
    <tbody><tr><td>
      ${page1}
      ${coverLetter(wct.jobTypes ?? [], input.org)}
      ${sections.join('')}
      ${advisoryPage()}
      ${frequencyPage()}
    </td></tr></tbody>
  </table>
</body>
</html>`;
}

export const WCT_SERVICE_PDF_MARGIN = { top: '10mm', right: '14mm', bottom: '16mm', left: '14mm' };

/** Puppeteer options: page inset + the per-page TEL / WEBSITE / EMAIL / ADDRESS line and "Page n of N". */
export function wctServicePdfOptions(org: WctOrgProfile): {
  margin: { top: string; right: string; bottom: string; left: string };
  pageNumbers: { label: string; format: 'of'; fontPx: number; paddingX: string };
} {
  const label = [
    org.phoneNumber ? `TEL: ${org.phoneNumber}` : '',
    org.website ? `WEBSITE: ${org.website.toUpperCase()}` : '',
    org.email ? `EMAIL: ${org.email.toUpperCase()}` : '',
    org.address ? `ADDRESS: ${org.address.toUpperCase()}` : '',
  ]
    .filter(Boolean)
    .join('     ');
  return { margin: WCT_SERVICE_PDF_MARGIN, pageNumbers: { label, format: 'of', fontPx: 8, paddingX: WCT_SERVICE_PDF_MARGIN.left } };
}
