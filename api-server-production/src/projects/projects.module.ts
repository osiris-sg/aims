import { Module, forwardRef } from '@nestjs/common';
import { ProjectsService } from './projects.service';
import { ProjectsController } from './projects.controller';
import { InventoriesModule } from 'src/inventories/inventories.module';
import { PrismaService } from 'src/common/prisma.service';

@Module({
  imports: [forwardRef(() => InventoriesModule)],
  controllers: [ProjectsController],
  providers: [ProjectsService, PrismaService],
  exports: [ProjectsService],
})
export class ProjectsModule {}
