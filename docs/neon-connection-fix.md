# Fixing "Can't reach Neon DB" — what was done

**Date:** 2026-06-09
**Symptom:** On certain WiFi networks, the local API server (and ad-hoc Prisma
scripts) couldn't connect to the Neon database. Error:

```
Can't reach database server at ep-…-pooler.ap-southeast-1.aws.neon.tech:5432
```

It worked on some networks and not others.

---

## Root cause (two separate things)

There were **two** problems stacked on top of each other, which is why it was
confusing to diagnose:

### 1. The WiFi blocks outbound TCP port 5432

Neon's standard Postgres connection (what Prisma uses) goes out over **port
5432**. Many networks — corporate WiFi, hotels, some mobile hotspots, anything
behind a restrictive firewall — silently drop outbound 5432. Open networks allow
it. That is exactly the "some WiFi works, some doesn't" pattern.

### 2. A misleading 5-second timeout once the block was bypassed

After routing around the block (see below), Prisma *still* reported
`Can't reach database server`. That was a **red herring** — it was actually a
**timeout**, not a reachability failure:

- The traffic detour added latency, so the initial Postgres connection took
  **~12 seconds**.
- Prisma's **default `connect_timeout` is 5 seconds**, so it gave up early and
  reported the connection as unreachable — even though the path was fine.

How we proved the path was actually healthy:

```bash
# Raw Postgres SSLRequest — if the server replies "S", the full TCP+Postgres
# path is working end-to-end (it's a timeout, not a block).
node -e "const net=require('net');const s=net.connect({host:'<neon-host>',port:5432},()=>s.write(Buffer.from([0,0,0,8,0x04,0xd2,0x16,0x2f])));s.on('data',d=>{console.log('server replied:',d.toString());s.end()});s.on('error',e=>console.log('err',e.code));"
# -> server replied: S
```

---

## The fix

### Step 1 — Bypass the port-5432 block with Cloudflare WARP

WARP is a free, whole-device tunnel that routes all outbound traffic through
Cloudflare over standard ports, bypassing the 5432 block. Full install/usage
guide: [`docs/cloudflare-warp-setup.md`](./cloudflare-warp-setup.md).

Quick version (macOS):

```bash
brew install --cask cloudflare-warp
warp-cli --accept-tos registration new   # one-time device registration
warp-cli connect                         # connect
warp-cli status                          # should say "Connected"

# verify it's carrying traffic
curl -s https://www.cloudflare.com/cdn-cgi/trace | grep warp=   # -> warp=on
```

WARP is a **device-wide** tunnel, so it works for *any* Neon connection (dev,
staging, prod URLs) — there's nothing per-database to configure.

### Step 2 — Raise Prisma's connect timeout

Added `connect_timeout=30` to the `DATABASE_URL` in
`api-server-production/.env` so the slow first connect doesn't trip the 5s
default:

```diff
- ...&connection_limit=50&pool_timeout=30
+ ...&connection_limit=50&pool_timeout=30&connect_timeout=30
```

This only affects the **one-time initial connect** — the connection pool stays
warm afterward, so there's no steady-state cost. The dev server will pause
~12s on first DB connect, then run normally.

### Result

```bash
cd api-server-production
node -e "require('dotenv').config();const{PrismaClient}=require('@prisma/client');const p=new PrismaClient();p.\$queryRawUnsafe('SELECT 1').then(r=>console.log('OK',r)).finally(()=>p.\$disconnect());"
# -> OK [ { '?column?': 1 } ]
```

---

## Notes & caveats

- **WARP must be ON** for local dev on a blocking network. If the machine
  reboots or the WARP app quits, reconnect with `warp-cli connect` (or the
  menubar toggle) before starting the server.
- **The WARP exit lands in the US (LAX)** from here, which is what causes the
  ~12s connect. There's no way to force a Singapore exit on consumer WARP — the
  colo is chosen by anycast routing. `warp-cli disconnect && warp-cli connect`
  *sometimes* re-homes to a nearer colo (re-check with
  `curl -s https://www.cloudflare.com/cdn-cgi/trace | grep loc=`), but here it
  pinned to LAX every time.
- **Prod (Render + Neon) was checked and is fine.** The deployed API runs on
  Render (`aims-ahwy.onrender.com`), not on this WiFi, so the port-5432 block
  never applied to it. The prod Neon endpoint (`ep-icy-moon-…`) was verified
  reachable with valid credentials. Render → Neon is a separate path from local
  dev; WARP has no bearing on it.

---

## The permanent fix (optional, not yet done)

Switching Prisma to **Neon's serverless driver** (HTTP/WebSocket over **port
443**) makes the port-5432 block irrelevant entirely — 443 is open on virtually
every network, so WARP would no longer be needed for DB access, and the US-detour
latency disappears.

Roughly ~10 lines: add `@neondatabase/serverless` + `@prisma/adapter-neon`, then
wire the adapter into the `PrismaClient` constructor in
`api-server-production/src/common/prisma.service.ts`. Should be tested before
relying on it for prod.
