import { Controller, Post, UseInterceptors, UploadedFile, Body } from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { UploadsService } from './uploads.service';
import { IdempotencyInterceptor } from 'src/common/idempotency/idempotency.interceptor';
import { Permissions } from 'src/auth/decorators/permissions.decorator';

@Controller('uploads')
export class UploadsController {
  constructor(private readonly uploadsService: UploadsService) {}

  @Post('image')
  @Permissions('uploads:upload-image')
  // Idempotency-Key: a resent photo upload stores once (the file counts towards "the same request").
  @UseInterceptors(FileInterceptor('file'), IdempotencyInterceptor)
  async uploadImage(@UploadedFile() file: Express.Multer.File, @Body() { key }: { key: string }) {
    if (!file) {
      throw new Error('No file uploaded');
    }
    const Key = await this.uploadsService.uploadFileInChunks({ file, key });
    return { Key };
  }
}
