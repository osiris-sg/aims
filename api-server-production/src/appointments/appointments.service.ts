import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { randomBytes } from 'crypto';
import { PrismaService } from '../common/prisma.service';
import { NotificationsService } from '../notifications/notifications.service';
import { resolveTier } from '../common/role-tier';

/**
 * Designer appointment schedule (guru 2026-10-08): per-designer calendar —
 * the designer's own appointments + client self-bookings via a public link.
 * Lead appointments (Lead.appointmentAt, 1h) merge into the same busy view.
 * Clients see ONLY free slots; taken ones render unavailable with no details.
 */
const DAY = 86400000;
const SGT_OFFSET = 8 * 3600000;

@Injectable()
export class AppointmentsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly notifications: NotificationsService,
  ) {}

  /** Appointments + lead appointments, tier-scoped (designer own / junior team / senior+ all). */
  async list(organizationId: string, callerUserId: string | undefined, from?: string, to?: string) {
    const scope = await resolveTier(this.prisma, organizationId, callerUserId);
    const designerWhere =
      scope.tier === 'designer'
        ? { designerUserId: callerUserId }
        : scope.tier === 'junior'
          ? { designerUserId: { in: scope.teamUserIds || [callerUserId!] } }
          : {};
    const fromAt = from ? new Date(from) : new Date(Date.now() - 7 * DAY);
    const toAt = to ? new Date(to) : new Date(Date.now() + 30 * DAY);
    const [appointments, leads] = await Promise.all([
      this.prisma.designerAppointment.findMany({
        where: { organizationId, status: 'booked', startAt: { gte: fromAt, lte: toAt }, ...designerWhere } as any,
        orderBy: { startAt: 'asc' },
      }),
      this.prisma.lead.findMany({
        where: {
          organizationId,
          appointmentAt: { gte: fromAt, lte: toAt },
          ...(scope.tier === 'designer'
            ? { assignedToUserId: callerUserId }
            : scope.tier === 'junior'
              ? { assignedToUserId: { in: scope.teamUserIds || [callerUserId!] } }
              : {}),
        },
        select: { id: true, name: true, phone: true, appointmentAt: true, appointmentNote: true, assignedToUserId: true, assignedToName: true },
      }),
    ]);
    return {
      appointments,
      leadAppointments: leads.map((l) => ({
        id: `lead:${l.id}`,
        leadId: l.id,
        designerUserId: l.assignedToUserId,
        designerName: l.assignedToName,
        title: l.name,
        phone: l.phone,
        note: l.appointmentNote,
        startAt: l.appointmentAt,
        endAt: new Date(new Date(l.appointmentAt!).getTime() + 3600000),
        source: 'lead',
      })),
      viewer: { tier: scope.tier },
    };
  }

  async create(
    organizationId: string,
    callerUserId: string,
    callerName: string | null,
    dto: { title: string; startAt: string; endAt?: string | null; phone?: string | null; location?: string | null; note?: string | null; designerUserId?: string | null; source?: string },
  ) {
    const title = String(dto.title || '').trim();
    const startAt = new Date(dto.startAt);
    if (!title) throw new BadRequestException('Who is the appointment with?');
    if (isNaN(startAt.getTime())) throw new BadRequestException('Invalid start time');
    const endAt = dto.endAt ? new Date(dto.endAt) : new Date(startAt.getTime() + 3600000);
    // Designers book for themselves; managers may book for a designer.
    const scope = await resolveTier(this.prisma, organizationId, callerUserId);
    const designerUserId = scope.tier === 'designer' || !dto.designerUserId ? callerUserId : dto.designerUserId;
    return this.prisma.designerAppointment.create({
      data: {
        organizationId,
        designerUserId,
        designerName: designerUserId === callerUserId ? callerName : null,
        title,
        phone: dto.phone?.trim() || null,
        location: dto.location?.trim() || null,
        note: dto.note?.slice(0, 500) || null,
        startAt,
        endAt,
        source: dto.source === 'block' ? 'block' : 'designer',
      },
    });
  }

  async cancel(organizationId: string, callerUserId: string | undefined, id: string) {
    const row = await this.prisma.designerAppointment.findFirst({ where: { id, organizationId } });
    if (!row) throw new NotFoundException('Appointment not found');
    const scope = await resolveTier(this.prisma, organizationId, callerUserId);
    if (scope.tier === 'designer' && row.designerUserId !== callerUserId) throw new NotFoundException('Appointment not found');
    return this.prisma.designerAppointment.update({ where: { id }, data: { status: 'cancelled' } });
  }

  /** Mint (or reuse) the designer's personal booking link. */
  async bookingLink(organizationId: string, callerUserId: string, callerName: string | null) {
    let link = await this.prisma.designerBookingLink.findFirst({ where: { organizationId, designerUserId: callerUserId } });
    if (link?.revokedAt) {
      link = await this.prisma.designerBookingLink.update({ where: { id: link.id }, data: { revokedAt: null, token: randomBytes(24).toString('base64url') } });
    }
    if (!link) {
      link = await this.prisma.designerBookingLink.create({
        data: { organizationId, designerUserId: callerUserId, designerName: callerName, token: randomBytes(24).toString('base64url') },
      });
    }
    const base = (process.env.PORTAL_URL || process.env.FRONTEND_URL || '').replace(/\/$/, '');
    const path = `/book/${link.token}`;
    return { token: link.token, path, url: base ? `${base}${path}` : path, slotMinutes: link.slotMinutes, hourStart: link.hourStart, hourEnd: link.hourEnd, daysAhead: link.daysAhead };
  }

  async revokeBookingLink(organizationId: string, callerUserId: string) {
    await this.prisma.designerBookingLink.updateMany({ where: { organizationId, designerUserId: callerUserId }, data: { revokedAt: new Date() } });
    return { revoked: true };
  }

  /** Busy intervals for a designer: booked appointments + lead appointments (1h each). */
  private async busyIntervals(organizationId: string, designerUserId: string, fromAt: Date, toAt: Date) {
    const [appts, leads] = await Promise.all([
      this.prisma.designerAppointment.findMany({
        where: { organizationId, designerUserId, status: 'booked', startAt: { lt: toAt }, endAt: { gt: fromAt } },
        select: { startAt: true, endAt: true },
      }),
      this.prisma.lead.findMany({
        where: { organizationId, assignedToUserId: designerUserId, appointmentAt: { gte: new Date(fromAt.getTime() - 3600000), lte: toAt } },
        select: { appointmentAt: true },
      }),
    ]);
    return [
      ...appts.map((a) => ({ start: a.startAt.getTime(), end: a.endAt.getTime() })),
      ...leads.map((l) => ({ start: l.appointmentAt!.getTime(), end: l.appointmentAt!.getTime() + 3600000 })),
    ];
  }

  /** PUBLIC: the bookable slot grid. Free slots only carry times — a taken
   *  slot is just `free: false`, never who/what. */
  async publicSlots(token: string) {
    const link = await this.prisma.designerBookingLink.findUnique({ where: { token } });
    if (!link || link.revokedAt) throw new NotFoundException();
    const org = await this.prisma.organization.findUnique({ where: { id: link.organizationId }, select: { name: true, logo: true } });
    const now = Date.now();
    const days: Array<{ date: string; slots: Array<{ startAt: string; free: boolean }> }> = [];
    const fromAt = new Date(now);
    const toAt = new Date(now + link.daysAhead * DAY);
    const busy = await this.busyIntervals(link.organizationId, link.designerUserId, fromAt, toAt);
    for (let d = 0; d < link.daysAhead; d++) {
      // SGT day boundaries
      const sgtDay = new Date(Math.floor((now + SGT_OFFSET) / DAY) * DAY - SGT_OFFSET + d * DAY);
      const iso = new Date(sgtDay.getTime() + SGT_OFFSET).toISOString().slice(0, 10);
      const slots: Array<{ startAt: string; free: boolean }> = [];
      for (let h = link.hourStart; h < link.hourEnd; h += link.slotMinutes / 60) {
        const start = sgtDay.getTime() + h * 3600000;
        const end = start + link.slotMinutes * 60000;
        if (start < now + 2 * 3600000) continue; // at least 2h notice
        const free = !busy.some((b) => b.start < end && b.end > start);
        slots.push({ startAt: new Date(start).toISOString(), free });
      }
      if (slots.length) days.push({ date: iso, slots });
    }
    return { designerName: link.designerName || 'your designer', orgName: org?.name || '', orgLogo: org?.logo || null, slotMinutes: link.slotMinutes, days };
  }

  /** PUBLIC: book one free slot. Race-safe: re-checks inside the write path. */
  async publicBook(token: string, dto: { name: string; phone: string; note?: string | null; startAt: string }) {
    const link = await this.prisma.designerBookingLink.findUnique({ where: { token } });
    if (!link || link.revokedAt) throw new NotFoundException();
    const name = String(dto.name || '').trim();
    const phone = String(dto.phone || '').replace(/[^0-9+ ]/g, '').trim();
    if (!name || !phone) throw new BadRequestException('Name and phone are required');
    const startAt = new Date(dto.startAt);
    if (isNaN(startAt.getTime())) throw new BadRequestException('Invalid slot');
    const endAt = new Date(startAt.getTime() + link.slotMinutes * 60000);
    if (startAt.getTime() < Date.now() + 2 * 3600000 || startAt.getTime() > Date.now() + link.daysAhead * DAY) {
      throw new BadRequestException('That slot is no longer available');
    }
    // slot must be on the grid
    const sgtHour = ((startAt.getTime() + SGT_OFFSET) % DAY) / 3600000;
    if (sgtHour < link.hourStart || sgtHour >= link.hourEnd) throw new BadRequestException('That slot is no longer available');
    const busy = await this.busyIntervals(link.organizationId, link.designerUserId, startAt, endAt);
    if (busy.some((b) => b.start < endAt.getTime() && b.end > startAt.getTime())) {
      throw new ConflictException('That slot was just taken — please pick another');
    }
    const row = await this.prisma.designerAppointment.create({
      data: {
        organizationId: link.organizationId,
        designerUserId: link.designerUserId,
        designerName: link.designerName,
        title: name,
        phone,
        note: dto.note?.slice(0, 300) || null,
        startAt,
        endAt,
        source: 'client',
      },
    });
    await this.notifications
      .emit({
        organizationId: link.organizationId,
        kind: 'appointment_booked',
        title: `New appointment: ${name} — ${startAt.toLocaleString('en-SG', { timeZone: 'Asia/Singapore', day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' })}`,
        body: [phone, dto.note].filter(Boolean).join(' · ') || null,
        entityType: 'appointment',
        entityId: row.id,
        forUserId: link.designerUserId,
        exclusive: true,
        linkUrl: '/portal/dashboard',
      })
      .catch(() => null);
    return { booked: true, startAt: row.startAt, designerName: link.designerName || null };
  }
}
