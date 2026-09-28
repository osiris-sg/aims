/** Reports the stored ad token's validity and expiry. Never prints the token. */
import { PrismaClient } from '@prisma/client';
const prisma = new PrismaClient();
(async () => {
  const c = await prisma.adAccountConnection.findFirst({ select: { adAccountId: true, accessToken: true, accountName: true } });
  if (!c) { console.log('no connection'); return; }
  const r = await fetch(`https://graph.facebook.com/v23.0/debug_token?input_token=${encodeURIComponent(c.accessToken)}&access_token=${encodeURIComponent(c.accessToken)}`);
  const j: any = await r.json();
  const d = j?.data || {};
  console.log(`account: ${c.adAccountId} (${c.accountName})`);
  console.log(`  type:    ${d.type}`);
  console.log(`  valid:   ${d.is_valid}`);
  console.log(`  expires: ${d.expires_at === 0 ? 'NEVER' : d.expires_at ? new Date(d.expires_at * 1000).toISOString() : '(not reported)'}`);
  console.log(`  data_access_expires: ${d.data_access_expires_at === 0 ? 'never' : d.data_access_expires_at ? new Date(d.data_access_expires_at * 1000).toISOString() : '(n/a)'}`);
  console.log(`  scopes:  ${(d.scopes || []).join(', ')}`);
  if (j?.error) console.log('  ERROR:', j.error.message);
  await prisma.$disconnect();
})().catch((e) => { console.error('FATAL', e.message); process.exit(1); });
