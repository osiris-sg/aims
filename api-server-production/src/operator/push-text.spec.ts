/**
 * Round AD — WhatsApp pushes: no "…" (subjects and summaries in full), blank lines between sections, labels only where
 * needed, the sender as the company only, the own-name tail dropped from subjects, a short link; the digest as plain
 * lines without bullets or "(19 emails)". EN and JA. The approved Meta templates still read back one value per slot.
 */
import { batchText, cleanSubject, dateLabel, digestTemplateParams, digestText, pushTemplateParams, etaChangedLine, freeTimeLine, needsCheckBatchText, needsCheckText, parsePush, pushToBlock, senderWho, shortTask, stepOverdueLine, stripEmoji, trimSubject } from './push-text';

const EMOJI = /[\u{1F000}-\u{1FAFF}\u{2600}-\u{27BF}]/u;
const URL = 'https://app.ai-ms.io/go/abc123';
const jst = (iso: string) => new Date(`${iso}+09:00`);
const LONG_JA = 'Re:【ご相談】直近のDET費用及びディテンション回避策について、ならびに今後の対応方針のご確認のお願い';

describe('helpers', () => {
  it('never cuts a subject; drops the own-name tail; the sender is the company only', () => {
    expect(stripEmoji('✅ Linked to #18-2 · 2 files filed 📎')).toBe('Linked to #18-2 · 2 files filed');
    expect(trimSubject(LONG_JA)).toBe(LONG_JA);
    expect(cleanSubject('Re: 書類送付: 11月納入6063材ー281.919T,15.296T_アジアディールハブ')).toBe('Re: 書類送付: 11月納入6063材ー281.919T,15.296T');
    expect(cleanSubject('Re: 書類送付: 6005C材220MT 2026年11月納入分　ーアジアディールハブ')).toBe('Re: 書類送付: 6005C材220MT 2026年11月納入分');
    expect(cleanSubject('TELEX MSG - Asia Deal(Sus) //454003255 //198GX06516 // 20.416 MT//Yokohama')).toBe('TELEX MSG - Asia Deal(Sus) //454003255 //198GX06516 // 20.416 MT//Yokohama');
    expect(cleanSubject('  ')).toBe('(no subject)');
    expect(senderWho('Aluminium.Exports <docs@vedanta.co.in>', 'Vedanta')).toBe('Vedanta');
    expect(senderWho('taomura@isewan.co.jp', null)).toBe('taomura');
    expect(dateLabel(jst('2026-10-22T11:50:00'), 'en', true)).toBe('22 Oct 11:50');
    expect(dateLabel(jst('2026-10-22T11:50:00'), 'ja')).toBe('10/22');
  });
  it('shortens bell titles without "…"', () => {
    expect(shortTask('#14-1: detention free time ends 2026-10-20', 'en')).toBe('#14-1 detention');
    expect(shortTask('#19-1: import tax funds due 2026-10-21', 'ja')).toBe('#19-1 輸入税の資金');
    expect(shortTask('#19-1: Arrival Notice expected (ETA 2026-10-29)', 'en')).toBe('#19-1 arrival notice');
    expect(shortTask('#21-1: a very long reminder title that used to be clipped at twenty-four characters', 'en')).not.toContain('…');
  });
});

describe('(a) morning digest', () => {
  const input = { at: jst('2026-10-23T08:30:00'), filedAuto: 9, questions: 5, questionEmails: 19, overdue: ['#19-1 import tax funds', '#14-1 detention'], arriving: [{ ref: '#20-1', eta: jst('2026-10-24T00:00:00') }, { ref: '#19-1', eta: jst('2026-10-29T00:00:00') }, { ref: '#21-1', eta: null }, { ref: '#22-1', eta: null }, { ref: '#18-1', eta: null }, { ref: '#18-2', eta: null }, { ref: '#18-3', eta: null }, { ref: '#16-2', eta: null }], portalUrl: URL };
  it("EN: the owner's format — plain lines, no bullets, no email count, a blank line between sections, the short link last", () => {
    const t = digestText(input, 'en');
    expect(t).toBe(['Good morning. Fri 23 Oct', '', '9 emails filed automatically', '5 need your check', '2 tasks overdue: #19-1 import tax funds, #14-1 detention', '8 shipments arriving this week, first #20-1 on Sat 24 Oct', '', URL].join('\n'));
    expect(t).not.toMatch(/^- /m);
    expect(t).not.toContain('(19 emails)');
    expect(EMOJI.test(t)).toBe(false);
  });
  it('nothing to check, no tasks, no arrivals: the zero lines are left out', () => {
    expect(digestText({ ...input, questions: 0, questionEmails: 0, overdue: [], arriving: [] }, 'en')).toBe(['Good morning. Fri 23 Oct', '', '9 emails filed automatically', 'Nothing needs your check', '', URL].join('\n'));
    expect(digestText({ ...input, filedAuto: 1, questions: 1, overdue: ['#14-1 detention'], arriving: [{ ref: '#20-1', eta: null }] }, 'en')).toContain('1 email filed automatically\n1 needs your check\n1 task overdue: #14-1 detention\n1 shipment arriving this week, first #20-1');
  });
  it('JA', () => {
    const t = digestText({ ...input, overdue: ['#19-1 輸入税の資金', '#14-1 ディテンション'] }, 'ja');
    expect(t).toBe(['おはようございます。10月23日（金）', '', 'メール 9 件を自動処理', '5 件の確認が必要です', '期限超過のタスク 2 件: #19-1 輸入税の資金、#14-1 ディテンション', '今週到着 8 件、最初は #20-1（10/24（土））', '', URL].join('\n'));
    expect(digestText({ ...input, questions: 0, overdue: [], arriving: [] }, 'ja')).toContain('確認が必要なものはありません');
  });
});

describe('(b) (c) (d) an email needs a check', () => {
  const sus = { kind: 'WHICH' as const, from: 'Sato <sato@sus.co.jp>', company: 'SUS', date: jst('2026-10-23T06:53:00'), subject: 'Re: 書類送付: 6005C材220MT 2026年11月納入分　ーアジアディールハブ', options: [{ ref: '#18-1' }, { ref: '#18-2' }], summary: 'SUS revised the November delivery schedule and asks ADH to confirm.', portalUrl: URL };
  it("the owner's layout: title / company · date / subject in full / blank / summary / blank / what to do / short link", () => {
    expect(needsCheckText(sus, 'en')).toBe(['New email needs a shipment', 'SUS · 23 Oct 06:53', 'Re: 書類送付: 6005C材220MT 2026年11月納入分', '', 'SUS revised the November delivery schedule and asks ADH to confirm.', '', 'Reply with the shipment number (e.g. 18-1), or open AIMS:', URL].join('\n'));
    expect(needsCheckText({ ...sus, kind: 'CONFIRM', options: [{ ref: '#18-1' }] }, 'en')).toBe(needsCheckText(sus, 'en'));
    expect(needsCheckText({ ...sus, kind: 'CHECK', says: '6063' }, 'en')).toBe(needsCheckText(sus, 'en'));
    expect(needsCheckText(sus, 'en')).not.toMatch(/From:|Subject:|Says:|…|#18-1|Reply 1/);
  });
  it('no summary: no empty section; the sender is the company, else the From name', () => {
    expect(needsCheckText({ ...sus, summary: null }, 'en')).toBe(['New email needs a shipment', 'SUS · 23 Oct 06:53', 'Re: 書類送付: 6005C材220MT 2026年11月納入分', '', 'Reply with the shipment number (e.g. 18-1), or open AIMS:', URL].join('\n'));
    expect(needsCheckText({ ...sus, company: null, from: 'Aluminium.Exports <docs@vedanta.co.in>' }, 'en').split('\n')[1]).toBe('Aluminium.Exports · 23 Oct 06:53');
  });
  it('JA', () => {
    expect(needsCheckText({ ...sus, summary: 'SUSが11月の納入予定を変更し、ADHに確認を求めています。' }, 'ja')).toBe(['新しいメールに出荷の指定が必要です', 'SUS · 10/23 06:53', 'Re: 書類送付: 6005C材220MT 2026年11月納入分', '', 'SUSが11月の納入予定を変更し、ADHに確認を求めています。', '', '出荷番号で返信してください（例: 18-1）。またはAIMSを開く:', URL].join('\n'));
  });
  it('re-check: the date only, "Please confirm the shipment in AIMS:"', () => {
    const t = needsCheckText({ kind: 'RECHECK', from: 'Aluminium.Exports <docs@vedanta.co.in>', company: 'Vedanta', date: jst('2026-10-21T18:15:00'), subject: 'TELEX MSG - Asia Deal(Sus) //454003255 //198GX06516', options: [{ ref: '#18-2' }], summary: 'Vedanta sends the telex release code.', portalUrl: URL }, 'en');
    expect(t).toBe(["AIMS re-checked an email and isn't sure anymore", 'Vedanta · 21 Oct', 'TELEX MSG - Asia Deal(Sus) //454003255 //198GX06516', '', 'Vedanta sends the telex release code.', '', 'Please confirm the shipment in AIMS:', URL].join('\n'));
  });
  it('new deal / is it a shipment', () => {
    const deal = { kind: 'NEW_DEAL' as const, from: 'taomura@isewan.co.jp', company: 'Isewan', date: jst('2026-10-21T18:13:00'), subject: 'アルミインゴット輸入の件', options: [], summary: 'Isewan quotes Nagoya import charges for a 50 t ingot shipment.', portalUrl: URL };
    expect(needsCheckText(deal, 'en')).toBe(['New email looks like a new deal', 'Isewan · 21 Oct', 'アルミインゴット輸入の件', '', 'Isewan quotes Nagoya import charges for a 50 t ingot shipment.', '', "It isn't in AIMS yet. Open AIMS to create the order:", URL].join('\n'));
    expect(needsCheckText({ ...deal, kind: 'IS_SHIPMENT' }, 'en')).toBe(['Is this email about a shipment?', 'Isewan · 21 Oct 18:13', 'アルミインゴット輸入の件', '', 'Isewan quotes Nagoya import charges for a 50 t ingot shipment.', '', 'Reply 1 if it is, X if not, or open AIMS:', URL].join('\n'));
    expect(needsCheckText({ ...deal, kind: 'IS_SHIPMENT' }, 'ja').split('\n')[0]).toBe('このメールは出荷の件ですか？');
  });
  it('a batch: a header, one block per email (company · date / subject in full / the question), the link once', () => {
    const items = [sus, { ...sus, kind: 'RECHECK' as const, from: 'docs@vedanta.co.in', company: 'Vedanta', subject: 'TELEX MSG - Asia Deal(Sus) //454003255 //198GX06516 // 20.416 MT//Yokohama', date: jst('2026-10-21T18:15:00') }, { ...sus, kind: 'NEW_DEAL' as const, from: 'taomura@isewan.co.jp', company: 'Isewan', subject: 'アルミインゴット輸入の件', date: jst('2026-10-21T18:13:00') }];
    const t = needsCheckBatchText(items, 'en');
    expect(t).toBe(['3 new emails need your check', '', 'SUS · 23 Oct 06:53', 'Re: 書類送付: 6005C材220MT 2026年11月納入分', 'Which shipment?', '', 'Vedanta · 21 Oct', 'TELEX MSG - Asia Deal(Sus) //454003255 //198GX06516 // 20.416 MT//Yokohama', 'Re-check', '', 'Isewan · 21 Oct', 'アルミインゴット輸入の件', 'New deal?', '', 'Open AIMS:', URL].join('\n'));
    expect(t).not.toMatch(/…|^- /m);
    // The outbox stores text only: the same batch is rebuilt from the stored pushes.
    const stored = items.map((i) => ({ text: needsCheckText(i, 'en') }));
    expect(batchText(stored, 'en', URL)).toBe(t);
    expect(pushToBlock(needsCheckText(items[1], 'en'), 'en')).toBe('Vedanta · 21 Oct\nTELEX MSG - Asia Deal(Sus) //454003255 //198GX06516 // 20.416 MT//Yokohama\nRe-check');
    expect(batchText(items.map((i) => ({ text: needsCheckText(i, 'ja') })), 'ja', URL).split('\n')[0]).toBe('新しいメール 3 件の確認が必要です');
  });
  it('a stored round X–AC push (From: / Subject: lines) still reads back', () => {
    const old = `New email from Vedanta needs a shipment (22 Oct 14:31)\nSubject: RE: Copy documents\nSays: Vedanta sends copies.\nSend the shipment number (e.g. 18-1, or several: 18-1 18-2), or check the Dashboard: ${URL}`;
    expect(parsePush(old)).toMatchObject({ form: 'shipment', who: 'Vedanta, 22 Oct 14:31', subject: 'RE: Copy documents', summary: 'Vedanta sends copies.', url: URL });
    expect(pushToBlock(old, 'en')).toBe('Vedanta · 22 Oct 14:31\nRE: Copy documents\nWhich shipment?');
  });
});

describe('(e) events', () => {
  it('one line each; a batch lists the lines, a blank line, the link; a single push is sent as is', () => {
    expect(etaChangedLine('#22-1', jst('2026-10-28T00:00:00'), jst('2026-11-30T00:00:00'), 'en')).toBe('#22-1 ETA changed: 28 Oct -> 30 Nov');
    expect(etaChangedLine('#22-1', jst('2026-10-28T00:00:00'), jst('2026-11-30T00:00:00'), 'ja')).toBe('#22-1 ETA 変更: 10/28 -> 11/30');
    expect(freeTimeLine('#14-1', 'detention', jst('2026-10-20T00:00:00'), 'en')).toBe('#14-1 detention free time ended 20 Oct, check costs');
    expect(stepOverdueLine('#21-1', 'Customs tax estimate', 'en')).toBe('#21-1 step overdue: Customs tax estimate');
    expect(batchText([{ text: '#19-1 arrival notice filed' }], 'en', URL)).toBe('#19-1 arrival notice filed');
    expect(batchText([{ text: '#19-1 arrival notice filed' }, { text: '#22-1 ETA changed: 28 Oct -> 30 Nov' }], 'en', URL)).toBe(`#19-1 arrival notice filed\n#22-1 ETA changed: 28 Oct -> 30 Nov\n\n${URL}`);
    expect(EMOJI.test(batchText([{ text: '🚢 #19-1 arrival notice filed' }, { text: '⏳ x' }], 'en', URL))).toBe(false);
  });
});

describe('Meta templates: the pushes read back into one parameter per line', () => {
  it('aims_digest: [day, filed, waiting, overdue, arriving, link], EN and JA, zero lines → "none"', () => {
    const full = { at: jst('2026-10-22T08:30:00'), filedAuto: 18, questions: 4, questionEmails: 14, overdue: ['#19-1 import tax funds', '#14-1 detention'], arriving: [{ ref: '#20-1', eta: jst('2026-10-24T00:00:00') }, { ref: '#19-1', eta: null }], portalUrl: URL };
    expect(digestTemplateParams(digestText(full, 'en'), 'en')).toEqual(['Thu 22 Oct', '18 emails', '4 questions', '2: #19-1 import tax funds, #14-1 detention', '2 shipments (first: #20-1, Sat 24 Oct)', URL]);
    expect(digestTemplateParams(digestText({ ...full, questions: 0, questionEmails: 0, overdue: [], arriving: [] }, 'en'), 'en')).toEqual(['Thu 22 Oct', '18 emails', 'nothing', 'none', 'none', URL]);
    expect(digestTemplateParams(digestText({ ...full, overdue: ['#19-1 輸入税の資金'] }, 'ja'), 'ja')).toEqual(['10月22日（木）', '18 件', '質問 4 件', '1 件: #19-1 輸入税の資金', '2 件（最初: #20-1、10/24（土））', URL]);
    expect(digestTemplateParams('hello', 'en')).toBeNull();
  });
  it('needs_check / new_deal / recheck pushes map to their template; a batch does not', () => {
    const which = { kind: 'WHICH' as const, from: 'Toshiro Takekoshi <t@asiadealhub.com>', company: 'Asia Deal Hub', date: jst('2026-10-22T11:50:00'), subject: 'Re: DET', options: [{ ref: '#16-1' }, { ref: '#16-2' }], summary: 'ADH asks about DET costs.', portalUrl: URL };
    expect(pushTemplateParams(needsCheckText(which, 'en'))).toEqual({ kind: 'needs_check', lang: 'en', params: ['Asia Deal Hub · 22 Oct 11:50', 'Re: DET', 'It needs a shipment. ADH asks about DET costs.', `Reply with the shipment number (e.g. 18-1), or open AIMS: ${URL}`] });
    expect(pushTemplateParams(needsCheckText(which, 'ja'))?.kind).toBe('needs_check');
    expect(pushTemplateParams(needsCheckText({ ...which, kind: 'NEW_DEAL', from: 'taomura@isewan.co.jp', company: 'Isewan', options: [], summary: null }, 'en'))).toEqual({ kind: 'new_deal', lang: 'en', params: ['Isewan · 22 Oct', 'Re: DET', URL] });
    expect(pushTemplateParams(needsCheckText({ ...which, kind: 'NEW_DEAL', from: 'taomura@isewan.co.jp', company: 'Isewan', options: [] }, 'ja'))).toEqual({ kind: 'new_deal', lang: 'ja', params: ['Isewan · 10/22', 'Re: DET', URL] });
    expect(pushTemplateParams(needsCheckText({ ...which, kind: 'RECHECK' }, 'en'))).toEqual({ kind: 'recheck', lang: 'en', params: ['Asia Deal Hub · 22 Oct', 'Re: DET', URL] });
    expect(pushTemplateParams(needsCheckBatchText([which, { ...which, kind: 'CONFIRM' }], 'en'))).toBeNull();
    expect(pushTemplateParams('#19-1 arrival notice filed')).toBeNull();
  });
});
