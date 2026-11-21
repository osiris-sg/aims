/** Field phase 2: Upload schedule (siteclock jobs-import.ts + jobs-plan.ts @62b7d9d). */
import * as ExcelJS from 'exceljs';
import { computeFieldAccess } from '../common/field-access';
import type { FieldCtx } from '../common/field-context.service';
import { fakePrisma } from '../testing/fake-prisma';
import { list, parseClocking, parseDate, parseScheduleFile, parseTime, resolveCustomer, resolveJobWorker, resolveTeam } from './jobs-import';
import { setJobGeocoder } from './jobs-lib';
import { FieldJobsService } from './jobs.service';

const ORG = 'org-1';
const ctx = (roleNames = ['Admin']): FieldCtx => ({ organizationId: ORG, userId: 'u', userName: 'Admin', features: {}, timezone: 'Asia/Singapore', access: computeFieldAccess({ isOsirisAdmin: false, roleNames, supervises: false }), workerId: null, supervisedSiteIds: [], supervisedWorkerIds: [] });

describe('upload schedule: reading the file', () => {
  it('dates, times, clocking and lists read as in SiteClock', () => {
    expect(['2026-11-07', '7/11/2026', '7.11.26', '7 Nov 2026', 'Nov 7 2026'].map(parseDate)).toEqual(Array(5).fill('2026-11-07'));
    expect(parseDate('31/02/2026')).toBeNull();
    expect(['08:30', '8:30', '0830', '8.30am', '830pm', '2pm', 0.5].map(parseTime)).toEqual(['08:30', '08:30', '08:30', '08:30', '20:30', '14:00', '12:00']);
    expect(parseTime('25:00')).toBeUndefined();
    expect(['', 'off', 'in', 'in and out', 'maybe'].map(parseClocking)).toEqual([null, 'OFF', 'ARRIVE', 'ARRIVE_LEAVE', undefined]);
    expect(list('Team A, Team B + Ali & Raja; Naga')).toEqual(['Team A', 'Team B', 'Ali', 'Raja', 'Naga']);
  });

  it('CSV: guessed headers, a blank date repeats the row above, problems carry the row', async () => {
    const csv = 'Date,Start,Client / job,Address or site,Teams,Clocking\n2026-11-07,08:30,Ajiya,"E!Avenue, #02-346",Team A,\n,25:00,Ajiya,Office,Team A,sometimes\n';
    const out = await parseScheduleFile(Buffer.from(csv), 'plan.csv');
    expect(out.rows.map((r) => [r.row, r.date, r.time, r.location])).toEqual([[2, '2026-11-07', '08:30', 'E!Avenue, #02-346'], [3, '2026-11-07', null, 'Office']]);
    expect(out.problems).toEqual(['Row 3: can\'t read the start time "25:00", use HH:mm', 'Row 3: clocking "sometimes" should be blank, off, in, or in and out']);
    expect((await parseScheduleFile(Buffer.from('a,b\n1,2'), 'x.csv')).problems[0]).toMatch(/header row/);
    // Oddity kept: with no "Work" column, "Workers" is read as the work (/work/ is tried first).
    const odd = await parseScheduleFile(Buffer.from('Client,Address,Workers\nA,B,Ali\n'), 'x.csv');
    expect([odd.rows[0].description, odd.rows[0].workers]).toEqual(['Ali', []]);
  });

  it('xlsx: the first sheet that is not Help', async () => {
    const wb = new ExcelJS.Workbook();
    wb.addWorksheet('Help').addRow(['ignore me']);
    const ws = wb.addWorksheet('Schedule');
    ws.addRow(['Date', 'Customer', 'Location', 'QR']);
    ws.addRow([new Date(Date.UTC(2026, 10, 9)), 'Ajiya', 'Office', 'yes']);
    const out = await parseScheduleFile(Buffer.from(await wb.xlsx.writeBuffer()), 'plan.xlsx');
    expect(out.rows[0]).toMatchObject({ date: '2026-11-09', title: 'Ajiya', location: 'Office', qrRequired: true });
  });

  it('names: teams, workers (phone, employee no., whole word), customers; ambiguity is a problem, never a guess', () => {
    const teams = [{ id: 't1', name: 'Team A' }, { id: 't2', name: 'Team B' }];
    expect(resolveTeam('a', teams).team?.id).toBe('t1');
    expect(resolveTeam('C', teams).error).toBe('no team "C"');
    const ws = [
      { id: 'w1', name: 'Raja Kumar', phone: '+65 9123 4567', employeeNo: 'E7' },
      { id: 'w2', name: 'Rajavelu', phone: null, employeeNo: null },
      { id: 'w3', name: 'Ali Hassan', phone: '81234567', employeeNo: null },
    ];
    expect(resolveJobWorker('Raja', ws).worker?.id).toBe('w1');
    expect(resolveJobWorker('91234567', ws).worker?.id).toBe('w1');
    expect(resolveJobWorker('e7', ws).worker?.id).toBe('w1');
    expect(resolveJobWorker('Raj', ws).error).toBe('"Raj" could be Raja Kumar (E7), Rajavelu');
    const cs = [{ id: 'c1', name: 'Ajiya Okonomiyaki Restaurant' }, { id: 'c2', name: 'Ajiya Holdings' }, { id: 'c3', name: 'Causeway Point' }];
    expect(resolveCustomer('causeway', cs).customer?.id).toBe('c3');
    expect(resolveCustomer('Ajiya', cs).error).toBe('"Ajiya" could be Ajiya Okonomiyaki Restaurant, Ajiya Holdings');
    expect(resolveCustomer('Nobody', cs).error).toMatch(/add it there first/);
  });
});

describe('upload schedule: preview and add', () => {
  beforeAll(() => setJobGeocoder(async (q) => (/nowhere/i.test(q) ? null : { label: `${q}, Singapore`, lat: 1.4, lng: 103.8 })));

  async function setup() {
    const db: any = fakePrisma();
    const made: any[] = [];
    const deliveries: any = {
      createQuickJob: async (org: string, body: any) => {
        const d = await db.delivery.create({ data: { organizationId: org, deliveryNumber: made.length + 1, status: 'scheduled', isDraft: false, scheduledFor: new Date(body.scheduledFor), scheduledAllDay: body.allDay, customerId: body.customerId, siteAddress: body.siteAddress, notes: body.remarks } });
        made.push(body);
        return d;
      },
    };
    const svc = new FieldJobsService(db, deliveries);
    await db.customer.create({ data: { organizationId: ORG, name: 'Ajiya Okonomiyaki Restaurant' } });
    const team = await db.workerTeam.create({ data: { organizationId: ORG, name: 'Team A', active: true } });
    const w = await db.worker.create({ data: { organizationId: ORG, name: 'Ali Hassan', active: true } });
    await db.fieldTeamStint.create({ data: { organizationId: ORG, teamId: team.id, workerId: w.id, startDate: '2026-01-01' } });
    return { db, svc, made, team, w };
  }
  const csv = (rows: string) => ({ buffer: Buffer.from(`Date,Start,Client / job,Address or site,Postal code,Work,Teams,Workers\n${rows}`), originalname: 'plan.csv' });

  it('preview lists the jobs per day with the crew, and every problem', async () => {
    const { svc } = await setup();
    const ok = await svc.importPreview(ctx(), csv('2026-11-07,08:30,Ajiya Okonomiyaki,E!Avenue,608532,,Team A,\n'));
    expect(ok.problems).toEqual([]);
    expect(ok.days).toEqual([{ date: '2026-11-07', existing: 0, workers: 1, jobs: [{ time: '08:30', title: 'Ajiya Okonomiyaki Restaurant', where: 'E!Avenue, 608532, Singapore', crew: 1, warning: undefined }] }]);
    const bad = await svc.importPreview(ctx(), csv('2026-11-07,,Nobody,Nowhere,,,Team Z,\n'));
    expect(bad.problems).toEqual([
      'Row 2: no customer "Nobody" in Customers (add it there first)',
      'Row 2: no team "Team Z"',
      'Row 2: couldn\'t find "Nowhere" on the map, give a postal code or street address',
    ]);
    await expect(svc.importPreview(ctx(['Operations']), csv(''))).rejects.toThrow('Admin only');
  });

  it('add makes calendar jobs with their Field side; refuses while a row has a problem', async () => {
    const { db, svc, made, w } = await setup();
    const { rows } = await svc.importPreview(ctx(), csv('2026-11-07,08:30,Ajiya Okonomiyaki,E!Avenue,608532,Fix VSD,Team A,\n,,Ajiya Okonomiyaki,E!Avenue,608532,,,Ali\n'));
    const out = await svc.importApply(ctx(), { rows });
    expect(out).toEqual({ days: [{ date: '2026-11-07', created: 2, workers: 1 }], created: 2 });
    expect(made.map((m) => [m.allDay, m.scheduledFor])).toEqual([[false, '2026-11-07T00:30:00.000Z'], [true, '2026-11-06T16:00:00.000Z']]);
    const jobs = await db.fieldJob.findMany({ where: { organizationId: ORG } });
    expect(jobs).toHaveLength(2);
    expect(new Set(jobs.map((j: any) => j.siteId)).size).toBe(1); // the same place is one site
    expect((await db.fieldJobCrew.findMany({})).map((c: any) => c.workerId)).toEqual([w.id, w.id]);
    await expect(svc.importApply(ctx(), { rows: [{ ...rows[0], title: 'Nobody' }] })).rejects.toThrow('Some rows need fixing');
  });
});
