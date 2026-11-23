/**
 * Jobs calendar search (WCT group, enableGroupCalendar, 2026-11-23): order, icons, escaping, the flag gate and the
 * Companies filter.
 */
import { NotFoundException } from '@nestjs/common';
import { jobIcons, likeOf, orderHits } from './jobs-calendar-search';
import { JobsCalendarService } from './jobs-calendar.service';

const hit = (id: string, date: string, at: string) => ({ kind: 'job' as const, id, orgId: 'o', orgName: 'O', date, time: null, at, customer: null, address: null, icons: '', label: '' });

describe('jobs calendar search', () => {
  it('upcoming first (nearest first), then past (most recent first)', () => {
    const out = orderHits(
      [hit('past-old', '2026-01-02', '2026-01-02T01:00:00.000Z'), hit('next-week', '2026-11-30', '2026-11-30T01:00:00.000Z'), hit('today', '2026-11-23', '2026-11-23T01:00:00.000Z'), hit('past-new', '2026-11-20', '2026-11-20T01:00:00.000Z')],
      '2026-11-23',
    );
    expect(out.map((h) => h.id)).toEqual(['today', 'next-week', 'past-new', 'past-old']);
  });

  it('status icons as on the calendar; LIKE text escaped', () => {
    expect(jobIcons({ status: 'cancelled' }, { postponed: true, sticker: true })).toBe('❌ 📌');
    expect(jobIcons({ status: 'scheduled' }, { postponed: true, cod: true })).toBe('⭕ 🟫');
    expect(jobIcons({ status: 'completed' }, undefined)).toBe('✅');
    expect(likeOf('50%_off\\')).toBe('%50\\%\\_off\\\\%');
  });

  it('only behind the group calendar flag; the Companies filter narrows the companies searched', async () => {
    const queries: string[] = [];
    const prisma: any = {
      organizationUIConfig: { findUnique: async ({ where }: any) => ({ features: where.organizationId === 'wct' ? { enableGroupCalendar: true } : {} }) },
      organization: { findUnique: async () => ({ name: 'WCT (S)' }), findMany: async () => [] },
      $queryRaw: jest.fn(async (strings: any, ...vals: any[]) => {
        queries.push(String(vals.find((v) => v === 'wct' || v === 'bc') ?? ''));
        return [];
      }),
      customFieldValue: { findMany: async () => [] },
      customField: { findFirst: async () => null },
    };
    const svc = new JobsCalendarService(prisma);
    await expect(svc.search('other', 'aalst')).rejects.toBeInstanceOf(NotFoundException);
    expect((await svc.search('wct', 'a')).results).toEqual([]); // under 2 letters: nothing asked
    const scope = jest.spyOn(require('../organizations/org-group'), 'groupReadScope').mockResolvedValue({ group: true, orgs: [{ id: 'wct', name: 'WCT (S)' }, { id: 'bc', name: 'BC Air' }] } as any);
    await svc.search('wct', 'aalst', ['bc']);
    expect(new Set(queries.filter(Boolean))).toEqual(new Set(['bc']));
    scope.mockRestore();
  });
});
