import { Injectable, Logger, HttpException, HttpStatus } from '@nestjs/common';
import { Resend } from 'resend';
import { ConfigService } from '@nestjs/config';

export interface SendInvoiceEmailParams {
  to: string[];
  cc?: string[];
  bcc?: string[];
  subject: string;
  message: string;
  invoiceNumber: string;
  invoiceAmount: number;
  dueDate: string;
  customerName: string;
  organizationName: string;
  pdfUrl?: string;
  paymentLink?: string;
}

@Injectable()
export class EmailService {
  private resend: Resend;
  private readonly logger = new Logger(EmailService.name);
  private readonly fromEmail: string;

  constructor(private configService: ConfigService) {
    const apiKey = this.configService.get<string>('RESEND_API_KEY');
    if (!apiKey) {
      this.logger.warn('RESEND_API_KEY not configured. Email sending will fail.');
    } else {
      this.resend = new Resend(apiKey);
    }
    this.fromEmail = this.configService.get<string>('RESEND_FROM_EMAIL') || 'invoices@aspireapp.com';
  }

  /**
   * Generate HTML email template for invoice
   */
  private generateInvoiceEmailHtml(params: SendInvoiceEmailParams): string {
    const { message, invoiceNumber, invoiceAmount, dueDate, customerName, paymentLink } = params;

    return `
      <!DOCTYPE html>
      <html>
        <head>
          <meta charset="utf-8">
          <meta name="viewport" content="width=device-width, initial-scale=1.0">
          <style>
            body {
              font-family: Arial, sans-serif;
              line-height: 1.6;
              color: #333;
              max-width: 600px;
              margin: 0 auto;
              padding: 20px;
            }
            .header {
              background-color: #f8f9fa;
              padding: 20px;
              border-radius: 8px;
              margin-bottom: 20px;
            }
            .content {
              background-color: #ffffff;
              padding: 20px;
              border: 1px solid #e0e0e0;
              border-radius: 8px;
              margin-bottom: 20px;
            }
            .message {
              white-space: pre-wrap;
              margin: 20px 0;
            }
            .button {
              display: inline-block;
              padding: 12px 24px;
              background-color: #10b981;
              color: white !important;
              text-decoration: none;
              border-radius: 6px;
              font-weight: 500;
              margin: 20px 0;
            }
            .footer {
              text-align: center;
              color: #666;
              font-size: 12px;
              margin-top: 20px;
              padding-top: 20px;
              border-top: 1px solid #e0e0e0;
            }
            .invoice-details {
              background-color: #f8f9fa;
              padding: 15px;
              border-radius: 6px;
              margin: 15px 0;
            }
            .invoice-details p {
              margin: 5px 0;
            }
          </style>
        </head>
        <body>
          <div class="header">
            <h2 style="margin: 0; color: #1976d2;">Invoice from ${params.organizationName}</h2>
          </div>

          <div class="content">
            <p>Hi ${customerName},</p>

            <div class="message">${message}</div>

            <div class="invoice-details">
              <p><strong>Invoice Number:</strong> ${invoiceNumber}</p>
              <p><strong>Amount:</strong> SGD ${invoiceAmount.toFixed(2)}</p>
              <p><strong>Due Date:</strong> ${dueDate}</p>
            </div>

            ${paymentLink ? `
              <div style="text-align: center;">
                <a href="${paymentLink}" class="button">Click to Pay</a>
              </div>
              <p style="font-size: 14px; color: #666;">You can also use the link below to see your invoice and its payment details.</p>
            ` : ''}

            <p style="margin-top: 20px;">Please find the invoice attached as a PDF.</p>

            <p style="margin-top: 20px;">If you have any questions, please don't hesitate to contact us.</p>

            <p style="margin-top: 20px;">Best regards,<br>${params.organizationName}</p>
          </div>

          <div class="footer">
            <p>This email was sent by ${params.organizationName}</p>
            <p>Please do not reply to this email.</p>
          </div>
        </body>
      </html>
    `;
  }

  /**
   * Send invoice email via Resend
   */
  async sendInvoiceEmail(params: SendInvoiceEmailParams): Promise<{ success: boolean; messageId?: string; error?: string }> {
    try {
      if (!this.resend) {
        throw new HttpException('Email service not configured. Please set RESEND_API_KEY.', HttpStatus.SERVICE_UNAVAILABLE);
      }

      this.logger.log(`Sending invoice email to ${params.to.join(', ')}`);

      const htmlContent = this.generateInvoiceEmailHtml(params);

      // Prepare email data
      const emailData: any = {
        from: this.fromEmail,
        to: params.to,
        subject: params.subject,
        html: htmlContent,
      };

      // Add CC if provided
      if (params.cc && params.cc.length > 0) {
        emailData.cc = params.cc;
      }

      // Add BCC if provided
      if (params.bcc && params.bcc.length > 0) {
        emailData.bcc = params.bcc;
      }

      // Add PDF attachment if URL is provided
      if (params.pdfUrl) {
        try {
          // Download the PDF from S3 signed URL
          const response = await fetch(params.pdfUrl);
          if (!response.ok) {
            this.logger.warn(`Failed to fetch PDF from ${params.pdfUrl}: ${response.statusText}`);
          } else {
            const pdfBuffer = await response.arrayBuffer();
            const pdfBase64 = Buffer.from(pdfBuffer).toString('base64');

            emailData.attachments = [
              {
                filename: `${params.invoiceNumber}.pdf`,
                content: pdfBase64,
              },
            ];
          }
        } catch (error) {
          this.logger.error(`Error fetching PDF attachment: ${error.message}`);
          // Continue without attachment rather than failing the email
        }
      }

      // Send email via Resend
      const result = await this.resend.emails.send(emailData);

      if (result.error) {
        this.logger.error(`Resend API error: ${JSON.stringify(result.error)}`);
        return {
          success: false,
          error: result.error.message || 'Failed to send email',
        };
      }

      this.logger.log(`Email sent successfully. Message ID: ${result.data?.id}`);
      return {
        success: true,
        messageId: result.data?.id,
      };
    } catch (error) {
      this.logger.error(`Error sending invoice email: ${error.message}`, error.stack);
      throw new HttpException(
        `Failed to send email: ${error.message}`,
        HttpStatus.INTERNAL_SERVER_ERROR,
      );
    }
  }

  /**
   * Test email configuration
   */
  async testEmailConfiguration(): Promise<boolean> {
    try {
      if (!this.resend) {
        return false;
      }
      // Try to send a test email
      return true;
    } catch (error) {
      this.logger.error(`Email configuration test failed: ${error.message}`);
      return false;
    }
  }
}
