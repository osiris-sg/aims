/** Round AK — Westmetall LME feed: parsing, monthly averages (validated against ADH's log), table sync rules. */
import * as fs from 'fs';
import * as path from 'path';
import { cleanLmeAuto, differsFromFinal, LmeParseError, monthlyAverages, parseWestmetallAverages, parseWestmetallDaily, planLmeSync, provisionalMonths, reviseTask, roundHalfUp2 } from './lme-feed';

const fx = (f: string) => fs.readFileSync(path.join(__dirname, '__fixtures__', f), 'utf8');
const daily = fx('westmetall-al-daily-2026-10-25.html');
const averages = fx('westmetall-al-averages-2026-10-25.html');

describe('Westmetall LME feed', () => {
  const days = parseWestmetallDaily(daily);
  const months = monthlyAverages(days);
  const avg = (m: string) => months.find((x) => x.month === m)!;

  it('parses the daily table (date · cash · 3-month · stock)', () => {
    expect(days.length).toBeGreaterThan(200);
    expect(days[days.length - 1]).toEqual({ date: '2026-10-23', cash: 3043, threeMonth: 3018, stock: 235800 });
    expect(days[0].date).toBe('2026-01-02');
  });

  it("reproduces ADH's price log and Westmetall's own monthly averages (half-up, 2 dp)", () => {
    expect(avg('2026-06')).toMatchObject({ avg: 3458.64, days: 22, final: true });
    expect(avg('2026-07')).toMatchObject({ avg: 3155.98, days: 23, final: true });
    expect(avg('2026-08').avg).toBe(3249.63); // 3,249.625 — banker's rounding would give .62
    expect(avg('2026-09').avg).toBe(3276.82);
    const published = parseWestmetallAverages(averages, 2026);
    for (const p of published) expect(avg(p.month).avg).toBe(p.cash);
    expect(published.find((p) => p.month === '2026-06')?.cash).toBe(3458.64);
  });

  it('the running month is provisional until a later trading day is published', () => {
    expect(avg('2026-10')).toMatchObject({ final: false, days: 17 });
    const withNov = monthlyAverages([...days, { date: '2026-11-02', cash: 3000, threeMonth: null, stock: null }]);
    expect(withNov.find((m) => m.month === '2026-10')!.final).toBe(true);
  });

  it('a changed page throws and gives nothing to write', () => {
    expect(() => parseWestmetallDaily('<html>maintenance</html>')).toThrow(LmeParseError);
    expect(() => parseWestmetallDaily(daily.replace(/LME Aluminium 3-month/g, 'LME Copper'))).toThrow(LmeParseError);
    expect(() => parseWestmetallDaily(daily.replace('3,043.00', '30.43'))).toThrow(/implausible/);
  });

  it('roundHalfUp2', () => {
    expect(roundHalfUp2(3249.625)).toBe(3249.63);
    expect(roundHalfUp2(1.005)).toBe(1.01);
    expect(roundHalfUp2(3155.97826)).toBe(3155.98);
  });

  describe('table sync', () => {
    const M = [
      { month: '2026-06', avg: 3458.64, days: 22, final: true },
      { month: '2026-07', avg: 3155.98, days: 23, final: true },
      { month: '2026-08', avg: 3249.63, days: 20, final: true },
      { month: '2026-10', avg: 3054.88, days: 17, final: false },
    ];
    it('fills empty months, leaves typed ones, reports a typed month that differs', () => {
      const p = planLmeSync({ '2026-06': 3458.64, '2026-07': 3150 }, {}, M, '2026-01');
      expect(p.writes.map((w) => [w.month, w.reason, w.final])).toEqual([
        ['2026-08', 'empty', true],
        ['2026-10', 'empty', false],
      ]);
      expect(p.agree).toEqual(['2026-06']);
      expect(p.conflicts).toEqual([{ month: '2026-07', table: 3150, westmetall: 3155.98, final: true }]);
    });
    it("keeps updating only the feed's own value; a hand edit makes the month the user's", () => {
      const auto = { '2026-10': { value: 3040.1, final: false, days: 15, at: 'x' } };
      expect(planLmeSync({ '2026-10': 3040.1 }, auto, M, '2026-01').writes.filter((w) => w.month === '2026-10')).toEqual([{ month: '2026-10', from: 3040.1, to: 3054.88, final: false, days: 17, reason: 'provisional-update' }]);
      const edited = planLmeSync({ '2026-10': 3050 }, auto, M, '2026-01');
      expect(edited.writes.filter((w) => w.month === '2026-10')).toEqual([]);
      expect(edited.conflicts.map((c) => c.month)).toEqual(['2026-10']);
      const fin = planLmeSync({ '2026-10': 3054.88 }, { '2026-10': { value: 3054.88, final: false, days: 17, at: 'x' } }, [{ month: '2026-10', avg: 3060, days: 22, final: true }], '2026-01');
      expect(fin.writes[0]).toMatchObject({ reason: 'finalized', to: 3060, final: true });
    });
    it('nothing before fromMonth; nothing to do when unchanged', () => {
      expect(planLmeSync({}, {}, M, '2026-08').writes.map((w) => w.month)).toEqual(['2026-08', '2026-10']);
      const auto = { '2026-08': { value: 3249.63, final: true, days: 20, at: 'x' } };
      expect(planLmeSync({ '2026-08': 3249.63 }, auto, M.slice(2, 3), '2026-01')).toEqual({ writes: [], conflicts: [], agree: [] });
    });
    it('provisional months = the feed-owned months not final yet', () => {
      const auto = cleanLmeAuto({ '2026-10': { value: 3054.88, final: false, days: 17 }, '2026-09': { value: 3276.82, final: true, days: 22 }, bad: 1 });
      expect(provisionalMonths({ '2026-10': 3054.88, '2026-09': 3276.82 }, auto)).toEqual(['2026-10']);
      expect(provisionalMonths({ '2026-10': 3000 }, auto)).toEqual([]); // edited by hand
    });
  });

  it('the revise task text', () => {
    const t = reviseTask({ key: 'CI:f1', month: '2026-09', used: 3250, final: 3276.82, kind: 'CI', ref: '#19-2', docLabel: 'Vedanta CI XP1', orderId: 'o', shipmentId: 's' });
    expect(t.key).toBe('LME_REVISE:CI:f1');
    expect(t.title).toBe('#19-2: ask Vedanta for the revised CI — LME Sep 2026 is final at 3,276.82');
    expect(t.detail).toContain('used LME 3,250.00');
    expect(differsFromFinal(3276.82, 3276.82)).toBe(false);
    expect(differsFromFinal(3250, 3276.82)).toBe(true);
    expect(differsFromFinal(null, 3276.82)).toBe(false);
  });
});
