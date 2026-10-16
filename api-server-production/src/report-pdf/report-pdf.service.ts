/**
 * Accounting reports as PDFs — the same pipeline documents already use
 * (HTML → Puppeteer → S3 → signed URL), so anything server-side can hand a
 * report to a user: the WhatsApp agent, an email, the portal.
 *
 * Before this, the reports' only PDF was made in the BROWSER by jsPDF from the
 * rendered DOM, so a file existed only while someone had the page open. Asked
 * for a statement over WhatsApp, the agent could read the numbers out of the
 * JSON but had nothing to attach (guru 2026-10-16).
 */
import { Injectable, Logger, NotFoundException, BadRequestException } from '@nestjs/common';
import { PrismaService } from '../common/prisma.service';
import { PdfGeneratorService } from '../common/services/pdf-generator.service';
import { S3Service } from '../common/services/s3.service';
import { StatementsService } from '../statements/statements.service';
import { XeroReportsService } from '../statements/xero-reports.service';
import { JournalService } from '../journal/journal.service';
import { renderReportHtml, REPORT_KEYS, REPORT_PDF_MARGIN, isReportKey, ReportKey } from '../common/services/report-html';

export interface ReportPdfParams {
  /** Customer or supplier, for the statements. */
  contactId?: string;
  from?: string;
  to?: string;
  /** Aged reports. */
  periods?: number;
  periodDays?: number;
  ageingBy?: 'dueDate' | 'documentDate';
  level?: 'summary' | 'detail';
}

@Injectable()
export class ReportPdfService {
  private readonly logger = new Logger(ReportPdfService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly pdf: PdfGeneratorService,
    private readonly s3: S3Service,
    private readonly statements: StatementsService,
    private readonly xeroReports: XeroReportsService,
    private readonly journal: JournalService,
  ) {}

  /** The reports that can currently be produced as a PDF. */
  listReports(): Array<{ key: string; label: string }> {
    return Object.entries(REPORT_KEYS).map(([key, label]) => ({ key, label }));
  }

  /** Fetch the report's own payload from whichever service owns it. */
  private async fetchData(key: ReportKey, organizationId: string, params: ReportPdfParams): Promise<any> {
    switch (key) {
      case 'soa': {
        if (!params.contactId) throw new BadRequestException('A customer is required for a Statement of Account');
        const res: any = await this.statements.generateSOA(
          { customerId: params.contactId, startDate: params.from, endDate: params.to, includeAging: true } as any,
          organizationId,
        );
        return res?.data ?? res;
      }
      case 'supplier-soa': {
        if (!params.contactId) throw new BadRequestException('A supplier is required for a supplier statement');
        const res: any = await this.statements.generateSupplierSOA(
          { supplierId: params.contactId, startDate: params.from, endDate: params.to } as any,
          organizationId,
        );
        return res?.data ?? res;
      }
      case 'aged-receivables':
      case 'aged-payables': {
        const res: any = await this.xeroReports.aged(
          organizationId,
          key === 'aged-receivables' ? ('AR' as any) : ('AP' as any),
          { asOf: params.to, periods: params.periods, periodDays: params.periodDays, ageingBy: params.ageingBy, level: params.level },
        );
        return res?.data ?? res;
      }
      case 'trial-balance':
        return this.journal.trialBalance(organizationId, params.to ? new Date(params.to) : undefined);
    }
  }

  /**
   * Render a report to PDF and return a link to it.
   *
   * The URL is signed and expires — a statement names a customer and their
   * balances, so it must not sit on a guessable public URL.
   */
  async generate(
    organizationId: string,
    key: string,
    params: ReportPdfParams = {},
  ): Promise<{ key: string; label: string; url: string; filename: string; expiresInSeconds: number }> {
    if (!isReportKey(key)) {
      throw new BadRequestException(
        `"${key}" is not available as a PDF yet. Available: ${Object.keys(REPORT_KEYS).join(', ')}`,
      );
    }

    const org = await this.prisma.organization.findUnique({
      where: { id: organizationId },
      select: { name: true, defaultCurrency: true },
    });
    if (!org) throw new NotFoundException('Organization not found');

    const data = await this.fetchData(key, organizationId, params);
    const html = renderReportHtml(key, data, {
      organizationName: org.name,
      currency: org.defaultCurrency || 'SGD',
      from: params.from ?? null,
      to: params.to ?? null,
    });
    if (!html) throw new BadRequestException(`"${key}" has no PDF layout yet`);

    const label = REPORT_KEYS[key];
    const buffer = await this.pdf.generatePdfFromHtml(html, {
      margin: REPORT_PDF_MARGIN,
      pageNumbers: { label: `${org.name} · ${label}` },
    });

    const stamp = new Date().toISOString().slice(0, 10);
    const filename = `${label.replace(/[^A-Za-z0-9]+/g, '-')}-${stamp}.pdf`;
    const { key: s3Key } = await this.s3.uploadPdf(organizationId, 'reports', `${key}_${stamp}`, buffer);
    const url = await this.s3.getSignedUrl(s3Key, 3600);

    this.logger.log(`Report PDF ${key} for org ${organizationId} (${buffer.length} bytes)`);
    return { key, label, url, filename, expiresInSeconds: 3600 };
  }
}
