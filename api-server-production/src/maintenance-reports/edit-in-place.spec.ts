import { MaintenanceReportsService } from './maintenance-reports.service';
import { buildWctServiceReportHtml } from './service-report-wct';
import { wctDataToDraft, wctDraftToData } from './msr-templates';

/**
 * WCT service reports edited in place on the report page (2026-11-16): the
 * draft both editors share, the edit view of the paper, and the save guards.
 */
const org = { name: 'WCT (S) Systems Pte Ltd' };
const P = (n: string) => `maintenance-reports/${n}.jpg`;

describe('the shared draft', () => {
  it('draft -> report data keeps ticked lines only when some are unticked, and the caption names', () => {
    const data = wctDraftToData({
      jobTypes: ['CD_HOOD'],
      grids: {
        HOOD: { before: [P('b1')], after: [], photos: [], lines: [0, 1, 2, 3] },
        UNIT_LOCATION: { before: [], after: [], photos: [P('u1')], lines: [] },
        FAN: { before: [P('ignored')], after: [], photos: [], lines: [0] }, // not ticked: not on the report
      },
      labels: { UNIT_LOCATION: ' Kitchen 2 ', FAN: '' },
    });
    expect(data.sections.HOOD).toEqual({ before: [P('b1')], after: [] });
    expect(data.sections.UNIT_LOCATION).toEqual({ photos: [P('u1')], lines: [] });
    expect(data.sections.FAN).toBeUndefined();
    expect(data.labels).toEqual({ UNIT_LOCATION: 'Kitchen 2' });
  });

  it('report data -> draft -> report data is the same report', () => {
    const wct = { jobTypes: ['CD_FULL'], sections: { HOOD: { before: [P('b1'), P('b2'), P('b3')], after: [P('a1')], lines: [0, 2] }, UNIT_LOCATION: { photos: [P('u')] } }, labels: { UNIT_LOCATION: 'Main kitchen' } };
    const draft = wctDataToDraft(wct, { customerName: 'TEST Client', serviceDate: '2026-11-16T00:00:00Z' });
    expect(draft).toMatchObject({ customerName: 'TEST Client', serviceDate: '2026-11-16', units: 1, cursor: { phase: 'job' } });
    expect(draft.grids.UNIT_LOCATION.lines).toEqual([0]); // all lines ticked, as the form starts
    expect(wctDraftToData(draft)).toEqual(wct);
  });
});

describe('the edit view of the paper', () => {
  const html = (wct: any, edit: boolean, extra: any = {}) => buildWctServiceReportHtml({ reportNumber: 3, technicianName: null, serviceData: { customerName: 'TEST Client', ...extra, wct }, org, edit });

  it('a blank template shows its empty boxes as targets: 2 Before + 2 After, the job-type ticks, the text fields', () => {
    const h = html({ jobTypes: ['CD_HOOD'], sections: {} }, true);
    expect(h.match(/data-k="HOOD" data-g="before" data-i="\d+"/g)).toHaveLength(2);
    expect(h.match(/data-k="HOOD" data-g="after"/g)).toHaveLength(2);
    expect(h).toContain('data-k="UNIT_LOCATION" data-g="photos" data-i="0"');
    expect(h).toMatch(/data-jt="CD_HOOD"/);
    expect(h).toMatch(/data-f="customerName"[^>]*>TEST Client</);
    expect(h).toContain('data-f="remarks"'); // shown to type into even when empty
    expect(h).toContain('data-label="UNIT_LOCATION"');
    expect(h).toMatch(/data-k="HOOD" data-l="0"/);
    expect(h).toContain('@media print'); // controls hidden in print
  });

  it('a full page gets the next page to add to; the printed paper has no targets', () => {
    const wct = { jobTypes: ['CD_HOOD'], sections: { HOOD: { before: [P('1'), P('2')], after: [P('3'), P('4')] } } };
    const edit = html(wct, true);
    expect(edit.match(/Kitchen Exhaust Hood<\/u>/g)).toHaveLength(2); // page 1 full + an empty page 2
    expect(edit).toContain('data-k="HOOD" data-g="before" data-i="2"');
    const plain = html({ ...wct, labels: { UNIT_LOCATION: 'Main kitchen' } }, false);
    expect(plain.match(/Kitchen Exhaust Hood<\/u>/g)).toHaveLength(1);
    expect(plain).not.toMatch(/data-(k|jt|f|l|label)=/);
    expect(plain).toContain('Unit Location - Main kitchen'); // the typed name prints
  });
});

describe('saving in place', () => {
  function make(row: any) {
    const writes: any[] = [];
    const prisma: any = {
      maintenanceServiceReport: {
        findFirst: jest.fn(async () => row),
        update: jest.fn(async (a: any) => (writes.push(a), Object.assign(row, a.data), { id: row.id })),
      },
    };
    const svc: any = Object.create(MaintenanceReportsService.prototype);
    Object.assign(svc, { prisma, loadForRender: jest.fn(async () => ({ ...row, reportNumber: 3, technicianName: null, asset: null, inventory: null, organization: org })) });
    return { svc: svc as MaintenanceReportsService, writes };
  }
  const draft = { jobTypes: ['CD_HOOD'], grids: { HOOD: { before: [P('new')], after: [], photos: [], lines: [0, 1, 2, 3] } }, customerName: 'TEST Client', serviceDate: '2026-11-16', remarks: 'ok', labels: {} };

  it('saves the whole draft and returns the redrawn edit view (drawn from the draft)', async () => {
    const row = { id: 'r1', kind: 'SERVICE', status: 'draft', serviceData: { templateId: 'WCT_V1', office: true } };
    const { svc, writes } = make(row);
    const out = await svc.saveInPlace('r1', draft, 'org');
    expect(writes[0].data.serviceData.draft).toMatchObject({ jobTypes: ['CD_HOOD'], customerName: 'TEST Client', grids: { HOOD: { before: [P('new')] } } });
    expect(out.html).toContain(P('new'));
    expect(out.html).toContain('data-k="HOOD"');
  });

  it('refuses a completed report (Edit first), a non-WCT report, a foreign photo key or a bad date', async () => {
    await expect(make({ id: 'r', kind: 'SERVICE', status: 'completed', serviceData: { templateId: 'WCT_V1' } }).svc.saveInPlace('r', draft, 'org')).rejects.toThrow(/Use Edit first/);
    await expect(make({ id: 'r', kind: 'SERVICE', status: 'draft', serviceData: { templateId: 'GENERIC_V1' } }).svc.saveInPlace('r', draft, 'org')).rejects.toThrow(/Only a WCT report/);
    const bad = { ...draft, grids: { HOOD: { before: ['https://evil/x.jpg'], after: [], photos: [], lines: [] } } };
    await expect(make({ id: 'r', kind: 'SERVICE', status: 'draft', serviceData: { templateId: 'WCT_V1' } }).svc.saveInPlace('r', bad, 'org')).rejects.toThrow(/not a report photo/);
    await expect(make({ id: 'r', kind: 'SERVICE', status: 'draft', serviceData: { templateId: 'WCT_V1' } }).svc.saveInPlace('r', { ...draft, serviceDate: '16/11/2026' }, 'org')).rejects.toThrow(/must be a date/);
  });

  it('edit state: the saved draft, else one built from the report; a completed report is not editable', async () => {
    const st = await make({ id: 'r', kind: 'SERVICE', status: 'completed', serviceData: { templateId: 'WCT_V1', customerName: 'TEST Client', wct: { jobTypes: ['CD_HOOD'], sections: { HOOD: { before: [P('b')], after: [] } } } } }).svc.editState('r', 'org');
    expect(st).toMatchObject({ status: 'completed', editable: false, draft: { customerName: 'TEST Client', jobTypes: ['CD_HOOD'], grids: { HOOD: { before: [P('b')] } } } });
  });

  it('reopening a completed WCT report rebuilds the draft from what was completed (not an older walk)', async () => {
    const row = { id: 'r1', status: 'completed', reportNumber: 7, signature: null, serviceData: { templateId: 'WCT_V1', office: true, customerName: 'TEST Client', draft: { jobTypes: ['OLD'] }, wct: { jobTypes: ['CD_HOOD'], sections: { HOOD: { before: [P('final')], after: [] } } } } };
    const prisma: any = { maintenanceServiceReport: { findFirst: jest.fn(async () => row), update: jest.fn(async (a: any) => a) }, organizationUIConfig: { findUnique: async () => ({ features: { enableWctOrders: true, enableManualOrderFlow: true } }) } };
    const svc: any = Object.create(MaintenanceReportsService.prototype);
    Object.assign(svc, { prisma });
    await svc.reopenForEditing('r1', 'org', { id: 'u1', name: 'Office' });
    const sd = prisma.maintenanceServiceReport.update.mock.calls[0][0].data.serviceData;
    expect(sd.draft).toMatchObject({ jobTypes: ['CD_HOOD'], customerName: 'TEST Client', grids: { HOOD: { before: [P('final')] } } });
  });
});
