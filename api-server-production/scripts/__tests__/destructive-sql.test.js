// npm run test:pushguard
// SQL fixtures are verbatim `prisma migrate diff --script` output (Prisma 6.6) from a throwaway DB.
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { classify, parseAllowlist, applyAllowlist, scrub, splitStatements } = require('../lib/destructive-sql');

const keys = (sql) => classify(sql).destructive.map((d) => d.key);

const FIX = {
  empty: '-- This is an empty migration.\n',
  newTable: `-- CreateTable
CREATE TABLE "New" (
    "id" TEXT NOT NULL,
    "v" TEXT NOT NULL,
    "w" INTEGER NOT NULL,
    "note" TEXT NOT NULL DEFAULT 'a;b, c',

    CONSTRAINT "New_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "New_v_key" ON "New"("v");

-- AddForeignKey
ALTER TABLE "New" ADD CONSTRAINT "New_w_fkey" FOREIGN KEY ("w") REFERENCES "Item"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
`,
  addNullableAndDefault: `-- AlterTable
ALTER TABLE "Org" ADD COLUMN     "extra" TEXT NOT NULL DEFAULT 'x',
ADD COLUMN     "opt" TEXT,
ADD COLUMN     "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP;
`,
  newIndex: '-- CreateIndex\nCREATE INDEX "Org_qty_idx" ON "Org"("qty");\n',
  trgmIndex: '-- CreateIndex\nCREATE INDEX "Customer_name_idx" ON "Customer" USING GIN ("name" gin_trgm_ops);\n',
  enumAdd: "-- AlterEnum\nALTER TYPE \"Kind\" ADD VALUE 'C';\n",
  fkChange: `-- DropForeignKey
ALTER TABLE "Item" DROP CONSTRAINT "Item_orgId_fkey";

-- AddForeignKey
ALTER TABLE "Item" ADD CONSTRAINT "Item_orgId_fkey" FOREIGN KEY ("orgId") REFERENCES "Org"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
`,
  relax: '-- AlterTable\nALTER TABLE "Org" ALTER COLUMN "qty" DROP NOT NULL,\nALTER COLUMN "kind" SET DEFAULT \'A\';\n',
  renameIndex: '-- RenameIndex\nALTER INDEX "Org_a_idx" RENAME TO "Org_b_idx";\n',
  extension: '-- CreateExtension\nCREATE EXTENSION IF NOT EXISTS "pg_trgm";\n',

  dropColumn: '-- AlterTable\nALTER TABLE "Org" DROP COLUMN "note";\n',
  dropIndex: '-- DropIndex\nDROP INDEX "Org_qty_idx";\n',
  dropUnique: '-- DropIndex\nDROP INDEX "Org_name_key";\n',
  typeChange: '-- AlterTable\nALTER TABLE "Org" ALTER COLUMN "qty" SET DATA TYPE TEXT;\n',
  setNotNull: '-- AlterTable\nALTER TABLE "Org" ALTER COLUMN "qty" SET NOT NULL;\n',
  addRequired: '-- AlterTable\nALTER TABLE "Org" ADD COLUMN     "extra" TEXT NOT NULL;\n',
  dropTable: `-- DropForeignKey
ALTER TABLE "Item" DROP CONSTRAINT "Item_orgId_fkey";

-- DropTable
DROP TABLE "Item";
`,
  enumRemove: `-- AlterEnum
BEGIN;
CREATE TYPE "Kind_new" AS ENUM ('A');
ALTER TABLE "Org" ALTER COLUMN "kind" DROP DEFAULT;
ALTER TABLE "Org" ALTER COLUMN "kind" TYPE "Kind_new" USING ("kind"::text::"Kind_new");
ALTER TYPE "Kind" RENAME TO "Kind_old";
ALTER TYPE "Kind_new" RENAME TO "Kind";
DROP TYPE "Kind_old";
ALTER TABLE "Org" ALTER COLUMN "kind" SET DEFAULT 'A';
COMMIT;
`,
  rename: '-- AlterTable\nALTER TABLE "Item" DROP COLUMN "label",\nADD COLUMN     "title" TEXT NOT NULL;\n',
  pkChange: `-- AlterTable
ALTER TABLE "Item" DROP CONSTRAINT "Item_pkey",
DROP COLUMN "label",
ADD COLUMN     "label2" TEXT NOT NULL,
ADD CONSTRAINT "Item_pkey" PRIMARY KEY ("label2");
`,
  dropSequence: '-- AlterTable\nALTER TABLE "Item" ALTER COLUMN "id" DROP DEFAULT;\nDROP SEQUENCE "Item_id_seq";\n',
  qualified: 'ALTER TABLE "org_wct"."Document" DROP COLUMN "x";\nDROP INDEX "org_wct"."Document_x_idx";\n',
  unknown: 'TRUNCATE "Org";\n',
};

test('empty migration is empty and passes', () => {
  const c = classify(FIX.empty);
  assert.equal(c.empty, true);
  assert.deepEqual(c.destructive, []);
});

for (const name of ['newTable', 'addNullableAndDefault', 'newIndex', 'trgmIndex', 'enumAdd', 'fkChange', 'relax', 'renameIndex', 'extension']) {
  test(`additive passes: ${name}`, () => {
    const c = classify(FIX[name]);
    assert.equal(c.empty, false);
    assert.deepEqual(c.destructive, [], JSON.stringify(c.destructive));
  });
}

test('quoted semicolons/commas do not split statements', () => {
  assert.equal(splitStatements(FIX.newTable).length, 3);
});

test('unique index on an existing table warns (not blocks); on a new table it does not', () => {
  assert.equal(classify(FIX.newTable).warnings.length, 0);
  const c = classify('CREATE UNIQUE INDEX "Org_code_key" ON "Org"("code");');
  assert.deepEqual(c.destructive, []);
  assert.equal(c.warnings.length, 1);
});

const expectBlocked = {
  dropColumn: ['DROP_COLUMN Org.note'],
  dropIndex: ['DROP_INDEX Org_qty_idx'],
  dropUnique: ['DROP_INDEX Org_name_key'],
  typeChange: ['ALTER_COLUMN_TYPE Org.qty'],
  setNotNull: ['SET_NOT_NULL Org.qty'],
  addRequired: ['ADD_REQUIRED_COLUMN Org.extra'],
  dropTable: ['DROP_TABLE Item'],
  enumRemove: ['ALTER_COLUMN_TYPE Org.kind', 'DROP_TYPE Kind_old'],
  rename: ['DROP_COLUMN Item.label', 'ADD_REQUIRED_COLUMN Item.title'],
  pkChange: ['DROP_CONSTRAINT Item.Item_pkey', 'DROP_COLUMN Item.label', 'ADD_REQUIRED_COLUMN Item.label2'],
  dropSequence: ['DROP_OTHER SEQUENCE Item_id_seq'],
  qualified: ['DROP_COLUMN Document.x', 'DROP_INDEX Document_x_idx'],
  unknown: ['STATEMENT TRUNCATE "Org"'],
};
for (const [name, want] of Object.entries(expectBlocked)) {
  test(`destructive blocks: ${name}`, () => assert.deepEqual(keys(FIX[name]), want));
}

test('ADD COLUMN NOT NULL inside a table created in the same diff is fine', () => {
  const sql = 'CREATE TABLE "T" ("id" TEXT NOT NULL);\nALTER TABLE "T" ADD COLUMN "x" TEXT NOT NULL;';
  assert.deepEqual(keys(sql), []);
});

test('non-FK named constraint drop blocks; unknown ALTER TABLE clause blocks', () => {
  assert.deepEqual(keys('ALTER TABLE "Org" DROP CONSTRAINT "Org_code_unique";'), ['DROP_CONSTRAINT Org.Org_code_unique']);
  assert.deepEqual(keys('ALTER TABLE "Org" RENAME COLUMN "a" TO "b";'), ['STATEMENT ALTER TABLE Org RENAME COLUMN "a" TO "b"']);
});

test('unparseable SQL throws (caller fails the build)', () => {
  assert.throws(() => classify('CREATE FUNCTION f() RETURNS int AS $$ select 1; $$ LANGUAGE sql;'));
  assert.throws(() => classify('ALTER TABLE "Org" ADD COLUMN "x" TEXT DEFAULT \'oops;'));
  assert.throws(() => classify('/* never closed'));
});

test('allowlist: exact keys allow, others still block, schema scoping, comments', () => {
  const { entries, errors } = parseAllowlist([
    '# header comment',
    '',
    'DROP_COLUMN Org.note   # intended, moved to profile',
    'drop_index Org_qty_idx @org_wct',
    'STATEMENT   TRUNCATE   "Org"',
  ].join('\n'));
  assert.deepEqual(errors, []);
  assert.equal(entries.length, 3);

  const d = classify(FIX.dropColumn + FIX.dropIndex + FIX.dropUnique + FIX.unknown).destructive;
  const inWct = applyAllowlist(d, entries, 'org_wct');
  assert.deepEqual(inWct.allowed.map((a) => a.key), ['DROP_COLUMN Org.note', 'DROP_INDEX Org_qty_idx', 'STATEMENT TRUNCATE "Org"']);
  assert.deepEqual(inWct.blocked.map((a) => a.key), ['DROP_INDEX Org_name_key']);

  const elsewhere = applyAllowlist(d, entries, 'org_biofuel');
  assert.deepEqual(elsewhere.blocked.map((a) => a.key), ['DROP_INDEX Org_qty_idx', 'DROP_INDEX Org_name_key']);
  const legacy = applyAllowlist(d, entries, null);
  assert.ok(legacy.blocked.some((b) => b.key === 'DROP_INDEX Org_qty_idx'), 'schema-scoped entry must not apply to the single-schema push');
});

test('allowlist: everything allowed → nothing blocked; malformed lines reported', () => {
  const { entries } = parseAllowlist('DROP_COLUMN Item.label\nADD_REQUIRED_COLUMN Item.title\n');
  assert.equal(applyAllowlist(classify(FIX.rename).destructive, entries).blocked.length, 0);
  assert.equal(parseAllowlist('DROPCOLUMN Org.x\njustonetoken\n').errors.length, 2);
});

test('the shipped allowlist file has no entries', () => {
  const fs = require('fs');
  const path = require('path');
  const r = parseAllowlist(fs.readFileSync(path.join(__dirname, '..', '..', 'prisma', 'allow-destructive.txt'), 'utf8'));
  assert.deepEqual(r, { entries: [], errors: [] });
});

test('scrub masks connection strings and given secrets', () => {
  const out = scrub("Can't reach postgresql://u:pw123@ep-x.neon.tech/db?sslmode=require at `ep-x.neon.tech`", ['ep-x.neon.tech', 'pw123']);
  assert.ok(!out.includes('pw123') && !out.includes('ep-x.neon.tech'), out);
});
