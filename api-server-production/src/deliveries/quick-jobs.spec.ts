import { BadRequestException } from '@nestjs/common';
import { crewOf, parseLinkKind, parseNote, parsePtwRemark, parsePtwStatus, parseWorkers, ptwShown, siteclockExtraNotes } from './quick-jobs';
import { buildCalendarEvents, CalendarRun } from '../dashboard/jobs-calendar';
import { jobNotes, PlanRun } from '../siteclock/siteclock-plan';
import { orderJobsWhere } from './order-jobs';

describe('WCT calendar add: PTW', () => {
  it('reads the four states; empty and NOT_NEEDED are stored as null', () => {
    expect(parsePtwStatus(undefined)).toBeNull();
    expect(parsePtwStatus('')).toBeNull();
    expect(parsePtwStatus('NOT_NEEDED')).toBeNull();
    expect(parsePtwStatus('required')).toBe('REQUIRED');
    expect(parsePtwStatus('SUBMITTED')).toBe('SUBMITTED');
    expect(parsePtwStatus('APPROVED')).toBe('APPROVED');
    expect(() => parsePtwStatus('MAYBE')).toThrow(BadRequestException);
  });
  it('a remark is trimmed and capped', () => {
    expect(parsePtwRemark('  gate pass at guardhouse ')).toBe('gate pass at guardhouse');
    expect(parsePtwRemark('')).toBeNull();
    expect(() => parsePtwRemark('x'.repeat(301))).toThrow(BadRequestException);
  });
  it('a badge shows for anything but not needed', () => {
    expect(ptwShown(null)).toBe(false);
    expect(ptwShown('NOT_NEEDED')).toBe(false);
    expect(ptwShown('REQUIRED')).toBe(true);
  });
});

describe('WCT calendar add: workers and SiteClock notes', () => {
  it('first worker is the assignee; duplicates dropped', () => {
    const w = parseWorkers([{ id: 'w1', name: 'Ali' }, { id: 'w2', name: 'Bala' }, { id: 'w1', name: 'Ali' }]);
    expect(w).toEqual([{ id: 'w1', name: 'Ali' }, { id: 'w2', name: 'Bala' }]);
    expect(() => parseWorkers([{ name: 'no id' }])).toThrow(BadRequestException);
    expect(crewOf('junk')).toEqual([]);
  });
  it('notes carry PTW and the other workers; nothing extra when neither', () => {
    expect(siteclockExtraNotes(null, null, [])).toEqual([]);
    expect(siteclockExtraNotes('REQUIRED', 'apply via MCST', [{ id: 'w2', name: 'Bala' }, { id: 'w3', name: 'Chen' }])).toEqual([
      'PTW: Required (apply via MCST)',
      'Also on this job: Bala, Chen',
    ]);
  });
  it('the SiteClock job notes of a job without PTW or crew are unchanged', () => {
    const base: PlanRun = {
      id: 'd', organizationId: 'o', deliveryNumber: 7, status: 'scheduled', isDraft: false, scheduledFor: new Date(), startedAt: null, completedAt: null,
      siteAddress: null, notes: 'Call first', customerId: null, customerName: 'Acme', projectName: null, items: [{ description: 'PM', quantity: 1 }], doNumber: null, doUrl: null,
    };
    expect(jobNotes(base)).toBe('PM\n\nCall first');
    expect(jobNotes({ ...base, extraNotes: ['PTW: Approved'] })).toBe('PM\n\nCall first\n\nPTW: Approved');
  });
});

describe('WCT calendar add: notes', () => {
  it('a multi-day all-day note', () => {
    expect(parseNote({ title: ' Ali on leave ', type: 'leave', startDate: '2026-11-10', endDate: '2026-11-12', staffId: 'w1', staffName: 'Ali' })).toEqual({
      title: 'Ali on leave', type: 'LEAVE', staffId: 'w1', staffName: 'Ali', startDate: '2026-11-10', endDate: '2026-11-12', allDay: true, startTime: null, endTime: null, remark: null,
    });
  });
  it('a timed note needs a valid window', () => {
    expect(parseNote({ title: 'Road closed', type: 'BLOCKAGE', startDate: '2026-11-10', allDay: false, startTime: '09:00', endTime: '12:30' })).toMatchObject({ endDate: '2026-11-10', startTime: '09:00', endTime: '12:30' });
    expect(() => parseNote({ title: 'x', type: 'OTHER', startDate: '2026-11-10', allDay: false, startTime: '12:00', endTime: '09:00' })).toThrow(BadRequestException);
  });
  it('refuses bad input', () => {
    expect(() => parseNote({ type: 'OTHER', startDate: '2026-11-10' })).toThrow('A note needs a title');
    expect(() => parseNote({ title: 'x', type: 'HOLIDAY', startDate: '2026-11-10' })).toThrow(BadRequestException);
    expect(() => parseNote({ title: 'x', type: 'OTHER', startDate: '2026-02-30' })).toThrow(BadRequestException);
    expect(() => parseNote({ title: 'x', type: 'OTHER', startDate: '2026-11-10', endDate: '2026-11-09' })).toThrow('The end date is before the start date');
  });
  it('link kinds', () => {
    expect(parseLinkKind('Quotation')).toBe('quotation');
    expect(() => parseLinkKind('project')).toThrow(BadRequestException);
  });
});

describe('WCT calendar add: calendar events and the untagged list', () => {
  const run = (over: Partial<CalendarRun> = {}): CalendarRun => ({
    id: 'd1', deliveryNumber: 3, direction: 'OUTBOUND', status: 'scheduled', scheduledFor: new Date('2026-11-05T02:00:00Z'), riderUserId: null, riderName: null,
    siteAddress: '1 Tuas', customerName: 'Acme', projectName: null, service: false, ...over,
  });
  it('PTW badge only when needed; Untagged mark; nothing new on a plain run', () => {
    const [plain] = buildCalendarEvents([run()], [], null);
    expect(plain.ptw).toBeUndefined();
    expect(plain.untagged).toBeUndefined();
    const [e] = buildCalendarEvents([run({ ptw: { status: 'SUBMITTED', remark: 'sent Mon' }, untagged: true })], [], null);
    expect(e.ptw).toEqual({ status: 'SUBMITTED', label: 'Submitted', remark: 'sent Mon' });
    expect(e.untagged).toBe(true);
    const [n] = buildCalendarEvents([run({ ptw: { status: 'NOT_NEEDED', remark: null } })], [], null);
    expect(n.ptw).toBeUndefined();
  });
  it('the untagged list is jobs with no order, cancelled left out; the normal list is order jobs', () => {
    expect(orderJobsWhere('o', { untagged: true }).AND[1]).toEqual({ orderId: null, status: { not: 'cancelled' } });
    expect(orderJobsWhere('o', {}).AND[1]).toEqual({ orderId: { not: null } });
  });
});
