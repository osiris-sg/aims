/**
 * Pure HTML builder for the Maintenance & Inspection Service Report PDF.
 *
 * Designed to be piped through PdfGeneratorService.generatePdfFromHtml
 * (puppeteer). The S3 bucket is publicly readable, so signature images
 * inline-render via plain <img src> without signed URLs.
 *
 * No React, no JSX — just template literals. Keeps the build dep-free and
 * the output deterministic.
 */

import {
  ESS_CATEGORIES,
  ESS_POWER_ON_TESTS,
  ESS_HEADER_FIXED,
  GENERIC_CHECKLIST,
  essDefectSummary,
  TEMPLATE_LABELS,
  essItemKey,
  isOverridden,
  templateFor,
  type EssMeasure,
  type EssServiceData,
} from './msr-templates';

const S3_PREFIX =
  process.env.S3_PUBLIC_URL ?? 'https://aims-osiris.s3.ap-southeast-1.amazonaws.com/';

// Labels, categories and thresholds come from the mirrored catalogue — see the
// drift warning at the top of that file. The template a report renders under is
// read from the ROW's stamped templateId, never from its asset.
const CHECKLIST_LABELS = GENERIC_CHECKLIST;

// Minimal HTML-escape — protects against name fields with `<` or `&` that
// would otherwise corrupt the markup. Whitelist sufficient for prose +
// company names; no need to escape attributes since we never interpolate
// user data into attribute values.
const esc = (v: unknown): string => {
  if (v == null) return '';
  return String(v)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
};

const fmtTime = (iso?: string | null): string => {
  if (!iso) return '—';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return String(iso);
  return d.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' });
};

interface ServiceData {
  customerName?: string | null;
  clientEmail?: string | null;
  jobLocation?: string | null;
  model?: string | null;
  serial?: string | null;
  serviceDate?: string | null;
  nextServiceDate?: string | null;
  timeIn?: string | null;
  timeOut?: string | null;
  checklist?: number[];
  remarks?: string | null;
  techSignatureKey?: string | null;
  clientSignatureKey?: string | null;
  clientSignerName?: string | null;
  templateId?: string | null;
  templateVersion?: number | null;
  ess?: EssServiceData | null;
}

export interface ServiceReportPdfInput {
  reportNumber: number | null;
  technicianName: string | null;
  serviceData: ServiceData | null;
  asset: { name: string; skuKey: string } | null;
  inventory: { sku: string; serialNumber: string | null } | null;
  orgName: string;
}


/**
 * ESS-only stylesheet. Kept OUT of the shared sheet on purpose: a GENERIC
 * report's HTML must stay byte-for-byte identical to what it produced before
 * templates existed, and unused CSS is still bytes.
 *
 * PAGINATION. GENERIC is one page and never needed any of this. ESS is ~6, and
 * without these rules Puppeteer breaks wherever it lands — mid-table,
 * mid-category, and straight through the signature row.
 *
 * ⚠ The page MARGIN is NOT set here. `PdfGeneratorService` appends its own
 * `@page { size: A4; margin: 0 }` via addStyleTag AFTER this document's style
 * (so it wins the cascade) and additionally passes margin 0 to `page.pdf()`,
 * which overrides CSS @page in Chromium outright. The only thing that actually
 * insets the page is the generator's `options.margin`, so the ESS call site in
 * maintenance-reports.service.ts passes one. Setting @page here instead would
 * look right and do nothing.
 */
const ESS_PRINT_CSS = `
    .page { min-height: 0; padding: 0; }
    .keep, .cat, .sig-grid, .measure, .totals { break-inside: avoid; page-break-inside: avoid; }
    table { break-inside: auto; }
    tr, td, th { break-inside: avoid; page-break-inside: avoid; }
    thead { display: table-header-group; }
    .section-title { break-after: avoid; page-break-after: avoid; }

    /* ESS_V1 */
    .cat { margin-bottom: 10px; }
    .cat-title { font-weight: 700; font-size: 11px; margin: 8px 0 3px; }
    table.items { width: 100%; border-collapse: collapse; }
    table.items td { padding: 2px 4px; border-bottom: 1px dotted #bbb; vertical-align: top; font-size: 10.5px; }
    table.items td.idx { width: 34px; color: #555; }
    table.items td.verdict { width: 54px; text-align: right; }
    .item-remark { color: #555; font-size: 9.5px; font-style: italic; }
    table.grid { width: 100%; border-collapse: collapse; font-size: 10.5px; }
    table.grid th, table.grid td { border: 1px solid #000; padding: 3px 5px; text-align: left; vertical-align: top; }
    table.grid th { background: #eee; font-size: 10px; }
    .nowrap { white-space: nowrap; }
    .muted { color: #777; font-style: italic; }
    .totals { margin-top: 6px; font-size: 11px; }
    .v { display: inline-block; padding: 0 5px; border-radius: 7px; font-size: 9.5px; font-weight: 700; color: #fff; }
    .v-ok { background: #2e7d32; }
    .v-bad { background: #c62828; }
    .v-warn { background: #ed6c02; margin-left: 4px; }
    .v-none { color: #999; }
    .measure { border: 1px solid #ccc; border-radius: 3px; padding: 4px 6px; margin-top: 4px; background: #fafafa; }
    .measure-warn { border-color: #ed6c02; background: #fff6ec; }
    .measure-row { display: flex; align-items: center; gap: 6px; font-size: 10.5px; }
    .measure-label { flex: 1; }
    .measure-value { font-weight: 700; }
    .measure-remark { font-size: 9.5px; color: #8a4b00; margin-top: 2px; }
    .hint { color: #666; font-weight: 400; }
    .defect-shots { display: flex; flex-wrap: wrap; gap: 3px; }
    .defect-shot { width: 46px; height: 46px; object-fit: cover; border: 1px solid #999; border-radius: 2px; }
    .fixed-block { border: 1px solid #ccc; background: #fafafa; padding: 5px 7px; margin-bottom: 10px; }
    .fixed-row { font-size: 10px; line-height: 1.45; }
    .fixed-label { font-weight: 700; }
`;

/** Page inset for the multi-page ESS report — see ESS_PRINT_CSS. */
export const ESS_PDF_MARGIN = { top: '12mm', right: '12mm', bottom: '14mm', left: '12mm' };

/** Pass/Fail (or OK/NG) chip. A missing verdict prints "—", never a Pass. */
const verdictChip = (v?: string | null): string => {
  if (!v) return '<span class="v-none">—</span>';
  const bad = v === 'FAIL' || v === 'NG';
  return `<span class="v ${bad ? 'v-bad' : 'v-ok'}">${esc(v)}</span>`;
};

const essMeasureHtml = (ess: EssServiceData, m: EssMeasure): string => {
  const r = ess.measures?.[m.key];
  const overridden = isOverridden(r);
  const shown =
    m.kind === 'boolean'
      ? r?.value
        ? 'Yes'
        : 'No'
      : r?.value === null || r?.value === undefined || r?.value === ''
        ? '—'
        : `${r.value}${m.unit ? ` ${m.unit}` : ''}`;
  const limit = m.threshold != null ? `<span class="hint">(pass &le; ${m.threshold} ${esc(m.unit)})</span>` : '';
  // An override is printed as an override. Showing only the chosen verdict
  // would present a Pass on a failing reading with nothing to say it was a
  // human decision.
  const flag = overridden
    ? `<span class="v v-warn">overridden — auto ${esc(r?.suggested)}</span>`
    : '';
  const why = overridden && r?.remark ? `<div class="measure-remark">${esc(r.remark)}</div>` : '';
  return `<div class="measure ${overridden ? 'measure-warn' : ''}">
    <div class="measure-row">
      <span class="measure-label">${esc(m.label)} ${limit}</span>
      <span class="measure-value">${esc(shown)}</span>
      ${verdictChip(r?.verdict)}
      ${flag}
    </div>${why}
  </div>`;
};

/**
 * Pre-inspection Status + Overall Conclusion.
 *
 * Deliberately NOT part of the body: the reference prints the technician's
 * verdict immediately above the signatures, so it is injected after the
 * generic Remarks/Times block rather than before it. The field form asks for
 * it in the same position — last, just before signing.
 */
const buildEssConclusionHtml = (ess: EssServiceData | null): string => {
  const sm = ess?.summary ?? {};
  return `
    <div class="keep">
      <div class="section-title">Conclusion</div>
      <div class="info-grid">
        <div class="info-row"><div class="info-label">Pre-inspection Status</div><div class="info-value">${esc(sm.preStatus)}</div></div>
        <div class="info-row"><div class="info-label">Overall Conclusion</div><div class="info-value">${esc(sm.conclusion)}</div></div>
      </div>
    </div>`;
};

/**
 * The ESS body: equipment, the eight categories, defects and power-on tests.
 * Each block carries a `keep` class so the print CSS can refuse to split it
 * across a page boundary. The conclusion is built separately, above.
 */
const buildEssBodyHtml = (ess: EssServiceData | null): string => {
  if (!ess) {
    return '<div class="section-title">Inspection</div><div class="remarks-box">This report is marked ESS_V1 but carries no inspection data.</div>';
  }

  const categories = ESS_CATEGORIES.map((cat) => {
    const rows = cat.items
      .map((item) => {
        const r = ess.items?.[essItemKey(cat.id, item.id)];
        // The reference prints its parenthetical guidance in the remarks
        // column; a technician's own remark replaces it.
        const note = r?.remark || item.hint;
        const remark = note ? `<div class="item-remark">${esc(note)}</div>` : '';
        // Readings belong ON the row they qualify, as the reference lays out.
        const own = (cat.measures ?? [])
          .filter((m) => m.itemId === item.id)
          .map((m) => essMeasureHtml(ess, m))
          .join('');
        return `<tr>
          <td class="idx">${cat.id}.${item.id}</td>
          <td>${esc(item.label)}${remark}${own}</td>
          <td class="verdict">${verdictChip(r?.verdict)}</td>
        </tr>`;
      })
      .join('');
    const loose = (cat.measures ?? [])
      .filter((m) => m.itemId == null)
      .map((m) => essMeasureHtml(ess, m))
      .join('');
    return `<div class="keep cat">
      <div class="cat-title">${cat.id}. ${esc(cat.title)}</div>
      <table class="items"><tbody>${rows}</tbody></table>
      ${loose}
    </div>`;
  }).join('');

  const defectRows = (ess.defects ?? []).length
    ? ess.defects
        .map((d, i) => {
          // Photos ride as S3 keys on the row. The bucket is publicly readable,
          // so they inline without signed URLs — same as the signatures above.
          const shots = (d.photos ?? []).length
            ? `<div class="defect-shots">${(d.photos ?? [])
                .map((k) => `<img class="defect-shot" src="${S3_PREFIX}${k}" alt="Defect photo" />`)
                .join('')}</div>`
            : '<span class="muted">—</span>';
          return `<tr>
            <td class="idx">${i + 1}</td>
            <td>${esc(d.description) || '—'}</td>
            <td class="nowrap">${esc(d.riskLevel)}</td>
            <td>${esc(d.correctiveAction) || '—'}</td>
            <td class="nowrap">${esc(d.status)}</td>
            <td>${shots}</td>
          </tr>`;
        })
        .join('')
    : '<tr><td colspan="6" class="muted">No defects recorded.</td></tr>';

  const powerRows = ESS_POWER_ON_TESTS.map((t) => {
    const r = ess.powerOn?.[String(t.id)];
    const note = r?.remark || t.hint;
    const remark = note ? `<div class="item-remark">${esc(note)}</div>` : '';
    return `<tr>
      <td class="idx">${t.id}</td>
      <td>${esc(t.label)}${remark}</td>
      <td class="verdict">${verdictChip(r?.verdict)}</td>
    </tr>`;
  }).join('');

  const h = ess.header ?? {};

  return `
    <div class="section-title">Equipment</div>
    <div class="info-grid">
      <div class="info-row"><div class="info-label">Equipment ID</div><div class="info-value">${esc(h.equipmentId)}</div></div>
      <div class="info-row"><div class="info-label">Site</div><div class="info-value">${esc(h.site)}</div></div>
      <div class="info-row"><div class="info-label">Inspection Date</div><div class="info-value">${esc(h.inspectionDate)}</div></div>
      <div class="info-row"><div class="info-label">Inspection Type</div><div class="info-value">${esc(h.inspectionType)}</div></div>
      <div class="info-row"><div class="info-label">Rated Power</div><div class="info-value">${h.ratedPowerKw != null ? `${esc(h.ratedPowerKw)} kW` : ''}</div></div>
      <div class="info-row"><div class="info-label">Rated Capacity</div><div class="info-value">${h.ratedCapacityKwh != null ? `${esc(h.ratedCapacityKwh)} kWh` : ''}</div></div>
    </div>
    <div class="fixed-block">
      ${ESS_HEADER_FIXED.map((f) => `<div class="fixed-row"><span class="fixed-label">${esc(f.label)}:</span> ${esc(f.value)}</div>`).join('')}
    </div>

    <div class="section-title">Detailed Record</div>
    ${categories}

    <div class="keep">
      <div class="section-title">Defect Tracking</div>
      <table class="grid">
        <thead><tr><th>No.</th><th>Description</th><th>Risk Level</th><th>Corrective Action</th><th>Status</th><th>Photos</th></tr></thead>
        <tbody>${defectRows}</tbody>
      </table>
      <div class="totals"><strong>${esc(essDefectSummary(ess.defectTotals?.major ?? 0, ess.defectTotals?.minor ?? 0))}</strong></div>
    </div>

    <div class="keep">
      <div class="section-title">Power-on Tests</div>
      <table class="items"><tbody>${powerRows}</tbody></table>
    </div>

  `;
};

export function buildServiceReportHtml(input: ServiceReportPdfInput): string {
  const sd = input.serviceData ?? {};
  const checkedSet = new Set(sd.checklist ?? []);
  const techSigUrl = sd.techSignatureKey ? `${S3_PREFIX}${sd.techSignatureKey}` : null;
  const clientSigUrl = sd.clientSignatureKey ? `${S3_PREFIX}${sd.clientSignatureKey}` : null;
  const model = sd.model ?? input.asset?.name ?? '';
  const serial = sd.serial ?? input.inventory?.serialNumber ?? input.inventory?.sku ?? '';
  // Stamped at capture; absent => GENERIC_V1, which is every pre-template row.
  const templateId = templateFor(sd.templateId);
  const isEss = templateId === 'ESS_V1';

  const checklistCellsHtml = CHECKLIST_LABELS.map((item) => {
    const isChecked = checkedSet.has(item.id);
    const isBlank = !item.label;
    const mark = isChecked ? '☑' : '☐';
    const labelClass = isBlank ? 'blank' : isChecked ? 'checked' : '';
    return `<div class="check-cell ${labelClass}"><span class="mark">${mark}</span> <span class="idx">${item.id}.</span> <span class="lbl">${esc(item.label)}</span></div>`;
  }).join('');

  return `<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <style>
    * { margin: 0; padding: 0; box-sizing: border-box; }
    body { font-family: Arial, sans-serif; font-size: 11px; color: #000; background: #fff; }
    .page { width: 210mm; min-height: 297mm; padding: 14mm 16mm; background: #fff; }

    .title-bar { text-align: center; border: 2px solid #000; padding: 8px 0; margin-bottom: 14px; }
    .title-bar h1 { font-size: 16px; letter-spacing: 0.5px; }
    .org-line { font-size: 11px; margin-top: 2px; color: #444; }

    .report-no-row { display: flex; justify-content: space-between; align-items: baseline; margin-bottom: 14px; }
    .report-no { font-size: 13px; font-weight: 700; }
    .report-no span { font-weight: 400; color: #666; margin-right: 6px; }

    .info-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 4px 16px; margin-bottom: 14px; }
    .info-row { display: flex; border-bottom: 1px solid #000; padding-bottom: 2px; }
    .info-label { width: 110px; font-weight: 600; }
    .info-value { flex: 1; }

    .section-title { font-weight: 700; font-size: 12px; margin: 14px 0 6px; padding-bottom: 3px; border-bottom: 1px solid #000; }

    .checklist { display: grid; grid-template-columns: 1fr 1fr; gap: 4px 16px; }
    .check-cell { font-size: 11px; padding: 2px 0; }
    .check-cell .mark { font-size: 13px; margin-right: 4px; }
    .check-cell .idx { color: #444; margin-right: 4px; }
    .check-cell.checked { font-weight: 600; }
    .check-cell.blank .idx, .check-cell.blank .lbl { color: #bbb; }

    .remarks-box { border: 1px solid #000; min-height: 60px; padding: 6px; white-space: pre-wrap; font-size: 11px; }
    .time-row { display: flex; gap: 24px; margin-top: 6px; font-size: 11px; }
    .time-row .label { font-weight: 600; margin-right: 4px; }

    .sig-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 12px; margin-top: 20px; }
    .sig-box { border: 1px solid #000; padding: 8px; min-height: 130px; display: flex; flex-direction: column; justify-content: space-between; }
    .sig-img { max-width: 100%; max-height: 70px; object-fit: contain; align-self: flex-start; }
    .sig-empty { color: #999; font-style: italic; text-align: center; padding: 20px 0; }
    .sig-label { font-size: 10px; color: #444; margin-top: 4px; border-top: 1px dashed #888; padding-top: 4px; }
    .sig-name { font-size: 11px; font-weight: 600; }

    .footer-text { margin-top: 18px; font-size: 10px; color: #444; line-height: 1.4; }
${isEss ? ESS_PRINT_CSS : ''}  </style>
</head>
<body>
  <div class="page">
    <div class="title-bar">
      <h1>${esc(TEMPLATE_LABELS[templateId].toUpperCase())}</h1>
      <div class="org-line">${esc(input.orgName)}</div>
    </div>

    <div class="report-no-row">
      <div>${sd.serviceDate ? `<span>Date:</span> ${esc(sd.serviceDate)}` : ''}</div>
      <div class="report-no"><span>No.</span>${input.reportNumber ?? '—'}</div>
    </div>

    <div class="info-grid">
      <div class="info-row"><div class="info-label">Company</div><div class="info-value">${esc(sd.customerName)}</div></div>
      <div class="info-row"><div class="info-label">Model</div><div class="info-value">${esc(model)}</div></div>
      <div class="info-row"><div class="info-label">Job Location</div><div class="info-value">${esc(sd.jobLocation)}</div></div>
      <div class="info-row"><div class="info-label">Serial No</div><div class="info-value">${esc(serial)}</div></div>
      <div class="info-row"><div class="info-label">Service Date</div><div class="info-value">${esc(sd.serviceDate)}</div></div>
      <div class="info-row"><div class="info-label">Next Service</div><div class="info-value">${esc(sd.nextServiceDate)}</div></div>
    </div>

    ${isEss
      ? buildEssBodyHtml(sd.ess ?? null)
      : `<div class="section-title">Checklist</div>
    <div class="checklist">${checklistCellsHtml}</div>`}

    <div class="section-title">Remarks</div>
    <div class="remarks-box">${esc(sd.remarks) || '&nbsp;'}</div>
    <div class="time-row">
      <div><span class="label">Time In:</span>${esc(fmtTime(sd.timeIn))}</div>
      <div><span class="label">Time Out:</span>${esc(fmtTime(sd.timeOut))}</div>
    </div>
${isEss ? buildEssConclusionHtml(sd.ess ?? null) : ''}
    <div class="sig-grid"${isEss ? ' style="grid-template-columns: 1fr 1fr 1fr;"' : ''}>
      <div class="sig-box">
        ${techSigUrl ? `<img class="sig-img" src="${techSigUrl}" alt="Service signature" />` : '<div class="sig-empty">No signature</div>'}
        <div class="sig-label">
          <div class="sig-name">${esc(input.technicianName) || '—'}</div>
          ${isEss ? 'INSPECTOR' : `SERVICE BY ${esc(input.orgName).toUpperCase()}`}
        </div>
      </div>${isEss
        ? `
      <div class="sig-box">
        ${techSigUrl ? `<img class="sig-img" src="${techSigUrl}" alt="Reviewer signature" />` : '<div class="sig-empty">No signature</div>'}
        <div class="sig-label">
          <div class="sig-name">${esc(input.technicianName) || '—'}</div>
          REVIEWER
        </div>
      </div>`
        : ''}
      <div class="sig-box">
        ${clientSigUrl ? `<img class="sig-img" src="${clientSigUrl}" alt="Client signature" />` : '<div class="sig-empty">No signature</div>'}
        <div class="sig-label">
          <div class="sig-name">${esc(sd.clientSignerName) || '—'}</div>
          I / WE, the undersigned, certify that the above services are satisfied &amp; have examined the said machines are in good and proper condition.
        </div>
      </div>
    </div>
  </div>
</body>
</html>`;
}
