import { Global, Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createClerkClient } from '@clerk/backend';
import { CLERK_CLIENT } from './clerk.constants';
import { ClerkIdentityService } from './clerk-identity.service';

/**
 * The single Clerk Backend API client (@clerk/backend) plus the DB-id ->
 * Clerk-user resolver. Global, so every module injects 'ClerkClient' /
 * ClerkIdentityService without importing anything. Replaces the three clients
 * that used to coexist (the legacy @clerk/clerk-sdk-node one in AuthModule, the
 * per-module ClerkClientProvider, and a private one in CustomersService).
 */
@Global()
@Module({
  providers: [
    {
      provide: CLERK_CLIENT,
      useFactory: (config: ConfigService) =>
        createClerkClient({
          publishableKey: config.get('CLERK_PUBLISHABLE_KEY'),
          secretKey: config.get('CLERK_SECRET_KEY'),
        }),
      inject: [ConfigService],
    },
    ClerkIdentityService,
  ],
  exports: [CLERK_CLIENT, ClerkIdentityService],
})
export class ClerkModule {}
