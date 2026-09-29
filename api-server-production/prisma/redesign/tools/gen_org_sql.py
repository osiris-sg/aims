# SQL for the full schema-per-org dry run: per-org create / copy / FKs / rollback, platform move, read-only preflight.
import re, json, subprocess, os
API = '/Users/guru/Documents/GitHub/aims/api-server-production'
OUT = API + '/prisma/redesign'
SRC = open(API + '/prisma/schema.prisma').read()
MJ = json.load(open(OUT + '/modules.json'))
ENUMS = set(re.findall(r'^enum (\w+) \{', SRC, re.M))
SCAL = {'String', 'Int', 'Float', 'Boolean', 'DateTime', 'Json', 'Decimal', 'BigInt', 'Bytes'}
PLATFORM = set(MJ['platform'])
orig = {re.match(r'model (\w+)', b).group(1): b for b in re.findall(r'^(model \w+ \{.*?^\})', SRC, re.S | re.M)}

def fields(block):
    out = []
    for ln in block.split('\n')[1:]:
        s = ln.strip()
        if not s or s.startswith('//') or s.startswith('@@') or s == '}': continue
        m = re.match(r'(\w+)\s+(\w+)(\[\]|\?)?\s*(.*)', s)
        if m: out.append((m.group(1), m.group(2), m.group(3) or '', m.group(4)))
    return out
def has_org(model): return any(f == 'organizationId' for f, *_ in fields(orig[model]))
def rels(model):  # (scalar field, target) for forward relations in the ORIGINAL schema
    r = []
    for f, t, mod, rest in fields(orig[model]):
        fm = re.search(r'fields:\s*\[(\w+)\]', rest)
        if fm and t in orig: r.append((fm.group(1), t))
    return r

def pred(model, alias, orgset, depth=0):
    if model == 'Permission': return 'TRUE'   # global catalogue: every org gets its own full copy
    if has_org(model): return f'{alias}."organizationId" IN {orgset}'
    if depth > 3: return 'FALSE'
    parts = []
    for i, (col, tgt) in enumerate(rels(model)):
        if tgt in PLATFORM: continue
        p = f'p{depth}{i}'
        parts.append(f'EXISTS (SELECT 1 FROM public."{tgt}" {p} WHERE {p}.id = {alias}."{col}" AND {pred(tgt, p, orgset, depth + 1)})')
    return '(' + ' OR '.join(parts) + ')' if parts else 'FALSE'

def diff_from_empty(prisma_file):
    env = dict(os.environ, DATABASE_URL='postgresql://dry:run@localhost:5432/dry')
    r = subprocess.run(['npx', 'prisma', 'migrate', 'diff', '--from-empty', '--to-schema-datamodel', prisma_file, '--script'],
                       capture_output=True, text=True, cwd=OUT, env=env)
    assert r.returncode == 0, r.stderr[-800:]
    return r.stdout

def split_fk(sql):
    stmts = re.split(r'\n(?=-- [A-Z][A-Za-z]+\n)', sql)
    fk = [s for s in stmts if s.startswith('-- AddForeignKey')]
    rest = [s for s in stmts if not s.startswith('-- AddForeignKey')]
    return '\n'.join(rest), '\n'.join(fk)

os.makedirs(OUT + '/sql', exist_ok=True)
pre = []   # preflight parts: (check, item, count-sql)
all_tenant = sorted({m for v in MJ['modules'].values() for m in v} - {'DocumentLine'})
for slug, o in MJ['orgs'].items():
    sch = f'org_{slug}'; d = OUT + f'/sql/{slug}'; os.makedirs(d, exist_ok=True)
    orgset = f"(SELECT id FROM public.\"Organization\" WHERE name ILIKE '{o['pattern']}')"
    ddl = diff_from_empty(f'orgs/{slug}.prisma')
    create, fks = split_fk(ddl)
    head = f'-- {sch} · generated from orgs/{slug}.prisma (DRY RUN). Unqualified names resolve to {sch} via search_path.\n'
    open(d + '/1_create.sql', 'w').write(head + f'-- Creates the schema, its enums, tables and indexes. No foreign keys yet (added after the copy).\n\nBEGIN;\nCREATE SCHEMA IF NOT EXISTS {sch};\nSET LOCAL search_path TO {sch}, public;\n\n' + create + '\nCOMMIT;\n')
    open(d + '/3_foreign_keys.sql', 'w').write(head + '-- Adds every FK. If any copied row points at data that was not copied, this fails and rolls back: that is the integrity check.\n\nBEGIN;\n' + f'SET LOCAL search_path TO {sch}, public;\n\n' + fks + '\nCOMMIT;\n')
    # copy
    org_file = open(OUT + f'/orgs/{slug}.prisma').read()
    ob = {re.match(r'model (\w+)', b).group(1): b for b in re.findall(r'^(model \w+ \{.*?^\})', org_file, re.S | re.M)}
    ins = [f'-- {sch} · copy this org\'s rows out of public (read) into {sch} (write). public is NOT modified.',
           f'-- Org matched by: name ILIKE \'{o["pattern"]}\' (preflight checks it matches exactly one org).', '', 'BEGIN;']
    for m in o['models']:
        if m == 'DocumentLine': continue
        cols = [(f, t) for f, t, mod, rest in fields(ob[m]) if (t in SCAL or t in ENUMS) and f not in {'Document': ['customerId', 'supplierId']}.get(m, [])]
        tgt = ', '.join(f'"{f}"' for f, _ in cols)
        src = ', '.join((f't."{f}"::text::{sch}."{t}"' if t in ENUMS else f't."{f}"') for f, t in cols)
        ins.append(f'INSERT INTO {sch}."{m}" ({tgt})\n  SELECT {src}\n  FROM public."{m}" t\n  WHERE {pred(m, "t", orgset)};\n')
    if 'Role' in o['models']:
        ins.append(f'-- Role ↔ Permission links for this org\'s roles (implicit Prisma join table)\nINSERT INTO {sch}."_PermissionToRole" ("A", "B")\n  SELECT j."A", j."B" FROM public."_PermissionToRole" j JOIN public."Role" r ON r.id = j."B"\n  WHERE r."organizationId" IN {orgset};\n')
    ins += ['COMMIT;']
    open(d + '/2_copy.sql', 'w').write('\n'.join(ins) + '\n')
    open(d + '/9_rollback.sql', 'w').write(f'-- Undo everything for {sch}. public was never modified, so this is the whole rollback.\nDROP SCHEMA IF EXISTS {sch} CASCADE;\n')
    # preflight: data this org has in tables/columns its own schema will NOT get
    for m in all_tenant:
        if m in o['models']: continue
        pre.append(('left behind: table not in org schema', f'{slug} · {m}', f'SELECT count(*) FROM public."{m}" t WHERE {pred(m, "t", orgset)}'))
    for m, cols in o['dropped'].items():
        if m not in o['models']: continue
        for c in cols:
            pre.append(('left behind: column not in org schema', f'{slug} · {m}.{c}',
                        f'SELECT count(*) FROM public."{m}" t WHERE {pred(m, "t", orgset)} AND t."{c}" IS NOT NULL'
                        + (f" AND t.\"{c}\" <> '{{}}'" if c in ('accessoryIds', 'accessoryOptionIds') else '')
                        + (" AND t.\"pricingMode\" <> 'priced'" if c == 'pricingMode' else '')))
    pre.append(('org name pattern must match exactly 1', f"{slug} · ILIKE '{o['pattern']}'",
                f"SELECT abs(count(*) - 1) FROM public.\"Organization\" WHERE name ILIKE '{o['pattern']}'"))
pats = ' OR '.join(f"name ILIKE '{o['pattern']}'" for o in MJ['orgs'].values())
pre.append(('org with no schema planned', 'any', f'SELECT count(*) FROM public."Organization" WHERE NOT ({pats})'))
for m in ('Asset', 'Category', 'Project'):
    pre.append(('row with no org (would not be copied)', m, f'SELECT count(*) FROM public."{m}" WHERE "organizationId" IS NULL'))
for m in MJ['legacy']:
    pre.append(('info: legacy rows stay in public', m, f'SELECT count(*) FROM public."{m}"'))
body = '\n  UNION ALL\n'.join(f"  SELECT '{c}' AS chk, '{i.replace(chr(39), chr(39)*2)}' AS item, ({q})::int AS n" for c, i, q in pre)
open(OUT + '/sql/00_preflight.sql', 'w').write(
    '-- 00 · Preflight. READ-ONLY. One result table; rows that need attention sort first.\n'
    '--   left behind: table/column  → this org has data in a module/column its own schema will not get\n'
    '--   pattern must match 1       → 0 means the org name pattern is wrong\n'
    '--   org with no schema planned → an org exists that has no org file yet\n'
    '--   info: legacy               → informational; legacy tables are archived, not copied\n\n'
    'SELECT * FROM (\n' + body + "\n) x\nORDER BY (chk LIKE 'info%'), n DESC, chk, item;\n")
open(OUT + '/sql/01_org_preview.sql', 'w').write('-- 01 · READ-ONLY: which org lands in which org schema.\nSELECT o.name, CASE ' +
    ' '.join(f"WHEN o.name ILIKE '{v['pattern']}' THEN 'org_{k}'" for k, v in MJ['orgs'].items()) +
    ' END AS org_schema, o.id FROM public."Organization" o ORDER BY 2 NULLS FIRST, 1;\n')
# platform
pl = [m for m in MJ['platform'] if m in orig]
open(OUT + '/sql/80_platform_move.sql', 'w').write('-- 80 · After every org copy + FK step succeeded: move the global tables to "platform". Metadata only.\n'
    'BEGIN;\nCREATE SCHEMA IF NOT EXISTS platform;\n' + '\n'.join(f'ALTER TABLE public."{m}" SET SCHEMA platform;' for m in pl)
    + '\nCOMMIT;\n')
open(OUT + '/sql/80_platform_move.rollback.sql', 'w').write('BEGIN;\n' + '\n'.join(f'ALTER TABLE platform."{m}" SET SCHEMA public;' for m in pl)
    + '\nCOMMIT;\n')
reg = ["-- 81 · Seed the org → schema registry (after platform.prisma is pushed, creating platform.\"OrgTenant\").", 'INSERT INTO platform."OrgTenant" ("organizationId", "schemaName", "prismaFile", "updatedAt")']
reg.append('SELECT o.id, v.s, v.f, now() FROM platform."Organization" o JOIN (VALUES\n' + ',\n'.join(
    f"  ('{v['pattern']}', 'org_{k}', 'orgs/{k}.prisma')" for k, v in MJ['orgs'].items()) + '\n) AS v(p, s, f) ON o.name ILIKE v.p\nON CONFLICT ("organizationId") DO NOTHING;')
open(OUT + '/sql/81_seed_org_registry.sql', 'w').write('\n'.join(reg) + '\n')
print('checks', len(pre))
