import { BadRequestException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { ActionLogService } from '../action-log/action-log.service';
import Anthropic from '@anthropic-ai/sdk';
import { PrismaService } from '../common/prisma.service';
import { S3Service } from '../common/services/s3.service';
import { NotificationsService } from '../notifications/notifications.service';
import { UsersService } from '../users/users.service';

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

// All recognised sources. ezid | network are set ONLY by the email-ingestion
// path; manual | fb | ig are the human-entered ones a UI edit may set.
export const LEAD_SOURCES = ['ezid', 'network', 'manual', 'fb', 'ig'] as const;
export const MANUAL_SOURCES = ['manual', 'fb', 'ig'] as const;
const isManualSource = (s: string | null | undefined) => MANUAL_SOURCES.includes(s as any);

// Lead attachment validation (this endpoint validates, unlike /uploads/image).
const ATTACH_ALLOWED_TYPES = new Set(['image/png', 'image/jpeg', 'image/webp', 'application/pdf', 'video/mp4', 'video/quicktime']);
const ATTACH_MAX_IMAGE = 10 * 1024 * 1024; // images + PDF
const ATTACH_MAX_VIDEO = 100 * 1024 * 1024; // video
const ATTACH_EXT: Record<string, string> = { 'image/png': 'png', 'image/jpeg': 'jpg', 'image/webp': 'webp', 'application/pdf': 'pdf', 'video/mp4': 'mp4', 'video/quicktime': 'mov' };

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
    private readonly users: UsersService,
    private readonly actionLog: ActionLogService,
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
    // New unassigned lead → WhatsApp assignment prompt (fire-and-forget).
    this.leadAssignBroadcast(lead).catch(() => null);
    return lead;
  }

  /** True when the caller's ONLY active role in the org is Designer — such
   *  users are force-scoped to their own assigned records (guru 2026-09-12). */
  private async isPureDesigner(organizationId: string, userId?: string | null): Promise<boolean> {
    if (!userId) return false;
    const roles = await this.prisma.userRole.findMany({
      where: { userId, organizationId, isActive: true },
      select: { role: { select: { name: true } } },
    });
    const names = roles.map((r) => r.role.name);
    return names.length > 0 && names.every((n) => n === 'Designer');
  }

  async list(organizationId: string, opts: { page?: number; limit?: number; search?: string; status?: string; source?: string; assignedToUserId?: string; callerUserId?: string }) {
    const page = Math.max(1, opts.page || 1);
    const limit = Math.min(100, Math.max(1, opts.limit || 20));
    const where: any = { organizationId };
    if (opts.status) where.status = opts.status;
    if (opts.source) where.source = opts.source;
    if (opts.assignedToUserId) where.assignedToUserId = opts.assignedToUserId;
    // Designers only see their assigned leads.
    if (await this.isPureDesigner(organizationId, opts.callerUserId)) where.assignedToUserId = opts.callerUserId;
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
  async stats(organizationId: string, callerUserId?: string) {
    const selfOnly = await this.isPureDesigner(organizationId, callerUserId);
    const leads = await this.prisma.lead.findMany({
      where: { organizationId, ...(selfOnly ? { assignedToUserId: callerUserId } : {}) },
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

  // ── WhatsApp lead-assignment loop (guru 2026-09-13) ─────────────────────
  // Every new unassigned lead pings management (WhatsAppAgentConfig.notifyNumber)
  // through the OSIRIS AIMS agent line with the lead card + an interactive list
  // of the org's designers. A tap assigns the lead and messages that designer.
  private static readonly AGENT_ORG_NAME = 'Osiris Technology Pte. Ltd.';

  /** The platform agent's primary WhatsApp line (falls back to the lead org's own). */
  private async agentLine(fallbackOrgId?: string) {
    const osiris = await this.prisma.organization.findFirst({ where: { name: LeadsService.AGENT_ORG_NAME }, select: { id: true } });
    for (const orgId of [osiris?.id, fallbackOrgId].filter(Boolean) as string[]) {
      const line = await this.prisma.whatsAppConnection.findFirst({
        where: { organizationId: orgId, status: 'CONNECTED' },
        orderBy: [{ isPrimary: 'desc' }, { connectedAt: 'asc' }],
      });
      if (line) return line;
    }
    return null;
  }

  private async waSend(line: { organizationId: string; phoneNumberId: string; accessToken: string }, to: string, payload: Record<string, any>, bodyText: string) {
    const res = await fetch(`https://graph.facebook.com/v23.0/${line.phoneNumberId}/messages`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${line.accessToken}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ messaging_product: 'whatsapp', to, ...payload }),
    });
    const json: any = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(json?.error?.message || `WhatsApp send failed (${res.status})`);
    await this.prisma.whatsAppMessage
      .create({
        data: {
          organizationId: line.organizationId,
          direction: 'OUTBOUND',
          counterparty: to,
          phoneNumberId: line.phoneNumberId,
          waMessageId: json?.messages?.[0]?.id || null,
          body: bodyText,
          status: 'sent',
          payload: payload as any,
        },
      })
      .catch(() => null);
  }

  /** The org's Designer-role users (falls back to everyone, same as the pickers). */
  private async designersOf(organizationId: string) {
    const res: any = await this.users.getUsers({ page: 1, limit: 100, search: '', filters: {} } as any, organizationId);
    const all: any[] = res?.users || res?.docs || (Array.isArray(res) ? res : []);
    const designers = all.filter((u) => (u.roles || []).some((r: any) => /designer/i.test(r?.name || '')));
    return (designers.length ? designers : all).map((u) => ({ id: u.id, name: u.name || u.email || String(u.id).slice(0, 12), whatsappNumber: u.whatsappNumber || null }));
  }

  /** Fire-and-forget after lead creation — never blocks the capture path. */
  async leadAssignBroadcast(lead: any) {
    try {
      if (!lead || lead.assignedToUserId) return;
      const cfg: any = await this.prisma.whatsAppAgentConfig.findUnique({ where: { organizationId: lead.organizationId } });
      const to = String(cfg?.notifyNumber || '').replace(/\D/g, '');
      if (!to) return;
      const line = await this.agentLine(lead.organizationId);
      if (!line) return;
      const summary = [
        `🆕 New lead — ${lead.name}`,
        `Source: ${String(lead.source || 'manual').toUpperCase()}${lead.ref ? ` · ${lead.ref}` : ''}`,
        lead.phone ? `Phone: ${lead.phone}` : null,
        [lead.propertyType, lead.propertyRooms, lead.budget].filter(Boolean).join(' · ') || null,
        lead.location ? `Location: ${lead.location}` : null,
        lead.remarks ? `Remarks: ${String(lead.remarks).slice(0, 200)}` : null,
      ]
        .filter(Boolean)
        .join('\n');
      const designers = (await this.designersOf(lead.organizationId)).slice(0, 10);
      if (!designers.length) {
        await this.waSend(line, to, { type: 'text', text: { body: summary } }, summary);
        return;
      }
      await this.waSend(
        line,
        to,
        {
          type: 'interactive',
          interactive: {
            type: 'list',
            body: { text: summary.slice(0, 1024) },
            footer: { text: 'Tap to assign a designer' },
            action: {
              button: 'Assign designer',
              sections: [
                {
                  title: 'Designers',
                  rows: designers.map((d) => ({
                    id: `leadassign:${lead.id}:${d.id}`.slice(0, 200),
                    title: String(d.name).slice(0, 24),
                    ...(d.whatsappNumber ? { description: `+${d.whatsappNumber}` } : {}),
                  })),
                },
              ],
            },
          },
        },
        summary,
      );
    } catch (e) {
      const msg = (e as Error).message || '';
      this.logger.warn(`Lead assignment broadcast failed for ${lead?.id}: ${msg}`);
      // Closed 24h window → nudge with the pre-approved template (deliverable
      // any time); one reply/tap to it reopens the window for the real list.
      if (/re-?engagement|131047/i.test(msg)) {
        try {
          const cfg: any = await this.prisma.whatsAppAgentConfig.findUnique({ where: { organizationId: lead.organizationId } });
          const to = String(cfg?.notifyNumber || '').replace(/\D/g, '');
          const line = await this.agentLine(lead.organizationId);
          if (to && line) await this.sendKeepAliveTemplate(line, to);
        } catch {
          /* best-effort */
        }
      }
    }
  }

  private async sendKeepAliveTemplate(line: { organizationId: string; phoneNumberId: string; accessToken: string }, to: string) {
    const templateName = process.env.WHATSAPP_KEEPALIVE_TEMPLATE || 'hello_world';
    await this.waSend(
      line,
      to,
      { type: 'template', template: { name: templateName, language: { code: 'en_US' } } },
      `keep-alive template (${templateName}) — reply to open the 24h window`,
    );
  }

  /**
   * Daily keep-alive (guru 2026-09-13): ping management + every designer of
   * each org that has a notifyNumber, so the assignment prompts have a live
   * window when leads land. Template messages deliver regardless of the 24h
   * window; a reply/tap opens it. 01:00 UTC = 09:00 SGT.
   */
  @Cron('0 1 * * *')
  async keepAliveCron() {
    const configs = await this.prisma.whatsAppAgentConfig.findMany({ where: { notifyNumber: { not: null } } });
    for (const cfg of configs) {
      try {
        const line = await this.agentLine(cfg.organizationId);
        if (!line) continue;
        const targets = new Set<string>();
        const notify = String((cfg as any).notifyNumber || '').replace(/\D/g, '');
        if (notify) targets.add(notify);
        for (const d of await this.designersOf(cfg.organizationId)) {
          const n = String(d.whatsappNumber || '').replace(/\D/g, '');
          if (n) targets.add(n);
        }
        let sent = 0;
        for (const to of targets) {
          await this.sendKeepAliveTemplate(line, to).then(() => sent++).catch((e) => this.logger.warn(`keep-alive to ${to} failed: ${e.message}`));
        }
        this.actionLog.system('whatsapp-keepalive', 'SEND', 'whatsapp', { organizationId: cfg.organizationId, details: { targets: targets.size, sent } });
      } catch (e) {
        this.logger.warn(`keep-alive for org ${cfg.organizationId} failed: ${(e as Error).message}`);
      }
    }
  }

  /**
   * A WhatsApp chat with a lead's number was detected on a connected line
   * (designer's outbound echo, or the lead replying). First detection stamps
   * the lead and auto-completes quest step 1 ("Contact the lead") on the
   * linked project, if any.
   */
  async markLeadContacted(organizationId: string, phone: string) {
    const digits = String(phone || '').replace(/\D/g, '');
    if (!digits || digits.length < 8) return;
    const lead: any = await this.prisma.lead.findFirst({
      where: { organizationId, phone: { in: [digits, digits.replace(/^65/, '')] }, status: { in: ['unqualified', 'engaging', 'converted'] }, firstContactedAt: null },
      orderBy: { receivedAt: 'desc' },
    });
    if (!lead) return;
    await this.prisma.lead.update({ where: { id: lead.id }, data: { firstContactedAt: new Date() } });
    if (lead.projectId) {
      await this.prisma.projectQuestStep
        .updateMany({
          where: { projectId: lead.projectId, organizationId, stepNo: 1, title: 'Contact the lead', status: 'pending' },
          data: { status: 'done', completedAt: new Date(), completedByName: lead.assignedToName ? `auto · ${lead.assignedToName}` : 'auto · WhatsApp chat detected' },
        })
        .catch(() => null);
    }
    this.logger.log(`Lead ${lead.id} marked contacted via WhatsApp (${digits})`);
  }

  /** A tapped designer row on the assignment list (arrives on the agent line's webhook). */
  async handleAssignTap(tapped: string, from: string, line: { organizationId: string; phoneNumberId: string; accessToken: string }) {
    const m = tapped.match(/^leadassign:([^:]+):(.+)$/);
    if (!m) return;
    const [, leadId, userId] = m;
    const lead = await this.prisma.lead.findUnique({ where: { id: leadId } });
    if (!lead) {
      await this.waSend(line, from, { type: 'text', text: { body: 'That lead no longer exists in AIMS.' } }, 'lead missing').catch(() => null);
      return;
    }
    const designers = await this.designersOf(lead.organizationId);
    const d = designers.find((x) => x.id === userId);
    const name = d?.name || 'the designer';
    await this.prisma.lead.update({
      where: { id: lead.id },
      data: {
        assignedToUserId: userId,
        assignedToName: d?.name || null,
        assignedAt: new Date(),
        status: lead.status === 'unqualified' ? 'engaging' : undefined,
      },
    });
    await this.waSend(line, from, { type: 'text', text: { body: `✅ ${lead.name} assigned to ${name}` } }, `assigned to ${name}`).catch(() => null);
    const dnum = String(d?.whatsappNumber || '').replace(/\D/g, '');
    if (dnum) {
      const brief = [
        `📋 New lead assigned to you — ${lead.name}`,
        lead.phone ? `Phone: ${lead.phone}` : null,
        `Source: ${String(lead.source || 'manual').toUpperCase()}`,
        [lead.propertyType, lead.propertyRooms, lead.budget].filter(Boolean).join(' · ') || null,
        lead.remarks ? `Remarks: ${String(lead.remarks).slice(0, 200)}` : null,
        'Contact them within 24h · details in AIMS → Sales → Leads.',
      ]
        .filter(Boolean)
        .join('\n');
      const leadNum = String(lead.phone || '').replace(/\D/g, '');
      if (leadNum) {
        // CTA button deep-links into a WhatsApp chat WITH THE LEAD, prefilled —
        // the designer texts from their own number in one tap.
        const intro = `Hi ${lead.name?.split(' ')[0] || ''}, this is ${d?.name || 'your designer'} from CIEL Interior — thanks for your enquiry! When would be a good time to chat about your renovation?`;
        const waUrl = `https://wa.me/${leadNum.startsWith('65') || leadNum.length > 8 ? leadNum : '65' + leadNum}?text=${encodeURIComponent(intro)}`;
        await this.waSend(
          line,
          dnum,
          {
            type: 'interactive',
            interactive: {
              type: 'cta_url',
              body: { text: brief.slice(0, 1024) },
              action: { name: 'cta_url', parameters: { display_text: '💬 Message the lead', url: waUrl } },
            },
          },
          brief,
        ).catch((e) => this.logger.warn(`Designer notify failed: ${e.message}`));
      } else {
        await this.waSend(line, dnum, { type: 'text', text: { body: brief } }, brief).catch((e) => this.logger.warn(`Designer notify failed: ${e.message}`));
      }
    }
    await this.notifications
      .emit({ organizationId: lead.organizationId, kind: 'lead_assigned', title: `Lead ${lead.name} → ${name}`, body: 'Assigned via WhatsApp' })
      .catch(() => null);
  }

  /**
   * WhatsApp lead-capture line (guru 2026-09-13): every customer message on a
   * mode='leads' number lands here. One open lead per phone — a new message
   * appends to the existing lead's notes instead of spawning duplicates.
   */
  async captureFromWhatsApp(organizationId: string, msg: { phone: string; name?: string | null; text?: string | null }) {
    const digits = String(msg.phone || '').replace(/\D/g, '');
    if (!digits) return null;
    const stamp = new Date().toLocaleString('en-SG', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' });
    const line = `[${stamp}] ${msg.text?.trim() || '(media)'}`;
    const existing = await this.prisma.lead.findFirst({
      where: { organizationId, phone: digits, status: { in: ['unqualified', 'engaging'] } },
      orderBy: { receivedAt: 'desc' },
    });
    if (existing) {
      const notes = `${existing.notes ? existing.notes + '\n' : ''}${line}`.slice(-4000);
      return this.prisma.lead.update({ where: { id: existing.id }, data: { notes, name: existing.name === existing.phone && msg.name ? msg.name : undefined } });
    }
    const lead = await this.prisma.lead.create({
      data: {
        organizationId,
        source: 'whatsapp',
        name: msg.name?.trim() || digits,
        phone: digits,
        phoneVerified: true, // they messaged us from it
        remarks: msg.text?.trim()?.slice(0, 1000) || null,
        notes: line,
        status: 'unqualified',
      },
    });
    this.leadAssignBroadcast(lead).catch(() => null);
    await this.notifications
      .emit({ organizationId, kind: 'lead_captured', title: `New WhatsApp lead: ${lead.name}`, body: (msg.text || '').slice(0, 140) })
      .catch(() => null);
    return lead;
  }

  async update(leadId: string, organizationId: string, dto: LeadDto) {
    const existing = await this.prisma.lead.findFirst({ where: { id: leadId, organizationId } });
    if (!existing) throw new NotFoundException('Lead not found');
    if (dto.status && !LEAD_STATUSES.includes(dto.status as any)) throw new BadRequestException('Unknown status');
    // Dead needs evidence: a lead can only be marked dead once the no-reply
    // proof is on file (uploadDeadProof sets both together).
    if (dto.status === 'dead' && !existing.deadProofUrl) throw new BadRequestException('Attach proof that the client never replied before marking the lead dead');
    // Source guard: a UI edit may only move a MANUAL-ish lead between the
    // manual sources (manual | fb | ig). It can never re-source an email
    // lead (ezid | network), nor claim one of those — those are set by the
    // ingestion path only.
    if (dto.source !== undefined) {
      if (!LEAD_SOURCES.includes(dto.source as any)) throw new BadRequestException('Unknown source');
      if (!isManualSource(dto.source)) throw new BadRequestException(`Source can only be set to ${MANUAL_SOURCES.join(', ')} — ezid/network are set by email ingestion only`);
      if (!isManualSource(existing.source)) throw new BadRequestException('This lead was captured from email; its source cannot be changed');
    }
    const assigningNow = dto.assignedToUserId !== undefined && dto.assignedToUserId !== existing.assignedToUserId;
    return this.prisma.lead.update({
      where: { id: leadId },
      data: {
        ...Object.fromEntries(
          ['source', 'ref', 'name', 'email', 'phone', 'location', 'propertyType', 'propertyRooms', 'propertyStatus', 'keyCollection', 'moveIn', 'budget', 'areas', 'designStyle', 'remarks', 'approachNotes', 'floorPlanUrl', 'status', 'assignedToUserId', 'assignedToName', 'quotationId', 'projectId', 'notes'].map((k) => [k, (dto as any)[k] !== undefined ? (dto as any)[k] : undefined]),
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

  /** Lead + its attachments (the detail response). */
  async getOne(leadId: string, organizationId: string) {
    const lead = await this.prisma.lead.findFirst({ where: { id: leadId, organizationId } });
    if (!lead) throw new NotFoundException('Lead not found');
    const attachments = await this.listAttachments(leadId, organizationId);
    return { ...lead, attachments };
  }

  async listAttachments(leadId: string, organizationId: string) {
    return this.prisma.leadAttachment.findMany({ where: { organizationId, leadId }, orderBy: { createdAt: 'desc' } });
  }

  /**
   * Add ONE attachment. Follows the dead-proof pattern (base64 data-URL in the
   * JSON body) but VALIDATES type + size, unlike /uploads/image. Returns the
   * refreshed attachment list. NOTE: the 15mb Express json limit (main.ts)
   * caps a base64 upload at ~11MB of real bytes — video needs multipart/a
   * raised limit to reach the 100MB ceiling checked here.
   */
  async addAttachment(leadId: string, organizationId: string, file: string, filename?: string, kind?: string) {
    const existing = await this.prisma.lead.findFirst({ where: { id: leadId, organizationId } });
    if (!existing) throw new NotFoundException('Lead not found');
    if (!file) throw new BadRequestException('No file provided');
    const mediaType = file.match(/^data:([a-zA-Z/+.-]+);base64,/)?.[1];
    if (!mediaType) throw new BadRequestException('File must be a base64 data URL');
    if (!ATTACH_ALLOWED_TYPES.has(mediaType)) throw new BadRequestException(`Unsupported file type "${mediaType}". Allowed: PNG, JPEG, WebP, PDF, MP4, MOV`);
    const buffer = Buffer.from(file.slice(file.indexOf(',') + 1), 'base64');
    const sizeBytes = buffer.length;
    const isVideo = mediaType.startsWith('video/');
    const max = isVideo ? ATTACH_MAX_VIDEO : ATTACH_MAX_IMAGE;
    if (sizeBytes > max) throw new BadRequestException(`File is ${(sizeBytes / 1048576).toFixed(1)}MB — the limit is ${isVideo ? '100MB for video' : '10MB for images and PDF'}`);
    const ext = ATTACH_EXT[mediaType] || 'bin';
    const key = `leads/${organizationId}/attachments/${leadId}-${Date.now()}.${ext}`;
    const url = await this.s3.uploadFile(key, buffer, mediaType);
    const derivedKind = kind || (isVideo ? 'video' : mediaType === 'application/pdf' ? 'other' : 'photo');
    await this.prisma.leadAttachment.create({
      data: { organizationId, leadId, url, key, filename: filename ?? null, mimeType: mediaType, sizeBytes, kind: derivedKind },
    });
    return this.listAttachments(leadId, organizationId);
  }

  /** Delete an attachment row AND its S3 object. Returns the refreshed list. */
  async removeAttachment(leadId: string, attachmentId: string, organizationId: string) {
    const att = await this.prisma.leadAttachment.findFirst({ where: { id: attachmentId, leadId, organizationId } });
    if (!att) throw new NotFoundException('Attachment not found');
    try {
      await this.s3.deleteFile(att.key);
    } catch {
      /* best effort — still drop the row */
    }
    await this.prisma.leadAttachment.delete({ where: { id: attachmentId } });
    return this.listAttachments(leadId, organizationId);
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
