import { Module, forwardRef } from '@nestjs/common';
import { AssetsService } from './assets.service';
import { AssetsController } from './assets.controller';
import { InventoriesModule } from 'src/inventories/inventories.module';
import { PrismaService } from 'src/common/prisma.service';

@Module({
  imports: [forwardRef(() => InventoriesModule)],
  controllers: [AssetsController],
  providers: [AssetsService, PrismaService],
  exports: [AssetsService],
})
export class AssetsModule {}
