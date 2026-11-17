import { runAsOrg } from '../common/tenancy/tenant-context';

/**
 * Who a quotation's Sales Person field means (WCT group, 2026-11-18). ONE resolver for the Sales report and
 * the jobs calendar fill:
 *   1. a salesman code (S002, any case) or a user id of the org  -> that user;
 *   2. the org's alias map (exact text, spaces collapsed, any case) -> its user(s), in the order stored;
 *   3. the name rules (a name in the text is a user's full or first name) -> those users, when names are known;
 *   4. nothing: the text stays a raw name.
 *
 * The alias map is one CustomField row per org (entityType 'Quotation', fieldName 'salesperson_aliases',
 * options [{ text, userIds }]), written by scripts/wct-salesperson-aliases.ts. Orgs without the row: an empty
 * map, so steps 1, 3 and 4 behave exactly as before.
 */
export const SALESPERSON_ALIAS_ENTITY = 'Quotation';
export const SALESPERSON_ALIAS_FIELD = 'salesperson_aliases';

export type AliasMap = Map<string, string[]>;

export const normName = (s: unknown): string => (typeof s === 'string' ? s.replace(/\s+/g, ' ').trim().toLowerCase() : '');

/** The stored options as a map: normalised text -> user ids (entries without users are skipped). */
export function aliasMapOf(options: unknown): AliasMap {
  const out: AliasMap = new Map();
  if (!Array.isArray(options)) return out;
  for (const o of options) {
    const key = normName((o as any)?.text);
    const ids = Array.isArray((o as any)?.userIds) ? (o as any).userIds.filter((x: unknown) => typeof x === 'string' && x) : [];
    if (key && ids.length && !out.has(key)) out.set(key, ids);
  }
  return out;
}

/** The org's alias map (empty when it has none). Never throws. */
export async function salespersonAliases(prisma: any, organizationId: string): Promise<AliasMap> {
  try {
    const row = await runAsOrg(organizationId, () =>
      prisma.customField.findFirst({
        where: { organizationId, entityType: SALESPERSON_ALIAS_ENTITY, fieldName: SALESPERSON_ALIAS_FIELD, isActive: true },
        select: { options: true },
      }),
    );
    return aliasMapOf((row as any)?.options);
  } catch {
    return new Map();
  }
}

export interface ResolveContext {
  /** Salesman code (upper case) -> user id. */
  codes: Map<string, string>;
  /** User ids of the org (a picker may store the id itself). */
  userIds?: Set<string>;
  aliases: AliasMap;
  /** Step 3, only when names are known (the report has them; the calendar does not). */
  nameRule?: (text: string) => string[];
}

/** The user ids the field means (first = the main one), or [] for blank / a raw name nobody matches. */
export function resolveSalespersonIds(raw: unknown, ctx: ResolveContext): string[] {
  const s = typeof raw === 'string' ? raw.trim() : '';
  if (!s) return [];
  const byCode = ctx.codes.get(s.toUpperCase());
  if (byCode) return [byCode];
  if (ctx.userIds?.has(s)) return [s];
  const mapped = ctx.aliases.get(normName(s));
  if (mapped?.length) return [...mapped];
  return ctx.nameRule ? ctx.nameRule(s) : [];
}
