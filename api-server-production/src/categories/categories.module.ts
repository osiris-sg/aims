import { Module } from '@nestjs/common';
import { CategoriesService } from './categories.service';
import { CategoriesController } from './categories.controller';
import { AssetsModule } from 'src/assets/assets.module';
import { PrismaService } from 'src/common/prisma.service';

@Module({
  imports: [AssetsModule],
  controllers: [CategoriesController],
  providers: [CategoriesService, PrismaService],
  exports: [CategoriesService],
})
export class CategoriesModule {}
