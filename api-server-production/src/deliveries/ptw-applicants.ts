import { BadRequestException } from '@nestjs/common';
import { runAsOrg } from '../common/tenancy/tenant-context';
import { JOB_ENTITY } from './job-fields';

/**
 * PTW applicants list (WCT group, 2026-11-19, same setting as the calendar style: enableCalendarStyle).
 * Settings > Job fields > PTW applicants: a managed list, each entry = name + bar colour + an optional
 * link to an AIMS user (Kherry has no login). Add / rename / reorder / hide; one entry is the default.
 * The PTW applicant pickers (New job, job page, Add job) offer only the visible entries, and the
 * calendar's PTW bar takes its colour from here.
 *
 * No schema change: the list is a storage-only CustomField (entityType 'Delivery', fieldName
 * 'ptw_applicants', fieldType 'json', isActive FALSE so the job fields editor and the generic custom
 * field lists never see it). options = the entries in order, defaultValue = the default entry's id.
 *
 * An org WITHOUT the row (every org but the seeded WCT group) keeps the old behaviour: every member
 * can be picked and bar colours / the default come from Calendar colours.
 *
 * A job stores the picked entry's id (pta_…). Jobs saved before the list store a user id: they read as
 * the entry linked to that user. A stored applicant that matches no entry (or a hidden one) still shows
 * on its job, marked as not in the list, so nothing is lost.
 */
export const PTW_APPLICANTS_FIELD = 'ptw_applicants';
const MAX_ENTRIES = 30;
const MAX_NAME = 60;

export interface PtwApplicant {
  id: string;
  name: string;
  colour: string;
  /** The AIMS user this entry stands for (null: a name only, no login). */
  userId: string | null;
  hidden: boolean;
}

export interface PtwApplicantList {
  entries: PtwApplicant[];
  defaultId: string | null;
}

const HEX = /^#[0-9a-f]{6}$/;
const hexOf = (v: unknown): string | null => {
  const s = typeof v === 'string' ? v.trim().toLowerCase() : '';
  return HEX.test(s) ? s : null;
};
const slug = (s: string) => s.toLowerCase().normalize('NFD').replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 30) || 'x';

/** The stored row as a list (null when there is no usable list). */
export function applicantListOf(row: { options?: unknown; defaultValue?: string | null } | null | undefined): PtwApplicantList | null {
  if (!row || !Array.isArray(row.options)) return null;
  const entries: PtwApplicant[] = [];
  for (const v of row.options as any[]) {
    if (!v || typeof v !== 'object') continue;
    const id = typeof v.id === 'string' && v.id.trim() ? v.id.trim() : null;
    const name = typeof v.name === 'string' ? v.name.replace(/\s+/g, ' ').trim() : '';
    const colour = hexOf(v.colour);
    if (!id || !name || !colour) continue;
    entries.push({ id, name, colour, userId: typeof v.userId === 'string' && v.userId.trim() ? v.userId.trim() : null, hidden: v.hidden === true });
  }
  if (!entries.length) return null;
  const visible = entries.filter((e) => !e.hidden);
  const d = row.defaultValue && visible.some((e) => e.id === row.defaultValue) ? row.defaultValue : visible[0]?.id ?? null;
  return { entries, defaultId: d };
}

/**
 * A list sent by Settings made clean: names trimmed and unique (any case), colours #rrggbb, ids kept
 * (new entries get pta_<name>, made unique), a user linked to at most one entry, at least one visible
 * entry, and the default a visible entry (else the first visible one). Throws on anything invalid.
 */
export function cleanApplicantList(body: any, memberIds?: Set<string>): PtwApplicantList {
  const raw: any[] = Array.isArray(body?.entries) ? body.entries : null;
  if (!raw) throw new BadRequestException('Send the list of PTW applicants');
  const entries: PtwApplicant[] = [];
  const names = new Set<string>();
  const ids = new Set<string>();
  const users = new Set<string>();
  for (const v of raw) {
    const name = String(v?.name ?? '').replace(/\s+/g, ' ').trim();
    if (!name) throw new BadRequestException('Every PTW applicant needs a name');
    if (name.length > MAX_NAME) throw new BadRequestException(`A name is limited to ${MAX_NAME} characters`);
    if (names.has(name.toLowerCase())) throw new BadRequestException(`"${name}" is on the list twice`);
    names.add(name.toLowerCase());
    const colour = hexOf(v?.colour);
    if (!colour) throw new BadRequestException(`Pick a colour for ${name}`);
    const userId = typeof v?.userId === 'string' && v.userId.trim() ? v.userId.trim() : null;
    if (userId && memberIds && !memberIds.has(userId)) throw new BadRequestException(`The login linked to ${name} is not a member of this organisation`);
    if (userId && users.has(userId)) throw new BadRequestException('A login can be linked to one PTW applicant only');
    if (userId) users.add(userId);
    let id = typeof v?.id === 'string' && /^pta_[a-z0-9-]{1,40}$/.test(v.id) ? v.id : `pta_${slug(name)}`;
    for (let n = 2; ids.has(id); n++) id = `pta_${slug(name)}-${n}`;
    ids.add(id);
    entries.push({ id, name, colour, userId, hidden: v?.hidden === true });
  }
  if (entries.length > MAX_ENTRIES) throw new BadRequestException(`At most ${MAX_ENTRIES} PTW applicants`);
  const visible = entries.filter((e) => !e.hidden);
  if (!visible.length) throw new BadRequestException('Keep at least one PTW applicant shown');
  const wanted = typeof body?.defaultId === 'string' ? body.defaultId : null;
  const byName = typeof body?.defaultName === 'string' ? visible.find((e) => e.name.toLowerCase() === body.defaultName.trim().toLowerCase()) : null;
  const defaultId = (wanted && visible.some((e) => e.id === wanted) ? wanted : null) ?? byName?.id ?? visible[0].id;
  return { entries, defaultId };
}

/** The entry a job's stored applicant stands for: its id (pta_…), else the user it is linked to. Hidden entries count. */
export function applicantEntryOf(list: PtwApplicantList | null | undefined, key: string | null | undefined): PtwApplicant | null {
  if (!list || !key) return null;
  return list.entries.find((e) => e.id === key) ?? list.entries.find((e) => e.userId === key) ?? null;
}

/**
 * What a job shows for its stored applicant: the entry (name from the list) when it is a visible entry,
 * else the stored value marked as not in the list (a hidden entry keeps its name).
 */
export function applicantView(
  list: PtwApplicantList,
  key: string | null | undefined,
  fallbackName: string | null | undefined,
): { id: string; name: string | null; inList: boolean } | null {
  if (!key) return null;
  const e = applicantEntryOf(list, key);
  if (e && !e.hidden) return { id: e.id, name: e.name, inList: true };
  return { id: e?.id ?? key, name: e?.name ?? fallbackName ?? null, inList: false };
}

/** Bar colours from the list: keyed by the entry id AND its linked user (jobs saved before the list). */
export function applicantBars(list: PtwApplicantList): Record<string, string> {
  const out: Record<string, string> = {};
  for (const e of list.entries) {
    out[e.id] = e.colour;
    if (e.userId && !out[e.userId]) out[e.userId] = e.colour;
  }
  return out;
}

/** The pickers' options: the visible entries, in list order. */
export const visibleApplicants = (list: PtwApplicantList) => list.entries.filter((e) => !e.hidden).map((e) => ({ id: e.id, name: e.name, colour: e.colour }));

/** The org's list (null: no list, the old behaviour). */
export async function readApplicantList(prisma: any, organizationId: string): Promise<PtwApplicantList | null> {
  const row = await runAsOrg(organizationId, () =>
    prisma.customField.findFirst({ where: { organizationId, entityType: JOB_ENTITY, fieldName: PTW_APPLICANTS_FIELD }, select: { options: true, defaultValue: true } }),
  );
  return applicantListOf(row);
}

/** Store the list (makes the storage row on the first save). */
export async function writeApplicantList(prisma: any, organizationId: string, list: PtwApplicantList): Promise<void> {
  await runAsOrg(organizationId, async () => {
    const row = await prisma.customField.findFirst({ where: { organizationId, entityType: JOB_ENTITY, fieldName: PTW_APPLICANTS_FIELD }, select: { id: true } });
    const data = { options: list.entries as any, defaultValue: list.defaultId };
    if (row) {
      await prisma.customField.update({ where: { id: row.id }, data });
      return;
    }
    await prisma.customField.create({
      data: {
        organizationId,
        entityType: JOB_ENTITY,
        fieldName: PTW_APPLICANTS_FIELD,
        displayLabel: 'PTW applicants',
        fieldType: 'json',
        required: false,
        isActive: false,
        showInList: false,
        showInForm: false,
        sortOrder: 0,
        ...data,
      },
    });
  });
}
