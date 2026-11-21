/**
 * The org's FieldSettings row (SiteClock Company rule columns). Made with SiteClock's defaults when missing, together
 * with the company-wide OT rule (528 min, x1.5) and break rule (60 min after 360, NLB credit 0) that SiteClock creates
 * with every company (lib/companyDefaults.ts), so the engine computes the same numbers from day one.
 */
export async function fieldSettings(db: any, organizationId: string) {
  const s = await db.fieldSettings.findUnique({ where: { organizationId } });
  if (s) return s;
  const made = await db.fieldSettings.upsert({ where: { organizationId }, update: {}, create: { organizationId } });
  if (!(await db.fieldOvertimeRule.count({ where: { organizationId, siteId: null } }))) await db.fieldOvertimeRule.create({ data: { organizationId, siteId: null } });
  if (!(await db.fieldBreakRule.count({ where: { organizationId, siteId: null } }))) await db.fieldBreakRule.create({ data: { organizationId, siteId: null } });
  return made;
}
