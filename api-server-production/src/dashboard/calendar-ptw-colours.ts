import { runAsOrg } from '../common/tenancy/tenant-context';
import { JOB_ENTITY } from '../deliveries/job-fields';
import { PtwStatusColours, cleanPtwStatusColours } from './calendar-style';

/**
 * Org Settings > Calendar colours (WCT group, 2026-11-25, enableCalendarStyle): the PTW stripe colour per PTW status.
 *
 * No schema change: a storage-only CustomField (entityType 'Delivery', fieldName 'calendar_ptw_colours', isActive
 * FALSE so job field lists never see it); options holds { REQUIRED, SUBMITTED, APPROVED, REJECTED } colours. No row
 * (or an empty map) = no status colours: every stripe keeps its applicant's colour, as before.
 */
export const PTW_COLOURS_FIELD = 'calendar_ptw_colours';

export async function readPtwStatusColours(prisma: any, organizationId: string): Promise<PtwStatusColours> {
  const row = await runAsOrg(organizationId, () =>
    prisma.customField.findFirst({ where: { organizationId, entityType: JOB_ENTITY, fieldName: PTW_COLOURS_FIELD }, select: { options: true } }),
  );
  return cleanPtwStatusColours(row?.options);
}

export async function writePtwStatusColours(prisma: any, organizationId: string, colours: PtwStatusColours): Promise<void> {
  await runAsOrg(organizationId, async () => {
    const row = await prisma.customField.findFirst({ where: { organizationId, entityType: JOB_ENTITY, fieldName: PTW_COLOURS_FIELD }, select: { id: true } });
    if (row) {
      await prisma.customField.update({ where: { id: row.id }, data: { options: colours as any } });
      return;
    }
    await prisma.customField.create({
      data: {
        organizationId,
        entityType: JOB_ENTITY,
        fieldName: PTW_COLOURS_FIELD,
        displayLabel: 'Calendar PTW colours',
        fieldType: 'json',
        required: false,
        isActive: false,
        showInList: false,
        showInForm: false,
        sortOrder: 0,
        options: colours as any,
      },
    });
  });
}
