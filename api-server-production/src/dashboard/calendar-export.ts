import { BadRequestException } from '@nestjs/common';
import { runAsOrg } from '../common/tenancy/tenant-context';
import { JOB_ENTITY } from '../deliveries/job-fields';

/**
 * Jobs calendar "Export list" (WCT group, 2026-11-20, enableCalendarStyle): the WhatsApp schedule's header line,
 * editable in Settings > Job fields. The portal builds the text (helpers in calendarModel.ts); only this line is stored.
 *
 * No schema change: a storage-only CustomField (entityType 'Delivery', fieldName 'calendar_export_header',
 * isActive FALSE so job field lists never see it); defaultValue holds the text. No row = the default below.
 */
export const EXPORT_HEADER_FIELD = 'calendar_export_header';
export const DEFAULT_EXPORT_HEADER = "Workers to sign back all DOs & inform in gc if there's no one to sign off";
export const EXPORT_HEADER_MAX = 300;

/** A typed header: one line, trimmed; empty = no header line in the list. */
export function cleanExportHeader(v: unknown): string {
  if (v !== null && v !== undefined && typeof v !== 'string') throw new BadRequestException('The header must be text');
  const s = String(v ?? '').replace(/\s+/g, ' ').trim();
  if (s.length > EXPORT_HEADER_MAX) throw new BadRequestException(`At most ${EXPORT_HEADER_MAX} characters`);
  return s;
}

export async function readExportHeader(prisma: any, organizationId: string): Promise<{ header: string; isDefault: boolean }> {
  const row = await runAsOrg(organizationId, () =>
    prisma.customField.findFirst({ where: { organizationId, entityType: JOB_ENTITY, fieldName: EXPORT_HEADER_FIELD }, select: { defaultValue: true } }),
  );
  if (!row || row.defaultValue === null || row.defaultValue === undefined) return { header: DEFAULT_EXPORT_HEADER, isDefault: true };
  return { header: String(row.defaultValue), isDefault: false };
}

export async function writeExportHeader(prisma: any, organizationId: string, header: string): Promise<void> {
  await runAsOrg(organizationId, async () => {
    const row = await prisma.customField.findFirst({ where: { organizationId, entityType: JOB_ENTITY, fieldName: EXPORT_HEADER_FIELD }, select: { id: true } });
    if (row) {
      await prisma.customField.update({ where: { id: row.id }, data: { defaultValue: header } });
      return;
    }
    await prisma.customField.create({
      data: {
        organizationId,
        entityType: JOB_ENTITY,
        fieldName: EXPORT_HEADER_FIELD,
        displayLabel: 'Calendar export header',
        fieldType: 'text',
        required: false,
        isActive: false,
        showInList: false,
        showInForm: false,
        sortOrder: 0,
        defaultValue: header,
      },
    });
  });
}
