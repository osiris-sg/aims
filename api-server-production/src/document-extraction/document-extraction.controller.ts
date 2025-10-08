import {
  Controller,
  Post,
  UseInterceptors,
  UploadedFile,
  HttpException,
  HttpStatus,
  UseGuards,
  Req,
  Body,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { Request } from 'express';
import { DocumentExtractionService, DocumentType } from './document-extraction.service';
import { Permissions } from 'src/auth/decorators/permissions.decorator';
import { ClerkAuthGuard } from 'src/auth/clerk-auth.guard';

// Extend Request type to include userOrganization
interface RequestWithOrganization extends Request {
  userOrganization?: {
    id: string;
    name: string;
  };
}

interface ExtractDocumentDto {
  documentType?: DocumentType;
}

interface ExtractFromUrlDto {
  imageUrl: string;
  documentType?: DocumentType;
}

@Controller('document-extraction')
@UseGuards(ClerkAuthGuard)
export class DocumentExtractionController {
  constructor(private readonly documentExtractionService: DocumentExtractionService) {}

  @Post('extract')
  @Permissions('document-extraction:extract')
  @UseInterceptors(
    FileInterceptor('document', {
      limits: {
        fileSize: 10 * 1024 * 1024, // 10MB limit
      },
      fileFilter: (req, file, callback) => {
        // Accept image files and PDFs
        if (!file.mimetype.match(/\/(jpg|jpeg|png|gif|webp|bmp|pdf)$/) && file.mimetype !== 'application/pdf') {
          return callback(
            new HttpException(
              'Only image files and PDFs are allowed (jpg, jpeg, png, gif, webp, bmp, pdf)',
              HttpStatus.BAD_REQUEST
            ),
            false
          );
        }
        callback(null, true);
      },
    })
  )
  async extractDocument(
    @UploadedFile() file: Express.Multer.File,
    @Body() body: ExtractDocumentDto,
    @Req() req: RequestWithOrganization
  ) {
    if (!file) {
      throw new HttpException('Please upload a document image', HttpStatus.BAD_REQUEST);
    }

    const organizationId = req.userOrganization?.id;
    if (!organizationId) {
      throw new HttpException(
        'User is not assigned to any organization',
        HttpStatus.UNAUTHORIZED
      );
    }

    try {
      const documentType = body.documentType || DocumentType.INVOICE;
      console.log(`📄 Processing ${documentType} upload for organization: ${organizationId}`);
      console.log(`📄 File info: ${file.originalname}, Size: ${file.size} bytes`);

      // Process the document file and extract data
      const extractedData = await this.documentExtractionService.processDocumentFile(
        file,
        documentType
      );

      return {
        success: true,
        data: extractedData,
        message: `${documentType.replace('_', ' ')} data extracted successfully`,
        metadata: {
          fileName: file.originalname,
          fileSize: file.size,
          mimeType: file.mimetype,
          documentType: documentType,
          organizationId: organizationId,
        }
      };
    } catch (error) {
      console.error('❌ Error in document extraction controller:', error);

      if (error instanceof HttpException) {
        throw error;
      }

      throw new HttpException(
        'Failed to process document. Please try again.',
        HttpStatus.INTERNAL_SERVER_ERROR
      );
    }
  }

  @Post('extract-url')
  @Permissions('document-extraction:extract-url')
  async extractDocumentFromUrl(
    @Body() body: ExtractFromUrlDto,
    @Req() req: RequestWithOrganization
  ) {
    const { imageUrl, documentType = DocumentType.INVOICE } = body;

    if (!imageUrl) {
      throw new HttpException('Please provide an image URL', HttpStatus.BAD_REQUEST);
    }

    const organizationId = req.userOrganization?.id;
    if (!organizationId) {
      throw new HttpException(
        'User is not assigned to any organization',
        HttpStatus.UNAUTHORIZED
      );
    }

    try {
      console.log(`📄 Processing ${documentType} from URL for organization: ${organizationId}`);

      // Fetch image from URL and convert to base64
      const response = await fetch(imageUrl);
      if (!response.ok) {
        throw new HttpException(
          'Failed to fetch image from URL',
          HttpStatus.BAD_REQUEST
        );
      }

      const arrayBuffer = await response.arrayBuffer();
      const buffer = Buffer.from(arrayBuffer);
      const base64Image = buffer.toString('base64');

      // Extract data using OpenAI
      const extractedData = await this.documentExtractionService.extractDocumentData(
        base64Image,
        documentType
      );

      return {
        success: true,
        data: extractedData,
        message: `${documentType.replace('_', ' ')} data extracted successfully`,
        metadata: {
          sourceUrl: imageUrl,
          documentType: documentType,
          organizationId: organizationId,
        }
      };
    } catch (error) {
      console.error(`❌ Error in ${documentType} extraction from URL:`, error);

      if (error instanceof HttpException) {
        throw error;
      }

      throw new HttpException(
        'Failed to process document. Please try again.',
        HttpStatus.INTERNAL_SERVER_ERROR
      );
    }
  }

  @Post('document-types')
  @Permissions('document-extraction:read-types')
  async getDocumentTypes() {
    return {
      success: true,
      data: [
        { value: DocumentType.INVOICE, label: 'Invoice' },
        { value: DocumentType.DELIVERY_ORDER, label: 'Delivery Order' },
        { value: DocumentType.QUOTATION, label: 'Quotation' },
        { value: DocumentType.PURCHASE_ORDER, label: 'Purchase Order' },
        { value: DocumentType.RECEIPT, label: 'Receipt' },
      ]
    };
  }
}