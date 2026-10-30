import { cancelledDoConfig, carryServerDoKeys, doStatusTag, isCancelledDo, isIssuedOnSchedule, runStatusTag } from './do-number';

describe('WCT real DO numbers: tags and server-owned DO keys', () => {
  it('run status → tag', () => {
    for (const s of ['scheduled', 'in_progress', 'delivered', null, undefined]) expect(runStatusTag(s as any)).toBe('Pending');
    expect(runStatusTag('completed')).toBe('Completed');
    expect(runStatusTag('cancelled')).toBe('Cancelled');
  });

  it('DO → tag: voided wins, delivered_installed is Completed, else Pending', () => {
    expect(doStatusTag({ status: 'unconfirmed', config: { cancelled: true } })).toBe('Cancelled');
    expect(doStatusTag({ status: 'delivered_installed', config: {} })).toBe('Completed');
    expect(doStatusTag({ status: 'confirmed', config: null })).toBe('Pending');
    expect(doStatusTag({ status: 'unconfirmed' })).toBe('Pending');
  });

  it('cancel stamps the void and keeps everything else', () => {
    const at = new Date('2026-10-30T10:00:00Z');
    const c = cancelledDoConfig({ items: [{ description: 'x' }], issuedOnSchedule: true }, 12, at);
    expect(c).toMatchObject({ items: [{ description: 'x' }], issuedOnSchedule: true, cancelled: true, cancelledAt: at.toISOString(), cancelledReason: 'Delivery #12 was cancelled' });
    expect(isCancelledDo(c)).toBe(true);
    expect(isIssuedOnSchedule(c)).toBe(true);
    expect(isIssuedOnSchedule({})).toBe(false);
    expect(isIssuedOnSchedule(null)).toBe(false);
  });

  it('an editor save (config rebuilt from the form) keeps the server-owned keys', () => {
    const prev = { issuedOnSchedule: true, cancelled: true, cancelledAt: 't', cancelledReason: 'r', remarks: 'old' };
    expect(carryServerDoKeys(prev, { remarks: 'new' })).toEqual({ remarks: 'new', issuedOnSchedule: true, cancelled: true, cancelledAt: 't', cancelledReason: 'r' });
  });

  it('…but an explicit value in the incoming config wins, and nothing is invented', () => {
    expect(carryServerDoKeys({ cancelled: true }, { cancelled: false })).toEqual({ cancelled: false });
    expect(carryServerDoKeys({ remarks: 'x' }, { remarks: 'y' })).toEqual({ remarks: 'y' });
    expect(carryServerDoKeys(null, { a: 1 })).toEqual({ a: 1 });
  });
});
