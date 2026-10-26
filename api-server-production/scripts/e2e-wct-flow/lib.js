// Shared helpers for the WCT end-to-end flow recording (Playwright, Chromium).
// Plain Node + `require('playwright')` — the cloud container ships Playwright
// globally; on a dev PC run `npm i -D playwright` once in this folder.
//
// Env (all optional except CLERK_SECRET_KEY):
//   AIMS_PORTAL_URL     default https://app.ai-ms.io
//   AIMS_API_URL        default https://aims-ahwy.onrender.com
//   CLERK_SECRET_KEY    Clerk BACKEND key of the instance the portal uses — used
//                       ONLY to mint a 10-minute sign-in token (00-auth.js).
//   AIMS_SIGNIN_EMAIL   default admin@osiris.sg (global osirisadmin bypass)
//   WCT_ORG_ID          default 5c700000-0000-4000-8000-5c7000000001
//   OUT_DIR             where auth.json / state.json / videos go (default ./out)
const fs = require('fs');
const path = require('path');
const { chromium } = require('playwright');

const PORTAL = (process.env.AIMS_PORTAL_URL || 'https://app.ai-ms.io').replace(/\/$/, '');
const API = (process.env.AIMS_API_URL || 'https://aims-ahwy.onrender.com').replace(/\/$/, '');
const ORG_ID = process.env.WCT_ORG_ID || '5c700000-0000-4000-8000-5c7000000001';
const OUT = path.resolve(process.env.OUT_DIR || path.join(__dirname, 'out'));
fs.mkdirSync(OUT, { recursive: true });
const AUTH = path.join(OUT, 'auth.json');
const STATE = path.join(OUT, 'state.json');

const state = {
  load: () => (fs.existsSync(STATE) ? JSON.parse(fs.readFileSync(STATE, 'utf8')) : {}),
  save: (patch) => {
    const next = { ...state.load(), ...patch };
    fs.writeFileSync(STATE, JSON.stringify(next, null, 2));
    return next;
  },
};

// Signed-in office user, "viewing as" WCT (admin X-Active-Org-Id lives in
// sessionStorage — set before any page script runs). Records a video.
async function adminContext(videoName, opts = {}) {
  if (!fs.existsSync(AUTH)) throw new Error('no auth.json — run 00-auth.js first');
  const browser = await chromium.launch({ headless: true });
  const ctx = await browser.newContext({
    storageState: AUTH,
    viewport: { width: 1440, height: 900 },
    recordVideo: { dir: path.join(OUT, 'videos', videoName), size: { width: 1440, height: 900 } },
    ...opts,
  });
  await ctx.addInitScript((orgId) => {
    try { window.sessionStorage.setItem('aims-admin-active-org', orgId); } catch {}
  }, ORG_ID);
  const page = await ctx.newPage();
  page.setDefaultTimeout(30000);
  return { browser, ctx, page };
}

// Anonymous visitor (customer signing, guest driver). Phone-ish viewport.
async function publicContext(videoName) {
  const browser = await chromium.launch({ headless: true });
  const ctx = await browser.newContext({
    viewport: { width: 900, height: 900 },
    recordVideo: { dir: path.join(OUT, 'videos', videoName), size: { width: 900, height: 900 } },
  });
  const page = await ctx.newPage();
  page.setDefaultTimeout(30000);
  return { browser, ctx, page };
}

// Call the AIMS API as the signed-in user (Clerk session token from the page)
// with the WCT org header — same headers every portal fetch helper sends.
async function api(page, apiPath, method = 'GET', body) {
  const token = await page.evaluate(async () => (window.Clerk && window.Clerk.session ? window.Clerk.session.getToken() : null));
  if (!token) throw new Error('no Clerk session on the page — are we signed in?');
  const res = await page.request.fetch(`${API}${apiPath}`, {
    method,
    headers: { Authorization: `Bearer ${token}`, 'X-Active-Org-Id': ORG_ID, 'Content-Type': 'application/json' },
    data: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await res.text();
  let json;
  try { json = JSON.parse(text); } catch { json = text; }
  if (!res.ok()) throw new Error(`${method} ${apiPath} → ${res.status()} ${text.slice(0, 300)}`);
  return json;
}

// Public (unauthenticated) API call — the guest/sign endpoints.
async function publicApi(page, apiPath, method = 'GET', body, multipart) {
  const res = await page.request.fetch(`${API}${apiPath}`, {
    method,
    ...(multipart ? { multipart } : { headers: { 'Content-Type': 'application/json' }, data: body === undefined ? undefined : JSON.stringify(body) }),
  });
  const text = await res.text();
  if (!res.ok()) throw new Error(`${method} ${apiPath} → ${res.status()} ${text.slice(0, 300)}`);
  try { return JSON.parse(text); } catch { return text; }
}

// Tiny valid JPEG (1×1) — stands in for a proof photo on the guest run.
const TINY_JPEG = Buffer.from(
  '/9j/4AAQSkZJRgABAQEASABIAAD/2wBDAP//////////////////////////////////////////////////////////////////////////////////////wgALCAABAAEBAREA/8QAFBABAAAAAAAAAAAAAAAAAAAAAP/aAAgBAQABPxA=',
  'base64',
);

// Draw a scribble on a <canvas> (signature pads) with real mouse events.
async function scribble(page, canvasLocator) {
  const box = await canvasLocator.boundingBox();
  if (!box) throw new Error('signature canvas not visible');
  const x0 = box.x + box.width * 0.2, y0 = box.y + box.height * 0.6;
  await page.mouse.move(x0, y0);
  await page.mouse.down();
  for (let i = 1; i <= 12; i++) {
    await page.mouse.move(x0 + i * (box.width * 0.05), y0 + Math.sin(i) * 20, { steps: 3 });
  }
  await page.mouse.up();
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// Pause so the video has a readable beat on each screen.
const beat = (page, ms = 1200) => page.waitForTimeout(ms);

async function finish({ browser, ctx, page }, label) {
  const video = page.video();
  await ctx.close();
  const file = video ? await video.path() : null;
  await browser.close();
  console.log(`[${label}] video: ${file}`);
  return file;
}

module.exports = { PORTAL, API, ORG_ID, OUT, AUTH, state, adminContext, publicContext, api, publicApi, TINY_JPEG, scribble, sleep, beat, finish, chromium };
