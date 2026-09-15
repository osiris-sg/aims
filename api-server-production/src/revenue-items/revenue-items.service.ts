import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import Anthropic from '@anthropic-ai/sdk';
import { PrismaService } from '../common/prisma.service';

type ItemDto = {
  code?: string | null;
  name: string;
  type?: string; // PRODUCT | SERVICE
  unitPrice?: number | null;
  taxRate?: number | null;
  accountCode: string;
  isActive?: boolean;
  // Work-library fields (interior-design quotations). All optional — plain
  // services leave them null.
  workSectionId?: string | null;
  descriptionTemplate?: string | null;
  includes?: Array<{ text: string; qty?: number }> | null;
  unitCost?: number | null;
  uom?: string | null;
  pricingMode?: string | null; // priced | inclusive | complimentary
  supplierName?: string | null; // which contractor's price list the cost came from
};

type SectionDto = {
  letter?: string | null;
  title: string;
  defaultNotes?: string[];
  sortOrder?: number;
  isActive?: boolean;
};

@Injectable()
export class RevenueItemsService {
  constructor(private readonly prisma: PrismaService) {}

  async list(organizationId: string, opts?: { type?: string; activeOnly?: boolean; workOnly?: boolean }) {
    // Backfill codes for pre-code services so nothing shows blank on lines.
    const uncoded = await this.prisma.revenueItem.findMany({
      where: { organizationId, OR: [{ code: null }, { code: '' }] },
      select: { id: true },
      orderBy: { createdAt: 'asc' },
    });
    for (const u of uncoded) {
      await this.prisma.revenueItem.update({
        where: { id: u.id },
        data: { code: await this.nextServiceCode(organizationId) },
      });
    }

    const items = await this.prisma.revenueItem.findMany({
      where: {
        organizationId,
        ...(opts?.type ? { type: opts.type.toUpperCase() } : {}),
        ...(opts?.activeOnly ? { isActive: true } : {}),
        ...(opts?.workOnly ? { workSectionId: { not: null } } : {}),
      },
      orderBy: [{ code: 'asc' }, { name: 'asc' }],
    });
    // Attach the GL account name for display (no relation on the model).
    const codes = Array.from(new Set(items.map((i) => i.accountCode).filter(Boolean)));
    const accts = await this.prisma.chartOfAccount.findMany({ where: { organizationId, code: { in: codes } }, select: { code: true, name: true } });
    const nameByCode = new Map(accts.map((a) => [a.code, a.name]));
    // …and the work section (letter + title) for the library views.
    const sectionIds = Array.from(new Set(items.map((i) => i.workSectionId).filter(Boolean))) as string[];
    const sections = sectionIds.length
      ? await this.prisma.workSection.findMany({ where: { organizationId, id: { in: sectionIds } }, select: { id: true, letter: true, title: true, sortOrder: true } })
      : [];
    const sectionById = new Map(sections.map((s) => [s.id, s]));
    return items.map((i) => ({
      ...i,
      accountName: nameByCode.get(i.accountCode) || null,
      workSection: i.workSectionId ? sectionById.get(i.workSectionId) || null : null,
    }));
  }

  private async resolveAccountId(organizationId: string, code?: string | null) {
    if (!code) return null;
    const a = await this.prisma.chartOfAccount.findFirst({ where: { organizationId, code }, select: { id: true } });
    return a?.id ?? null;
  }

  // Next free SV### code (services master). User-supplied codes win; this is
  // the fallback so every service ALWAYS has a code (shows in the document
  // editor's item-code column).
  private async nextServiceCode(organizationId: string): Promise<string> {
    const rows = await this.prisma.revenueItem.findMany({
      where: { organizationId, code: { startsWith: 'SV' } },
      select: { code: true },
    });
    let max = 0;
    for (const r of rows) {
      const m = /^SV(\d+)$/.exec(r.code || '');
      if (m) max = Math.max(max, parseInt(m[1], 10));
    }
    return `SV${String(max + 1).padStart(3, '0')}`;
  }

  // Next free <letter>## code inside a work section (e.g. E07) so library
  // items read naturally on a quotation line.
  private async nextWorkCode(organizationId: string, workSectionId: string): Promise<string> {
    const section = await this.prisma.workSection.findFirst({ where: { id: workSectionId, organizationId }, select: { letter: true } });
    const letter = section?.letter || 'W';
    const rows = await this.prisma.revenueItem.findMany({
      where: { organizationId, workSectionId, code: { startsWith: letter } },
      select: { code: true },
    });
    let max = 0;
    for (const r of rows) {
      const m = new RegExp(`^${letter}(\\d+)$`).exec(r.code || '');
      if (m) max = Math.max(max, parseInt(m[1], 10));
    }
    return `${letter}${String(max + 1).padStart(2, '0')}`;
  }

  private workFields(dto: Partial<ItemDto>) {
    return {
      workSectionId: dto.workSectionId !== undefined ? dto.workSectionId : undefined,
      descriptionTemplate: dto.descriptionTemplate !== undefined ? dto.descriptionTemplate : undefined,
      includes: dto.includes !== undefined ? ((dto.includes ?? Prisma.JsonNull) as Prisma.InputJsonValue) : undefined,
      unitCost: dto.unitCost !== undefined ? dto.unitCost : undefined,
      uom: dto.uom !== undefined ? dto.uom : undefined,
      pricingMode: dto.pricingMode ? dto.pricingMode : undefined,
      supplierName: dto.supplierName !== undefined ? dto.supplierName : undefined,
    };
  }

  async create(organizationId: string, dto: ItemDto) {
    const accountId = await this.resolveAccountId(organizationId, dto.accountCode);
    const code =
      dto.code?.trim() ||
      (dto.workSectionId ? await this.nextWorkCode(organizationId, dto.workSectionId) : await this.nextServiceCode(organizationId));
    return this.prisma.revenueItem.create({
      data: {
        organizationId,
        code,
        name: dto.name,
        type: (dto.type || 'SERVICE').toUpperCase(),
        unitPrice: dto.unitPrice ?? null,
        taxRate: dto.taxRate ?? null,
        accountCode: dto.accountCode,
        accountId,
        isActive: dto.isActive ?? true,
        ...this.workFields(dto),
      },
    });
  }

  async update(organizationId: string, id: string, dto: Partial<ItemDto>) {
    const existing = await this.prisma.revenueItem.findFirst({ where: { id, organizationId } });
    if (!existing) throw new NotFoundException('Revenue item not found');
    const accountId = dto.accountCode !== undefined ? await this.resolveAccountId(organizationId, dto.accountCode) : existing.accountId;
    return this.prisma.revenueItem.update({
      where: { id },
      data: {
        code: dto.code ?? undefined,
        name: dto.name ?? undefined,
        type: dto.type ? dto.type.toUpperCase() : undefined,
        unitPrice: dto.unitPrice !== undefined ? dto.unitPrice : undefined,
        taxRate: dto.taxRate !== undefined ? dto.taxRate : undefined,
        accountCode: dto.accountCode ?? undefined,
        accountId,
        isActive: dto.isActive ?? undefined,
        ...this.workFields(dto),
      },
    });
  }

  async remove(organizationId: string, id: string) {
    await this.prisma.revenueItem.deleteMany({ where: { id, organizationId } });
    return { ok: true };
  }

  // Bulk seed helper (used to pre-populate a master file from a list).
  async bulkUpsert(organizationId: string, items: ItemDto[]) {
    let created = 0;
    let updated = 0;
    for (const dto of items) {
      if (!dto?.name || !dto?.accountCode) continue;
      const existing = dto.code
        ? await this.prisma.revenueItem.findFirst({ where: { organizationId, code: dto.code } })
        : await this.prisma.revenueItem.findFirst({ where: { organizationId, name: dto.name } });
      if (existing) {
        await this.update(organizationId, existing.id, dto);
        updated += 1;
      } else {
        await this.create(organizationId, dto);
        created += 1;
      }
    }
    return { created, updated };
  }

  // ── Contractor price-list import (Work Library, CIEL 09-16) ─────────────
  // Upload a supplier's price list (PDF or photo) → Claude reads it into
  // proposed work items (name, uom, unit COST, trade section). Two-phase:
  // parse returns the proposal for the user to review/edit; apply creates the
  // selected items (creating any new trade sections by title).
  async importPricelist(organizationId: string, body: { file: string; filename?: string; supplierName?: string }) {
    const apiKey = process.env.ANTHROPIC_API_KEY;
    if (!apiKey) throw new BadRequestException('AI is not configured on this server');
    if (!body?.file) throw new BadRequestException('No file provided');
    const headerMatch = body.file.match(/^data:([a-zA-Z/+.-]+);base64,/);
    const mediaType = headerMatch?.[1] || 'application/pdf';
    const data = body.file.slice(body.file.indexOf(',') + 1);
    if (!/pdf|image\//.test(mediaType)) throw new BadRequestException('Upload the price list as a PDF or a photo (JPG/PNG)');

    const sections = await this.listSections(organizationId, true);
    const sectionList = sections.map((s) => `${s.letter ? s.letter + ' · ' : ''}${s.title}`).join('\n') || '(none yet)';
    const system = `You are reading a renovation subcontractor's PRICE LIST for an interior-design firm in Singapore.
Extract every priced line as a work item the firm can reuse on quotations. These are the firm's COSTS (what the contractor charges the firm), not selling prices.

The firm's existing trade sections:
${sectionList}

Rules:
- One item per priced row. Matrix pricing (price varies by property type / room count, e.g. "3 ROOM $2400 · 4 ROOM $2800") becomes SEPARATE items with the variant in the name ("Whole house hacking — 4-room resale").
- "uom" is the unit the price is charged per: sqft, pfr (per foot run), ft, nos, unit, lot, trip, set. A lump/package price is "lot".
- "unitCost" is the numeric price for one uom, GST-exclusive if the list says prices are before GST.
- "section": the best-matching existing section TITLE from the list above (copy it verbatim), or a new short title if none fits.
- "descriptionTemplate": optional fuller quotation-line wording when the row carries detail beyond the name; use {dims} where dimensions would go.
- "includes": optional array of the row's "includes"-style bullets.
- Put global conditions (minimum job size, surcharges, debris/GST exclusions) into "conditions" once — do NOT make items out of them.
- Skip decorative rows, headings and contact details. Cap at 120 items.

Reply with ONLY strict JSON:
{"supplierName":"...","trade":"...","conditions":["..."],"items":[{"name":"...","uom":"...","unitCost":0,"section":"...","descriptionTemplate":null,"includes":[]}]}`;

    const client = new Anthropic({ apiKey });
    const content: any[] = [
      mediaType.includes('pdf')
        ? { type: 'document', source: { type: 'base64', media_type: 'application/pdf', data } }
        : { type: 'image', source: { type: 'base64', media_type: mediaType, data } },
      { type: 'text', text: `Extract the price list${body.supplierName ? ` (supplier: ${body.supplierName})` : ''}${body.filename ? ` from file "${body.filename}"` : ''}.` },
    ];
    const res = await client.messages.create({ model: 'claude-sonnet-5', max_tokens: 20000, system, messages: [{ role: 'user', content }] });
    const textOut = res.content.find((c: any) => c.type === 'text') as any;
    const m = textOut?.text?.match(/\{[\s\S]*\}?/);
    if (!m) throw new BadRequestException('Could not read that price list — try a clearer copy');
    let parsed: any;
    try {
      parsed = JSON.parse(m[0]);
    } catch {
      // Long lists can truncate mid-JSON — salvage by cutting back to the last
      // complete item object and closing the arrays.
      const cut = m[0].lastIndexOf('},');
      try {
        parsed = JSON.parse(m[0].slice(0, cut + 1) + ']}');
      } catch {
        throw new BadRequestException('Could not read that price list — try a clearer copy');
      }
    }
    const items = (Array.isArray(parsed.items) ? parsed.items : [])
      .filter((i: any) => i?.name && Number.isFinite(Number(i.unitCost)))
      .slice(0, 120)
      .map((i: any) => ({
        name: String(i.name).slice(0, 300),
        uom: String(i.uom || 'lot').slice(0, 12),
        unitCost: Math.round(Number(i.unitCost) * 100) / 100,
        section: String(i.section || parsed.trade || 'Miscellaneous').slice(0, 80),
        descriptionTemplate: i.descriptionTemplate ? String(i.descriptionTemplate).slice(0, 1000) : null,
        includes: Array.isArray(i.includes) ? i.includes.map((t: any) => String(t).slice(0, 300)).slice(0, 10) : [],
      }));
    if (!items.length) throw new BadRequestException('No priced rows found in that file');
    const supplierName = body.supplierName?.trim() || String(parsed.supplierName || '').slice(0, 120) || null;

    // Yearly-update detection: if this supplier already has items in the
    // library, diff the new list against them so the user sees what changed
    // and can UPDATE in place instead of duplicating.
    let existing: any = null;
    if (supplierName) {
      const current = await this.prisma.revenueItem.findMany({
        where: { organizationId, workSectionId: { not: null }, isActive: true, supplierName: { equals: supplierName, mode: 'insensitive' } },
        select: { id: true, name: true, unitCost: true, uom: true },
      });
      if (current.length) {
        const norm = (s: string) => s.toLowerCase().replace(/\s+/g, ' ').trim();
        const byName = new Map(current.map((c) => [norm(c.name), c]));
        const priceChanges: any[] = [];
        let unchanged = 0;
        let added = 0;
        const seen = new Set<string>();
        for (const i of items) {
          const match = byName.get(norm(i.name));
          if (match) {
            seen.add(norm(i.name));
            (i as any).currentCost = match.unitCost;
            if (match.unitCost !== i.unitCost) priceChanges.push({ name: i.name, from: match.unitCost, to: i.unitCost });
            else unchanged += 1;
          } else added += 1;
        }
        const missing = current.filter((c) => !seen.has(norm(c.name))).map((c) => c.name);
        existing = { count: current.length, priceChanges: priceChanges.slice(0, 100), added, unchanged, missing: missing.slice(0, 50), missingCount: missing.length };
      }
    }

    return {
      supplierName,
      trade: String(parsed.trade || '').slice(0, 80) || null,
      conditions: Array.isArray(parsed.conditions) ? parsed.conditions.map((c: any) => String(c).slice(0, 300)).slice(0, 15) : [],
      items,
      existing,
    };
  }

  /** Create/update the reviewed items (and any new sections named in them).
   *  mode 'add' creates everything as new; mode 'update' matches this
   *  supplier's existing items by name and updates their cost/uom/wording in
   *  place, creating only genuinely new rows; retireMissing additionally
   *  deactivates the supplier's items that are no longer on the list. */
  async importPricelistApply(
    organizationId: string,
    body: {
      supplierName?: string | null;
      mode?: 'add' | 'update';
      retireMissing?: boolean;
      items: Array<{ name: string; uom?: string; unitCost?: number; unitPrice?: number | null; section?: string; descriptionTemplate?: string | null; includes?: string[] }>;
    },
  ) {
    const rows = (Array.isArray(body?.items) ? body.items : []).filter((i) => i?.name?.trim());
    if (!rows.length) throw new BadRequestException('Nothing to add');
    const norm = (s: string) => s.toLowerCase().replace(/\s+/g, ' ').trim();
    const existingByName = new Map<string, { id: string }>();
    if ((body.mode === 'update' || body.retireMissing) && body.supplierName?.trim()) {
      const current = await this.prisma.revenueItem.findMany({
        where: { organizationId, workSectionId: { not: null }, isActive: true, supplierName: { equals: body.supplierName.trim(), mode: 'insensitive' } },
        select: { id: true, name: true },
      });
      for (const c of current) existingByName.set(norm(c.name), { id: c.id });
    }
    // Default GL account: whatever the existing work items post to.
    const sample = await this.prisma.revenueItem.findFirst({
      where: { organizationId, workSectionId: { not: null } },
      orderBy: { createdAt: 'desc' },
      select: { accountCode: true },
    });
    const accountCode = sample?.accountCode || 'SS001';
    const sections = await this.listSections(organizationId, false);
    const byTitle = new Map(sections.map((s) => [s.title.trim().toLowerCase(), s]));
    let created = 0;
    let updated = 0;
    const newSections: string[] = [];
    const seen = new Set<string>();
    for (const r of rows) {
      const match = body.mode === 'update' ? existingByName.get(norm(r.name)) : undefined;
      if (match) {
        seen.add(norm(r.name));
        await this.update(organizationId, match.id, {
          unitCost: Number.isFinite(Number(r.unitCost)) ? Number(r.unitCost) : null,
          unitPrice: r.unitPrice != null && Number.isFinite(Number(r.unitPrice)) ? Number(r.unitPrice) : undefined,
          uom: r.uom || undefined,
          descriptionTemplate: r.descriptionTemplate || undefined,
          includes: r.includes?.length ? r.includes.filter(Boolean).map((t) => ({ text: String(t) })) : undefined,
          supplierName: body.supplierName?.trim() || undefined,
          isActive: true,
        });
        updated += 1;
        continue;
      }
      const title = (r.section || 'Miscellaneous').trim();
      let section = byTitle.get(title.toLowerCase());
      if (!section) {
        section = await this.createSection(organizationId, { title });
        byTitle.set(title.toLowerCase(), section);
        newSections.push(title);
      }
      await this.create(organizationId, {
        name: r.name.trim(),
        accountCode,
        workSectionId: section.id,
        descriptionTemplate: r.descriptionTemplate || null,
        includes: (r.includes || []).filter(Boolean).map((t) => ({ text: String(t) })),
        unitCost: Number.isFinite(Number(r.unitCost)) ? Number(r.unitCost) : null,
        unitPrice: r.unitPrice != null && Number.isFinite(Number(r.unitPrice)) ? Number(r.unitPrice) : null,
        uom: r.uom || 'lot',
        pricingMode: 'priced',
        supplierName: body.supplierName?.trim() || null,
      });
      created += 1;
    }
    // Items on file for this supplier but absent from the new list — retire
    // (deactivate, never delete: old quotations may reference them).
    let retired = 0;
    if (body.retireMissing) {
      for (const [key, val] of existingByName) {
        if (seen.has(key)) continue;
        await this.prisma.revenueItem.update({ where: { id: val.id }, data: { isActive: false } });
        retired += 1;
      }
    }
    return { created, updated, retired, newSections };
  }

  // ── Work sections (interior-design quotation trade groups) ───────────────
  async listSections(organizationId: string, activeOnly = false) {
    return this.prisma.workSection.findMany({
      where: { organizationId, ...(activeOnly ? { isActive: true } : {}) },
      orderBy: [{ sortOrder: 'asc' }, { letter: 'asc' }],
    });
  }

  async createSection(organizationId: string, dto: SectionDto) {
    const count = await this.prisma.workSection.count({ where: { organizationId } });
    return this.prisma.workSection.create({
      data: {
        organizationId,
        letter: dto.letter?.trim() || String.fromCharCode(65 + Math.min(count, 25)),
        title: dto.title.trim(),
        defaultNotes: dto.defaultNotes ?? [],
        sortOrder: dto.sortOrder ?? count,
        isActive: dto.isActive ?? true,
      },
    });
  }

  async updateSection(organizationId: string, id: string, dto: Partial<SectionDto>) {
    const existing = await this.prisma.workSection.findFirst({ where: { id, organizationId } });
    if (!existing) throw new NotFoundException('Work section not found');
    return this.prisma.workSection.update({
      where: { id },
      data: {
        letter: dto.letter !== undefined ? dto.letter : undefined,
        title: dto.title?.trim() || undefined,
        defaultNotes: dto.defaultNotes ?? undefined,
        sortOrder: dto.sortOrder ?? undefined,
        isActive: dto.isActive ?? undefined,
      },
    });
  }

  async removeSection(organizationId: string, id: string) {
    // Items keep existing; they just lose their section (become plain services).
    await this.prisma.revenueItem.updateMany({ where: { organizationId, workSectionId: id }, data: { workSectionId: null } });
    await this.prisma.workSection.deleteMany({ where: { id, organizationId } });
    return { ok: true };
  }
}
