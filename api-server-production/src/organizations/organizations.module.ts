import { Module } from '@nestjs/common';
import { OrganizationsService } from './organizations.service';
import { OrganizationsController } from './organizations.controller';
import { PrismaModule } from '../common/prisma.module';
import { ClerkClientProvider } from '../providers/clerk-client.provider';

@Module({
  imports: [PrismaModule],
  controllers: [OrganizationsController],
  providers: [OrganizationsService, ClerkClientProvider],
  exports: [OrganizationsService],
})
export class OrganizationsModule {}
