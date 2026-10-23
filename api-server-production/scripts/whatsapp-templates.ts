/**
 * Round X — the WhatsApp utility templates for the shipments pushes, as Meta wants them (one {{n}} per LINE, because
 * a parameter may not contain a newline and a body may not be a bare variable). `aims_notify` (one paragraph) stays
 * the fallback the closed-window recovery uses.
 *
 *   --list            what each CONNECTED line's WABA has (name, status, category)        [read-only]
 *   --show            print the template definitions (what to submit)                    [no network]
 *   --submit --confirm POST the missing ones to the connected WABA(s) (Meta reviews them)   [outward: ask first]
 *   --waba=<last 4 digits>  only that WABA (the ADH line's is the one ending 6521)
 *   --include-notify  also the UTILITY twin of aims_notify (aims_notify_utility) — switch WHATSAPP_NOTIFY_TEMPLATE to it once approved
 *   --v2              the round AD bodies (aims_*_v2) instead of the approved round X ones
 *   --v3              the round AE "needs your answer" family (aims_answer*) — the one message AIMS sends on its own
 *
 *   npx ts-node --transpile-only scripts/whatsapp-templates.ts --list
 */
import 'dotenv/config';
import { PrismaClient } from '@prisma/client';
import { ANSWER_TEMPLATE_BUTTONS, ANSWER_TEMPLATE_NAME, ANSWER_TEMPLATES, AnswerTemplateKind } from '../src/operator/push-text';

const GRAPH = process.env.WHATSAPP_GRAPH_VERSION || 'v21.0';
const ex = (lines: string[]) => lines;

type Tpl = { name: string; language: 'en' | 'ja'; category: 'UTILITY'; body: string; example: string[]; /** Round AE: QUICK_REPLY button titles (max 3 per template). */ buttons?: string[] };
/** Each line of the push is a parameter; the fixed words are the template's own. The examples are what Meta sees in review. */
export const TEMPLATES: Tpl[] = [
  // Meta rules met here: no variable at the start or the end, and enough fixed words per variable.
  { name: 'aims_digest', language: 'en', category: 'UTILITY', body: 'Good morning from AIMS. Your shipments summary for {{1}}:\n- Emails filed automatically: {{2}}\n- Waiting for your check: {{3}}\n- Tasks overdue: {{4}}\n- Arriving this week: {{5}}\nOpen the Dashboard to act on these: {{6}}\nSent by AIMS, the shipments assistant.', example: ex(['Thu 22 Oct', '18 emails', '4 questions (14 emails)', '2: #19-1 import tax funds, #14-1 detention', '5 shipments (first: #20-1, Sat 24 Oct)', 'https://app.ai-ms.io/portal/shipments/dashboard']) },
  { name: 'aims_digest', language: 'ja', category: 'UTILITY', body: 'おはようございます。AIMSより、{{1}} の出荷状況のまとめです。\n- 自動処理したメール: {{2}}\n- 確認待ち: {{3}}\n- 期限超過のタスク: {{4}}\n- 今週の到着: {{5}}\nダッシュボードで対応してください: {{6}}\nAIMS 出荷アシスタントからのお知らせです。', example: ex(['10月22日（木）', 'メール 18 件', '質問 4 件（メール 14 件）', '2 件: #19-1 輸入税の資金、#14-1 ディテンション', '5 件（最初: #20-1、10/24（土））', 'https://app.ai-ms.io/portal/shipments/dashboard']) },
  { name: 'aims_needs_check', language: 'en', category: 'UTILITY', body: 'A new email in AIMS needs your check.\nFrom: {{1}}\nSubject: {{2}}\nWhat AIMS found: {{3}}\nWhat to do next: {{4}}\nSent by AIMS, the shipments assistant.', example: ex(['Toshiro Takekoshi (Asia Deal Hub), 22 Oct 11:50', 'Re: DET costs and how to avoid detention', 'AIMS is not sure which shipment this is for: #16-1 or #16-2.', 'Reply 1 for #16-1, 2 for #16-2, or check it on the Dashboard: https://app.ai-ms.io/portal/shipments/dashboard']) },
  { name: 'aims_needs_check', language: 'ja', category: 'UTILITY', body: 'AIMSに届いた新しいメールの確認が必要です。\n差出人: {{1}}\n件名: {{2}}\nAIMSの判断: {{3}}\n次にすること: {{4}}\nAIMS 出荷アシスタントからのお知らせです。', example: ex(['Toshiro Takekoshi (Asia Deal Hub)、10/22 11:50', 'Re:【ご相談】直近のDET費用及びディテンション回避策について', 'AIMSはどの出荷の件か判断できません: #16-1 か #16-2。', '#16-1 なら 1、#16-2 なら 2 と返信、またはダッシュボードで確認: https://app.ai-ms.io/portal/shipments/dashboard']) },
  { name: 'aims_new_deal', language: 'en', category: 'UTILITY', body: 'A new email arrived in AIMS from {{1}}.\nSubject: {{2}}\nThis looks like a new deal that is not in AIMS yet.\nCheck it on the Dashboard: {{3}}\nSent by AIMS, the shipments assistant.', example: ex(['taomura (Isewan), 21 Oct', 'Aluminium ingot import', 'https://app.ai-ms.io/portal/shipments/dashboard']) },
  { name: 'aims_new_deal', language: 'ja', category: 'UTILITY', body: 'AIMSに新しいメールが届きました。差出人: {{1}}\n件名: {{2}}\nAIMSにまだない新しい案件のようです。\nダッシュボードで確認してください: {{3}}\nAIMS 出荷アシスタントからのお知らせです。', example: ex(['taomura (Isewan)、10/21', 'アルミインゴット輸入の件', 'https://app.ai-ms.io/portal/shipments/dashboard']) },
  { name: 'aims_recheck', language: 'en', category: 'UTILITY', body: 'AIMS re-checked an email and is not sure anymore.\nFrom: {{1}}\nSubject: {{2}}\nPlease confirm the shipment on the Dashboard: {{3}}\nSent by AIMS, the shipments assistant.', example: ex(['Toshiro Takekoshi (Asia Deal Hub), 22 Oct', 'Re: DET costs and how to avoid detention', 'https://app.ai-ms.io/portal/shipments/dashboard']) },
  { name: 'aims_recheck', language: 'ja', category: 'UTILITY', body: 'AIMSがメールを再確認したところ、確信が持てなくなりました。\n差出人: {{1}}\n件名: {{2}}\nダッシュボードで出荷を確認してください: {{3}}\nAIMS 出荷アシスタントからのお知らせです。', example: ex(['Toshiro Takekoshi (Asia Deal Hub)、10/22', 'Re:【ご相談】直近のDET費用及びディテンション回避策について', 'https://app.ai-ms.io/portal/shipments/dashboard']) },
];

/**
 * Round AD (owner): the pushes' plain-text layout changed (no labels, blank lines between sections, the sender as the
 * company, a short link). The templates above are APPROVED on Meta (checked 2026-10-23) and are NOT changed — a
 * template send still reads "From: / Subject:" with the fixed words Meta approved. These v2 bodies match the new
 * layout; submit them with --v2 --submit --confirm when the owner says so, then switch the WHATSAPP_*_TEMPLATE env
 * vars to the v2 names. Meta rules kept: no variable first or last, enough fixed words per variable.
 */
export const TEMPLATES_V2: Tpl[] = [
  { name: 'aims_digest_v2', language: 'en', category: 'UTILITY', body: 'Good morning from AIMS, {{1}}.\nEmails filed automatically: {{2}}\nNeed your check: {{3}}\nTasks overdue: {{4}}\nArriving this week: {{5}}\nOpen AIMS: {{6}}\nSent by AIMS, the shipments assistant.', example: ex(['Fri 23 Oct', '9 emails', '5 questions', '2: #19-1 import tax funds, #14-1 detention', '8 shipments (first: #20-1, Sat 24 Oct)', 'https://app.ai-ms.io/go/abc123']) },
  { name: 'aims_digest_v2', language: 'ja', category: 'UTILITY', body: 'おはようございます。AIMSより {{1}} のまとめです。\n自動処理したメール: {{2}}\n確認が必要: {{3}}\n期限超過のタスク: {{4}}\n今週の到着: {{5}}\nAIMSを開く: {{6}}\nAIMS 出荷アシスタントからのお知らせです。', example: ex(['10月23日（金）', 'メール 9 件', '質問 5 件', '2 件: #19-1 輸入税の資金、#14-1 ディテンション', '8 件（最初: #20-1、10/24（土））', 'https://app.ai-ms.io/go/abc123']) },
  { name: 'aims_needs_check_v2', language: 'en', category: 'UTILITY', body: 'A new email in AIMS needs your check.\n{{1}}\n{{2}}\n{{3}}\n{{4}}\nSent by AIMS, the shipments assistant.', example: ex(['SUS · 23 Oct 06:53', 'Re: 書類送付: 6005C材220MT 2026年11月納入分', 'It needs a shipment. SUS revised the November delivery schedule and asks ADH to confirm.', 'Reply with the shipment number (e.g. 18-1), or open AIMS: https://app.ai-ms.io/go/abc123']) },
  { name: 'aims_needs_check_v2', language: 'ja', category: 'UTILITY', body: 'AIMSに届いた新しいメールの確認が必要です。\n{{1}}\n{{2}}\n{{3}}\n{{4}}\nAIMS 出荷アシスタントからのお知らせです。', example: ex(['SUS · 10/23 06:53', 'Re: 書類送付: 6005C材220MT 2026年11月納入分', '出荷の指定が必要です。SUSが11月の納入予定を変更し、ADHに確認を求めています。', '出荷番号で返信してください（例: 18-1）。またはAIMSを開く: https://app.ai-ms.io/go/abc123']) },
  { name: 'aims_new_deal_v2', language: 'en', category: 'UTILITY', body: 'A new email in AIMS looks like a new deal.\n{{1}}\n{{2}}\nIt is not in AIMS yet. Open AIMS to create the order: {{3}}\nSent by AIMS, the shipments assistant.', example: ex(['Isewan · 21 Oct', 'アルミインゴット輸入の件', 'https://app.ai-ms.io/go/abc123']) },
  { name: 'aims_new_deal_v2', language: 'ja', category: 'UTILITY', body: 'AIMSに新しい案件のようなメールが届きました。\n{{1}}\n{{2}}\nAIMSにはまだありません。AIMSで注文を作成: {{3}}\nAIMS 出荷アシスタントからのお知らせです。', example: ex(['Isewan · 10/21', 'アルミインゴット輸入の件', 'https://app.ai-ms.io/go/abc123']) },
  { name: 'aims_recheck_v2', language: 'en', category: 'UTILITY', body: 'AIMS re-checked an email and is not sure anymore.\n{{1}}\n{{2}}\nPlease confirm the shipment in AIMS: {{3}}\nSent by AIMS, the shipments assistant.', example: ex(['Vedanta · 21 Oct', 'TELEX MSG - Asia Deal(Sus) //454003255 //198GX06516', 'https://app.ai-ms.io/go/abc123']) },
  { name: 'aims_recheck_v2', language: 'ja', category: 'UTILITY', body: 'AIMSがメールを再確認したところ、確信が持てなくなりました。\n{{1}}\n{{2}}\nAIMSで出荷を確認してください: {{3}}\nAIMS 出荷アシスタントからのお知らせです。', example: ex(['Vedanta · 10/21', 'TELEX MSG - Asia Deal(Sus) //454003255 //198GX06516', 'https://app.ai-ms.io/go/abc123']) },
];

/**
 * Round AE (owner): the ONE message family — "an email needs your answer". Bodies come from src/operator/push-text.ts
 * (the plain-text push renders the same body), UTILITY, EN + JA, with proposed QUICK_REPLY buttons. --v3 selects it.
 * Not submitted until the owner approves the wording.
 */
export const TEMPLATES_V3: Tpl[] = (Object.keys(ANSWER_TEMPLATES) as AnswerTemplateKind[]).flatMap((kind) =>
  (['en', 'ja'] as const).map((language): Tpl => ({
    name: ANSWER_TEMPLATE_NAME[kind],
    language,
    category: 'UTILITY',
    body: ANSWER_TEMPLATES[kind][language],
    example: kind === 'answer_batch' ? ex(['3', language === 'ja' ? 'SUS · 10/23 06:53' : 'SUS · 23 Oct 06:53', 'Re: 書類送付: 6005C材220MT 2026年11月納入分', 'https://app.ai-ms.io/go/k7m2xq4p']) : ex(['SUS', language === 'ja' ? '10/23 06:53' : '23 Oct 06:53', 'Re: 書類送付: 6005C材220MT 2026年11月納入分', language === 'ja' ? 'SUSが11月の納入予定を変更し、ADHに確認を求めています。' : 'SUS revised the November delivery schedule and asks ADH to confirm.', 'https://app.ai-ms.io/go/k7m2xq4p']),
    buttons: ANSWER_TEMPLATE_BUTTONS[kind][language],
  })),
);

/** The Graph API body for one template (what --submit posts). */
/** The same body as the approved aims_notify (MARKETING), as a UTILITY template — cheaper, not subject to marketing limits. */
export const NOTIFY_UTILITY: Tpl = { name: 'aims_notify_utility', language: 'en', category: 'UTILITY', body: 'AIMS update: {{1}}\nReply to this message to open the chat, or check the Dashboard: {{2}}\nSent by AIMS, the shipments assistant.', example: ex(['New email needs your check. From: Toshiro Takekoshi (Asia Deal Hub), 22 Oct 11:50. Subject: Re: DET costs. AIMS is not sure which shipment this is for: #16-1 or #16-2.', 'https://app.ai-ms.io/portal/shipments/dashboard']) };

export const graphBody = (t: Tpl) => ({ name: t.name, language: t.language, category: t.category, components: [{ type: 'BODY', text: t.body, example: { body_text: [t.example] } }, ...(t.buttons?.length ? [{ type: 'BUTTONS', buttons: t.buttons.slice(0, 3).map((text) => ({ type: 'QUICK_REPLY', text })) }] : [])] });

async function graph<T>(path: string, token: string, init: { method: 'GET' | 'POST'; body?: unknown }): Promise<T> {
  const res = await fetch(`https://graph.facebook.com/${GRAPH}/${path}`, { method: init.method, headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }, body: init.body ? JSON.stringify(init.body) : undefined });
  const json: any = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error([json?.error?.message, json?.error?.error_user_title, json?.error?.error_user_msg, json?.error?.error_subcode ? `subcode ${json.error.error_subcode}` : null].filter(Boolean).join(' · ') || `${res.status}`);
  return json as T;
}

async function main() {
  const args = process.argv.slice(2);
  const base = args.includes('--v3') ? TEMPLATES_V3 : args.includes('--v2') ? TEMPLATES_V2 : TEMPLATES;
  if (args.includes('--show')) {
    for (const t of base) console.log(`\n=== ${t.name} (${t.language}, ${t.category})\n${t.body}\n--- example values: ${JSON.stringify(t.example)}${t.buttons?.length ? `\n--- quick-reply buttons: ${t.buttons.join(' | ')}` : ''}`);
    return;
  }
  const p = new PrismaClient();
  const conns: any[] = await p.whatsAppConnection.findMany({ where: { status: 'CONNECTED' }, select: { organizationId: true, wabaId: true, displayPhoneNumber: true, accessToken: true, phoneNumberId: true } });
  const seen = new Set<string>();
  const only = args.find((a) => a.startsWith('--waba='))?.slice(7);
  const wanted = args.includes('--include-notify') ? [...base, NOTIFY_UTILITY] : base;
  for (const c of conns) {
    if (!c.wabaId || seen.has(c.wabaId)) continue;
    if (only && !c.wabaId.endsWith(only)) continue;
    seen.add(c.wabaId);
    const label = `WABA …${c.wabaId.slice(-4)} (line …${(c.displayPhoneNumber ?? c.phoneNumberId ?? '').slice(-4)})`;
    try {
      const res = await graph<{ data?: Array<{ name: string; status: string; language: string; category: string }> }>(`${c.wabaId}/message_templates?fields=name,status,language,category&limit=200`, c.accessToken, { method: 'GET' });
      const have = res.data ?? [];
      console.log(`\n${label}: ${have.length} template(s)`);
      for (const t of have) console.log(`   ${t.name.padEnd(24)} ${t.language.padEnd(6)} ${t.status.padEnd(10)} ${t.category}`);
      const missing = wanted.filter((t) => !have.some((h) => h.name === t.name && h.language.startsWith(t.language)));
      console.log(`   missing: ${missing.map((t) => `${t.name}/${t.language}`).join(', ') || 'none'}`);
      if (args.includes('--submit')) {
        if (!args.includes('--confirm')) { console.log('   (add --confirm to submit)'); continue; }
        for (const t of missing) {
          try {
            const r = await graph<{ id: string; status: string }>(`${c.wabaId}/message_templates`, c.accessToken, { method: 'POST', body: graphBody(t) });
            console.log(`   submitted ${t.name}/${t.language}: ${r.status} (${r.id})`);
          } catch (e: any) {
            console.log(`   ${t.name}/${t.language} rejected: ${e.message}`);
          }
        }
      }
    } catch (e: any) {
      console.log(`\n${label}: ${e.message}`);
    }
  }
  await p.$disconnect();
}
main().catch((e) => { console.error(e?.message || e); process.exitCode = 1; });
