import { Module, forwardRef } from '@nestjs/common';
import { InventoriesService } from './inventories.service';
import { InventoriesController } from './inventories.controller';
import { AssetsModule } from 'src/assets/assets.module';
import { PrismaService } from 'src/common/prisma.service';
import { CommonModule } from 'src/common/common.module';

@Module({
  imports: [forwardRef(() => AssetsModule), CommonModule],
  controllers: [InventoriesController],
  providers: [InventoriesService, PrismaService],
  exports: [InventoriesService],
})
export class InventoriesModule {}
