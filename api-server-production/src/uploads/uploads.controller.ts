import { Controller, Post, UseInterceptors, UploadedFile, Body } from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { UploadsService } from './uploads.service';
import { Permissions } from 'src/auth/decorators/permissions.decorator';

@Controller('uploads')
export class UploadsController {
  constructor(private readonly uploadsService: UploadsService) {}

  @Post('image')
  @Permissions('uploads:upload-image')
  @UseInterceptors(FileInterceptor('file'))
  async uploadImage(@UploadedFile() file: Express.Multer.File, @Body() { key }: { key: string }) {
    if (!file) {
      throw new Error('No file uploaded');
    }
    const Key = await this.uploadsService.uploadFileInChunks({ file, key });
    return { Key };
  }
}
