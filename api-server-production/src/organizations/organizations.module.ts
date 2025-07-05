import { Module } from '@nestjs/common';
import { OrganizationsService } from './organizations.service';
import { PrismaModule } from '../common/prisma.module';

@Module({
  imports: [PrismaModule],
  providers: [OrganizationsService],
  exports: [OrganizationsService],
})
export class OrganizationsModule {}
