import { BadRequestException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import Anthropic from '@anthropic-ai/sdk';
import { PrismaService } from '../common/prisma.service';
import { S3Service } from '../common/services/s3.service';
import { NotificationsService } from '../notifications/notifications.service';

const DAY = 86400000;

export type LeadEmail = {
  from: string;
  subject?: string;
  text?: string;
  attachments?: Array<{ contentType: string; contentBase64: string; filename?: string }>;
};

type LeadDto = Partial<{
  source: string;
  ref: string | null;
  name: string;
  email: string | null;
  phone: string | null;
  phoneVerified: boolean;
  location: string | null;
  propertyType: string | null;
  propertyRooms: string | null;
  propertyStatus: string | null;
  keyCollection: string | null;
  moveIn: string | null;
  budget: string | null;
  areas: string | null;
  designStyle: string | null;
  remarks: string | null;
  approachNotes: string | null;
  floorPlanUrl: string | null;
  status: string;
  assignedToUserId: string | null;
  assignedToName: string | null;
  quotationId: string | null;
  projectId: string | null;
  notes: string | null;
}>;

// The owners' flow: every lead starts UNQUALIFIED; the designer taking it
// moves it to ENGAGING; from there it's either DEAD (proof of no reply is
// mandatory — the replacement-claim evidence) or CONVERTED (auto-creates the
// quotation).
export const LEAD_STATUSES = ['unqualified', 'engaging', 'dead', 'converted'] as const;

/** Does this inbound email look like a lead (vs a bill/invoice)? */
export function looksLikeLeadEmail(fromEmail: string, subject: string | undefined): boolean {
  const s = (subject || '').toLowerCase();
  return (
    /@ezid\.sg$/i.test(fromEmail) ||
    /\bezid\b/.test(s) ||
    /new lead/.test(s) ||
    /lead programme|lead distribution|network.*lead|marketing lead/.test(s)
  );
}

@Injectable()
export class LeadsService {
  private readonly logger = new Logger(LeadsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly s3: S3Service,
    private readonly notifications: NotificationsService,
  ) {}

  // ── EZiD: deterministic parse of the plain-text field list ───────────────
  private parseEzid(text: string): LeadDto | null {
    const grab = (label: string) => {
      const m = text.match(new RegExp(`${label}\\s*:\\s*([^\\n]+)`, 'i'));
      return m?.[1]?.trim() || null;
    };
    const name = grab('First Name') || grab('Name');
    if (!name) return null;
    const phoneRaw = grab('Phone No') || grab('Phone');
    // "Remarks for ID:" runs to the end of the message (multi-paragraph).
    const remarks = text.match(/Remarks for ID\s*:\s*([\s\S]+)$/i)?.[1]?.trim() || null;
    return {
      source: 'ezid',
      name,
      email: grab('Email'),
      phone: phoneRaw ? phoneRaw.replace(/\D/g, '') : null,
      phoneVerified: /verified/i.test(phoneRaw || ''),
      propertyType: grab('Property Type'),
      propertyRooms: grab('Property Rooms'),
      propertyStatus: grab('Property Status'),
      keyCollection: grab('Key Collection'),
      budget: grab('Renovation Budget'),
      remarks,
    };
  }

  // ── Network Singapore: AI-extract the "Lead Programme" PDF ───────────────
  private async extractNetworkPdf(base64: string): Promise<LeadDto | null> {
    const apiKey = process.env.ANTHROPIC_API_KEY;
    if (!apiKey) return null;
    const client = new Anthropic({ apiKey });
    const system = `You are extracting a single renovation lead from a "Lead Programme" distribution PDF.
Output ONLY a JSON object with these keys (null when absent):
"name", "ref" (e.g. NSG-2026-2160), "phone" (digits only), "email", "location",
"propertyType" (housing type), "budget", "keyCollection", "moveIn",
"areas" (areas to renovate), "designStyle", "remarks" (the WHO YOU ARE SPEAKING TO summary, verbatim),
"approachNotes" (the HOW TO APPROACH note, verbatim), "distributedDate" (YYYY-MM-DD from "DISTRIBUTED"),
"floorPlanUrl" (the Google Drive link if visible, else null).
Output STRICT JSON only — never emit the token undefined and never leave trailing commas.`;
    try {
      const res = await client.messages.create({
        model: 'claude-sonnet-5',
        max_tokens: 1500,
        system,
        messages: [{ role: 'user', content: [{ type: 'document', source: { type: 'base64', media_type: 'application/pdf', data: base64 } }, { type: 'text', text: 'Extract the lead.' }] }],
      });
      const textOut = res.content.find((c: any) => c.type === 'text') as any;
      const m = textOut?.text?.match(/\{[\s\S]*\}/);
      if (!m) return null;
      const parsed = JSON.parse(m[0]);
      if (!parsed?.name) return null;
      const distributed = parsed.distributedDate ? new Date(parsed.distributedDate) : null;
      return {
        source: 'network',
        name: String(parsed.name),
        ref: parsed.ref || null,
        phone: parsed.phone ? String(parsed.phone).replace(/\D/g, '') : null,
        email: parsed.email || null,
        location: parsed.location || null,
        propertyType: parsed.propertyType || null,
        budget: parsed.budget || null,
        keyCollection: parsed.keyCollection || null,
        moveIn: parsed.moveIn || null,
        areas: parsed.areas || null,
        designStyle: parsed.designStyle || null,
        remarks: parsed.remarks || null,
        approachNotes: parsed.approachNotes || null,
        floorPlanUrl: parsed.floorPlanUrl || null,
        ...(distributed && !isNaN(distributed.getTime())
          ? { receivedAtOverride: distributed }
          : {}),
      } as any;
    } catch (e: any) {
      this.logger.warn(`network lead PDF extraction failed: ${e?.message}`);
      return null;
    }
  }

  /**
   * Inbound lead email (from the docs+{org}@ ingestion webhook). Returns the
   * created lead ids. Never throws for parse failures — an unparseable lead
   * email still creates a bare "new" lead carrying the raw text so nothing
   * from a paid lead provider is ever silently lost.
   */
  async createFromEmail(organizationId: string, payload: LeadEmail): Promise<{ created: string[] }> {
    const created: string[] = [];
    const fromEmail = ((payload.from || '').match(/<?([^<>\s]+@[^<>\s]+)>?/)?.[1] || '').toLowerCase();

    // 1. Network PDFs (one lead per PDF attachment).
    for (const att of payload.attachments || []) {
      if (att.contentType !== 'application/pdf') continue;
      const dto = await this.extractNetworkPdf(att.contentBase64);
      if (!dto) continue;
      const receivedAt: Date = (dto as any).receivedAtOverride || new Date();
      delete (dto as any).receivedAtOverride;
      const key = `leads/${organizationId}/${Date.now()}-${(att.filename || 'lead').replace(/[^a-zA-Z0-9._-]/g, '_')}`;
      let attachmentUrl: string | null = null;
      try {
        attachmentUrl = await this.s3.uploadFile(key, Buffer.from(att.contentBase64, 'base64'), 'application/pdf');
      } catch {
        /* keep the lead even if the upload fails */
      }
      const lead = await this.create(organizationId, {
        ...dto,
        attachmentUrl,
        attachmentKey: attachmentUrl ? key : null,
        emailFrom: fromEmail,
        emailSubject: payload.subject || null,
        receivedAt,
        firstContactDeadline: new Date(receivedAt.getTime() + DAY),
        replacementDeadline: new Date(receivedAt.getTime() + 14 * DAY),
      } as any);
      created.push(lead.id);
    }

    // 2. EZiD plain-text body (only when no PDF lead was found in the mail).
    if (!created.length && payload.text) {
      const dto = this.parseEzid(payload.text);
      const lead = await this.create(organizationId, {
        ...(dto || { source: 'ezid', name: payload.subject || 'Unparsed lead', remarks: payload.text.slice(0, 4000), notes: 'Automatic parse failed — raw email kept in remarks' }),
        emailFrom: fromEmail,
        emailSubject: payload.subject || null,
      } as any);
      created.push(lead.id);
    }

    return { created };
  }

  async create(organizationId: string, dto: LeadDto & { emailFrom?: string | null; emailSubject?: string | null; receivedAt?: Date; firstContactDeadline?: Date | null; replacementDeadline?: Date | null; attachmentUrl?: string | null; attachmentKey?: string | null }) {
    if (!dto.name?.trim()) throw new BadRequestException('Lead name is required');
    const lead = await this.prisma.lead.create({
      data: {
        organizationId,
        source: dto.source || 'manual',
        ref: dto.ref ?? null,
        name: dto.name.trim(),
        email: dto.email ?? null,
        phone: dto.phone ?? null,
        phoneVerified: dto.phoneVerified ?? false,
        location: dto.location ?? null,
        propertyType: dto.propertyType ?? null,
        propertyRooms: dto.propertyRooms ?? null,
        propertyStatus: dto.propertyStatus ?? null,
        keyCollection: dto.keyCollection ?? null,
        moveIn: dto.moveIn ?? null,
        budget: dto.budget ?? null,
        areas: dto.areas ?? null,
        designStyle: dto.designStyle ?? null,
        remarks: dto.remarks ?? null,
        approachNotes: dto.approachNotes ?? null,
        floorPlanUrl: dto.floorPlanUrl ?? null,
        attachmentUrl: dto.attachmentUrl ?? null,
        attachmentKey: dto.attachmentKey ?? null,
        status: dto.status || 'unqualified',
        assignedToUserId: dto.assignedToUserId ?? null,
        assignedToName: dto.assignedToName ?? null,
        assignedAt: dto.assignedToUserId || dto.assignedToName ? new Date() : null,
        emailFrom: dto.emailFrom ?? null,
        emailSubject: dto.emailSubject ?? null,
        receivedAt: dto.receivedAt || new Date(),
        firstContactDeadline: dto.firstContactDeadline ?? null,
        replacementDeadline: dto.replacementDeadline ?? null,
        notes: dto.notes ?? null,
      },
    });
    await this.notifications.emit({
      organizationId,
      kind: 'new_lead',
      title: `New lead: ${lead.name}${lead.source !== 'manual' ? ` (${lead.source.toUpperCase()})` : ''}`,
      body: [lead.propertyType, lead.location, lead.budget].filter(Boolean).join(' · ') || null,
      entityType: 'lead',
      entityId: lead.id,
      linkUrl: `/portal/sales/leads`,
    });
    return lead;
  }

  async list(organizationId: string, opts: { page?: number; limit?: number; search?: string; status?: string; source?: string; assignedToUserId?: string }) {
    const page = Math.max(1, opts.page || 1);
    const limit = Math.min(100, Math.max(1, opts.limit || 20));
    const where: any = { organizationId };
    if (opts.status) where.status = opts.status;
    if (opts.source) where.source = opts.source;
    if (opts.assignedToUserId) where.assignedToUserId = opts.assignedToUserId;
    if (opts.search?.trim()) {
      const s = opts.search.trim();
      where.OR = [
        { name: { contains: s, mode: 'insensitive' } },
        { email: { contains: s, mode: 'insensitive' } },
        { phone: { contains: s.replace(/\D/g, '') || s } },
        { location: { contains: s, mode: 'insensitive' } },
        { ref: { contains: s, mode: 'insensitive' } },
      ];
    }
    const [docs, total] = await Promise.all([
      this.prisma.lead.findMany({ where, orderBy: { receivedAt: 'desc' }, skip: (page - 1) * limit, take: limit }),
      this.prisma.lead.count({ where }),
    ]);
    return { docs, total, page, limit, totalPages: Math.ceil(total / limit) };
  }

  /** Funnel stats + per-designer conversion (the owners' ratios). */
  async stats(organizationId: string) {
    const leads = await this.prisma.lead.findMany({
      where: { organizationId },
      select: { status: true, source: true, assignedToUserId: true, assignedToName: true },
    });
    const byStatus: Record<string, number> = {};
    for (const l of leads) byStatus[l.status] = (byStatus[l.status] || 0) + 1;
    const perDesigner = new Map<string, { name: string; taken: number; signed: number; dead: number }>();
    for (const l of leads) {
      if (!l.assignedToUserId && !l.assignedToName) continue;
      const key = l.assignedToUserId || l.assignedToName!;
      const row = perDesigner.get(key) || { name: l.assignedToName || key, taken: 0, signed: 0, dead: 0 };
      row.taken += 1;
      if (l.status === 'converted') row.signed += 1;
      if (l.status === 'dead') row.dead += 1;
      perDesigner.set(key, row);
    }
    return {
      total: leads.length,
      byStatus,
      convertedPct: leads.length ? ((byStatus['converted'] || 0) / leads.length) * 100 : null,
      deadPct: leads.length ? ((byStatus['dead'] || 0) / leads.length) * 100 : null,
      perDesigner: [...perDesigner.values()].sort((a, b) => b.taken - a.taken),
    };
  }

  async update(leadId: string, organizationId: string, dto: LeadDto) {
    const existing = await this.prisma.lead.findFirst({ where: { id: leadId, organizationId } });
    if (!existing) throw new NotFoundException('Lead not found');
    if (dto.status && !LEAD_STATUSES.includes(dto.status as any)) throw new BadRequestException('Unknown status');
    // Dead needs evidence: a lead can only be marked dead once the no-reply
    // proof is on file (uploadDeadProof sets both together).
    if (dto.status === 'dead' && !existing.deadProofUrl) throw new BadRequestException('Attach proof that the client never replied before marking the lead dead');
    const assigningNow = dto.assignedToUserId !== undefined && dto.assignedToUserId !== existing.assignedToUserId;
    return this.prisma.lead.update({
      where: { id: leadId },
      data: {
        ...Object.fromEntries(
          ['ref', 'name', 'email', 'phone', 'location', 'propertyType', 'propertyRooms', 'propertyStatus', 'keyCollection', 'moveIn', 'budget', 'areas', 'designStyle', 'remarks', 'approachNotes', 'floorPlanUrl', 'status', 'assignedToUserId', 'assignedToName', 'quotationId', 'projectId', 'notes'].map((k) => [k, (dto as any)[k] !== undefined ? (dto as any)[k] : undefined]),
        ),
        assignedAt: assigningNow ? (dto.assignedToUserId ? new Date() : null) : undefined,
        deadAt: dto.status === 'dead' ? new Date() : undefined,
      },
    });
  }

  /** Upload the no-reply proof (screenshot/PDF) and mark the lead dead in one step. */
  async uploadDeadProof(leadId: string, organizationId: string, file: string, filename?: string) {
    const existing = await this.prisma.lead.findFirst({ where: { id: leadId, organizationId } });
    if (!existing) throw new NotFoundException('Lead not found');
    if (!file) throw new BadRequestException('No file provided');
    const headerMatch = file.match(/^data:([a-zA-Z/+.-]+);base64,/);
    const mediaType = headerMatch?.[1] || 'image/jpeg';
    const raw = file.slice(file.indexOf(',') + 1);
    const ext = mediaType === 'application/pdf' ? 'pdf' : mediaType.includes('png') ? 'png' : 'jpg';
    const key = `leads/${organizationId}/proof/${leadId}-${Date.now()}.${ext}`;
    const url = await this.s3.uploadFile(key, Buffer.from(raw, 'base64'), mediaType);
    return this.prisma.lead.update({
      where: { id: leadId },
      data: { deadProofUrl: url, deadProofKey: key, status: 'dead', deadAt: new Date() },
    });
  }

  async remove(leadId: string, organizationId: string) {
    const existing = await this.prisma.lead.findFirst({ where: { id: leadId, organizationId } });
    if (!existing) throw new NotFoundException('Lead not found');
    if (existing.attachmentKey) {
      try {
        await this.s3.deleteFile(existing.attachmentKey);
      } catch {
        /* best effort */
      }
    }
    await this.prisma.lead.delete({ where: { id: leadId } });
    return { ok: true };
  }
}
