/**
 * Round X — the WhatsApp utility templates for the shipments pushes, as Meta wants them (one {{n}} per LINE, because
 * a parameter may not contain a newline and a body may not be a bare variable). `aims_notify` (one paragraph) stays
 * the fallback the closed-window recovery uses.
 *
 *   --list            what each CONNECTED line's WABA has (name, status, category)        [read-only]
 *   --show            print the template definitions (what to submit)                    [no network]
 *   --submit --confirm POST the missing ones to every connected WABA (Meta reviews them)   [outward: ask first]
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
  { name: 'aims_digest', language: 'en', category: 'UTILITY', body: 'Good morning. {{1}}\n- {{2}}\n- {{3}}\n- {{4}}\n- {{5}}\nOpen the Dashboard: {{6}}', example: ex(['Thu 22 Oct', '18 emails filed automatically', '4 need your check (14 emails)', '2 tasks overdue: #19-1 import tax funds, #14-1 detention', '5 shipments arriving this week (first: #20-1, Sat 24 Oct)', 'https://app.ai-ms.io/portal/shipments/dashboard']) },
  { name: 'aims_digest', language: 'ja', category: 'UTILITY', body: 'おはようございます。{{1}}\n- {{2}}\n- {{3}}\n- {{4}}\n- {{5}}\nダッシュボードを開く: {{6}}', example: ex(['10月22日（木）', 'メール 18 件を自動処理', '4 件の確認が必要です（メール 14 件）', '期限超過のタスク 2 件: #19-1 輸入税の資金、#14-1 ディテンション', '今週到着 5 件（最初: #20-1、10/24（土））', 'https://app.ai-ms.io/portal/shipments/dashboard']) },
  { name: 'aims_needs_check', language: 'en', category: 'UTILITY', body: 'New email needs your check\nFrom: {{1}}\nSubject: {{2}}\n{{3}}\n{{4}}', example: ex(['Toshiro Takekoshi (Asia Deal Hub), 22 Oct 11:50', 'Re: DET costs and how to avoid detention', "AIMS isn't sure which shipment this is for: #16-1 or #16-2.", 'Reply 1 for #16-1, 2 for #16-2, or check it on the Dashboard: https://app.ai-ms.io/portal/shipments/dashboard']) },
  { name: 'aims_needs_check', language: 'ja', category: 'UTILITY', body: '新しいメールの確認が必要です\n差出人: {{1}}\n件名: {{2}}\n{{3}}\n{{4}}', example: ex(['Toshiro Takekoshi (Asia Deal Hub)、10/22 11:50', 'Re:【ご相談】直近のDET費用及びディテンション回避策について', 'AIMSはどの出荷の件か判断できません: #16-1 か #16-2。', '#16-1 なら 1、#16-2 なら 2 と返信、またはダッシュボードで確認: https://app.ai-ms.io/portal/shipments/dashboard']) },
  { name: 'aims_new_deal', language: 'en', category: 'UTILITY', body: 'New email from {{1}}\nSubject: {{2}}\nThis looks like a new deal that is not in AIMS yet.\nCheck it on the Dashboard: {{3}}', example: ex(['taomura (Isewan), 21 Oct', 'Aluminium ingot import', 'https://app.ai-ms.io/portal/shipments/dashboard']) },
  { name: 'aims_new_deal', language: 'ja', category: 'UTILITY', body: '{{1}} から新しいメール\n件名: {{2}}\nAIMSにまだない新しい案件のようです。\nダッシュボードで確認: {{3}}', example: ex(['taomura (Isewan)、10/21', 'アルミインゴット輸入の件', 'https://app.ai-ms.io/portal/shipments/dashboard']) },
  { name: 'aims_recheck', language: 'en', category: 'UTILITY', body: 'AIMS re-checked an email and is not sure anymore\nFrom: {{1}}\nSubject: {{2}}\nPlease confirm the shipment on the Dashboard: {{3}}', example: ex(['Toshiro Takekoshi (Asia Deal Hub), 22 Oct', 'Re: DET costs and how to avoid detention', 'https://app.ai-ms.io/portal/shipments/dashboard']) },
  { name: 'aims_recheck', language: 'ja', category: 'UTILITY', body: 'AIMSがメールを再確認したところ、確信が持てなくなりました\n差出人: {{1}}\n件名: {{2}}\nダッシュボードで出荷を確認してください: {{3}}', example: ex(['Toshiro Takekoshi (Asia Deal Hub)、10/22', 'Re:【ご相談】直近のDET費用及びディテンション回避策について', 'https://app.ai-ms.io/portal/shipments/dashboard']) },
];

/** The Graph API body for one template (what --submit posts). */
export const graphBody = (t: Tpl) => ({ name: t.name, language: t.language, category: t.category, components: [{ type: 'BODY', text: t.body, example: { body_text: [t.example] } }] });

async function graph<T>(path: string, token: string, init: { method: 'GET' | 'POST'; body?: unknown }): Promise<T> {
  const res = await fetch(`https://graph.facebook.com/${GRAPH}/${path}`, { method: init.method, headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }, body: init.body ? JSON.stringify(init.body) : undefined });
  const json: any = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(json?.error?.message || `${res.status}`);
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
  for (const c of conns) {
    if (!c.wabaId || seen.has(c.wabaId)) continue;
    seen.add(c.wabaId);
    const label = `WABA …${c.wabaId.slice(-4)} (line …${(c.displayPhoneNumber ?? c.phoneNumberId ?? '').slice(-4)})`;
    try {
      const res = await graph<{ data?: Array<{ name: string; status: string; language: string; category: string }> }>(`${c.wabaId}/message_templates?fields=name,status,language,category&limit=200`, c.accessToken, { method: 'GET' });
      const have = res.data ?? [];
      console.log(`\n${label}: ${have.length} template(s)`);
      for (const t of have) console.log(`   ${t.name.padEnd(24)} ${t.language.padEnd(6)} ${t.status.padEnd(10)} ${t.category}`);
      const missing = TEMPLATES.filter((t) => !have.some((h) => h.name === t.name && h.language.startsWith(t.language)));
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
