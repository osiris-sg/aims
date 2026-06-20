import { Injectable, OnModuleInit, OnModuleDestroy } from '@nestjs/common';
import { PrismaClient } from '@prisma/client';
import { PrismaNeon } from '@prisma/adapter-neon';
import { neonConfig } from '@neondatabase/serverless';
import ws = require('ws');

// Use Neon's serverless driver: it tunnels Postgres over a WebSocket on port
// 443 instead of the raw TCP connection on 5432. 443 is open on virtually every
// network and avoids the slow 5432 connects that tripped Prisma's connect/pool
// timeouts (especially behind VPNs). Node has no built-in WebSocket, so point
// the driver at the `ws` implementation.
neonConfig.webSocketConstructor = ws as unknown as typeof WebSocket;

function createNeonAdapter(): PrismaNeon {
  // Strip Prisma-only query params (left on DATABASE_URL for the Prisma CLI on
  // slow networks) — the Neon pool's pg-style parser rejects them.
  const url = new URL(process.env.DATABASE_URL as string);
  url.searchParams.delete('pool_timeout');
  url.searchParams.delete('connect_timeout');
  // @prisma/adapter-neon 6.6 takes a PoolConfig and manages the pool itself.
  return new PrismaNeon({ connectionString: url.toString() });
}

@Injectable()
export class PrismaService extends PrismaClient implements OnModuleInit, OnModuleDestroy {
  constructor() {
    super({ adapter: createNeonAdapter() });
  }

  async onModuleInit() {
    await this.$connect();
  }

  async onModuleDestroy() {
    await this.$disconnect();
  }
}
