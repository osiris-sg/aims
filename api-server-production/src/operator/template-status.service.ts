/**
 * Round AD (owner, 2026-10-23): which WhatsApp template a push uses is decided in CODE from what Meta has APPROVED
 * on the sending line's WABA — no Render env change needed. The env vars stay as optional overrides.
 *
 *   shipments pushes (digest / needs_check / new_deal / recheck), per language:
 *     WHATSAPP_<KIND>_TEMPLATE if set  →  aims_<kind>_v2 if APPROVED  →  aims_<kind> if APPROVED  →  '' (plain text)
 *   closed-window notify fallback:
 *     org WITH the SHIPMENTS module:  WHATSAPP_NOTIFY_TEMPLATE if set → aims_notify_utility if APPROVED → aims_notify
 *     every other org:                WHATSAPP_NOTIFY_TEMPLATE || aims_notify   (exactly as before)
 *
 * The template list per WABA is cached for 6 hours (a miss fetches it; a Graph error keeps the last good list); the
 * nightly template audit primes it. Everything here reads; it never creates or edits a template.
 */
import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../common/prisma.service';
import { ANSWER_TEMPLATE_NAME, AnswerTemplateKind } from './push-text';

export type ShipmentsTemplateKind = 'digest' | 'needs_check' | 'new_deal' | 'recheck';
export interface TemplateRow {
  name: string;
  language: string;
  status: string;
}

const ENV: Record<ShipmentsTemplateKind | 'notify', string> = { digest: 'WHATSAPP_DIGEST_TEMPLATE', needs_check: 'WHATSAPP_NEEDS_TEMPLATE', new_deal: 'WHATSAPP_NEW_DEAL_TEMPLATE', recheck: 'WHATSAPP_RECHECK_TEMPLATE', notify: 'WHATSAPP_NOTIFY_TEMPLATE' };
export const SHIPMENTS_TEMPLATE_BASE: Record<ShipmentsTemplateKind, string> = { digest: 'aims_digest', needs_check: 'aims_needs_check', new_deal: 'aims_new_deal', recheck: 'aims_recheck' };
export const NOTIFY_TEMPLATE = 'aims_notify';
export const NOTIFY_UTILITY_TEMPLATE = 'aims_notify_utility';
const CACHE_MS = 6 * 3600_000;
const MODULE_CACHE_MS = 60_000;

export const isApproved = (rows: TemplateRow[], name: string, lang: string) => rows.some((t) => t.name === name && t.status === 'APPROVED' && (t.language === lang || t.language.startsWith(`${lang}_`)));

/** Pure: the shipments template for a kind + language from the WABA's rows (env override first). */
export function pickShipmentsTemplate(rows: TemplateRow[], kind: ShipmentsTemplateKind, lang: 'en' | 'ja', env: NodeJS.ProcessEnv = process.env): string {
  const override = (env[ENV[kind]] ?? '').trim();
  if (override) return override;
  const base = SHIPMENTS_TEMPLATE_BASE[kind];
  if (isApproved(rows, `${base}_v2`, lang)) return `${base}_v2`;
  if (isApproved(rows, base, lang)) return base;
  return '';
}

/** Round AE: the "needs your answer" family — the ONE message AIMS sends on its own. APPROVED on the line's WABA → its name, else '' (plain text inside the window; the outbox holds the push outside it). */
export function pickAnswerTemplate(rows: TemplateRow[], kind: AnswerTemplateKind, lang: 'en' | 'ja'): string {
  const name = ANSWER_TEMPLATE_NAME[kind];
  return isApproved(rows, name, lang) ? name : '';
}

/** Pure: the closed-window notify template — the utility twin only for SHIPMENTS orgs, and only once approved. */
export function pickNotifyTemplate(rows: TemplateRow[], hasShipments: boolean, env: NodeJS.ProcessEnv = process.env): string {
  const override = (env[ENV.notify] ?? '').trim();
  if (override) return override;
  if (hasShipments && isApproved(rows, NOTIFY_UTILITY_TEMPLATE, 'en')) return NOTIFY_UTILITY_TEMPLATE;
  return NOTIFY_TEMPLATE;
}

@Injectable()
export class TemplateStatusService {
  private readonly logger = new Logger(TemplateStatusService.name);
  private readonly cache = new Map<string, { at: number; rows: TemplateRow[] }>();
  private readonly modules = new Map<string, { at: number; on: boolean }>();

  constructor(private readonly prisma: PrismaService) {}

  /** The templates on a WABA (cached). `token` = the connection's access token (never logged). */
  async templates(wabaId: string, token: string): Promise<TemplateRow[]> {
    const hit = this.cache.get(wabaId);
    if (hit && Date.now() - hit.at < CACHE_MS) return hit.rows;
    try {
      const version = process.env.WHATSAPP_GRAPH_VERSION || 'v23.0';
      const res = await fetch(`https://graph.facebook.com/${version}/${wabaId}/message_templates?fields=name,status,language&limit=200`, { headers: { Authorization: `Bearer ${token}` } });
      const json: any = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(json?.error?.message || `Graph API ${res.status}`);
      const rows: TemplateRow[] = (json.data ?? []).map((t: any) => ({ name: String(t.name), language: String(t.language ?? 'en'), status: String(t.status ?? '') }));
      this.cache.set(wabaId, { at: Date.now(), rows });
      return rows;
    } catch (e: any) {
      this.logger.warn(`template list for WABA …${wabaId.slice(-4)} failed (${e?.message}) — ${hit ? 'using the last list' : 'no templates known'}`);
      if (hit) this.cache.set(wabaId, { at: Date.now() - CACHE_MS + 10 * 60_000, rows: hit.rows }); // retry in 10 minutes
      return hit?.rows ?? [];
    }
  }

  /** The nightly audit hands over what it fetched (same shape) so the cache is warm. */
  prime(wabaId: string, rows: TemplateRow[]) {
    this.cache.set(wabaId, { at: Date.now(), rows });
  }

  /** Rows for the WABA behind a line (phoneNumberId), or []. */
  async templatesForLine(phoneNumberId: string): Promise<TemplateRow[]> {
    const c: { wabaId: string; accessToken: string } | null = await this.prisma.whatsAppConnection.findFirst({ where: { phoneNumberId, status: 'CONNECTED' }, select: { wabaId: true, accessToken: true } }).catch(() => null);
    return c?.wabaId ? this.templates(c.wabaId, c.accessToken) : [];
  }

  /** Rows for the org's own primary connected line, or []. */
  async templatesForOrg(organizationId: string): Promise<TemplateRow[]> {
    const c: { wabaId: string; accessToken: string } | null = await this.prisma.whatsAppConnection.findFirst({ where: { organizationId, status: 'CONNECTED' }, orderBy: { isPrimary: 'desc' }, select: { wabaId: true, accessToken: true } }).catch(() => null);
    return c?.wabaId ? this.templates(c.wabaId, c.accessToken) : [];
  }

  async hasShipments(organizationId: string): Promise<boolean> {
    const hit = this.modules.get(organizationId);
    if (hit && Date.now() - hit.at < MODULE_CACHE_MS) return hit.on;
    const row = await this.prisma.organizationModule.findFirst({ where: { organizationId, moduleCode: 'SHIPMENTS', enabled: true }, select: { id: true } }).catch(() => null);
    this.modules.set(organizationId, { at: Date.now(), on: !!row });
    return !!row;
  }

  /** The shipments push template for this kind + language on the sending line ('' = send plain text). */
  async shipmentsTemplate(kind: ShipmentsTemplateKind, lang: 'en' | 'ja', phoneNumberId: string): Promise<string> {
    return pickShipmentsTemplate(await this.templatesForLine(phoneNumberId), kind, lang);
  }

  /** Round AE: the "needs your answer" template of this kind + language on the sending line ('' = not approved yet). */
  async answerTemplate(kind: AnswerTemplateKind, lang: 'en' | 'ja', phoneNumberId: string): Promise<string> {
    return pickAnswerTemplate(await this.templatesForLine(phoneNumberId), kind, lang);
  }

  /** The closed-window notify template for an org (its own line's WABA). Non-SHIPMENTS orgs: unchanged behaviour. */
  async notifyTemplate(organizationId: string): Promise<string> {
    const shipments = await this.hasShipments(organizationId);
    if (!shipments) return pickNotifyTemplate([], false);
    return pickNotifyTemplate(await this.templatesForOrg(organizationId), true);
  }
}
