import { ForbiddenException, Injectable, BadRequestException } from '@nestjs/common';
import { PrismaService } from '../common/prisma.service';
import { resolveTier } from '../common/role-tier';

/**
 * Org-editable BUSINESS RULES (guru 2026-10-24): the numbers and ladders that
 * used to be hardcoded (payment schedule %s, engagement fee, commission and
 * rebate defaults…), now adjustable by the org's own management in
 * Settings → Business rules. Stored as one JSON blob on OrganizationUIConfig
 * and merged over these code defaults — an org that never touches the page
 * behaves exactly as before.
 *
 * SEMANTIC: rules are SEEDS for new records (new projects, new quotes), never
 * retroactive — existing projects keep their milestones.
 */
export interface BusinessRules {
  payments: {
    /** Progressive ladder seeded onto new projects. pct of contract sum. */
    milestones: Array<{ label: string; pct: number; dueTrigger?: string | null }>;
    /** S$ engagement fee offered in lieu of the first milestone. */
    engagementFee: number;
    /** The % alternative on the first-payment chooser (default 10%). */
    firstPaymentAltPct: number;
  };
  /** Default sales commission % when a project/profile has none. */
  commissionPct: number;
  /** Default supplier rebate % (per-supplier/project overrides still win). */
  rebatePct: number;
  /** Default design fee % on new quotations (phase 2 wiring). */
  designFeePct: number;
  /** Quotation defaults: the text blocks + editor guard rails seeded onto NEW quotes. */
  quote: {
    paymentTerms: string[];
    clauses: string[];
    marginGuidelinePct: number;
    marginFloorPct: number;
  };
  /** Lead follow-up windows and the reply-nudge cadence. */
  leads: {
    firstContactHours: number;
    replacementDays: number;
    nudgeEveryHours: number;
    nudgeCap: number;
    nudgeHourStart: number;
    nudgeHourEnd: number;
  };
  /** Public appointment-booking link defaults for newly minted links. */
  booking: {
    slotMinutes: number;
    hourStart: number;
    hourEnd: number;
    daysAhead: number;
  };
}

// CIEL's contract standard (their quotation template) — the code defaults.
const DEFAULT_QUOTE_PAYMENT_TERMS = [
  'A) Upon confirmation : $1500 Engagement Fees',
  'B) Upon Finalised 3D Rendering : Full 10% of contract sum',
  'C) Upon commencement of renovation work : 40%',
  'D) Upon carpentry measurement : 45% (VO to be completely paid)',
  'E) Upon handover & completion of works : 5%',
];
const DEFAULT_QUOTE_CLAUSES = [
  'Variation & Additional Orders must be signed and agreed before any commencement of additional works. Similarly for works taken out from contract must also be duly endorsed by client/s. These will be billed accordingly. 1) All works not stated in contract, and/or additional floor area and length will be deemed as variation and additional works. 2) All floor and wall tiles selection capped at $3.50 before gst unless otherwise stated. 3) All laminate selection for carpentry works capped at $60.00 per piece unless otherwise stated.',
  'Payment for Variation & Additional Orders must be claimed in FULL by the Company during the 3rd invoicing (45%). 1) Quotation for variation and additional works shall be confirmed by clients within 7 days upon receiving unless otherwise stated. 2) Company shall not be liable for any form of liquidated damages in the events of changes to works stated, and/or no confirmation for variation & additional orders resulting in delay of completion. 3) Variation order to be completely paid upon measurement of carpentry works. Variation order which comes after carpentry works shall be paid in full upon confirmation on variation order before commencement.',
  'Signed Agreement cannot be cancelled without a valid reason. Cancellation charges of up to 50% of contract sum may be imposed onto the client/s if work has been done and/or purchase of supplies, materials and labour had been arranged.',
  'The Company reserves the rights to stop work/put the renovation project on hold if progressive payments are not made promptly and accordingly.',
  'The Company retains full ownership of the design, renovation materials, built up customised carpentry, raw materials, finished or unfinished products for the said renovation project until all payments for the contract, Variation & Additional orders are made.',
  'Granite, marble and natural wood being natural materials may vary in tonality, veins, surface textures, speckles & thickness and more. Such variants are natural and are out of control of the Company. They shall be deemed as inevitable and the Company shall be indemnified against such irregularities.',
  'Manufactured tiles like ceramic & homogeneous tiles may have certain issues like warping and running tone patterns. These issues are inherent and the Company shall be indemnified against such issues.',
  'All items, artifacts, antiques, paintings and any other valuable or invaluable objects left willingly by the Client/s shall be at the Client/s own risk. The Company shall not be responsible for any theft, damage, loss during the course of renovation. However the Client/s may make special arrangement with the Company to lock up certain rooms to protect the Client/s belongings for stay-in projects. The keys must be retained by the Client/s at all times.',
  'Submission fees to relevant authorities e.g. BCA, FSB, MOE etc. and condominium management will be borne by the Client/s and may be billed from the Company.',
  'All final quotation and agreement is subjected to final site measurement conducted by the representative of the Project Division of the Company.',
  'This quotation and agreement is valid for 14 (Fourteen) days.',
  'Discounted items and FOC items will be billed accordingly if incidents listed below occur: a) Client/s cancel item/s from Original Contract/Quotation and Agreement, Variation & Additional Orders, b) Client/s do not make full payment.',
  'All Payments made to Ciel Interior Pte Ltd should be in the form of a Crossed Cheque, Bank Transfer or PayNow to the Company Registered UEN: 202312049Z.',
  'Life time warranty will only be issued upon full collection of all outstanding payment from the client/s.',
];

export const DEFAULT_BUSINESS_RULES: BusinessRules = {
  payments: {
    milestones: [
      { label: '10% on confirmation (or engagement fee)', pct: 10, dueTrigger: 'confirmation' },
      { label: '40% on commencement of works', pct: 40, dueTrigger: 'commencement' },
      { label: '45% on carpentry measurement (VOs fully paid)', pct: 45, dueTrigger: 'carpentry' },
      { label: '5% on handover & completion', pct: 5, dueTrigger: 'handover' },
    ],
    engagementFee: 1500,
    firstPaymentAltPct: 10,
  },
  commissionPct: 50,
  rebatePct: 10,
  designFeePct: 5,
  quote: {
    paymentTerms: DEFAULT_QUOTE_PAYMENT_TERMS,
    clauses: DEFAULT_QUOTE_CLAUSES,
    marginGuidelinePct: 25,
    marginFloorPct: 15,
  },
  leads: {
    firstContactHours: 24,
    replacementDays: 14,
    nudgeEveryHours: 3,
    nudgeCap: 12,
    nudgeHourStart: 9,
    nudgeHourEnd: 21,
  },
  booking: {
    slotMinutes: 60,
    hourStart: 10,
    hourEnd: 20,
    daysAhead: 14,
  },
};

const numOr = (v: any, d: number) => (v != null && isFinite(Number(v)) && Number(v) >= 0 ? Number(v) : d);
const strList = (v: any, d: string[]) => (Array.isArray(v) && v.length ? v.map((x) => String(x)).filter((x) => x.trim()) : d);

@Injectable()
export class OrgRulesService {
  constructor(private readonly prisma: PrismaService) {}

  // Hot paths (milestone seeding, rebate panels) read rules repeatedly — a
  // short cache keeps that free. Invalidated on save.
  private cache = new Map<string, { at: number; rules: BusinessRules }>();

  /** The effective rules for an org: stored values merged over code defaults. */
  async rulesOf(organizationId: string): Promise<BusinessRules> {
    const hit = this.cache.get(organizationId);
    if (hit && Date.now() - hit.at < 60_000) return hit.rules;
    let stored: any = null;
    try {
      const ui = await this.prisma.organizationUIConfig.findUnique({
        where: { organizationId },
        select: { businessRules: true },
      });
      stored = ui?.businessRules || null;
    } catch {
      /* column not pushed yet → defaults */
    }
    const d = DEFAULT_BUSINESS_RULES;
    const rules: BusinessRules = {
      payments: {
        milestones:
          Array.isArray(stored?.payments?.milestones) && stored.payments.milestones.length
            ? stored.payments.milestones
                .map((m: any) => ({ label: String(m.label || '').trim(), pct: Number(m.pct) || 0, dueTrigger: m.dueTrigger || null }))
                .filter((m: any) => m.label)
            : d.payments.milestones,
        engagementFee: Number(stored?.payments?.engagementFee) > 0 ? Number(stored.payments.engagementFee) : d.payments.engagementFee,
        firstPaymentAltPct: Number(stored?.payments?.firstPaymentAltPct) > 0 ? Number(stored.payments.firstPaymentAltPct) : d.payments.firstPaymentAltPct,
      },
      commissionPct: Number(stored?.commissionPct) > 0 ? Number(stored.commissionPct) : d.commissionPct,
      rebatePct: stored?.rebatePct != null && Number(stored.rebatePct) >= 0 ? Number(stored.rebatePct) : d.rebatePct,
      designFeePct: stored?.designFeePct != null && Number(stored.designFeePct) >= 0 ? Number(stored.designFeePct) : d.designFeePct,
      quote: {
        paymentTerms: strList(stored?.quote?.paymentTerms, d.quote.paymentTerms),
        clauses: strList(stored?.quote?.clauses, d.quote.clauses),
        marginGuidelinePct: numOr(stored?.quote?.marginGuidelinePct, d.quote.marginGuidelinePct),
        marginFloorPct: numOr(stored?.quote?.marginFloorPct, d.quote.marginFloorPct),
      },
      leads: {
        firstContactHours: numOr(stored?.leads?.firstContactHours, d.leads.firstContactHours) || d.leads.firstContactHours,
        replacementDays: numOr(stored?.leads?.replacementDays, d.leads.replacementDays) || d.leads.replacementDays,
        nudgeEveryHours: numOr(stored?.leads?.nudgeEveryHours, d.leads.nudgeEveryHours) || d.leads.nudgeEveryHours,
        nudgeCap: numOr(stored?.leads?.nudgeCap, d.leads.nudgeCap),
        nudgeHourStart: numOr(stored?.leads?.nudgeHourStart, d.leads.nudgeHourStart),
        nudgeHourEnd: numOr(stored?.leads?.nudgeHourEnd, d.leads.nudgeHourEnd),
      },
      booking: {
        slotMinutes: numOr(stored?.booking?.slotMinutes, d.booking.slotMinutes) || d.booking.slotMinutes,
        hourStart: numOr(stored?.booking?.hourStart, d.booking.hourStart),
        hourEnd: numOr(stored?.booking?.hourEnd, d.booking.hourEnd),
        daysAhead: numOr(stored?.booking?.daysAhead, d.booking.daysAhead) || d.booking.daysAhead,
      },
    };
    this.cache.set(organizationId, { at: Date.now(), rules });
    return rules;
  }

  /** The subset any quote-creating member may read (no Director gate). */
  async quoteDefaults(organizationId: string) {
    const r = await this.rulesOf(organizationId);
    return { paymentTerms: r.quote.paymentTerms, clauses: r.quote.clauses, designFeePct: r.designFeePct, marginGuidelinePct: r.quote.marginGuidelinePct, marginFloorPct: r.quote.marginFloorPct };
  }

  async getForEdit(organizationId: string, callerUserId: string | undefined) {
    await this.assertMaster(organizationId, callerUserId);
    return { rules: await this.rulesOf(organizationId), defaults: DEFAULT_BUSINESS_RULES };
  }

  /** Directors (master tier) only — these numbers steer money. */
  async update(organizationId: string, callerUserId: string | undefined, patch: Partial<BusinessRules>) {
    await this.assertMaster(organizationId, callerUserId);
    if (patch?.payments?.milestones) {
      const ms = patch.payments.milestones;
      if (!Array.isArray(ms) || !ms.length) throw new BadRequestException('The payment schedule needs at least one milestone');
      const sum = ms.reduce((s, m) => s + (Number(m.pct) || 0), 0);
      if (Math.round(sum) !== 100) throw new BadRequestException(`Milestone percentages must add up to 100% (currently ${sum}%)`);
      if (ms.some((m) => !String(m.label || '').trim())) throw new BadRequestException('Every milestone needs a label');
    }
    const existing = await this.prisma.organizationUIConfig.findUnique({ where: { organizationId }, select: { id: true, businessRules: true } });
    if (!existing) throw new BadRequestException('Organization has no UI config row yet');
    const merged = { ...((existing.businessRules as any) || {}), ...patch };
    await this.prisma.organizationUIConfig.update({ where: { id: existing.id }, data: { businessRules: merged } });
    this.cache.delete(organizationId);
    return { rules: await this.rulesOf(organizationId) };
  }

  private async assertMaster(organizationId: string, callerUserId: string | undefined) {
    const scope = await resolveTier(this.prisma, organizationId, callerUserId);
    if (scope.tier !== 'master') throw new ForbiddenException('Only Directors can view or change business rules');
  }
}
