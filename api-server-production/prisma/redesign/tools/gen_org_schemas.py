# Moved from a session scratchpad 2026-09-28. Run: python3 prisma/redesign/tools/gen_org_schemas.py && python3 prisma/redesign/tools/gen_org_sql.py (from api-server-production/)
# Full schema-per-org redesign (DRY RUN). Every org gets its OWN complete schema + its OWN Prisma file.
# Only identity/routing stays global (platform). Legacy tables are not copied.
import re, json, os, shutil, subprocess
API = '/Users/guru/Documents/GitHub/aims/api-server-production'
OUT = API + '/prisma/redesign'
SRC = open(API + '/prisma/schema.prisma').read()

PLATFORM = """Organization UserOrganization OrganizationModule OrganizationUIConfig ApiKey
  DocumentTemplate OrganizationActiveTemplate OrganizationMemberProfile DeviceToken WhatsAppConnection WhatsAppWebhookEvent
  OperatorIdentity OperatorLinkCode OperatorSession ActionLog""".split()
LEGACY = 'Bill Transaction CustomerBalance ImportInvoice PassTrackerEntry'.split()
MODULES = {
 'base': 'Role UserRole Permission Customer Supplier CustomField CustomFieldValue UserDashboardLayout Notification AuditLog EmailIngestConfig EmailIngestLog',
 'accounting': """ChartOfAccount JournalEntry JournalEntryLine AccountingSetting TaxRate CostCenter Budget FixedAsset DepreciationEntry
   RecurringJournalTemplate AccountMemory BankStatementImport BankStatementLine BankStatementMatch XeroConnection XeroAccountMapping XeroSyncRun""",
 'stock': 'Asset Category Inventory QuantityAdjustment',
 'documents': """Document DocumentLine DocumentItem DocumentNumberFormat DocumentShareLink DocumentSignLink DocumentEmbedding SubmitJob Order
   RevenueItem PriceHistory AssetTemplateTag TimelineItem Payment BillPayment RecurringInvoiceTemplate""",
 'projects': 'Project',
 'contacts': 'SiteOffice ContactDetail CustomerContact ProjectContact CustomerInfoRequest CustomerInfoContact',
 'rental': 'ProjectDeployment Assignment',
 'field': 'Delivery DeliveryItem DeliveryShareLink MaintenanceServiceReport DeliveryLocationPing MaintenanceSchedule',
 'interior': 'Lead LeadAttachment ProjectCost ProjectMilestone ProjectQuestStep ProjectScheduleItem ProjectShareLink QuestMediaRequest SupplierRebate Team WorkSection',
 'comms': 'WhatsAppMessage WhatsAppQnA WhatsAppAgentConfig WhatsAppSuggestion WhatsAppScheduledMessage WhatsAppContact WhatsAppAppointment AdAccountConnection AdInsight',
}
MODULES = {k: v.split() for k, v in MODULES.items()}
CIEL_PROJECT = 'designer designerUserId stage commissionPct rebatePct source leadId'.split()
HVAC_ASSET = 'capacityKw accessoryIds accessoryOptionIds points'.split()
WORK_ITEM = 'workSectionId descriptionTemplate includes unitCost uom pricingMode supplierName'.split()
STD_DROPS = {'Project': CIEL_PROJECT, 'Asset': HVAC_ASSET, 'RevenueItem': WORK_ITEM}
ORGS = {
 # slug: (name ILIKE pattern, modules, excluded models, dropped columns {model: [fields]})
 'biofuel':   ("Biofuel%",            ['base','accounting','stock','documents','projects','contacts','rental','field','comms'], [], STD_DROPS),
 'ciel':      ("CIEL%",               ['base','accounting','documents','projects','interior','comms'], [],
               {'Project': ['customerPoNumber', 'siteOfficeId']}),
 'cappitech': ("Cappitech%",          ['base','accounting','stock','documents'], [], {'RevenueItem': WORK_ITEM}),
 'osiris':    ("Osiris Technology%",  ['base','accounting','stock','documents','projects','field','comms'], [], STD_DROPS),
 'yourworld': ("%your%world%",        ['base','accounting'], [], {}),
 'u2can':     ("U2CAN%",              ['base','accounting'], [], {}),
 'platformorg': ("osiris-platform%",  ['base','accounting','documents'], [], {'RevenueItem': WORK_ITEM}),
}
NEW_COLS = {'Document': ['customerId', 'supplierId']}   # new, not in public → not copied (backfilled later)

blocks = dict(re.findall(r'^(model \w+ \{.*?^\})', SRC, re.S | re.M) and
              [(re.match(r'model (\w+)', b).group(1), b) for b in re.findall(r'^(model \w+ \{.*?^\})', SRC, re.S | re.M)])
enum_blocks = {re.search(r'enum (\w+)', b).group(1): b for b in re.findall(r'^((?:///[^\n]*\n)*enum \w+ \{.*?^\})', SRC, re.S | re.M)}
ENUMS = set(enum_blocks)
allm = set(blocks)
assigned = set(PLATFORM) | set(LEGACY) | {m for v in MODULES.values() for m in v}
assert (allm | {'DocumentLine'}) == assigned, (allm | {'DocumentLine'}) ^ assigned

# Document gets real party columns + lines (additive)
blocks['Document'] = blocks['Document'].rstrip('}').rstrip() + '''

  // NEW: party as real columns (backfilled from config after the copy)
  customerId String?   @db.Uuid
  supplierId String?   @db.Uuid
  customer   Customer? @relation("DocumentCustomer", fields: [customerId], references: [id])
  supplier   Supplier? @relation("DocumentSupplier", fields: [supplierId], references: [id])
  lines      DocumentLine[]
}'''
for m, f in [('Customer', 'documents Document[] @relation("DocumentCustomer")'), ('Supplier', 'documents Document[] @relation("DocumentSupplier")'),
             ('Asset', 'documentLines2 DocumentLine[]'), ('Inventory', 'documentLines2 DocumentLine[]'), ('RevenueItem', 'documentLines DocumentLine[]'),
             ('ChartOfAccount', 'documentLines DocumentLine[]'), ('TaxRate', 'documentLines DocumentLine[]'), ('CostCenter', 'documentLines DocumentLine[]')]:
    blocks[m] = blocks[m].rstrip('}').rstrip() + f'\n  {f}\n}}'
blocks['DocumentLine'] = '''/// NEW: every document line, services included. config.items[] becomes a render snapshot of it.
model DocumentLine {
  id            String   @id @default(uuid()) @db.Uuid
  documentId    String   @db.Uuid
  lineNumber    Int
  kind          String   @default("PRODUCT") // PRODUCT | SERVICE | TEXT | SECTION
  description   String?
  quantity      Decimal  @default(0) @db.Decimal(18, 4)
  uom           String?
  unitPrice     Decimal  @default(0) @db.Decimal(18, 4)
  discount      Decimal  @default(0) @db.Decimal(18, 2)
  amount        Decimal  @default(0) @db.Decimal(18, 2)
  taxAmount     Decimal  @default(0) @db.Decimal(18, 2)
  isFixedAsset  Boolean  @default(false)
  assetId       String?  @db.Uuid
  inventoryId   String?  @db.Uuid
  revenueItemId String?
  accountId     String?
  taxRateId     String?
  costCenterId  String?
  sectionId     String? // WorkSection (interior orgs)
  createdAt     DateTime @default(now())
  updatedAt     DateTime @updatedAt
  document    Document        @relation(fields: [documentId], references: [id], onDelete: Cascade)
  asset       Asset?          @relation(fields: [assetId], references: [id])
  inventory   Inventory?      @relation(fields: [inventoryId], references: [id])
  revenueItem RevenueItem?    @relation(fields: [revenueItemId], references: [id])
  account     ChartOfAccount? @relation(fields: [accountId], references: [id])
  taxRate     TaxRate?        @relation(fields: [taxRateId], references: [id])
  costCenter  CostCenter?     @relation(fields: [costCenterId], references: [id])
  @@unique([documentId, lineNumber])
  @@index([assetId])
  @@index([accountId])
}'''
PLATFORM_NEW = '''
/// NEW: local mirror of Clerk users (id = Clerk user id).
model User {
  id         String    @id
  email      String?
  name       String?
  imageUrl   String?
  lastSeenAt DateTime?
  createdAt  DateTime  @default(now())
  updatedAt  DateTime  @updatedAt
}

/// NEW: which Postgres schema holds each org's data, and which Prisma client (org file) reads it.
model OrgTenant {
  organizationId String   @id
  schemaName     String   @unique // org_biofuel, org_ciel, …
  prismaFile     String // orgs/biofuel.prisma, …
  status         String   @default("ACTIVE") // PROVISIONING | ACTIVE | MIGRATING | ARCHIVED
  createdAt      DateTime @default(now())
  updatedAt      DateTime @updatedAt
}

/// NEW: routes a public token (pay / sign / delivery / share / customer-info link) to its org
/// before any org schema is known. Written alongside the token row in the org schema.
model PublicToken {
  token          String   @id
  kind           String // DELIVERY | DOCUMENT | SIGN | PROJECT | CUSTOMER_INFO | PAY
  organizationId String
  createdAt      DateTime @default(now())
  @@index([organizationId])
}
'''

REL = re.compile(r'^\s*(\w+)\s+(\w+)(\[\]|\?)?\s*(.*)$')
def scalar_types():
    return {'String', 'Int', 'Float', 'Boolean', 'DateTime', 'Json', 'Decimal', 'BigInt', 'Bytes'} | ENUMS
SCALARS = scalar_types()

def compose(model_names, drops):
    """Return {model: text} with dropped columns removed and relations to absent models stripped."""
    out = {}
    for m in model_names:
        b = blocks[m]
        lines = b.split('\n'); keep = []
        dropped = set(drops.get(m, []))
        for ln in lines:
            s = ln.strip()
            if s.startswith('@@'):
                cols = re.findall(r'\[([^\]]*)\]', s)
                used = {c.strip().split('(')[0] for grp in cols for c in grp.split(',')}
                if used & dropped: continue
                keep.append(ln); continue
            mm = REL.match(ln)
            if mm and not s.startswith('//') and not s.startswith('model ') and mm.group(1) not in ('id',):
                f, t = mm.group(1), mm.group(2)
                if f in dropped: continue
                if t not in SCALARS and t[0].isupper():
                    if t not in model_names: continue            # relation to a model this org doesn't have
                    fr = re.search(r'fields:\s*\[([^\]]*)\]', s)
                    if fr and {x.strip() for x in fr.group(1).split(',')} & dropped: continue
            keep.append(ln)
        out[m] = '\n'.join(keep)
    # drop back-relations whose forward side was removed (e.g. Project.siteOffice gone → SiteOffice.projects)
    fwd = {}
    for m, b in out.items():
        for ln in b.split('\n'):
            mm = REL.match(ln); s = ln.strip()
            if mm and '@relation' in s and 'fields:' in s:
                name = re.search(r'@relation\("([^"]+)"', s)
                fwd.setdefault((m, mm.group(2)), set()).add(name.group(1) if name else '')
    for m in list(out):
        keep = []
        for ln in out[m].split('\n'):
            mm = REL.match(ln); s = ln.strip()
            if mm and mm.group(2) in out and 'fields:' not in s and not s.startswith('//') and not s.startswith('@@') and mm.group(2)[0].isupper() and mm.group(2) not in SCALARS:
                name = re.search(r'@relation\("([^"]+)"', s); nm = name.group(1) if name else ''
                m2m = mm.group(3) == '[]' and re.search(r'^\s*\w+\s+' + m + r'\[\]', out[mm.group(2)], re.M)
                if not m2m and nm not in fwd.get((mm.group(2), m), set()) and not (mm.group(2) == m): continue
            keep.append(ln)
        out[m] = '\n'.join(keep)
    return out

def header(client):
    return f'''// ⚠ REDESIGN DRY RUN — generated from prisma/schema.prisma. NOT used by the app. Do not db push.
generator client {{
  provider        = "prisma-client-js"
  previewFeatures = ["driverAdapters", "postgresqlExtensions"]
  output          = "../generated/{client}"
}}

datasource db {{
  provider   = "postgresql"
  url        = env("DATABASE_URL")
  extensions = [pg_trgm]
}}
'''

for sub in ('orgs', 'sql'):                      # regenerate generated parts only; README is kept
    if os.path.exists(OUT + '/' + sub): shutil.rmtree(OUT + '/' + sub)
os.makedirs(OUT + '/orgs', exist_ok=True); os.makedirs(OUT + '/sql', exist_ok=True)
summary = {}
# ---- platform ----
pm = compose(PLATFORM, {})
open(OUT + '/platform.prisma', 'w').write(header('platform') + '\n' + '\n\n'.join(pm[m] for m in PLATFORM) + '\n' + PLATFORM_NEW)
# ---- orgs ----
for slug, (pat, mods, excl, drops) in ORGS.items():
    names = [m for md in mods for m in MODULES[md] if m not in excl]
    comp = compose(names, drops)
    used_enums = sorted(e for e in ENUMS if re.search(r'\s' + e + r'(\?|\[\])?\s', '\n'.join(comp.values())))
    txt = header(f'org-{slug}') + '\n' + '\n\n'.join(enum_blocks[e] for e in used_enums) + '\n\n' + '\n\n'.join(comp[m] for m in names) + '\n'
    open(OUT + f'/orgs/{slug}.prisma', 'w').write(txt)
    summary[slug] = {'pattern': pat, 'modules': mods, 'models': names, 'excluded': excl, 'dropped': drops}
json.dump({'platform': PLATFORM + ['User', 'OrgTenant', 'PublicToken'], 'legacy': LEGACY, 'modules': MODULES, 'orgs': summary},
          open(OUT + '/modules.json', 'w'), indent=1)
print('files written')
