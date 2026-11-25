/**
 * Preload shim (`node -r ./scripts/lib/pg-prisma-shim.js …`) so the raw-SQL Prisma scripts that talk to Neon over its
 * WebSocket driver (scripts/journal-guards.ts, scripts/verify-accounting-invariants.ts) run unchanged against a plain
 * local Postgres: it swaps `@prisma/client` for a tiny client with $queryRawUnsafe / $executeRawUnsafe / $disconnect on
 * node-pg, and stubs the Neon adapter modules. Used by the ABSS history rehearsal (scripts/wct-abss-history-rehearsal.ts).
 * Refuses any non-localhost URL, so it can never point those scripts at a Neon database.
 */
'use strict';
const Module = require('module');
const { Client, types } = require('pg');

types.setTypeParser(1700, (v) => Number(v));
types.setTypeParser(20, (v) => Number(v));

class PgPrismaClient {
  constructor(opts) {
    const url = (opts && opts.adapter && opts.adapter.url) || process.env.DATABASE_URL;
    const host = new URL(url).hostname;
    if (!['localhost', '127.0.0.1', '::1'].includes(host)) throw new Error(`pg-prisma-shim: localhost only (got ${host})`);
    this.c = new Client({ connectionString: url });
    this.ready = this.c.connect();
  }
  async $queryRawUnsafe(sql, ...args) { await this.ready; return (await this.c.query(sql, args)).rows; }
  async $executeRawUnsafe(sql, ...args) { await this.ready; return (await this.c.query(sql, args)).rowCount; }
  async $disconnect() { await this.ready; await this.c.end(); }
}
class PrismaNeon { constructor(cfg) { this.url = cfg && cfg.connectionString; } }

const load = Module._load;
Module._load = function (request, parent, isMain) {
  if (request === '@prisma/client') return { PrismaClient: PgPrismaClient };
  if (request === '@prisma/adapter-neon') return { PrismaNeon };
  if (request === '@neondatabase/serverless') return { neonConfig: {} };
  return load.apply(this, arguments);
};
