import { BadRequestException } from '@nestjs/common';
import { isOrgFeatureEnabled } from '../common/org-features';
import { runAsOrg } from '../common/tenancy/tenant-context';
import { JOB_ENTITY } from './job-fields';
import { coloursOf } from '../dashboard/calendar-style';
import { PtwApplicantList, applicantEntryOf, readApplicantList } from './ptw-applicants';

/**
 * Calendar style job fields (WCT group, 2026-11-18, flag enableCalendarStyle):
 * the job's Salesperson, PTW applicant, COD tick and Postponed (on hold) mark,
 * drawn by the jobs calendar (dashboard/calendar-style.ts).
 *
 * No schema change: one JSON value per job in CustomFieldValue, under a
 * storage-only CustomField (entityType 'Delivery', fieldName
 * 'job_calendar_style', fieldType 'json', isActive FALSE). Inactive, so the
 * job fields editor, the generic custom-field lists, calendar badges and the
 * legend never see it; only this file reads it, by name. The field is made on
 * the first save of an org with the flag on.
 *
 * A job with no value reads as: no salesperson of its own (the calendar falls
 * back to its quotation's salesman), no PTW applicant (the org's default
 * applicant), not COD, not postponed.
 */
export const CALENDAR_STYLE_FLAG = 'enableCalendarStyle';
export const JOB_STYLE_FIELD = 'job_calendar_style';

export interface JobStyleMeta {
  salespersonId: string | null;
  salespersonName: string | null;
  ptwApplicantId: string | null;
  ptwApplicantName: string | null;
  cod: boolean;
  postponed: boolean;
  /** "Generate sticker" (2026-11-19): the job shows 📌 on the calendar. */
  sticker: boolean;
  /** Who made the job (2026-11-19, the calendar's people list). Stamped by the server, never sent by a form. */
  createdById: string | null;
}

export const EMPTY_JOB_STYLE: JobStyleMeta = {
  salespersonId: null,
  salespersonName: null,
  ptwApplicantId: null,
  ptwApplicantName: null,
  cod: false,
  postponed: false,
  sticker: false,
  createdById: null,
};

export async function isCalendarStyleEnabled(prisma: any, organizationId: string): Promise<boolean> {
  return isOrgFeatureEnabled(prisma, organizationId, CALENDAR_STYLE_FLAG);
}

const idOf = (v: unknown): string | null => (typeof v === 'string' && v.trim() ? v.trim().slice(0, 100) : null);
const nameOf = (v: unknown): string | null => (typeof v === 'string' && v.trim() ? v.trim().slice(0, 120) : null);

/** A stored value as meta (anything malformed reads as empty). */
export function jobStyleOf(raw: unknown): JobStyleMeta {
  const v: any = raw && typeof raw === 'object' && !Array.isArray(raw) ? raw : {};
  return {
    salespersonId: idOf(v.salespersonId),
    salespersonName: idOf(v.salespersonId) ? nameOf(v.salespersonName) : null,
    ptwApplicantId: idOf(v.ptwApplicantId),
    ptwApplicantName: idOf(v.ptwApplicantId) ? nameOf(v.ptwApplicantName) : null,
    cod: v.cod === true,
    postponed: v.postponed === true,
    sticker: v.sticker === true,
    createdById: idOf(v.createdById),
  };
}

/**
 * The fields a form sent, as a partial update (keys left out are kept).
 * salesperson / ptwApplicant: { id, name } or null (cleared); cod / postponed / sticker: booleans.
 * The creator is never taken from a form (stampJobCreator).
 */
export function parseJobStylePatch(body: any): Partial<JobStyleMeta> {
  const out: Partial<JobStyleMeta> = {};
  const person = (v: any, label: string): { id: string | null; name: string | null } => {
    if (v === null || v === '') return { id: null, name: null };
    if (typeof v === 'string') return { id: idOf(v), name: null };
    if (typeof v !== 'object' || !idOf(v.id)) throw new BadRequestException(`${label} must be a person`);
    return { id: idOf(v.id), name: nameOf(v.name) };
  };
  if (body && 'salesperson' in body) {
    const p = person(body.salesperson, 'Salesperson');
    out.salespersonId = p.id;
    out.salespersonName = p.name;
  }
  if (body && 'ptwApplicant' in body) {
    const p = person(body.ptwApplicant, 'PTW applicant');
    out.ptwApplicantId = p.id;
    out.ptwApplicantName = p.name;
  }
  if (body && 'cod' in body) {
    if (typeof body.cod !== 'boolean') throw new BadRequestException('COD must be true or false');
    out.cod = body.cod;
  }
  if (body && 'postponed' in body) {
    if (typeof body.postponed !== 'boolean') throw new BadRequestException('Postponed must be true or false');
    out.postponed = body.postponed;
  }
  if (body && 'sticker' in body) {
    if (typeof body.sticker !== 'boolean') throw new BadRequestException('Generate sticker must be true or false');
    out.sticker = body.sticker;
  }
  return out;
}

export const hasJobStylePatch = (p: Partial<JobStyleMeta>) => Object.keys(p).length > 0;

/** The storage field's id (null when the org has none yet; create = make it). */
export async function jobStyleFieldId(prisma: any, organizationId: string, create = false): Promise<string | null> {
  return runAsOrg(organizationId, async () => {
    const row = await prisma.customField.findFirst({ where: { organizationId, entityType: JOB_ENTITY, fieldName: JOB_STYLE_FIELD }, select: { id: true } });
    if (row || !create) return row?.id ?? null;
    try {
      const made = await prisma.customField.create({
        data: {
          organizationId,
          entityType: JOB_ENTITY,
          fieldName: JOB_STYLE_FIELD,
          displayLabel: 'Calendar style',
          fieldType: 'json',
          required: false,
          isActive: false,
          showInList: false,
          showInForm: false,
          sortOrder: 0,
        },
        select: { id: true },
      });
      return made.id;
    } catch (err: any) {
      // Made by a parallel save: read it back.
      if (err?.code !== 'P2002') throw err;
      const again = await prisma.customField.findFirst({ where: { organizationId, entityType: JOB_ENTITY, fieldName: JOB_STYLE_FIELD }, select: { id: true } });
      return again?.id ?? null;
    }
  });
}

/** Each job's meta: runId -> meta (jobs without a value are left out). */
export async function jobStyleValues(prisma: any, organizationId: string, deliveryIds: string[]): Promise<Map<string, JobStyleMeta>> {
  const out = new Map<string, JobStyleMeta>();
  if (!deliveryIds.length) return out;
  const fieldId = await jobStyleFieldId(prisma, organizationId);
  if (!fieldId) return out;
  const rows: any[] = await runAsOrg(organizationId, () =>
    prisma.customFieldValue.findMany({ where: { customFieldId: fieldId, entityId: { in: deliveryIds } }, select: { entityId: true, value: true } }),
  );
  for (const r of rows) out.set(r.entityId, jobStyleOf(r.value));
  return out;
}

/** Merge a patch into a job's meta and store it. Returns the job's meta after the save. */
export async function saveJobStyle(prisma: any, organizationId: string, deliveryId: string, patch: Partial<JobStyleMeta>): Promise<JobStyleMeta> {
  const fieldId = await jobStyleFieldId(prisma, organizationId, true);
  if (!fieldId) throw new Error('Calendar style field could not be created');
  return runAsOrg(organizationId, async () => {
    const cur = await prisma.customFieldValue.findUnique({ where: { customFieldId_entityId: { customFieldId: fieldId, entityId: deliveryId } }, select: { value: true } });
    const next = jobStyleOf({ ...jobStyleOf(cur?.value), ...patch });
    await prisma.customFieldValue.upsert({
      where: { customFieldId_entityId: { customFieldId: fieldId, entityId: deliveryId } },
      update: { value: next as any, entityType: JOB_ENTITY },
      create: { customFieldId: fieldId, entityId: deliveryId, entityType: JOB_ENTITY, value: next as any },
    });
    return next;
  });
}

/**
 * The org's default PTW applicant: the PTW applicants list's default entry (2026-11-19) when the org has
 * a list, else the member marked in Settings > Job fields > Calendar colours, or null.
 */
export async function defaultPtwApplicant(prisma: any, organizationId: string): Promise<string | null> {
  const list = await readApplicantList(prisma, organizationId);
  if (list) return list.defaultId;
  const rows: any[] = await prisma.userOrganization.findMany({ where: { organizationId, isActive: true }, select: { userId: true, settings: true } });
  return coloursOf(rows).defaultApplicant?.id ?? null;
}

/**
 * A PTW applicant sent by a form, checked against the org's list (orgs without a list: unchanged).
 * A visible entry is stored by its entry id with its name; a user id linked to a visible entry is
 * stored as that entry. Anything else is refused, unless it is what the job already stores (a job
 * whose applicant is not in the list keeps it when saved again). Returns the patch to store.
 */
export function withListedApplicant(patch: Partial<JobStyleMeta>, list: PtwApplicantList | null, stored: JobStyleMeta | null | undefined): Partial<JobStyleMeta> {
  if (!list || !('ptwApplicantId' in patch) || !patch.ptwApplicantId) return patch;
  const key = patch.ptwApplicantId;
  const e = applicantEntryOf(list, key);
  if (e && !e.hidden) return { ...patch, ptwApplicantId: e.id, ptwApplicantName: e.name };
  const kept = stored?.ptwApplicantId ?? null;
  if (kept && (kept === key || (e && applicantEntryOf(list, kept)?.id === e.id))) return { ...patch, ptwApplicantId: kept, ptwApplicantName: stored?.ptwApplicantName ?? null };
  throw new BadRequestException('Pick a PTW applicant from the list');
}

const ptwNeeded = (s: string | null | undefined) => !!s && s !== 'NOT_NEEDED';

/**
 * The PTW applicant is STORED on the job when it is saved (2026-11-18), so a
 * later change of the default applicant never recolours old jobs. A job that
 * needs a PTW and has no applicant (none sent, none stored) gets the org's
 * default at save time. Returns the patch to store (unchanged when nothing to add).
 */
export function withStampedApplicant(
  patch: Partial<JobStyleMeta>,
  ptwStatus: string | null | undefined,
  stored: JobStyleMeta | null | undefined,
  defaultId: string | null,
): Partial<JobStyleMeta> {
  if (!ptwNeeded(ptwStatus) || !defaultId) return patch;
  const sent = 'ptwApplicantId' in patch;
  const id = sent ? patch.ptwApplicantId : stored?.ptwApplicantId ?? null;
  if (id) return patch;
  return { ...patch, ptwApplicantId: defaultId, ptwApplicantName: null };
}

/**
 * The calendar's people list (2026-11-19, calendar style orgs only): stamp who made a job, once. Called when an
 * office user creates a job (New job, schedule form, a DO's job, a scheduled return) and when a draft job made by
 * the system (quotation acceptance) is first put on the calendar by a person. A job that already has a creator
 * keeps it; jobs made before this have none and read as "Unknown". Returns true when it stamped.
 */
export async function stampJobCreator(prisma: any, organizationId: string, deliveryId: string | null | undefined, userId: string | null | undefined): Promise<boolean> {
  const id = idOf(userId);
  if (!deliveryId || !id) return false;
  if (!(await isCalendarStyleEnabled(prisma, organizationId))) return false;
  const stored = (await jobStyleValues(prisma, organizationId, [deliveryId])).get(deliveryId);
  if (stored?.createdById) return false;
  await saveJobStyle(prisma, organizationId, deliveryId, { createdById: id });
  return true;
}

/** Every job creator stamped in the org (the calendar's people list). */
export async function jobCreatorIds(prisma: any, organizationId: string): Promise<Set<string>> {
  const out = new Set<string>();
  const fieldId = await jobStyleFieldId(prisma, organizationId);
  if (!fieldId) return out;
  const rows: any[] = await runAsOrg(organizationId, () => prisma.customFieldValue.findMany({ where: { customFieldId: fieldId }, select: { value: true } }));
  for (const r of rows) {
    const c = jobStyleOf(r.value).createdById;
    if (c) out.add(c);
  }
  return out;
}
