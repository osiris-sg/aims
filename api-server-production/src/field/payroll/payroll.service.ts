/**
 * Field > Payroll (FIELD_PLAN.md phase 6). Ported from siteclock @62b7d9d payroll.router (month, profiles with the same
 * validation, holidays, export, payslip) over the ported engine (payroll-engine.ts). No CPF, same as SiteClock.
 * Oddities shown: monthly salary not prorated, admins left out (listed), payroll counts workdays (leave counts calendar days).
 */
import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { z } from 'zod';
import { PrismaService } from '../../common/prisma.service';
import { FieldCtx } from '../common/field-context.service';
import { computeMonthlyPayroll, deriveRates, EMPTY_PROFILE, payrollExport } from './payroll-engine';

const monthSchema = z.string().regex(/^\d{4}-\d{2}$/);
export const profileBody = z.object({
  payType: z.enum(['MONTHLY', 'DAILY', 'HOURLY']).default('MONTHLY'),
  hourlyRateCents: z.number().int().min(0).max(1_000_00).default(0),
  restDays: z.array(z.number().int().min(1).max(7)).max(7).default([]),
  premiumMode: z.enum(['DOUBLE_DAY', 'OT_RATE', 'FIXED_HOURLY']).default('DOUBLE_DAY'),
  premiumRateCents: z.number().int().min(0).max(1_000_00).default(0),
  weekdayOt: z.boolean().default(true),
  basicMonthlyCents: z.number().int().min(0).max(100_000_00).default(0),
  fixedAllowanceCents: z.number().int().min(0).max(100_000_00).default(0),
  deductHousingCents: z.number().int().min(0).max(100_000_00).default(0),
  deductOtherCents: z.number().int().min(0).max(100_000_00).default(0),
  workDaysPerWeek: z.number().int().min(1).max(7).default(6),
  otRateCentsOverride: z.number().int().min(0).max(10_000_00).nullable().optional(),
  dailyRateCentsOverride: z.number().int().min(0).max(10_000_00).nullable().optional(),
});

@Injectable()
export class FieldPayrollService {
  constructor(private readonly prisma: PrismaService) {}
  private get db(): any {
    return this.prisma as any;
  }

  private month(m: unknown) {
    const p = monthSchema.safeParse(m);
    if (!p.success) throw new BadRequestException('Invalid month (YYYY-MM)');
    return p.data;
  }

  async month_(ctx: FieldCtx, m: unknown) {
    return computeMonthlyPayroll(this.db, ctx.organizationId, this.month(m));
  }

  /** One worker's payslip for the month (the office view; the app's own "My payslip" comes with the AIMS app). */
  async payslip(ctx: FieldCtx, workerId: string, m: unknown) {
    const out = await computeMonthlyPayroll(this.db, ctx.organizationId, this.month(m), workerId);
    const slip = out.workers[0];
    if (!slip) throw new NotFoundException('No payslip: the worker is not on payroll (admins are left out, as in SiteClock)');
    return { month: out.month, from: out.from, to: out.to, payslip: slip };
  }

  async exportRows(ctx: FieldCtx, m: unknown) {
    const out = await computeMonthlyPayroll(this.db, ctx.organizationId, this.month(m));
    return payrollExport(out.workers);
  }

  async profile(ctx: FieldCtx, workerId: string) {
    const w = await this.db.worker.findFirst({ where: { id: workerId, organizationId: ctx.organizationId } });
    if (!w) throw new NotFoundException('Worker not found');
    const p = await this.db.fieldPayProfile.findUnique({ where: { workerId } });
    const profile = p ?? EMPTY_PROFILE;
    return { profile, rates: deriveRates(profile as any), hasProfile: !!p, workerId };
  }

  async setProfile(ctx: FieldCtx, workerId: string, body: unknown) {
    const parse = profileBody.safeParse(body ?? {});
    if (!parse.success) throw new BadRequestException({ message: 'Check the pay profile', error: parse.error.flatten() });
    const w = await this.db.worker.findFirst({ where: { id: workerId, organizationId: ctx.organizationId } });
    if (!w) throw new NotFoundException('Worker not found');
    const data = { ...parse.data, otRateCentsOverride: parse.data.otRateCentsOverride ?? null, dailyRateCentsOverride: parse.data.dailyRateCentsOverride ?? null };
    const before = await this.db.fieldPayProfile.findUnique({ where: { workerId } });
    const profile = await this.db.fieldPayProfile.upsert({ where: { workerId }, update: data, create: { organizationId: ctx.organizationId, workerId, ...data } });
    return { profile, rates: deriveRates(profile), before };
  }

  async holidays(ctx: FieldCtx, year?: string) {
    const y = year && /^\d{4}$/.test(year) ? year : null;
    return { holidays: await this.db.fieldPublicHoliday.findMany({ where: { organizationId: ctx.organizationId, ...(y ? { date: { gte: `${y}-01-01`, lte: `${y}-12-31` } } : {}) }, orderBy: { date: 'asc' } }) };
  }

  /** Upsert by date (SiteClock writes no audit here: oddity; the Activity Log row exists anyway). */
  async addHoliday(ctx: FieldCtx, body: unknown) {
    const p = z.object({ date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/), name: z.string().min(1).max(100) }).safeParse(body ?? {});
    if (!p.success) throw new BadRequestException('Give a date and a name');
    const holiday = await this.db.fieldPublicHoliday.upsert({
      where: { organizationId_date: { organizationId: ctx.organizationId, date: p.data.date } },
      update: { name: p.data.name },
      create: { organizationId: ctx.organizationId, ...p.data },
    });
    return { holiday };
  }

  async deleteHoliday(ctx: FieldCtx, id: string) {
    const n = await this.db.fieldPublicHoliday.deleteMany({ where: { id, organizationId: ctx.organizationId } });
    if (!n.count) throw new NotFoundException('Not found');
    return { ok: true };
  }
}
