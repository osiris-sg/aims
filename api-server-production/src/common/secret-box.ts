import { createCipheriv, createDecipheriv, randomBytes } from 'crypto';

/**
 * Small AES-256-GCM box for integration secrets kept in the DB (first user:
 * SiteClockConnection.apiKey). The key is AIMS_SECRETS_KEY — 32 bytes as 64 hex
 * chars or base64 — set on Render, never in the DB. A sealed value is
 * "v1:<iv>:<tag>:<ciphertext>" (base64url parts); a wrong key or a tampered
 * value fails to open instead of returning garbage.
 */
const PREFIX = 'v1';

export class SecretBoxError extends Error {}

function key(): Buffer {
  const raw = (process.env.AIMS_SECRETS_KEY || '').trim();
  if (!raw) throw new SecretBoxError('AIMS_SECRETS_KEY is not set');
  const buf = /^[0-9a-fA-F]{64}$/.test(raw) ? Buffer.from(raw, 'hex') : Buffer.from(raw, 'base64');
  if (buf.length !== 32) throw new SecretBoxError('AIMS_SECRETS_KEY must be 32 bytes (64 hex chars or base64)');
  return buf;
}

export function secretBoxReady(): boolean {
  try {
    key();
    return true;
  } catch {
    return false;
  }
}

export function seal(plain: string): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', key(), iv);
  const ct = Buffer.concat([cipher.update(plain, 'utf8'), cipher.final()]);
  return [PREFIX, iv.toString('base64url'), cipher.getAuthTag().toString('base64url'), ct.toString('base64url')].join(':');
}

export function open(sealed: string): string {
  const [v, iv, tag, ct] = String(sealed).split(':');
  if (v !== PREFIX || !iv || !tag || ct === undefined) throw new SecretBoxError('Not a sealed secret');
  try {
    const decipher = createDecipheriv('aes-256-gcm', key(), Buffer.from(iv, 'base64url'));
    decipher.setAuthTag(Buffer.from(tag, 'base64url'));
    return Buffer.concat([decipher.update(Buffer.from(ct, 'base64url')), decipher.final()]).toString('utf8');
  } catch {
    throw new SecretBoxError('Secret could not be opened (wrong AIMS_SECRETS_KEY or tampered value)');
  }
}
