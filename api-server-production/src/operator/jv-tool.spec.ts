/**
 * create_journal_voucher (guru 2026-11-26: "when I asked them to create a JV it didn't open the JV editor page at
 * the start, and it wrote to the Description field, not Remarks"): the voucher is made through the Journal Voucher
 * service, the narrative lands in the voucher's Remarks (notes) and a line's note in its Remarks, every line's
 * Description is left to the account name, and the editor opens in the side panel.
 */
import { OperatorToolsService } from './operator-tools.service';
import { OperatorContext } from './operator.types';

const ctx = (): OperatorContext =>
  ({
    organizationId: 'org', organizationName: 'Org', clerkUserId: 'u1', actor: { id: 'u1', name: 'Shu Kee' },
    roles: [{ name: 'Accounts', permissions: [{ resource: 'journal', action: 'create' }] }], isOsirisAdmin: false,
    channel: 'web', channelUserId: 'u1', web: { screens: [], aimee: { page: null, scope: null, guides: [] } },
  }) as any;

function svc(save: jest.Mock = jest.fn(async (_o: string, id: string, dto: any) => ({ id, voucherNumber: 'JV-000071', status: 'confirmed', incompleteReason: null, ...dto }))) {
  const s = Object.create(OperatorToolsService.prototype) as OperatorToolsService;
  (s as any).auth = { hasPermission: () => true };
  (s as any).logger = { error() {}, warn() {}, log() {} };
  (s as any).log = jest.fn();
  (s as any).prisma = {
    chartOfAccount: { findMany: jest.fn(async () => [{ code: '610', name: 'Accounts Receivable' }, { code: '820', name: 'GST' }, { code: '325a', name: 'COGS - Repair & Maintenance, SD Cards for MGS' }, { code: '325b', name: 'COGS - Repair & Maintenance, Vehicles' }]) },
  };
  (s as any).journalVouchers = { create: jest.fn(async () => ({ id: 'jv1', voucherNumber: 'JV-PENDING', date: '2026-11-26' })), save };
  return { s, save };
}

describe('create_journal_voucher', () => {
  it('narrative to Remarks, line notes to line Remarks, Description untouched, editor opened', async () => {
    const { s, save } = svc();
    const out = await s.execute(ctx(), 'create_journal_voucher', {
      narrative: 'Reclass Oct GST per accountant', date: '2026-10-31',
      lines: [{ accountCode: '610', debit: 109, remarks: 'Neo Hardware' }, { account: 'gst', credit: 109 }],
    });
    expect(save).toHaveBeenCalledTimes(1);
    const dto = save.mock.calls[0][2];
    expect(dto.date).toBe('2026-10-31');
    expect(dto.notes).toBe('Reclass Oct GST per accountant');
    expect(dto.lines).toEqual([
      { accountCode: '610', description: null, remarks: 'Neo Hardware', debit: 109, credit: 0 },
      { accountCode: '820', description: null, remarks: null, debit: 0, credit: 109 },
    ]);
    expect(out.result.posted).toBe(true);
    expect(out.result.voucherNumber).toBe('JV-000071');
    expect(out.ui).toEqual({ type: 'screen', path: '/portal/accounting/journal-vouchers/jv1', title: 'J/V JV-000071' });
  });

  it('a name matching several accounts asks instead of guessing; an unbalanced voucher opens Not posted', async () => {
    const { s, save } = svc();
    const amb = await s.execute(ctx(), 'create_journal_voucher', { lines: [{ account: 'repair', debit: 10 }] });
    expect(amb.result.error).toMatch(/several accounts/);
    expect(amb.result.matches).toEqual(['325a COGS - Repair & Maintenance, SD Cards for MGS', '325b COGS - Repair & Maintenance, Vehicles']);
    expect(save).not.toHaveBeenCalled();

    const held = svc(jest.fn(async (_o: string, id: string, _dto: any) => ({ id, voucherNumber: 'JV-PENDING', status: 'unconfirmed', incompleteReason: 'Debits 100.00 do not equal credits 90.00' })));
    const out = await held.s.execute(ctx(), 'create_journal_voucher', { lines: [{ accountCode: '610', debit: 100 }, { accountCode: '820', credit: 90 }] });
    expect(out.result.posted).toBe(false);
    expect(out.result.note).toMatch(/NOT posted/);
    expect(out.ui?.type).toBe('screen');
  });

  it('is offered on the web and tells the model never to use api_write for a J/V', () => {
    const def = svc().s.definitions(ctx()).find((t) => t.name === 'create_journal_voucher');
    expect(def?.description).toMatch(/never api_write on \/journal/);
  });
});
