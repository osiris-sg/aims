/**
 * Clerk PRODUCTION import: copy every user of the Clerk DEV instance into the
 * production instance, each with external_id = their dev (= AIMS DB) user id
 * (the `aims_uid` session claim reads it). See docs/clerk-cutover.md.
 * DRY RUN by default: the dry run only READS (dev users, prod external_id and
 * identifier lookups) and writes nothing to either instance.
 *
 *   npx ts-node scripts/_clerk-import-users.ts --hashes <dev-export.csv> [--only ids.txt]
 *     [--out mapping.csv] [--apply] [--allow-test-key]
 *
 * Source: the DEV instance via the Backend API (CLERK_SECRET_KEY, must be
 *   sk_test_). This is the source of names, username, every email and phone
 *   (with verified status and primary), external accounts and all three
 *   metadata blobs. AIMS and SiteClock users live in this one instance; all
 *   are imported unless --only narrows it.
 * --hashes: the dashboard user export CSV of the dev instance. ONLY its
 *   id, password_digest and password_hasher columns are used. Digests are
 *   never printed or written to the mapping.
 * --only: newline list of dev user ids to import (default: every dev user).
 *
 * Target: CLERK_TARGET_SECRET_KEY (the PRODUCTION instance's sk_live_ key).
 * Deliberately NOT CLERK_SECRET_KEY, so this can never write into the dev
 * instance; a sk_test_ target is refused unless --allow-test-key.
 *
 * Per user (--apply only):
 *   users.createUser({ externalId: devId, first/last name, username,
 *     VERIFIED emails and phones (primary first, so it stays primary),
 *     passwordDigest + passwordHasher from the CSV (else
 *     skipPasswordRequirement), skipPasswordChecks, public/private/unsafe
 *     metadata as-is })
 *   then each UNVERIFIED email / phone is added with verified:false, so
 *   verified status is kept exactly.
 * Idempotent: a dev id already present as an external_id on the target is
 * reported "exists" and skipped, so a re-run (the delta just before cutover)
 * is safe. Writes a dev_id,prod_id,status,detail mapping (--out, else stdout).
 */
import * as fs from 'fs';
import { createClerkClient } from '@clerk/backend';

type Ident = { value: string; verified: boolean; primary: boolean };
type DevUser = {
  devId: string;
  firstName?: string;
  lastName?: string;
  username?: string;
  emails: Ident[];
  phones: Ident[];
  google: boolean;
  oauthProviders: string[];
  passwordEnabled: boolean;
  totpEnabled: boolean;
  publicMetadata: Record<string, unknown>;
  privateMetadata: Record<string, unknown>;
  unsafeMetadata: Record<string, unknown>;
};
type Hash = { digest: string; hasher: string };

const argv = process.argv.slice(2);
const flag = (k: string) => argv.includes(k);
const opt = (k: string) => {
  const i = argv.indexOf(k);
  return i >= 0 ? argv[i + 1] : undefined;
};
const APPLY = flag('--apply');
const HASHES = opt('--hashes');
const ONLY = opt('--only');
const OUT = opt('--out');
const HASHERS = new Set(['argon2i', 'argon2id', 'awscognito', 'bcrypt', 'bcrypt_sha256_django', 'md5', 'pbkdf2_sha256', 'pbkdf2_sha256_django', 'pbkdf2_sha1', 'phpass', 'scrypt_firebase', 'scrypt_werkzeug', 'sha256', 'md5_phpass', 'ldap_ssha']);
const E164 = /^\+[1-9]\d{6,14}$/;
const USERNAME = /^[a-zA-Z0-9_-]{4,64}$/; // Clerk default username rules
const META_LIMIT = 8 * 1024; // Clerk caps each metadata blob at 8KB

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

/** j***@domain.com / +65****1234: safe to print. */
const maskEmail = (e: string) => {
  const [local, domain] = e.split('@');
  return `${(local ?? '').slice(0, 1)}***@${domain ?? ''}`;
};
const maskPhone = (p: string) => `${p.slice(0, 3)}****${p.slice(-4)}`;
const nameOf = (u: DevUser) => [u.firstName, u.lastName].filter(Boolean).join(' ') || u.username || '(no name)';
const who = (u: DevUser) => {
  const e = u.emails.find((x) => x.primary) ?? u.emails[0];
  const p = u.phones.find((x) => x.primary) ?? u.phones[0];
  return `${nameOf(u)} <${e ? maskEmail(e.value) : p ? maskPhone(p.value) : u.username ? `username ${u.username}` : 'no identifier'}> [${u.devId}]`;
};
const nonEmpty = (o: unknown) => (o && typeof o === 'object' && Object.keys(o).length ? (o as Record<string, unknown>) : undefined);

async function listAll(clerk: ReturnType<typeof createClerkClient>) {
  const all: any[] = [];
  for (let offset = 0; ; offset += 500) {
    const res: any = await clerk.users.getUserList({ limit: 500, offset });
    const page = (Array.isArray(res) ? res : res.data) ?? [];
    all.push(...page);
    if (page.length < 500) break;
  }
  return all;
}

function toDevUser(u: any): DevUser {
  const idents = (list: any[], primaryId: string | null, key: string): Ident[] => {
    const mapped = (list ?? []).map((x) => ({ value: String(x[key] ?? ''), verified: x.verification?.status === 'verified', primary: x.id === primaryId })).filter((x) => x.value);
    return [...mapped.filter((x) => x.primary), ...mapped.filter((x) => !x.primary)]; // primary first
  };
  const providers = (u.externalAccounts ?? []).map((a: any) => String(a.provider ?? ''));
  return {
    devId: u.id,
    firstName: u.firstName || undefined,
    lastName: u.lastName || undefined,
    username: u.username || undefined,
    emails: idents(u.emailAddresses, u.primaryEmailAddressId, 'emailAddress'),
    phones: idents(u.phoneNumbers, u.primaryPhoneNumberId, 'phoneNumber'),
    google: providers.some((p: string) => /google/i.test(p)),
    oauthProviders: providers,
    passwordEnabled: !!u.passwordEnabled,
    totpEnabled: !!u.totpEnabled,
    publicMetadata: u.publicMetadata ?? {},
    privateMetadata: u.privateMetadata ?? {},
    unsafeMetadata: u.unsafeMetadata ?? {},
  };
}

async function main() {
  if (!HASHES) die('--hashes <dev user export CSV> is required (password digests)');
  const srcKey = process.env.CLERK_SECRET_KEY;
  const key = process.env.CLERK_TARGET_SECRET_KEY;
  if (!srcKey) die('CLERK_SECRET_KEY (the DEV instance secret, source) is not set');
  if (!srcKey.startsWith('sk_test_')) die('CLERK_SECRET_KEY is not a sk_test_ key: the source must be the dev instance');
  if (!key) die('CLERK_TARGET_SECRET_KEY (the PRODUCTION instance secret) is not set');
  if (!key.startsWith('sk_live_') && !flag('--allow-test-key')) die('CLERK_TARGET_SECRET_KEY is not a sk_live_ key (pass --allow-test-key for a rehearsal instance)');
  if (key === srcKey) die('target key equals CLERK_SECRET_KEY: refusing to import into the source instance');

  // ---- password hashes (CSV): only id / password_digest / password_hasher ----
  const csvRows = parseCsv(fs.readFileSync(HASHES, 'utf8'));
  if (csvRows.length && !('password_digest' in csvRows[0] && 'password_hasher' in csvRows[0] && 'id' in csvRows[0])) die('CSV lacks id / password_digest / password_hasher columns');
  const hashes = new Map<string, Hash>();
  const badHasher: string[] = [];
  for (const r of csvRows) {
    if (!r.id || !r.password_digest) continue;
    if (!HASHERS.has(r.password_hasher)) { badHasher.push(`${r.id} (${r.password_hasher || 'no hasher'})`); continue; }
    hashes.set(r.id, { digest: r.password_digest, hasher: r.password_hasher });
  }
  const csvIds = new Set(csvRows.map((r) => r.id).filter(Boolean));
  const csvTotp = new Set(csvRows.filter((r) => r.totp_secret).map((r) => r.id));

  // ---- source users (dev instance, read only) ----
  const src = createClerkClient({ secretKey: srcKey });
  const devAll = (await listAll(src)).map(toDevUser);
  let users = devAll;
  if (ONLY) {
    const keep = new Set(fs.readFileSync(ONLY, 'utf8').split(/\s+/).filter(Boolean));
    users = users.filter((u) => keep.has(u.devId));
  }
  console.log(`${APPLY ? '*** APPLY ***' : 'DRY RUN (nothing is written)'} | source dev instance: ${devAll.length} user(s), importing ${users.length} | target ${key.slice(0, 8)}…`);

  // ---- target lookups (read only) ----
  const clerk = createClerkClient({ secretKey: key });
  const existing = new Map<string, string>();
  for (let i = 0; i < users.length; i += 100) {
    const chunk = users.slice(i, i + 100).map((u) => u.devId);
    const res: any = await clerk.users.getUserList({ externalId: chunk, limit: 100 });
    for (const u of (Array.isArray(res) ? res : res.data) ?? []) if (u.externalId) existing.set(u.externalId, u.id);
  }
  // Identifiers already taken on the target by a user that is NOT this dev user's import.
  const todo = users.filter((u) => !existing.has(u.devId));
  const takenOnTarget: string[] = [];
  const allEmails = todo.flatMap((u) => u.emails.map((e) => e.value));
  for (let i = 0; i < allEmails.length; i += 100) {
    const res: any = await clerk.users.getUserList({ emailAddress: allEmails.slice(i, i + 100), limit: 100 });
    for (const t of (Array.isArray(res) ? res : res.data) ?? []) {
      for (const e of t.emailAddresses ?? []) {
        const owner = todo.find((u) => u.emails.some((x) => x.value.toLowerCase() === String(e.emailAddress).toLowerCase()));
        if (owner) takenOnTarget.push(`${who(owner)}: email ${maskEmail(e.emailAddress)} already on target user ${t.id} (external_id ${t.externalId ?? 'none'})`);
      }
    }
  }

  // ---- preflight checks ----
  const rejects: string[] = [];
  const dupe = (label: string, pick: (u: DevUser) => string[]) => {
    const seen = new Map<string, DevUser[]>();
    for (const u of todo) for (const v of new Set(pick(u).map((s) => s.toLowerCase()))) seen.set(v, [...(seen.get(v) ?? []), u]);
    for (const [v, us] of seen) if (us.length > 1) rejects.push(`duplicate ${label} ${label === 'email' ? maskEmail(v) : label === 'phone' ? maskPhone(v) : v} across: ${us.map(who).join(' | ')}`);
  };
  dupe('email', (u) => u.emails.map((e) => e.value));
  dupe('phone', (u) => u.phones.map((p) => p.value));
  dupe('username', (u) => (u.username ? [u.username] : []));
  for (const u of todo) {
    for (const p of u.phones) if (!E164.test(p.value)) rejects.push(`${who(u)}: phone ${maskPhone(p.value)} is not E.164`);
    if (u.username && !USERNAME.test(u.username)) rejects.push(`${who(u)}: username "${u.username}" breaks Clerk's default rules (4-64 chars, letters/digits/_/-)`);
    for (const e of u.emails) if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(e.value)) rejects.push(`${who(u)}: email ${maskEmail(e.value)} looks malformed`);
    if (u.emails[0] && u.emails[0].primary && !u.emails[0].verified) rejects.push(`${who(u)}: primary email is UNVERIFIED (Clerk would make the first verified email primary instead)`);
    if (u.phones[0] && u.phones[0].primary && !u.phones[0].verified) rejects.push(`${who(u)}: primary phone is UNVERIFIED`);
    for (const [k, m] of [['public', u.publicMetadata], ['private', u.privateMetadata], ['unsafe', u.unsafeMetadata]] as const) {
      const size = Buffer.byteLength(JSON.stringify(m ?? {}));
      if (size > META_LIMIT) rejects.push(`${who(u)}: ${k}_metadata is ${size} bytes (> 8KB)`);
    }
  }
  rejects.push(...takenOnTarget);

  // ---- create (or plan) ----
  const out: string[] = ['dev_id,prod_id,status,detail'];
  const tally: Record<string, number> = {};
  const note = (devId: string, prodId: string, status: string, detail = '') => {
    tally[status] = (tally[status] ?? 0) + 1;
    out.push([devId, prodId, status, JSON.stringify(detail)].join(','));
  };
  for (const u of users) {
    if (existing.has(u.devId)) { note(u.devId, existing.get(u.devId)!, 'exists'); continue; }
    const vEmails = u.emails.filter((e) => e.verified).map((e) => e.value);
    const vPhones = u.phones.filter((p) => p.verified).map((p) => p.value);
    const uEmails = u.emails.filter((e) => !e.verified).map((e) => e.value);
    const uPhones = u.phones.filter((p) => !p.verified).map((p) => p.value);
    if (!vEmails.length && !vPhones.length && !u.username) { note(u.devId, '', 'skip_no_identifier'); continue; }
    const h = hashes.get(u.devId);
    const params: any = {
      externalId: u.devId,
      ...(u.firstName ? { firstName: u.firstName } : {}),
      ...(u.lastName ? { lastName: u.lastName } : {}),
      ...(u.username ? { username: u.username } : {}),
      ...(vEmails.length ? { emailAddress: vEmails } : {}), // first = primary
      ...(vPhones.length ? { phoneNumber: vPhones } : {}),
      ...(h ? { passwordDigest: h.digest, passwordHasher: h.hasher } : { skipPasswordRequirement: true }),
      skipPasswordChecks: true,
      ...(nonEmpty(u.publicMetadata) ? { publicMetadata: u.publicMetadata } : {}),
      ...(nonEmpty(u.privateMetadata) ? { privateMetadata: u.privateMetadata } : {}),
      ...(nonEmpty(u.unsafeMetadata) ? { unsafeMetadata: u.unsafeMetadata } : {}),
    };
    const summary = `${vEmails.length}+${uEmails.length}u email(s), ${vPhones.length}+${uPhones.length}u phone(s)${u.username ? ', username' : ''}, ${h ? `password (${h.hasher})` : 'no password'}${u.google ? ', google' : ''}`;
    if (!APPLY) { note(u.devId, '', 'would_create', summary); continue; }
    try {
      const created = await clerk.users.createUser(params);
      for (const e of uEmails) await clerk.emailAddresses.createEmailAddress({ userId: created.id, emailAddress: e, verified: false, primary: false });
      for (const p of uPhones) await clerk.phoneNumbers.createPhoneNumber({ userId: created.id, phoneNumber: p, verified: false, primary: false });
      note(u.devId, created.id, 'created', summary);
    } catch (e: any) {
      note(u.devId, '', 'error', e?.errors?.map((x: any) => `${x.code}: ${x.message}`).join('; ') || e?.message || String(e));
    }
    await new Promise((res) => setTimeout(res, 150)); // stay under Clerk's rate limit
  }

  // ---- report (masked; no digests, no keys) ----
  const pick = users;
  const devIds = new Set(devAll.map((u) => u.devId));
  const section = (title: string, lines: string[]) => {
    console.log(`\n## ${title}: ${lines.length}`);
    for (const l of lines) console.log(`  - ${l}`);
  };
  console.log('\n# REPORT');
  console.log(`dev users: ${devAll.length} | in scope: ${pick.length} | would_create/created: ${(tally.would_create ?? 0) + (tally.created ?? 0)} | exists: ${tally.exists ?? 0} | skip_no_identifier: ${tally.skip_no_identifier ?? 0} | error: ${tally.error ?? 0}`);
  const withHash = pick.filter((u) => hashes.has(u.devId));
  console.log(`with password hash: ${withHash.length} | without: ${pick.length - withHash.length}`);
  section('dev says password enabled but CSV has no usable digest', pick.filter((u) => u.passwordEnabled && !hashes.has(u.devId)).map(who));
  section('CSV digest present but dev says no password (digest still imported)', pick.filter((u) => !u.passwordEnabled && hashes.has(u.devId)).map(who));
  section('CSV rows with an unsupported / missing hasher', badHasher);
  section('Google (oauth_google) linked', pick.filter((u) => u.google).map(who));
  const otherOauth = pick.filter((u) => u.oauthProviders.some((p) => !/google/i.test(p)));
  section('other OAuth providers linked', otherOauth.map((u) => `${who(u)}: ${u.oauthProviders.join(', ')}`));
  section('NO password + Google + no phone (locked out if Google is off in prod, unless email code is on)', pick.filter((u) => !hashes.has(u.devId) && u.google && !u.phones.length).map(who));
  section('no password, no Google (need email/SMS code or reset)', pick.filter((u) => !hashes.has(u.devId) && !u.google).map(who));
  section('no email and no phone', pick.filter((u) => !u.emails.length && !u.phones.length).map(who));
  section('phone-only (need SMS sign-in enabled in prod)', pick.filter((u) => !u.emails.length && u.phones.length).map(who));
  section('unverified emails/phones (imported as unverified)', pick.filter((u) => [...u.emails, ...u.phones].some((x) => !x.verified)).map((u) => `${who(u)}: ${u.emails.filter((e) => !e.verified).map((e) => maskEmail(e.value)).concat(u.phones.filter((p) => !p.verified).map((p) => maskPhone(p.value))).join(', ')}`));
  section('TOTP / 2FA enabled in dev (NOT migrated: re-enrol after move)', pick.filter((u) => u.totpEnabled || csvTotp.has(u.devId)).map(who));
  section('CSV rows not matching a dev user', [...csvIds].filter((id) => !devIds.has(id)));
  section('dev users missing from the CSV', devAll.filter((u) => !csvIds.has(u.devId)).map(who));
  section('likely API rejects / conflicts', rejects);
  const meta = (k: 'publicMetadata' | 'privateMetadata' | 'unsafeMetadata') => pick.filter((u) => nonEmpty(u[k])).length;
  console.log(`\nmetadata carried: public ${meta('publicMetadata')}, private ${meta('privateMetadata')}, unsafe ${meta('unsafeMetadata')} user(s); SiteClock (public_metadata.siteclock): ${pick.filter((u) => 'siteclock' in u.publicMetadata).length}`);

  const csv = out.join('\n') + '\n';
  if (OUT) fs.writeFileSync(OUT, csv);
  else process.stdout.write('\n' + csv);
  console.log('\nTOTALS', JSON.stringify(tally));
  if (!APPLY) console.log('Dry run: nothing written to either instance. Re-run with --apply to create the users.');
}

main().catch((e) => {
  console.error(e?.errors ?? e);
  process.exit(1);
});
