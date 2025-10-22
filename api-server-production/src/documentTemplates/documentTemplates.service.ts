import { HttpException, HttpStatus, Injectable } from '@nestjs/common';
import { PrismaService } from 'src/common/prisma.service';
import { GetDocumentTemplateDto } from './dto/get-documentTemplate.dto';
import { CreateDocumentTemplateDto } from './dto/create-documentTemplate.dto';
import { UpdateDocumentTemplateDto } from './dto/update-documentTemplate.dto';
import { DeleteDocumentTemplateDto } from './dto/delete-documentTemplate.dto';
import * as XLSX from 'xlsx';

@Injectable()
export class DocumentTemplatesService {
  constructor(private prisma: PrismaService) {}

  async getDocumentTemplates(getDocumentTemplateDto: GetDocumentTemplateDto, organizationId: string) {
    try {
      const { page, limit, search } = getDocumentTemplateDto;
      const skip = (page - 1) * limit;

      // Fetch organization's enabled document types
      const organization = await this.prisma.organization.findUnique({
        where: { id: organizationId },
        select: { customDocumentTypes: true },
      });

      // Build the where clause
      const whereClause: any = {
        organizationId,
      };

      // Filter by enabled document types if customDocumentTypes is set
      if (organization?.customDocumentTypes && Array.isArray(organization.customDocumentTypes) && organization.customDocumentTypes.length > 0) {
        // Filter by enabled types AND search if provided
        whereClause.AND = [
          {
            type: {
              in: organization.customDocumentTypes,
            },
          },
          ...(search
            ? [
                {
                  type: {
                    contains: search,
                    mode: 'insensitive' as const,
                  },
                },
              ]
            : []),
        ];
      } else if (search) {
        // No customDocumentTypes set, just filter by search
        whereClause.type = {
          contains: search,
          mode: 'insensitive' as const,
        };
      }

      const documentTemplates = await this.prisma.documentTemplate.findMany({
        where: whereClause,
        skip,
        take: limit,
        orderBy: {
          createdAt: 'desc',
        },
      });

      const totalDocs = await this.prisma.documentTemplate.count({
        where: whereClause,
      });

      const hasNextPage = skip + documentTemplates.length < totalDocs;
      const hasPreviousPage = page > 1;
      return {
        docs: documentTemplates,
        hasNextPage,
        hasPreviousPage,
        page,
        limit,
        totalPagesCount: Math.ceil(totalDocs / limit),
        totalDocuments: totalDocs,
      };
    } catch (error) {
      throw new HttpException(error.message, HttpStatus.INTERNAL_SERVER_ERROR);
    }
  }

  async getDocumentTemplateById(id: string, organizationId: string) {
    try {
      const documentTemplate = await this.prisma.documentTemplate.findFirst({
        where: {
          id,
          organizationId,
        },
      });

      if (!documentTemplate) {
        throw new HttpException('Document Template not found', HttpStatus.NOT_FOUND);
      }

      return documentTemplate;
    } catch (error) {
      console.error('Error fetching document template:', error);
      throw new HttpException(error.message || 'Internal Server Error', HttpStatus.INTERNAL_SERVER_ERROR);
    }
  }

  async createDocumentTemplates(dto: CreateDocumentTemplateDto, organizationId: string) {
    try {
      console.log('we have this data at hee ', dto);

      const newDocumentTemplate = await this.prisma.documentTemplate.create({
        data: {
          name: dto.name,
          type: dto.type,
          organizationId, // Automatically assign to user's organization
        },
      });

      return newDocumentTemplate;
    } catch (error) {
      console.error('Error creating document template:', error);
      throw new HttpException(error.message, HttpStatus.INTERNAL_SERVER_ERROR);
    }
  }

  async updateDocumentTemplates(updateDto: UpdateDocumentTemplateDto, organizationId: string) {
    try {
      const { id, name, type } = updateDto;

      const updated = await this.prisma.documentTemplate.update({
        where: {
          id,
          organizationId, // Ensure user can only update templates in their organization
        },
        data: {
          ...(name && { name }),
          ...(type && { type }),
          config: (() => {
            // Save all config fields dynamically instead of hardcoding
            const { id, name, type, ...configFields } = updateDto;
            // Convert to plain object to ensure JSON compatibility
            return JSON.parse(JSON.stringify(configFields));
          })(),
        },
      });

      return updated;
    } catch (error) {
      console.error('Error updating document template:', error);
      throw new HttpException(error.message, HttpStatus.INTERNAL_SERVER_ERROR);
    }
  }

  async deleteDocumentTemplates(deleteDocumentTemplateDto: DeleteDocumentTemplateDto, organizationId: string) {
    try {
      // First, delete all related DocumentItem records
      // await this.prisma.documentItem.deleteMany({
      //   where: { documentTemplateId: deleteDocumentTemplateDto.id },
      // });

      // Then, delete the DocumentTemplate
      const documentTemplate = await this.prisma.documentTemplate.delete({
        where: {
          id: deleteDocumentTemplateDto.id,
          organizationId, // Ensure user can only delete templates in their organization
        },
      });

      return documentTemplate;
    } catch (error) {
      throw new HttpException(error.message, HttpStatus.INTERNAL_SERVER_ERROR);
    }
  }
  async getDocumentTemplateByType(type: string, organizationId: string) {
    try {
      const documentTemplate = await this.prisma.documentTemplate.findFirst({
        where: {
          type,
          organizationId,
          isActive: true, // Get the active template
        },
      });

      if (!documentTemplate) {
        // If no active template, try to get any template of this type
        const anyTemplate = await this.prisma.documentTemplate.findFirst({
          where: {
            type,
            organizationId,
          },
        });

        if (!anyTemplate) {
          throw new HttpException(`Document Template of type "${type}" not found`, HttpStatus.NOT_FOUND);
        }

        return anyTemplate;
      }

      return documentTemplate;
    } catch (error) {
      console.error('Error fetching document template by type:', error);
      throw new HttpException(error.message || 'Internal Server Error', HttpStatus.INTERNAL_SERVER_ERROR);
    }
  }

  async getTemplateVariantsByType(type: string, organizationId: string) {
    try {
      const variants = await this.prisma.documentTemplate.findMany({
        where: {
          type,
          organizationId,
        },
        orderBy: [
          { isActive: 'desc' },
          { designName: 'asc' },
        ],
      });

      return variants;
    } catch (error) {
      console.error('Error fetching template variants:', error);
      throw new HttpException(error.message || 'Internal Server Error', HttpStatus.INTERNAL_SERVER_ERROR);
    }
  }

  async activateTemplateVariant(id: string, organizationId: string) {
    try {
      // Get the template to activate
      const template = await this.prisma.documentTemplate.findFirst({
        where: {
          id,
          organizationId,
        },
      });

      if (!template) {
        throw new HttpException('Template not found', HttpStatus.NOT_FOUND);
      }

      // Deactivate all other templates of the same type
      await this.prisma.documentTemplate.updateMany({
        where: {
          type: template.type,
          organizationId,
          id: { not: id },
        },
        data: {
          isActive: false,
        },
      });

      // Activate the selected template
      const activated = await this.prisma.documentTemplate.update({
        where: { id },
        data: { isActive: true },
      });

      return activated;
    } catch (error) {
      console.error('Error activating template variant:', error);
      throw new HttpException(error.message || 'Internal Server Error', HttpStatus.INTERNAL_SERVER_ERROR);
    }
  }

  async duplicateTemplateVariant(id: string, organizationId: string, designName: string, description?: string) {
    try {
      // Get the original template
      const original = await this.prisma.documentTemplate.findFirst({
        where: {
          id,
          organizationId,
        },
      });

      if (!original) {
        throw new HttpException('Template not found', HttpStatus.NOT_FOUND);
      }

      // Create a duplicate with new design name
      const duplicate = await this.prisma.documentTemplate.create({
        data: {
          name: original.name,
          type: original.type,
          organizationId,
          config: original.config,
          designName,
          description,
          isActive: false,
          isDefault: false,
          mockData: original.mockData,
          layoutConfig: original.layoutConfig,
          styleConfig: original.styleConfig,
        },
      });

      return duplicate;
    } catch (error) {
      console.error('Error duplicating template variant:', error);
      throw new HttpException(error.message || 'Internal Server Error', HttpStatus.INTERNAL_SERVER_ERROR);
    }
  }

  async updateTemplateFromExcel(id: string, organizationId: string, file: Express.Multer.File) {
    try {
      console.log('Processing Excel upload for template:', id);
      console.log('File details:', {
        originalname: file.originalname,
        mimetype: file.mimetype,
        size: file.size,
        hasBuffer: !!file.buffer,
      });

      // Check if template exists and belongs to organization
      const template = await this.prisma.documentTemplate.findFirst({
        where: {
          id,
          organizationId,
        },
      });

      if (!template) {
        throw new HttpException('Template not found', HttpStatus.NOT_FOUND);
      }

      if (!file.buffer) {
        throw new HttpException('No file buffer received', HttpStatus.BAD_REQUEST);
      }

      // Parse the Excel file
      console.log('Parsing Excel file...');
      const workbook = XLSX.read(file.buffer, { type: 'buffer' });

      // Get the first worksheet
      const sheetName = workbook.SheetNames[0];
      if (!sheetName) {
        throw new HttpException('Excel file has no worksheets', HttpStatus.BAD_REQUEST);
      }

      const worksheet = workbook.Sheets[sheetName];
      console.log('Processing worksheet:', sheetName);

      // Convert to JSON array
      const jsonData = XLSX.utils.sheet_to_json(worksheet, {
        header: 1,
        defval: '',
        blankrows: true,
      }) as any[][];

      console.log('Excel data rows:', jsonData.length);

      // Extract placeholder variables from the Excel template
      const variables = new Set<string>();
      const variablePattern = /\{\{([^}]+)\}\}/g;

      jsonData.forEach((row: any[]) => {
        if (Array.isArray(row)) {
          row.forEach((cell: any) => {
            if (typeof cell === 'string') {
              const cellStr = String(cell);
              variablePattern.lastIndex = 0; // Reset regex state
              let match;
              while ((match = variablePattern.exec(cellStr)) !== null) {
                variables.add(match[1].trim());
              }
            }
          });
        }
      });

      console.log('Found variables:', Array.from(variables));

      // Convert Excel layout to HTML template
      const htmlTemplate = this.convertExcelToHtmlTemplate(jsonData);

      // Update the template with new layout
      const updated = await this.prisma.documentTemplate.update({
        where: { id },
        data: {
          layoutConfig: {
            excelLayout: jsonData,
            variables: Array.from(variables),
            htmlTemplate,
            timestamp: new Date().toISOString(),
          },
        },
      });

      console.log('Template updated successfully');
      return updated;
    } catch (error) {
      console.error('Error updating template from Excel:', error);
      if (error instanceof HttpException) {
        throw error;
      }
      throw new HttpException(
        `Failed to process Excel template: ${error.message}`,
        HttpStatus.INTERNAL_SERVER_ERROR,
      );
    }
  }

  private convertExcelToHtmlTemplate(excelData: any[][]): string {
    let html = '<div class="document-template">';
    html += '<style>';
    html += '.document-template { font-family: Arial, sans-serif; padding: 20px; }';
    html += '.template-table { width: 100%; border-collapse: collapse; margin: 10px 0; border: none; }';
    html += '.template-table td { padding: 8px; border: none; }';
    html += '.template-header { font-weight: bold; border-bottom: 2px solid #000 !important; border-top: none; border-left: none; border-right: none; }';
    html += '.text-center { text-align: center; }';
    html += '.text-right { text-align: right; }';
    html += '</style>';

    html += '<table class="template-table">';

    let inItemsSection = false;

    excelData.forEach((row, rowIndex) => {
      if (!Array.isArray(row) || row.length === 0) {
        html += '<tr><td colspan="6">&nbsp;</td></tr>';
        return;
      }

      // Check if this is the items header row
      const firstCell = row[0]?.toString().toLowerCase();
      if (firstCell === 'item' || firstCell === '{{item_1}}') {
        inItemsSection = true;
      }

      html += '<tr>';

      // Check if all cells in row are empty
      const isEmptyRow = row.every(cell => !cell || cell.toString().trim() === '');

      if (isEmptyRow) {
        html += '<td colspan="6">&nbsp;</td></tr>';
      } else if (row.length === 1 || (row.length > 1 && !row[1])) {
        // Single cell or merged row
        const cellContent = row[0] || '';
        const isTitle = cellContent.toString().includes('INVOICE') ||
                       cellContent.toString().includes('ORDER') ||
                       cellContent.toString().includes('QUOTATION') ||
                       cellContent.toString().includes('REPORT');

        html += `<td colspan="6" class="${isTitle ? 'text-center' : ''}" style="${isTitle ? 'font-size: 18px; font-weight: bold;' : ''}">`;
        html += cellContent;
        html += '</td>';
      } else {
        // Regular row with multiple cells
        row.forEach((cell, cellIndex) => {
          const cellContent = cell || '';
          let cellClass = '';

          if (rowIndex === 0 && inItemsSection) {
            cellClass = 'template-header';
          }

          if (cellIndex >= 2 && inItemsSection) {
            cellClass += ' text-center';
          }

          if (cellIndex === row.length - 1 && cellContent.toString().includes('{{')) {
            cellClass += ' text-right';
          }

          html += `<td class="${cellClass}">${cellContent}</td>`;
        });

        // Fill empty cells if row is shorter than 6
        for (let i = row.length; i < 6; i++) {
          html += '<td>&nbsp;</td>';
        }
      }

      html += '</tr>';
    });

    html += '</table>';
    html += '</div>';

    return html;
  }

  getMockDataForType(type: string) {
    // Return mock data based on document type
    const mockData = {
      TI: {
        company: {
          name: 'Sample Company Ltd.',
          address: '123 Business Street, Singapore 123456',
          phoneNumber: '+65 6123 4567',
          gstRegNo: 'M2-1234567-8',
        },
        customer: {
          name: 'ABC Corporation',
          address: '456 Client Avenue, Singapore 654321',
        },
        documentInfo: {
          date: new Date().toISOString().split('T')[0],
          documentNumber: 'INV-2024-001',
          referenceNo: 'REF-2024-001',
          doNo: 'DO-2024-001',
        },
        items: [
          {
            id: 1,
            description: 'Professional Services - Consulting',
            quantity: 10,
            unitPrice: 150,
            tax: 9,
            amount: 1500,
          },
          {
            id: 2,
            description: 'Software License - Annual Subscription',
            quantity: 1,
            unitPrice: 2500,
            tax: 9,
            amount: 2500,
          },
          {
            id: 3,
            description: 'Hardware - Server Equipment',
            quantity: 2,
            unitPrice: 3000,
            tax: 9,
            amount: 6000,
          },
        ],
        paymentTerms: '30 days',
        dueDate: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString().split('T')[0],
        note: 'Thank you for your business. Please remit payment by the due date.',
        termsAndConditions: 'Payment is due within 30 days. Late payments subject to 1.5% monthly interest.',
        bankDetails: 'Bank: DBS Bank\nAccount Name: Sample Company Ltd.\nAccount No: 123-456789-0\nSWIFT Code: DBSSSGSG',
      },
      DO: {
        company: {
          name: 'Sample Logistics Co.',
          address: '789 Delivery Road, Singapore 789012',
          phoneNumber: '+65 6789 0123',
        },
        customer: {
          name: 'XYZ Industries',
          address: '321 Factory Lane, Singapore 321098',
        },
        documentInfo: {
          date: new Date().toISOString().split('T')[0],
          documentNumber: 'DO-2024-001',
          referenceNo: 'PO-2024-123',
          doNo: 'DO-2024-001',
          poNo: 'PO-2024-123',
        },
        deliveryAddress: {
          attention: 'Mr. John Doe',
          phone: '+65 9123 4567',
          address: '321 Factory Lane, Warehouse B, Singapore 321098',
          instructions: 'Please deliver to loading dock 3. Contact security upon arrival.',
        },
        items: [
          {
            id: 1,
            description: 'Steel Beams - Grade A',
            quantity: 50,
            unitPrice: 100,
            tax: 9,
            amount: 5000,
          },
          {
            id: 2,
            description: 'Concrete Blocks - Standard',
            quantity: 100,
            unitPrice: 25,
            tax: 9,
            amount: 2500,
          },
        ],
        note: 'Handle with care. Fragile items included.',
      },
      QO1: {
        company: {
          name: 'Professional Services Inc.',
          address: '555 Commerce Plaza, Singapore 555123',
          phoneNumber: '+65 6555 1234',
        },
        customer: {
          name: 'Potential Client Corp.',
          address: '999 Prospect Street, Singapore 999876',
        },
        documentInfo: {
          date: new Date().toISOString().split('T')[0],
          documentNumber: 'QO-2024-001',
          referenceNo: 'RFQ-2024-456',
        },
        quotationNo: 'QO-2024-001',
        validityTerm: '30 days',
        currency: 'SGD',
        items: [
          {
            id: 1,
            description: 'Website Development - E-commerce Platform',
            quantity: 1,
            unitPrice: 15000,
            tax: 9,
            amount: 15000,
          },
          {
            id: 2,
            description: 'Mobile App Development - iOS & Android',
            quantity: 1,
            unitPrice: 25000,
            tax: 9,
            amount: 25000,
          },
          {
            id: 3,
            description: 'Annual Maintenance & Support',
            quantity: 1,
            unitPrice: 8000,
            tax: 9,
            amount: 8000,
          },
        ],
        note: 'This quotation is valid for 30 days from the date of issue.',
        termsAndConditions: '50% deposit required upon confirmation. Balance due upon project completion.',
        remarks: 'Prices are subject to change based on final requirements.',
        agreementText: 'By accepting this quotation, you agree to the terms and conditions stated above.',
      },
      MSR: {
        company: {
          name: 'Maintenance Services Pte Ltd',
          address: '100 Service Road, Singapore 100200',
          phoneNumber: '+65 6100 2000',
        },
        customer: {
          name: 'Building Management Corp.',
          address: '200 Tower Street, Singapore 200300',
        },
        documentInfo: {
          date: new Date().toISOString().split('T')[0],
          documentNumber: 'MSR-2024-001',
        },
        equipmentId: 'EQ-2024-123',
        location: 'Level 5, Equipment Room A',
        reportType: 'preventive',
        serviceDate: new Date().toISOString().split('T')[0],
        description: 'Routine preventive maintenance completed. All systems operational.',
        items: [
          {
            id: 1,
            description: 'Filter Replacement',
            quantity: 2,
            unitPrice: 50,
            tax: 9,
            amount: 100,
          },
          {
            id: 2,
            description: 'System Calibration',
            quantity: 1,
            unitPrice: 200,
            tax: 9,
            amount: 200,
          },
        ],
        note: 'Next scheduled maintenance: 3 months from service date.',
      },
      RDO: {
        company: {
          name: 'Returns Processing Center',
          address: '456 Return Avenue, Singapore 456789',
          phoneNumber: '+65 6456 7890',
        },
        customer: {
          name: 'Original Buyer Ltd.',
          address: '789 Purchase Road, Singapore 789456',
        },
        documentInfo: {
          date: new Date().toISOString().split('T')[0],
          documentNumber: 'RDO-2024-001',
          returnOrderNo: 'RET-2024-001',
          poNo: 'PO-2024-789',
        },
        collectFrom: 'Warehouse C, Bay 12',
        deliveryAddress: {
          attention: 'Returns Department',
          phone: '+65 9456 7890',
          address: '456 Return Avenue, Returns Bay, Singapore 456789',
          instructions: 'Please process return within 5 business days.',
        },
        items: [
          {
            id: 1,
            description: 'Defective Product - Model X123',
            quantity: 5,
            unitPrice: 100,
            tax: 9,
            amount: 500,
          },
        ],
        note: 'Items being returned due to manufacturing defect. Full refund requested.',
      },
    };

    return mockData[type] || mockData.TI; // Default to invoice if type not found
  }
}
