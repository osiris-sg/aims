import { BadRequestException } from '@nestjs/common';
import { ServiceReportSignService, isTechSignatureKey } from './service-report-sign.service';

// 2026-11-24: since e1687fbc the server builds upload keys as
// org/<orgId>/<folder>/<uuid>.<ext>; the sign-link check still wanted the old
// flat maintenance-reports/<file> key, so every "Create link" was refused.
const ORG = '52e90ba8-bfbd-48b0-bb76-4f9667bf74f1';
const OTHER = '11111111-2222-3333-4444-555555555555';
const UUID = 'a1b2c3d4-e5f6-4789-8abc-0123456789ab';
const NEW_KEY = `org/${ORG}/maintenance-reports/${UUID}.png`;

describe('isTechSignatureKey', () => {
  it('accepts a new server-built key of this org', () => {
    expect(isTechSignatureKey(NEW_KEY, ORG)).toBe(true);
  });
  it('refuses another org\'s key', () => {
    expect(isTechSignatureKey(`org/${OTHER}/maintenance-reports/${UUID}.png`, ORG)).toBe(false);
  });
  it('accepts a legacy flat key', () => {
    expect(isTechSignatureKey(`maintenance-reports/${UUID}.png`, ORG)).toBe(true);
  });
  it('refuses other folders, traversal and junk', () => {
    for (const k of [
      `org/${ORG}/logos/${UUID}.png`,
      `org/${ORG}/maintenance-reports/../logos/x.png`,
      'maintenance-reports/../x.png',
      'logos/x.png',
      'https://evil.example/x.png',
      `maintenance-reports/${OTHER}/x.png`,
    ]) expect(isTechSignatureKey(k, ORG)).toBe(false);
  });
});

describe('ServiceReportSignService.mint techSignatureKey', () => {
  const make = () => {
    const created: any[] = [];
    const prisma: any = {
      maintenanceServiceReport: {
        findMany: jest.fn(async () => [{ id: 'r1', kind: 'SERVICE', status: 'draft', signature: null, serviceData: { customerName: 'C' } }]),
      },
      serviceReportSignLink: {
        findMany: jest.fn(async () => []),
        create: jest.fn(async ({ data }: any) => { created.push(data); return { ...data, id: 'l1' }; }),
        update: jest.fn(),
      },
    };
    const svc = new ServiceReportSignService(prisma, {} as any, {} as any);
    return { svc, created };
  };

  it('creates the link with a new org/<org>/maintenance-reports key', async () => {
    const { svc, created } = make();
    const r = await svc.mint(ORG, { reportIds: ['r1'], techSignatureKey: NEW_KEY }, 'u1');
    expect(r.token).toBeTruthy();
    expect(created[0].techSignatureKey).toBe(NEW_KEY);
  });
  it('refuses another org\'s key', async () => {
    const { svc, created } = make();
    await expect(svc.mint(ORG, { reportIds: ['r1'], techSignatureKey: `org/${OTHER}/maintenance-reports/${UUID}.png` })).rejects.toThrow(BadRequestException);
    expect(created).toHaveLength(0);
  });
  it('still accepts a legacy key', async () => {
    const { svc, created } = make();
    await svc.mint(ORG, { reportIds: ['r1'], techSignatureKey: `maintenance-reports/${UUID}.png` });
    expect(created[0].techSignatureKey).toBe(`maintenance-reports/${UUID}.png`);
  });
});
