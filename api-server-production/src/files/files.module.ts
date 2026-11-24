import { Global, Module } from '@nestjs/common';
import { PrismaService } from '../common/prisma.service';
import { S3Service } from '../common/services/s3.service';
import { FilesController } from './files.controller';
import { FilesService } from './files.service';

/** Global so any module can presign or check file ownership (FilesService). */
@Global()
@Module({
  controllers: [FilesController],
  providers: [FilesService, PrismaService, S3Service],
  exports: [FilesService],
})
export class FilesModule {}
