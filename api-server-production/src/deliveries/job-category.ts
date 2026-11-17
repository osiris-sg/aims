import { BadRequestException } from '@nestjs/common';
import { runAsOrg } from '../common/tenancy/tenant-context';
import { JOB_ENTITY, isJobFieldsEnabled } from './job-fields';

/**
 * Job category (WCT group, 2026-11-17): one required pick per job (Service
 * order, Delivery, Site visit, Others), the list editable per org in
 * Settings > Job fields. No schema change: the list is a CustomField
 * (entityType 'Delivery', fieldName 'job_category', fieldType 'select',
 * options [{ value, label }], defaultValue = the first entry) and a job's pick
 * is its CustomFieldValue (a string).
 *
 * The gate is per org: enableJobFields on AND the org has the active
 * job_category field (seeded by scripts/wct-job-category-seed.ts). Every
 * other org has no such field and sees nothing new. The field is kept out of
 * the generic job fields list (jobFieldDefs), so the job fields editor,
 * calendar badges and legend are unchanged.
 *
 * A job without a stored pick (every job made before this, and jobs made from
 * an order / DO) reads as the default ("Service order"); no backfill.
 */
export const JOB_CATEGORY_FIELD = 'job_category';
export const JOB_CATEGORY_LABEL = 'Job category';
export const DEFAULT_JOB_CATEGORIES = ['Service order', 'Delivery', 'Site visit', 'Others'] as const;
const MAX_OPTIONS = 30;
const MAX_LEN = 60;

export interface JobCategoryDef {
  id: string;
  options: string[];
  defaultValue: string;
}

/** A submitted list made clean: trimmed, no blanks, no repeats (any case), at most 30 of 60 chars. Throws when empty. */
export function cleanCategoryOptions(raw: unknown): string[] {
  if (!Array.isArray(raw)) throw new BadRequestException('Send the list of categories');
  const out: string[] = [];
  const seen = new Set<string>();
  for (const v of raw) {
    const s = String(typeof v === 'object' && v ? ((v as any).label ?? (v as any).value ?? '') : (v ?? ''))
      .replace(/\s+/g, ' ')
      .trim();
    if (!s) continue;
    if (s.length > MAX_LEN) throw new BadRequestException(`A category is limited to ${MAX_LEN} characters`);
    const k = s.toLowerCase();
    if (seen.has(k)) continue;
    seen.add(k);
    out.push(s);
  }
  if (!out.length) throw new BadRequestException('Keep at least one category');
  if (out.length > MAX_OPTIONS) throw new BadRequestException(`At most ${MAX_OPTIONS} categories`);
  return out;
}

/** The stored options (["x"] or [{ value, label }]) as names. */
export function optionNames(raw: unknown): string[] {
  if (!Array.isArray(raw)) return [];
  return raw.map((v) => String(typeof v === 'object' && v ? ((v as any).label ?? (v as any).value ?? '') : (v ?? '')).trim()).filter(Boolean);
}

/** The CustomField row as a category definition; null when it has no options. */
export function categoryDefOf(row: { id: string; options?: unknown; defaultValue?: string | null } | null | undefined): JobCategoryDef | null {
  if (!row) return null;
  const options = optionNames(row.options);
  if (!options.length) return null;
  const d = row.defaultValue && options.includes(row.defaultValue) ? row.defaultValue : options[0];
  return { id: row.id, options, defaultValue: d };
}

/** What a job shows: its stored pick, else the default (blank = "Service order"). */
export function categoryShown(def: JobCategoryDef, raw: unknown): string {
  const s = typeof raw === 'string' ? raw.trim() : '';
  return s || def.defaultValue;
}

/** A pick from a form: blank = the default; anything not on the list is refused. */
export function parseCategory(def: JobCategoryDef, raw: unknown): string {
  const s = typeof raw === 'string' ? raw.trim() : '';
  if (!s) return def.defaultValue;
  const hit = def.options.find((o) => o.toLowerCase() === s.toLowerCase());
  if (!hit) throw new BadRequestException(`Job category must be one of: ${def.options.join(', ')}`);
  return hit;
}

/** The org's category list, or null (job fields off, or no job_category field: every non-WCT org). */
export async function jobCategoryDef(prisma: any, organizationId: string): Promise<JobCategoryDef | null> {
  if (!(await isJobFieldsEnabled(prisma, organizationId))) return null;
  const row = await runAsOrg(organizationId, () =>
    prisma.customField.findFirst({
      where: { organizationId, entityType: JOB_ENTITY, fieldName: JOB_CATEGORY_FIELD, isActive: true },
      select: { id: true, options: true, defaultValue: true },
    }),
  );
  return categoryDefOf(row as any);
}

/** Each job's category as shown (blank = the default): runId -> name. */
export async function jobCategoryValues(prisma: any, organizationId: string, def: JobCategoryDef, deliveryIds: string[]): Promise<Map<string, string>> {
  const out = new Map<string, string>();
  if (!deliveryIds.length) return out;
  const rows: any[] = await runAsOrg(organizationId, () =>
    prisma.customFieldValue.findMany({
      where: { entityType: JOB_ENTITY, customFieldId: def.id, entityId: { in: deliveryIds } },
      select: { entityId: true, value: true },
    }),
  );
  const stored = new Map(rows.map((r) => [r.entityId as string, r.value]));
  for (const id of deliveryIds) out.set(id, categoryShown(def, stored.get(id)));
  return out;
}

/** Store a job's category (already parsed). */
export async function saveJobCategory(prisma: any, organizationId: string, def: JobCategoryDef, deliveryId: string, value: string): Promise<void> {
  await runAsOrg(organizationId, () =>
    prisma.customFieldValue.upsert({
      where: { customFieldId_entityId: { customFieldId: def.id, entityId: deliveryId } },
      update: { value, entityType: JOB_ENTITY },
      create: { customFieldId: def.id, entityId: deliveryId, entityType: JOB_ENTITY, value },
    }),
  );
}
