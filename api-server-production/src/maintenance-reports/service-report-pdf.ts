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

const S3_PREFIX =
  process.env.S3_PUBLIC_URL ?? 'https://aims-osiris.s3.ap-southeast-1.amazonaws.com/';

// Canonical 30-item paper-form list. Items 26–30 are reserved blanks on the
// paper form — preserved here so the printed PDF matches row-for-row.
const CHECKLIST_LABELS: { id: number; label: string }[] = [
  { id: 1, label: 'Control panel' },
  { id: 2, label: 'PLC' },
  { id: 3, label: 'HMI' },
  { id: 4, label: 'Power voltage' },
  { id: 5, label: 'Frequency' },
  { id: 6, label: 'Backwash pump' },
  { id: 7, label: 'Submersible pump' },
  { id: 8, label: 'Aerator' },
  { id: 9, label: 'Suction pump' },
  { id: 10, label: 'Air scouring pump' },
  { id: 11, label: 'Turbula pump' },
  { id: 12, label: '3 way valve' },
  { id: 13, label: '1 way valve' },
  { id: 14, label: 'Backwash valve' },
  { id: 15, label: 'Discharge valve' },
  { id: 16, label: 'X-flow valve' },
  { id: 17, label: 'Product valve' },
  { id: 18, label: 'Pump relief valve' },
  { id: 19, label: 'Holding tank level sensor' },
  { id: 20, label: 'MBR tank level sensor' },
  { id: 21, label: 'Product tank level sensor' },
  { id: 22, label: 'Filtration pressure' },
  { id: 23, label: 'Backwash pressure' },
  { id: 24, label: 'Electric wire' },
  { id: 25, label: 'Flow rate' },
  { id: 26, label: '' },
  { id: 27, label: '' },
  { id: 28, label: '' },
  { id: 29, label: '' },
  { id: 30, label: '' },
];

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
}

export interface ServiceReportPdfInput {
  reportNumber: number | null;
  technicianName: string | null;
  serviceData: ServiceData | null;
  asset: { name: string; skuKey: string } | null;
  inventory: { sku: string; serialNumber: string | null } | null;
  orgName: string;
}

export function buildServiceReportHtml(input: ServiceReportPdfInput): string {
  const sd = input.serviceData ?? {};
  const checkedSet = new Set(sd.checklist ?? []);
  const techSigUrl = sd.techSignatureKey ? `${S3_PREFIX}${sd.techSignatureKey}` : null;
  const clientSigUrl = sd.clientSignatureKey ? `${S3_PREFIX}${sd.clientSignatureKey}` : null;
  const model = sd.model ?? input.asset?.name ?? '';
  const serial = sd.serial ?? input.inventory?.serialNumber ?? input.inventory?.sku ?? '';

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
  </style>
</head>
<body>
  <div class="page">
    <div class="title-bar">
      <h1>MAINTENANCE &amp; INSPECTION SERVICE REPORT</h1>
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

    <div class="section-title">Checklist</div>
    <div class="checklist">${checklistCellsHtml}</div>

    <div class="section-title">Remarks</div>
    <div class="remarks-box">${esc(sd.remarks) || '&nbsp;'}</div>
    <div class="time-row">
      <div><span class="label">Time In:</span>${esc(fmtTime(sd.timeIn))}</div>
      <div><span class="label">Time Out:</span>${esc(fmtTime(sd.timeOut))}</div>
    </div>

    <div class="sig-grid">
      <div class="sig-box">
        ${techSigUrl ? `<img class="sig-img" src="${techSigUrl}" alt="Service signature" />` : '<div class="sig-empty">No signature</div>'}
        <div class="sig-label">
          <div class="sig-name">${esc(input.technicianName) || '—'}</div>
          SERVICE BY ${esc(input.orgName).toUpperCase()}
        </div>
      </div>
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
