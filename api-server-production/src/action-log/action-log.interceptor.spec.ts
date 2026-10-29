import { lastValueFrom, of, throwError } from 'rxjs';
import { ActionLogInterceptor } from './action-log.interceptor';

// Only what the permanent-delete row needs: the PURGE verb and the handler's
// summary (req.actionLogResult) landing on the row's details.
function run(req: any, handle: () => any) {
  const rows: any[] = [];
  const interceptor = new ActionLogInterceptor({ log: async (e: any) => void rows.push(e) } as any);
  const ctx: any = { getType: () => 'http', switchToHttp: () => ({ getRequest: () => req }) };
  return { rows, out: lastValueFrom(interceptor.intercept(ctx, { handle } as any)) };
}

const RUN = '9931cce0-c309-4e8b-a52c-76543b087eb2';
const base = () => ({
  method: 'POST',
  originalUrl: `/deliveries/${RUN}/purge`,
  url: `/deliveries/${RUN}/purge`,
  params: { id: RUN },
  headers: {},
  body: {},
  user: { id: 'u1', firstName: 'Elroy' },
  userOrganization: { id: 'org1' },
});

describe('ActionLogInterceptor — permanent delivery delete', () => {
  it('logs PURGE with what the handler removed', async () => {
    const req: any = base();
    const { rows, out } = run(req, () => {
      req.actionLogResult = { deliveryNumber: 9, placeholderDocs: ['DO-PENDING-02'] };
      return of({ deleted: true });
    });
    await out;
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ action: 'PURGE', resource: 'deliveries', resourceId: RUN, actorType: 'USER', status: 'SUCCESS' });
    expect(rows[0].details.result).toEqual({ deliveryNumber: 9, placeholderDocs: ['DO-PENDING-02'] });
  });

  it('a refused delete logs the error and no result', async () => {
    const req: any = base();
    req.actionLogResult = { stale: true };
    const { rows, out } = run(req, () => throwError(() => Object.assign(new Error('Only a cancelled delivery can be deleted permanently'), { status: 400 })));
    await expect(out).rejects.toThrow(/cancelled/);
    expect(rows[0]).toMatchObject({ action: 'PURGE', status: 'FAILURE', statusCode: 400 });
    expect(rows[0].details.result).toBeUndefined();
  });
});
