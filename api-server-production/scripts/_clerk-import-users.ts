/**
 * Clerk PRODUCTION import: copy users from the dev-instance export into the
 * production instance, each with external_id = their dev (= AIMS DB) user id.
 * See docs/clerk-cutover.md. NOT run as part of the prep; DRY RUN by default.
 *
 *   npx ts-node scripts/_clerk-import-users.ts --file <export.csv|users.json> [--only ids.txt] [--apply]
 *     [--copy-public-metadata] [--allow-test-key] [--out mapping.csv]
 *
 * Input (--file), either:
 *   - the Clerk dashboard user export (CSV). Columns read: id, first_name,
 *     last_name, username, primary_email_address, primary_phone_number,
 *     verified_email_addresses, verified_phone_numbers, password_digest,
 *     password_hasher. Multi-value cells may be separated by "|", ";" or ",".
 *   - or a JSON array of Backend API users (GET /v1/users of the dev instance).
 *     That carries no password digests: those users get no password and sign
 *     in with "Forgot password" / an email or SMS code.
 * --only: newline list of dev user ids to import (e.g. the AIMS members);
 *   default is every row in the file.
 *
 * Target: CLERK_TARGET_SECRET_KEY (the PRODUCTION instance's sk_live_ key).
 * Deliberately NOT CLERK_SECRET_KEY, so this can never write into the dev
 * instance by accident; a sk_test_ key is refused unless --allow-test-key.
 *
 * Per user (--apply only): users.createUser({ externalId: devId, names,
 * username, verified emails, verified phones (Backend-API-created identifiers
 * are verified), password digest + hasher when present, else
 * skipPasswordRequirement }). Users whose dev id is already an external_id on
 * the target are SKIPPED, so a re-run (the delta just before cutover) is safe.
 * Writes a dev_id,prod_id,status mapping (stdout, or --out).
 */
import * as fs from 'fs';
import { createClerkClient } from '@clerk/backend';

type Row = {
  devId: string;
  firstName?: string;
  lastName?: string;
  username?: string;
  emails: string[];
  phones: string[];
  passwordDigest?: string;
  passwordHasher?: string;
  publicMetadata?: Record<string, unknown>;
};

const argv = process.argv.slice(2);
const flag = (k: string) => argv.includes(k);
const opt = (k: string) => {
  const i = argv.indexOf(k);
  return i >= 0 ? argv[i + 1] : undefined;
};
const APPLY = flag('--apply');
const FILE = opt('--file');
const ONLY = opt('--only');
const OUT = opt('--out');
const COPY_META = flag('--copy-public-metadata');
const HASHERS = new Set(['argon2i', 'argon2id', 'awscognito', 'bcrypt', 'bcrypt_sha256_django', 'md5', 'pbkdf2_sha256', 'pbkdf2_sha256_django', 'pbkdf2_sha1', 'phpass', 'scrypt_firebase', 'scrypt_werkzeug', 'sha256', 'md5_phpass', 'ldap_ssha']);

function die(msg: string): never {
  console.error(`ABORT: ${msg}`);
  process.exit(1);
}

/** Minimal RFC-4180 CSV parser (quoted cells, "" escapes, CRLF). */
function parseCsv(text: string): Record<string, string>[] {
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = '';
  let q = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (q) {
      if (c === '"' && text[i + 1] === '"') { cell += '"'; i++; }
      else if (c === '"') q = false;
      else cell += c;
    } else if (c === '"') q = true;
    else if (c === ',') { row.push(cell); cell = ''; }
    else if (c === '\n' || c === '\r') {
      if (c === '\r' && text[i + 1] === '\n') i++;
      row.push(cell); cell = '';
      if (row.some((v) => v !== '')) rows.push(row);
      row = [];
    } else cell += c;
  }
  row.push(cell);
  if (row.some((v) => v !== '')) rows.push(row);
  const [head, ...body] = rows;
  if (!head) return [];
  const keys = head.map((h) => h.trim().toLowerCase());
  return body.map((r) => Object.fromEntries(keys.map((k, i) => [k, (r[i] ?? '').trim()])));
}

const multi = (v?: string) =>
  (v ?? '')
    .split(/[|;,]/)
    .map((s) => s.trim())
    .filter(Boolean);
const uniq = (a: string[]) => [...new Set(a)];

function fromCsv(text: string): Row[] {
  return parseCsv(text).map((r) => ({
    devId: r.id,
    firstName: r.first_name || undefined,
    lastName: r.last_name || undefined,
    username: r.username || undefined,
    // Primary first: Clerk makes the first identifier of each kind the primary.
    emails: uniq([...multi(r.primary_email_address), ...multi(r.verified_email_addresses)]),
    phones: uniq([...multi(r.primary_phone_number), ...multi(r.verified_phone_numbers)]),
    passwordDigest: r.password_digest || undefined,
    passwordHasher: r.password_hasher || undefined,
  }));
}

function fromJson(text: string): Row[] {
  const arr: any[] = JSON.parse(text);
  if (!Array.isArray(arr)) die('JSON input must be an array of users');
  return arr.map((u) => {
    const emails = (u.email_addresses ?? u.emailAddresses ?? []) as any[];
    const phones = (u.phone_numbers ?? u.phoneNumbers ?? []) as any[];
    const primaryEmail = u.primary_email_address_id ?? u.primaryEmailAddressId;
    const primaryPhone = u.primary_phone_number_id ?? u.primaryPhoneNumberId;
    const verified = (x: any) => (x.verification?.status ?? 'verified') === 'verified';
    const ordered = (list: any[], primaryId: string, key: string) =>
      uniq([...list.filter((x) => x.id === primaryId), ...list.filter((x) => x.id !== primaryId)].filter(verified).map((x) => x[key] ?? x[key.replace(/_(\w)/g, (_: string, c: string) => c.toUpperCase())]).filter(Boolean));
    return {
      devId: u.id,
      firstName: u.first_name ?? u.firstName ?? undefined,
      lastName: u.last_name ?? u.lastName ?? undefined,
      username: u.username ?? undefined,
      emails: ordered(emails, primaryEmail, 'email_address'),
      phones: ordered(phones, primaryPhone, 'phone_number'),
      publicMetadata: u.public_metadata ?? u.publicMetadata ?? undefined,
    };
  });
}

async function main() {
  if (!FILE) die('--file <export.csv|users.json> is required');
  const key = process.env.CLERK_TARGET_SECRET_KEY;
  if (!key) die('CLERK_TARGET_SECRET_KEY (the PRODUCTION instance secret) is not set');
  if (!key.startsWith('sk_live_') && !flag('--allow-test-key')) die('CLERK_TARGET_SECRET_KEY is not a sk_live_ key (pass --allow-test-key for a rehearsal instance)');
  if (process.env.CLERK_SECRET_KEY && key === process.env.CLERK_SECRET_KEY) die('target key equals CLERK_SECRET_KEY: refusing to import into the instance the app runs on');

  const text = fs.readFileSync(FILE, 'utf8');
  let rows = /\.json$/i.test(FILE) || text.trimStart().startsWith('[') ? fromJson(text) : fromCsv(text);
  rows = rows.filter((r) => r.devId);
  if (ONLY) {
    const keep = new Set(fs.readFileSync(ONLY, 'utf8').split(/\s+/).filter(Boolean));
    rows = rows.filter((r) => keep.has(r.devId));
  }
  console.log(`${APPLY ? '*** APPLY ***' : 'DRY RUN'} | ${rows.length} user(s) from ${FILE} | target ${key.slice(0, 8)}…`);

  const clerk = createClerkClient({ secretKey: key });
  // Already imported = dev id present as external_id on the target.
  const existing = new Map<string, string>();
  for (let i = 0; i < rows.length; i += 100) {
    const chunk = rows.slice(i, i + 100).map((r) => r.devId);
    const res: any = await clerk.users.getUserList({ externalId: chunk, limit: 100 });
    for (const u of (Array.isArray(res) ? res : res.data) ?? []) if (u.externalId) existing.set(u.externalId, u.id);
  }

  const out: string[] = ['dev_id,prod_id,status,detail'];
  const tally: Record<string, number> = {};
  const note = (devId: string, prodId: string, status: string, detail = '') => {
    tally[status] = (tally[status] ?? 0) + 1;
    out.push([devId, prodId, status, JSON.stringify(detail)].join(','));
  };

  for (const r of rows) {
    if (existing.has(r.devId)) { note(r.devId, existing.get(r.devId)!, 'skip_already_imported'); continue; }
    if (!r.emails.length && !r.phones.length && !r.username) { note(r.devId, '', 'skip_no_identifier'); continue; }
    const hasDigest = !!(r.passwordDigest && r.passwordHasher && HASHERS.has(r.passwordHasher));
    const params: any = {
      externalId: r.devId,
      ...(r.firstName ? { firstName: r.firstName } : {}),
      ...(r.lastName ? { lastName: r.lastName } : {}),
      ...(r.username ? { username: r.username } : {}),
      ...(r.emails.length ? { emailAddress: r.emails } : {}),
      ...(r.phones.length ? { phoneNumber: r.phones } : {}),
      ...(hasDigest ? { passwordDigest: r.passwordDigest, passwordHasher: r.passwordHasher } : { skipPasswordRequirement: true }),
      skipPasswordChecks: true,
      ...(COPY_META && r.publicMetadata && Object.keys(r.publicMetadata).length ? { publicMetadata: r.publicMetadata } : {}),
    };
    const summary = `${r.emails.length} email(s), ${r.phones.length} phone(s)${r.username ? ', username' : ''}, ${hasDigest ? `password (${r.passwordHasher})` : 'no password'}`;
    if (!APPLY) { note(r.devId, '', 'would_create', summary); continue; }
    try {
      const u = await clerk.users.createUser(params);
      note(r.devId, u.id, 'created', summary);
    } catch (e: any) {
      note(r.devId, '', 'error', e?.errors?.map((x: any) => `${x.code}: ${x.message}`).join('; ') || e?.message || String(e));
    }
    await new Promise((res) => setTimeout(res, 150)); // stay under Clerk's rate limit
  }

  const csv = out.join('\n') + '\n';
  if (OUT) fs.writeFileSync(OUT, csv);
  else process.stdout.write(csv);
  console.log('TOTALS', JSON.stringify(tally));
  if (!APPLY) console.log('Dry run: nothing written. Re-run with --apply to create the users.');
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
