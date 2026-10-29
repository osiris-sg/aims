import { open, seal, secretBoxReady, SecretBoxError } from './secret-box';

describe('secret-box', () => {
  const prev = process.env.AIMS_SECRETS_KEY;
  afterEach(() => {
    process.env.AIMS_SECRETS_KEY = prev;
  });

  it('round-trips with a hex key and hides the plaintext', () => {
    process.env.AIMS_SECRETS_KEY = 'a'.repeat(64);
    const sealed = seal('sck_live_abc123');
    expect(sealed).toMatch(/^v1:/);
    expect(sealed).not.toContain('sck_live_abc123');
    expect(open(sealed)).toBe('sck_live_abc123');
    expect(seal('x')).not.toBe(seal('x')); // fresh IV every time
  });

  it('accepts a base64 key', () => {
    process.env.AIMS_SECRETS_KEY = Buffer.alloc(32, 7).toString('base64');
    expect(open(seal('k'))).toBe('k');
  });

  it('refuses a wrong key or a tampered value', () => {
    process.env.AIMS_SECRETS_KEY = 'a'.repeat(64);
    const sealed = seal('secret');
    process.env.AIMS_SECRETS_KEY = 'b'.repeat(64);
    expect(() => open(sealed)).toThrow(SecretBoxError);
    process.env.AIMS_SECRETS_KEY = 'a'.repeat(64);
    const parts = sealed.split(':');
    parts[3] = Buffer.from('tampered').toString('base64url');
    expect(() => open(parts.join(':'))).toThrow(SecretBoxError);
  });

  it('is not ready without a 32-byte key', () => {
    delete process.env.AIMS_SECRETS_KEY;
    expect(secretBoxReady()).toBe(false);
    expect(() => seal('x')).toThrow(/AIMS_SECRETS_KEY is not set/);
    process.env.AIMS_SECRETS_KEY = 'short';
    expect(secretBoxReady()).toBe(false);
  });
});
