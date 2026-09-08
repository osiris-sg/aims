import {
  Injectable,
  NotFoundException,
  BadRequestException,
  HttpException,
  HttpStatus,
} from '@nestjs/common';
import { randomBytes } from 'crypto';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../common/prisma.service';
import { SubmitCustomerInfoDto } from './dto/customer-info.dto';

// Link lifetime from mint. Contact collection is not time-critical (unlike a
// delivery date), so a generous window avoids nuisance re-mints while still
// bounding a leaked URL.
const LINK_WINDOW_MS = 30 * 24 * 60 * 60 * 1000; // 30 days

// ── IN-MEMORY rate limiter ──────────────────────────────────────────────────
// ⚠️ WARNING: this state lives in THIS Node process ONLY. Render runs a SINGLE
// backend instance today, so a per-process limiter is sufficient. If the backend
// is EVER scaled horizontally (more than one instance/dyno), each instance keeps
// its own counters and the effective limit becomes per-instance (N times looser)
// and the limit silently weakens with no error. Move this to a shared store
// (Redis) BEFORE scaling beyond one instance.
const RL_WINDOW_MS = 60_000;
const RL_MAX = 60; // requests per (token + ip) per minute
const rlBuckets = new Map<string, { count: number; resetAt: number }>();
function enforceRateLimit(key: string) {
  const now = Date.now();
  const bucket = rlBuckets.get(key);
  if (!bucket || bucket.resetAt <= now) {
    rlBuckets.set(key, { count: 1, resetAt: now + RL_WINDOW_MS });
    return;
  }
  if (bucket.count >= RL_MAX) {
    throw new HttpException('Too many requests. Please slow down and try again shortly.', HttpStatus.TOO_MANY_REQUESTS);
  }
  bucket.count += 1;
  // Opportunistic sweep so a flood of distinct keys cannot grow the map forever.
  if (rlBuckets.size > 5000) {
    for (const [k, v] of rlBuckets) if (v.resetAt <= now) rlBuckets.delete(k);
  }
}

// Public resolve states. Resubmission is allowed while the link is active, so
// there is NO terminal "submitted" state — a submitted link stays `ok` and the
// recipient can reopen it prefilled and correct it. `submitted` here is only the
// office-facing list status (see requestStatus), not a public gate.
type TokenState = 'ok' | 'expired' | 'revoked' | 'notfound';

const CONTACT_GROUPS = ['DO', 'INVOICE'] as const;
type ContactGroup = (typeof CONTACT_GROUPS)[number];

/**
 * Customer Information collection (2026-08). The office mints an unguessable
 * token link for one customer + project; a no-login recipient fills in contact
 * people (DO group + INVOICE group) and submits. Everything is STANDALONE:
 * customerId/projectId are stored as plain values (no FK into Customer/Project),
 * names are snapshotted at mint, and submissions land only in the two new
 * CustomerInfo* tables for later reconciliation.
 *
 * Mirrors the run-scoped guest delivery link: a token binds to EXACTLY ONE
 * request row, the public methods resolve scope SOLELY from the token (never a
 * session or client body), each public call is rate-limited per (token + IP),
 * and the office mint/list/revoke routes are authenticated + permissioned.
 */
@Injectable()
export class CustomerInfoService {
  constructor(private readonly prisma: PrismaService) {}

  /** Controller calls this per public request with the token + client IP. */
  publicRateGate(token: string, ip: string) {
    enforceRateLimit(`${token || 'notoken'}::${ip || 'noip'}`);
  }

  private generateToken(): string {
    return randomBytes(32).toString('base64url');
  }

  // Office-facing status for the list/detail (NOT the public gate). Precedence:
  // revoked (explicit office action) → submitted (data collected, keep it) →
  // expired (window lapsed, nothing collected) → awaiting.
  private requestStatus(r: { revokedAt: Date | null; expiresAt: Date | null; submittedAt: Date | null }): string {
    if (r.revokedAt) return 'revoked';
    if (r.submittedAt) return 'submitted';
    if (r.expiresAt && r.expiresAt.getTime() < Date.now()) return 'expired';
    return 'awaiting';
  }

  // ── OFFICE ────────────────────────────────────────────────────────────────

  /**
   * Paginated list of collection requests for the org, newest first. Search
   * matches customer or project name. `status` filters on the derived status.
   */
  async listRequests(
    organizationId: string,
    opts: { page?: number; limit?: number; search?: string; status?: string } = {},
  ) {
    const page = Math.max(1, opts.page ?? 1);
    const limit = Math.min(100, Math.max(1, opts.limit ?? 10));
    const search = opts.search?.trim();
    const where: Prisma.CustomerInfoRequestWhereInput = {
      organizationId,
      ...(search
        ? {
            OR: [
              { customerName: { contains: search, mode: 'insensitive' } },
              { projectName: { contains: search, mode: 'insensitive' } },
            ],
          }
        : {}),
    };
    const [rows, total] = await Promise.all([
      this.prisma.customerInfoRequest.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip: (page - 1) * limit,
        take: limit,
        select: {
          id: true,
          customerName: true,
          projectName: true,
          createdAt: true,
          submittedAt: true,
          expiresAt: true,
          revokedAt: true,
          submissionCount: true,
        },
      }),
      this.prisma.customerInfoRequest.count({ where }),
    ]);
    let docs = rows.map((r) => ({ ...r, status: this.requestStatus(r) }));
    // Status is derived, so filter after mapping (small page sizes).
    if (opts.status) docs = docs.filter((d) => d.status === opts.status);
    return { docs, total, page, limit, totalPages: Math.max(1, Math.ceil(total / limit)) };
  }

  /** Full detail for one request: header + CURRENT contacts split by group. */
  async getRequest(id: string, organizationId: string) {
    const req = await this.prisma.customerInfoRequest.findFirst({
      where: { id, organizationId },
      include: {
        // Only the current (non-superseded) set; superseded rows are kept for
        // reconciliation but never shown as the live answer.
        contacts: {
          where: { supersededAt: null },
          orderBy: [{ group: 'asc' }, { sortOrder: 'asc' }],
          select: { id: true, group: true, name: true, email: true, phone: true },
        },
      },
    });
    if (!req) throw new NotFoundException('Customer information request not found');
    // Resolve the linked PO document's current name (fresh, not the snapshot) so
    // the office sees where it lives; the file itself opens via the documents UI.
    let poDocumentName: string | null = null;
    let poDocumentType: string | null = null;
    let poTemplateId: string | null = null;
    if (req.poDocumentId) {
      const po = await this.prisma.document.findFirst({
        where: { id: req.poDocumentId, organizationId },
        select: { name: true, type: true, documentTemplateId: true },
      });
      poDocumentName = po?.name ?? null;
      poDocumentType = po?.type ?? null;
      poTemplateId = po?.documentTemplateId ?? null;
    }
    return {
      id: req.id,
      customerId: req.customerId,
      projectId: req.projectId,
      customerName: req.customerName,
      projectName: req.projectName,
      status: this.requestStatus(req),
      token: req.token,
      createdAt: req.createdAt,
      expiresAt: req.expiresAt,
      revokedAt: req.revokedAt,
      submittedAt: req.submittedAt,
      submissionCount: req.submissionCount,
      poDocumentId: req.poDocumentId,
      poNumber: req.poNumber,
      poDocumentName,
      poDocumentType,
      poTemplateId,
      doContacts: req.contacts.filter((c) => c.group === 'DO'),
      invoiceContacts: req.contacts.filter((c) => c.group === 'INVOICE'),
    };
  }

  /**
   * Mint a new collection link for an existing customer + project. Snapshots the
   * names so the list + public page never join Customer/Project. Returns the id
   * + token (the controller/client builds the public URL).
   */
  async createRequest(
    organizationId: string,
    dto: { customerId: string; projectId: string },
    createdBy: string | null,
  ) {
    const customer = await this.prisma.customer.findFirst({
      where: { id: dto.customerId, organizationId },
      select: { id: true, name: true },
    });
    if (!customer) throw new NotFoundException('Customer not found in this organization');
    const project = await this.prisma.project.findFirst({
      where: { id: dto.projectId, organizationId },
      select: { id: true, name: true },
    });
    if (!project) throw new NotFoundException('Project not found in this organization');

    const created = await this.prisma.customerInfoRequest.create({
      data: {
        organizationId,
        token: this.generateToken(),
        customerId: customer.id,
        projectId: project.id,
        customerName: customer.name,
        projectName: project.name,
        createdBy: createdBy ?? null,
        expiresAt: new Date(Date.now() + LINK_WINDOW_MS),
      },
      select: { id: true, token: true, expiresAt: true },
    });
    return created;
  }

  /** Revoke a request's link (idempotent). */
  async revokeRequest(id: string, organizationId: string) {
    const req = await this.prisma.customerInfoRequest.findFirst({
      where: { id, organizationId },
      select: { id: true, revokedAt: true },
    });
    if (!req) throw new NotFoundException('Customer information request not found');
    if (req.revokedAt) return { revoked: false, alreadyRevoked: true };
    await this.prisma.customerInfoRequest.update({
      where: { id: req.id },
      data: { revokedAt: new Date() },
    });
    return { revoked: true };
  }

  /**
   * Regenerate: revoke the old request and mint a fresh one for the same
   * customer + project (new token, fresh 30-day window). Any contacts already
   * collected on the old request stay on it for reconciliation; the new request
   * starts empty. Returns the new id + token.
   */
  async regenerateRequest(id: string, organizationId: string, createdBy: string | null) {
    const req = await this.prisma.customerInfoRequest.findFirst({
      where: { id, organizationId },
      select: { id: true, customerId: true, projectId: true, customerName: true, projectName: true },
    });
    if (!req) throw new NotFoundException('Customer information request not found');
    return this.prisma.$transaction(async (tx) => {
      await tx.customerInfoRequest.update({
        where: { id: req.id },
        data: { revokedAt: new Date() },
      });
      const created = await tx.customerInfoRequest.create({
        data: {
          organizationId,
          token: this.generateToken(),
          customerId: req.customerId,
          projectId: req.projectId,
          customerName: req.customerName,
          projectName: req.projectName,
          createdBy: createdBy ?? null,
          expiresAt: new Date(Date.now() + LINK_WINDOW_MS),
        },
        select: { id: true, token: true, expiresAt: true },
      });
      return created;
    });
  }

  // ── PUBLIC (token) ──────────────────────────────────────────────────────────

  private async resolveToken(token: string) {
    const link = await this.prisma.customerInfoRequest.findUnique({
      where: { token },
      select: {
        id: true,
        organizationId: true,
        projectId: true,
        customerId: true,
        revokedAt: true,
        expiresAt: true,
        submittedAt: true,
        customerName: true,
        projectName: true,
      },
    });
    if (!link) return { link: null, state: 'notfound' as TokenState };
    let state: TokenState = 'ok';
    if (link.revokedAt) state = 'revoked';
    else if (link.expiresAt && link.expiresAt.getTime() < Date.now()) state = 'expired';
    return { link, state };
  }

  private assertActionable(state: TokenState) {
    if (state === 'ok') return;
    const messages: Record<Exclude<TokenState, 'ok'>, string> = {
      expired: 'This link has expired. Please ask the sender for a new one.',
      revoked: 'This link is no longer active.',
      notfound: 'This link was not found.',
    };
    // 410 Gone: the link resolved but is no longer usable.
    throw new HttpException(messages[state], HttpStatus.GONE);
  }

  /**
   * Read-only view for the public page. Never errors on state: returns 200 with
   * `state` so the page renders the right screen. For an `ok` (or already
   * submitted, still editable) link it returns the CURRENT contacts so a
   * resubmission is prefilled.
   */
  async getPublicView(token: string) {
    const { link, state } = await this.resolveToken(token);
    if (!link || state !== 'ok') {
      return {
        state,
        customerName: null as string | null,
        projectName: null as string | null,
        submittedAt: null as Date | null,
        doContacts: [] as Array<{ name: string; email: string | null; phone: string | null }>,
        invoiceContacts: [] as Array<{ name: string; email: string | null; phone: string | null }>,
      };
    }
    const contacts = await this.prisma.customerInfoContact.findMany({
      where: { requestId: link.id, supersededAt: null },
      orderBy: [{ group: 'asc' }, { sortOrder: 'asc' }],
      select: { group: true, name: true, email: true, phone: true },
    });
    return {
      state,
      customerName: link.customerName,
      projectName: link.projectName,
      submittedAt: link.submittedAt,
      doContacts: contacts.filter((c) => c.group === 'DO').map(({ name, email, phone }) => ({ name, email, phone })),
      invoiceContacts: contacts.filter((c) => c.group === 'INVOICE').map(({ name, email, phone }) => ({ name, email, phone })),
    };
  }

  /**
   * Submit (or resubmit) the two contact groups. Soft-supersede: the current set
   * is stamped supersededAt and a fresh set inserted, so prior input is kept as
   * evidence and the "current" view is simply supersededAt IS NULL. One
   * transaction so the request never sits with two live sets or none.
   */
  /**
   * OFFICE ACCEPT — copy a submitted request's live contacts onto the PROJECT.
   *
   * The request stays the submission RECORD: its CustomerInfoContact rows are
   * never deleted or edited here, because they are the evidence of what the
   * customer actually said. This only mirrors them forward into the structures
   * documents already read (CustomerContact + ProjectContact →
   * projectFirstContactAttention → the DO/RDO Attention).
   *
   * Deliberately explicit rather than automatic on submit: 18 Holland Drive
   * carries three requests and two submissions with different people, so an
   * auto-copy would change contacts under an already-issued document.
   *
   * MATCHING (as decided): by email within the customer, else create. A contact
   * with NO email falls back to a name match — without that, a phone-only
   * contact would be recreated on every re-accept, which is exactly the
   * duplication the re-sync is meant to avoid.
   *
   * RE-ACCEPT IS A SYNC, NOT AN APPEND. Rows this flow owns (group NOT NULL)
   * that are absent from the new set are detached; rows the delivery contact
   * picker attached (group NULL) are left alone — they may be feeding the
   * Attention on an already-issued DO, and this flow did not create them so it
   * does not get to remove them. Detaching drops the ProjectContact LINK only;
   * the CustomerContact person survives for reuse on other projects.
   */
  /**
   * Everything the PROJECT page needs in one read: the project's requests with
   * a derived status, and the contacts currently attached to the project.
   *
   * `liveUnsubmitted` is what the "Request customer info" button checks before
   * minting — 18 Holland Drive already carries three requests because nothing
   * looked first. Reusing an existing live link is always preferable to a
   * second one: both would work, and the office cannot tell which the customer
   * received.
   *
   * Status is derived, not stored:
   *   revoked   → revokedAt set
   *   expired   → past expiresAt and never submitted
   *   outstanding        → never submitted
   *   awaiting_accept    → submitted, and submittedAt is newer than acceptedAt
   *                        (covers both never-accepted and RESUBMITTED-since)
   *   accepted           → accepted at or after the latest submission
   */
  async getProjectView(projectId: string, organizationId: string) {
    const project = await this.prisma.project.findFirst({
      where: { id: projectId, organizationId },
      select: { id: true, customerId: true },
    });
    if (!project) throw new NotFoundException('Project not found in this organization');

    const rows = await this.prisma.customerInfoRequest.findMany({
      where: { organizationId, projectId },
      orderBy: { createdAt: 'desc' },
      select: {
        id: true, token: true, customerName: true, projectName: true,
        createdAt: true, expiresAt: true, revokedAt: true,
        submittedAt: true, submissionCount: true, acceptedAt: true,
        contacts: {
          where: { supersededAt: null },
          orderBy: { sortOrder: 'asc' },
          select: { name: true, email: true, phone: true, group: true },
        },
      },
    });

    const now = Date.now();
    const requests = rows.map((r) => {
      const expired = !!r.expiresAt && r.expiresAt.getTime() <= now;
      const status = r.revokedAt
        ? 'revoked'
        : !r.submittedAt
          ? expired ? 'expired' : 'outstanding'
          : !r.acceptedAt || r.submittedAt.getTime() > r.acceptedAt.getTime()
            ? 'awaiting_accept'
            : 'accepted';
      return { ...r, status, isLive: !r.revokedAt && !expired };
    });

    // Contacts attached to the project today — the same rows
    // projectFirstContactAttention reads for the DO/RDO Attention.
    const links = await this.prisma.projectContact.findMany({
      where: { projectId },
      orderBy: { createdAt: 'asc' },
      select: {
        id: true, group: true, createdAt: true,
        customerContact: { select: { id: true, name: true, email: true, phone: true, designation: true, isPrimary: true } },
      },
    });
    const contacts = links.map((l) => ({
      linkId: l.id,
      group: l.group,               // 'DO' | 'INVOICE' | null (picker-attached)
      ...l.customerContact,
    }));

    return {
      projectId: project.id,
      customerId: project.customerId,
      requests,
      // The link to reuse instead of minting a second one.
      liveUnsubmitted: requests.find((r) => r.status === 'outstanding') ?? null,
      contacts: {
        DO: contacts.filter((c) => c.group === 'DO'),
        INVOICE: contacts.filter((c) => c.group === 'INVOICE'),
        // Attached by the delivery contact picker before groups existed. Shown
        // so the office can see everything feeding the Attention, not just what
        // came through a customer-info submission.
        UNGROUPED: contacts.filter((c) => !c.group),
      },
    };
  }

  async acceptRequest(id: string, organizationId: string, acceptedBy: string | null) {
    const req = await this.prisma.customerInfoRequest.findFirst({
      where: { id, organizationId },
      select: {
        id: true, customerId: true, projectId: true, submittedAt: true,
        acceptedAt: true, submissionCount: true,
      },
    });
    if (!req) throw new NotFoundException('Request not found');
    if (!req.submittedAt) {
      throw new BadRequestException('This request has not been submitted yet — nothing to accept');
    }

    // The customer and project are plain UUID columns (no FK), so re-validate
    // both still exist in this org rather than trusting the snapshot.
    const customer = await this.prisma.customer.findFirst({
      where: { id: req.customerId, organizationId }, select: { id: true },
    });
    if (!customer) throw new NotFoundException('The customer on this request no longer exists');
    const project = await this.prisma.project.findFirst({
      where: { id: req.projectId, organizationId }, select: { id: true },
    });
    if (!project) throw new NotFoundException('The project on this request no longer exists');

    const live = await this.prisma.customerInfoContact.findMany({
      where: { requestId: req.id, supersededAt: null },
      orderBy: { sortOrder: 'asc' },
      select: { name: true, email: true, phone: true, group: true },
    });
    if (live.length === 0) {
      throw new BadRequestException('This submission has no live contacts to accept');
    }

    const norm = (v: string | null | undefined) => (v ?? '').trim().toLowerCase();
    const result = await this.prisma.$transaction(async (tx) => {
      const existingPeople = await tx.customerContact.findMany({
        where: { customerId: customer.id },
        select: { id: true, name: true, email: true, phone: true },
      });

      const keptLinkIds: string[] = [];
      let peopleCreated = 0, peopleUpdated = 0, linksCreated = 0, linksUpdated = 0;

      for (const c of live) {
        const email = norm(c.email);
        const match =
          (email && existingPeople.find((p) => norm(p.email) === email)) ||
          (!email && existingPeople.find((p) => norm(p.name) === norm(c.name))) ||
          null;

        let personId: string;
        if (match) {
          personId = match.id;
          // Fill blanks from the submission; never blank out what we already
          // hold with an empty field the customer left behind.
          const data: Prisma.CustomerContactUpdateInput = {};
          if (c.name.trim() && c.name.trim() !== match.name) data.name = c.name.trim();
          if (c.email?.trim() && !match.email) data.email = c.email.trim();
          if (c.phone?.trim() && !match.phone) data.phone = c.phone.trim();
          if (Object.keys(data).length) {
            await tx.customerContact.update({ where: { id: personId }, data });
            peopleUpdated++;
          }
        } else {
          const created = await tx.customerContact.create({
            data: {
              customerId: customer.id,
              name: c.name.trim(),
              email: c.email?.trim() || null,
              phone: c.phone?.trim() || null,
            },
            select: { id: true, name: true, email: true, phone: true },
          });
          existingPeople.push(created); // so a duplicate row in the SAME submission reuses it
          personId = created.id;
          peopleCreated++;
        }

        // ProjectContact is unique on (projectId, customerContactId), so the
        // same person appearing as BOTH a DO and an INVOICE contact collapses to
        // one link. Last group in sortOrder order wins; the alternative is a
        // schema change to allow two links per person per project.
        const link = await tx.projectContact.upsert({
          where: { projectId_customerContactId: { projectId: project.id, customerContactId: personId } },
          update: { group: c.group },
          create: { projectId: project.id, customerContactId: personId, group: c.group },
          select: { id: true },
        });
        keptLinkIds.push(link.id);
        linksCreated++;
      }

      // Detach only rows THIS flow owns (group NOT NULL) that the new set drops.
      const detached = await tx.projectContact.deleteMany({
        where: { projectId: project.id, group: { not: null }, id: { notIn: keptLinkIds } },
      });

      const now = new Date();
      await tx.customerInfoRequest.update({
        where: { id: req.id },
        data: { acceptedAt: now, acceptedBy: acceptedBy ?? null },
      });

      return {
        acceptedAt: now,
        contactsAccepted: live.length,
        peopleCreated, peopleUpdated,
        linksSynced: linksCreated - linksUpdated,
        linksDetached: detached.count,
      };
    });

    return { ok: true, ...result };
  }

  async submit(token: string, dto: SubmitCustomerInfoDto) {
    const { link, state } = await this.resolveToken(token);
    this.assertActionable(state);
    if (!link) throw new NotFoundException('This link was not found');

    const clean = (rows: SubmitCustomerInfoDto['doContacts'], group: ContactGroup) =>
      (rows ?? [])
        .map((c) => ({
          name: (c.name ?? '').trim(),
          email: c.email?.trim() || null,
          phone: c.phone?.trim() || null,
          group,
        }))
        // A row with no name is dropped (empty field the recipient left behind).
        .filter((c) => c.name.length > 0);

    const doRows = clean(dto.doContacts, 'DO');
    const invoiceRows = clean(dto.invoiceContacts, 'INVOICE');
    if (doRows.length === 0 && invoiceRows.length === 0) {
      throw new BadRequestException('Add at least one contact before submitting');
    }

    const now = new Date();
    await this.prisma.$transaction(async (tx) => {
      // Supersede the current live set (if any) — kept for reconciliation.
      await tx.customerInfoContact.updateMany({
        where: { requestId: link.id, supersededAt: null },
        data: { supersededAt: now },
      });
      const all = [...doRows, ...invoiceRows];
      await tx.customerInfoContact.createMany({
        data: all.map((c, i) => ({
          requestId: link.id,
          group: c.group,
          name: c.name,
          email: c.email,
          phone: c.phone,
          sortOrder: i,
        })),
      });
      await tx.customerInfoRequest.update({
        where: { id: link.id },
        data: { submittedAt: now, submissionCount: { increment: 1 } },
      });
    });
    return { ok: true, submittedAt: now };
  }

}
