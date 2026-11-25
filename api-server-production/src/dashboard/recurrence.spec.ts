import { endBefore, formatRule, lastOccurrence, occurrences, parseRule, ruleText, splitRule } from './recurrence';

/** Repeating jobs and notes (WCT group, 2026-11-25): RRULE expansion the Google Calendar way. */
describe('recurrence: rule types', () => {
  it('daily, every 3 days', () => {
    expect(occurrences('FREQ=DAILY', '2026-11-30', '2026-11-30', '2026-12-02')).toEqual(['2026-11-30', '2026-12-01', '2026-12-02']);
    expect(occurrences('FREQ=DAILY;INTERVAL=3', '2026-11-01', '2026-11-01', '2026-11-10')).toEqual(['2026-11-01', '2026-11-04', '2026-11-07', '2026-11-10']);
  });
  it('weekly on the start day, weekly on several days, every 2 weeks (WKST=SU as Google writes it)', () => {
    expect(occurrences('FREQ=WEEKLY', '2026-11-04', '2026-11-01', '2026-11-30')).toEqual(['2026-11-04', '2026-11-11', '2026-11-18', '2026-11-25']);
    expect(occurrences('FREQ=WEEKLY;BYDAY=MO,TH', '2026-11-05', '2026-11-01', '2026-11-16')).toEqual(['2026-11-05', '2026-11-09', '2026-11-12', '2026-11-16']);
    expect(occurrences('FREQ=WEEKLY;WKST=SU;INTERVAL=2;BYDAY=TU', '2026-11-03', '2026-11-01', '2026-12-31')).toEqual(['2026-11-03', '2026-11-17', '2026-12-01', '2026-12-15', '2026-12-29']);
  });
  it('every weekday (Mon to Fri)', () => {
    expect(occurrences('FREQ=WEEKLY;BYDAY=MO,TU,WE,TH,FR', '2026-11-27', '2026-11-27', '2026-12-02')).toEqual(['2026-11-27', '2026-11-30', '2026-12-01', '2026-12-02']);
  });
  it('monthly on a date, on the nth weekday, on the last weekday, BYSETPOS, a 31st skips short months', () => {
    expect(occurrences('FREQ=MONTHLY;BYMONTHDAY=15', '2026-11-15', '2026-11-01', '2027-01-31')).toEqual(['2026-11-15', '2026-12-15', '2027-01-15']);
    expect(occurrences('FREQ=MONTHLY;BYDAY=3TU', '2026-11-17', '2026-11-01', '2027-01-31')).toEqual(['2026-11-17', '2026-12-15', '2027-01-19']);
    expect(occurrences('FREQ=MONTHLY;BYDAY=-1FR', '2026-11-27', '2026-11-01', '2027-01-31')).toEqual(['2026-11-27', '2026-12-25', '2027-01-29']);
    expect(occurrences('FREQ=MONTHLY;BYDAY=MO,TU,WE,TH,FR;BYSETPOS=-1', '2026-11-30', '2026-11-01', '2027-01-31')).toEqual(['2026-11-30', '2026-12-31', '2027-01-29']);
    expect(occurrences('FREQ=MONTHLY', '2027-01-31', '2027-01-01', '2027-05-31')).toEqual(['2027-01-31', '2027-03-31', '2027-05-31']);
  });
  it('annually, also on 29 Feb (leap years only), BYMONTH', () => {
    expect(occurrences('FREQ=YEARLY', '2026-11-25', '2026-01-01', '2028-12-31')).toEqual(['2026-11-25', '2027-11-25', '2028-11-25']);
    expect(occurrences('FREQ=YEARLY', '2028-02-29', '2028-01-01', '2033-12-31')).toEqual(['2028-02-29', '2032-02-29']);
    expect(occurrences('FREQ=YEARLY;BYMONTH=3,9;BYMONTHDAY=1', '2027-03-01', '2027-01-01', '2028-12-31')).toEqual(['2027-03-01', '2027-09-01', '2028-03-01', '2028-09-01']);
  });
});

describe('recurrence: ends', () => {
  it('COUNT counts from the start whatever range is asked', () => {
    expect(occurrences('FREQ=WEEKLY;COUNT=3', '2026-11-04', '2026-11-12', '2027-12-31')).toEqual(['2026-11-18']);
    expect(lastOccurrence('FREQ=WEEKLY;COUNT=3', '2026-11-04')).toBe('2026-11-18');
  });
  it('UNTIL (a date, or a UTC instant read in Singapore) is inclusive', () => {
    expect(occurrences('FREQ=DAILY;UNTIL=20261203', '2026-12-01', '2026-11-01', '2026-12-31')).toEqual(['2026-12-01', '2026-12-02', '2026-12-03']);
    // 15:59:59Z on 3 Dec = 23:59:59 in Singapore on 3 Dec.
    expect(occurrences('FREQ=DAILY;UNTIL=20261203T155959Z', '2026-12-01', '2026-11-01', '2026-12-31')).toHaveLength(3);
    expect(lastOccurrence('FREQ=DAILY;UNTIL=20261203', '2026-12-01')).toBe('2026-12-03');
  });
  it('never ends: only the asked range comes back', () => {
    expect(occurrences('FREQ=DAILY', '2020-01-01', '2099-12-30', '2099-12-31')).toEqual(['2099-12-30', '2099-12-31']);
    expect(lastOccurrence('FREQ=DAILY', '2020-01-01')).toBeNull();
  });
  it('EXDATE leaves an occurrence out (after counting, as in RFC 5545)', () => {
    expect(occurrences('FREQ=WEEKLY;COUNT=3', '2026-11-04', '2026-11-01', '2027-12-31', ['2026-11-11'])).toEqual(['2026-11-04', '2026-11-18']);
  });
});

describe('recurrence: text, format, split', () => {
  it('reads like Google', () => {
    expect(ruleText('FREQ=WEEKLY;BYDAY=WE;UNTIL=20270331', '2026-11-04')).toBe('Weekly on Wed, until 31 Mar 2027');
    expect(ruleText('FREQ=WEEKLY', '2026-11-04')).toBe('Weekly on Wed, never ends');
    expect(ruleText('FREQ=MONTHLY;BYDAY=3TU;COUNT=10', '2026-11-17')).toBe('Monthly on the third Tue, 10 times');
    expect(ruleText('FREQ=MONTHLY;BYMONTHDAY=15', '2026-11-15')).toBe('Monthly on day 15, never ends');
    expect(ruleText('FREQ=WEEKLY;BYDAY=MO,TU,WE,TH,FR', '2026-11-30')).toBe('Weekly on weekdays (Mon to Fri), never ends');
    expect(ruleText('FREQ=YEARLY', '2026-11-25')).toBe('Annually on 25 Nov, never ends');
    expect(ruleText('FREQ=DAILY;INTERVAL=2', '2026-11-25')).toBe('Every 2 days, never ends');
  });
  it('parses and formats back (Google RRULE text kept)', () => {
    expect(formatRule(parseRule('RRULE:FREQ=WEEKLY;WKST=SU;BYDAY=TU,TH;INTERVAL=2;UNTIL=20270331T155959Z'))).toBe('FREQ=WEEKLY;INTERVAL=2;BYDAY=TU,TH;WKST=SU;UNTIL=20270331');
    expect(() => parseRule('FREQ=HOURLY')).toThrow();
    expect(() => parseRule('FREQ=WEEKLY;BYDAY=XX')).toThrow();
  });
  it('"this and following": the old series ends the day before, a COUNT is shared out', () => {
    expect(splitRule('FREQ=WEEKLY', '2026-11-04', '2026-11-18')).toEqual({ before: 'FREQ=WEEKLY;UNTIL=20261111', after: 'FREQ=WEEKLY' });
    expect(splitRule('FREQ=WEEKLY;COUNT=5', '2026-11-04', '2026-11-18')).toEqual({ before: 'FREQ=WEEKLY;UNTIL=20261111', after: 'FREQ=WEEKLY;COUNT=3' });
    // From the first occurrence: nothing is left before.
    expect(splitRule('FREQ=WEEKLY', '2026-11-04', '2026-11-04').before).toBeNull();
    expect(endBefore('FREQ=DAILY', '2026-11-01', '2026-11-03')).toBe('FREQ=DAILY;UNTIL=20261102');
  });
});
