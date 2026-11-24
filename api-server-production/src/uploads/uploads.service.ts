import { BadRequestException, HttpException, HttpStatus, Injectable } from '@nestjs/common';
import { S3Client, CreateMultipartUploadCommand, CompletedPart, UploadPartCommand, CompleteMultipartUploadCommand, AbortMultipartUploadCommand } from '@aws-sdk/client-s3';
import { ConfigService } from '@nestjs/config';
import { allowedMime, buildOrgKey, bytesMatchMime, contentDispositionFor, folderFromHint } from '../common/storage-keys';
@Injectable()
export class UploadsService {
  private s3Client: S3Client;
  constructor(private configService: ConfigService) {
    this.s3Client = new S3Client({
      region: this.configService.get<string>('AWS.REGION'),
      credentials: {
        accessKeyId: this.configService.get<string>('AWS.ACCESS_KEY_ID'),
        secretAccessKey: this.configService.get<string>('AWS.SECRET_ACCESS_KEY'),
      },
    });
  }
  /**
   * A user upload: the SERVER builds the key (`org/<orgId>/<folder>/<uuid>.<ext>`)
   * from the caller's org, an allow-listed folder and an allow-listed type.
   * `folderHint` is the client's old folder/key, only mapped onto the allow-list.
   */
  async uploadOrgFile({ file, organizationId, folderHint, hintIsKey }: { file: Express.Multer.File; organizationId: string; folderHint?: unknown; hintIsKey?: boolean }): Promise<string> {
    if (!file?.buffer?.length) throw new BadRequestException('No file uploaded');
    const mime = allowedMime(file.mimetype, file.originalname);
    if (!mime) throw new BadRequestException('That file type cannot be uploaded. Use an image, a PDF or an Office document.');
    if (!bytesMatchMime(file.buffer, mime)) throw new BadRequestException('The file does not match its type');
    const key = buildOrgKey(organizationId, folderFromHint(folderHint, { isKey: hintIsKey }), mime);
    return this.uploadFileInChunks({ file: { ...file, mimetype: mime } as Express.Multer.File, key });
  }

  /** Low level: store bytes under a key the SERVER built. Never pass a client-chosen key. */
  async uploadFileInChunks({ file, key }: { file: Express.Multer.File; key: string }): Promise<string> {
    const bucketName = this.configService.get<string>('AWS.RESOURCE_BUCKET');
    const fileKey = key;
    const partSize = 5 * 1024 * 1024; // 5MB (Minimum for S3 multipart upload)
    const fileBuffer = file.buffer;
    const createCommand = new CreateMultipartUploadCommand({
      Bucket: bucketName,
      Key: fileKey,
      ContentType: file.mimetype || 'application/octet-stream',
      // Anything that is not an image/PDF downloads instead of opening (no HTML hosting).
      ContentDisposition: contentDispositionFor(file.mimetype),
    });
    const createResponse = await this.s3Client.send(createCommand);
    try {
      // Step 1: Initiate Multipart Upload
      const uploadId = createResponse.UploadId;
      if (!uploadId) {
        throw new Error('Failed to create multipart upload');
      }
      // Step 2: Upload Parts
      const parts: CompletedPart[] = [];
      for (let start = 0, partNumber = 1; start < fileBuffer.length; start += partSize, partNumber++) {
        const end = Math.min(start + partSize, fileBuffer.length);
        const partBuffer = fileBuffer.slice(start, end);
        const uploadPartCommand = new UploadPartCommand({
          Bucket: bucketName,
          Key: fileKey,
          UploadId: uploadId,
          PartNumber: partNumber,
          Body: partBuffer,
        });
        const uploadPartResponse = await this.s3Client.send(uploadPartCommand);
        parts.push({
          ETag: uploadPartResponse.ETag,
          PartNumber: partNumber,
        });
      }
      // Step 3: Complete Multipart Upload
      const completeCommand = new CompleteMultipartUploadCommand({
        Bucket: bucketName,
        Key: fileKey,
        UploadId: uploadId,
        MultipartUpload: {
          Parts: parts,
        },
      });
      await this.s3Client.send(completeCommand);
      return fileKey;
    } catch (error) {
      console.error('Error during multipart upload:', error);
      // Abort Multipart Upload in case of failure
      const abortCommand = new AbortMultipartUploadCommand({
        Bucket: bucketName,
        Key: fileKey,
        UploadId: createResponse?.UploadId,
      });
      await this.s3Client.send(abortCommand);
      throw new HttpException(`Failed to upload file in chunks: ${error.message}`, HttpStatus.INTERNAL_SERVER_ERROR);
    }
  }
}
