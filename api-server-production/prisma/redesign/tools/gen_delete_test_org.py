# Generates scripts/_delete-test-org.sql: count + delete every row belonging to Test Org, children before parents.
import re
API='/Users/guru/Documents/GitHub/aims/api-server-production'
SRC=open(API+'/prisma/schema.prisma').read()
ORG="'7e570e60-0000-4000-8000-7e570e600001'"
KEEP={'ActionLog'}   # activity log deliberately outlives orgs
orig={re.match(r'model (\w+)',b).group(1):b for b in re.findall(r'^(model \w+ \{.*?^\})',SRC,re.S|re.M)}
def fields(b):
    out=[]
    for ln in b.split('\n')[1:]:
        s=ln.strip()
        if not s or s.startswith('//') or s.startswith('@@') or s=='}': continue
        m=re.match(r'(\w+)\s+(\w+)(\[\]|\?)?\s*(.*)',s)
        if m: out.append((m.group(1),m.group(2),m.group(3) or '',m.group(4)))
    return out
def has_org(m): return any(f=='organizationId' for f,*_ in fields(orig[m]))
def rels(m):
    r=[]
    for f,t,mod,rest in fields(orig[m]):
        fm=re.search(r'fields:\s*\[([\w, ]+)\]',rest)
        if fm and t in orig:
            od=re.search(r'onDelete:\s*(\w+)',rest)
            r.append((fm.group(1).split(',')[0].strip(),t,mod=='?',od.group(1) if od else ('SetNull' if mod=='?' else 'Restrict')))
    return r
def pred(m,a,d=0):
    if m=='Organization': return f'{a}.id = {ORG}'
    if has_org(m): return f'{a}."organizationId" = {ORG}'
    if d>3: return 'FALSE'
    ps=[]
    for i,(col,t,opt,od) in enumerate(rels(m)):
        if t=='Permission': continue
        p=f'p{d}{i}'; ps.append(f'EXISTS (SELECT 1 FROM public."{t}" {p} WHERE {p}.id = {a}."{col}" AND {pred(t,p,d+1)})')
    return '('+' OR '.join(ps)+')' if ps else 'FALSE'
# order: a table must be deleted before any table it points at with a blocking (Restrict/NoAction) required FK
models=[m for m in orig if m not in KEEP and m!='Permission']
deps={m:{t for c,t,opt,od in rels(m) if t!=m and t in models} for m in models}
order=[];seen=set()
def visit(m,stack=()):
    if m in seen: return
    if m in stack: return
    for n in models:
        if m in deps[n]: visit(n,stack+(m,))   # children first
    seen.add(m); order.append(m)
for m in models: visit(m)
counts=[f"  SELECT '{m}' AS tbl, count(*)::int AS n FROM public.\"{m}\" t WHERE {pred(m,'t')}" for m in order]
cross=f'''  SELECT 'OTHER orgs activating Test Org templates' AS tbl, count(*)::int FROM public."OrganizationActiveTemplate" a JOIN public."DocumentTemplate" d ON d.id=a."templateId" WHERE d."organizationId"={ORG} AND a."organizationId"<>{ORG}
  UNION ALL SELECT 'OTHER orgs documents using Test Org templates', count(*)::int FROM public."Document" x JOIN public."DocumentTemplate" d ON d.id::text=x."documentTemplateId" WHERE d."organizationId"={ORG} AND x."organizationId"<>{ORG}'''
dels=[f'DELETE FROM public."{m}" t WHERE {pred(m,"t")};' for m in order]
open(API+'/scripts/_delete-test-org.sql','w').write(
 '-- DRY RUN section (read-only): rows that would be deleted, then cross-org blockers (must be 0).\n-- @@COUNTS\nSELECT * FROM (\n'+'\n  UNION ALL\n'.join(counts)+'\n) x WHERE n > 0 ORDER BY n DESC;\n'
 +'-- @@CROSS\nSELECT * FROM (\n'+cross+'\n) y;\n'
 +'-- @@DELETE (children before parents; ActionLog kept on purpose)\n'+'\n'.join(dels)+'\n')
print(len(order),'tables in delete order; last =',order[-1])
