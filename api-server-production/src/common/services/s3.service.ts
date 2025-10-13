import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  S3Client,
  PutObjectCommand,
  GetObjectCommand,
  DeleteObjectCommand,
} from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';

@Injectable()
export class S3Service {
  private s3Client: S3Client;
  private bucketName: string;

  constructor(private configService: ConfigService) {
    this.s3Client = new S3Client({
      region: this.configService.get('AWS_REGION', 'ap-southeast-1'),
      credentials: {
        accessKeyId: this.configService.get('AWS_ACCESS_KEY_ID'),
        secretAccessKey: this.configService.get('AWS_SECRET_ACCESS_KEY'),
      },
    });
    this.bucketName = this.configService.get('RESOURCE_BUCKET', 'aims-osiris');
  }

  async uploadFile(
    key: string,
    body: Buffer | Uint8Array | string,
    contentType: string = 'application/pdf',
  ): Promise<string> {
    const command = new PutObjectCommand({
      Bucket: this.bucketName,
      Key: key,
      Body: body,
      ContentType: contentType,
    });

    await this.s3Client.send(command);

    // Return the S3 URL
    return `https://${this.bucketName}.s3.${this.configService.get('AWS_REGION', 'ap-southeast-1')}.amazonaws.com/${key}`;
  }

  async getSignedUrl(key: string, expiresIn: number = 3600): Promise<string> {
    const command = new GetObjectCommand({
      Bucket: this.bucketName,
      Key: key,
    });

    return getSignedUrl(this.s3Client, command, { expiresIn });
  }

  async deleteFile(key: string): Promise<void> {
    const command = new DeleteObjectCommand({
      Bucket: this.bucketName,
      Key: key,
    });

    await this.s3Client.send(command);
  }

  async uploadPdf(
    organizationId: string,
    documentType: string,
    documentId: string,
    pdfBuffer: Buffer,
  ): Promise<{ url: string; key: string }> {
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    const key = `documents/${organizationId}/${documentType}/${documentId}_${timestamp}.pdf`;

    const url = await this.uploadFile(key, pdfBuffer, 'application/pdf');

    return { url, key };
  }
}