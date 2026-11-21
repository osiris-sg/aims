/** The org's FieldSettings row (SiteClock Company rule columns), created with SiteClock's defaults when missing. */
export async function fieldSettings(db: any, organizationId: string) {
  const s = await db.fieldSettings.findUnique({ where: { organizationId } });
  if (s) return s;
  return db.fieldSettings.upsert({ where: { organizationId }, update: {}, create: { organizationId } });
}
