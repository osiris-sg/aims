/**
 * Round BL — READ-ONLY live run of AIMEE (the shipments profile on the web) against prod ADH data, for the round report
 * and the preview screenshots. The real tool set, prompts and model; the conversation is kept in memory (no
 * OperatorSession row), every Prisma write throws (read-only proxy), the audit / Activity Log writers are stubs that
 * only count, and a Confirm card is shown, never run. DBURL inline (prod), TENANCY_MODE=.
 *   --out=<json>   transcripts per scenario (the preview fixture's `aimee` block)
 *   --only=a,b     scenarios to run
 */
import 'dotenv/config';
import * as fs from 'fs';
import Anthropic from '@anthropic-ai/sdk';
import { ConfigService } from '@nestjs/config';
import { PrismaClient } from '@prisma/client';
import { OperatorAuthService } from '../src/operator/operator-auth.service';
import { ShipmentsToolsService, SHIPMENTS_MONEY } from '../src/operator/shipments-tools.service';
import { forbiddenAsk, refusalText, shipmentsSystemPrompt } from '../src/operator/shipments-agent.rules';
import { cleanAimee, shipmentsPageBlock, shipmentsWebPrompt } from '../src/operator/shipments-web';
import { stripEmoji } from '../src/operator/push-text';
import { OperatorContext } from '../src/operator/operator.types';
import { TradeConfigService } from '../src/shipments/trade-config.service';
import { ShipmentsService } from '../src/shipments/shipments.service';
import { OrdersService } from '../src/shipments/orders.service';
import { TradeDueService } from '../src/shipments/trade-due.service';
import { TradeTaxInputsService } from '../src/shipments/trade-tax-inputs';
import { TradePriceCheckService } from '../src/shipments/trade-price-check.service';
import { TradeStepsService } from '../src/shipments/trade-steps.service';
import { MonthlyListService } from '../src/shipments/monthly-list.service';
import { EmailTriageService } from '../src/ingestion-email/email-triage.service';
import { S3Service } from '../src/common/services/s3.service';
import { TradeAdminDashboardService } from '../src/shipments/trade-admin-dashboard.service';

const ORG = '056ed6da-42d3-438e-895b-84bb4df47a4c';
const MODEL = 'claude-opus-4-8';
const arg = (k: string) => process.argv.find((a) => a.startsWith(`--${k}=`))?.slice(k.length + 3);
const WRITES = /^(create|createMany|update|updateMany|upsert|delete|deleteMany|\$executeRaw|\$executeRawUnsafe|\$transaction)$/;
let blockedWrites = 0;
function readOnly(p: PrismaClient): any {
  return new Proxy(p as any, {
    get(t, k: string) {
      if (WRITES.test(k)) throw new Error(`read-only: ${k}`);
      const v = t[k];
      if (v && typeof v === 'object' && !k.startsWith('$'))
        return new Proxy(v, {
          get: (m, op: string) => {
            if (WRITES.test(op)) {
              blockedWrites++;
              return async () => {
                throw new Error(`read-only: ${k}.${op}`);
              };
            }
            const f = m[op];
            return typeof f === 'function' ? f.bind(m) : f;
          },
        });
      return typeof v === 'function' ? v.bind(t) : v;
    },
  });
}

const SALES = ['shipments:read', 'shipments:update', 'shipments:create', 'shipments:delete', 'users:read', 'users:read-roles'];
const ADMIN = [...SALES, SHIPMENTS_MONEY, 'users:create', 'users:update', 'users:delete', 'users:assign-role'];
const ctxFor = (who: 'sales' | 'admin', lang: 'en' | 'ja', aimee: any): OperatorContext => ({
  organizationId: ORG,
  organizationName: 'Asia Deal Hub Japan LLC',
  clerkUserId: 'preview',
  actor: { id: 'preview', name: who === 'sales' ? 'Sayaka' : 'Take' },
  roles: [{ name: who === 'sales' ? 'ADH Sales' : 'ADH Admin', permissions: (who === 'sales' ? SALES : ADMIN).map((p) => ({ resource: p.split(':')[0], action: p.split(':')[1] })) }],
  isOsirisAdmin: false,
  channel: 'web',
  channelUserId: 'preview',
  profile: 'shipments',
  lang,
  web: { screens: [], panel: null, aimee: cleanAimee(aimee) },
});

type Item = { id: string; at: string; role: 'user' | 'assistant'; kind: 'text' | 'buttons'; text?: string; buttons?: Array<{ label: string; data: string }>; via: 'web' };
const plain = (s: string) => stripEmoji(s.replace(/\s[—–]\s/g, ', ').replace(/[—–]/g, '-'));

async function converse(svc: ShipmentsToolsService, anthropic: Anthropic, ctx: OperatorContext, turns: string[]) {
  const items: Item[] = [];
  const ui: any[] = [];
  const tools: string[] = [];
  const history: Anthropic.MessageParam[] = [];
  let n = 0;
  const at = () => new Date(Date.UTC(2026, 10, 6, 5, 0, n++)).toISOString();
  for (const text of turns) {
    items.push({ id: `u${n}`, at: at(), role: 'user', kind: 'text', text, via: 'web' });
    const what = forbiddenAsk(text);
    if (what) {
      items.push({ id: `a${n}`, at: at(), role: 'assistant', kind: 'text', text: refusalText(what, ctx.lang!, 'web'), via: 'web' });
      continue;
    }
    const messages: Anthropic.MessageParam[] = [...history, { role: 'user', content: text }];
    const lang = ctx.lang!;
    const system: Anthropic.TextBlockParam[] = [
      { type: 'text', text: shipmentsSystemPrompt({ actorName: ctx.actor.name!, orgName: ctx.organizationName, now: new Date(), lang, perms: ctx.roles[0].permissions.map((p) => `${p.resource}:${p.action}`).join(', '), channel: 'web' }) + shipmentsWebPrompt(lang) },
      { type: 'text', text: lang === 'ja' ? "REPLY LANGUAGE NOW: Japanese (日本語で答える). The user's AIMS language setting is Japanese." : "REPLY LANGUAGE NOW: English. The user's AIMS language setting is English, whatever language they type in." },
      { type: 'text', text: shipmentsPageBlock(ctx.web?.aimee, lang) },
    ];
    for (let round = 0; round < 8; round++) {
      const resp = await anthropic.messages.create({ model: MODEL, max_tokens: 2000, system, tools: svc.definitions(ctx), messages });
      messages.push({ role: 'assistant', content: resp.content });
      const uses = resp.content.filter((b): b is Anthropic.ToolUseBlock => b.type === 'tool_use');
      const say = resp.content.filter((b): b is Anthropic.TextBlock => b.type === 'text').map((b) => b.text).join('').trim();
      if (!uses.length) {
        if (say) items.push({ id: `a${n}`, at: at(), role: 'assistant', kind: 'text', text: plain(say), via: 'web' });
        break;
      }
      const results: Anthropic.ToolResultBlockParam[] = [];
      let held = false;
      for (const u of uses) {
        tools.push(u.name);
        const out = await svc.execute(ctx, u.name, u.input);
        if (out.ui) ui.push(out.ui);
        if (out.pending) {
          held = true;
          items.push({ id: `c${n}`, at: at(), role: 'assistant', kind: 'buttons', text: plain(`${out.pending.summary}\n\nConfirm?`), buttons: [{ label: 'Confirm', data: 'confirm:preview' }, { label: 'Cancel', data: 'cancel:preview' }], via: 'web' });
        }
        results.push({ type: 'tool_result', tool_use_id: u.id, content: out.pending ? 'A Confirm/Cancel button has been shown to the user. STOP now.' : JSON.stringify(out.result ?? {}).slice(0, 12000) });
      }
      messages.push({ role: 'user', content: results });
      if (held) {
        if (say) items.splice(items.length - 1, 0, { id: `a${n}`, at: at(), role: 'assistant', kind: 'text', text: plain(say), via: 'web' });
        break;
      }
    }
    history.push(...messages.slice(history.length));
  }
  return { items, ui, tools };
}

(async () => {
  if (!process.env.DBURL) throw new Error('DBURL is required');
  const raw = new PrismaClient({ datasources: { db: { url: process.env.DBURL } } });
  const prisma = readOnly(raw);
  const config = new TradeConfigService(prisma);
  const due = new TradeDueService(prisma);
  const taxInputs = new TradeTaxInputsService(prisma);
  const shipments = new ShipmentsService(prisma, config, undefined, undefined, undefined, taxInputs);
  const orders = new OrdersService(prisma, config, shipments, undefined, due);
  const s3 = new S3Service(new ConfigService());
  const counted = { audit: 0, actionLog: 0 };
  const audit: any = { logAction: async () => void counted.audit++ };
  const actionLog: any = { log: async () => void counted.actionLog++, system: async () => void counted.actionLog++ };
  const files: any = { list: async () => ({ items: [] }) };
  const steps = new TradeStepsService(prisma, config);
  const triage = new EmailTriageService(prisma, s3, files, config, steps, actionLog);
  const alerts: any = { myTasks: async () => [] };
  const monthly = new MonthlyListService(prisma, config, due);
  const auth = { hasPermission: OperatorAuthService.prototype.hasPermission } as unknown as OperatorAuthService;
  const svc = new ShipmentsToolsService(prisma, auth, triage, alerts, files, shipments, s3, audit, actionLog, orders, steps, {} as any, {} as any, new TradeAdminDashboardService(prisma, orders), config, monthly, undefined, due, new TradePriceCheckService(prisma, config));
  const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

  // #18-1 and its step 7; a live question card (the newest unprocessed email the Dashboard asks about).
  const o: any = await raw.tradeOrder.findFirst({ where: { organizationId: ORG, orderNo: 18 }, select: { id: true, shipments: { where: { seqNo: 1 }, select: { id: true, steps: { select: { id: true, code: true, displayNo: true, title: true } } } } } });
  const s = o.shipments[0];
  const st7 = s.steps.find((x: any) => x.code === 'CUSTOMS_TAX_ESTIMATE');
  const dash: any = await triage.dashboard(ORG, 'en', { admin: false }).catch((e: any) => ({ err: e.message }));
  const card = dash?.toConfirm?.threads?.[0] ?? null;
  const email = card ? { id: (card.answerIds?.[0] ?? card.messages?.[0]?.id) as string, subject: card.subject ?? null } : null;
  const guides = [
    { id: 'trade-reopen-cancelled-order', title: 'Find and reopen a cancelled order (Orders › Cancelled)' },
    { id: 'trade-aimee-panel', title: 'Ask AIMEE next to an order (the AIMEE side panel)' },
    { id: 'trade-step-payment', title: 'Record a step payment' },
  ];
  const step7 = { ref: '#18-1', orderId: o.id, shipmentId: s.id, step: { id: st7.id, code: st7.code, no: st7.displayNo ?? '7' }, view: 'Order', path: `/portal/shipments/orders/${o.id}` };

  const scenarios: Record<string, { who: 'sales' | 'admin'; lang: 'en' | 'ja'; page: any; turns: string[] }> = {
    step7_en: { who: 'sales', lang: 'en', page: step7, turns: ['How is this import tax calculated?', 'Which invoice is the CIF from?'] },
    step7_ja: { who: 'sales', lang: 'ja', page: step7, turns: ['この輸入税はどう計算されている？'] },
    email_en: { who: 'sales', lang: 'en', page: email ? { email, view: 'Dashboard' } : { view: 'Dashboard' }, turns: ['Which shipment is this?', 'Yes, link it to #24-1.'] },
    email_ja: { who: 'sales', lang: 'ja', page: email ? { email, view: 'Dashboard' } : { view: 'Dashboard' }, turns: ['これはどの出荷のメール？', 'はい、#24-1にリンクして。'] },
    walk_en: { who: 'sales', lang: 'en', page: { view: 'Dashboard' }, turns: ['Show me how to reopen a cancelled order'] },
    money_sales: { who: 'sales', lang: 'en', page: { ...step7, step: null }, turns: ['What is the margin and profit on #18?'] },
    money_admin: { who: 'admin', lang: 'en', page: { ...step7, step: null }, turns: ['What is the margin and profit on #18?'] },
    users_sales: { who: 'sales', lang: 'en', page: { view: 'Dashboard' }, turns: ['Add a user for my colleague with the Admin role'] },
    next_en: { who: 'sales', lang: 'en', page: step7, turns: ['What do I do next?'] },
    fill_en: { who: 'sales', lang: 'en', page: step7, turns: ['Fill the empty B/L fields on #18-1 from its B/L draft'] },
  };
  const only = (arg('only') ?? '').split(',').filter(Boolean);
  const out: Record<string, any> = { order: o.id, shipment: s.id, step7: st7.id, email, guides };
  for (const [k, sc] of Object.entries(scenarios)) {
    if (only.length && !only.includes(k)) continue;
    const ctx = ctxFor(sc.who, sc.lang, { page: sc.page, guides, scope: sc.page?.email ? `email:${sc.page.email.id}` : sc.page?.orderId ? `order:${sc.page.orderId}` : 'general' });
    const r = await converse(svc, anthropic, ctx, sc.turns).catch((e: any) => ({ items: [], ui: [], tools: [], error: e.message }));
    out[k] = { ...r, page: sc.page, lang: sc.lang, who: sc.who };
    console.log(`\n=== ${k} (${sc.who}, ${sc.lang}) tools: ${(r as any).tools?.join(', ') || '-'}${(r as any).error ? ` ERROR ${(r as any).error}` : ''}`);
    for (const it of (r as any).items) console.log(`${it.role === 'user' ? '>' : '<'} ${String(it.text ?? '').slice(0, 900)}`);
    if ((r as any).ui?.length) console.log('ui:', JSON.stringify((r as any).ui));
  }
  console.log(`\nwrites blocked by the read-only proxy: ${blockedWrites}; audit calls (stub): ${counted.audit}; action log calls (stub): ${counted.actionLog}`);
  if (arg('out')) fs.writeFileSync(arg('out')!, JSON.stringify(out, null, 2));
  await raw.$disconnect();
})().catch((e) => {
  console.error(e?.message ?? e);
  process.exit(1);
});
