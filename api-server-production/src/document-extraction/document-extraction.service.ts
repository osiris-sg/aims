import { Injectable, HttpException, HttpStatus } from '@nestjs/common';
import { OpenAI } from 'openai';
import Anthropic from '@anthropic-ai/sdk';
import { ConfigService } from '@nestjs/config';
const pdfParse = require('pdf-parse');

export enum DocumentType {
  INVOICE = 'invoice',
  DELIVERY_ORDER = 'delivery_order',
  QUOTATION = 'quotation',
  PURCHASE_ORDER = 'purchase_order',
  RECEIPT = 'receipt',
}

export interface ExtractedDocumentData {
  documentType: DocumentType;

  // Customer Information
  customer: {
    name?: string;
    address?: string;
    attention?: string;
    accountsDepartment?: string;
  };

  // Document Details (generic for all document types)
  document: {
    number?: string;
    date?: string;
    dueDate?: string;
    reference?: string;
    type?: string; // Invoice, DO, Quotation, etc.
  };

  // References (can be DO, PO, Quotation, etc.)
  references: {
    doNumber?: string;
    doDate?: string;
    quotationRef?: string;
    quotationDate?: string;
    workOrderNo?: string;
    workOrderDate?: string;
    poNumber?: string;
    poDate?: string;
  };

  // Project/Location
  project: {
    location?: string;
    projectDept?: string;
  };

  // Items/Line Items
  items: Array<{
    description?: string;
    quantity?: number;
    unitPrice?: number;
    tax?: number;
    amount?: number;
    serialNumbers?: string[];
    unit?: string; // unit of measurement
  }>;

  // Totals
  totals: {
    subtotal?: number;
    tax?: number;
    total?: number;
  };

  // Company Information (From Document)
  company: {
    name?: string;
    address?: string;
    gstRegNo?: string;
    registrationNo?: string;
  };

  // Additional fields for specific document types
  additionalFields?: {
    deliveryDate?: string;
    deliveryAddress?: string;
    terms?: string;
    paymentTerms?: string;
    validity?: string;
    shippingMethod?: string;
    [key: string]: any;
  };
}

// Supplier reconciliation: a focused extraction shape used when a supplier's
// DO or Tax Invoice is uploaded to verify it matches a buyer's PO. Captures
// item CODE separately from description (the PO matches on SKU), and pulls
// reward / loyalty Points which Route Order POs care about.
export interface SupplierReconciliationData {
  docKind?: 'DELIVERY_ORDER' | 'INVOICE' | 'UNKNOWN';
  docNumber?: string;
  docDate?: string;
  // The BUYER's PO reference printed on the supplier doc (e.g. "PO No.",
  // "Customer PO No."). NOT the supplier's own sales order number.
  customerPoNumber?: string;
  salesOrderNumber?: string;
  projectName?: string;
  items: Array<{
    code?: string;
    description?: string;
    quantity?: number;
    unit?: string;
    unitPrice?: number;
    amount?: number;
  }>;
  totals?: {
    subtotal?: number;
    tax?: number;
    taxPercent?: number;
    total?: number;
  };
  points?: {
    issued?: number;
    redeemed?: number;
  };
  supplier?: {
    name?: string;
    gstRegNo?: string;
  };
}

@Injectable()
export class DocumentExtractionService {
  private openai: OpenAI;

  constructor(private configService: ConfigService) {
    const apiKey = this.configService.get<string>('OPENAI_API_KEY');

    if (!apiKey || apiKey === 'your_openai_api_key_here') {
      console.warn('⚠️ OpenAI API key not configured. Document extraction will not work.');
      this.openai = null;
    } else {
      this.openai = new OpenAI({
        apiKey: apiKey,
      });
    }
  }

  async extractDocumentData(
    imageBase64: string,
    documentType: DocumentType = DocumentType.INVOICE
  ): Promise<ExtractedDocumentData> {
    if (!this.openai) {
      throw new HttpException(
        'OpenAI API key not configured. Please add your API key to the .env file.',
        HttpStatus.SERVICE_UNAVAILABLE
      );
    }

    try {
      console.log(`📄 Starting ${documentType} extraction with OpenAI Vision API`);

      const systemPrompt = this.getSystemPrompt(documentType);
      const userPrompt = this.getUserPrompt(documentType);

      const response = await this.openai.chat.completions.create({
        model: "gpt-4o-mini",
        messages: [
          {
            role: "system",
            content: systemPrompt
          },
          {
            role: "user",
            content: [
              {
                type: "text",
                text: userPrompt
              },
              {
                type: "image_url",
                image_url: {
                  url: `data:image/jpeg;base64,${imageBase64}`,
                  detail: "high"
                }
              }
            ]
          }
        ],
        max_tokens: 2000,
        temperature: 0.1, // Low temperature for more consistent extraction
        response_format: { type: "json_object" }
      });

      const extractedData = JSON.parse(response.choices[0].message.content);
      console.log(`✅ ${documentType} data extracted successfully`);

      return this.validateAndCleanData({
        ...extractedData,
        documentType
      });

    } catch (error) {
      console.error(`❌ Error extracting ${documentType} data:`, error);

      if (error.response?.status === 401) {
        throw new HttpException(
          'Invalid OpenAI API key. Please check your configuration.',
          HttpStatus.UNAUTHORIZED
        );
      }

      throw new HttpException(
        `Failed to extract ${documentType} data: ${error.message}`,
        HttpStatus.INTERNAL_SERVER_ERROR
      );
    }
  }

  private getSystemPrompt(documentType: DocumentType): string {
    const basePrompt = `You are an expert at extracting structured data from ${documentType.replace('_', ' ')} images.
    Extract all relevant information and return it in the exact JSON format specified.
    Be precise with dates (use YYYY-MM-DD format), numbers, and references.
    If a field is not found, leave it as undefined or empty array for arrays.`;

    const typeSpecificPrompts = {
      [DocumentType.INVOICE]: `Pay special attention to invoice numbers, payment terms, due dates, and tax calculations.`,
      [DocumentType.DELIVERY_ORDER]: `Focus on delivery details, recipient information, delivery dates, and item quantities.`,
      [DocumentType.QUOTATION]: `Extract quotation validity, terms and conditions, and pricing details carefully.`,
      [DocumentType.PURCHASE_ORDER]: `Identify PO numbers, delivery requirements, and approval signatures.`,
      [DocumentType.RECEIPT]: `Extract transaction details, payment method, and receipt numbers.`,
    };

    return `${basePrompt} ${typeSpecificPrompts[documentType] || ''}`;
  }

  private getUserPrompt(documentType: DocumentType): string {
    return `Extract all information from this ${documentType.replace('_', ' ')} image and return it in this exact JSON structure:
    {
      "customer": {
        "name": "customer company name",
        "address": "full customer address",
        "attention": "attention/contact person",
        "accountsDepartment": "accounts department if mentioned"
      },
      "document": {
        "number": "document number",
        "date": "document date in YYYY-MM-DD format",
        "dueDate": "due date in YYYY-MM-DD format (if applicable)",
        "reference": "document reference if any",
        "type": "type of document (Invoice/DO/Quotation/PO/Receipt)"
      },
      "references": {
        "doNumber": "delivery order number if referenced",
        "doDate": "DO date in YYYY-MM-DD format",
        "quotationRef": "quotation reference if mentioned",
        "quotationDate": "quotation date in YYYY-MM-DD format",
        "workOrderNo": "work order number if mentioned",
        "workOrderDate": "work order date in YYYY-MM-DD format",
        "poNumber": "purchase order number if referenced",
        "poDate": "PO date in YYYY-MM-DD format"
      },
      "project": {
        "location": "project location or delivery site",
        "projectDept": "project name or department"
      },
      "items": [
        {
          "description": "item description",
          "quantity": numeric quantity,
          "unitPrice": numeric unit price,
          "unit": "unit of measurement (pcs, kg, etc.)",
          "tax": tax percentage as number (e.g., 9 for 9%),
          "amount": numeric total amount,
          "serialNumbers": ["serial numbers if any"]
        }
      ],
      "totals": {
        "subtotal": numeric subtotal,
        "tax": numeric tax amount,
        "total": numeric total amount
      },
      "company": {
        "name": "issuing company name",
        "address": "issuing company address",
        "gstRegNo": "GST registration number",
        "registrationNo": "company registration number"
      },
      "additionalFields": {
        "deliveryDate": "delivery date if mentioned",
        "deliveryAddress": "delivery address if different",
        "terms": "terms and conditions",
        "paymentTerms": "payment terms",
        "validity": "quotation validity period",
        "shippingMethod": "shipping or delivery method"
      }
    }`;
  }

  private validateAndCleanData(data: any): ExtractedDocumentData {
    // Clean and validate the extracted data
    return {
      documentType: data.documentType || DocumentType.INVOICE,
      customer: {
        name: data.customer?.name || undefined,
        address: data.customer?.address || undefined,
        attention: data.customer?.attention || undefined,
        accountsDepartment: data.customer?.accountsDepartment || undefined,
      },
      document: {
        number: data.document?.number || undefined,
        date: this.parseDate(data.document?.date),
        dueDate: this.parseDate(data.document?.dueDate),
        reference: data.document?.reference || undefined,
        type: data.document?.type || undefined,
      },
      references: {
        doNumber: data.references?.doNumber || undefined,
        doDate: this.parseDate(data.references?.doDate),
        quotationRef: data.references?.quotationRef || undefined,
        quotationDate: this.parseDate(data.references?.quotationDate),
        workOrderNo: data.references?.workOrderNo || undefined,
        workOrderDate: this.parseDate(data.references?.workOrderDate),
        poNumber: data.references?.poNumber || undefined,
        poDate: this.parseDate(data.references?.poDate),
      },
      project: {
        location: data.project?.location || undefined,
        projectDept: data.project?.projectDept || undefined,
      },
      items: this.cleanItems(data.items),
      totals: {
        subtotal: this.parseNumber(data.totals?.subtotal),
        tax: this.parseNumber(data.totals?.tax),
        total: this.parseNumber(data.totals?.total),
      },
      company: {
        name: data.company?.name || undefined,
        address: data.company?.address || undefined,
        gstRegNo: data.company?.gstRegNo || undefined,
        registrationNo: data.company?.registrationNo || undefined,
      },
      additionalFields: data.additionalFields || {},
    };
  }

  private cleanItems(items: any[]): ExtractedDocumentData['items'] {
    if (!Array.isArray(items)) return [];

    return items.map(item => ({
      description: item.description || undefined,
      quantity: this.parseNumber(item.quantity),
      unitPrice: this.parseNumber(item.unitPrice),
      tax: this.parseNumber(item.tax),
      amount: this.parseNumber(item.amount),
      serialNumbers: Array.isArray(item.serialNumbers) ? item.serialNumbers : [],
      unit: item.unit || undefined,
    }));
  }

  private parseDate(dateStr: any): string | undefined {
    if (!dateStr || typeof dateStr !== 'string') return undefined;

    // Try to parse the date and ensure it's in YYYY-MM-DD format
    try {
      const date = new Date(dateStr);
      if (!isNaN(date.getTime())) {
        return date.toISOString().split('T')[0];
      }
    } catch {
      // If parsing fails, return undefined
    }

    return undefined;
  }

  private parseNumber(value: any): number | undefined {
    if (value === null || value === undefined || value === '') return undefined;

    const num = typeof value === 'string'
      ? parseFloat(value.replace(/[^0-9.-]/g, ''))
      : parseFloat(value);

    return isNaN(num) ? undefined : num;
  }

  async processDocumentFile(
    file: Express.Multer.File,
    documentType: DocumentType = DocumentType.INVOICE
  ): Promise<ExtractedDocumentData> {
    // Check if file is a PDF
    if (file.mimetype === 'application/pdf') {
      return this.processPdfDocument(file, documentType);
    }

    // For image files, convert to base64 and extract
    const base64Image = file.buffer.toString('base64');
    return this.extractDocumentData(base64Image, documentType);
  }

  private async processPdfDocument(
    file: Express.Multer.File,
    documentType: DocumentType
  ): Promise<ExtractedDocumentData> {
    if (!this.openai) {
      throw new HttpException(
        'OpenAI API key not configured. Please add your API key to the .env file.',
        HttpStatus.SERVICE_UNAVAILABLE
      );
    }

    try {
      console.log('📄 Processing PDF document');

      // Extract text from PDF
      const pdfData = await pdfParse(file.buffer);
      const pdfText = pdfData.text;

      console.log(`📄 Extracted ${pdfText.length} characters from PDF`);

      // Check if PDF has meaningful text content
      // If text is too short or empty, it's likely an image-based PDF
      if (!pdfText || pdfText.trim().length < 50) {
        console.log('📄 PDF appears to be image-based or has minimal text. Using image extraction...');

        // For image-based PDFs, we need to convert PDF pages to images
        const { pdfToPng } = require('pdf-to-png-converter');

        // Try to get the first page as an image
        try {
          // Convert PDF to PNG images
          console.log('🔄 Converting PDF pages to images...');
          const pngPages = await pdfToPng(file.buffer, {
            disableFontFace: true,
            useSystemFonts: false,
            viewportScale: 2.0, // Higher resolution for better OCR
            pagesToProcess: [1], // Process only first page for invoices
            strictPagesToProcess: false
          });

          if (!pngPages || pngPages.length === 0) {
            throw new Error('Failed to convert PDF to images');
          }

          // Get the first page as base64
          const firstPage = pngPages[0];
          const base64Image = firstPage.content.toString('base64');

          console.log('📸 Successfully converted PDF to image, sending to Vision API...');

          // Use vision API with the converted PNG image
          const response = await this.openai.chat.completions.create({
            model: "gpt-4o-mini",
            messages: [
              {
                role: "system",
                content: this.getSystemPrompt(documentType)
              },
              {
                role: "user",
                content: [
                  {
                    type: "text",
                    text: this.getUserPrompt(documentType)
                  },
                  {
                    type: "image_url",
                    image_url: {
                      url: `data:image/png;base64,${base64Image}`,
                      detail: "high"
                    }
                  }
                ]
              }
            ],
            max_tokens: 2000,
            temperature: 0.1,
            response_format: { type: "json_object" }
          });

          const extractedData = JSON.parse(response.choices[0].message.content);
          console.log('✅ PDF data extracted successfully using vision API');

          return this.validateAndCleanData({
            ...extractedData,
            documentType
          });
        } catch (visionError) {
          console.error('❌ Vision API failed for PDF:', visionError);
          // If vision API doesn't work, return a more helpful error
          throw new HttpException(
            'Failed to process the PDF document. Error: ' + visionError.message,
            HttpStatus.BAD_REQUEST
          );
        }
      }

      // For text-based PDFs, proceed with text extraction
      // Limit text length to avoid token limits
      const maxTextLength = 10000;
      const truncatedText = pdfText.length > maxTextLength
        ? pdfText.substring(0, maxTextLength) + '...'
        : pdfText;

      // Use OpenAI to extract structured data from the text
      const response = await this.openai.chat.completions.create({
        model: 'gpt-4o-mini',
        messages: [
          {
            role: 'system',
            content: this.getSystemPrompt(documentType),
          },
          {
            role: 'user',
            content: `${this.getUserPrompt(documentType)}

            Document text:
            ${truncatedText}`,
          },
        ],
        response_format: { type: 'json_object' },
        temperature: 0.1,
        max_tokens: 2000,
      });

      const extractedData = JSON.parse(response.choices[0].message.content);
      console.log('✅ PDF text data extracted successfully');

      // Clean the extracted data
      const cleaned = this.validateAndCleanData({
        ...extractedData,
        documentType
      });

      return cleaned;
    } catch (error) {
      console.error('❌ Error processing PDF:', error);

      // If it's our custom error, re-throw it
      if (error instanceof HttpException) {
        throw error;
      }

      throw new HttpException(
        `Failed to extract data from PDF: ${error.message}`,
        HttpStatus.INTERNAL_SERVER_ERROR
      );
    }
  }

  // ────────────────────────────────────────────────────────────────────────
  // Supplier reconciliation extraction (for PO verification on the orders page).
  // Mirrors processDocumentFile's PDF/image preprocessing but accepts arbitrary
  // prompts, so we can request a different shape (with item codes + points).
  // ────────────────────────────────────────────────────────────────────────

  async extractForReconciliation(
    file: Express.Multer.File,
  ): Promise<SupplierReconciliationData> {
    const systemPrompt = `You are an expert at extracting structured data from supplier delivery orders and tax invoices for purchase-order reconciliation. Return STRICT JSON in the exact shape requested. Be precise with numbers and never put a SKU/model code inside "description".`;

    const userPrompt = `Extract the data needed to reconcile this supplier delivery order or tax invoice against a buyer's purchase order. Return ONLY JSON in exactly this shape:
{
  "docKind": "DELIVERY_ORDER" | "INVOICE" | "UNKNOWN",
  "docNumber": "DO No. or Invoice No., string",
  "docDate": "YYYY-MM-DD",
  "customerPoNumber": "the BUYER's PO number printed on the doc (labeled 'PO No.', 'Customer PO No.', or similar) — NOT the supplier's sales order",
  "salesOrderNumber": "supplier's sales order number if shown",
  "projectName": "Name of Project / Project Name if shown",
  "items": [
    {
      "code": "exact material/model code as printed (e.g. MKM85ZVMG, CTKM25ZVMG). For Daikin docs the first column is 'Material'. Always extract the code separately; never leave it inside 'description'.",
      "description": "human-readable description with the code removed",
      "quantity": number,
      "unit": "EA, PCS, UNIT, etc.",
      "unitPrice": number,
      "amount": number
    }
  ],
  "totals": {
    "subtotal": number,
    "tax": number,
    "taxPercent": number,
    "total": number
  },
  "points": {
    "issued": number,
    "redeemed": number
  },
  "supplier": {
    "name": "issuing company name",
    "gstRegNo": "supplier GST reg number"
  }
}

Rules:
- "docKind" = DELIVERY_ORDER if titled "Delivery Order"/"DO"; INVOICE if titled "Tax Invoice"/"Invoice"; otherwise UNKNOWN.
- For Delivery Orders without prices, omit unitPrice/amount per item and omit "totals".
- "points.issued" = "Points Issued" / "Reward Points awarded" (the number earned). "points.redeemed" = a "Reward Points" line subtracted from the total (if shown).
- Use null for unknown scalars and [] for missing items. Numbers must be plain numbers (no commas, no currency).`;

    const raw = await this._extractStructuredJson(file, systemPrompt, userPrompt);
    return this._cleanReconciliationData(raw);
  }

  // Claude-based extraction (claude-sonnet-4-6). Mirrors the bills.service
  // pattern: pass PDFs straight through as a "document" content block (no
  // pdf-to-png needed), images as an "image" block, and parse a JSON object
  // out of the response. Returns a raw object that the caller validates.
  private async _extractStructuredJson(
    file: Express.Multer.File,
    systemPrompt: string,
    userPrompt: string,
  ): Promise<any> {
    const apiKey = process.env.ANTHROPIC_API_KEY;
    if (!apiKey) {
      throw new HttpException(
        'Document reconciliation not configured (missing ANTHROPIC_API_KEY)',
        HttpStatus.SERVICE_UNAVAILABLE,
      );
    }

    const data = file.buffer.toString('base64');
    const isPdf = file.mimetype === 'application/pdf';
    const mediaType = isPdf
      ? 'application/pdf'
      : ((file.mimetype as any) || 'image/jpeg');

    const content: any[] = [];
    if (isPdf) {
      content.push({ type: 'document', source: { type: 'base64', media_type: 'application/pdf', data } });
    } else {
      content.push({ type: 'image', source: { type: 'base64', media_type: mediaType, data } });
    }
    content.push({ type: 'text', text: userPrompt });

    const client = new Anthropic({ apiKey });
    const response = await client.messages.create({
      model: 'claude-sonnet-4-6',
      max_tokens: 3000,
      system: systemPrompt,
      messages: [{ role: 'user', content }],
    });

    const block = response.content.find((b) => b.type === 'text');
    const raw = block && 'text' in block ? (block as any).text.trim() : '';
    // Claude usually returns just the JSON object, but tolerate a stray
    // preamble by scooping the first {...} chunk.
    const match = raw.match(/\{[\s\S]*\}/);
    if (!match) {
      throw new HttpException('No JSON returned by extractor', HttpStatus.INTERNAL_SERVER_ERROR);
    }
    try {
      return JSON.parse(match[0]);
    } catch (e) {
      throw new HttpException(
        `Extractor returned malformed JSON: ${(e as Error).message}`,
        HttpStatus.INTERNAL_SERVER_ERROR,
      );
    }
  }

  private _cleanReconciliationData(data: any): SupplierReconciliationData {
    const num = (v: any): number | undefined => {
      if (v === null || v === undefined || v === '') return undefined;
      const x = typeof v === 'string' ? parseFloat(v.replace(/[^0-9.\-]/g, '')) : Number(v);
      return Number.isFinite(x) ? x : undefined;
    };
    const str = (v: any): string | undefined =>
      typeof v === 'string' && v.trim() ? v.trim() : undefined;
    const kind = ['DELIVERY_ORDER', 'INVOICE', 'UNKNOWN'].includes(data?.docKind)
      ? (data.docKind as 'DELIVERY_ORDER' | 'INVOICE' | 'UNKNOWN')
      : 'UNKNOWN';
    return {
      docKind: kind,
      docNumber: str(data?.docNumber),
      docDate: this.parseDate(data?.docDate),
      customerPoNumber: str(data?.customerPoNumber),
      salesOrderNumber: str(data?.salesOrderNumber),
      projectName: str(data?.projectName),
      items: (Array.isArray(data?.items) ? data.items : []).map((it: any) => ({
        code: str(it?.code),
        description: str(it?.description),
        quantity: num(it?.quantity),
        unit: str(it?.unit),
        unitPrice: num(it?.unitPrice),
        amount: num(it?.amount),
      })),
      totals: data?.totals
        ? {
            subtotal: num(data.totals.subtotal),
            tax: num(data.totals.tax),
            taxPercent: num(data.totals.taxPercent),
            total: num(data.totals.total),
          }
        : undefined,
      points: data?.points
        ? {
            issued: num(data.points.issued),
            redeemed: num(data.points.redeemed),
          }
        : undefined,
      supplier: data?.supplier
        ? {
            name: str(data.supplier.name),
            gstRegNo: str(data.supplier.gstRegNo),
          }
        : undefined,
    };
  }
}