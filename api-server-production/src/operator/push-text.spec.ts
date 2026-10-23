/**
 * Round AE — ONE message family, "an email needs your answer": the plain text is the template body with its values, so
 * a push looks the same inside and outside the 24-hour window. EN + JA, five variants, read back from the stored text.
 */
import { ANSWER_TEMPLATES, answerBatchParamsOf, answerParamsOf, batchText, cleanSubject, dateLabel, digestTemplateParams, digestText, etaChangedLine, freeTimeLine, isNeedsCheckPush, needsCheckBatchText, needsCheckText, parseAnswerPush, renderTemplate, senderWho, shortTask, stepOverdueLine, stripEmoji, templateValue, trimSubject } from './push-text';

const EMOJI = /[\u{1F000}-\u{1FAFF}\u{2600}-\u{27BF}]/u;
const URL = 'https://app.ai-ms.io/go/k7m2xq4p';
const jst = (iso: string) => new Date(`${iso}+09:00`);
const sus = { kind: 'WHICH' as const, from: 'Sato <sato@sus.co.jp>', company: 'SUS', date: jst('2026-10-23T06:53:00'), subject: 'Re: 書類送付: 6005C材220MT 2026年11月納入分　ーアジアディールハブ', options: [], summary: 'SUS revised the November delivery schedule and asks ADH to confirm.', portalUrl: URL };

describe('helpers', () => {
  it('never cuts a subject; drops the own-name tail; the sender is the company only; a template value is one line and never empty', () => {
    expect(stripEmoji('✅ Linked to #18-2 · 2 files filed 📎')).toBe('Linked to #18-2 · 2 files filed');
    expect(trimSubject('x'.repeat(120))).toBe('x'.repeat(120));
    expect(cleanSubject('Re: 書類送付: 11月納入6063材ー281.919T,15.296T_アジアディールハブ')).toBe('Re: 書類送付: 11月納入6063材ー281.919T,15.296T');
    expect(senderWho('Aluminium.Exports <docs@vedanta.co.in>', 'Vedanta')).toBe('Vedanta');
    expect(dateLabel(jst('2026-10-22T11:50:00'), 'en', true)).toBe('22 Oct 11:50');
    expect(templateValue('  a\n b  ')).toBe('a b');
    expect(templateValue('')).toBe('-');
    expect(renderTemplate('A {{1}} B {{2}}', ['x', ''])).toBe('A x B -');
    expect(shortTask('#14-1: detention free time ends 2026-10-20', 'en')).toBe('#14-1 detention');
  });
});

describe('the template bodies (what Meta gets)', () => {
  it('no variable first or last, no emoji, no "…", every variant has the five values (the batch four)', () => {
    for (const [kind, langs] of Object.entries(ANSWER_TEMPLATES)) {
      for (const body of Object.values(langs)) {
        expect(body).not.toMatch(/^\{\{|\}\}$/);
        expect(EMOJI.test(body)).toBe(false);
        expect(body).not.toContain('…');
        const n = [...body.matchAll(/\{\{(\d+)\}\}/g)].map((m) => Number(m[1]));
        expect(Math.max(...n)).toBe(kind === 'answer_batch' ? 4 : 5);
        expect(body.length).toBeLessThan(1024);
      }
    }
  });
});

describe('the ONE push', () => {
  it("needs a shipment: the owner's layout, EN", () => {
    expect(needsCheckText(sus, 'en')).toBe(['New email needs your answer', 'From SUS · 23 Oct 06:53', 'Subject: Re: 書類送付: 6005C材220MT 2026年11月納入分', 'Summary: SUS revised the November delivery schedule and asks ADH to confirm.', `Reply with the shipment number, or open AIMS: ${URL} to answer.`].join('\n'));
    expect(needsCheckText({ ...sus, kind: 'CONFIRM' }, 'en')).toBe(needsCheckText(sus, 'en'));
    expect(needsCheckText({ ...sus, kind: 'CHECK' }, 'en')).toBe(needsCheckText(sus, 'en'));
    expect(answerParamsOf(sus, 'en')).toEqual(['SUS', '23 Oct 06:53', 'Re: 書類送付: 6005C材220MT 2026年11月納入分', 'SUS revised the November delivery schedule and asks ADH to confirm.', URL]);
  });
  it('JA, and a missing summary shows "-"', () => {
    expect(needsCheckText({ ...sus, summary: 'SUSが11月の納入予定を変更し、ADHに確認を求めています。' }, 'ja')).toBe(['新しいメールへの回答が必要です', '差出人 SUS · 10/23 06:53', '件名: Re: 書類送付: 6005C材220MT 2026年11月納入分', '要約: SUSが11月の納入予定を変更し、ADHに確認を求めています。', `出荷番号で返信するか、AIMS（${URL}）を開いて回答してください。`].join('\n'));
    expect(needsCheckText({ ...sus, summary: null }, 'en').split('\n')[3]).toBe('Summary: -');
  });
  it('the variants differ only in the title (re-check) or the last line', () => {
    const deal = needsCheckText({ ...sus, kind: 'NEW_DEAL', company: 'Isewan', subject: 'アルミインゴット輸入の件' }, 'en').split('\n');
    expect(deal[0]).toBe('New email needs your answer');
    expect(deal[4]).toBe(`Reply NEW to create the order or X if it's not a deal, or open AIMS: ${URL} to answer.`);
    expect(needsCheckText({ ...sus, kind: 'IS_SHIPMENT' }, 'en').split('\n')[4]).toBe(`Reply X if it's not about a shipment or send the shipment number, or open AIMS: ${URL} to answer.`);
    const re = needsCheckText({ ...sus, kind: 'RECHECK', company: 'Vedanta' }, 'en').split('\n');
    expect(re[0]).toBe("AIMS isn't sure about an email anymore");
    expect(re[4]).toBe(`Reply with the shipment number, or open AIMS: ${URL} to answer.`);
    expect(needsCheckText({ ...sus, kind: 'RECHECK' }, 'ja').split('\n')[0]).toBe('AIMSがメールについて確信が持てなくなりました');
  });
  it('the stored text reads back into its variant and values (both languages); older layouts and event lines do not', () => {
    for (const kind of ['WHICH', 'NEW_DEAL', 'IS_SHIPMENT', 'RECHECK'] as const) {
      for (const lang of ['en', 'ja'] as const) {
        const p = parseAnswerPush(needsCheckText({ ...sus, kind }, lang))!;
        expect(p).toBeTruthy();
        expect(p.lang).toBe(lang);
        expect(p.variant).toBe(kind === 'NEW_DEAL' ? 'answer_deal' : kind === 'IS_SHIPMENT' ? 'answer_is_shipment' : kind === 'RECHECK' ? 'answer_recheck' : 'answer');
        expect(p.params).toEqual(answerParamsOf(sus, lang));
        expect(renderTemplate(ANSWER_TEMPLATES[p.variant][lang], p.params)).toBe(needsCheckText({ ...sus, kind }, lang));
      }
    }
    expect(parseAnswerPush('New email needs a shipment\nSUS · 23 Oct\nRe: x\n\nReply with the shipment number (e.g. 18-1), or open AIMS:\nhttps://x')).toBeNull();
    expect(parseAnswerPush('#19-1 arrival notice filed')).toBeNull();
    expect(isNeedsCheckPush(needsCheckText(sus, 'ja'))).toBe(true);
    expect(isNeedsCheckPush('#19-1 arrival notice filed')).toBe(false);
  });
  it('several within 10 minutes: the batch — count, the latest, the link (EN + JA)', () => {
    const items = [sus, { ...sus, kind: 'RECHECK' as const, company: 'Vedanta', subject: 'TELEX MSG - Asia Deal(Sus) //454003255 //198GX06516', date: jst('2026-10-21T18:15:00') }, { ...sus, kind: 'NEW_DEAL' as const, company: 'Isewan', subject: 'アルミインゴット輸入の件', date: jst('2026-10-21T18:13:00') }];
    expect(needsCheckBatchText(items, 'en')).toBe(`You have 3 new emails that need your answer. Latest: SUS · 23 Oct 06:53 · Re: 書類送付: 6005C材220MT 2026年11月納入分. Open AIMS to answer them: ${URL} and reply with the shipment numbers.`);
    expect(needsCheckBatchText(items, 'ja')).toBe(`新しいメール 3 件への回答が必要です。最新: SUS · 10/23 06:53 · Re: 書類送付: 6005C材220MT 2026年11月納入分。AIMS（${URL}）を開いて回答するか、出荷番号で返信してください。`);
    expect(answerBatchParamsOf(3, { who: 'SUS', when: '23 Oct 06:53', subject: 'Re: x_アジアディールハブ' }, URL)).toEqual(['3', 'SUS · 23 Oct 06:53', 'Re: x', URL]);
    expect(needsCheckBatchText([sus], 'en')).toBe(needsCheckText(sus, 'en'));
    expect(isNeedsCheckPush(needsCheckBatchText(items, 'en'))).toBe(true);
  });
});

describe('kept but off by default: the digest and the events', () => {
  it('digest text and its template values still read back', () => {
    const full = { at: jst('2026-10-22T08:30:00'), filedAuto: 18, questions: 4, questionEmails: 14, overdue: ['#19-1 import tax funds'], arriving: [{ ref: '#20-1', eta: jst('2026-10-24T00:00:00') }], portalUrl: URL };
    expect(digestText(full, 'en')).toBe(['Good morning. Thu 22 Oct', '', '18 emails filed automatically', '4 need your check', '1 task overdue: #19-1 import tax funds', '1 shipment arriving this week, first #20-1 on Sat 24 Oct', '', URL].join('\n'));
    expect(digestTemplateParams(digestText(full, 'en'), 'en')).toEqual(['Thu 22 Oct', '18 emails', '4 questions', '1: #19-1 import tax funds', '1 shipment (first: #20-1, Sat 24 Oct)', URL]);
  });
  it('event lines and their batch', () => {
    expect(etaChangedLine('#22-1', jst('2026-10-28T00:00:00'), jst('2026-11-30T00:00:00'), 'en')).toBe('#22-1 ETA changed: 28 Oct -> 30 Nov');
    expect(freeTimeLine('#14-1', 'detention', jst('2026-10-20T00:00:00'), 'en')).toBe('#14-1 detention free time ended 20 Oct, check costs');
    expect(stepOverdueLine('#21-1', 'Customs tax estimate', 'ja')).toBe('#21-1 期限超過: Customs tax estimate');
    expect(batchText([{ text: '#19-1 arrival notice filed' }], 'en', URL)).toBe('#19-1 arrival notice filed');
    expect(batchText([{ text: '#19-1 arrival notice filed' }, { text: '#22-1 ETA changed: 28 Oct -> 30 Nov' }], 'en', URL)).toBe(`#19-1 arrival notice filed\n#22-1 ETA changed: 28 Oct -> 30 Nov\n\n${URL}`);
  });
});
