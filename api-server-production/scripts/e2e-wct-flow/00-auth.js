// Stage 0 — sign in once as the office user and save the browser state.
// Mints a Clerk sign-in token with the BACKEND key (never typed into a page),
// opens /sign-in?__clerk_ticket=…, waits for the portal, saves auth.json.
const { chromium, PORTAL, AUTH } = require('./lib');

async function main() {
  const key = process.env.CLERK_SECRET_KEY;
  if (!key) throw new Error('CLERK_SECRET_KEY is not set (Clerk backend key of the portal\'s instance)');
  const email = process.env.AIMS_SIGNIN_EMAIL || 'admin@osiris.sg';
  const h = { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' };

  const users = await (await fetch(`https://api.clerk.com/v1/users?email_address=${encodeURIComponent(email)}`, { headers: h })).json();
  const user = Array.isArray(users) ? users[0] : null;
  if (!user) throw new Error(`Clerk has no user ${email} on this instance`);
  const tok = await (await fetch('https://api.clerk.com/v1/sign_in_tokens', { method: 'POST', headers: h, body: JSON.stringify({ user_id: user.id, expires_in_seconds: 600 }) })).json();
  if (!tok.token) throw new Error(`sign-in token not issued: ${JSON.stringify(tok).slice(0, 200)}`);

  const browser = await chromium.launch({ headless: true });
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const page = await ctx.newPage();
  await page.goto(`${PORTAL}/sign-in?__clerk_ticket=${encodeURIComponent(tok.token)}`, { waitUntil: 'domcontentloaded' });
  // Clerk's <SignIn> consumes the ticket; fall back to the JS client if it doesn't.
  try {
    await page.waitForURL(/\/portal/, { timeout: 25000 });
  } catch {
    await page.evaluate(async (ticket) => {
      await window.Clerk.load();
      const r = await window.Clerk.client.signIn.create({ strategy: 'ticket', ticket });
      await window.Clerk.setActive({ session: r.createdSessionId });
    }, tok.token);
    await page.goto(`${PORTAL}/portal`);
    await page.waitForURL(/\/portal/, { timeout: 25000 });
  }
  await page.waitForLoadState('networkidle').catch(() => {});
  await ctx.storageState({ path: AUTH });
  console.log(`signed in as ${email}; state saved to ${AUTH}`);
  await browser.close();
}
main().catch((e) => { console.error(e); process.exit(1); });
