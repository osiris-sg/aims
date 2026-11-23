/**
 * Office edits on confirmed / delivered / signed DOs (Biofuel, 2026-11-23; flag
 * enableOfficeDoEdits, default OFF so every other org is unchanged).
 *
 * With the flag on, a portal save of a DO that is past unconfirmed is a PAPER
 * edit: the text on the DO changes, nothing else does.
 *  - status stays as stored (a delivered DO stays delivered);
 *  - the DO number (document name) stays as stored;
 *  - signature and stamp keys stay as stored (the signatures themselves live on
 *    the run's MSR / DO_ACK rows, which this save never touches);
 *  - keys the editor does not send are carried over, so server-written keys
 *    (attention snapshot, run links, cancel marks) survive;
 *  - no stock moves, no project assignments, no ad-hoc run hand-off.
 * Every such save writes an Activity Log row with old -> new per field.
 * WhatsApp assistant writes never take this path (the controller passes
 * officeEdit only for non-assistant requests), so its lock is unchanged.
 */

export const OFFICE_DO_EDITS_FLAG = 'enableOfficeDoEdits';

const DO_TYPES = new Set(['DO', 'DELIVERY_ORDER']);
const OPEN_STATUSES = new Set(['', 'draft', 'unconfirmed']);
const PINNED_KEY_RE = /signature|signed|signer|stamp/i;

export function isOfficeDoEdit(type: string | null | undefined, status: string | null | undefined, flagOn: boolean, officeEdit: boolean): boolean {
  if (!flagOn || !officeEdit) return false;
  if (!DO_TYPES.has(String(type || '').toUpperCase())) return false;
  return !OPEN_STATUSES.has(String(status || '').toLowerCase());
}

/**
 * Pins status, number and signature keys of `existing` onto the incoming save.
 * Mutates `dto` (and its config) in place and returns it.
 */
export function pinOfficeDoEdit<T extends { status?: any; name?: string; config?: any }>(
  existing: { name: string | null; status: string; config: unknown },
  dto: T,
): T {
  dto.status = existing.status as any;
  if (existing.name) dto.name = existing.name;
  const prev = existing.config && typeof existing.config === 'object' ? (existing.config as Record<string, any>) : {};
  if (!dto.config || typeof dto.config !== 'object') return dto;
  const next = dto.config as Record<string, any>;
  for (const [k, v] of Object.entries(prev)) {
    if (PINNED_KEY_RE.test(k)) next[k] = v;
    else if (next[k] === undefined) next[k] = v;
  }
  for (const k of Object.keys(next)) if (PINNED_KEY_RE.test(k) && !(k in prev)) delete next[k];
  if (existing.name) {
    if ('documentNumber' in next) next.documentNumber = existing.name;
    if (next.documentInfo && typeof next.documentInfo === 'object' && 'documentNumber' in next.documentInfo) {
      next.documentInfo = { ...next.documentInfo, documentNumber: existing.name };
    }
  }
  return dto;
}

const SKIP_DIFF = new Set(['items', 'documentInfo', 'customer', 'attention', 'logo', 'updatedAt', 'version']);

function show(v: unknown): string {
  if (v === undefined || v === null) return '';
  if (typeof v === 'object') return JSON.stringify(v);
  return String(v);
}

function itemLine(i: any): string {
  const name = i?.description || i?.name || i?.itemName || i?.sku || '';
  return `${String(name).trim()} x ${Number(i?.quantity ?? 0)}`;
}

/** Field-level old -> new for the Activity Log. Values are capped at 300 chars. */
export function officeDoEditChanges(oldCfg: unknown, newCfg: unknown): Array<{ field: string; from: string; to: string }> {
  const o = oldCfg && typeof oldCfg === 'object' ? (oldCfg as Record<string, any>) : {};
  const n = newCfg && typeof newCfg === 'object' ? (newCfg as Record<string, any>) : {};
  const out: Array<{ field: string; from: string; to: string }> = [];
  const cap = (s: string) => (s.length > 300 ? s.slice(0, 300) : s);
  const push = (field: string, a: unknown, b: unknown) => {
    const from = show(a);
    const to = show(b);
    if (from !== to) out.push({ field, from: cap(from), to: cap(to) });
  };
  for (const k of new Set([...Object.keys(o), ...Object.keys(n)])) {
    if (SKIP_DIFF.has(k) || PINNED_KEY_RE.test(k)) continue;
    if (typeof o[k] === 'object' && o[k] !== null && typeof n[k] === 'object' && n[k] !== null && JSON.stringify(o[k]) === JSON.stringify(n[k])) continue;
    push(k, o[k], n[k]);
  }
  const oi = o.documentInfo && typeof o.documentInfo === 'object' ? o.documentInfo : {};
  const ni = n.documentInfo && typeof n.documentInfo === 'object' ? n.documentInfo : {};
  for (const k of new Set([...Object.keys(oi), ...Object.keys(ni)])) push(`documentInfo.${k}`, oi[k], ni[k]);
  const oItems = Array.isArray(o.items) ? o.items.map(itemLine) : [];
  const nItems = Array.isArray(n.items) ? n.items.map(itemLine) : [];
  if (oItems.join(' | ') !== nItems.join(' | ')) push('items', oItems.join(' | '), nItems.join(' | '));
  return out;
}
