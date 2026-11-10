/**
 * Biofuel delivery #99 (2026-11-10): give the run's OWN draft DO its real number now,
 * before the delivery, the way enableRealDoOnSchedule issues one at schedule time.
 * Biofuel has that flag OFF, so #99 was scheduled with the placeholder DO-PENDING-09.
 *
 * Same document, renamed in place: the run's line keeps pointing at it (DeliveryItem.documentId),
 * so when the rider completes #99, commitScheduledRunOnCompletion commits THIS DO
 * (link-and-commit, no new DO) and maybeCompleteDeliveryOrderAndInvoice leaves a DO that no
 * longer starts with DO-PENDING- under its number.
 *
 * Number: Biofuel's DELIVERY_ORDER format, claimed exactly as
 * DocumentNumberingService.issueNumberLocked does (counter row locked by a no-op UPDATE, highest
 * existing number read inside the lock, nextSerial = serial + 1), in ONE transaction with the
 * rename, so the number and the DO commit or roll back together. Never edits the counter by hand.
 *
 * Owner's go (2026-11-10) adds, in the same transaction:
 *   - the DO's contact: a CustomerContact on the DO's customer (CONTACT_NAME / CONTACT_PHONE env,
 *     kept out of git), set on the DO exactly as the editor's point-of-contact picker fills it
 *     (attention.{name,phoneNumber,email}, documentInfo.{contact,contactName,contactNumber}) plus
 *     the schedule flow's top-level contactName / contactNumber;
 *   - Delivery To cleared (it held the project name, not an address; a blank row is not printed);
 *   - a VIEW-ONLY share link (DocumentShareLink, token vo_…), the kind the WhatsApp group post
 *     uses: no login, can never sign, revocable from the DO page.
 *
 * Writes (only with --apply): Document.name, config.issuedOnSchedule = true (a later cancel of
 * #99 keeps the DO as Cancelled instead of deleting a numbered DO), DocumentNumberFormat.nextSerial
 * (+1, the normal claim), one AuditLog "EDITED" row (the DO's History), one ActionLog row
 * (System creation). Status stays unconfirmed (draft). Nothing else; no email / WhatsApp.
 *
 *   CONTACT_NAME=… CONTACT_PHONE=… DBURL=… node scripts/do99-real-number.js [--apply]
 *   dev proof: RUN_NO=… DO_ID=… PLACEHOLDER=… SEARCH_PATH=org_biofuel,platform,public DBURL=<dev> node … [--apply]
 */
const { Client } = require('pg');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

const ORG = '52e90ba8-bfbd-48b0-bb76-4f9667bf74f1';
const ORG_NAME = 'Biofuel Industries Pte Ltd';
// Overridable for the dev proof (dev Biofuel lives in per-org schemas: SEARCH_PATH=org_biofuel,platform,public).
const RUN_NO = Number(process.env.RUN_NO || 99);
const DO_ID = process.env.DO_ID || '150abc43-76e8-4a28-bdfb-21152216aa91';
const PLACEHOLDER = process.env.PLACEHOLDER || 'DO-PENDING-09';
const APPLY = process.argv.includes('--apply');
const CONTACT_NAME = (process.env.CONTACT_NAME || '').trim();
const CONTACT_PHONE = (process.env.CONTACT_PHONE || '').trim();
const last4 = (p) => (p ? '…' + p.replace(/\D/g, '').slice(-4) : '');
const LOG = path.resolve(__dirname, 'do99-real-number.log.json');

// DocumentNumberingService.format / resetKey / maxExistingSerial, same rules.
const DOC_CODE = { DELIVERY_ORDER: 'DO' };
function format(pattern, serial, date, docCode = '') {
  const YYYY = String(date.getFullYear()), YY = YYYY.slice(2);
  const MM = String(date.getMonth() + 1).padStart(2, '0'), DD = String(date.getDate()).padStart(2, '0');
  return (pattern || '').replace(/\{([^}]+)\}/g, (_m, tok) => {
    if (/^#+$/.test(tok)) return String(serial).padStart(tok.length, '0');
    if (tok === 'DOC') return docCode;
    return tok.replace(/YYYY/g, YYYY).replace(/YY/g, YY).replace(/MM/g, MM).replace(/DD/g, DD);
  });
}
function resetKey(policy, d) {
  const YYYY = String(d.getFullYear()), MM = String(d.getMonth() + 1).padStart(2, '0'), DD = String(d.getDate()).padStart(2, '0');
  return policy === 'daily' ? `${YYYY}-${MM}-${DD}` : policy === 'monthly' ? `${YYYY}-${MM}` : policy === 'yearly' ? YYYY : null;
}
async function maxExistingSerial(q, pattern, docCode, when) {
  const tok = /\{(#+)\}/.exec(pattern);
  if (!tok) return 0;
  const prefix = format(pattern.slice(0, tok.index), 0, when, docCode);
  const suffix = format(pattern.slice(tok.index + tok[0].length), 0, when, docCode);
  if (!prefix) return 0;
  let max = 0;
  for (const { name } of await q(`SELECT name FROM "Document" WHERE "organizationId" = $1 AND name LIKE $2`, [ORG, prefix.replace(/[%_\\]/g, '\\$&') + '%'])) {
    const n = name || '';
    if (suffix && !n.endsWith(suffix)) continue;
    const mid = n.slice(prefix.length, suffix ? n.length - suffix.length : undefined);
    if (/^\d+$/.test(mid)) max = Math.max(max, parseInt(mid, 10));
  }
  return max;
}

(async () => {
  const c = new Client({ connectionString: process.env.DBURL });
  await c.connect();
  if (process.env.SEARCH_PATH) await c.query(`SET search_path TO ${process.env.SEARCH_PATH.replace(/[^a-z_,]/g, '')}`);
  const q = async (sql, p) => (await c.query(sql, p)).rows;
  try {
    const org = (await q(`SELECT name FROM "Organization" WHERE id = $1`, [ORG]))[0];
    if (org?.name !== ORG_NAME) throw new Error(`org is "${org?.name}", expected "${ORG_NAME}"`);
    const run = (await q(`SELECT id, status, direction, "isDraft", "scheduledFor" FROM "Delivery" WHERE "organizationId" = $1 AND "deliveryNumber" = $2`, [ORG, RUN_NO]))[0];
    if (!run) throw new Error(`no delivery #${RUN_NO}`);
    if (run.status !== 'scheduled' || run.direction !== 'OUTBOUND' || run.isDraft) throw new Error(`#${RUN_NO} is ${run.status}/${run.direction}${run.isDraft ? '/draft' : ''}: expected a scheduled outbound run (not started)`);
    const items = await q(`SELECT id, description, quantity, "documentId", "deliveryStatus" FROM "DeliveryItem" WHERE "deliveryId" = $1 ORDER BY "sortOrder"`, [run.id]);
    const docIds = [...new Set(items.map((i) => i.documentId).filter(Boolean))];
    if (docIds.length !== 1 || docIds[0] !== DO_ID) throw new Error(`#${RUN_NO}'s lines point at ${JSON.stringify(docIds)}, expected only ${DO_ID}`);
    const doc = (await q(`SELECT id, type, name, status, config FROM "Document" WHERE id = $1 AND "organizationId" = $2`, [DO_ID, ORG]))[0];
    if (!doc || doc.type !== 'DELIVERY_ORDER') throw new Error('DO not found');
    if (doc.name !== PLACEHOLDER) throw new Error(`DO is named "${doc.name}", expected the placeholder ${PLACEHOLDER} (already numbered? nothing to do)`);
    if (doc.status !== 'unconfirmed') throw new Error(`DO status is ${doc.status}, expected unconfirmed`);
    const others = await q(`SELECT d.name, r."deliveryNumber" FROM "DeliveryItem" i JOIN "Delivery" r ON r.id = i."deliveryId" JOIN "Document" d ON d.id = i."documentId" WHERE i."documentId" = $1 AND i."deliveryId" <> $2`, [DO_ID, run.id]);
    if (others.length) throw new Error(`the DO is also on run(s) ${others.map((o) => '#' + o.deliveryNumber).join(', ')}`);

    const fmts = await q(`SELECT * FROM "DocumentNumberFormat" WHERE "organizationId" = $1 AND "documentType" = 'DELIVERY_ORDER' AND "isActive" = true ORDER BY "sortOrder" ASC`, [ORG]);
    if (!fmts.length) throw new Error('Biofuel has no active DELIVERY_ORDER number format');
    const f = fmts[0];
    const when = new Date();
    const docCode = DOC_CODE.DELIVERY_ORDER;
    const key = resetKey(f.resetPolicy, when);
    const peekMax = await maxExistingSerial(q, f.pattern, docCode, when);
    const peekSerial = Math.max(key != null && f.lastResetKey !== key ? 1 : f.nextSerial, peekMax + 1);
    const peek = format(f.pattern, peekSerial, when, docCode);
    const cfg = doc.config || {};
    const contacts = (await q(
      `SELECT count(*)::int n FROM "CustomerContact" cc WHERE cc."customerId" = $1 OR cc.id IN (SELECT pc."customerContactId" FROM "ProjectContact" pc JOIN "Document" d ON d."projectId" = pc."projectId" WHERE d.id = $2)`,
      [cfg.customerId ?? null, DO_ID],
    ))[0].n;
    const existingContact = CONTACT_NAME && cfg.customerId
      ? (await q(`SELECT id FROM "CustomerContact" WHERE "customerId" = $1 AND lower(name) = lower($2) AND regexp_replace(coalesce(phone, ''), '\\D', '', 'g') = regexp_replace($3, '\\D', '', 'g')`, [cfg.customerId, CONTACT_NAME, CONTACT_PHONE]))[0]
      : null;
    const viewLink = (await q(`SELECT token FROM "DocumentShareLink" WHERE "documentId" = $1 AND "revokedAt" IS NULL AND token LIKE 'vo\\_%' ORDER BY "createdAt" DESC LIMIT 1`, [DO_ID]))[0];
    const sc = await q(`SELECT 1 FROM "SiteClockConnection" WHERE "organizationId" = $1`, [ORG]).catch(() => []);

    console.log(`Biofuel delivery #${RUN_NO}: ${run.status}, scheduled ${run.scheduledFor.toISOString()}`);
    console.log(`  line(s): ${items.map((i) => `${i.quantity} × ${i.description} (${i.deliveryStatus})`).join('; ')}`);
    console.log(`  DO ${doc.id}: ${doc.name} → ${peek}${APPLY ? ' (re-read inside the lock at apply)' : ''}`);
    console.log(`  number format "${f.label}" ${f.pattern}: nextSerial ${f.nextSerial}, highest existing ${format(f.pattern, peekMax, when, docCode)} → issues ${peek}, nextSerial becomes ${peekSerial + 1}`);
    console.log(`  status stays ${doc.status} (draft) · config.issuedOnSchedule: ${cfg.issuedOnSchedule === true} → true · config.documentNumber: ${cfg.documentNumber !== undefined ? 'set to the number' : 'absent, left absent'}`);
    console.log(`  on the DO already: customer ${cfg.customerName} (${cfg.customerCode}), PO No ${cfg.poNo}, items ${JSON.stringify((cfg.items || []).map((i) => `${i.quantity} × ${i.description}`))}`);
    console.log(`  NOT on the DO (left empty, not invented): contact person / number (${contacts} contact(s) on the customer or project; none on the DO), delivery address ("Delivery To" is "${cfg.deliveryTo}"; the customer address is "${cfg.customerAddress}")`);
    if (CONTACT_NAME) {
      if (!cfg.customerId) throw new Error('the DO has no customerId to add the contact to');
      console.log(`  contact: ${existingContact ? `existing CustomerContact ${existingContact.id}` : `INSERT CustomerContact "${CONTACT_NAME}" ${last4(CONTACT_PHONE)} on ${cfg.customerName} (not primary)`} → DO Attention "${CONTACT_NAME}", Mobile ${last4(CONTACT_PHONE)}`);
    }
    console.log(`  Delivery To: "${cfg.deliveryTo ?? ''}" → "" (row not printed; "Project: ${cfg.projectName ?? ''}" still prints)`);
    console.log(`  view-only link: ${viewLink ? 'already exists, reused' : 'INSERT DocumentShareLink vo_… (no login, cannot sign, revocable)'}`);
    console.log(`  history: 1 AuditLog row (DO History "EDITED"), 1 ActionLog row (System creation) · SiteClock link for Biofuel: ${sc.length ? 'yes' : 'none'} · email / WhatsApp: none`);
    if (!APPLY) { console.log('DRY RUN: nothing written'); return; }

    await c.query('BEGIN');
    // issueNumberLocked: lock the counter row, then read the highest existing number inside the lock.
    const locked = (await q(`UPDATE "DocumentNumberFormat" SET "nextSerial" = "nextSerial" + 0 WHERE id = $1 RETURNING *`, [f.id]))[0];
    const max = await maxExistingSerial(q, locked.pattern, docCode, when);
    const serial = Math.max(key != null && locked.lastResetKey !== key ? 1 : locked.nextSerial, max + 1);
    const name = format(locked.pattern, serial, when, docCode);
    await q(`UPDATE "DocumentNumberFormat" SET "nextSerial" = $2${key != null ? `, "lastResetKey" = '${key}'` : ''}, "updatedAt" = now() WHERE id = $1`, [f.id, serial + 1]);
    const clash = await q(`SELECT id FROM "Document" WHERE "organizationId" = $1 AND type = 'DELIVERY_ORDER' AND name = $2 AND id <> $3`, [ORG, name, DO_ID]);
    if (clash.length) throw new Error(`${name} is already in use`);
    const renamed = await q(
      `UPDATE "Document" SET name = $2,
         config = config || jsonb_build_object('issuedOnSchedule', true)
                  || CASE WHEN config ? 'documentNumber' THEN jsonb_build_object('documentNumber', $2::text) ELSE '{}'::jsonb END,
         "updatedAt" = now()
       WHERE id = $1 AND name = $3 AND status = 'unconfirmed' RETURNING name`,
      [DO_ID, name, PLACEHOLDER],
    );
    if (renamed.length !== 1) throw new Error('DO changed under us (no longer the unconfirmed placeholder)');
    let contactId = existingContact?.id ?? null;
    if (CONTACT_NAME && !contactId) {
      contactId = crypto.randomUUID();
      await q(`INSERT INTO "CustomerContact" (id, name, phone, "isPrimary", "customerId", "createdAt", "updatedAt") VALUES ($1,$2,$3,false,$4,now(),now())`, [contactId, CONTACT_NAME, CONTACT_PHONE || null, cfg.customerId]);
    }
    const header = {
      deliveryTo: '',
      ...(CONTACT_NAME
        ? {
            attention: { name: CONTACT_NAME, phoneNumber: CONTACT_PHONE, email: '' },
            contactName: CONTACT_NAME,
            ...(CONTACT_PHONE ? { contactNumber: CONTACT_PHONE } : {}),
          }
        : {}),
    };
    const info = CONTACT_NAME
      ? { contact: [CONTACT_NAME, CONTACT_PHONE].filter(Boolean).join(' - '), contactName: CONTACT_NAME, contactNumber: CONTACT_PHONE }
      : {};
    await q(
      `UPDATE "Document" SET config = config || $2::jsonb || jsonb_build_object('documentInfo', coalesce(config->'documentInfo', '{}'::jsonb) || $3::jsonb), "updatedAt" = now() WHERE id = $1`,
      [DO_ID, JSON.stringify(header), JSON.stringify(info)],
    );
    const token = viewLink?.token ?? `vo_${crypto.randomBytes(32).toString('base64url')}`;
    if (!viewLink) await q(`INSERT INTO "DocumentShareLink" (id, token, "documentId", "createdAt") VALUES ($1,$2,$3,now())`, [crypto.randomUUID(), token, DO_ID]);
    await q(
      `INSERT INTO "AuditLog" (id, "userId", "userName", action, resource, "resourceId", "resourceName", "organizationId", details, status, "createdAt") VALUES ($1,'system','System creation','EDITED','document',$2,$3,$4,$5::jsonb,'SUCCESS',now())`,
      [crypto.randomUUID(), DO_ID, name, ORG, JSON.stringify({ detail: `Numbered ${PLACEHOLDER} → ${name} before delivery #${RUN_NO} (real DO on schedule); still a draft${CONTACT_NAME ? `. Attention: ${CONTACT_NAME}` : ''}. Delivery To cleared` })],
    );
    await q(
      `INSERT INTO "ActionLog" (id, "actorType", "actorId", "actorName", "organizationId", channel, action, resource, "resourceId", details, status, "createdAt") VALUES ($1,'SYSTEM','system:do99-real-number','System creation',$2,'cron','UPDATE','Document',$3,$4::jsonb,'SUCCESS',now())`,
      [crypto.randomUUID(), ORG, DO_ID, JSON.stringify({ purpose: `Delivery #${RUN_NO}: real DO number before delivery`, from: PLACEHOLDER, to: name, deliveryId: run.id, contactId, deliveryToCleared: true, viewOnlyLink: !viewLink })],
    );
    await c.query('COMMIT');
    const all = fs.existsSync(LOG) ? JSON.parse(fs.readFileSync(LOG, 'utf8')) : [];
    all.push({ at: new Date().toISOString(), mode: 'APPLY', deliveryId: run.id, documentId: DO_ID, from: PLACEHOLDER, to: name, formatId: f.id, nextSerialBefore: locked.nextSerial, nextSerialAfter: serial + 1, issuedOnScheduleBefore: cfg.issuedOnSchedule ?? null, contactId, contactCreated: !!contactId && !existingContact, contactPhone: last4(CONTACT_PHONE), deliveryToBefore: cfg.deliveryTo ?? null, attentionBefore: cfg.attention ?? null, viewOnlyLinkCreated: !viewLink, viewOnlyToken: `${token.slice(0, 6)}…` /* the link itself stays out of git */ });
    fs.writeFileSync(LOG, JSON.stringify(all, null, 1));
    console.log(`APPLIED: ${PLACEHOLDER} → ${name} · view-only /guest/do/${token} · logged → ${path.relative(process.cwd(), LOG)}`);
  } catch (e) {
    await c.query('ROLLBACK').catch(() => {});
    throw e;
  } finally {
    await c.end();
  }
})().catch((e) => { console.error('ERROR', e.message); process.exit(1); });
