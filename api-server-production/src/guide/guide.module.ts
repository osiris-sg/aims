import { Module } from '@nestjs/common';
import { GuideController } from './guide.controller';
import { GuideService } from './guide.service';
import { PrismaService } from '../common/prisma.service';

@Module({
  controllers: [GuideController],
  // ClerkAuthGuard (applied to GuideController) depends on PrismaService —
  // every module that uses the guard provides it, mirroring AskModule.
  providers: [GuideService, PrismaService],
})
export class GuideModule {}
