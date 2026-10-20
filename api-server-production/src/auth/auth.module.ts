// src/auth/auth.module.ts
import { Module } from '@nestjs/common';
import { ClerkStrategy } from './clerk.strategy';
import { PassportModule } from '@nestjs/passport';
import { ConfigModule } from '@nestjs/config';
import { ClerkAuthGuard } from './clerk-auth.guard';
import { PrismaModule } from 'src/common/prisma.module';

// The Clerk client ('ClerkClient') now comes from the global ClerkModule
// (src/clerk). This module used to provide the legacy @clerk/clerk-sdk-node
// client under the same token; one client for the whole API since 2026-10-21.
@Module({
  imports: [PassportModule, PrismaModule, ConfigModule],
  providers: [ClerkStrategy, ClerkAuthGuard],
  exports: [ClerkStrategy, ClerkAuthGuard],
})
export class AuthModule {}
