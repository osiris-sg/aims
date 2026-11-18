import { BadRequestException, Injectable, NotFoundException, Optional } from '@nestjs/common';
import { PrismaService } from '../common/prisma.service';
import { ClerkIdentityService } from '../clerk/clerk-identity.service';
import { displayNameOf, primaryEmailOf } from '../users/users.service';
import { isCalendarStyleEnabled } from '../deliveries/job-style';
import { BAR_PALETTE, CalendarColours, FILL_PALETTE, NEUTRAL_FILL, PanelPerson, colourClash, coloursOf, normHex, panelPeople, personSettingsOf } from './calendar-style';

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
    return coloursOf(await this.members(organizationId));
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
    return { people, palettes: { fill: [...FILL_PALETTE], bar: [...BAR_PALETTE] }, neutral: NEUTRAL_FILL };
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
    const clash = colourClash(all.map((s) => s.fill).filter((x): x is string => !!x), all.map((s) => s.bar).filter((x): x is string => !!x));
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
    const members = await this.members(organizationId);
    const names = await this.names(members.map((m) => m.userId));
    const person = (id: string) => ({ id, name: names.get(id)?.name ?? id });
    const colours = coloursOf(members);
    const salespeople = members.filter((m) => isSalesMember(m) || colours.fill[m.userId]).map((m) => person(m.userId));
    const applicants = members.map((m) => person(m.userId));
    const byName = (a: { name: string }, b: { name: string }) => a.name.localeCompare(b.name);
    const viewer = viewerId ? members.find((m) => m.userId === viewerId) : null;
    return {
      enabled: true as const,
      salespeople: salespeople.sort(byName),
      applicants: applicants.sort(byName),
      defaultSalesperson: viewer && isSalesMember(viewer) ? person(viewer.userId) : null,
      defaultApplicant: colours.defaultApplicant ? person(colours.defaultApplicant.id) : null,
    };
  }
}
