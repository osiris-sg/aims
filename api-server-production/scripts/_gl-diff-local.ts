// Local (no-API) diff: journal cache (today's Xero state) vs AIMS GL.
// Finds stale journals (in DB, gone from Xero), missing ones, and per-account
// sum differences for the 7 drifting accounts.
import { PrismaClient } from "@prisma/client";
import { PrismaNeon } from "@prisma/adapter-neon";
import { neonConfig } from "@neondatabase/serverless";
import * as fs from "fs";
import * as os from "os";
import ws = require("ws");
neonConfig.webSocketConstructor = ws as unknown as typeof WebSocket;
const prisma = new PrismaClient({ adapter: new PrismaNeon({ connectionString: fs.readFileSync(".env.production", "utf8").match(/^DATABASE_URL="?([^"\n]+)"?/m)![1] }) } as any);
const ORG = "52e90ba8-bfbd-48b0-bb76-4f9667bf74f1";
const CODES = new Set(["310", "334", "445", "485", "490", "800", "820"]);
(async () => {
  const cachePath = `${os.homedir()}/.aims-xero-cache/xero-journals-cache-${ORG}.ndjson`;
  const lines = fs.readFileSync(cachePath, "utf8").split("\n").filter(Boolean);
  const cacheByNum = new Map<number, any>();
  for (const l of lines) { const j = JSON.parse(l); cacheByNum.set(j.JournalNumber, j); }
  console.log(`cache: ${cacheByNum.size} journals (max #${Math.max(...cacheByNum.keys())})`);

  const jes = await prisma.journalEntry.findMany({
    where: { organizationId: ORG, postedBy: "xero-import", status: "POSTED" },
    select: { journalNumber: true, entryDate: true, description: true, lines: { select: { debit: true, credit: true, account: { select: { code: true } } } } },
  } as any);
  console.log(`AIMS xero-import JEs: ${jes.length}`);
  const dbNums = new Set<number>();
  // per-account sums
  const dbSum: Record<string, number> = {}, cacheSum: Record<string, number> = {};
  const staleContrib: Record<string, number> = {};
  const stale: any[] = [];
  for (const je of jes as any[]) {
    const n = parseInt(je.journalNumber.replace("JV-XERO-", ""), 10);
    dbNums.add(n);
    const inCache = cacheByNum.has(n);
    if (!inCache) stale.push({ n, date: je.entryDate?.toISOString().slice(0, 10), desc: (je.description || "").slice(0, 60), lines: je.lines });
    for (const l of je.lines) {
      const code = l.account?.code;
      if (!code || !CODES.has(code)) continue;
      const net = Number(l.debit) - Number(l.credit);
      dbSum[code] = (dbSum[code] || 0) + net;
      if (!inCache) staleContrib[code] = (staleContrib[code] || 0) + net;
    }
  }
  let missing = 0;
  for (const [n, j] of cacheByNum) {
    if (!dbNums.has(n)) missing++;
    for (const l of j.JournalLines || []) {
      const code = l.AccountCode;
      if (!code || !CODES.has(code)) continue;
      cacheSum[code] = (cacheSum[code] || 0) + (Number(l.NetAmount) || 0);
    }
  }
  console.log(`journals in DB but GONE from Xero (stale): ${stale.length} · in Xero but not DB: ${missing}`);
  console.log("\nper-account net (debit−credit):");
  console.log("code |        cache(Xero) |            AIMS DB |         Δ(X−A) | stale part");
  for (const code of [...CODES].sort()) {
    const c = Math.round((cacheSum[code] || 0) * 100) / 100, d = Math.round((dbSum[code] || 0) * 100) / 100;
    console.log(`${code.padEnd(4)} | ${String(c.toFixed(2)).padStart(18)} | ${String(d.toFixed(2)).padStart(18)} | ${String((Math.round((c - d) * 100) / 100).toFixed(2)).padStart(14)} | ${((staleContrib[code] || 0)).toFixed(2)}`);
  }
  if (stale.length) {
    console.log("\nstale journals detail:");
    for (const s of stale.slice(0, 20)) {
      console.log(`  #${s.n} ${s.date} ${s.desc}`);
      for (const l of s.lines) if (l.account?.code) console.log(`     ${l.account.code} DR ${l.debit} CR ${l.credit}`);
    }
  }
  process.exit(0);
})();
