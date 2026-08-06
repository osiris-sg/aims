import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../common/prisma.service';
import { DocumentsService } from '../documents/documents.service';
import { S3Service } from '../common/services/s3.service';

@Injectable()
export class PublicPayService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly documents: DocumentsService,
    private readonly s3: S3Service,
  ) {}

  async getByToken(token: string) {
    if (!token || token.length < 16) throw new NotFoundException();
    const rows: any[] = await this.prisma.$queryRawUnsafe(
      `SELECT id, name, type, status, "organizationId", config FROM "Document" WHERE config->>'payToken' = $1 LIMIT 1`,
      token,
    );
    const doc = rows[0];
    if (!doc) throw new NotFoundException();
    const c: any = doc.config || {};

    const [org, setting] = await Promise.all([
      this.prisma.organization.findUnique({ where: { id: doc.organizationId }, select: { name: true, logo: true } }),
      this.prisma.accountingSetting.findUnique({ where: { organizationId: doc.organizationId }, select: { paymentDetails: true } }),
    ]);
    const pd: any = setting?.paymentDetails || {};
    let paynowQrUrl: string | null = null;
    if (pd.paynowQrKey) {
      try {
        paynowQrUrl = await this.s3.getSignedUrl(pd.paynowQrKey, 3600);
      } catch {
        paynowQrUrl = null;
      }
    }
    const pdfUrl = await this.documents.getOrGeneratePdfUrl(doc.id, doc.organizationId);

    const amount = Number(c.nettTotal ?? c.grossTotal ?? c.totalAmount) || 0;
    const due = c.dueDate ? new Date(c.dueDate) : null;
    const paid = String(doc.status).toLowerCase() === 'paid';
    return {
      invoiceNumber: doc.name,
      amount,
      currency: (c.currency || 'SGD').toUpperCase(),
      invoiceDate: c.date || null,
      dueDate: c.dueDate || null,
      status: paid ? 'PAID' : due && due.getTime() < Date.now() ? 'OVERDUE' : 'DUE',
      organization: { name: org?.name || '', logo: org?.logo || null },
      bank: pd.bank || null,
      paynowQrUrl,
      pdfUrl: pdfUrl || null,
    };
  }
}
