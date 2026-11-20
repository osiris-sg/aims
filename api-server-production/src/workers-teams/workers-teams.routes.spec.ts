import { lastValueFrom, of } from 'rxjs';
import { ActionLogInterceptor } from '../action-log/action-log.interceptor';
import { tabsForRequest } from '../access/tab-access';

// Workers & Teams (WCT 2026-11-20): which custom-access tabs open the routes, and the Activity Log verbs.
function logOf(method: string, url: string, result?: any) {
  const rows: any[] = [];
  const interceptor = new ActionLogInterceptor({ log: async (e: any) => void rows.push(e) } as any);
  const req: any = { method, originalUrl: url, url, params: {}, headers: {}, body: {}, user: { id: 'u1', firstName: 'Elroy' }, userOrganization: { id: 'org1' } };
  const ctx: any = { getType: () => 'http', switchToHttp: () => ({ getRequest: () => req }) };
  const out = lastValueFrom(
    interceptor.intercept(ctx, {
      handle: () => {
        if (result) req.actionLogResult = result;
        return of({});
      },
    } as any),
  );
  return { rows, out };
}
const W = '9931cce0-c309-4e8b-a52c-76543b087eb2';

describe('workers-teams routes', () => {
  it('Org Settings opens the page (view reads, edit writes); the picker also opens from Jobs, Calendar and Orders', () => {
    expect(tabsForRequest('GET', '/workers-teams')).toEqual({ tabs: ['orgSettings'], need: 'view' });
    expect(tabsForRequest('POST', '/workers-teams/siteclock-sync')).toEqual({ tabs: ['orgSettings'], need: 'edit' });
    expect(tabsForRequest('GET', '/workers-teams/picker')).toEqual({ tabs: ['jobs', 'calendar', 'orders', 'orgSettings'], need: 'view' });
  });

  it('Activity Log: hide = HIDE, unhide = UNHIDE, the sync apply = SYNC with its counts; other routes keep their verbs', async () => {
    const cases: Array<[string, string, string]> = [
      ['POST', `/workers-teams/workers/${W}/hide`, 'HIDE'],
      ['POST', `/workers-teams/workers/${W}/unhide`, 'UNHIDE'],
      ['POST', `/workers-teams/teams/${W}/unhide`, 'UNHIDE'],
      ['POST', '/workers-teams/workers', 'CREATE'],
      ['PATCH', `/workers-teams/workers/${W}`, 'UPDATE'],
      // Another module's unhide is untouched by this round.
      ['POST', `/email-inbox/${W}/unhide`, 'CREATE'],
    ];
    for (const [m, url, action] of cases) {
      const { rows, out } = logOf(m, url);
      await out;
      expect([url, rows[0]?.action]).toEqual([url, action]);
    }
    const sync = logOf('POST', '/workers-teams/siteclock-sync', { applied: true, workers: '+2 new' });
    await sync.out;
    expect(sync.rows[0]).toMatchObject({ action: 'SYNC', resource: 'workers-teams' });
    expect(sync.rows[0].details.result).toEqual({ applied: true, workers: '+2 new' });
  });
});
