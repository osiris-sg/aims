/**
 * Security phase 1 (2026-11-24): fill the StoredFile registry for keys stored
 * before uploads were registered, and report cross-org signs (forensics).
 *
 * Scans every table in the public schema that has an "organizationId" column:
 * text / json columns are searched for our bucket's keys (plain keys under a
 * known folder, or full public/presigned URLs of the bucket). Each key gets
 * the org of the row(s) that reference it.
 *   - one org      → StoredFile(key, org, source=backfill)
 *   - several orgs → StoredFile(key, <key-shape org or first>, quarantined=true), listed
 *   - key shape says another org (vehicles/<orgB>/... in an orgA row) → listed (forensics)
 *
 * DRY RUN by default (read-only). Writes only with --apply; against prod also
 * needs --confirm-prod. Never updates or deletes an existing StoredFile row.
 *
 *   npx ts-node --transpile-only scripts/_sec-storedfile-backfill.ts            # dev, dry run
 *   npx ts-node --transpile-only scripts/_sec-storedfile-backfill.ts --prod     # prod, dry run
 *   ... --prod --apply --confirm-prod                                            # prod, write
 *   ... --heads   also HEAD the S3 objects (read-only) and flag objects modified after the
 *                 referencing row was last updated (possible overwrite)
 */
import 'dotenv/config';
import { Client } from 'pg';
import * as fs from 'fs';
import * as path from 'path';
import { S3Client, HeadObjectCommand, GetBucketVersioningCommand, GetBucketLoggingCommand } from '@aws-sdk/client-s3';

process.env.TZ = 'UTC';
const args = new Set(process.argv.slice(2));
const PROD = args.has('--prod');
const APPLY = args.has('--apply');
const HEADS = args.has('--heads');
if (APPLY && PROD && !args.has('--confirm-prod')) {
  console.error('Refusing: --apply on prod needs --confirm-prod');
  process.exit(1);
}
const url = PROD ? process.env.PROD_DATABASE_URL : process.env.DATABASE_URL;
if (!url) throw new Error(PROD ? 'PROD_DATABASE_URL missing' : 'DATABASE_URL missing');
const BUCKET = process.env.RESOURCE_BUCKET || 'aims-osiris';

/** First path segments our keys use (client uploads, legacy and server-built). */
const FOLDERS = [
  'org', 'logos', 'stamps', 'signatures', 'payment-details', 'assets', 'captured-images', 'msr-photos', 'msr-annotations',
  'inventory-bind', 'do-start', 'do-ack', 'do-install', 'do-stamped', 'delivery-pod', 'job-fields', 'custom-fields',
  'maintenance-reports', 'vehicles', 'bills', 'bank-transactions', 'payments', 'orders', 'documents', 'deliveries', 'preview',
  'misc', 'shipments', 'submit-uploads', 'leads', 'payables', 'project-costs', 'projects', 'email-ingest', 'extracted-uploads',
  'supplier-uploads', 'whatsapp', 'whatsapp-previews', 'delivery-posts', 'job-photos', 'temp-signature', 'images', 'uploads', 'organizations',
  // 2026-11-25: folders the first run missed (Biofuel signed DOs, JP pass imports, document attachments).
  'attachments', 'jp-pass-import', 'signed-docs',
];
const KEY_RE = new RegExp(`^(?:${FOLDERS.map((f) => f.replace(/-/g, '\\-')).join('|')})/[^\\s"'<>]{3,400}$`);
const URL_RE = new RegExp(`https?://(?:${BUCKET}\\.s3(?:[.-][a-z0-9-]+)?\\.amazonaws\\.com/|s3(?:[.-][a-z0-9-]+)?\\.amazonaws\\.com/${BUCKET}/)([^\\s"'<>?#)]+)`, 'gi');
/** Legacy/server prefixes whose 2nd segment is the owner org. */
const ORG_PREFIXED = new Set(['maintenance-reports', 'vehicles', 'shipments', 'delivery-pod', 'submit-uploads', 'leads', 'payables', 'project-costs', 'projects', 'email-ingest', 'extracted-uploads', 'supplier-uploads', 'whatsapp', 'whatsapp-previews', 'delivery-posts']);

function shapeOrg(key: string, orgIds: Set<string>): string | null {
  const p = key.split('/');
  if (p[0] === 'org' && p[1]) return p[1];
  if (ORG_PREFIXED.has(p[0]) && p[1] && orgIds.has(p[1])) return p[1];
  if (p[0] === 'documents' && p[1] && orgIds.has(p[1])) return p[1]; // generated PDFs: documents/<org>/<TYPE>/...
  return null;
}

function keysIn(text: string): string[] {
  const out = new Set<string>();
  URL_RE.lastIndex = 0;
  let m: RegExpExecArray | null;
  while ((m = URL_RE.exec(text))) {
    try {
      out.add(decodeURIComponent(m[1]));
    } catch {
      out.add(m[1]);
    }
  }
  const walk = (v: any, depth: number) => {
    if (depth > 12 || v == null) return;
    if (typeof v === 'string') {
      const s = v.trim();
      if (KEY_RE.test(s) && !s.includes('..')) out.add(s);
      return;
    }
    if (Array.isArray(v)) return v.forEach((x) => walk(x, depth + 1));
    if (typeof v === 'object') for (const x of Object.values(v)) walk(x, depth + 1);
  };
  try {
    walk(JSON.parse(text), 0);
  } catch {
    walk(text, 0);
    // Keys inside free text ("see logos/x.png", a message with a key in it).
    // 2026-11-25: also after "{" and "," (a text[] column reads as {a,b}); the first run missed every list column.
    const inText = new RegExp(`(?:^|[\\s"'({,])((?:${FOLDERS.join('|')})/[^\\s"'<>),}]+\\.[A-Za-z0-9]{2,5})`, 'g');
    let t: RegExpExecArray | null;
    while ((t = inText.exec(text))) if (!t[1].includes('..')) out.add(t[1]);
  }
  return [...out];
}

type Ref = { table: string; id: string; org: string; updatedAt: string | null };

(async () => {
  const db = new Client({ connectionString: url.replace('-pooler', '') });
  await db.connect();
  const orgIds = new Set((await db.query(`SELECT id FROM "public"."Organization"`)).rows.map((r: any) => r.id));
  const cols = (
    await db.query(`
      SELECT c.table_name, c.column_name, c.data_type
      FROM information_schema.columns c
      WHERE c.table_schema = 'public'
        AND c.data_type IN ('text', 'character varying', 'json', 'jsonb', 'ARRAY')
        AND c.table_name IN (SELECT table_name FROM information_schema.columns WHERE table_schema='public' AND column_name='organizationId')
        AND c.table_name NOT IN ('ActionLog', 'AuditLog', 'StoredFile', 'IdempotencyRecord', '_prisma_migrations')
        AND c.column_name NOT IN ('id', 'organizationId')`)
  ).rows as { table_name: string; column_name: string; data_type: string }[];
  const byTable = new Map<string, string[]>();
  for (const c of cols) byTable.set(c.table_name, [...(byTable.get(c.table_name) ?? []), c.column_name]);
  const hasCol = async (t: string, c: string) =>
    (await db.query(`SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name=$1 AND column_name=$2`, [t, c])).rowCount! > 0;

  const refs = new Map<string, Ref[]>();
  const perTable: Record<string, number> = {};
  const pattern = `(amazonaws\\.com|(^|["{,])(${FOLDERS.join('|')})/)`;
  for (const [table, columns] of byTable) {
    const idCol = (await hasCol(table, 'id')) ? '"id"' : null;
    if (!idCol) continue;
    const upd = (await hasCol(table, 'updatedAt')) ? `to_char("updatedAt", 'YYYY-MM-DD"T"HH24:MI:SS"Z"')` : (await hasCol(table, 'createdAt')) ? `to_char("createdAt", 'YYYY-MM-DD"T"HH24:MI:SS"Z"')` : 'NULL';
    const textExpr = columns.map((c) => `coalesce("${c}"::text, '')`).join(` || ' ' || `);
    let last = '';
    for (;;) {
      const r = await db.query(
        `SELECT ${idCol}::text AS id, "organizationId" AS org, ${upd} AS upd, ${columns.map((c) => `"${c}"::text AS "${c}"`).join(', ')}
         FROM "public"."${table}" WHERE ${idCol}::text > $1 AND (${textExpr}) ~ $2 ORDER BY ${idCol}::text LIMIT 500`,
        [last, pattern],
      );
      if (!r.rows.length) break;
      for (const row of r.rows) {
        last = row.id;
        const ks = new Set<string>();
        for (const c of columns) if (row[c]) keysIn(row[c]).forEach((k) => ks.add(k));
        for (const k of ks) {
          const list = refs.get(k) ?? [];
          list.push({ table, id: row.id, org: row.org, updatedAt: row.upd });
          refs.set(k, list);
          perTable[table] = (perTable[table] ?? 0) + 1;
        }
      }
      if (r.rows.length < 500) break;
    }
  }

  // Tables without an organizationId column: the org comes from the row itself or its parent.
  const extra: { table: string; sql: string }[] = [
    { table: 'Organization', sql: `SELECT id::text AS id, id AS org, to_char("updatedAt", 'YYYY-MM-DD"T"HH24:MI:SS"Z"') AS upd, row_to_json(o)::text AS txt FROM "public"."Organization" o` },
    {
      table: 'TimelineItem',
      sql: `SELECT t.id::text AS id, coalesce(d."organizationId", i."organizationId") AS org, NULL AS upd, coalesce(t.message,'') || ' ' || coalesce(t."pdfUrl",'') AS txt
            FROM "public"."TimelineItem" t LEFT JOIN "public"."Document" d ON d.id = t."documentId" LEFT JOIN "public"."Inventory" i ON i.id = t."inventoryId"`,
    },
  ];
  for (const x of extra) {
    try {
      for (const row of (await db.query(x.sql)).rows) {
        if (!row.org || !row.txt) continue;
        for (const k of keysIn(row.txt)) {
          const list = refs.get(k) ?? [];
          list.push({ table: x.table, id: row.id, org: row.org, updatedAt: row.upd });
          refs.set(k, list);
          perTable[x.table] = (perTable[x.table] ?? 0) + 1;
        }
      }
    } catch (e: any) {
      console.log(`skipped ${x.table}: ${e?.message}`);
    }
  }

  const existing = new Map<string, string>();
  try {
    for (const r of (await db.query(`SELECT key, "organizationId" FROM "public"."StoredFile"`)).rows) existing.set(r.key, r.organizationId);
  } catch {
    console.log('StoredFile table not found (deploy phase 1 first); dry run continues');
  }

  const single: { key: string; org: string }[] = [];
  const multi: { key: string; orgs: string[]; refs: Ref[] }[] = [];
  const shapeMismatch: { key: string; shape: string; refOrgs: string[]; refs: Ref[] }[] = [];
  let already = 0;
  for (const [key, list] of refs) {
    const orgs = [...new Set(list.map((r) => r.org).filter(Boolean))];
    const shape = shapeOrg(key, orgIds);
    if (shape && orgs.some((o) => o !== shape)) shapeMismatch.push({ key, shape, refOrgs: orgs, refs: list.slice(0, 5) });
    if (existing.has(key)) {
      already++;
      continue;
    }
    if (orgs.length > 1) multi.push({ key, orgs, refs: list.slice(0, 8) });
    else if (orgs.length === 1) single.push({ key, org: orgs[0] });
  }

  // Forensics: S3 metadata (read-only).
  const s3 = new S3Client({ region: process.env.AWS_REGION || 'ap-southeast-1' });
  const bucketInfo: Record<string, string> = {};
  try {
    const v = await s3.send(new GetBucketVersioningCommand({ Bucket: BUCKET }));
    bucketInfo.versioning = v.Status || 'never enabled';
  } catch (e: any) {
    bucketInfo.versioning = `not readable (${e?.name})`;
  }
  try {
    const l = await s3.send(new GetBucketLoggingCommand({ Bucket: BUCKET }));
    bucketInfo.accessLogging = l.LoggingEnabled ? `on → ${l.LoggingEnabled.TargetBucket}` : 'off';
  } catch (e: any) {
    bucketInfo.accessLogging = `not readable (${e?.name})`;
  }
  const lateWrites: { key: string; lastModified: string; rowUpdatedAt: string; refs: Ref[] }[] = [];
  let headed = 0;
  let missing = 0;
  if (HEADS) {
    const todo = [...refs.entries()];
    for (let i = 0; i < todo.length; i += 20) {
      await Promise.all(
        todo.slice(i, i + 20).map(async ([key, list]) => {
          try {
            const h = await s3.send(new HeadObjectCommand({ Bucket: BUCKET, Key: key }));
            headed++;
            const lm = h.LastModified?.toISOString();
            const latestRow = list.map((r) => r.updatedAt).filter(Boolean).sort().pop() as string | undefined;
            // An object rewritten more than a day after the newest row that references it.
            if (lm && latestRow && Date.parse(lm) - Date.parse(latestRow) > 24 * 3600 * 1000) {
              lateWrites.push({ key, lastModified: lm, rowUpdatedAt: latestRow, refs: list.slice(0, 5) });
            }
          } catch {
            missing++;
          }
        }),
      );
    }
  }

  const summary = {
    db: PROD ? 'prod' : 'dev',
    mode: APPLY ? 'APPLY' : 'DRY RUN',
    bucket: bucketInfo,
    referencedKeys: refs.size,
    alreadyRegistered: already,
    toRegister: single.length,
    toQuarantine: multi.length,
    keyShapeOrgMismatch: shapeMismatch.length,
    refsPerTable: perTable,
    ...(HEADS ? { headed, headMissing: missing, objectsModifiedAfterTheirRows: lateWrites.length } : {}),
  };
  console.log(JSON.stringify(summary, null, 2));
  const logPath = path.join(__dirname, `_sec-storedfile-backfill${PROD ? '-prod' : ''}.log.json`);
  fs.writeFileSync(logPath, JSON.stringify({ at: new Date().toISOString(), summary, multi, shapeMismatch, lateWrites }, null, 2));
  console.log(`details: ${logPath}`);

  if (APPLY) {
    let wrote = 0;
    for (let i = 0; i < single.length; i += 500) {
      const chunk = single.slice(i, i + 500);
      const vals = chunk.map((_, j) => `($${j * 2 + 1}, $${j * 2 + 2}, 'backfill', false, NULL)`).join(',');
      const r = await db.query(`INSERT INTO "public"."StoredFile"(key, "organizationId", source, quarantined, note) VALUES ${vals} ON CONFLICT (key) DO NOTHING`, chunk.flatMap((c) => [c.key, c.org]));
      wrote += r.rowCount ?? 0;
    }
    for (const m of multi) {
      const owner = shapeOrg(m.key, orgIds) ?? m.orgs[0];
      const r = await db.query(
        `INSERT INTO "public"."StoredFile"(key, "organizationId", source, quarantined, "sharedOrgIds", note) VALUES ($1, $2, 'backfill', true, $3, $4) ON CONFLICT (key) DO NOTHING`,
        [m.key, owner, m.orgs, `referenced by orgs: ${m.orgs.join(', ')}`.slice(0, 900)],
      );
      wrote += r.rowCount ?? 0;
    }
    console.log(`wrote ${wrote} StoredFile rows`);
    await db.query(
      `INSERT INTO "public"."ActionLog"(id, "actorType", "actorId", "actorName", channel, action, resource, details, status, "createdAt")
       VALUES (gen_random_uuid()::text, 'SYSTEM', 'system:sec-storedfile-backfill', 'System creation', 'cron', 'CREATE', 'stored-files', $1, 'SUCCESS', now())`,
      [JSON.stringify({ note: 'StoredFile registry backfill', wrote, registered: single.length, quarantined: multi.length })],
    );
  }
  await db.end();
})().catch((e) => {
  console.error(e?.message || e);
  process.exit(1);
});
