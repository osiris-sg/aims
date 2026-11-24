import { BadRequestException, ForbiddenException, Injectable, NotFoundException, Optional } from '@nestjs/common';
import { PrismaService } from '../common/prisma.service';
import { ClerkIdentityService } from '../clerk/clerk-identity.service';
import { displayNameOf, primaryEmailOf } from '../users/users.service';
import { isCalendarStyleEnabled, jobCreatorIds } from '../deliveries/job-style';
import { PtwApplicantList, applicantBars, cleanApplicantList, readApplicantList, visibleApplicants, writeApplicantList } from '../deliveries/ptw-applicants';
import { DEFAULT_EXPORT_HEADER, cleanExportHeader, readExportHeader, writeExportHeader } from './calendar-export';
import { AUTO_PALETTE, BAR_PALETTE, CalendarColours, FILL_PALETTE, MIN_COLOUR_DISTANCE, NEUTRAL_FILL, PTW_STATUS_COLOUR_KEYS, PTW_STATUS_LABEL, PanelPerson, PtwStatusColours, colourClash, colourDistance, coloursOf, normHex, panelPeople, personSettingsOf } from './calendar-style';
import { readPtwStatusColours, writePtwStatusColours } from './calendar-ptw-colours';
import { hasOrgSettingsEdit } from '../access/role-guard';
import type { AdminActor } from '../auth/admin-scope';

export interface CalendarPerson {
  id: string;
  name: string;
  email: string | null;
  /** A role named "Sales" or a salesman code in this org. */
  sales: boolean;
  fill: string | null;
  bar: string | null;
  ptwDefault: boolean;
}

interface Member {
  userId: string;
  salesmanCode: string | null;
  settings: unknown;
  roles: string[];
}

/** Sales = a role named "Sales" (any case) or a salesman code in this org. */
export const isSalesMember = (m: { roles: string[]; salesmanCode: string | null }) => !!m.salesmanCode?.trim() || m.roles.some((r) => r.trim().toLowerCase() === 'sales');

/**
 * Jobs calendar style (enableCalendarStyle): the people behind the colours.
 * Colours live per person per org in UserOrganization.settings.calendar
 * ({ fill, bar, ptwDefault }); names come from Clerk (cached), never stored.
 */
@Injectable()
export class CalendarStyleService {
  constructor(
    private readonly prisma: PrismaService,
    @Optional() private readonly clerk?: ClerkIdentityService,
  ) {}

  enabled(organizationId: string) {
    return isCalendarStyleEnabled(this.prisma, organizationId);
  }

  private async assertOn(organizationId: string) {
    if (!(await this.enabled(organizationId))) throw new NotFoundException('Calendar colours are not enabled for this organisation');
  }

  private async members(organizationId: string): Promise<Member[]> {
    const [uos, roles] = await Promise.all([
      this.prisma.userOrganization.findMany({ where: { organizationId, isActive: true }, select: { userId: true, salesmanCode: true, settings: true } }),
      this.prisma.userRole.findMany({ where: { organizationId, isActive: true }, select: { userId: true, role: { select: { name: true } } } }),
    ]);
    const byUser = new Map<string, string[]>();
    for (const r of roles as any[]) byUser.set(r.userId, [...(byUser.get(r.userId) ?? []), r.role?.name ?? '']);
    return (uos as any[]).map((u) => ({ userId: u.userId, salesmanCode: u.salesmanCode ?? null, settings: u.settings ?? null, roles: byUser.get(u.userId) ?? [] }));
  }

  /** Display names for user ids (Clerk, cached 5 min); unknown ids are left out. */
  async names(ids: Iterable<string | null | undefined>): Promise<Map<string, { name: string; email: string | null }>> {
    const out = new Map<string, { name: string; email: string | null }>();
    if (!this.clerk) return out;
    try {
      const users = await this.clerk.toClerkUsers(ids);
      for (const [id, u] of users) out.set(id, { name: displayNameOf(u), email: primaryEmailOf(u) });
    } catch {
      // Names are decoration: the calendar never fails on Clerk.
    }
    return out;
  }

  /** The org's colours (no Clerk call; the default applicant's name is filled by the caller when needed). */
  async colours(organizationId: string): Promise<CalendarColours> {
    const [members, list, ptwStatus] = await Promise.all([this.members(organizationId), readApplicantList(this.prisma, organizationId), readPtwStatusColours(this.prisma, organizationId)]);
    const out = withApplicantList(coloursOf(members), list);
    return Object.keys(ptwStatus).length ? { ...out, ptwStatus } : out;
  }

  /** Salesman code (upper case) -> user id, for quotations' salesman field. */
  async salesmanCodes(organizationId: string): Promise<Map<string, string>> {
    const rows: any[] = await this.prisma.userOrganization.findMany({ where: { organizationId, salesmanCode: { not: null } }, select: { userId: true, salesmanCode: true } });
    return new Map(rows.filter((r) => r.salesmanCode?.trim()).map((r) => [String(r.salesmanCode).trim().toUpperCase(), r.userId as string]));
  }

  /** Settings > Job fields > Calendar colours: every member, their colours, the palettes. */
  async settings(organizationId: string) {
    await this.assertOn(organizationId);
    const members = await this.members(organizationId);
    const names = await this.names(members.map((m) => m.userId));
    const people: CalendarPerson[] = members
      .map((m) => {
        const s = personSettingsOf(m.settings);
        const n = names.get(m.userId);
        return { id: m.userId, name: n?.name ?? m.userId, email: n?.email ?? null, sales: isSalesMember(m), fill: s.fill, bar: s.bar, ptwDefault: s.ptwDefault };
      })
      .sort((a, b) => a.name.localeCompare(b.name));
    // ptwList: the org manages PTW applicants as a list (Settings > Job fields > PTW applicants), so the people
    // table's PTW colour and default columns are not used.
    const list = await readApplicantList(this.prisma, organizationId);
    return { people, palettes: { fill: [...FILL_PALETTE], bar: [...BAR_PALETTE] }, neutral: NEUTRAL_FILL, ptwList: !!list };
  }

  /** Settings > Job fields > PTW applicants: the list (null: none yet), the logins it can link to, the colours. */
  async applicants(organizationId: string) {
    await this.assertOn(organizationId);
    const [members, list] = await Promise.all([this.members(organizationId), readApplicantList(this.prisma, organizationId)]);
    const names = await this.names(members.map((m) => m.userId));
    const users = members
      .map((m) => ({ id: m.userId, name: names.get(m.userId)?.name ?? m.userId, email: names.get(m.userId)?.email ?? null }))
      .sort((a, b) => a.name.localeCompare(b.name));
    // A linked login that is no longer a member still shows on its entry.
    for (const e of list?.entries ?? []) {
      if (e.userId && !users.some((u) => u.id === e.userId)) {
        const n = (await this.names([e.userId])).get(e.userId);
        users.push({ id: e.userId, name: n?.name ?? 'Former user', email: n?.email ?? null });
      }
    }
    return { list, users, palette: [...BAR_PALETTE] };
  }

  /**
   * Save the PTW applicants list: { entries: [{ id?, name, colour, userId?, hidden? }], defaultId }.
   * A colour may not be close to a salesperson colour (the bar must read apart from the fill).
   */
  async saveApplicants(organizationId: string, body: any) {
    await this.assertOn(organizationId);
    const members = await this.members(organizationId);
    const current = await readApplicantList(this.prisma, organizationId);
    // Members may be linked; a login already linked (no longer a member) may stay on its entry.
    const allowed = new Set([...members.map((m) => m.userId), ...(current?.entries ?? []).map((e) => e.userId).filter((x): x is string => !!x)]);
    const list = cleanApplicantList(body, allowed);
    const fills = members.map((m) => personSettingsOf(m.settings).fill).filter((x): x is string => !!x);
    const clash = colourClash(fills, list.entries.filter((e) => !e.hidden).map((e) => e.colour));
    if (clash) throw new BadRequestException(`The PTW colour ${clash.bar} is too close to the salesperson colour ${clash.fill}. Pick another.`);
    await writeApplicantList(this.prisma, organizationId, list);
    return this.applicants(organizationId);
  }

  /**
   * Save colours: { people: [{ id, fill, bar, ptwDefault }] } (people left out
   * keep theirs). A bar colour may not be close to any fill colour; at most one
   * default PTW applicant.
   */
  async save(organizationId: string, body: any) {
    await this.assertOn(organizationId);
    const list: any[] = Array.isArray(body?.people) ? body.people : [];
    if (!list.length) throw new BadRequestException('Send the people to save');
    const members = await this.members(organizationId);
    const byId = new Map(members.map((m) => [m.userId, m]));
    const next = new Map(members.map((m) => [m.userId, personSettingsOf(m.settings)]));
    for (const p of list) {
      const id = typeof p?.id === 'string' ? p.id : '';
      if (!byId.has(id)) throw new BadRequestException('A person is not a member of this organisation');
      const fill = p.fill === null || p.fill === '' ? null : normHex(p.fill);
      const bar = p.bar === null || p.bar === '' ? null : normHex(p.bar);
      if (p.fill && !fill) throw new BadRequestException('Colours are #rrggbb');
      if (p.bar && !bar) throw new BadRequestException('Colours are #rrggbb');
      next.set(id, { fill, bar, ptwDefault: p.ptwDefault === true });
    }
    const all = [...next.values()];
    if (all.filter((s) => s.ptwDefault).length > 1) throw new BadRequestException('Pick one default PTW applicant');
    // With a PTW applicants list the bars are the list's colours (the people's own bar colours are unused).
    const ptwList = await readApplicantList(this.prisma, organizationId);
    const statusBars = Object.values(await readPtwStatusColours(this.prisma, organizationId));
    const bars = [...(ptwList ? ptwList.entries.filter((e) => !e.hidden).map((e) => e.colour) : all.map((s) => s.bar).filter((x): x is string => !!x)), ...statusBars];
    const clash = colourClash(all.map((s) => s.fill).filter((x): x is string => !!x), bars);
    if (clash) throw new BadRequestException(`The PTW colour ${clash.bar} is too close to the salesperson colour ${clash.fill}. Pick another.`);
    for (const [id, s] of next) {
      const m = byId.get(id)!;
      const cur = personSettingsOf(m.settings);
      if (cur.fill === s.fill && cur.bar === s.bar && cur.ptwDefault === s.ptwDefault) continue;
      const base = m.settings && typeof m.settings === 'object' ? (m.settings as Record<string, unknown>) : {};
      await this.prisma.userOrganization.update({
        where: { userId_organizationId: { userId: id, organizationId } },
        data: { settings: { ...base, calendar: { fill: s.fill, bar: s.bar, ptwDefault: s.ptwDefault } } as any },
      });
    }
    return this.settings(organizationId);
  }

  /** Settings > Job fields > WhatsApp list (2026-11-20): the header line of the calendar's Export list. */
  async exportHeader(organizationId: string) {
    await this.assertOn(organizationId);
    return { ...(await readExportHeader(this.prisma, organizationId)), defaultHeader: DEFAULT_EXPORT_HEADER };
  }

  async saveExportHeader(organizationId: string, body: any) {
    await this.assertOn(organizationId);
    await writeExportHeader(this.prisma, organizationId, cleanExportHeader(body?.header));
    return this.exportHeader(organizationId);
  }

  // ── Org Settings > Calendar colours (2026-11-25) ──────────────────────────────────────────────────────────────

  /** Org Settings edit (or the platform admin): who may open and save the Calendar colours page. */
  async canEditColours(organizationId: string, actor: AdminActor): Promise<boolean> {
    if (actor.platform) return true;
    if (!actor.userId) return false;
    return hasOrgSettingsEdit(this.prisma, organizationId, actor.userId);
  }

  private async assertColoursEditor(organizationId: string, actor: AdminActor) {
    await this.assertOn(organizationId);
    if (!(await this.canEditColours(organizationId, actor))) throw new ForbiddenException('Only someone with Org Settings edit can change the calendar colours');
  }

  /**
   * The page: People (the calendar's People list plus anyone with a picked colour) with today's colour (picked or
   * automatic), the PTW stripe colour per status (null = the applicant's colour), and the colours each may take
   * (people: not close to a PTW stripe colour; PTW: not close to a picked salesperson colour).
   */
  async coloursPage(organizationId: string, actor: AdminActor) {
    await this.assertColoursEditor(organizationId, actor);
    const [members, list, ptwStatus, creators] = await Promise.all([
      this.members(organizationId),
      readApplicantList(this.prisma, organizationId),
      readPtwStatusColours(this.prisma, organizationId),
      this.creatorIds(organizationId),
    ]);
    const fills = coloursOf(members).fill;
    const ids = new Set<string>([...creators, ...Object.keys(fills)]);
    for (const m of members) if (isSalesMember(m)) ids.add(m.userId);
    const names = await this.names(ids);
    const people = panelPeople([...ids].map((id) => ({ id, name: names.get(id)?.name ?? 'Former user' })), fills);
    const bars = [...(list ? list.entries.filter((e) => !e.hidden).map((e) => e.colour) : Object.values(coloursOf(members).bar)), ...Object.values(ptwStatus)];
    const far = (c: string, others: string[]) => others.every((o) => colourDistance(c, o) >= MIN_COLOUR_DISTANCE);
    const uniq = (xs: readonly string[]) => [...new Set(xs.map((x) => x.toLowerCase()))];
    return {
      people: people.map((p) => ({ id: p.id, name: p.name, colour: p.colour, auto: p.auto })),
      ptw: PTW_STATUS_COLOUR_KEYS.map((k) => ({ status: k, label: PTW_STATUS_LABEL[k], colour: ptwStatus[k] ?? null })),
      applicants: (list?.entries ?? []).filter((e) => !e.hidden).map((e) => ({ name: e.name, colour: e.colour })),
      palettes: {
        people: uniq([...FILL_PALETTE, ...AUTO_PALETTE]).filter((c) => far(c, bars)),
        ptw: uniq([...BAR_PALETTE, '#1e64c8', '#e8b500', '#7b1fa2', '#00838f']).filter((c) => far(c, [...Object.values(fills), NEUTRAL_FILL])),
      },
    };
  }

  /**
   * Save the page: { people: [{ id, colour }] (null = automatic again), ptw: { REQUIRED: '#…' | null, … } }. People
   * left out keep theirs. A PTW stripe colour may not be close to a salesperson colour (the stripe must read apart).
   */
  async saveColoursPage(organizationId: string, actor: AdminActor, body: any) {
    await this.assertColoursEditor(organizationId, actor);
    const sent: any[] = Array.isArray(body?.people) ? body.people : [];
    const members = await this.members(organizationId);
    const byId = new Map(members.map((m) => [m.userId, m]));
    const fills = new Map(members.map((m) => [m.userId, personSettingsOf(m.settings)]));
    const changed = new Set<string>();
    for (const p of sent) {
      const id = typeof p?.id === 'string' ? p.id : '';
      if (!byId.has(id)) throw new BadRequestException('A person is not a member of this organisation');
      const colour = p.colour === null || p.colour === '' ? null : normHex(p.colour);
      if (p.colour && !colour) throw new BadRequestException('Colours are #rrggbb');
      const cur = fills.get(id)!;
      if (cur.fill !== colour) {
        fills.set(id, { ...cur, fill: colour });
        changed.add(id);
      }
    }
    const current = await readPtwStatusColours(this.prisma, organizationId);
    let ptw: PtwStatusColours = current;
    if (body?.ptw && typeof body.ptw === 'object') {
      ptw = {};
      for (const k of PTW_STATUS_COLOUR_KEYS) {
        const v = body.ptw[k];
        if (v === undefined) {
          if (current[k]) ptw[k] = current[k];
          continue;
        }
        if (v === null || v === '') continue;
        const c = normHex(v);
        if (!c) throw new BadRequestException('Colours are #rrggbb');
        ptw[k] = c;
      }
    }
    const list = await readApplicantList(this.prisma, organizationId);
    const allFills = [...fills.values()].map((s) => s.fill).filter((x): x is string => !!x);
    const applicantBars = list ? list.entries.filter((e) => !e.hidden).map((e) => e.colour) : [...fills.values()].map((s) => s.bar).filter((x): x is string => !!x);
    const clash = colourClash(allFills, [...applicantBars, ...Object.values(ptw)]);
    if (clash) throw new BadRequestException(`The PTW colour ${clash.bar} is too close to the salesperson colour ${clash.fill}. Pick another.`);
    for (const id of changed) {
      const m = byId.get(id)!;
      const s = fills.get(id)!;
      const base = m.settings && typeof m.settings === 'object' ? (m.settings as Record<string, unknown>) : {};
      await this.prisma.userOrganization.update({
        where: { userId_organizationId: { userId: id, organizationId } },
        data: { settings: { ...base, calendar: { fill: s.fill, bar: s.bar, ptwDefault: s.ptwDefault } } as any },
      });
    }
    const sameKeys = (a: PtwStatusColours, b: PtwStatusColours) => PTW_STATUS_COLOUR_KEYS.every((k) => (a[k] ?? null) === (b[k] ?? null));
    if (!sameKeys(current, ptw)) await writePtwStatusColours(this.prisma, organizationId, ptw);
    return this.coloursPage(organizationId, actor);
  }

  /** Everyone who made a job or a calendar note in the org (the same people as the calendar's People list). */
  private async creatorIds(organizationId: string): Promise<string[]> {
    const [jobs, notes] = await Promise.all([
      jobCreatorIds(this.prisma, organizationId),
      this.prisma.calendarNote.findMany({ where: { organizationId, createdById: { not: null } }, select: { createdById: true }, distinct: ['createdById'] }),
    ]);
    return [...new Set([...jobs, ...(notes as any[]).map((n) => n.createdById as string)])];
  }

  /**
   * The calendar's people list (2026-11-19): everyone who made a job or a note in the org, plus every Sales member
   * (even with none yet), each with their salesperson colour or an automatic one. Names from Clerk; a person Clerk
   * no longer knows shows as "Former user".
   */
  async panel(organizationId: string, creatorIds: Iterable<string>): Promise<PanelPerson[]> {
    const members = await this.members(organizationId);
    const ids = new Set<string>([...creatorIds].filter(Boolean));
    for (const m of members) if (isSalesMember(m)) ids.add(m.userId);
    const names = await this.names(ids);
    return panelPeople([...ids].map((id) => ({ id, name: names.get(id)?.name ?? 'Former user' })), coloursOf(members).fill);
  }

  /**
   * The job forms' pickers: salespeople (Sales members, plus anyone with a
   * fill colour), every member as a PTW applicant, and the defaults: the
   * viewer when they are Sales, the org's default applicant.
   */
  async formPeople(organizationId: string, viewerId: string | null) {
    if (!(await this.enabled(organizationId))) return { enabled: false as const };
    const [members, list] = await Promise.all([this.members(organizationId), readApplicantList(this.prisma, organizationId)]);
    const names = await this.names(members.map((m) => m.userId));
    const person = (id: string) => ({ id, name: names.get(id)?.name ?? id });
    const colours = coloursOf(members);
    const salespeople = members.filter((m) => isSalesMember(m) || colours.fill[m.userId]).map((m) => person(m.userId));
    const applicants = members.map((m) => person(m.userId));
    const byName = (a: { name: string }, b: { name: string }) => a.name.localeCompare(b.name);
    const viewer = viewerId ? members.find((m) => m.userId === viewerId) : null;
    const defaultSalesperson = viewer && isSalesMember(viewer) ? person(viewer.userId) : null;
    if (list) {
      // PTW applicants list (2026-11-19): only its visible entries, in list order; the default from the list.
      const d = list.entries.find((e) => e.id === list.defaultId) ?? null;
      return {
        enabled: true as const,
        salespeople: salespeople.sort(byName),
        applicants: visibleApplicants(list),
        applicantsFromList: true as const,
        defaultSalesperson,
        defaultApplicant: d ? { id: d.id, name: d.name } : null,
      };
    }
    return {
      enabled: true as const,
      salespeople: salespeople.sort(byName),
      applicants: applicants.sort(byName),
      defaultSalesperson,
      defaultApplicant: colours.defaultApplicant ? person(colours.defaultApplicant.id) : null,
    };
  }
}

/** An org with a PTW applicants list: bar colours and the default applicant come from the list only. */
export function withApplicantList(colours: CalendarColours, list: PtwApplicantList | null): CalendarColours {
  if (!list) return colours;
  const d = list.entries.find((e) => e.id === list.defaultId) ?? null;
  return { ...colours, bar: applicantBars(list), defaultApplicant: d ? { id: d.id, name: d.name } : null, ptwList: list };
}
