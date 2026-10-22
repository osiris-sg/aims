/**
 * Round X — WhatsApp pushes: short, plain, no emojis; sender "Name (Company)"; subjects trimmed to ~50; batched
 * "needs a check" pushes become one line each; EN and JA.
 */
import { batchText, dateLabel, digestTemplateParams, digestText, pushTemplateParams, etaChangedLine, freeTimeLine, needsCheckBatchText, needsCheckText, pushToLine, senderLine, shortTask, stepOverdueLine, stripEmoji, trimSubject } from './push-text';

const EMOJI = /[\u{1F000}-\u{1FAFF}\u{2600}-\u{27BF}]/u;
const URL = 'https://app.ai-ms.io/portal';
const jst = (iso: string) => new Date(`${iso}+09:00`);

describe('helpers', () => {
  it('strips emojis, trims subjects to 50 with …, names the sender as Name (Company)', () => {
    expect(stripEmoji('✅ Linked to #18-2 · 2 files filed 📎')).toBe('Linked to #18-2 · 2 files filed');
    expect(trimSubject('Re:【ご相談】直近のDET費用及びディテンション回避策について、ならびに今後の対応方針のご確認のお願い')).toMatch(/…$/);
    expect(trimSubject('Re:【ご相談】直近のDET費用及びディテンション回避策について、ならびに今後の対応方針のご確認のお願い').length).toBeLessThanOrEqual(50);
    expect(senderLine('Toshiro Takekoshi <toshiro.takekoshi@asiadealhub.com>', 'Asia Deal Hub')).toBe('Toshiro Takekoshi (Asia Deal Hub)');
    expect(senderLine('taomura@isewan.co.jp', 'Isewan')).toBe('taomura (Isewan)');
    expect(senderLine('Vedanta <docs@vedanta.co.in>', 'Vedanta')).toBe('Vedanta');
    expect(dateLabel(jst('2026-10-22T11:50:00'), 'en', true)).toBe('22 Oct 11:50');
    expect(dateLabel(jst('2026-10-22T11:50:00'), 'ja')).toBe('10/22');
  });
  it('shortens bell titles', () => {
    expect(shortTask('#14-1: detention free time ends 2026-10-20', 'en')).toBe('#14-1 detention');
    expect(shortTask('#19-1: import tax funds due 2026-10-21', 'ja')).toBe('#19-1 輸入税の資金');
    expect(shortTask('#19-1: Arrival Notice expected (ETA 2026-10-29)', 'en')).toBe('#19-1 arrival notice');
  });
});

describe('(a) morning digest', () => {
  const input = { at: jst('2026-10-22T08:30:00'), filedAuto: 18, questions: 4, questionEmails: 14, overdue: ['#19-1 import tax funds', '#14-1 detention'], arriving: [{ ref: '#20-1', eta: jst('2026-10-24T00:00:00') }, { ref: '#19-1', eta: jst('2026-10-29T00:00:00') }, { ref: '#21-1', eta: null }, { ref: '#22-1', eta: null }, { ref: '#18-1', eta: null }], portalUrl: URL };
  it('EN: the owner\'s format, one fact per line, no emojis, under 8 lines', () => {
    const t = digestText(input, 'en');
    expect(t).toBe(['Good morning. Thu 22 Oct', '- 18 emails filed automatically', '- 4 need your check (14 emails)', '- 2 tasks overdue: #19-1 import tax funds, #14-1 detention', '- 5 shipments arriving this week (first: #20-1, Sat 24 Oct)', `Open the Dashboard: ${URL}`].join('\n'));
    expect(t.split('\n').length).toBeLessThanOrEqual(8);
    expect(EMOJI.test(t)).toBe(false);
  });
  it('nothing to check, no tasks, no arrivals: the zero lines are left out', () => {
    const t = digestText({ ...input, questions: 0, questionEmails: 0, overdue: [], arriving: [] }, 'en');
    expect(t).toBe(['Good morning. Thu 22 Oct', '- 18 emails filed automatically', '- Nothing needs your check', `Open the Dashboard: ${URL}`].join('\n'));
  });
  it('JA', () => {
    const t = digestText({ ...input, overdue: ['#19-1 輸入税の資金', '#14-1 ディテンション'] }, 'ja');
    expect(t).toBe(['おはようございます。10月22日（木）', '- メール 18 件を自動処理', '- 4 件の確認が必要です（メール 14 件）', '- 期限超過のタスク 2 件: #19-1 輸入税の資金、#14-1 ディテンション', '- 今週到着 5 件（最初: #20-1、10/24（土））', `ダッシュボードを開く: ${URL}`].join('\n'));
    expect(digestText({ ...input, questions: 0, overdue: [], arriving: [] }, 'ja')).toContain('- 確認が必要なものはありません');
  });
});

describe('(b) (c) (d) an email needs a check', () => {
  const which = { kind: 'WHICH' as const, from: 'Toshiro Takekoshi <toshiro.takekoshi@asiadealhub.com>', company: 'Asia Deal Hub', date: jst('2026-10-22T11:50:00'), subject: 'Re:【ご相談】直近のDET費用及びディテンション回避策について', options: [{ ref: '#16-1' }, { ref: '#16-2' }], portalUrl: URL };
  it('round AA — a shipment question is minimal: no suggestions, ask for the shipment number (WHICH / CONFIRM / CHECK alike)', () => {
    const t = needsCheckText(which, 'en');
    expect(t).toBe(['New email from Asia Deal Hub needs a shipment (22 Oct 11:50)', 'Subject: Re:【ご相談】直近のDET費用及びディテンション回避策について', `Send the shipment number (e.g. 18-1, or several: 18-1 18-2), or check the Dashboard: ${URL}`].join('\n'));
    expect(t).not.toMatch(/#16-1|AIMS thinks|Reply 1/);
    expect(needsCheckText({ ...which, kind: 'CONFIRM', options: [{ ref: '#16-1' }] }, 'en')).toBe(t);
    expect(needsCheckText({ ...which, kind: 'CHECK', options: [{ ref: '#18-2' }], says: '6063' }, 'en')).toBe(t);
    expect(needsCheckText(which, 'ja')).toBe(['Asia Deal Hub からの新しいメールに出荷の指定が必要です（10/22 11:50）', '件名: Re:【ご相談】直近のDET費用及びディテンション回避策について', `出荷番号を送ってください（例: 18-1、複数なら 18-1 18-2）。またはダッシュボードで確認: ${URL}`].join('\n'));
    expect(needsCheckText({ ...which, kind: 'IS_SHIPMENT', options: [] }, 'en')).toContain("AIMS isn't sure this is about a shipment at all.\nReply 1 if it is, X if not, or check it");
  });
  it('(c) new deal and (d) re-check', () => {
    const deal = { ...which, kind: 'NEW_DEAL' as const, from: 'taomura@isewan.co.jp', company: 'Isewan', date: jst('2026-10-21T09:13:00'), subject: 'アルミインゴット輸入の件', options: [] };
    expect(needsCheckText(deal, 'en')).toBe(['New email from taomura (Isewan), 21 Oct', 'Subject: アルミインゴット輸入の件', "This looks like a new deal that isn't in AIMS yet.", `Check it on the Dashboard: ${URL}`].join('\n'));
    expect(needsCheckText(deal, 'ja')).toBe(['taomura (Isewan) から新しいメール、10/21', '件名: アルミインゴット輸入の件', 'AIMSにまだない新しい案件のようです。', `ダッシュボードで確認: ${URL}`].join('\n'));
    const re = needsCheckText({ ...which, kind: 'RECHECK' }, 'en');
    expect(re).toBe(["AIMS re-checked an email and isn't sure anymore", 'From: Toshiro Takekoshi (Asia Deal Hub), 22 Oct', 'Subject: Re:【ご相談】直近のDET費用及びディテンション回避策について', `Please confirm the shipment on the Dashboard: ${URL}`].join('\n'));
    expect(needsCheckText({ ...which, kind: 'RECHECK' }, 'ja')).toContain('AIMSがメールを再確認したところ');
  });
  it('several in one batch: one line each, no reply codes; read back from the stored text too', () => {
    const items = [which, { ...which, kind: 'CONFIRM' as const, from: 'docs@vedanta.co.in', company: 'Vedanta', subject: 'RE: Copy documents - Asia Deal(Sus) //454003255 //198GX06516', options: [{ ref: '#19-1' }] }, { ...which, kind: 'NEW_DEAL' as const, from: 'taomura@isewan.co.jp', company: 'Isewan', subject: 'アルミインゴット輸入の件', options: [] }];
    const t = needsCheckBatchText(items, 'en');
    expect(t).toBe(['3 new emails need your check', '- Asia Deal Hub · Re:【ご相談】直近のDET費用及びディテンション回避策に… · which shipment?', '- Vedanta · RE: Copy documents - Asia Dea… · which shipment?', '- Isewan · アルミインゴット輸入の件 · new deal?', `Check them on the Dashboard: ${URL}`].join('\n'));
    expect(t).not.toMatch(/Reply/);
    // The outbox stores text only: the same batch is rebuilt from the stored pushes.
    const stored = items.map((i) => ({ text: needsCheckText(i, 'en') }));
    expect(batchText(stored, 'en', URL)).toBe(t);
    expect(pushToLine(needsCheckText(items[1], 'en'), 'en')).toBe('Vedanta · RE: Copy documents - Asia Dea… · which shipment?');
    expect(batchText(items.map((i) => ({ text: needsCheckText(i, 'ja') })), 'ja', URL).split('\n')[0]).toBe('新しいメール 3 件の確認が必要です');
  });
});

describe('(e) events', () => {
  it('one line each; a batch lists the lines then the link once; a single push is sent as is', () => {
    expect(etaChangedLine('#22-1', jst('2026-10-28T00:00:00'), jst('2026-11-30T00:00:00'), 'en')).toBe('#22-1 ETA changed: 28 Oct -> 30 Nov');
    expect(etaChangedLine('#22-1', jst('2026-10-28T00:00:00'), jst('2026-11-30T00:00:00'), 'ja')).toBe('#22-1 ETA 変更: 10/28 -> 11/30');
    expect(freeTimeLine('#14-1', 'detention', jst('2026-10-20T00:00:00'), 'en')).toBe('#14-1 detention free time ended 20 Oct, check costs');
    expect(stepOverdueLine('#21-1', 'Customs tax estimate', 'en')).toBe('#21-1 step overdue: Customs tax estimate');
    expect(batchText([{ text: '#19-1 arrival notice filed' }], 'en', URL)).toBe('#19-1 arrival notice filed');
    expect(batchText([{ text: '#19-1 arrival notice filed' }, { text: '#22-1 ETA changed: 28 Oct -> 30 Nov' }], 'en', URL)).toBe(`#19-1 arrival notice filed\n#22-1 ETA changed: 28 Oct -> 30 Nov\nOpen the Dashboard: ${URL}`);
    expect(EMOJI.test(batchText([{ text: '🚢 #19-1 arrival notice filed' }, { text: '⏳ x' }], 'en', URL))).toBe(false);
  });
});

describe('Meta templates: the pushes read back into one parameter per line', () => {
  const URL2 = 'https://app.ai-ms.io/portal';
  it('aims_digest: [day, filed, waiting, overdue, arriving, link], EN and JA, zero lines → "none"', () => {
    const full = { at: jst('2026-10-22T08:30:00'), filedAuto: 18, questions: 4, questionEmails: 14, overdue: ['#19-1 import tax funds', '#14-1 detention'], arriving: [{ ref: '#20-1', eta: jst('2026-10-24T00:00:00') }, { ref: '#19-1', eta: null }], portalUrl: URL2 };
    expect(digestTemplateParams(digestText(full, 'en'), 'en')).toEqual(['Thu 22 Oct', '18 emails', '4 questions (14 emails)', '2: #19-1 import tax funds, #14-1 detention', '2 shipments (first: #20-1, Sat 24 Oct)', URL2]);
    expect(digestTemplateParams(digestText({ ...full, questions: 0, questionEmails: 0, overdue: [], arriving: [] }, 'en'), 'en')).toEqual(['Thu 22 Oct', '18 emails', 'nothing', 'none', 'none', URL2]);
    expect(digestTemplateParams(digestText({ ...full, overdue: ['#19-1 輸入税の資金'] }, 'ja'), 'ja')).toEqual(['10月22日（木）', '18 件', '質問 4 件（メール 14 件）', '1 件: #19-1 輸入税の資金', '2 件（最初: #20-1、10/24（土））', URL2]);
    expect(digestTemplateParams('hello', 'en')).toBeNull();
  });
  it('needs_check / new_deal / recheck pushes map to their template; a batch does not', () => {
    const which = { kind: 'WHICH' as const, from: 'Toshiro Takekoshi <t@asiadealhub.com>', company: 'Asia Deal Hub', date: jst('2026-10-22T11:50:00'), subject: 'Re: DET', options: [{ ref: '#16-1' }, { ref: '#16-2' }], portalUrl: URL2 };
    expect(pushTemplateParams(needsCheckText(which, 'en'))).toEqual({ kind: 'needs_check', lang: 'en', params: ['Asia Deal Hub, 22 Oct 11:50', 'Re: DET', 'It needs a shipment.', `Send the shipment number (e.g. 18-1, or several: 18-1 18-2), or check the Dashboard: ${URL2}`] });
    expect(pushTemplateParams(needsCheckText(which, 'ja'))?.kind).toBe('needs_check');
    expect(pushTemplateParams(needsCheckText({ ...which, kind: 'NEW_DEAL', from: 'taomura@isewan.co.jp', company: 'Isewan', options: [] }, 'en'))).toEqual({ kind: 'new_deal', lang: 'en', params: ['taomura (Isewan), 22 Oct', 'Re: DET', URL2] });
    expect(pushTemplateParams(needsCheckText({ ...which, kind: 'NEW_DEAL', from: 'taomura@isewan.co.jp', company: 'Isewan', options: [] }, 'ja'))).toEqual({ kind: 'new_deal', lang: 'ja', params: ['taomura (Isewan)、10/22', 'Re: DET', URL2] });
    expect(pushTemplateParams(needsCheckText({ ...which, kind: 'RECHECK' }, 'en'))).toEqual({ kind: 'recheck', lang: 'en', params: ['Toshiro Takekoshi (Asia Deal Hub), 22 Oct', 'Re: DET', URL2] });
    expect(pushTemplateParams(needsCheckBatchText([which, { ...which, kind: 'CONFIRM' }], 'en'))).toBeNull();
    expect(pushTemplateParams('#19-1 arrival notice filed')).toBeNull();
  });
});
