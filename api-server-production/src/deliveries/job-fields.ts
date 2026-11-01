import { isOrgFeatureEnabled } from '../common/org-features';
import { runAsOrg } from '../common/tenancy/tenant-context';

/**
 * Custom job fields (flag enableJobFields, 2026-11-01, Phase 6).
 *
 * An org's admins define their own fields for jobs (Delivery runs) — yes/no,
 * text, date, file upload or link — on the generic CustomField table with
 * entityType 'Delivery'; values live in CustomFieldValue (entityId = the run).
 * CustomField.display says how a field shows on the jobs calendar:
 *   { showOnCalendar: true, icon: 'permit', colourByValue: { "true": "#2e7d32" } }
 * A badge is drawn when the value has a colour in colourByValue (so "Permit
 * required" can show only when yes), or, without colourByValue, whenever the
 * field has a value. WCT starts with "Permit required" / "Permit approved".
 *
 * Pure helpers + small Prisma reads/writes on the caller's client.
 */
export const JOB_FIELDS_FLAG = 'enableJobFields';
export const JOB_ENTITY = 'Delivery';

export const JOB_FIELD_TYPES = ['boolean', 'text', 'date', 'file', 'url'] as const;
export type JobFieldType = (typeof JOB_FIELD_TYPES)[number];

/** The icons an admin can pick (the portal maps each to an MUI icon). */
export const JOB_FIELD_ICONS = ['permit', 'verified', 'warning', 'lock', 'key', 'build', 'event', 'description', 'link', 'flag', 'star', 'info', 'person', 'phone', 'camera', 'block'] as const;

export interface JobFieldDisplay {
  showOnCalendar?: boolean;
  icon?: string | null;
  /** value (as text: "true" / "false" / any) → colour. */
  colourByValue?: Record<string, string> | null;
  /** Colour when no colourByValue entry applies. */
  colour?: string | null;
}

export interface JobFieldDef {
  id: string;
  fieldName: string;
  displayLabel: string;
  fieldType: string;
  required?: boolean;
  sortOrder?: number | null;
  display?: JobFieldDisplay | null;
}

export const isJobFieldType = (t: unknown): t is JobFieldType => typeof t === 'string' && (JOB_FIELD_TYPES as readonly string[]).includes(t);

const HEX = /^#[0-9a-f]{6}$/i;

/** Keep only well-formed display settings. */
export function cleanDisplay(raw: any): JobFieldDisplay {
  const d: JobFieldDisplay = { showOnCalendar: raw?.showOnCalendar === true };
  if (typeof raw?.icon === 'string' && (JOB_FIELD_ICONS as readonly string[]).includes(raw.icon)) d.icon = raw.icon;
  if (raw?.colourByValue && typeof raw.colourByValue === 'object') {
    const m: Record<string, string> = {};
    for (const [k, v] of Object.entries(raw.colourByValue)) if (typeof v === 'string' && HEX.test(v)) m[String(k)] = v;
    if (Object.keys(m).length) d.colourByValue = m;
  }
  if (typeof raw?.colour === 'string' && HEX.test(raw.colour)) d.colour = raw.colour;
  return d;
}

/** A technical name from the label: "Permit approved" → permit_approved. */
export function fieldNameFor(label: string): string {
  return (
    String(label || '')
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '_')
      .replace(/^_+|_+$/g, '')
      .slice(0, 60) || 'field'
  );
}

/**
 * A submitted value made safe for its type. undefined = leave it, null = clear
 * it. Throws a message when it can't be that type.
 */
export function normaliseJobFieldValue(type: string, raw: any): any {
  if (raw === undefined) return undefined;
  if (raw === null || raw === '') return null;
  switch (type) {
    case 'boolean':
      if (raw === true || raw === 'true' || raw === 'yes') return true;
      if (raw === false || raw === 'false' || raw === 'no') return false;
      throw new Error('must be yes or no');
    case 'text':
      return String(raw).slice(0, 2000);
    case 'date': {
      const s = String(raw).slice(0, 10);
      if (!/^\d{4}-\d{2}-\d{2}$/.test(s) || Number.isNaN(Date.parse(`${s}T00:00:00Z`))) throw new Error('must be a date (yyyy-mm-dd)');
      return s;
    }
    case 'url': {
      const s = String(raw).trim();
      let u: URL;
      try {
        u = new URL(s);
      } catch {
        throw new Error('must be a link starting with https://');
      }
      if (u.protocol !== 'https:' && u.protocol !== 'http:') throw new Error('must be a link starting with https://');
      return s;
    }
    case 'file': {
      const key = typeof raw === 'object' ? String(raw.fileKey || '').trim() : '';
      if (!key) throw new Error('must be an uploaded file');
      return { fileKey: key, fileName: String(raw.fileName || key.split('/').pop() || 'file'), ...(raw.mimeType ? { mimeType: String(raw.mimeType) } : {}) };
    }
    default:
      throw new Error('is not a job field type');
  }
}

/** The value as words: Yes / No / the text / the date / the file name. */
export function jobFieldText(type: string, value: any): string {
  if (value === null || value === undefined || value === '') return '';
  if (type === 'boolean') return value === true ? 'Yes' : 'No';
  if (type === 'file') return String(value?.fileName || 'File');
  return String(value);
}

/** The calendar badge for one field's value, or null when nothing shows. */
export function calendarBadge(field: JobFieldDef, value: any): { fieldId: string; label: string; icon: string; colour: string; text: string } | null {
  const d = cleanDisplay(field.display);
  if (!d.showOnCalendar) return null;
  if (value === null || value === undefined || value === '') return null;
  const key = field.fieldType === 'boolean' ? String(value === true) : jobFieldText(field.fieldType, value);
  let colour: string | null;
  if (d.colourByValue) colour = d.colourByValue[key] ?? null;
  else colour = d.colour ?? '#546e7a';
  if (!colour) return null;
  return { fieldId: field.id, label: field.displayLabel, icon: d.icon || 'info', colour, text: jobFieldText(field.fieldType, value) };
}

/** The calendar's legend: every field drawn on it, with its colours. */
export function calendarLegend(fields: JobFieldDef[]) {
  return fields
    .map((f) => ({ f, d: cleanDisplay(f.display) }))
    .filter(({ d }) => d.showOnCalendar)
    .map(({ f, d }) => ({
      fieldId: f.id,
      label: f.displayLabel,
      icon: d.icon || 'info',
      colours: d.colourByValue
        ? Object.entries(d.colourByValue).map(([value, colour]) => ({ value: f.fieldType === 'boolean' ? (value === 'true' ? 'Yes' : 'No') : value, colour }))
        : [{ value: 'set', colour: d.colour ?? '#546e7a' }],
    }));
}

export async function isJobFieldsEnabled(prisma: any, organizationId: string) {
  return isOrgFeatureEnabled(prisma, organizationId, JOB_FIELDS_FLAG);
}

/** The org's active job fields, in order. */
export async function jobFieldDefs(prisma: any, organizationId: string): Promise<JobFieldDef[]> {
  return runAsOrg(organizationId, () =>
    prisma.customField.findMany({
      where: { organizationId, entityType: JOB_ENTITY, isActive: true },
      orderBy: [{ sortOrder: 'asc' }, { createdAt: 'asc' }],
      select: { id: true, fieldName: true, displayLabel: true, fieldType: true, required: true, sortOrder: true, display: true },
    }),
  );
}

/** Values for many runs: runId → { fieldId → value }. */
export async function jobFieldValues(prisma: any, organizationId: string, deliveryIds: string[], defs?: JobFieldDef[]): Promise<Map<string, Record<string, any>>> {
  const out = new Map<string, Record<string, any>>();
  if (!deliveryIds.length) return out;
  const fields = defs ?? (await jobFieldDefs(prisma, organizationId));
  if (!fields.length) return out;
  const rows: any[] = await runAsOrg(organizationId, () =>
    prisma.customFieldValue.findMany({
      where: { entityType: JOB_ENTITY, entityId: { in: deliveryIds }, customFieldId: { in: fields.map((f) => f.id) } },
      select: { customFieldId: true, entityId: true, value: true },
    }),
  );
  for (const r of rows) {
    const m = out.get(r.entityId) ?? {};
    m[r.customFieldId] = r.value;
    out.set(r.entityId, m);
  }
  return out;
}

/**
 * Save a run's job field values ({ fieldId: value }; null clears, unknown ids
 * are refused). Flag-gated by the caller. Returns the run's values after the save.
 */
/** Check submitted values against the org's fields (no writes). Throws one message naming every bad field. */
export function checkJobFieldValues(fields: JobFieldDef[], values: Record<string, any>): { field: JobFieldDef; value: any }[] {
  const byId = new Map(fields.map((f) => [f.id, f]));
  const problems: string[] = [];
  const writes: { field: JobFieldDef; value: any }[] = [];
  for (const [id, raw] of Object.entries(values || {})) {
    const field = byId.get(id);
    if (!field) {
      problems.push('a field that is not one of this organisation’s job fields');
      continue;
    }
    try {
      const v = normaliseJobFieldValue(field.fieldType, raw);
      if (v !== undefined) writes.push({ field, value: v });
    } catch (e: any) {
      problems.push(`${field.displayLabel} ${e?.message}`);
    }
  }
  if (problems.length) throw new Error(problems.join('; '));
  return writes;
}

export async function saveJobFieldValues(prisma: any, organizationId: string, deliveryId: string, values: Record<string, any>): Promise<Record<string, any>> {
  const fields = await jobFieldDefs(prisma, organizationId);
  const writes = checkJobFieldValues(fields, values);
  await runAsOrg(organizationId, async () => {
    for (const { field, value } of writes) {
      if (value === null) {
        await prisma.customFieldValue.deleteMany({ where: { customFieldId: field.id, entityId: deliveryId } });
      } else {
        await prisma.customFieldValue.upsert({
          where: { customFieldId_entityId: { customFieldId: field.id, entityId: deliveryId } },
          update: { value, entityType: JOB_ENTITY },
          create: { customFieldId: field.id, entityId: deliveryId, entityType: JOB_ENTITY, value },
        });
      }
    }
  });
  return (await jobFieldValues(prisma, organizationId, [deliveryId], fields)).get(deliveryId) ?? {};
}
