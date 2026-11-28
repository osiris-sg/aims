/** app_help (guru 2026-11-28, cost): the manual is looked up, not carried on every model call. */
import { APP_KNOWLEDGE } from '../guide/app-knowledge';
import { APP_HELP_INDEX, appHelp, buildHelp, headingOf, helpTokens } from './app-help';

describe('app_help', () => {
  it('the prompt carries an index a small fraction of the manual', () => {
    expect(APP_HELP_INDEX.length).toBeLessThan(APP_KNOWLEDGE.length / 15);
    expect(APP_HELP_INDEX).toContain('[ACCOUNTING]');
  });
  it('every entry of the manual is reachable: none is dropped when it is cut into passages', () => {
    const h = buildHelp(APP_KNOWLEDGE);
    const entries = APP_KNOWLEDGE.split('\n').map((l) => l.trim()).filter((l) => l && !/^===.*===$/.test(l));
    expect(new Set(h.passages.map((p) => p.entry)).size).toBe(entries.length);
    const chars = (s: string) => s.replace(/\s+/g, '').length;
    expect(h.passages.reduce((n, p) => n + chars(p.text), 0)).toBe(entries.reduce((n, e) => n + chars(e), 0));
  });
  it.each([
    ['how do I pay a supplier invoice with a payment voucher', /PAYMENT VOUCHER/i],
    ['account code without the dash', /ACCOUNT CODES WITHOUT THE DASH/],
    ['upload supplier invoices auto tag', /AUTO-TAG/],
    ['bank reconciliation', /Bank Reconciliation/],
    ['how much salary did we pay', /AIMEE AND THE BOOKS/],
  ])('"%s" finds its entry first', (q, topic) => {
    const r: any = appHelp({ query: q });
    expect(r.passages[0].topic).toMatch(topic);
    expect(JSON.stringify(r).length).toBeLessThan(24000);
  });
  it('nothing found says so and forbids answering from memory; an empty question is refused', () => {
    expect((appHelp({ query: 'zzzqqq xylophone' }) as any).note).toMatch(/Do not answer/);
    expect((appHelp({ query: '  ' }) as any).error).toBeTruthy();
  });
  it('words and headings', () => {
    expect(helpTokens('How do I void the Invoices?')).toEqual(['void', 'invoice']);
    expect(headingOf('Bank Reconciliation (/portal/accounting/bank-reconciliation): match lines')).toBe('Bank Reconciliation (/portal/accounting/bank-reconciliation)');
  });
});
