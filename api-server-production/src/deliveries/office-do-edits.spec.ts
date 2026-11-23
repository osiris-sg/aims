import { doContactRefresh } from './office-do-edits';

describe('doContactRefresh (enableOfficeDoEdits)', () => {
  it('name + phone', () => {
    expect(doContactRefresh({ name: 'Tan Ah Kow', phoneNumber: '91234567' })).toEqual({ contactName: 'Tan Ah Kow', contactNumber: '91234567' });
  });
  it('a contact with no phone clears the old number', () => {
    expect(doContactRefresh({ name: 'Tan Ah Kow' })).toEqual({ contactName: 'Tan Ah Kow', contactNumber: null });
  });
  it('no contact clears both', () => {
    expect(doContactRefresh(undefined)).toEqual({ contactName: null, contactNumber: null });
    expect(doContactRefresh({ name: '  ', phoneNumber: '9' })).toEqual({ contactName: null, contactNumber: null });
  });
});
