/**
 * WCT group settings (2026-11-12, Part C): bring the sister companies onto the
 * WCT features the owner chose. Touches ONLY the four WCT group orgs; dry run
 * by default (prints every change), one transaction on --apply.
 *
 *   WCT (S) Systems  enableQuotationSubject
 *   WCT Racking      enableWctOrders, enableWctOrderInvoice, enableQuotationSubject,
 *                    enableJobsCalendar, enableJobFields; ORDERS module; job fields seed
 *   BC Air           enableQuotationESign, enableConfirmQuotation, enableQuotationToDelivery,
 *                    enableRealDoOnSchedule, enableWctOrders, enableWctOrderInvoice,
 *                    enableQuotationItemGroups, enableRolePresets, enableQuotationSubject,
 *                    enableJobsCalendar, enableJobFields, enableLegacyAccountingUx;
 *                    ORDERS / DELIVERIES / DASHBOARD modules; Operations + Sales preset roles;
 *                    job fields seed; a BC Air quotation template in the WCT layout
 *                    (a NEW BC Air-owned row made BC Air's primary: the existing
 *                    "Quotation" row is a cross-org isDefault and stays untouched)
 *   YMM Kitchen      enableLegacyAccountingUx
 *
 * Never touched: enableSiteClockLink / enableSiteClockDeliveries, enableWctMyJobs,
 * enableWctFinishModes, enableWctVehicles, enableDeliveryGroupPosts,
 * enableWhatsAppAgent, enableAimsChat, enableProjects, useDocumentListKeys,
 * enableManualOrderFlow. Letterhead values (logo, address, email...) are NOT
 * invented here: the dry run lists what BC Air's Organization row is missing.
 *
 * Dev (per-org tenancy: config / modules / templates in "platform", roles /
 * permissions / custom fields in org_<x>; orgs absent on dev are skipped):
 *   npx ts-node --transpile-only scripts/setup-wct-group-settings.ts --target=tenancy [--apply]
 * Prod (everything in public; prod URL passed inline as DBURL):
 *   DBURL=<prod> npx ts-node --transpile-only scripts/setup-wct-group-settings.ts --target=public [--apply --confirm-prod]
 */
import 'dotenv/config';
import { randomUUID } from 'crypto';
import { Client } from 'pg';
import { ROLE_PRESETS, presetDescription, resolvePresetPermissions } from '../src/roles/role-presets';

const WCT = '5c700000-0000-4000-8000-5c7000000001';
const RACK = '5c700000-0000-4000-8000-5c7000000002';
const YMM = '5c700000-0000-4000-8000-5c7000000003';
const BCAIR = '5c700000-0000-4000-8000-5c7000000004';
const GROUP = [WCT, RACK, YMM, BCAIR];

const NEVER = new Set([
  'enableSiteClockLink', 'enableSiteClockDeliveries', 'enableWctMyJobs', 'enableWctFinishModes', 'enableWctVehicles',
  'enableDeliveryGroupPosts', 'enableWhatsAppAgent', 'enableAimsChat', 'enableProjects', 'useDocumentListKeys', 'enableManualOrderFlow',
]);

type Plan = { org: string; label: string; schema?: string; features: string[]; modules: string[]; presetRoles: string[]; jobFields: boolean; wctQuoteTemplate: boolean };
const PLANS: Plan[] = [
  { org: WCT, label: 'WCT (S) Systems', schema: 'org_wct', features: ['enableQuotationSubject'], modules: [], presetRoles: [], jobFields: false, wctQuoteTemplate: false },
  {
    org: RACK, label: 'WCT Racking', schema: 'org_wctracking',
    features: ['enableWctOrders', 'enableWctOrderInvoice', 'enableQuotationSubject', 'enableJobsCalendar', 'enableJobFields'],
    modules: ['ORDERS'], presetRoles: [], jobFields: true, wctQuoteTemplate: false,
  },
  {
    org: BCAIR, label: 'BC Air', schema: 'org_bcair',
    features: [
      'enableQuotationESign', 'enableConfirmQuotation', 'enableQuotationToDelivery', 'enableRealDoOnSchedule', 'enableWctOrders',
      'enableWctOrderInvoice', 'enableQuotationItemGroups', 'enableRolePresets', 'enableQuotationSubject', 'enableJobsCalendar',
      'enableJobFields', 'enableLegacyAccountingUx',
    ],
    modules: ['ORDERS', 'DELIVERIES', 'DASHBOARD'], presetRoles: ['Operations', 'Sales'], jobFields: true, wctQuoteTemplate: true,
  },
  { org: YMM, label: 'YMM Kitchen', schema: 'org_ymm', features: ['enableLegacyAccountingUx'], modules: [], presetRoles: [], jobFields: false, wctQuoteTemplate: false },
];

// Same two fields as scripts/seed-wct-job-fields.ts (WCT's starting set).
const JOB_FIELDS = [
  { fieldName: 'permit_required', displayLabel: 'Permit required', fieldType: 'boolean', display: { showOnCalendar: true, icon: 'permit', colourByValue: { true: '#ef6c00' } } },
  { fieldName: 'permit_approved', displayLabel: 'Permit approved', fieldType: 'boolean', display: { showOnCalendar: true, icon: 'verified', colourByValue: { true: '#2e7d32', false: '#c62828' } } },
];

const arg = (k: string) => process.argv.find((a) => a.startsWith(`--${k}=`))?.split('=')[1];
const apply = process.argv.includes('--apply');
const target = arg('target');

for (const p of PLANS) for (const f of p.features) if (NEVER.has(f)) throw new Error(`${f} is on the never-copy list`);

(async () => {
  if (target !== 'tenancy' && target !== 'public') throw new Error('Pass --target=tenancy (dev) or --target=public (prod)');
  const url = target === 'public' ? process.env.DBURL || '' : process.env.DATABASE_URL || '';
  if (!url) throw new Error(target === 'public' ? 'Pass the prod URL inline as DBURL' : 'DATABASE_URL is not set');
  const prodHost = process.env.PROD_DATABASE_URL ? new URL(process.env.PROD_DATABASE_URL).host : '';
  const isProd = !!prodHost && new URL(url).host === prodHost;
  if (target === 'tenancy' && isProd) throw new Error('Refusing: --target=tenancy is for the dev database');
  if (apply && isProd && !process.argv.includes('--confirm-prod')) throw new Error('Applying to prod needs --confirm-prod');
  const plat = target === 'tenancy' ? 'platform' : 'public';
  const orgSchemaOf = (p: Plan) => (target === 'tenancy' ? p.schema! : 'public');

  const c = new Client({ connectionString: url });
  await c.connect();
  const out: string[] = [];
  const say = (s: string) => out.push(s);
  const exists = async (schema: string, table: string) => !!(await c.query(`select to_regclass($1) r`, [`"${schema}"."${table}"`])).rows[0].r;
  try {
    if (apply) await c.query('BEGIN');
    // WCT's rows the others copy from.
    const wctModules = (await c.query(`select "moduleCode", "displayName", icon, "sortOrder", config from "${plat}"."OrganizationModule" where "organizationId" = $1`, [WCT])).rows;
    const wctQuote = (await c.query(`select id, name, config, "styleConfig" from "${plat}"."DocumentTemplate" where "organizationId" = $1 and type = 'QUOTATION' and "styleConfig"->>'layout' = 'wct' order by "updatedAt" desc limit 1`, [WCT])).rows[0];

    for (const p of PLANS) {
      const org = (await c.query(`select id, name, logo, address, "phoneNumber", "registrationNumber", email, website, "bankDetails", "docTypeDefaults" from "${plat}"."Organization" where id = $1`, [p.org])).rows[0];
      if (!org) {
        say(`\n== ${p.label}: not in this database, skipped`);
        continue;
      }
      say(`\n== ${org.name} (${p.org})${isProd ? '  [PROD]' : ''}`);
      const os = orgSchemaOf(p);
      const orgTablesOk = await exists(os, 'Role');
      if (!orgTablesOk) say(`  (no ${os} schema here: roles / job fields skipped)`);

      // 1) features
      const cfg = (await c.query(`select features from "${plat}"."OrganizationUIConfig" where "organizationId" = $1`, [p.org])).rows[0];
      if (!cfg) throw new Error(`${org.name} has no OrganizationUIConfig row`);
      const turnOn = p.features.filter((f) => cfg.features?.[f] !== true);
      for (const f of p.features) say(`  flag ${f}: ${cfg.features?.[f] === true ? 'already on' : `${cfg.features?.[f] ?? 'unset'} -> true`}`);
      if (apply && turnOn.length) {
        await c.query(
          `update "${plat}"."OrganizationUIConfig" set features = coalesce(features, '{}'::jsonb) || $2::jsonb, "updatedAt" = now() where "organizationId" = $1`,
          [p.org, JSON.stringify(Object.fromEntries(turnOn.map((f) => [f, true])))],
        );
      }

      // 2) modules (enable the org's row, or create it from WCT's)
      for (const code of p.modules) {
        const row = (await c.query(`select id, enabled from "${plat}"."OrganizationModule" where "organizationId" = $1 and "moduleCode" = $2`, [p.org, code])).rows[0];
        const src = wctModules.find((m) => m.moduleCode === code);
        if (row?.enabled) say(`  module ${code}: already on`);
        else if (row) {
          say(`  module ${code}: off -> on`);
          if (apply) await c.query(`update "${plat}"."OrganizationModule" set enabled = true, "updatedAt" = now() where id = $1`, [row.id]);
        } else {
          say(`  module ${code}: create (copy of WCT's: "${src?.displayName}", sort ${src?.sortOrder})`);
          if (apply) {
            await c.query(
              `insert into "${plat}"."OrganizationModule" (id, "organizationId", "moduleCode", enabled, "displayName", icon, "sortOrder", config, "createdAt", "updatedAt") values ($1, $2, $3, true, $4, $5, $6, $7, now(), now())`,
              [randomUUID(), p.org, code, src?.displayName ?? null, src?.icon ?? null, src?.sortOrder ?? null, src?.config ?? null],
            );
          }
        }
      }

      // 3) preset roles (WCT presets, resolved against this org's permission catalogue)
      if (p.presetRoles.length && orgTablesOk) {
        const catalogue = (await c.query(`select id, name from "${os}"."Permission"`)).rows;
        const idByName = new Map(catalogue.map((r: any) => [r.name, r.id]));
        const roles = (await c.query(`select name, description from "${os}"."Role" where "organizationId" = $1`, [p.org])).rows;
        say(`  roles today: ${roles.map((r: any) => `${r.name}${String(r.description ?? '').startsWith('Preset') ? ' (preset)' : ''}`).join(', ')}`);
        for (const name of p.presetRoles) {
          const preset = ROLE_PRESETS.find((r) => r.name === name)!;
          const perms = resolvePresetPermissions(preset, catalogue.map((r: any) => r.name));
          if (roles.some((r: any) => r.name === name)) {
            say(`  role ${name}: already there, left as is`);
            continue;
          }
          say(`  role ${name}: create "${presetDescription(preset)}" with ${perms.length} permissions, modules ${preset.allowedModules.join(',') || 'all'}`);
          if (apply) {
            const id = randomUUID();
            await c.query(
              `insert into "${os}"."Role" (id, name, description, "allowedModules", "organizationId", "createdAt", "updatedAt") values ($1, $2, $3, $4, $5, now(), now())`,
              [id, name, presetDescription(preset), preset.allowedModules, p.org],
            );
            for (const n of perms) await c.query(`insert into "${os}"."_PermissionToRole" ("A", "B") values ($1, $2) on conflict do nothing`, [idByName.get(n), id]);
          }
        }
      }

      // 4) job fields (same two fields as WCT)
      if (p.jobFields && orgTablesOk) {
        const have = (await c.query(`select "fieldName", "isActive" from "${os}"."CustomField" where "organizationId" = $1 and "entityType" = 'Delivery'`, [p.org])).rows;
        let sort = 0;
        for (const f of JOB_FIELDS) {
          sort++;
          const h = have.find((x: any) => x.fieldName === f.fieldName);
          if (h) {
            say(`  job field ${f.displayLabel}: already there${h.isActive ? '' : ' (inactive, left as is)'}`);
            continue;
          }
          say(`  job field ${f.displayLabel}: create (yes/no, icon ${f.display.icon}, on the calendar)`);
          if (apply) {
            await c.query(
              `insert into "${os}"."CustomField" (id, "organizationId", "entityType", "fieldName", "displayLabel", "fieldType", required, "sortOrder", "isActive", "showInList", "showInForm", display, "createdAt", "updatedAt")
               values ($1, $2, 'Delivery', $3, $4, $5, false, $6, true, false, true, $7, now(), now())`,
              [randomUUID(), p.org, f.fieldName, f.displayLabel, f.fieldType, sort, JSON.stringify(f.display)],
            );
          }
        }
      }

      // 5) BC Air quotation template in the WCT layout (letterhead comes from the Organization row)
      if (p.wctQuoteTemplate) {
        if (!wctQuote) throw new Error('WCT has no quotation template in the WCT layout');
        const name = 'BC Air Quotation';
        const mine = (await c.query(`select id from "${plat}"."DocumentTemplate" where "organizationId" = $1 and type = 'QUOTATION' and name = $2`, [p.org, name])).rows[0];
        const primary = (await c.query(`select a."templateId", t.name from "${plat}"."OrganizationActiveTemplate" a join "${plat}"."DocumentTemplate" t on t.id = a."templateId" where a."organizationId" = $1 and a.type = 'QUOTATION' and a."isPrimary"`, [p.org])).rows[0];
        if (mine) say(`  template "${name}": already there (${mine.id})`);
        else say(`  template "${name}": create, a copy of "${wctQuote.name}" (layout wct, columns ${(wctQuote.config?.tableColumnOrder ?? []).join('/')}, ${Object.keys(wctQuote.config?.formFields ?? {}).length} form-field types), owned by BC Air, isDefault false`);
        say(`  template primary for QUOTATION: ${primary ? `"${primary.name}"` : 'none'} -> "${name}" (the existing cross-org isDefault "Quotation" row is not touched)`);
        if (apply) {
          const tid = mine?.id ?? randomUUID();
          if (!mine) {
            await c.query(
              `insert into "${plat}"."DocumentTemplate" (id, name, type, "templateVariant", config, "styleConfig", "organizationId", "designName", description, "isActive", "isDefault", "createdAt", "updatedAt")
               values ($1, $2, 'QUOTATION', 'QO1', $3, $4, $5, 'WCT layout', 'BC Air quotation in the WCT layout', true, false, now(), now())`,
              [tid, name, wctQuote.config, wctQuote.styleConfig, p.org],
            );
          }
          await c.query(`update "${plat}"."OrganizationActiveTemplate" set "isPrimary" = false, "updatedAt" = now() where "organizationId" = $1 and type = 'QUOTATION' and "templateId" <> $2`, [p.org, tid]);
          await c.query(
            `insert into "${plat}"."OrganizationActiveTemplate" (id, "organizationId", type, "templateId", "isPrimary", "createdAt", "updatedAt") values ($1, $2, 'QUOTATION', $3, true, now(), now())
             on conflict ("organizationId", type, "templateId") do update set "isPrimary" = true, "updatedAt" = now()`,
            [randomUUID(), p.org, tid],
          );
        }
        // Letterhead: the WCT layout prints these Organization columns. Report only.
        const lh: Record<string, unknown> = {
          name: org.name, logo: org.logo, address: org.address, phoneNumber: org.phoneNumber, registrationNumber: org.registrationNumber,
          email: org.email, website: org.website, paynowUen: org.bankDetails?.paynowUen ?? null,
          quotationTnC: org.docTypeDefaults?.QUOTATION ?? org.docTypeDefaults?.QO1 ?? null,
        };
        const wctRow = (await c.query(`select address, "phoneNumber" from "${plat}"."Organization" where id = $1`, [WCT])).rows[0];
        for (const [k, v] of Object.entries(lh)) {
          const sameAsWct = (k === 'address' && v === wctRow?.address) || (k === 'phoneNumber' && v === wctRow?.phoneNumber);
          say(`  letterhead ${k}: ${v == null || v === '' ? 'MISSING' : sameAsWct ? `"${v}" (WCT's value, placeholder?)` : typeof v === 'object' ? 'set' : `"${String(v).slice(0, 70)}"`}`);
        }
      }
    }
    if (apply) await c.query('COMMIT');
  } catch (e) {
    if (apply) await c.query('ROLLBACK').catch(() => undefined);
    throw e;
  } finally {
    await c.end();
  }
  console.log(out.join('\n'));
  console.log(apply ? '\nApplied.' : '\nDry run. Pass --apply to change it.');
})().catch((e) => {
  console.error(e.message);
  process.exit(1);
});
