/**
 * aims_inv_number_guard (round 36, WCT group, 2026-11-19): one invoice number per organisation, in the database.
 *
 * A plain-SQL BEFORE trigger on "Document" (like aims_je_guard / aims_doc_list_keys), so `prisma db push` never
 * drops it and no unique index has to be added to the shared table (a new @@unique would stop Render's build on any
 * org that already holds a duplicate, and would apply to every org). It refuses an INVOICE row whose number (name)
 * another INVOICE row of the same organisation already has, raised as a unique violation (SQLSTATE 23505, the
 * text "AIMS guard: invoice number …"), so the app's retry (locked-number.ts) takes a fresh number.
 *
 * Only orgs whose order invoicing is on (an existing feature flag below, OrganizationUIConfig.features) are
 * checked; every other org's insert returns at once, unchanged. It fires on INSERT, and on UPDATE only when the
 * number, the type or the org changes (a config save never pays for it). Rows already duplicated stay as they are.
 * A per-number transaction lock (pg_advisory_xact_lock) makes two writers of the same number wait for each other,
 * and the check runs after the wait in a fresh snapshot, so the second one sees the first and is refused.
 *
 * Installer: scripts/invoice-number-guard.ts (dry run by default).
 */

/**
 * The orgs checked: order invoicing on (AIMS orders' Create invoice / imported orders' Create invoice), or the
 * dedicated setting invoiceNumberGuard (Elroy 2026-11-20: the whole WCT group incl. YMM, which has neither flag).
 */
export const INVOICE_NUMBER_GUARD_SETTING = 'invoiceNumberGuard';
export const INVOICE_NUMBER_GUARD_FLAGS = ['enableWctOrderInvoice', 'enableImportedOrders', INVOICE_NUMBER_GUARD_SETTING] as const;
export const INVOICE_NUMBER_GUARD_NAME = 'aims_inv_number_guard';

const ident = (s: string) => {
  if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(s)) throw new Error(`bad schema name ${s}`);
  return `"${s}"`;
};

/** Statements that (re)install the guard on `docSchema`."Document", reading the flags from `uiSchema`."OrganizationUIConfig". */
export function invoiceNumberGuardSql(docSchema: string, uiSchema: string): string[] {
  const s = ident(docSchema);
  const u = ident(uiSchema);
  const flags = INVOICE_NUMBER_GUARD_FLAGS.map((f) => `COALESCE(c.features ->> '${f}', '') = 'true'`).join(' OR ');
  return [
    `CREATE OR REPLACE FUNCTION ${s}.${INVOICE_NUMBER_GUARD_NAME}() RETURNS trigger LANGUAGE plpgsql AS $fn$
BEGIN
  IF TG_OP = 'UPDATE' AND NEW.name IS NOT DISTINCT FROM OLD.name AND NEW.type IS NOT DISTINCT FROM OLD.type
     AND NEW."organizationId" IS NOT DISTINCT FROM OLD."organizationId" THEN
    RETURN NEW;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM ${u}."OrganizationUIConfig" c WHERE c."organizationId" = NEW."organizationId" AND (${flags})) THEN
    RETURN NEW;
  END IF;
  PERFORM pg_advisory_xact_lock(hashtext('aims-inv-number:' || NEW."organizationId" || ':' || NEW.name));
  IF EXISTS (SELECT 1 FROM ${s}."Document" d
              WHERE d.name = NEW.name AND d."organizationId" = NEW."organizationId" AND d.type = 'INVOICE' AND d.id <> NEW.id) THEN
    RAISE EXCEPTION 'AIMS guard: invoice number % is already used in this organisation', NEW.name USING ERRCODE = 'unique_violation';
  END IF;
  RETURN NEW;
END $fn$;`,
    `DROP TRIGGER IF EXISTS ${INVOICE_NUMBER_GUARD_NAME} ON ${s}."Document";`,
    `CREATE TRIGGER ${INVOICE_NUMBER_GUARD_NAME}
       BEFORE INSERT OR UPDATE OF name, type, "organizationId" ON ${s}."Document"
       FOR EACH ROW WHEN (NEW.type = 'INVOICE' AND NEW.name IS NOT NULL AND NEW.name <> '')
       EXECUTE FUNCTION ${s}.${INVOICE_NUMBER_GUARD_NAME}();`,
  ];
}

export function dropInvoiceNumberGuardSql(docSchema: string): string[] {
  const s = ident(docSchema);
  return [`DROP TRIGGER IF EXISTS ${INVOICE_NUMBER_GUARD_NAME} ON ${s}."Document";`, `DROP FUNCTION IF EXISTS ${s}.${INVOICE_NUMBER_GUARD_NAME}();`];
}
