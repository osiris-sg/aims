import { BadRequestException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from 'src/common/prisma.service';
import { isOrgFeatureEnabled } from 'src/common/org-features';
import { DocumentActor, DocumentsService } from 'src/documents/documents.service';
import {
  CATEGORY_KEY,
  QUOTATION_TEMPLATES_FLAG,
  QUOTATION_TYPES,
  cleanName,
  cleanText,
  linesToItems,
  sanitizeLines,
  templateTotals,
} from './quotation-template-lines';

export type TemplateActor = { id?: string | null; name?: string | null; email?: string | null };

/**
 * QUOTATION TEMPLATES (2026-11-18, WCT group; features.enableQuotationTemplates,
 * default off). A per-org, named set of quotation lines (+ optional Subject,
 * Category, T&Cs) that starts a new draft quotation: "+ Add" arrow > Create
 * from template > Use. Separate from the PDF layout templates (DocumentTemplate).
 *
 * Every read and write is scoped by organizationId: another org's template id
 * is "not found". Delete hides the row (hiddenAt), it is never removed. "Use"
 * goes through DocumentsService.createBasicDocument, the same path (numbering,
 * org defaults, document history) as the editor's Add.
 *
 * The table is reached through `(prisma as any).quotationTemplate` so this
 * module compiles against a Prisma client generated before the model existed.
 */
@Injectable()
export class QuotationTemplatesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly documents: DocumentsService,
  ) {}

  private get repo(): any {
    return (this.prisma as any).quotationTemplate;
  }

  async assertEnabled(organizationId: string) {
    if (!organizationId) throw new ForbiddenException('No organisation');
    if (!(await isOrgFeatureEnabled(this.prisma as any, organizationId, QUOTATION_TEMPLATES_FLAG))) {
      throw new ForbiddenException('Quotation templates are not enabled for this organisation');
    }
  }

  private view(row: any) {
    const { lineCount, total } = templateTotals(row.lines);
    return {
      id: row.id,
      name: row.name,
      lines: Array.isArray(row.lines) ? row.lines : [],
      subject: row.subject ?? null,
      category: row.category ?? null,
      termsAndConditions: row.termsAndConditions ?? null,
      lineCount,
      total,
      createdByName: row.createdByName ?? null,
      createdAt: row.createdAt,
      updatedAt: row.updatedAt,
    };
  }

  private async findVisible(id: string, organizationId: string) {
    const row = id ? await this.repo.findFirst({ where: { id, organizationId, hiddenAt: null } }) : null;
    if (!row) throw new NotFoundException('Template not found');
    return row;
  }

  private async assertNameFree(organizationId: string, name: string, exceptId?: string) {
    const clash = await this.repo.findFirst({
      where: { organizationId, hiddenAt: null, name: { equals: name, mode: 'insensitive' }, ...(exceptId ? { NOT: { id: exceptId } } : {}) },
      select: { id: true },
    });
    if (clash) throw new BadRequestException('A template with this name already exists');
  }

  async list(organizationId: string) {
    await this.assertEnabled(organizationId);
    const rows = await this.repo.findMany({ where: { organizationId, hiddenAt: null }, orderBy: { name: 'asc' } });
    return rows.map((r: any) => this.view(r));
  }

  async get(id: string, organizationId: string) {
    await this.assertEnabled(organizationId);
    return this.view(await this.findVisible(id, organizationId));
  }

  /** New template, or "Save as template" (the editor sends its current lines). */
  async create(body: any, organizationId: string, actor: TemplateActor = {}) {
    await this.assertEnabled(organizationId);
    const name = cleanName(body?.name);
    if (!name) throw new BadRequestException('Name is required');
    const lines = sanitizeLines(body?.lines);
    if (!lines.length) throw new BadRequestException('Add at least one line');
    await this.assertNameFree(organizationId, name);
    const row = await this.repo.create({
      data: {
        organizationId,
        name,
        lines,
        subject: cleanText(body?.subject, 1000),
        category: cleanText(body?.category, 200),
        termsAndConditions: cleanText(body?.termsAndConditions),
        createdBy: actor.id ?? null,
        createdByName: actor.name || actor.email || null,
        updatedBy: actor.id ?? null,
      },
    });
    return this.view(row);
  }

  /** Edit or rename: only the fields sent change. */
  async update(id: string, body: any, organizationId: string, actor: TemplateActor = {}) {
    await this.assertEnabled(organizationId);
    const row = await this.findVisible(id, organizationId);
    const data: any = { updatedBy: actor.id ?? null };
    if (body && 'name' in body) {
      const name = cleanName(body.name);
      if (!name) throw new BadRequestException('Name is required');
      if (name.toLowerCase() !== String(row.name).toLowerCase()) await this.assertNameFree(organizationId, name, row.id);
      data.name = name;
    }
    if (body && 'lines' in body) {
      const lines = sanitizeLines(body.lines);
      if (!lines.length) throw new BadRequestException('Add at least one line');
      data.lines = lines;
    }
    if (body && 'subject' in body) data.subject = cleanText(body.subject, 1000);
    if (body && 'category' in body) data.category = cleanText(body.category, 200);
    if (body && 'termsAndConditions' in body) data.termsAndConditions = cleanText(body.termsAndConditions);
    const updated = await this.repo.update({ where: { id: row.id }, data });
    return this.view(updated);
  }

  /** Delete = hide (kept for the record). */
  async hide(id: string, organizationId: string, actor: TemplateActor = {}) {
    await this.assertEnabled(organizationId);
    const row = await this.findVisible(id, organizationId);
    await this.repo.update({ where: { id: row.id }, data: { hiddenAt: new Date(), hiddenBy: actor.id ?? null } });
    return { success: true, id: row.id };
  }

  /**
   * "Use": a new draft quotation with the template's lines (and Subject,
   * Category, T&Cs when set), through the normal new-quotation path. Customer
   * and the rest are picked in the editor as usual.
   */
  async use(id: string, body: any, organizationId: string, actor: DocumentActor = {}) {
    await this.assertEnabled(organizationId);
    const row = await this.findVisible(id, organizationId);
    const type = String(body?.type || 'QUOTATION').toUpperCase();
    if (!QUOTATION_TYPES.includes(type)) throw new BadRequestException('Templates start quotations only');
    const documentTemplateId = typeof body?.documentTemplateId === 'string' ? body.documentTemplateId : '';
    if (!documentTemplateId) throw new BadRequestException('documentTemplateId is required');
    const layout = await this.prisma.documentTemplate.findUnique({ where: { id: documentTemplateId }, select: { id: true, type: true } });
    if (!layout || !QUOTATION_TYPES.includes(String(layout.type || '').toUpperCase())) {
      throw new BadRequestException('Not a quotation layout');
    }
    const documentInfo: any = {};
    if (row.subject) documentInfo.subject = row.subject;
    if (row.category) documentInfo[CATEGORY_KEY] = row.category;
    if (row.termsAndConditions) documentInfo.termsAndConditions = row.termsAndConditions;
    const config: any = {
      items: linesToItems(row.lines),
      documentInfo,
      fromQuotationTemplate: { id: row.id, name: row.name },
    };
    if (row.category) config[CATEGORY_KEY] = row.category;
    if (typeof body?.numberFormatId === 'string' && body.numberFormatId) config.numberFormatId = body.numberFormatId;
    const doc = await this.documents.createBasicDocument(documentTemplateId, type, organizationId, config, undefined, actor);
    return { success: true, data: { id: doc.id, type: doc.type, documentTemplateId: doc.documentTemplateId, name: doc.name } };
  }
}
