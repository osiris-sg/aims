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
