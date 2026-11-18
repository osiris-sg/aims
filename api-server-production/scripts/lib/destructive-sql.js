/* Destructive-SQL classifier for the build-time schema push guard (scripts/db-push.js).
 *
 * Input: the SQL that `prisma migrate diff --from-url <db> --to-schema-datamodel <file> --script`
 * prints, i.e. exactly what `prisma db push` is about to run. Output: every statement (or
 * ALTER TABLE clause) that can lose data or break existing rows, each with a stable KEY that
 * prisma/allow-destructive.txt can name to let it through.
 *
 * Pure: no I/O. Unit tested in scripts/__tests__/destructive-sql.test.js.
 *
 * Keys (KIND Target) — what the build log prints and what the allowlist matches:
 *   DROP_TABLE          Table
 *   DROP_COLUMN         Table.column
 *   ALTER_COLUMN_TYPE   Table.column            (ALTER COLUMN … TYPE / SET DATA TYPE)
 *   SET_NOT_NULL        Table.column
 *   ADD_REQUIRED_COLUMN Table.column            (ADD COLUMN … NOT NULL without DEFAULT, existing table)
 *   DROP_INDEX          IndexName               (includes @unique, which Prisma models as unique indexes)
 *   DROP_CONSTRAINT     Table.ConstraintName    (primary keys / unique / unknown — NOT foreign keys)
 *   DROP_TYPE           TypeName                (enum removal / enum value removal)
 *   DROP_OTHER          <OBJECT> Name           (DROP SEQUENCE / EXTENSION / SCHEMA / VIEW …)
 *   STATEMENT           <exact statement, whitespace collapsed>   (anything not recognised → fail safe)
 *
 * Deliberately NOT destructive:
 *   - DROP CONSTRAINT of a foreign key (Prisma's "-- DropForeignKey" section, or a *_fkey name):
 *     relation changes (onDelete/onUpdate edits, FK re-points) always drop + re-add the FK. Dropping
 *     a FK loses no rows; if the FK goes away for good, the column/table drop is caught separately.
 *   - ALTER COLUMN … DROP NOT NULL / SET DEFAULT / DROP DEFAULT (relaxing; no data touched).
 *   - ALTER INDEX/TYPE … RENAME, ALTER TYPE … ADD VALUE, CREATE *, ADD CONSTRAINT, BEGIN/COMMIT.
 */
'use strict';

const KINDS = [
  'DROP_TABLE', 'DROP_COLUMN', 'ALTER_COLUMN_TYPE', 'SET_NOT_NULL', 'ADD_REQUIRED_COLUMN',
  'DROP_INDEX', 'DROP_CONSTRAINT', 'DROP_TYPE', 'DROP_OTHER', 'STATEMENT',
];

const collapse = (s) => s.replace(/\s+/g, ' ').trim();

/** Split SQL into statements, honouring '…', "…", -- and /* *\/ comments. Each statement
 *  carries the last `-- Section` comment seen before it (Prisma labels every step). Throws on
 *  dollar-quoting or an unterminated quote/comment — the caller treats that as unparseable. */
function splitStatements(sql) {
  if (typeof sql !== 'string') throw new Error('diff output is not a string');
  const out = [];
  let buf = '';
  let section = null;
  let i = 0;
  const n = sql.length;
  while (i < n) {
    const c = sql[i];
    const next = sql[i + 1];
    if (c === '-' && next === '-') {
      const end = sql.indexOf('\n', i);
      const line = sql.slice(i + 2, end === -1 ? n : end).trim();
      if (!buf.trim() && /^[A-Za-z]+$/.test(line)) section = line;
      i = end === -1 ? n : end + 1;
      buf += ' ';
      continue;
    }
    if (c === '/' && next === '*') {
      const end = sql.indexOf('*/', i + 2);
      if (end === -1) throw new Error('unterminated /* comment in diff SQL');
      i = end + 2;
      buf += ' ';
      continue;
    }
    if (c === '$' && /^\$[A-Za-z0-9_]*\$/.test(sql.slice(i))) {
      throw new Error('dollar-quoted body in diff SQL (not something Prisma emits) — refusing to guess');
    }
    if (c === "'" || c === '"') {
      let j = i + 1;
      for (;;) {
        if (j >= n) throw new Error(`unterminated ${c} quote in diff SQL`);
        if (sql[j] === c) {
          if (sql[j + 1] === c) { j += 2; continue; } // doubled quote = escaped
          break;
        }
        j++;
      }
      buf += sql.slice(i, j + 1);
      i = j + 1;
      continue;
    }
    if (c === ';') {
      if (buf.trim()) out.push({ sql: collapse(buf), section });
      buf = '';
      i++;
      continue;
    }
    buf += c;
    i++;
  }
  if (buf.trim()) out.push({ sql: collapse(buf), section });
  return out;
}

/** Split an ALTER TABLE body into its comma-separated clauses (top level only). */
function splitClauses(body) {
  const parts = [];
  let depth = 0;
  let buf = '';
  for (let i = 0; i < body.length; i++) {
    const c = body[i];
    if (c === "'" || c === '"') {
      let j = i + 1;
      while (j < body.length && !(body[j] === c && body[j + 1] !== c)) j += body[j] === c ? 2 : 1;
      buf += body.slice(i, j + 1);
      i = j;
      continue;
    }
    if (c === '(') depth++;
    if (c === ')') depth--;
    if (c === ',' && depth === 0) { parts.push(buf.trim()); buf = ''; continue; }
    buf += c;
  }
  if (buf.trim()) parts.push(buf.trim());
  return parts;
}

// An identifier, optionally schema-qualified: "public"."Foo" | Foo | "Foo"
const IDENT = '(?:"(?:[^"]|"")+"|[A-Za-z_][A-Za-z0-9_$]*)';
const QNAME = `(${IDENT}(?:\\s*\\.\\s*${IDENT})?)`;
const unq = (s) => (s.startsWith('"') ? s.slice(1, -1).replace(/""/g, '"') : s);
/** Last component of a possibly schema-qualified name, unquoted. */
const bare = (q) => {
  const parts = q.match(new RegExp(IDENT, 'g'));
  return unq(parts[parts.length - 1]);
};

function classifyAlterTableClause(table, clause, createdTables, section, findings) {
  const add = (kind, target) => findings.push({ kind, target, key: `${kind} ${target}`, sql: clause });
  let m;
  if ((m = clause.match(new RegExp(`^DROP\\s+COLUMN\\s+(?:IF\\s+EXISTS\\s+)?(${IDENT})`, 'i')))) {
    return add('DROP_COLUMN', `${table}.${unq(m[1])}`);
  }
  if ((m = clause.match(new RegExp(`^ADD\\s+COLUMN\\s+(?:IF\\s+NOT\\s+EXISTS\\s+)?(${IDENT})\\s+(.*)$`, 'i')))) {
    const rest = m[2];
    const notNull = /\bNOT\s+NULL\b/i.test(rest);
    const hasDefault = /\bDEFAULT\b/i.test(rest) || /\bGENERATED\b/i.test(rest) || /^\s*(SMALL|BIG)?SERIAL\b/i.test(rest);
    if (notNull && !hasDefault && !createdTables.has(table)) add('ADD_REQUIRED_COLUMN', `${table}.${unq(m[1])}`);
    return;
  }
  if ((m = clause.match(new RegExp(`^ALTER\\s+(?:COLUMN\\s+)?(${IDENT})\\s+(.*)$`, 'i')))) {
    const col = `${table}.${unq(m[1])}`;
    const action = m[2];
    if (/^(SET\s+DATA\s+)?TYPE\b/i.test(action)) return add('ALTER_COLUMN_TYPE', col);
    if (/^SET\s+NOT\s+NULL\b/i.test(action)) return add('SET_NOT_NULL', col);
    if (/^(DROP\s+NOT\s+NULL|SET\s+DEFAULT\b|DROP\s+DEFAULT)\b/i.test(action)) return;
    return add('STATEMENT', `ALTER TABLE ${table} ${clause}`);
  }
  if ((m = clause.match(new RegExp(`^DROP\\s+CONSTRAINT\\s+(?:IF\\s+EXISTS\\s+)?(${IDENT})`, 'i')))) {
    const name = unq(m[1]);
    if (section === 'DropForeignKey' || /_fkey$/.test(name)) return; // FK drop: see header
    return add('DROP_CONSTRAINT', `${table}.${name}`);
  }
  if (/^ADD\s+(CONSTRAINT\b|PRIMARY\s+KEY\b|UNIQUE\b|FOREIGN\s+KEY\b)/i.test(clause)) return;
  if (/^RENAME\s+CONSTRAINT\b/i.test(clause)) return;
  if (/^(ENABLE|DISABLE)\s+ROW\s+LEVEL\s+SECURITY\b/i.test(clause)) return;
  return add('STATEMENT', `ALTER TABLE ${table} ${clause}`);
}

/**
 * Classify diff SQL. Returns
 *   { empty, statements, destructive: [{kind,target,key,sql}], warnings: [string] }
 * Throws if the SQL cannot be parsed (caller must fail the build).
 */
function classify(sql) {
  const statements = splitStatements(sql);
  const destructive = [];
  const warnings = [];
  const createdTables = new Set();
  for (const { sql: s } of statements) {
    const m = s.match(new RegExp(`^CREATE\\s+TABLE\\s+(?:IF\\s+NOT\\s+EXISTS\\s+)?${QNAME}`, 'i'));
    if (m) createdTables.add(bare(m[1]));
  }
  const add = (kind, target, s) => destructive.push({ kind, target, key: `${kind} ${target}`, sql: s });

  for (const { sql: s, section } of statements) {
    let m;
    if (/^(BEGIN|COMMIT|START\s+TRANSACTION)$/i.test(s)) continue;
    if (/^CREATE\s+(TABLE|TYPE|SCHEMA|SEQUENCE)\b/i.test(s)) continue;
    if (/^CREATE\s+EXTENSION\b/i.test(s)) continue;
    if ((m = s.match(new RegExp(`^CREATE\\s+(UNIQUE\\s+)?INDEX\\s+(?:CONCURRENTLY\\s+)?(?:IF\\s+NOT\\s+EXISTS\\s+)?(${IDENT})\\s+ON\\s+(?:ONLY\\s+)?${QNAME}`, 'i')))) {
      const table = bare(m[3]);
      if (m[1] && !createdTables.has(table)) {
        warnings.push(`new UNIQUE index ${unq(m[2])} on existing table ${table}: the push fails if current rows contain duplicates (check before deploying).`);
      }
      continue;
    }
    if (/^COMMENT\s+ON\b/i.test(s)) continue;
    if (/^ALTER\s+(INDEX|SEQUENCE)\s+.*\bRENAME\s+TO\b/i.test(s)) continue;
    if (/^ALTER\s+SEQUENCE\s+\S+\s+OWNED\s+BY\b/i.test(s)) continue;
    if (/^ALTER\s+TYPE\s+.*\bADD\s+VALUE\b/i.test(s)) continue;
    if (/^ALTER\s+TYPE\s+.*\bRENAME\s+TO\b/i.test(s)) continue;
    if ((m = s.match(new RegExp(`^ALTER\\s+TABLE\\s+(?:IF\\s+EXISTS\\s+)?(?:ONLY\\s+)?${QNAME}\\s+(.*)$`, 'i')))) {
      const table = bare(m[1]);
      if (/^RENAME\s+TO\b/i.test(m[2])) { add('STATEMENT', s, s); continue; }
      for (const clause of splitClauses(m[2])) classifyAlterTableClause(table, clause, createdTables, section, destructive);
      continue;
    }
    if ((m = s.match(new RegExp(`^DROP\\s+TABLE\\s+(?:IF\\s+EXISTS\\s+)?(.*?)(?:\\s+(?:CASCADE|RESTRICT))?$`, 'i')))) {
      for (const t of m[1].split(',')) add('DROP_TABLE', bare(t.trim()), s);
      continue;
    }
    if ((m = s.match(new RegExp(`^DROP\\s+INDEX\\s+(?:CONCURRENTLY\\s+)?(?:IF\\s+EXISTS\\s+)?(.*?)(?:\\s+(?:CASCADE|RESTRICT))?$`, 'i')))) {
      for (const t of m[1].split(',')) add('DROP_INDEX', bare(t.trim()), s);
      continue;
    }
    if ((m = s.match(new RegExp(`^DROP\\s+TYPE\\s+(?:IF\\s+EXISTS\\s+)?(.*?)(?:\\s+(?:CASCADE|RESTRICT))?$`, 'i')))) {
      for (const t of m[1].split(',')) add('DROP_TYPE', bare(t.trim()), s);
      continue;
    }
    if ((m = s.match(new RegExp(`^DROP\\s+([A-Z ]+?)\\s+(?:IF\\s+EXISTS\\s+)?${QNAME}`, 'i')))) {
      add('DROP_OTHER', `${m[1].toUpperCase()} ${bare(m[2])}`, s);
      continue;
    }
    add('STATEMENT', s, s); // TRUNCATE, DELETE, UPDATE, anything unknown: fail safe
  }
  return { empty: statements.length === 0, statements, destructive, warnings };
}

/** Parse prisma/allow-destructive.txt. Lines: `KIND Target`, optionally followed by
 *  `@schemaName` to scope it to one per-org schema. `#` starts a comment. */
function parseAllowlist(text) {
  const entries = [];
  const errors = [];
  (text || '').split(/\r?\n/).forEach((raw, idx) => {
    const line = raw.replace(/(^|\s)#.*$/, '').trim();
    if (!line) return;
    const m = line.match(/^([A-Za-z_]+)\s+(.+?)(?:\s+@([A-Za-z0-9_]+))?$/);
    const kind = m && m[1].toUpperCase();
    if (!m || !KINDS.includes(kind)) {
      errors.push(`line ${idx + 1}: "${raw.trim()}" — expected "KIND Target [@schema]", KIND one of ${KINDS.join(', ')}`);
      return;
    }
    const target = kind === 'STATEMENT' ? collapse(m[2]) : m[2].trim();
    entries.push({ kind, target, key: `${kind} ${target}`, schema: m[3] || null, line: idx + 1 });
  });
  return { entries, errors };
}

/** Split findings into allowed / blocked against the allowlist entries. */
function applyAllowlist(destructive, entries, schema = null) {
  const allowed = [];
  const blocked = [];
  const used = new Set();
  for (const f of destructive) {
    const hit = entries.find((e) => e.key === f.key && (!e.schema || e.schema === schema));
    if (hit) { allowed.push({ ...f, entry: hit }); used.add(hit); } else blocked.push(f);
  }
  return { allowed, blocked, used };
}

/** Remove anything that looks like a connection string, plus any extra secrets given. */
function scrub(text, secrets = []) {
  let out = String(text || '').replace(/\b(postgres(?:ql)?|prisma(?:\+postgres)?):\/\/[^\s'"`]+/gi, '<db-url>');
  for (const s of secrets) if (s && s.length >= 4) out = out.split(s).join('<redacted>');
  return out;
}

module.exports = { classify, splitStatements, splitClauses, parseAllowlist, applyAllowlist, scrub, KINDS };
