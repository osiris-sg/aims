import { Module, forwardRef } from '@nestjs/common';
import { ProjectsService } from './projects.service';
import { ProjectsController } from './projects.controller';
import { InventoriesModule } from 'src/inventories/inventories.module';
import { DocumentsModule } from 'src/documents/documents.module';
import { PrismaService } from 'src/common/prisma.service';

@Module({
  // BOTH lazy. DocumentsModule is index [1] and is the edge Nest reported as
  // `undefined`: the cycle is
  //     DocumentsModule -> DeliveriesModule -> ProjectsModule -> DocumentsModule
  // so when resolution enters at DocumentsModule, that binding is still being
  // defined when this file evaluates. forwardRef defers the lookup past the
  // module's own definition, which is the only thing that breaks the cycle.
  imports: [forwardRef(() => InventoriesModule), forwardRef(() => DocumentsModule)],
  controllers: [ProjectsController],
  providers: [ProjectsService, PrismaService],
  exports: [ProjectsService],
})
export class ProjectsModule {}
