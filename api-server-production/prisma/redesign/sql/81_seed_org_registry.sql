-- 81 · Seed the org → schema registry (after platform.prisma is pushed, creating platform."OrgTenant").
INSERT INTO platform."OrgTenant" ("organizationId", "schemaName", "prismaFile", "updatedAt")
SELECT o.id, v.s, v.f, now() FROM platform."Organization" o JOIN (VALUES
  ('Biofuel%', 'org_biofuel', 'orgs/biofuel.prisma'),
  ('CIEL%', 'org_ciel', 'orgs/ciel.prisma'),
  ('Cappitech%', 'org_cappitech', 'orgs/cappitech.prisma'),
  ('Osiris Technology%', 'org_osiris', 'orgs/osiris.prisma'),
  ('%your%world%', 'org_yourworld', 'orgs/yourworld.prisma'),
  ('U2CAN%', 'org_u2can', 'orgs/u2can.prisma'),
  ('osiris-platform%', 'org_platformorg', 'orgs/platformorg.prisma')
) AS v(p, s, f) ON o.name ILIKE v.p
ON CONFLICT ("organizationId") DO NOTHING;
