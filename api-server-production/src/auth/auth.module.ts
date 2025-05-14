// src/auth/auth.module.ts
import { Module } from '@nestjs/common';
import { ClerkStrategy } from './clerk.strategy';
import { PassportModule } from '@nestjs/passport';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { ClerkAuthGuard } from './clerk-auth.guard';
import { PrismaModule } from 'src/common/prisma.module';
import { clerkClient } from "@clerk/clerk-sdk-node";

@Module({
  imports: [PassportModule, PrismaModule, ConfigModule],
  providers: [
    ClerkStrategy, 
    ClerkAuthGuard,   
    {
      provide: 'ClerkClient',
      useFactory: (configService: ConfigService) => {
        const secretKey = configService.get<string>('CLERK_SECRET_KEY');
        // Set the API key for the clerk client
        process.env.CLERK_SECRET_KEY = secretKey; 
        // Return the pre-configured client
        return clerkClient;
      },
      inject: [ConfigService],
    }
  ],
  exports: [
    ClerkStrategy,
    ClerkAuthGuard,
    'ClerkClient',
  ],
})
export class AuthModule {}