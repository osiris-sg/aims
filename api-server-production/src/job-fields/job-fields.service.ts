import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../common/prisma.service';
import { runAsOrg } from '../common/tenancy/tenant-context';
import { JOB_ENTITY, JOB_FIELD_ICONS, JOB_FIELD_TYPES, cleanDisplay, fieldNameFor, isJobFieldType, isJobFieldsEnabled, jobFieldDefs } from '../deliveries/job-fields';
import { JOB_CATEGORY_FIELD, cleanCategoryOptions, jobCategoryDef } from '../deliveries/job-category';

/**
 * Custom job fields (enableJobFields, 2026-11-01): the org admin's "Job fields"
 * settings. Stored on CustomField (entityType 'Delivery'); a removed field is
 * deactivated, never deleted, so the values already on jobs stay readable.
 */
@Injectable()
export class JobFieldsService {
  constructor(private readonly prisma: PrismaService) {}

  private async assertEnabled(organizationId: string) {
    if (!(await isJobFieldsEnabled(this.prisma, organizationId))) throw new BadRequestException('Job fields are not enabled for this organisation');
  }

  async list(organizationId: string) {
    const enabled = await isJobFieldsEnabled(this.prisma, organizationId);
    // Job category (WCT group): its list, only for an org that has the job_category field (else null: nothing shown).
    const category = enabled ? await jobCategoryDef(this.prisma, organizationId) : null;
    return { enabled, fields: enabled ? await jobFieldDefs(this.prisma, organizationId) : [], types: JOB_FIELD_TYPES, icons: JOB_FIELD_ICONS, category };
  }

  /** Job category: replace the org's list (order kept; the first is the default). Only where the field exists. */
  async updateCategory(organizationId: string, body: { options?: unknown }) {
    await this.assertEnabled(organizationId);
    const def = await jobCategoryDef(this.prisma, organizationId);
    if (!def) throw new NotFoundException('Job category is not set up for this organisation');
    const options = cleanCategoryOptions(body?.options);
    await runAsOrg(organizationId, () =>
      this.prisma.customField.update({
        where: { id: def.id },
        data: { options: options.map((o) => ({ value: o, label: o })) as any, defaultValue: options[0] },
      }),
    );
    return jobCategoryDef(this.prisma, organizationId);
  }

  async create(organizationId: string, body: { displayLabel?: string; fieldType?: string; required?: boolean; display?: any }) {
    await this.assertEnabled(organizationId);
    const label = String(body.displayLabel || '').trim();
    if (!label) throw new BadRequestException('Give the field a name');
    if (!isJobFieldType(body.fieldType)) throw new BadRequestException(`Type must be one of: ${JOB_FIELD_TYPES.join(', ')}`);
    return runAsOrg(organizationId, async () => {
      const base = fieldNameFor(label);
      if (base === JOB_CATEGORY_FIELD) throw new BadRequestException('Job category has its own list on this page');
      // A deactivated field with the same name comes back instead of a second row.
      const same = await this.prisma.customField.findFirst({ where: { organizationId, entityType: JOB_ENTITY, fieldName: base }, select: { id: true, isActive: true, fieldType: true } });
      if (same && same.isActive) throw new BadRequestException(`There is already a job field called "${label}"`);
      const top = await this.prisma.customField.findFirst({ where: { organizationId, entityType: JOB_ENTITY }, orderBy: { sortOrder: 'desc' }, select: { sortOrder: true } });
      const data = {
        displayLabel: label,
        fieldType: body.fieldType as string,
        required: body.required === true,
        display: cleanDisplay(body.display) as any,
        isActive: true,
        showInForm: true,
        sortOrder: (top?.sortOrder ?? 0) + 1,
      };
      if (same) return this.prisma.customField.update({ where: { id: same.id }, data });
      return this.prisma.customField.create({ data: { organizationId, entityType: JOB_ENTITY, fieldName: base, ...data } });
    });
  }

  async update(organizationId: string, id: string, body: { displayLabel?: string; required?: boolean; display?: any; sortOrder?: number }) {
    await this.assertEnabled(organizationId);
    return runAsOrg(organizationId, async () => {
      const field = await this.prisma.customField.findFirst({ where: { id, organizationId, entityType: JOB_ENTITY, isActive: true, fieldName: { not: JOB_CATEGORY_FIELD } }, select: { id: true } });
      if (!field) throw new NotFoundException('Job field not found');
      const label = body.displayLabel !== undefined ? String(body.displayLabel).trim() : undefined;
      if (label === '') throw new BadRequestException('Give the field a name');
      return this.prisma.customField.update({
        where: { id },
        data: {
          ...(label ? { displayLabel: label } : {}),
          ...(body.required !== undefined ? { required: body.required === true } : {}),
          ...(body.display !== undefined ? { display: cleanDisplay(body.display) as any } : {}),
          ...(typeof body.sortOrder === 'number' ? { sortOrder: Math.round(body.sortOrder) } : {}),
        },
      });
    });
  }

  async remove(organizationId: string, id: string) {
    await this.assertEnabled(organizationId);
    return runAsOrg(organizationId, async () => {
      const field = await this.prisma.customField.findFirst({ where: { id, organizationId, entityType: JOB_ENTITY, fieldName: { not: JOB_CATEGORY_FIELD } }, select: { id: true } });
      if (!field) throw new NotFoundException('Job field not found');
      await this.prisma.customField.update({ where: { id }, data: { isActive: false } });
      return { id, removed: true };
    });
  }
}
