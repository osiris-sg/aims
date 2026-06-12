# Cloudflare WARP — install & use to unblock Neon DB

**Why this doc exists.** On certain WiFi networks (corporate, hotel, café, captive-portal, and especially anything in China) outbound TCP **port 5432** is blocked, which is the port Prisma uses to reach Neon. Prisma errors with:

```
Can't reach database server at ep-…aws.neon.tech:5432
```

Cloudflare WARP routes traffic through Cloudflare's network over standard HTTPS-ish ports, bypasses port-blocking and most Great Firewall interference, and is **free**. This guide installs it on a Mac and shows the few commands you'll use.

---

## Prerequisites

- macOS (Apple Silicon or Intel — both work)
- Admin password (for the install)
- Homebrew installed: `which brew` should print `/opt/homebrew/bin/brew` (Apple Silicon) or `/usr/local/bin/brew` (Intel). If it doesn't, install Homebrew first: <https://brew.sh>

---

## 1. Install

Single command, via Homebrew:

```bash
brew install --cask cloudflare-warp
```

This downloads the official `.pkg` from Cloudflare and runs the installer. You'll be prompted for your Mac password once. The app lands at `/Applications/Cloudflare WARP.app` and the CLI at `/usr/local/bin/warp-cli` (or `/opt/homebrew/bin/warp-cli` on Apple Silicon).

Confirm:

```bash
ls -la "/Applications/Cloudflare WARP.app" | head -2
warp-cli --version
```

If both commands return something, you're installed.

### Alternative: GUI install

If `brew install --cask cloudflare-warp` fails (rare — usually means an old Cloudflare cert in the brew cache), download the installer manually from <https://1.1.1.1/> → "Download for Mac" → run the `.pkg`. Same end result.

---

## 2. Register + connect (one-time setup)

Open the menubar app once so it can register your device with Cloudflare (no account needed — it's anonymous-by-default):

```bash
open -a "Cloudflare WARP"
```

A WARP icon appears in the menubar (looks like a small shield/cloud). Click it once:

1. **"Accept Terms"** — first launch only.
2. Click the big **toggle switch** to ON. The status should flip to **"Connected"**.

That's it. From this point on, every outbound connection from your Mac — including Prisma's port-5432 calls — goes through Cloudflare's network.

### Verify it's actually working

```bash
# Should return Cloudflare's IP, not your normal ISP's
curl -sS https://www.cloudflare.com/cdn-cgi/trace | grep -E "ip=|warp="
```

You want to see `warp=on` in the output. If it says `warp=off`, the menubar toggle didn't flip — click it again.

Then try Prisma against Neon:

```bash
cd ~/Documents/GitHub/aims/api-server-production
node -e "
require('dotenv').config();
const { PrismaClient } = require('@prisma/client');
const p = new PrismaClient();
p.\$queryRawUnsafe('SELECT 1').then(r => console.log('Neon OK:', r)).catch(e => console.error('Neon FAIL:', e.message)).finally(() => p.\$disconnect());
"
```

Should print `Neon OK: [ { ?column?: 1 } ]`. If it still fails — see Troubleshooting below.

---

## 3. Daily use

Once installed, you control WARP from the menubar icon. The toggle is the whole interface:

| Toggle state | Behavior |
|---|---|
| **On (Connected)** | All traffic routes through Cloudflare. Neon works. Slightly more latency on local sites (e.g. SG → Cloudflare US → SG). |
| **Off** | Direct ISP routing. Faster locally; blocks come back. |

You can leave WARP **always on** without much downside. The 5–10ms latency hit is invisible for dev work. Cloudflare doesn't log traffic (their public policy; they're under independent audit).

### CLI version (for scripts / SSH'd sessions)

If you ever need to toggle without clicking the menubar:

```bash
warp-cli status              # show current state
warp-cli connect             # toggle on
warp-cli disconnect          # toggle off
warp-cli mode warp           # default mode (full proxy)
warp-cli mode warp+doh       # WARP + DNS-over-HTTPS for max bypass
```

`mode warp+doh` is the strongest setting against country-level filtering — recommend it if travelling to China.

---

## 4. Troubleshooting

### "Prisma still fails with `Can't reach database server`" even after WARP is on

1. **Confirm WARP is actually on**: `curl -s https://www.cloudflare.com/cdn-cgi/trace | grep warp` should say `warp=on`. If not, click the menubar toggle once more.
2. **Restart your terminal**. Some shells cache DNS for the session; a new tab inherits the new resolver.
3. **Flush macOS DNS cache**:
   ```bash
   sudo dscacheutil -flushcache
   sudo killall -HUP mDNSResponder
   ```
4. **Try `warp+doh` mode** (strongest bypass):
   ```bash
   warp-cli mode warp+doh
   warp-cli disconnect
   warp-cli connect
   ```
5. **Check the Neon project isn't paused**. Free-tier Neon projects pause after 5 min idle and need ~2–3 sec on first query to wake. Run the test query twice; the second should succeed.

### "WARP is ON (`warp=on`), `nc` reaches port 5432, but Prisma still says `Can't reach database server`"

This is the **most likely** failure once WARP is connected, and it's misleading — it is **not** a reachability problem. WARP's exit colo is often far away (we've seen `loc=US` from Singapore), so the SG→US→SG round-trip makes the initial Postgres connect take **~12 seconds**. Prisma's **default `connect_timeout` is 5s**, so it gives up and reports "Can't reach database server" even though the path is fine.

How to confirm it's this and not a real block:
```bash
# If the server replies "S", the full TCP+Postgres path works — it's a timeout, not a block.
node -e "const net=require('net');const s=net.connect({host:'<your-neon-host>',port:5432},()=>s.write(Buffer.from([0,0,0,8,0x04,0xd2,0x16,0x2f])));s.on('data',d=>{console.log('server replied:',d.toString());s.end()});s.on('error',e=>console.log('err',e.code));"
```

**Fix:** add `connect_timeout=30` to `DATABASE_URL` in `api-server-production/.env`:
```
...&connection_limit=50&pool_timeout=30&connect_timeout=30
```
This only affects the one-time initial connect (the pool stays warm afterward), so there's no steady-state cost. *(Already applied in this repo as of 2026-06-09.)*

If 12s startup is annoying, force a closer WARP exit — `warp-cli disconnect && warp-cli connect` sometimes re-homes to a nearer colo; re-check with `curl -s https://www.cloudflare.com/cdn-cgi/trace | grep loc=`. The real cure for the latency is the Neon HTTP driver (port 443) — see the last troubleshooting entry.

### "WARP says connected but my regular sites are slow"

Some sites use geo-routing and now think you're in a different country (Cloudflare's nearest exit). This is fine for Neon but annoying for streaming. Easy fix: toggle WARP off when you don't need DB access; back on when you do.

### "I'm in China and even WARP isn't connecting"

China occasionally throttles WARP itself. Fallbacks:

- **Switch to `warp+doh` mode** (see above) — has a higher success rate.
- **Switch WARP off and use `Cloudflare WARP` family DNS only** (via the menubar app → settings → DNS only mode). Routes DNS but not data, often enough to fix Neon-style issues without triggering deeper inspection.
- **As a last resort**, use a paid VPN with an SG exit (Mullvad, ProtonVPN, NordVPN). Pick the closest exit to where you're trying to reach (Singapore for Neon `ap-southeast-1`).

### "I want to permanently fix this — not toggle WARP every time"

The longer-term option is to switch the Prisma client to use **Neon's HTTP/WebSocket driver** instead of native Postgres. It talks to Neon over **port 443** (HTTPS) so port-5432 blocks become irrelevant. Wiring up: install `@neondatabase/serverless` + `@prisma/adapter-neon`, then change the `PrismaClient` constructor in `src/common/prisma.service.ts`. Roughly 10 lines of code; another agent can handle it if you want. Until then, WARP is the operational workaround.

---

## 5. Uninstall (if needed)

```bash
brew uninstall --cask cloudflare-warp
sudo rm -rf "/Applications/Cloudflare WARP.app"
```

The user data lives at `~/Library/Application Support/Cloudflare`; remove that too if you want a clean slate.

---

## Quick reference

```bash
# Install
brew install --cask cloudflare-warp

# Use
open -a "Cloudflare WARP"     # opens app; click the toggle to ON
warp-cli connect              # or via CLI
warp-cli status

# Strongest mode (use in China / heavy filtering)
warp-cli mode warp+doh

# Verify
curl -s https://www.cloudflare.com/cdn-cgi/trace | grep warp
```

That's the whole flow.
