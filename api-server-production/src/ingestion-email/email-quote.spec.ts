/** Round R: own text vs quoted history. */
import { isQuoteMarker, splitQuoted } from './email-quote';

describe('splitQuoted', () => {
  it('Gmail-JP, Outlook, "On … wrote:", ">" and "-----Original Message-----" markers start the quoted part', () => {
    const gm = splitQuoted('松木様\nお世話になっております。\n本船遅延のご連絡有難うございます。\n\n2026年10月15日(木) 18:16 Sayaka Matsuki <s@example.com>:\n吉田様\nBL(Maersk)：276956322');
    expect(gm.own).toBe('松木様\nお世話になっております。\n本船遅延のご連絡有難うございます。');
    expect(gm.quoted).toMatch(/276956322/);
    expect(splitQuoted('Thanks.\n\nFrom: Ravindra <r@example.com>\nSent: Monday\nSubject: x\n\nB/L 198GX06445').own).toBe('Thanks.');
    expect(splitQuoted('ok\n> B/L 198GX04630 の件').quoted).toBe('> B/L 198GX04630 の件');
    expect(splitQuoted('承知しました。\nOn Mon, Oct 20, 2026 at 9:40 AM Sayaka <s@x> wrote:\n> old').own).toBe('承知しました。');
    expect(splitQuoted('See below\n-----Original Message-----\nFrom: a').own).toBe('See below');
    expect(splitQuoted('no quote here\n\n--\nSignature\nTel 045-501-6232')).toEqual({ own: 'no quote here\n\n--\nSignature\nTel 045-501-6232', quoted: '' });
    expect(splitQuoted(null)).toEqual({ own: '', quoted: '' });
  });
  it('a quoted key is weak, an own-text key is strong', () => {
    expect(isQuoteMarker('2026年10月19日(月) 13:38 Sayaka Matsuki <sayaka@example.com<mailto:sayaka@example.com>>:')).toBe(true);
    expect(isQuoteMarker('BL(Maersk)：276956322')).toBe(false);
  });
});

describe('round AF — the earlier emails a reply quotes, and the ones AIMS never received', () => {
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const { quotedEmailHeaders, missingQuotedEmails, parseQuotedDate } = require('./email-quote');
  const quoted = [
    '-----Original Message-----',
    'From: Purchasing <purchasinglogistic.alumeid@gmail.com>',
    'Sent: Tuesday, 21 October 2026 18:00',
    'To: Sayaka',
    'Subject: Re: Draft - Sales Contract- 6063- 50 tne',
    '',
    'Please find the PI attached.',
    '',
    'On 20 Oct 2026 at 11:30, Sayaka Matsuki <sayaka@asiadealhub.com> wrote:',
    '> thanks',
    '',
    '2026年10月19日(日) 9:05 竹腰 <toshiro@asiadealhub.com>:',
    '> 契約書ドラフトです',
  ].join('\n');
  it('reads Outlook, Gmail and Japanese header blocks (dates in JST), once each', () => {
    const h = quotedEmailHeaders(quoted);
    expect(h.map((x: any) => x.address)).toEqual(['purchasinglogistic.alumeid@gmail.com', 'sayaka@asiadealhub.com', 'toshiro@asiadealhub.com']);
    expect(h[0].date?.toISOString()).toBe('2026-10-21T09:00:00.000Z');
    expect(h[1].date?.toISOString()).toBe('2026-10-20T02:30:00.000Z');
    expect(h[2].date?.toISOString()).toBe('2026-10-19T00:05:00.000Z');
    expect(quotedEmailHeaders(`${quoted}\n\n${quoted}`)).toHaveLength(3);
    expect(parseQuotedDate('Oct 21, 2026 at 6:00 PM')?.toISOString()).toBe('2026-10-21T09:00:00.000Z');
  });
  it('counts the quoted emails with no stored email of the same sender within 6 hours', () => {
    const h = quotedEmailHeaders(quoted);
    const stored = [{ from: 'Purchasing <purchasinglogistic.alumeid@gmail.com>', date: new Date('2026-10-21T09:02:00Z') }];
    expect(missingQuotedEmails(h, stored)).toBe(2);
    expect(missingQuotedEmails(h, [...stored, { from: 'sayaka@asiadealhub.com', date: new Date('2026-10-20T03:00:00Z') }, { from: '竹腰 <toshiro@asiadealhub.com>', date: null }])).toBe(0);
    expect(missingQuotedEmails([], stored)).toBe(0);
  });
});
