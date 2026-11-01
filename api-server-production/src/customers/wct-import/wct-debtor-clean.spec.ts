import {
  DebtorRow,
  cleanAddress,
  cleanContactName,
  cleanEmailField,
  cleanPhoneField,
  cleanText,
  cleanUen,
  statusMarker,
  debtorRowsFromCsv,
  fixMojibake,
  parseCsv,
  planImport,
} from './wct-debtor-clean';

const row = (o: Partial<DebtorRow>): DebtorRow => ({
  DebtorCode: '1',
  IDType: 'EUN',
  UEN: '',
  Name: 'Acme Pte Ltd',
  AcctOpenDate: '01/02/2020',
  Type: 'C',
  Salute: '',
  ContactPerson: '',
  Address: '',
  Country: '',
  ContactNo1: '',
  ContactNo2: '',
  ContactNo3: '',
  ContactNo4: '',
  Email: '',
  ...o,
});

describe('WCT debtor import — cleaning', () => {
  it('parses quoted CSV with commas, quotes and newlines', () => {
    expect(parseCsv('a,b\n"x, y","1\n2 ""q"""\n')).toEqual([
      ['a', 'b'],
      ['x, y', '1\n2 "q"'],
    ]);
    expect(() => debtorRowsFromCsv('DebtorCode,Name\n1,A')).toThrow(/missing columns/);
  });

  it('reverses Windows-1252 mojibake and leaves clean text alone', () => {
    expect(fixMojibake('Caf\u00c3\u00a9')).toBe('Caf\u00e9');
    expect(fixMojibake('Ann\u00e2\u20ac\u2122s')).toBe('Ann\u2019s');
    expect(fixMojibake('\u00e5\u00a4\u00a9\u00e5\u00ba\u0153')).toBe('\u5929\u5e9c');
    expect(fixMojibake('Ann\u2019s Caf\u00e9')).toBe('Ann\u2019s Caf\u00e9');
    // truncated mid-character in the export: keep what decodes, drop the stub
    expect(fixMojibake(String.fromCharCode(0xe8, 0xbe, 0xa3, 0xe4, 0xb8))).toBe(String.fromCharCode(0x8fa3));
    expect(fixMojibake(String.fromCharCode(0xc3, 0xa9, 0xe4, 0xb8, 0x42))).toBe(String.fromCharCode(0xc3, 0xa9, 0xe4, 0xb8, 0x42));
    expect(cleanText('  KH  Trading\u00c2\u00a0Pte Ltd ')).toBe('KH Trading Pte Ltd');
  });

  it('keeps only real-looking UENs and never an NRIC', () => {
    expect(cleanUen('201302496E')).toEqual({ uen: '201302496E', status: 'ok' });
    expect(cleanUen('53123456k')).toEqual({ uen: '53123456K', status: 'ok' });
    expect(cleanUen('T08LL1234A')).toEqual({ uen: 'T08LL1234A', status: 'ok' });
    expect(cleanUen('UEN: 201302496E').uen).toBe('201302496E');
    expect(cleanUen('53123456-J').uen).toBe('53123456J');
    for (const j of ['1', '123', 'NA', '-', '`', 'TBA', '201302496-']) expect(cleanUen(j)).toEqual({ uen: null, status: 'junk' });
    expect(cleanUen('')).toEqual({ uen: null, status: 'blank' });
    expect(cleanUen('S1234567D')).toEqual({ uen: null, status: 'nric-shaped' });
  });

  it('formats addresses as "<street>, Singapore <postal>"', () => {
    expect(cleanAddress('134 Tagore Lane    787557').address).toBe('134 Tagore Lane, Singapore 787557');
    expect(cleanAddress('1a Short Street \nS188210')).toEqual({ address: '1a Short Street, Singapore 188210', formatted: true });
    expect(cleanAddress('93 Cashew height #02-02\n(S)679664').address).toBe('93 Cashew height #02-02, Singapore 679664');
    expect(cleanAddress('No 5 Soon Lee Street\n#04-32 Pioneer Point\nSingapore 627607')).toEqual({
      address: 'No 5 Soon Lee Street, #04-32 Pioneer Point, Singapore 627607',
      formatted: false,
    });
    expect(cleanAddress('101 Thomson Rd, Singapore 307591 307591').address).toBe('101 Thomson Rd, Singapore 307591');
    expect(cleanAddress('10 Tagore Drive, Wah Loon Building, 787625 787625').address).toBe('10 Tagore Drive, Wah Loon Building, Singapore 787625');
    expect(cleanAddress('Block 5 Jalan Ampang').address).toBe('Block 5 Jalan Ampang');
    expect(cleanAddress('Lot 1, 50450 Kuala Lumpur', 'MY').formatted).toBe(false);
    expect(cleanAddress('  ').address).toBeNull();
  });

  it('keeps Singapore 8-digit phones and reports the rest', () => {
    expect(cleanPhoneField('9123 4567')).toEqual({ valid: ['91234567'], unparsed: [] });
    expect(cleanPhoneField('+65 6123-4567')).toEqual({ valid: ['61234567'], unparsed: [] });
    expect(cleanPhoneField('6591234567').valid).toEqual(['91234567']);
    expect(cleanPhoneField('91234567 / 81234567').valid).toEqual(['91234567', '81234567']);
    expect(cleanPhoneField('91234567   81234567').valid).toEqual(['91234567', '81234567']);
    expect(cleanPhoneField('\u00c2\u00a091234567\u00c2\u00a0').valid).toEqual(['91234567']);
    expect(cleanPhoneField('1800 123 4567')).toEqual({ valid: [], unparsed: ['1800 123 4567'] });
    expect(cleanPhoneField('Carson').unparsed).toEqual(['Carson']);
    expect(cleanPhoneField('61234567 ext 123').unparsed).toHaveLength(1);
    expect(cleanPhoneField('51234567').valid).toEqual([]);
    expect(cleanPhoneField('91234567' + String.fromCharCode(0x202c)).valid).toEqual(['91234567']);
  });

  it('cleans emails: case, NBSP, comma typos; rejects junk', () => {
    expect(cleanEmailField('  John.Tan@GMAIL.com ').valid).toEqual(['john.tan@gmail.com']);
    expect(cleanEmailField('\u00c2\u00a0\u00c2\u00a0a@b.com').valid).toEqual(['a@b.com']);
    expect(cleanEmailField('a@b.com\u00e2\u20ac\u017d').valid).toEqual(['a@b.com']);
    expect(cleanEmailField('marcus@gmail,com').valid).toEqual(['marcus@gmail.com']);
    expect(cleanEmailField('a@b.com; c@d.com.sg').valid).toEqual(['a@b.com', 'c@d.com.sg']);
    for (const j of ['MARCUS', 'Fax:61234567', '-', 'abc.gmail.com']) expect(cleanEmailField(j).valid).toEqual([]);
    expect(cleanEmailField('MARCUS').invalid).toEqual(['marcus']);
    expect(cleanEmailField('Email:a@b.com').valid).toEqual(['a@b.com']);
    expect(cleanEmailField('fax:61234567').valid).toEqual([]);
  });

  it('cleans contact names: dash, salutation flip, Salute column, company name', () => {
    expect(cleanContactName('Alvin Mr', '', 'Acme Pte Ltd')).toBe('Mr Alvin');
    expect(cleanContactName('Doreen Ms', '', 'Acme Pte Ltd')).toBe('Ms Doreen');
    expect(cleanContactName('tan ah kow MR', '', 'X')).toBe('Mr tan ah kow');
    expect(cleanContactName('- Lee Daniel', 'Mr.', 'Acme Pte Ltd')).toBe('Mr Lee Daniel');
    expect(cleanContactName('Mdm Lim', '', 'X')).toBe('Mdm Lim');
    expect(cleanContactName('- ACME PTE LTD', '', 'Acme Pte. Ltd.')).toBeNull();
    expect(cleanContactName('- Acme Engineering (Pte', '', 'Acme Engineering (Pte) Ltd')).toBeNull(); // truncated copy
    expect(cleanContactName('John Tan', '', 'John Tan Trading')).toBe('John Tan'); // not dashed: a person
    expect(cleanContactName('', 'Mr.', 'X')).toBeNull();
    expect(cleanContactName('-', '', 'X')).toBeNull();
    expect(cleanContactName('Mr', '', 'X')).toBeNull();
    expect(cleanContactName('- Mrs Banana SGP Pte Ltd', '', 'Mrs Banana SGP Pte Ltd')).toBeNull();
    expect(cleanContactName('- Elektrim Asia Pacific Pte Ltd', '', 'Electrimec Asia Pacific Pte Ltd')).toBeNull();
  });
});

describe('WCT debtor import: status-marked names', () => {
  it('flags tagged dead accounts, keeps real names with the same words', () => {
    expect(statusMarker('(CANCEL) Dsign Signature Builder Pte Ltd')).toBe('(CANCEL)');
    expect(statusMarker('Foo Pte Ltd - CLOSED')).toBe('- CLOSED');
    expect(statusMarker('Foo Pte Ltd [Do Not Use]')).toBe('[Do Not Use]');
    expect(statusMarker('Foo (old)')).toBe('(old)');
    expect(statusMarker('TERMINATED Foo')).toBe('TERMINATED');
    expect(statusMarker('Old Chang Kee Singapore Pte Ltd')).toBeNull();
    expect(statusMarker('Old Beijing Hotpot Pte Ltd')).toBeNull();
    expect(statusMarker('Goldhill Cancellation Services')).toBeNull();
  });
});

describe('WCT debtor import — plan', () => {
  const existing = [{ id: 'e1', customerCode: 'CY001', name: 'Yoshinoya (Suntec City)', email: null, phone: null, address: null }];

  it('skips WCT itself, blank names and existing customers', () => {
    const p = planImport(
      [
        row({ DebtorCode: '74', Name: 'WCT (S) SYSTEMS PTE LTD' }),
        row({ DebtorCode: '2', Name: '  ' }),
        row({ DebtorCode: '3', Name: 'YOSHINOYA  (SUNTEC CITY)' }),
        row({ DebtorCode: '4' }),
        row({ DebtorCode: '5', Name: '(CANCEL) Gone Pte Ltd' }),
        row({ DebtorCode: '6', Name: 'Old Chang Kee Pte Ltd' }),
      ],
      existing,
    );
    expect(p.skippedSelf).toHaveLength(1);
    expect(p.skippedBlankName).toEqual(['2']);
    expect(p.skippedExisting.map((m) => [m.row.debtorCode, m.existing.id, m.by])).toEqual([['3', 'e1', 'name']]);
    expect(p.customers.map((c) => c.debtorCodes)).toEqual([['4'], ['6']]);
    expect(p.skippedStatusName.map((x) => [x.row.debtorCode, x.marker])).toEqual([['5', '(CANCEL)']]);
    expect(p.statusWordKept.map((r) => r.debtorCode)).toEqual(['6']);
  });

  it('merges exact duplicates and unions their phones/emails into contacts', () => {
    const p = planImport(
      [
        row({ DebtorCode: '10', Address: '1 Main St 123456', ContactPerson: 'Alvin Mr', ContactNo1: '91234567', ContactNo2: '61234567', Email: 'a@acme.sg' }),
        row({ DebtorCode: '11', Name: 'ACME PTE. LTD.', Address: '1 Main St, Singapore 123456', ContactPerson: 'Bee Ms', ContactNo1: '91234567', ContactNo2: '81234567', Email: 'b@acme.sg' }),
      ],
      [],
    );
    expect(p.customers).toHaveLength(1);
    expect(p.merges).toHaveLength(1);
    const c = p.customers[0];
    expect(c.debtorCodes).toEqual(['10', '11']);
    expect(c.phone).toBe('91234567');
    expect(c.email).toBe('a@acme.sg');
    expect(c.contacts).toEqual([
      { name: 'Mr Alvin', phone: '91234567', email: 'a@acme.sg', isPrimary: true },
      { name: 'Mr Alvin (alt)', phone: '61234567', email: null, isPrimary: false },
      { name: 'Ms Bee', phone: '81234567', email: 'b@acme.sg', isPrimary: false },
    ]);
    expect(c.site).toEqual({
      name: '1 Main St, Singapore 123456',
      address: '1 Main St, Singapore 123456',
      contactDetail: { name: 'Mr Alvin', email: 'a@acme.sg', phone: '91234567' },
    });
  });

  it('keeps same-email outlets separate and nulls Customer.email for them', () => {
    const p = planImport(
      [
        row({ DebtorCode: '20', Name: 'Kopi (Bedok)', Email: 'ops@kopi.sg' }),
        row({ DebtorCode: '21', Name: 'Kopi (Tampines)', Email: 'OPS@kopi.sg' }),
        row({ DebtorCode: '22', Name: 'Solo Pte Ltd', Email: 'solo@x.sg' }),
      ],
      [{ ...existing[0], email: 'solo@x.sg' }],
    );
    expect(p.customers).toHaveLength(3);
    expect(p.customers.map((c) => [c.email, c.emailNulledReason])).toEqual([
      [null, 'dup-in-import'],
      [null, 'dup-in-import'],
      [null, 'used-by-existing'],
    ]);
    expect(p.customers[0].contacts[0]).toEqual({ name: 'Accounts', phone: null, email: 'ops@kopi.sg', isPrimary: true });
  });

  it('uses the person as the contact for individuals, no contact without details, re-runs skip mapped codes', () => {
    const p = planImport(
      [
        row({ DebtorCode: '30', Name: 'Tan Ah Kow', Type: 'I', IDType: 'NRIC', UEN: 'S1234567D', ContactNo1: '91234567' }),
        row({ DebtorCode: '31', Name: 'Quiet Pte Ltd' }),
        row({ DebtorCode: '32', Name: 'Done Pte Ltd' }),
      ],
      [],
      new Set(['32']),
    );
    expect(p.customers[0].contacts).toEqual([{ name: 'Tan Ah Kow', phone: '91234567', email: null, isPrimary: true }]);
    expect(p.customers[0].rows[0].uen).toBeNull();
    expect(p.customers[1].contacts).toEqual([]);
    expect(p.customers[1].site).toBeNull();
    expect(p.skippedAlreadyImported.map((r) => r.debtorCode)).toEqual(['32']);
  });
});
