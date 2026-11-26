import { serviceTypeOfAccount, serviceTypesOf } from './service-types';

const WCT = { enableServiceTypes: true, serviceTypes: [{ code: 'MV', accountCode: '4-1000' }, { code: 'CD', accountCode: '4-2000' }, { code: 'AA/VO', accountCode: '4-3000' }, { code: 'TS', accountCode: '4-3500' }] };

describe('service types', () => {
  it('reads the org table only when the flag is on', () => {
    expect(serviceTypesOf(WCT).map((t) => t.code)).toEqual(['MV', 'CD', 'AA/VO', 'TS']);
    expect(serviceTypesOf({ ...WCT, enableServiceTypes: false })).toEqual([]);
    expect(serviceTypesOf({ enableServiceTypes: true })).toEqual([]);
    expect(serviceTypesOf(null)).toEqual([]);
  });

  it('drops malformed and repeated rows', () => {
    const f = { enableServiceTypes: true, serviceTypes: [{ code: 'CD', accountCode: '4-2000' }, { code: 'CD', accountCode: '4-9999' }, { code: '', accountCode: '4-1000' }, { code: 'MV' }, null] };
    expect(serviceTypesOf(f)).toEqual([{ code: 'CD', accountCode: '4-2000' }]);
  });

  it('derives a service type from its account', () => {
    const types = serviceTypesOf(WCT);
    expect(serviceTypeOfAccount(types, '4-3000')).toBe('AA/VO');
    expect(serviceTypeOfAccount(types, ' 4-2000 ')).toBe('CD');
    expect(serviceTypeOfAccount(types, '')).toBeNull();
    expect(serviceTypeOfAccount(types, null)).toBeNull();
    expect(serviceTypeOfAccount(types, 'SS001')).toBeNull();
  });
});
