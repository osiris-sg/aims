import { Module } from '@nestjs/common';
import { S3Service } from '../common/services/s3.service';
import { TempSignatureController } from './temp-signature.controller';
import { TempSignatureService } from './temp-signature.service';

/** TEMPORARY standalone signature capture — S3 only, no Prisma, no schema. */
@Module({
  controllers: [TempSignatureController],
  providers: [TempSignatureService, S3Service],
})
export class TempSignatureModule {}
