import { withSingapore } from './sg-address';

describe('withSingapore', () => {
  it('adds Singapore before a trailing postal code', () => {
    expect(withSingapore('10 Jurong West St 41 639273')).toBe('10 Jurong West St 41 Singapore 639273');
    expect(withSingapore('E!Avenue #02-346, 639273')).toBe('E!Avenue #02-346 Singapore 639273');
    expect(withSingapore('Blk 1 Toa Payoh S 310001')).toBe('Blk 1 Toa Payoh Singapore 310001');
    expect(withSingapore('Blk 1 Toa Payoh S(310001)')).toBe('Blk 1 Toa Payoh Singapore 310001');
    expect(withSingapore('Blk 1 Toa Payoh (310001)')).toBe('Blk 1 Toa Payoh Singapore 310001');
  });
  it('keeps a new line before the postal code', () => {
    expect(withSingapore('1 Raffles Place\n048616')).toBe('1 Raffles Place\nSingapore 048616');
  });
  it('leaves addresses with a country or no postal code alone', () => {
    expect(withSingapore('1 Raffles Place Singapore 048616')).toBe('1 Raffles Place Singapore 048616');
    expect(withSingapore('1 Raffles Place, SINGAPORE 048616')).toBe('1 Raffles Place, SINGAPORE 048616');
    expect(withSingapore("1 Raffles Place S'pore 048616")).toBe("1 Raffles Place S'pore 048616");
    expect(withSingapore('Jalan 5, Johor Bahru 81100')).toBe('Jalan 5, Johor Bahru 81100');
    expect(withSingapore('1 Raffles Place')).toBe('1 Raffles Place');
    expect(withSingapore('Unit 1234567')).toBe('Unit 1234567');
    expect(withSingapore('639273')).toBe('639273');
    expect(withSingapore('')).toBe('');
    expect(withSingapore(null)).toBe('');
  });
});
