/**
 * Round AD — template names are decided in code from Meta's APPROVED list: v2 when approved, else the round X name,
 * else plain text; the notify utility twin only for SHIPMENTS orgs; env vars stay optional overrides.
 */
import { pickAnswerTemplate, pickNotifyTemplate, pickShipmentsTemplate, TemplateRow } from './template-status.service';

const row = (name: string, language: string, status = 'APPROVED'): TemplateRow => ({ name, language, status });
const ADH_TODAY: TemplateRow[] = [
  row('aims_digest', 'en'), row('aims_digest', 'ja'), row('aims_needs_check', 'en'), row('aims_needs_check', 'ja'), row('aims_new_deal', 'en'), row('aims_new_deal', 'ja'), row('aims_recheck', 'en'), row('aims_recheck', 'ja'),
  row('aims_digest_v2', 'en', 'PENDING'), row('aims_digest_v2', 'ja', 'PENDING'), row('aims_needs_check_v2', 'en', 'PENDING'), row('aims_notify', 'en'),
];
const NONE: NodeJS.ProcessEnv = {};

describe('shipments templates', () => {
  it('the round X names while v2 is pending; v2 as soon as it is approved — per language', () => {
    expect(pickShipmentsTemplate(ADH_TODAY, 'digest', 'en', NONE)).toBe('aims_digest');
    expect(pickShipmentsTemplate(ADH_TODAY, 'needs_check', 'ja', NONE)).toBe('aims_needs_check');
    const later = ADH_TODAY.map((t) => (t.name === 'aims_digest_v2' && t.language === 'en' ? { ...t, status: 'APPROVED' } : t));
    expect(pickShipmentsTemplate(later, 'digest', 'en', NONE)).toBe('aims_digest_v2');
    expect(pickShipmentsTemplate(later, 'digest', 'ja', NONE)).toBe('aims_digest'); // ja v2 still pending
  });
  it('nothing approved → plain text; a rejected v2 falls back to v1; language codes like ja_JP count', () => {
    expect(pickShipmentsTemplate([], 'recheck', 'en', NONE)).toBe('');
    expect(pickShipmentsTemplate([row('aims_recheck_v2', 'en', 'REJECTED'), row('aims_recheck', 'en')], 'recheck', 'en', NONE)).toBe('aims_recheck');
    expect(pickShipmentsTemplate([row('aims_new_deal', 'ja_JP')], 'new_deal', 'ja', NONE)).toBe('aims_new_deal');
  });
  it('an env var overrides whatever Meta says', () => {
    expect(pickShipmentsTemplate(ADH_TODAY, 'digest', 'en', { WHATSAPP_DIGEST_TEMPLATE: 'my_digest' })).toBe('my_digest');
    expect(pickShipmentsTemplate([], 'needs_check', 'en', { WHATSAPP_NEEDS_TEMPLATE: 'x' })).toBe('x');
  });
});

describe('closed-window notify template', () => {
  it('an org WITHOUT the shipments module keeps aims_notify whatever the WABA has', () => {
    expect(pickNotifyTemplate([row('aims_notify_utility', 'en')], false, NONE)).toBe('aims_notify');
    expect(pickNotifyTemplate([], false, NONE)).toBe('aims_notify');
    expect(pickNotifyTemplate([], false, { WHATSAPP_NOTIFY_TEMPLATE: 'custom' })).toBe('custom');
  });
  it('a SHIPMENTS org gets the utility twin only once Meta approved it', () => {
    expect(pickNotifyTemplate(ADH_TODAY, true, NONE)).toBe('aims_notify');
    expect(pickNotifyTemplate([row('aims_notify_utility', 'en', 'PENDING')], true, NONE)).toBe('aims_notify');
    expect(pickNotifyTemplate([row('aims_notify_utility', 'en')], true, NONE)).toBe('aims_notify_utility');
    expect(pickNotifyTemplate([row('aims_notify_utility', 'en')], true, { WHATSAPP_NOTIFY_TEMPLATE: 'custom' })).toBe('custom');
  });
});

describe('round AE — the "needs your answer" family', () => {
  it('its name only when APPROVED for that language; nothing else is ever substituted', () => {
    const rows = [row('aims_answer', 'en'), row('aims_answer', 'ja', 'PENDING'), row('aims_answer_batch', 'en'), row('aims_needs_check_v2', 'en')];
    expect(pickAnswerTemplate(rows, 'answer', 'en')).toBe('aims_answer');
    expect(pickAnswerTemplate(rows, 'answer', 'ja')).toBe('');
    expect(pickAnswerTemplate(rows, 'answer_deal', 'en')).toBe('');
    expect(pickAnswerTemplate(rows, 'answer_batch', 'en')).toBe('aims_answer_batch');
    expect(pickAnswerTemplate([], 'answer_recheck', 'en')).toBe('');
  });
});
