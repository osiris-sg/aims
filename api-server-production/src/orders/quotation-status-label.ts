import { erpImportOf, erpQuotationDisplayStatus, erpQuotationTag } from '../common/erp-import';

/**
 * Jobs calendar side panel (round 39, WCT group, 2026-11-20): the order's quotation with its real status, never
 * "Imported". An old ERP quotation reads as the documents list reads it (common/erp-import.ts): still open in the
 * ERP = "Unconfirmed · ERP draft" (or "Expired · ERP draft" after 6 months), accepted = "Confirmed", declined /
 * cancelled in the ERP = that word ("Declined"). An AIMS quotation: its own status (Confirmed / Unconfirmed / Draft…).
 */
export function quotationStatusLabel(q: { type?: string | null; status?: string | null; config?: any } | null | undefined, opts: { today?: string } = {}): string {
  if (!q) return '';
  const cfg = q.config || {};
  if (cfg.voided === true) return 'Voided';
  const erp = erpImportOf(cfg);
  if (erp && erp.source === 'wct-erp') {
    const d = erpQuotationDisplayStatus(q.type, cfg, opts);
    const tag = erpQuotationTag(q.type, cfg, opts);
    if (d === 'unconfirmed') return tag ? `Unconfirmed · ${tag}` : 'Unconfirmed';
    if (d === 'expired') return tag ? `Expired · ${tag}` : 'Expired';
    const word = String(erp.status ?? '').trim().toLowerCase();
    if (/declin|reject|lost/.test(word)) return 'Declined';
    if (d === 'cancelled' || /cancel|void/.test(word)) return 'Cancelled';
  }
  const s = String(q.status ?? '').trim().toLowerCase();
  if (!s) return '';
  return s.charAt(0).toUpperCase() + s.slice(1).replace(/_/g, ' ');
}
