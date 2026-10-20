import { Inject, Injectable, Logger, NotFoundException } from '@nestjs/common';
import type { ClerkClient, User } from '@clerk/backend';
import { CLERK_CLIENT } from './clerk.constants';

/**
 * DB user id  ->  Clerk user, for every Clerk Backend API call that starts
 * from an id stored in OUR database (UserRole.userId, UserOrganization.userId,
 * Customer salesman, trade-alert recipients, operator /as, ...).
 *
 * Why this exists (Clerk production cutover, docs/clerk-cutover.md): the DB
 * keeps the ids users had on the Clerk DEVELOPMENT instance. Users imported
 * into the PRODUCTION instance get NEW Clerk ids, with the old one stored as
 * the Clerk `external_id`. So a DB id is either
 *   - a legacy id  -> the prod user whose externalId equals it, or
 *   - a native id  -> the Clerk user with that id (created after the move, or
 *                     any user on the dev instance, where nothing is imported).
 * Lookup order is externalId first, then userId; both are batched
 * getUserList calls. On the dev instance (no external ids, or external_id ==
 * own id) the result is exactly what users.getUser(id) returned before.
 *
 * Cached per DB id for CACHE_TTL_MS; invalidate(dbId) after an update/delete.
 */
@Injectable()
export class ClerkIdentityService {
  private readonly logger = new Logger(ClerkIdentityService.name);
  private static readonly CACHE_TTL_MS = 5 * 60 * 1000;
  private static readonly PAGE = 100; // Clerk getUserList max per request
  private readonly cache = new Map<string, { user: User; at: number }>();

  constructor(@Inject(CLERK_CLIENT) private readonly clerk: ClerkClient) {}

  /** Clerk users for the given DB ids, keyed by DB id. Unknown ids are absent. */
  async toClerkUsers(dbIds: Iterable<string | null | undefined>): Promise<Map<string, User>> {
    const out = new Map<string, User>();
    const now = Date.now();
    const misses: string[] = [];
    for (const id of new Set([...dbIds].filter((v): v is string => !!v))) {
      const hit = this.cache.get(id);
      if (hit && now - hit.at < ClerkIdentityService.CACHE_TTL_MS) out.set(id, hit.user);
      else misses.push(id);
    }
    if (!misses.length) return out;

    // 1) Legacy ids: the user carrying it as external_id (prod after import).
    const byExternal = await this.listBy('externalId', misses);
    for (const u of byExternal) {
      if (u.externalId && misses.includes(u.externalId) && !out.has(u.externalId)) this.put(out, u.externalId, u);
    }
    // 2) Native ids: the Clerk user with that id.
    const rest = misses.filter((id) => !out.has(id));
    if (rest.length) {
      for (const u of await this.listBy('userId', rest)) {
        if (rest.includes(u.id) && !out.has(u.id)) this.put(out, u.id, u);
      }
    }
    return out;
  }

  /**
   * One user; throws NotFoundException like users.getUser did for an unknown id.
   * `fresh` skips the cache: use it before a write that compares current values.
   */
  async toClerkUser(dbId: string, opts: { fresh?: boolean } = {}): Promise<User> {
    if (opts.fresh) this.invalidate(dbId);
    const u = (await this.toClerkUsers([dbId])).get(dbId);
    if (!u) throw new NotFoundException(`Clerk user not found for ${dbId}`);
    return u;
  }

  /** The Clerk id to pass to write calls (updateUser / deleteUser). */
  async toClerkId(dbId: string): Promise<string> {
    return (await this.toClerkUser(dbId)).id;
  }

  /**
   * Stamp a freshly created user's external_id with its own Clerk id, so every
   * user on an instance resolves the same way (by external_id). Non-fatal: the
   * userId fallback in toClerkUsers covers a user without one.
   */
  async stampExternalId(clerkUserId: string): Promise<void> {
    try {
      await this.clerk.users.updateUser(clerkUserId, { externalId: clerkUserId });
    } catch (e: any) {
      this.logger.warn(`Could not set external_id on ${clerkUserId}: ${e?.message ?? e}`);
    }
  }

  invalidate(dbId?: string) {
    if (dbId) this.cache.delete(dbId);
    else this.cache.clear();
  }

  private put(out: Map<string, User>, dbId: string, user: User) {
    out.set(dbId, user);
    this.cache.set(dbId, { user, at: Date.now() });
  }

  private async listBy(key: 'externalId' | 'userId', ids: string[]): Promise<User[]> {
    const found: User[] = [];
    for (let i = 0; i < ids.length; i += ClerkIdentityService.PAGE) {
      const chunk = ids.slice(i, i + ClerkIdentityService.PAGE);
      try {
        const res: any = await this.clerk.users.getUserList({ [key]: chunk, limit: ClerkIdentityService.PAGE } as any);
        found.push(...((Array.isArray(res) ? res : res?.data) ?? []));
      } catch (e: any) {
        this.logger.warn(`getUserList by ${key} failed for ${chunk.length} id(s): ${e?.message ?? e}`);
      }
    }
    return found;
  }
}
