import { isOfficeDoEdit, officeDoEditChanges, pinOfficeDoEdit } from './office-do-edit';

describe('office DO edits (enableOfficeDoEdits)', () => {
  it('applies only to portal saves of a DO past unconfirmed, with the flag on', () => {
    expect(isOfficeDoEdit('DELIVERY_ORDER', 'delivered_installed', true, true)).toBe(true);
    expect(isOfficeDoEdit('DO', 'confirmed', true, true)).toBe(true);
    expect(isOfficeDoEdit('DELIVERY_ORDER', 'unconfirmed', true, true)).toBe(false);
    expect(isOfficeDoEdit('DELIVERY_ORDER', 'draft', true, true)).toBe(false);
    expect(isOfficeDoEdit('DELIVERY_ORDER', 'delivered_installed', false, true)).toBe(false); // flag off (WCT)
    expect(isOfficeDoEdit('DELIVERY_ORDER', 'delivered_installed', true, false)).toBe(false); // assistant
    expect(isOfficeDoEdit('RETURN_DELIVERY_ORDER', 'returned', true, true)).toBe(false);
    expect(isOfficeDoEdit('INVOICE', 'confirmed', true, true)).toBe(false);
  });

  it('keeps status, DO number, signature/stamp keys and carries keys the editor dropped', () => {
    const existing = {
      name: 'DO202611112',
      status: 'delivered_installed',
      config: { stamp: 'S', customerSignature: 'SIG', attention: { name: 'Ali' }, deliveryTo: 'Old site', items: [{ description: 'A', quantity: 1 }] },
    };
    const dto: any = {
      status: 'confirmed',
      name: 'DO999',
      config: { deliveryTo: 'New site', documentNumber: 'DO999', documentInfo: { documentNumber: 'DO999', projectName: 'P' }, customerSignature: 'FAKE', signedBy: 'x', items: [{ description: 'A', quantity: 2 }] },
    };
    pinOfficeDoEdit(existing, dto);
    expect(dto.status).toBe('delivered_installed');
    expect(dto.name).toBe('DO202611112');
    expect(dto.config.documentNumber).toBe('DO202611112');
    expect(dto.config.documentInfo.documentNumber).toBe('DO202611112');
    expect(dto.config.customerSignature).toBe('SIG');
    expect(dto.config.stamp).toBe('S');
    expect('signedBy' in dto.config).toBe(false);
    expect(dto.config.attention).toEqual({ name: 'Ali' });
    expect(dto.config.deliveryTo).toBe('New site');
    expect(dto.config.items[0].quantity).toBe(2);
  });

  it('lists old -> new per changed field, items as one line', () => {
    const changes = officeDoEditChanges(
      { deliveryTo: 'Old', contactName: 'Ali', documentInfo: { projectName: 'X' }, items: [{ description: 'A', quantity: 1 }], stamp: 'S' },
      { deliveryTo: 'New', contactName: 'Ali', documentInfo: { projectName: 'Y' }, items: [{ description: 'A', quantity: 2 }], stamp: 'T' },
    );
    expect(changes).toEqual([
      { field: 'deliveryTo', from: 'Old', to: 'New' },
      { field: 'documentInfo.projectName', from: 'X', to: 'Y' },
      { field: 'items', from: 'A x 1', to: 'A x 2' },
    ]);
    expect(officeDoEditChanges({ a: 1 }, { a: 1 })).toEqual([]);
  });
});
