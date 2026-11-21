// Ported from siteclock backend/src/modules/payroll/payroll.service.ts @62b7d9d. Pay math unchanged (no CPF,
// monthly salary not prorated, admins left out: SiteClock oddities kept, FIELD_PLAN.md §6.1). Reads the Field tables:
// a worker = Worker + FieldWorkerProfile (tier WORKER / SUPERVISOR, active); time = APPROVED FieldTimeEntry.
import { DateTime } from "luxon";

import { weekdayOf } from "../common/time";

/**
 * SG MOM (IPA-style) pay model, all money in cents.
 * MONTHLY (salaried):
 * - OT hourly rate  = basic × 12 / (52 × 44) × 1.5   (unless overridden)
 * - Daily basic rate = basic × 12 / (52 × workDaysPerWeek)  (unless overridden)
 * - Working a public holiday or the worker's rest day earns an extra
 *   2 × daily basic rate on top of the monthly salary.
 * - Unpaid leave docks the daily basic rate per day.
 * DAILY (rate per day worked, dailyRateCentsOverride):
 * - basic = days worked × daily rate; OT hourly = daily × workDaysPerWeek / 44 × 1.5
 *   (unless overridden); a PH / rest day worked earns one extra daily rate
 *   (double pay for that day).
 * HOURLY (hourlyRateCents):
 * - basic = regular hours × hourly; OT = hourly × 1.5 (unless overridden);
 *   regular hours on a PH / rest day are paid again (double time).
 * Rest days: the profile's restDays if set, else the days outside the
 * worker's working-hours template, else Sunday.
 *
 * premiumMode decides how a PH / rest day worked is paid, for every pay type:
 * - DOUBLE_DAY: the rules above (the day's own pay plus the premium; OT above
 *   the threshold on that day is paid on top).
 * - OT_RATE: every hour worked that day × the OT rate, instead of the day's
 *   normal pay and OT ("Sundays and public holidays count as OT").
 * - FIXED_HOURLY: every hour worked that day × premiumRateCents, likewise.
 * weekdayOt=false records OT on ordinary days but pays nothing for it
 * (fixed-pay staff who are only paid extra for Sundays and public holidays).
 */

export type PayType = "MONTHLY" | "DAILY" | "HOURLY";
export type PremiumMode = "DOUBLE_DAY" | "OT_RATE" | "FIXED_HOURLY";

export interface PayProfileInput {
  payType: PayType;
  hourlyRateCents: number;
  restDays: number[]; // 1=Mon..7=Sun
  premiumMode: PremiumMode;
  premiumRateCents: number; // FIXED_HOURLY: per hour on a PH / rest day
  weekdayOt: boolean; // pay OT on ordinary days
  basicMonthlyCents: number;
  fixedAllowanceCents: number;
  deductHousingCents: number;
  deductOtherCents: number;
  workDaysPerWeek: number;
  otRateCentsOverride: number | null;
  dailyRateCentsOverride: number | null;
}

export const EMPTY_PROFILE: PayProfileInput = {
  payType: "MONTHLY",
  hourlyRateCents: 0,
  restDays: [],
  premiumMode: "DOUBLE_DAY",
  premiumRateCents: 0,
  weekdayOt: true,
  basicMonthlyCents: 0,
  fixedAllowanceCents: 0,
  deductHousingCents: 0,
  deductOtherCents: 0,
  workDaysPerWeek: 6,
  otRateCentsOverride: null,
  dailyRateCentsOverride: null,
};

export function deriveRates(p: PayProfileInput) {
  const days = Math.max(1, p.workDaysPerWeek);
  if (p.payType === 'DAILY') {
    const dailyRateCents = p.dailyRateCentsOverride ?? 0;
    const otRateCents = p.otRateCentsOverride ?? Math.round(((dailyRateCents * days) / 44) * 1.5);
    return { otRateCents, dailyRateCents };
  }
  if (p.payType === 'HOURLY') {
    const otRateCents = p.otRateCentsOverride ?? Math.round(p.hourlyRateCents * 1.5);
    const dailyRateCents = p.dailyRateCentsOverride ?? p.hourlyRateCents * 8;
    return { otRateCents, dailyRateCents };
  }
  const otRateCents = p.otRateCentsOverride ?? Math.round(((p.basicMonthlyCents * 12) / (52 * 44)) * 1.5);
  const dailyRateCents = p.dailyRateCentsOverride ?? Math.round((p.basicMonthlyCents * 12) / (52 * days));
  return { otRateCents, dailyRateCents };
}

export interface PremiumDay {
  date: string;
  kind: 'PUBLIC_HOLIDAY' | 'REST_DAY';
  name?: string;
}
export interface LeaveDays {
  type: string;
  paid: boolean;
  days: number;
}
export interface WorkerPayroll {
  workerId: string;
  name: string;
  employeeNo: string | null;
  hasProfile: boolean;
  payslipVisible: boolean;
  profile: PayProfileInput;
  payType: PayType;
  otRateCents: number;
  dailyRateCents: number;
  basicPayCents: number;
  daysWorked: number;
  regularMinutes: number;
  otMinutes: number;
  otPaidMinutes: number;
  otPayCents: number;
  premiumDays: PremiumDay[];
  premiumMinutes: number;
  premiumMode: PremiumMode;
  premiumHourlyRateCents: number | null;
  weekdayOt: boolean;
  premiumPayCents: number;
  leaveDays: LeaveDays[];
  unpaidLeaveDeductCents: number;
  grossCents: number;
  deductionCents: number;
  netCents: number;
}

/** Rest days: the profile's own off days if set; else days NOT in their shift template; no template -> Sunday. */
function isRestDay(date: string, assignments: Array<{ startDate: string; endDate: string | null; daysOfWeek: number[] }>, restDays: number[] = []): boolean {
  if (restDays.length) return restDays.includes(weekdayOf(date));
  const active = assignments.find((a) => a.startDate <= date && (!a.endDate || a.endDate >= date));
  const workDays = active ? active.daysOfWeek : [1, 2, 3, 4, 5, 6];
  return !workDays.includes(weekdayOf(date));
}

export async function computeMonthlyPayroll(db: any, organizationId: string, month: string, onlyWorkerId?: string): Promise<{ month: string; from: string; to: string; workers: WorkerPayroll[]; leftOut: Array<{ workerId: string; name: string; tier: string }> }> {
  const start = DateTime.fromFormat(month, 'yyyy-MM');
  const from = start.toFormat('yyyy-MM-dd');
  const to = start.endOf('month').toFormat('yyyy-MM-dd');

  const all = await db.worker.findMany({ where: { organizationId, active: true, ...(onlyWorkerId ? { id: onlyWorkerId } : {}) }, orderBy: { name: 'asc' } });
  const profs = await db.fieldWorkerProfile.findMany({ where: { organizationId, workerId: { in: all.map((w: any) => w.id) } } });
  const prof = new Map(profs.map((p: any) => [p.workerId, p]));
  // SiteClock pays WORKER and SUPERVISOR tiers only (admins left out: oddity, listed).
  const users = all.filter((w: any) => ['WORKER', 'SUPERVISOR'].includes((prof.get(w.id) as any)?.tier ?? 'WORKER'));
  const leftOut = all.filter((w: any) => !users.includes(w)).map((w: any) => ({ workerId: w.id, name: w.name, tier: (prof.get(w.id) as any)?.tier }));
  const ids = users.map((u: any) => u.id);

  const [payProfiles, entries, holidays, shiftAsgs, leaves, leaveTypes, templates] = await Promise.all([
    db.fieldPayProfile.findMany({ where: { organizationId, workerId: { in: ids } } }),
    db.fieldTimeEntry.findMany({ where: { organizationId, workerId: { in: ids }, status: 'APPROVED', workDate: { gte: from, lte: to } }, select: { workerId: true, workDate: true, regularMinutes: true, otMinutes: true, otMultiplier: true } }),
    db.fieldPublicHoliday.findMany({ where: { organizationId, date: { gte: from, lte: to } } }),
    db.fieldShiftAssignment.findMany({ where: { organizationId, workerId: { in: ids } } }),
    db.fieldLeaveRequest.findMany({ where: { organizationId, workerId: { in: ids }, status: 'APPROVED', startDate: { lte: to }, endDate: { gte: from } } }),
    db.fieldLeaveType.findMany({ where: { organizationId } }),
    db.fieldShiftTemplate.findMany({ where: { organizationId } }),
  ]);
  const payOf = new Map(payProfiles.map((p: any) => [p.workerId, p]));
  const typeOf = new Map(leaveTypes.map((t: any) => [t.id, t]));
  const tplDays = new Map(templates.map((t: any) => [t.id, t.daysOfWeek]));
  const holidayByDate = new Map(holidays.map((h: any) => [h.date, h.name]));
  const asgsByUser = new Map<string, Array<{ startDate: string; endDate: string | null; daysOfWeek: number[] }>>();
  for (const a of shiftAsgs) {
    const list = asgsByUser.get(a.workerId) ?? [];
    list.push({ startDate: a.startDate, endDate: a.endDate, daysOfWeek: (tplDays.get(a.templateId) as number[]) ?? [] });
    asgsByUser.set(a.workerId, list);
  }

  const workers: WorkerPayroll[] = users.map((u: any) => {
    const stored: any = payOf.get(u.id);
    const profile: PayProfileInput = stored ? (Object.fromEntries(Object.keys(EMPTY_PROFILE).map((k) => [k, stored[k] ?? (EMPTY_PROFILE as any)[k]])) as PayProfileInput) : EMPTY_PROFILE;
    const { otRateCents, dailyRateCents } = deriveRates(profile);
    const rest = (d: string) => isRestDay(d, asgsByUser.get(u.id) ?? [], profile.restDays ?? []);
    const mine = entries.filter((e: any) => e.workerId === u.id);
    const dates = [...new Set<string>(mine.map((e: any) => e.workDate))].sort();

    const premiumDays: PremiumDay[] = [];
    for (const date of dates) {
      const phName = holidayByDate.get(date) as string | undefined;
      if (phName) premiumDays.push({ date, kind: 'PUBLIC_HOLIDAY', name: phName });
      else if (rest(date)) premiumDays.push({ date, kind: 'REST_DAY' });
    }
    const premiumSet = new Set(premiumDays.map((d) => d.date));
    const hourlyPremium = profile.premiumMode !== 'DOUBLE_DAY';
    const premiumHourlyRateCents = profile.premiumMode === 'OT_RATE' ? otRateCents : profile.premiumMode === 'FIXED_HOURLY' ? profile.premiumRateCents : null;

    let regularMinutes = 0;
    let otMinutes = 0;
    let otPaidMinutes = 0;
    let otPayCents = 0;
    let premiumMinutes = 0;
    let premiumRegularMinutes = 0;
    const regularByDate = new Map<string, number>();
    for (const e of mine) {
      const reg = e.regularMinutes ?? 0;
      const ot = e.otMinutes ?? 0;
      const onPremiumDay = premiumSet.has(e.workDate);
      regularMinutes += reg;
      regularByDate.set(e.workDate, (regularByDate.get(e.workDate) ?? 0) + reg);
      otMinutes += ot;
      if (onPremiumDay) {
        premiumMinutes += reg + ot;
        premiumRegularMinutes += reg;
      }
      const otPaid = onPremiumDay ? !hourlyPremium : profile.weekdayOt;
      if (otPaid && ot > 0) {
        otPaidMinutes += ot;
        otPayCents += Math.round((ot / 60) * otRateCents * ((e.otMultiplier ?? 1.5) / 1.5));
      }
    }

    // Approved leave this month: workdays only (template; none -> Mon-Sat), half days 0.5; unpaid types dock the daily rate.
    const leaveByType = new Map<string, LeaveDays>();
    for (const lr of leaves.filter((l: any) => l.workerId === u.id)) {
      const type: any = typeOf.get(lr.typeId) ?? { name: '', paid: true };
      let d = DateTime.fromISO(lr.startDate < from ? from : lr.startDate);
      const last = DateTime.fromISO(lr.endDate > to ? to : lr.endDate);
      let days = 0;
      while (d <= last) {
        const ds = d.toFormat('yyyy-MM-dd');
        if (!rest(ds) && !holidayByDate.has(ds)) days += lr.halfDay ? 0.5 : 1;
        d = d.plus({ days: 1 });
      }
      if (days > 0) {
        const cur = leaveByType.get(type.name) ?? { type: type.name, paid: type.paid, days: 0 };
        cur.days += days;
        leaveByType.set(type.name, cur);
      }
    }
    const leaveDays = [...leaveByType.values()];
    const unpaidLeaveDays = leaveDays.filter((l) => !l.paid).reduce((a, l) => a + l.days, 0);
    const unpaidLeaveDeductCents = profile.payType === 'MONTHLY' ? Math.round(unpaidLeaveDays * dailyRateCents) : 0;

    let basicPayCents: number;
    let premiumPayCents: number;
    if (hourlyPremium) {
      premiumPayCents = Math.round((premiumMinutes / 60) * (premiumHourlyRateCents ?? 0));
      if (profile.payType === 'DAILY') basicPayCents = (dates.length - premiumDays.length) * dailyRateCents;
      else if (profile.payType === 'HOURLY') basicPayCents = Math.round(((regularMinutes - premiumRegularMinutes) / 60) * profile.hourlyRateCents);
      else basicPayCents = profile.basicMonthlyCents;
    } else if (profile.payType === 'DAILY') {
      basicPayCents = dates.length * dailyRateCents;
      premiumPayCents = premiumDays.length * dailyRateCents;
    } else if (profile.payType === 'HOURLY') {
      basicPayCents = Math.round((regularMinutes / 60) * profile.hourlyRateCents);
      premiumPayCents = premiumDays.reduce((a, d) => a + Math.round(((regularByDate.get(d.date) ?? 0) / 60) * profile.hourlyRateCents), 0);
    } else {
      basicPayCents = profile.basicMonthlyCents;
      premiumPayCents = premiumDays.length * 2 * dailyRateCents;
    }
    const grossCents = basicPayCents + profile.fixedAllowanceCents + otPayCents + premiumPayCents;
    const deductionCents = profile.deductHousingCents + profile.deductOtherCents + unpaidLeaveDeductCents;
    const p: any = prof.get(u.id) ?? {};
    return {
      workerId: u.id, name: u.name, employeeNo: p.employeeNo ?? null, hasProfile: !!stored, payslipVisible: !!p.payslipVisible, profile, payType: profile.payType,
      otRateCents, dailyRateCents, basicPayCents, daysWorked: dates.length, regularMinutes, otMinutes, otPaidMinutes, otPayCents, premiumDays, premiumMinutes,
      premiumMode: profile.premiumMode, premiumHourlyRateCents, weekdayOt: profile.weekdayOt, premiumPayCents, leaveDays, unpaidLeaveDeductCents, grossCents,
      deductionCents, netCents: grossCents - deductionCents,
    };
  });
  return { month, from, to, workers, leftOut };
}

const dollars = (cents: number) => (cents / 100).toFixed(2);
/** SiteClock's payroll export columns and rows (payroll.router GET /export). */
export function payrollExport(workers: WorkerPayroll[]) {
  const headers = [
    'Employee No', 'Name', 'Pay Type', 'Days Worked', 'Regular Hours', 'OT Hours', 'OT Rate ($/h)', 'OT Pay ($)', 'PH/Rest Days Worked', 'PH/Rest Hours', 'PH/Rest Pay Basis',
    'Daily Rate ($)', 'Premium Pay ($)', 'Weekday OT', 'Leave (paid)', 'Leave (unpaid)', 'Unpaid Leave Deduction ($)', 'Basic ($)', 'Allowance ($)', 'Gross ($)', 'Deductions ($)', 'Net Pay ($)',
  ];
  const rows = workers.map((w) => [
    w.employeeNo ?? '', w.name, w.payType, String(w.daysWorked), (w.regularMinutes / 60).toFixed(2), (w.otMinutes / 60).toFixed(2), dollars(w.otRateCents), dollars(w.otPayCents),
    String(w.premiumDays.length), (w.premiumMinutes / 60).toFixed(2),
    w.premiumMode === 'OT_RATE' ? `hours × OT rate $${dollars(w.premiumHourlyRateCents ?? 0)}/h` : w.premiumMode === 'FIXED_HOURLY' ? `hours × $${dollars(w.premiumHourlyRateCents ?? 0)}/h` : w.payType === 'MONTHLY' ? '2 × daily rate per day' : w.payType === 'DAILY' ? "one extra day's rate" : 'regular hours paid double',
    dollars(w.dailyRateCents), dollars(w.premiumPayCents), w.weekdayOt ? 'paid' : 'not paid',
    w.leaveDays.filter((l) => l.paid).map((l) => `${l.days} ${l.type}`).join(', '), w.leaveDays.filter((l) => !l.paid).map((l) => `${l.days} ${l.type}`).join(', '),
    dollars(w.unpaidLeaveDeductCents), dollars(w.basicPayCents), dollars(w.profile.fixedAllowanceCents), dollars(w.grossCents), dollars(w.deductionCents), dollars(w.netCents),
  ]);
  return { headers, rows };
}
