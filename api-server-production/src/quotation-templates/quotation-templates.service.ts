import { BadRequestException, ConflictException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from 'src/common/prisma.service';
import { isOrgFeatureEnabled } from 'src/common/org-features';
import { DocumentActor, DocumentsService } from 'src/documents/documents.service';
import {
  CATEGORY_KEY,
  QUOTATION_TEMPLATES_FLAG,
  QUOTATION_TYPES,
  cleanName,
  cleanText,
  itemLinesFromEditor,
  lineView,
  nextFreeName,
  storedToItems,
  templateSummary,
} from './quotation-template-lines';

export type TemplateActor = { id?: string | null; name?: string | null; email?: string | null };

/**
 * QUOTATION TEMPLATES (2026-11-18, WCT group; features.enableQuotationTemplates,
 * default off). A per-org, named set of quotation lines (+ Category) that starts
 * a new draft quotation: "Create Quotation" arrow (quotations list) or the
 * editor's "+ Add" arrow > Create from template > Use. Separate from the PDF
 * layout templates (DocumentTemplate).
 *
 * 2026-11-19 rework: made ONLY from a real quotation (⋮ Save as template), the
 * lines kept exactly (quotation-template-lines.ts, format 2). No Subject, T&Cs,
 * customer, dates or Remarks. A name that exists: 409 until the person picks
 * Replace (same template, new lines) or Save as new ("Name (2)"). Editing a
 * template = Use it, change the quotation, Save as template > Replace. Older
 * typed templates still list and Use; their lines with no code are flagged.
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
    const { lineCount, total, unlinked } = templateSummary(row.lines);
    return {
      id: row.id,
      name: row.name,
      // The lines as the list / preview shows them (either stored format).
      lines: (Array.isArray(row.lines) ? row.lines : []).map(lineView),
      category: row.category ?? null,
      lineCount,
      total,
      // Lines with no product / service code (older typed templates only).
      unlinked,
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

  /**
   * "Save as template" from a quotation: body { name, items (the editor's lines), category, onExisting? }.
   * Subject / T&Cs / customer / dates / Remarks are never read. A name in use: 409 { existingId } unless
   * onExisting is 'replace' (that template's lines and Category are replaced) or 'new' (saved as "Name (2)").
   */
  async saveFromQuotation(body: any, organizationId: string, actor: TemplateActor = {}) {
    await this.assertEnabled(organizationId);
    const name = cleanName(body?.name);
    if (!name) throw new BadRequestException('Name is required');
    const lines = itemLinesFromEditor(body?.items);
    if (!lines.length) throw new BadRequestException('The quotation has no lines to save');
    const category = cleanText(body?.category, 200);
    const visible: any[] = await this.repo.findMany({ where: { organizationId, hiddenAt: null }, select: { id: true, name: true } });
    const clash = visible.find((r) => String(r.name).toLowerCase() === name.toLowerCase());
    const mode = body?.onExisting;
    if (clash && mode === 'replace') {
      const updated = await this.repo.update({
        where: { id: clash.id },
        data: { lines, category, subject: null, termsAndConditions: null, updatedBy: actor.id ?? null },
      });
      return { ...this.view(updated), replaced: true };
    }
    if (clash && mode !== 'new') {
      // `data` is what reaches the browser: CustomExceptionFilter sends { success: false, message, data } only.
      const existing = { existingId: clash.id, existingName: clash.name };
      throw new ConflictException({ message: `A template named ${clash.name} already exists`, ...existing, data: existing });
    }
    const finalName = clash ? nextFreeName(name, visible.map((r) => String(r.name))) : name;
    const row = await this.repo.create({
      data: {
        organizationId,
        name: finalName,
        lines,
        category,
        subject: null,
        termsAndConditions: null,
        createdBy: actor.id ?? null,
        createdByName: actor.name || actor.email || null,
        updatedBy: actor.id ?? null,
      },
    });
    return this.view(row);
  }

  /** Rename only (the lines change through Save as template > Replace). */
  async update(id: string, body: any, organizationId: string, actor: TemplateActor = {}) {
    await this.assertEnabled(organizationId);
    const row = await this.findVisible(id, organizationId);
    const name = cleanName(body?.name);
    if (!name) throw new BadRequestException('Name is required');
    if (name.toLowerCase() !== String(row.name).toLowerCase()) await this.assertNameFree(organizationId, name, row.id);
    const updated = await this.repo.update({ where: { id: row.id }, data: { name, updatedBy: actor.id ?? null } });
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
   * "Use": a new draft quotation with the template's lines exactly (fresh row
   * ids) and its Category, through the normal new-quotation path. Never a
   * Subject or T&Cs (an older template's are left behind too). Customer and the
   * rest are picked in the editor as usual.
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
    if (row.category) documentInfo[CATEGORY_KEY] = row.category;
    const config: any = {
      items: storedToItems(row.lines),
      documentInfo,
      fromQuotationTemplate: { id: row.id, name: row.name },
    };
    if (row.category) config[CATEGORY_KEY] = row.category;
    if (typeof body?.numberFormatId === 'string' && body.numberFormatId) config.numberFormatId = body.numberFormatId;
    const doc = await this.documents.createBasicDocument(documentTemplateId, type, organizationId, config, undefined, actor);
    return { success: true, data: { id: doc.id, type: doc.type, documentTemplateId: doc.documentTemplateId, name: doc.name } };
  }
}
