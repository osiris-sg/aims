import { calendarBadge, calendarLegend, checkJobFieldValues, cleanDisplay, fieldNameFor, normaliseJobFieldValue } from './job-fields';

const permitApproved = { id: 'f2', fieldName: 'permit_approved', displayLabel: 'Permit approved', fieldType: 'boolean', display: { showOnCalendar: true, icon: 'verified', colourByValue: { true: '#2e7d32', false: '#c62828' } } };
const permitRequired = { id: 'f1', fieldName: 'permit_required', displayLabel: 'Permit required', fieldType: 'boolean', display: { showOnCalendar: true, icon: 'permit', colourByValue: { true: '#ef6c00' } } };

describe('custom job fields', () => {
  it('values are checked per type', () => {
    expect(normaliseJobFieldValue('boolean', 'yes')).toBe(true);
    expect(normaliseJobFieldValue('boolean', false)).toBe(false);
    expect(() => normaliseJobFieldValue('boolean', 'maybe')).toThrow(/yes or no/);
    expect(normaliseJobFieldValue('date', '2026-11-03T10:00:00Z')).toBe('2026-11-03');
    expect(() => normaliseJobFieldValue('date', '03/11/2026')).toThrow(/date/);
    expect(normaliseJobFieldValue('url', 'https://permits.gov.sg/x')).toBe('https://permits.gov.sg/x');
    expect(() => normaliseJobFieldValue('url', 'javascript:alert(1)')).toThrow(/https/);
    expect(normaliseJobFieldValue('file', { fileKey: 'k/permit.pdf', fileName: 'permit.pdf', mimeType: 'application/pdf' })).toEqual({ fileKey: 'k/permit.pdf', fileName: 'permit.pdf', mimeType: 'application/pdf' });
    expect(() => normaliseJobFieldValue('file', 'permit.pdf')).toThrow(/uploaded file/);
    expect(normaliseJobFieldValue('text', '')).toBeNull();
    expect(normaliseJobFieldValue('text', undefined)).toBeUndefined();
  });

  it('a save names every bad field and refuses fields of other orgs', () => {
    expect(() => checkJobFieldValues([permitApproved as any], { f2: 'perhaps', fX: true })).toThrow(/Permit approved must be yes or no; a field that is not one of this organisation’s job fields/);
    expect(checkJobFieldValues([permitApproved as any], { f2: true })).toHaveLength(1);
  });

  it('display settings keep only known icons and real colours', () => {
    expect(cleanDisplay({ showOnCalendar: true, icon: 'nope', colourByValue: { true: 'red', false: '#c62828' } })).toEqual({ showOnCalendar: true, colourByValue: { false: '#c62828' } });
    expect(fieldNameFor('Permit approved?')).toBe('permit_approved');
  });

  it('calendar badge: only for values with a colour; legend lists what is drawn', () => {
    expect(calendarBadge(permitRequired as any, true)).toEqual({ fieldId: 'f1', label: 'Permit required', icon: 'permit', colour: '#ef6c00', text: 'Yes' });
    expect(calendarBadge(permitRequired as any, false)).toBeNull();
    expect(calendarBadge(permitApproved as any, false)?.colour).toBe('#c62828');
    expect(calendarBadge(permitApproved as any, null)).toBeNull();
    expect(calendarBadge({ ...permitApproved, display: { showOnCalendar: false } } as any, true)).toBeNull();
    expect(calendarLegend([permitRequired as any, permitApproved as any]).map((l) => [l.label, l.colours.map((c) => c.value).join('/')])).toEqual([
      ['Permit required', 'Yes'],
      ['Permit approved', 'Yes/No'],
    ]);
  });
});
