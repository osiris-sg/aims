import { logoUrlOf } from './public-sign.service';

describe('logoUrlOf (customer sign page logo)', () => {
  const prev = process.env.S3_PUBLIC_URL;
  afterEach(() => {
    process.env.S3_PUBLIC_URL = prev;
  });

  it('keeps a full URL as is (CIEL stores one)', () => {
    expect(logoUrlOf('https://cdn.example.com/ciel.png')).toBe('https://cdn.example.com/ciel.png');
    expect(logoUrlOf('data:image/png;base64,AAA')).toBe('data:image/png;base64,AAA');
  });

  it('turns a stored S3 key into a public URL', () => {
    process.env.S3_PUBLIC_URL = 'https://bucket.s3.amazonaws.com';
    expect(logoUrlOf('logos/wct-logo.png')).toBe('https://bucket.s3.amazonaws.com/logos/wct-logo.png');
    expect(logoUrlOf('/logos/x.png')).toBe('https://bucket.s3.amazonaws.com/logos/x.png');
  });

  it('returns null when there is no logo', () => {
    expect(logoUrlOf(null)).toBeNull();
    expect(logoUrlOf('  ')).toBeNull();
  });
});
