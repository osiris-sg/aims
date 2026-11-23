import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { SubmitCustomerInfoDto } from './customer-info.dto';

const errorsFor = async (body: any) => {
  const dto = plainToInstance(SubmitCustomerInfoDto, body);
  const errs = await validate(dto);
  return { dto, errs };
};

describe('customer info submit: blank email / phone are missing, not invalid (all orgs)', () => {
  it('accepts a blank or spaces-only email and phone', async () => {
    const { dto, errs } = await errorsFor({ doContacts: [{ name: 'Ali', email: '', phone: '  ' }], invoiceContacts: [{ name: 'Bo', email: '   ' }] });
    expect(errs).toEqual([]);
    expect(dto.doContacts![0].email).toBeUndefined();
    expect(dto.doContacts![0].phone).toBeUndefined();
    expect(dto.invoiceContacts![0].email).toBeUndefined();
  });
  it('still rejects a badly formed email', async () => {
    const { errs } = await errorsFor({ doContacts: [{ name: 'Ali', email: 'not-an-email' }] });
    expect(errs.length).toBe(1);
  });
  it('keeps a real email and phone', async () => {
    const { dto, errs } = await errorsFor({ doContacts: [{ name: 'Ali', email: 'a@b.co', phone: '91234567' }] });
    expect(errs).toEqual([]);
    expect(dto.doContacts![0]).toMatchObject({ email: 'a@b.co', phone: '91234567' });
  });
});
