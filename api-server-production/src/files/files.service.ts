import { ForbiddenException, Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../common/prisma.service';
import { S3Service } from '../common/services/s3.service';
import { orgOfKey } from '../common/storage-keys';
import { memberOrgIds } from '../organizations/org-group';

/**
 * ORG-CHECKED FILE ACCESS (security phase 1, 2026-11-24).
 *
 * Every stored file belongs to one org: the StoredFile registry row (written on
 * upload, legacy keys filled by the backfill script) or, for server-built keys,
 * the org in the key itself (org/<id>/..., vehicles/<id>/..., shipments/<id>/...).
 * Files open only through short-lived presigned links handed out here after a
 * membership check.
 *
 * Keys with no known org (legacy keys not yet backfilled) stay readable by any
 * signed-in user until FILES_STRICT=1 is set (after the backfill is applied):
 * the bucket is still public until Phase 4, so this loses nothing meanwhile.
 *
 * WHO MAY OPEN A FILE (owner's rule, 2026-11-25, all orgs): anyone with access
 * to the FILE's org, whichever org they are viewing. Access to an org = the org
 * the auth guard is serving this request (it only serves a non-admin an org
 * they belong to) or another org where they have an active membership AND an
 * active role (org-group.ts memberOrgIds: the same rule the WCT group uses to
 * open another company's documents, e.g. the cross-company invoice pills on BC
 * Air orders). Being in an org group gives no access by itself: a WCT (S)-only
 * user never opens BC Air files. Platform admins: any file.
 */

export const SIGN_TTL_SECONDS = 600;
const BUCKET = process.env.RESOURCE_BUCKET || 'aims-osiris';

/** Our bucket's public URL prefixes (virtual-hosted and path style). */
const BUCKET_URL_RE = new RegExp(
  `^https?://(?:${BUCKET}\\.s3(?:[.-][a-z0-9-]+)?\\.amazonaws\\.com/|s3(?:[.-][a-z0-9-]+)?\\.amazonaws\\.com/${BUCKET}/)`,
  'i',
);

/** A stored value → our bucket key: a key stays a key, a public/presigned URL of our bucket becomes its key, anything else null. */
export function normalizeStoredKey(v: unknown): string | null {
  if (typeof v !== 'string') return null;
  let s = v.trim();
  if (!s || s.startsWith('data:') || s.startsWith('blob:')) return null;
  if (/^https?:\/\//i.test(s)) {
    if (!BUCKET_URL_RE.test(s)) return null;
    s = s.replace(BUCKET_URL_RE, '').split(/[?#]/)[0];
    try {
      s = decodeURIComponent(s);
    } catch {
      /* keep as is */
    }
  }
  s = s.replace(/^\/+/, '');
  if (!s || s.length > 600 || s.includes('..') || /[\u0000-\u001f]/.test(s)) return null;
  return s;
}

export type FileActor = { userId?: string | null; activeOrgId?: string | null; platform?: boolean };
type Owner = { org: string | null; quarantined: boolean; shared: string[] };

const strict = () => process.env.FILES_STRICT === '1';

@Injectable()
export class FilesService {
  private readonly logger = new Logger(FilesService.name);
  constructor(
    private readonly prisma: PrismaService,
    private readonly s3: S3Service,
  ) {}

  /** Record who owns a key (first writer wins; never moves a key to another org). */
  async register(key: string, organizationId: string, uploadedBy?: string | null, source = 'upload'): Promise<void> {
    try {
      await (this.prisma as any).storedFile.createMany({ data: [{ key, organizationId, uploadedBy: uploadedBy ?? null, source }], skipDuplicates: true });
    } catch (e: any) {
      this.logger.warn(`StoredFile register failed for ${key}: ${e?.message}`);
    }
  }

  /** Owner org of each key: registry first, then the org encoded in the key. */
  async owners(keys: string[]): Promise<Map<string, Owner>> {
    const out = new Map<string, Owner>();
    const uniq = [...new Set(keys)];
    let rows: { key: string; organizationId: string; quarantined: boolean; sharedOrgIds?: string[] }[] = [];
    if (uniq.length) {
      try {
        rows = await (this.prisma as any).storedFile.findMany({ where: { key: { in: uniq } }, select: { key: true, organizationId: true, quarantined: true, sharedOrgIds: true } });
      } catch (e: any) {
        this.logger.warn(`StoredFile lookup failed: ${e?.message}`);
      }
    }
    const byKey = new Map(rows.map((r) => [r.key, r]));
    for (const k of uniq) {
      const r = byKey.get(k);
      out.set(k, r ? { org: r.organizationId, quarantined: !!r.quarantined, shared: r.sharedOrgIds ?? [] } : { org: orgOfKey(k), quarantined: false, shared: [] });
    }
    return out;
  }

  /** Of `orgIds`, the orgs this actor has access to besides the one being viewed (membership + role, see the top). */
  private async memberOrgs(actor: FileActor, orgIds: Iterable<string | null | undefined>): Promise<Set<string>> {
    const ids = [...new Set([...orgIds].filter((o): o is string => !!o && o !== actor.activeOrgId))];
    if (!actor.userId || !ids.length || actor.platform) return new Set();
    return memberOrgIds(this.prisma, actor.userId, ids);
  }

  private static ownerOrgs(owners: Iterable<Owner>): string[] {
    const out: string[] = [];
    for (const o of owners) out.push(...[o.org, ...o.shared].filter((x): x is string => !!x));
    return out;
  }

  /** May this actor open the key? */
  private allowed(owner: Owner, actor: FileActor, members: Set<string>): boolean {
    if (actor.platform) return true;
    // Quarantined (referenced by several orgs): only those orgs, never anyone else.
    if (owner.quarantined) return [owner.org, ...owner.shared].some((o) => !!o && (o === actor.activeOrgId || members.has(o)));
    if (!owner.org) return !strict() && !!(actor.userId || actor.activeOrgId);
    return owner.org === actor.activeOrgId || members.has(owner.org);
  }

  /**
   * POST /files/sign: { key → short-lived URL | null }. Accepts keys or stored
   * full URLs of our bucket. A key the actor may not open maps to null.
   */
  async sign(inputs: unknown[], actor: FileActor, opts: { ttl?: number; downloadAs?: string } = {}): Promise<Record<string, string | null>> {
    const list = (Array.isArray(inputs) ? inputs : []).filter((x) => typeof x === 'string').slice(0, 200) as string[];
    const keyOf = new Map(list.map((i) => [i, normalizeStoredKey(i)]));
    const keys = [...keyOf.values()].filter(Boolean) as string[];
    const owners = await this.owners(keys);
    const members = await this.memberOrgs(actor, FilesService.ownerOrgs(owners.values()));
    const out: Record<string, string | null> = {};
    for (const input of list) {
      const key = keyOf.get(input);
      if (!key) {
        out[input] = null;
        continue;
      }
      const owner = owners.get(key)!;
      out[input] = this.allowed(owner, actor, members) ? await this.s3.getSignedUrl(key, opts.ttl ?? SIGN_TTL_SECONDS, opts.downloadAs) : null;
    }
    return out;
  }

  /**
   * Server-side presign with NO user check: only for renderers / public token
   * flows that already proved access to the record that references the key.
   * Non-bucket values (data: URIs, other hosts) are returned unchanged.
   */
  async presignTrusted(v: string | null | undefined, ttl = 3600): Promise<string | null | undefined> {
    if (!v) return v;
    const key = normalizeStoredKey(v);
    if (!key) return v;
    return this.s3.getSignedUrl(key, ttl);
  }

  /**
   * Records may only reference keys of their own org, or (with `actor`, a
   * signed-in write) of an org the actor has access to (the same rule as
   * opening: membership + role there). Refuses any other org's key. Unknown
   * legacy keys pass until FILES_STRICT=1. Values that are not our bucket's
   * keys are ignored. Without `actor` (public token flows): own org only.
   */
  async assertOwnKeys(organizationId: string, values: unknown[], actor?: FileActor): Promise<void> {
    const keys = (values || []).map(normalizeStoredKey).filter(Boolean) as string[];
    if (!keys.length || actor?.platform) return;
    const owners = await this.owners(keys);
    const foreign = [...owners.values()].filter((o) => !o.quarantined && o.org && o.org !== organizationId);
    const members = actor && foreign.length ? await this.memberOrgs({ ...actor, activeOrgId: organizationId }, foreign.map((o) => o.org)) : new Set<string>();
    for (const [, o] of owners) {
      // Quarantined keys (several orgs) are not refused here: reading them is gated instead.
      if (o.quarantined) continue;
      if (o.org ? o.org !== organizationId && !members.has(o.org) : strict()) {
        throw new ForbiddenException('A file does not belong to this organisation');
      }
    }
  }
}
