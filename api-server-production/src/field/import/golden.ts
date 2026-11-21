/**
 * Golden comparison for payroll and leave balances (FIELD_PLAN.md §5.3): SiteClock's own code computes the numbers
 * (run read-only from the untouched SiteClock checkout, scripts/field-golden.ts), the AIMS port computes them from
 * the shadow-imported Field rows in memory, and every differing number is listed. Pure.
 */
import { fakePrisma } from '../testing/fake-prisma';
import { computeMonthlyPayroll } from '../payroll/payroll-engine';
import { FieldLeaveService } from '../leave/leave.service';

export const PAYROLL_FIELDS = [
  'payType', 'otRateCents', 'dailyRateCents', 'basicPayCents', 'daysWorked', 'regularMinutes', 'otMinutes', 'otPaidMinutes', 'otPayCents',
  'premiumMinutes', 'premiumPayCents', 'unpaidLeaveDeductCents', 'grossCents', 'deductionCents', 'netCents',
] as const;
export const BALANCE_FIELDS = ['entitled', 'taken', 'pending', 'remaining', 'custom'] as const;

export interface GoldenDiff {
  kind: 'payroll' | 'leave';
  period: string; // month or year
  siteclockUserId: string;
  name: string;
  field: string;
  siteclock: unknown;
  aims: unknown;
}

function memoryDb(rows: Record<string, any[]>) {
  const db: any = fakePrisma();
  for (const [table, list] of Object.entries(rows)) if (db[table]) db[table].rows = list.map((r) => ({ ...r }));
  return db;
}

/**
 * sc.payroll: { [month]: SiteClock computeMonthlyPayroll().workers } (userId = SiteClock user id);
 * sc.leave: { [year]: { [siteclockUserId]: leaveBalances() } } (typeId = SiteClock leave type id).
 */
export async function compareGolden(
  rows: Record<string, any[]>,
  organizationId: string,
  sc: { payroll: Record<string, any[]>; leave: Record<string, Record<string, any[]>> },
): Promise<{ diffs: GoldenDiff[]; checked: { payrollRows: number; balances: number }; onlyInSiteClock: string[]; onlyInAims: string[] }> {
  const db = memoryDb(rows);
  const workerBySc = new Map<string, any>((rows.worker ?? []).filter((w) => w.siteclockId).map((w) => [w.siteclockId, w]));
  const scOfWorker = new Map<string, string>((rows.worker ?? []).filter((w) => w.siteclockId).map((w) => [w.id, w.siteclockId]));
  const typeBySc = new Map<string, string>((rows.fieldLeaveType ?? []).filter((t) => t.siteclockId).map((t) => [t.siteclockId, t.id]));
  const diffs: GoldenDiff[] = [];
  const onlyInSiteClock = new Set<string>();
  const onlyInAims = new Set<string>();
  let payrollRows = 0;
  let balances = 0;

  for (const [month, scWorkers] of Object.entries(sc.payroll)) {
    const aims = await computeMonthlyPayroll(db, organizationId, month);
    const aimsBySc = new Map(aims.workers.map((w) => [scOfWorker.get(w.workerId) ?? `aims:${w.workerId}`, w]));
    for (const s of scWorkers) {
      const a: any = aimsBySc.get(s.userId);
      if (!a) {
        onlyInSiteClock.add(`${month} ${s.name}`);
        continue;
      }
      payrollRows++;
      for (const f of PAYROLL_FIELDS) if (s[f] !== a[f]) diffs.push({ kind: 'payroll', period: month, siteclockUserId: s.userId, name: s.name, field: f, siteclock: s[f], aims: a[f] });
      const pd = (x: any[]) => JSON.stringify((x ?? []).map((d) => [d.date, d.kind]));
      if (pd(s.premiumDays) !== pd(a.premiumDays)) diffs.push({ kind: 'payroll', period: month, siteclockUserId: s.userId, name: s.name, field: 'premiumDays', siteclock: pd(s.premiumDays), aims: pd(a.premiumDays) });
      const ld = (x: any[]) => JSON.stringify((x ?? []).map((l) => [l.type, l.paid, l.days]).sort());
      if (ld(s.leaveDays) !== ld(a.leaveDays)) diffs.push({ kind: 'payroll', period: month, siteclockUserId: s.userId, name: s.name, field: 'leaveDays', siteclock: ld(s.leaveDays), aims: ld(a.leaveDays) });
    }
    for (const [scId] of aimsBySc) if (!scWorkers.some((s) => s.userId === scId)) onlyInAims.add(`${month} ${scId}`);
  }

  const leave = new FieldLeaveService(db);
  for (const [year, byUser] of Object.entries(sc.leave)) {
    for (const [scUser, scBal] of Object.entries(byUser)) {
      const w = workerBySc.get(scUser);
      if (!w) {
        onlyInSiteClock.add(`${year} leave ${scUser}`);
        continue;
      }
      const aimsBal = await leave.balancesOf(organizationId, w.id, Number(year));
      for (const s of scBal) {
        const a: any = aimsBal.find((b: any) => b.typeId === typeBySc.get(s.typeId));
        balances++;
        if (!a) {
          diffs.push({ kind: 'leave', period: year, siteclockUserId: scUser, name: w.name, field: `type ${s.name}`, siteclock: 'listed', aims: 'missing' });
          continue;
        }
        for (const f of BALANCE_FIELDS) if ((s as any)[f] !== a[f]) diffs.push({ kind: 'leave', period: year, siteclockUserId: scUser, name: w.name, field: `${s.name} ${f}`, siteclock: (s as any)[f], aims: a[f] });
      }
    }
  }
  return { diffs, checked: { payrollRows, balances }, onlyInSiteClock: [...onlyInSiteClock], onlyInAims: [...onlyInAims] };
}
