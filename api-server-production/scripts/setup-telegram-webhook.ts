/**
 * Point the Telegram bot at the AIMS Operator webhook (and show its status).
 *
 * Prereqs in the env being loaded:
 *   TELEGRAM_BOT_TOKEN       from @BotFather
 *   TELEGRAM_WEBHOOK_SECRET  any long random string (also set on the API server)
 *
 * Usage:
 *   # point at prod
 *   npx ts-node -r dotenv/config scripts/setup-telegram-webhook.ts https://aims-ahwy.onrender.com
 *   # local testing through a tunnel
 *   npx ts-node -r dotenv/config scripts/setup-telegram-webhook.ts https://<tunnel-host>
 *   # just show current status
 *   npx ts-node -r dotenv/config scripts/setup-telegram-webhook.ts --status
 */

const TOKEN = process.env.TELEGRAM_BOT_TOKEN;
const SECRET = process.env.TELEGRAM_WEBHOOK_SECRET;

async function api(method: string, body?: any) {
  const res = await fetch(`https://api.telegram.org/bot${TOKEN}/${method}`, {
    method: body ? 'POST' : 'GET',
    headers: body ? { 'Content-Type': 'application/json' } : undefined,
    body: body ? JSON.stringify(body) : undefined,
  });
  return res.json();
}

async function main() {
  if (!TOKEN) {
    console.error('❌ TELEGRAM_BOT_TOKEN is not set. Create a bot with @BotFather and put the token in .env');
    process.exit(1);
  }

  const me: any = await api('getMe');
  if (!me?.ok) {
    console.error('❌ Bad bot token:', me?.description);
    process.exit(1);
  }
  console.log(`🤖 Bot: @${me.result.username} (${me.result.first_name})`);

  const base = process.argv[2];
  if (base && base !== '--status') {
    if (!SECRET) {
      console.error('❌ TELEGRAM_WEBHOOK_SECRET is not set — the webhook would be unauthenticated.');
      process.exit(1);
    }
    const url = `${base.replace(/\/$/, '')}/operator/telegram/webhook`;
    const set: any = await api('setWebhook', {
      url,
      secret_token: SECRET,
      allowed_updates: ['message', 'edited_message', 'callback_query'],
      drop_pending_updates: true,
    });
    console.log(set?.ok ? `✅ Webhook set → ${url}` : `❌ setWebhook failed: ${set?.description}`);
  }

  const info: any = await api('getWebhookInfo');
  const r = info?.result || {};
  console.log('\n📡 Webhook status');
  console.log(`   url:                  ${r.url || '(none)'}`);
  console.log(`   pending updates:      ${r.pending_update_count ?? 0}`);
  console.log(`   custom certificate:   ${r.has_custom_certificate}`);
  if (r.last_error_message) console.log(`   ⚠️ last error:        ${r.last_error_date ? new Date(r.last_error_date * 1000).toISOString() : ''} ${r.last_error_message}`);
  console.log('\nNext: message the bot "/link <code>" using a code from POST /operator/link-code.');
}

main().catch((e) => {
  console.error('FATAL', e);
  process.exit(1);
});
