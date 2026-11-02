/**
 * Multi-organisation users (2026-11-02). A user may belong to several orgs with
 * a role in each; the portal sends the org of the tab as X-Active-Org-Id.
 *
 *  - The header is honoured only for an org the user is an ACTIVE member of
 *    (osiris admins: any org, as before). Any other org is a 403: the request
 *    never silently falls back to another org's data.
 *  - No header: the default org = the membership used most recently
 *    (UserOrganization.lastActiveAt, written by POST /users/me/active-org),
 *    then the oldest membership. Never an arbitrary row.
 *  - An org admin adds a person with "Add user" (src/users/memberships.service.ts).
 */

export const NOT_A_MEMBER_MESSAGE = 'You are not a member of that organisation';

/** Prisma orderBy for "the user's default org". */
export const DEFAULT_MEMBERSHIP_ORDER = [{ lastActiveAt: { sort: 'desc', nulls: 'last' } }, { joinedAt: 'asc' }] as const;

export const normEmail = (e: unknown) =>
  String(e ?? '')
    .trim()
    .toLowerCase();

/** A plausible email address (the form's own check; Clerk validates for real). */
export const isEmail = (e: unknown) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(normEmail(e));
