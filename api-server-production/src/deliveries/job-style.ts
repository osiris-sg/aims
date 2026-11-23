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
  /** "Team / crew" (2026-11-20): free text, e.g. "Team A + Guru"; the calendar panel, the job page and the WhatsApp list. */
  team: string | null;
  /**
   * Round 39 B4 (Workers & Teams, WCT (S)): the teams and workers picked for the job, names as last read from
   * Settings > Workers & Teams. Shown before the free text: "Team A + Guru + <free text>". Empty = none picked.
   */
  crew: CrewPick[];
  /**
   * Cancelled from the calendar panel (2026-11-20): the status the job had, when and by whom, so Undo can put it back.
   * Stamped by the server only (never from a form); null for a job not cancelled there.
   */
  calendarCancel: { from: string; at: string; byId: string | null } | null;
  /** Shop name (2026-11-24): shown instead of the customer everywhere when filled; suggested per customer. */
  shopName: string | null;
  /**
   * Postpone keeps the old event (2026-11-24): the job moved to a new date keeps `postponedFrom` (the record left on
   * the old date); that record has `recordOnly` + `postponedTo` (the job's new date). Server-stamped only.
   */
  postponedTo: JobLink | null;
  postponedFrom: JobLink | null;
  recordOnly: boolean;
}

/** A link to the other job of a postponed pair: its id and its date (yyyy-MM-dd). */
export interface JobLink {
  id: string;
  date: string;
}
const linkOf = (v: any): JobLink | null => (v && typeof v === 'object' && idOf(v.id) && /^\d{4}-\d{2}-\d{2}$/.test(String(v.date ?? '')) ? { id: idOf(v.id)!, date: String(v.date) } : null);
/** Shop name: one line, at most 120 characters (null when empty). */
export const shopNameOf = (v: unknown): string | null => {
  const t = typeof v === 'string' ? v.replace(/\s+/g, ' ').trim() : '';
  return t ? t.slice(0, 120) : null;
};

export const EMPTY_JOB_STYLE: JobStyleMeta = {
  salespersonId: null,
  salespersonName: null,
  ptwApplicantId: null,
  ptwApplicantName: null,
  cod: false,
  postponed: false,
  sticker: false,
  createdById: null,
  team: null,
  crew: [],
  calendarCancel: null,
  shopName: null,
  postponedTo: null,
  postponedFrom: null,
  recordOnly: false,
};

export interface CrewPick {
  kind: 'team' | 'worker';
  id: string;
  name: string;
}

/** At most this many picks on one job. */
export const CREW_MAX = 12;

/** Stored / sent picks as clean CrewPick[] (unknown kinds, blank ids and duplicates dropped). */
export function crewOf(v: unknown): CrewPick[] {
  if (!Array.isArray(v)) return [];
  const out: CrewPick[] = [];
  for (const x of v) {
    if (!x || typeof x !== 'object') continue;
    const kind = (x as any).kind === 'team' || (x as any).kind === 'worker' ? (x as any).kind : null;
    const id = idOf((x as any).id);
    if (!kind || !id || out.some((o) => o.kind === kind && o.id === id)) continue;
    out.push({ kind, id, name: (typeof (x as any).name === 'string' ? (x as any).name.replace(/\s+/g, ' ').trim() : '').slice(0, 80) });
    if (out.length >= CREW_MAX) break;
  }
  return out;
}

/** A name compared without case or extra spaces ("team  a" = "Team A"). */
export const crewKey = (s: string | null | undefined): string => String(s ?? '').replace(/\s+/g, ' ').trim().toLowerCase();

/** The free text in pieces, as the picker splits it ("Team B + Ah Seng" = two pieces). */
const teamPieces = (team: string | null | undefined): string[] =>
  String(team ?? '')
    .split(/\s+\+\s+/)
    .map((s) => s.replace(/\s+/g, ' ').trim())
    .filter(Boolean);

/**
 * 2026-11-24 (Team / crew chips duplicated or came back after a delete): a job's picks and free text with no
 * duplicates. A pick once (same id, or same kind and name, any case); a piece of free text once (any case) and
 * never when it is a pick's name. Pieces are kept as typed. Every read and save goes through it (jobStyleOf).
 */
export function dedupeCrewTeam(crew: CrewPick[], team: string | null): { crew: CrewPick[]; team: string | null } {
  const picks: CrewPick[] = [];
  for (const c of crew) {
    const k = crewKey(c.name);
    if (picks.some((x) => x.kind === c.kind && (x.id === c.id || (!!k && crewKey(x.name) === k)))) continue;
    picks.push(c);
  }
  const seen = new Set(picks.map((p) => crewKey(p.name)).filter(Boolean));
  const free: string[] = [];
  for (const t of teamPieces(team)) {
    if (seen.has(crewKey(t))) continue;
    seen.add(crewKey(t));
    free.push(t);
  }
  return { crew: picks, team: free.length ? free.join(' + ').slice(0, TEAM_MAX) : null };
}

/** What the calendar, the panel and the WhatsApp list show: picked teams / workers first, then the free text. */
export function crewText(m: Pick<JobStyleMeta, 'crew' | 'team'> | null | undefined): string | null {
  if (!m) return null;
  const d = dedupeCrewTeam(m.crew ?? [], m.team ?? null);
  const parts = [...d.crew.map((c) => c.name).filter(Boolean), d.team ?? ''].filter(Boolean);
  return parts.length ? parts.join(' + ') : null;
}

export async function isCalendarStyleEnabled(prisma: any, organizationId: string): Promise<boolean> {
  return isOrgFeatureEnabled(prisma, organizationId, CALENDAR_STYLE_FLAG);
}

const idOf = (v: unknown): string | null => (typeof v === 'string' && v.trim() ? v.trim().slice(0, 100) : null);
const nameOf = (v: unknown): string | null => (typeof v === 'string' && v.trim() ? v.trim().slice(0, 120) : null);

/** A stored value as meta (anything malformed reads as empty). */
export function jobStyleOf(raw: unknown): JobStyleMeta {
  const v: any = raw && typeof raw === 'object' && !Array.isArray(raw) ? raw : {};
  const crew = dedupeCrewTeam(crewOf(v.crew), teamOf(v.team));
  return {
    salespersonId: idOf(v.salespersonId),
    salespersonName: idOf(v.salespersonId) ? nameOf(v.salespersonName) : null,
    ptwApplicantId: idOf(v.ptwApplicantId),
    ptwApplicantName: idOf(v.ptwApplicantId) ? nameOf(v.ptwApplicantName) : null,
    cod: v.cod === true,
    postponed: v.postponed === true,
    sticker: v.sticker === true,
    createdById: idOf(v.createdById),
    team: crew.team,
    crew: crew.crew,
    calendarCancel: cancelOf(v.calendarCancel),
    shopName: shopNameOf(v.shopName),
    postponedTo: linkOf(v.postponedTo),
    postponedFrom: linkOf(v.postponedFrom),
    recordOnly: v.recordOnly === true,
  };
}

/** "Team A + Guru": one line, at most 120 characters (null when empty). */
export const TEAM_MAX = 120;
export function teamOf(v: unknown): string | null {
  const s = typeof v === 'string' ? v.replace(/\s+/g, ' ').trim() : '';
  return s ? s.slice(0, TEAM_MAX) : null;
}

const cancelOf = (v: any): JobStyleMeta['calendarCancel'] =>
  v && typeof v === 'object' && typeof v.from === 'string' && v.from && typeof v.at === 'string' ? { from: v.from, at: v.at, byId: idOf(v.byId) } : null;

/**
 * The fields a form sent, as a partial update (keys left out are kept).
 * salesperson / ptwApplicant: { id, name } or null (cleared); cod / postponed / sticker: booleans.
 * team: free text or null. The creator and the calendar cancel mark are never taken from a form.
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
  if (body && 'team' in body) {
    if (body.team !== null && typeof body.team !== 'string') throw new BadRequestException('Team / crew must be text');
    out.team = teamOf(body.team);
  }
  if (body && 'shopName' in body) {
    if (body.shopName !== null && typeof body.shopName !== 'string') throw new BadRequestException('Shop name must be text');
    out.shopName = shopNameOf(body.shopName);
  }
  // Round 39 B4: picked teams / workers (names are re-read from the org's Workers & Teams before saving).
  if (body && 'crew' in body) {
    if (body.crew !== null && !Array.isArray(body.crew)) throw new BadRequestException('Team / crew picks must be a list');
    out.crew = crewOf(body.crew);
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
