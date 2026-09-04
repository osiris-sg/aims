import { Global, Module } from '@nestjs/common';
import { PrismaService } from '../common/prisma.service';
import { DeviceTokenService } from './device-token.service';
import { PushController } from './push.controller';
import { PushService } from './push.service';

/**
 * Push notifications. @Global so any feature module can inject PushService to
 * notify riders without an import dance — the same posture as the action-log
 * and notifications modules.
 */
@Global()
@Module({
  controllers: [PushController],
  providers: [PushService, DeviceTokenService, PrismaService],
  exports: [PushService, DeviceTokenService],
})
export class PushModule {}
