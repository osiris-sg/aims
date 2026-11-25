import { classify, customerIndex, expandRrule, leaveParts, matchCustomer, parseIcs, popupDescription, quotationNumbers, splitCrew, splitJob, stripDayCounter, takeMarks } from './gcal-title';

describe('takeMarks', () => {
  it('takes the leading status marks, 2✅ as a count', () => {
    expect(takeMarks('⭕✅🔴Zhang Liang Mala Tang @ Bedok Mall')).toEqual({ marks: ['postponed', 'do', 'ptw:Bala'], rest: 'Zhang Liang Mala Tang @ Bedok Mall' });
    expect(takeMarks('2✅📌🟫Shop @ X').marks).toEqual(['do:2', 'sticker', 'cod']);
    expect(takeMarks('Plain @ X')).toEqual({ marks: [], rest: 'Plain @ X' });
  });
});

describe('splitJob', () => {
  it('splits the standard pattern', () => {
    expect(splitJob('Coffee & Tea @ Blk 132 Jalan Bukit Merah (A&A Work - Day 11) - Team B + Selva & Jaya *Power Turn On Testing*')).toEqual({
      name: 'Coffee & Tea', address: 'Blk 132 Jalan Bukit Merah', jobTitle: 'A&A Work - Day 11', team: 'Team B + Selva & Jaya', remarks: ['Power Turn On Testing'], pattern: 'at',
    });
  });
  it('keeps nested brackets in the job title and several remarks', () => {
    const p = splitJob('Foodloft @ 721 Ang Mo Kio Ave 8 (CD System (7 Stalls) + UV Light) - Team C *a**b*');
    expect(p.jobTitle).toBe('CD System (7 Stalls) + UV Light');
    expect(p.remarks).toEqual(['a', 'b']);
  });
  it('reads the "Name. Address (Job) - Team" variant', () => {
    const p = splitJob('ANN LIANG GENERAL CONTRACTOR. 151A Serangoon North Ave 2 #01-82 (New MV Job) - Team S + Vignesh');
    expect(p).toMatchObject({ name: 'ANN LIANG GENERAL CONTRACTOR', address: '151A Serangoon North Ave 2 #01-82', jobTitle: 'New MV Job', pattern: 'dot' });
  });
  it('a job with no team, a remark only', () => {
    const p = splitJob('Machine Repair Help Welding @ Warehouse - Ramesh *Babu Drop*');
    expect(p).toMatchObject({ name: 'Machine Repair Help Welding', address: 'Warehouse', jobTitle: '', team: 'Ramesh', remarks: ['Babu Drop'] });
  });
});

describe('classify', () => {
  const k = (t: string, cal = 'Rave') => classify(t, cal, splitJob(takeMarks(t).rest));
  it('leave, blockage, job, general', () => {
    expect(k('📅 - PANDI (UPL)', '📅ALL TYPE OF LEAVES')).toBe('leave');
    expect(k('🚫Blockage For Team S - Boss MV Job (Day & Night)🚫')).toBe('blockage');
    expect(k('✅Aalst Chocolate @ 26 Tuas Ave 7 (CD Ductwork) - Team D')).toBe('job');
    expect(k('💰PAY DAY!', 'Isadora')).toBe('general');
    expect(k('⭐XN Home Tuition (English)', "Isadora's Personal Reminder")).toBe('general');
    expect(k('Blk 681 Hougang Ave 8 (Troubleshoot Exhaust Sound Issues) - Team E')).toBe('job');
  });
});

describe('helpers', () => {
  it('quotation numbers', () => expect(quotationNumbers('Q-013442\n❌Create DO q-1 Q013776')).toEqual(['Q-013442', 'Q-013776']));
  it('leave parts', () => expect(leaveParts('📅 - PANDI (UPL)')).toEqual({ staff: 'PANDI', leaveType: 'UPL' }));
  it('day counter', () => expect(stripDayCounter('📅 - KRISHNAN (UPL) (Day 2 of 3)')).toBe('📅 - KRISHNAN (UPL)'));
  it('customer match exact then close', () => {
    const idx = customerIndex([{ id: '1', name: 'Old Chang Kee Singapore Pte Ltd' }, { id: '2', name: 'Whye Wah Development & Construction Pte Ltd' }]);
    expect(matchCustomer(idx, 'Whye Wah Development & Construction Pte. Ltd.').kind).toBe('exact');
    expect(matchCustomer(idx, 'Old Chang Kee')).toMatchObject({ kind: 'close', customer: { id: '1' } });
    expect(matchCustomer(idx, 'Totally Different Cafe').kind).toBe('none');
  });
  it('crew split', () => {
    const r = splitCrew('Team S + Vignesh + Pandi & 2 Part Timers', [{ id: 'w1', name: 'Vignesh' }], [{ id: 't1', name: 'Team S' }]);
    expect(r).toEqual({ teams: [{ id: 't1', name: 'Team S' }], workers: [{ id: 'w1', name: 'Vignesh' }], typed: ['Pandi', '2 Part Timers'] });
  });
  it('popup description', () => {
    const t = 'Close\nEdit event\nMCST @ X\nTuesday\nnotes\nDescription:\nQ-013442\n❌Create DO\nevent\nOrganiser: Rave\nRave';
    expect(popupDescription(t)).toBe('Q-013442\n❌Create DO');
    expect(popupDescription('Close\nTitle\nevent\nOrganiser: X')).toBe('');
  });
});

describe('ICS', () => {
  const ics = [
    'BEGIN:VCALENDAR', 'BEGIN:VEVENT', 'DTSTART:20221117T033000Z', 'DTEND:20221117T043000Z', 'UID:abc@google.com', 'SUMMARY:Shop @ 1 Road (CD) - Team A', 'DESCRIPTION:Q-013442\\nline 2', 'LAST-MODIFIED:20221110T010203Z', 'END:VEVENT',
    'BEGIN:VEVENT', 'DTSTART;VALUE=DATE:20210615', 'DTEND;VALUE=DATE:20210616', 'RRULE:FREQ=MONTHLY;UNTIL=20210915;BYMONTHDAY=1', 'UID:r1', 'SUMMARY:Reminder - CC', 'END:VEVENT', 'END:VCALENDAR',
  ].join('\r\n');
  it('reads times in Singapore, all-day end inclusive, escapes', () => {
    const [a, b] = parseIcs(ics);
    expect(a).toMatchObject({ uid: 'abc@google.com', startDate: '2022-11-17', startTime: '11:30', endTime: '12:30', allDay: false, description: 'Q-013442\nline 2', lastModified: '2022-11-10T01:02:03Z' });
    expect(b).toMatchObject({ startDate: '2021-06-15', endDate: '2021-06-15', allDay: true, rrule: 'FREQ=MONTHLY;UNTIL=20210915;BYMONTHDAY=1' });
  });
  it('expands monthly by month day, weekly by day, yearly, with a cap', () => {
    expect(expandRrule('2021-06-15', 'FREQ=MONTHLY;UNTIL=20210915;BYMONTHDAY=1', '2030-01-01')).toEqual(['2021-07-01', '2021-08-01', '2021-09-01']);
    expect(expandRrule('2026-11-02', 'FREQ=WEEKLY;BYDAY=MO,WE;COUNT=3', '2030-01-01')).toEqual(['2026-11-02', '2026-11-04', '2026-11-09']);
    expect(expandRrule('2000-11-05', 'FREQ=YEARLY', '2002-12-31')).toEqual(['2000-11-05', '2001-11-05', '2002-11-05']);
  });
});

describe('splitCrew aliases (owner 2026-11-25)', () => {
  const { splitCrew } = require('./gcal-title');
  const workers = [{ id: 'w1', name: 'Nagaraja' }, { id: 'w2', name: 'Thillai' }];
  const teams = [{ id: 't1', name: 'Team E' }];
  it('an alias picks its active worker; one with no active worker stays typed', () => {
    const r = splitCrew('Team E + Naga + Bala + Pandi', workers, teams, { naga: 'Nagaraja', bala: 'Bala WCT' });
    expect(r.teams.map((t: any) => t.name)).toEqual(['Team E']);
    expect(r.workers.map((w: any) => w.name)).toEqual(['Nagaraja']);
    expect(r.typed).toEqual(['Bala', 'Pandi']);
  });
});
