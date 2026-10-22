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
 *
 *   npx ts-node --transpile-only scripts/whatsapp-templates.ts --list
 */
import 'dotenv/config';
import { PrismaClient } from '@prisma/client';

const GRAPH = process.env.WHATSAPP_GRAPH_VERSION || 'v21.0';
const ex = (lines: string[]) => lines;

type Tpl = { name: string; language: 'en' | 'ja'; category: 'UTILITY'; body: string; example: string[] };
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

/** The Graph API body for one template (what --submit posts). */
/** The same body as the approved aims_notify (MARKETING), as a UTILITY template — cheaper, not subject to marketing limits. */
export const NOTIFY_UTILITY: Tpl = { name: 'aims_notify_utility', language: 'en', category: 'UTILITY', body: 'AIMS update: {{1}}\nReply to this message to open the chat, or check the Dashboard: {{2}}\nSent by AIMS, the shipments assistant.', example: ex(['New email needs your check. From: Toshiro Takekoshi (Asia Deal Hub), 22 Oct 11:50. Subject: Re: DET costs. AIMS is not sure which shipment this is for: #16-1 or #16-2.', 'https://app.ai-ms.io/portal/shipments/dashboard']) };

export const graphBody = (t: Tpl) => ({ name: t.name, language: t.language, category: t.category, components: [{ type: 'BODY', text: t.body, example: { body_text: [t.example] } }] });

async function graph<T>(path: string, token: string, init: { method: 'GET' | 'POST'; body?: unknown }): Promise<T> {
  const res = await fetch(`https://graph.facebook.com/${GRAPH}/${path}`, { method: init.method, headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }, body: init.body ? JSON.stringify(init.body) : undefined });
  const json: any = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error([json?.error?.message, json?.error?.error_user_title, json?.error?.error_user_msg, json?.error?.error_subcode ? `subcode ${json.error.error_subcode}` : null].filter(Boolean).join(' · ') || `${res.status}`);
  return json as T;
}

async function main() {
  const args = process.argv.slice(2);
  if (args.includes('--show')) {
    for (const t of TEMPLATES) console.log(`\n=== ${t.name} (${t.language}, ${t.category})\n${t.body}\n--- example values: ${JSON.stringify(t.example)}`);
    return;
  }
  const p = new PrismaClient();
  const conns: any[] = await p.whatsAppConnection.findMany({ where: { status: 'CONNECTED' }, select: { organizationId: true, wabaId: true, displayPhoneNumber: true, accessToken: true, phoneNumberId: true } });
  const seen = new Set<string>();
  const only = args.find((a) => a.startsWith('--waba='))?.slice(7);
  const wanted = args.includes('--include-notify') ? [...TEMPLATES, NOTIFY_UTILITY] : TEMPLATES;
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
