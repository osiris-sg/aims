/**
 * WCT logo → Company Profile branding (guru 2026-10-27: "just put in prod straight").
 *
 * Does exactly what Company Profile → Branding → Logo → Save does: uploads
 * the PNG to the resource bucket under logos/ and stores the key on the
 * organisation (Organization.logo). Every renderer then prints it — the WCT
 * layout at the left of the company block (document-html/wct.ts), the sign
 * page header, the portal — via a signed URL.
 *
 *   npx ts-node --transpile-only scripts/setup-wct-logo.ts --env prod                 # dry run
 *   npx ts-node --transpile-only scripts/setup-wct-logo.ts --env prod --apply
 *   npx ts-node --transpile-only scripts/setup-wct-logo.ts --env dev --apply          # dev is per-org (TENANCY_MODE=per-org)
 *
 * --file <path> overrides the source (default ~/Downloads/wct-logo.png).
 * Idempotent: re-uploads the same key and re-sets the same value.
 */
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { PutObjectCommand, S3Client } from '@aws-sdk/client-s3';
import { clientsFor, loadEnv, type Env } from './lib/tenancy-clients';

const ORG_ID = '5c700000-0000-4000-8000-5c7000000001';
const ORG_SCHEMA = 'org_wct';
const KEY = 'logos/wct-logo.png';

const args = process.argv.slice(2);
const argVal = (k: string, d?: string) => {
  const i = args.indexOf(k);
  return i >= 0 ? args[i + 1] : d;
};
const ENV = (argVal('--env', 'dev') || 'dev') as Env;
const APPLY = args.includes('--apply');
const FILE = argVal('--file', path.join(os.homedir(), 'Downloads', 'wct-logo.png')) as string;
loadEnv(ENV);

async function main() {
  console.log(`env=${ENV}  ${APPLY ? '*** APPLY ***' : 'DRY RUN'}  org=WCT ${ORG_ID}\n`);
  if (!fs.existsSync(FILE)) throw new Error(`logo file not found: ${FILE}`);
  const body = fs.readFileSync(FILE);
  const bucket = process.env.RESOURCE_BUCKET || 'aims-osiris';
  const region = process.env.AWS_REGION || 'ap-southeast-1';
  if (!process.env.AWS_ACCESS_KEY_ID || !process.env.AWS_SECRET_ACCESS_KEY) throw new Error('AWS credentials not in the loaded env');
  console.log(`  file       ${FILE} (${(body.length / 1024).toFixed(0)} KB)`);
  console.log(`  s3         ${bucket}/${KEY} (${region}), image/png`);

  const { plat, disconnect } = clientsFor(ENV, ORG_SCHEMA);
  try {
    const org = await plat.organization.findUnique({ where: { id: ORG_ID }, select: { name: true, logo: true } });
    if (!org) throw new Error('WCT org not found');
    console.log(`  org        ${org.name} — current logo: ${org.logo ?? '(none)'}`);
    console.log(`  will set   Organization.logo = "${KEY}"`);
    if (!APPLY) {
      console.log('\nDRY RUN DONE — re-run with --apply to upload and set.');
      return;
    }
    const s3 = new S3Client({ region, credentials: { accessKeyId: process.env.AWS_ACCESS_KEY_ID!, secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY! } });
    await s3.send(new PutObjectCommand({ Bucket: bucket, Key: KEY, Body: body, ContentType: 'image/png' }));
    console.log('  uploaded   ok');
    await plat.organization.update({ where: { id: ORG_ID }, data: { logo: KEY } });
    console.log('  saved      Organization.logo');
    console.log('\nDONE');
  } finally {
    await disconnect();
  }
}

main().catch((e) => {
  console.error('❌', e?.message || e);
  process.exit(1);
});
