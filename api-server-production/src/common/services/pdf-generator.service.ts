import { Injectable } from '@nestjs/common';
import * as puppeteer from 'puppeteer';

@Injectable()
export class PdfGeneratorService {
  async generatePdfFromHtml(html: string): Promise<Buffer> {
    let browser = null;

    try {
      // Launch puppeteer browser
      browser = await puppeteer.launch({
        headless: true,
        args: [
          '--no-sandbox',
          '--disable-setuid-sandbox',
          '--disable-dev-shm-usage',
          '--disable-gpu',
        ],
      });

      const page = await browser.newPage();

      // Set viewport and page content
      await page.setViewport({ width: 1200, height: 1600 });
      await page.setContent(html, { waitUntil: 'networkidle0' });

      // Add styles for print media
      await page.addStyleTag({
        content: `
          @page {
            size: A4;
            margin: 0;
          }
          body {
            margin: 0;
            padding: 0;
          }
          @media print {
            body {
              -webkit-print-color-adjust: exact;
              print-color-adjust: exact;
            }
          }
        `,
      });

      // Generate PDF with A4 format
      const pdfBuffer = await page.pdf({
        format: 'A4',
        printBackground: true,
        margin: {
          top: '0',
          right: '0',
          bottom: '0',
          left: '0',
        },
      });

      return Buffer.from(pdfBuffer);
    } catch (error) {
      console.error('Error generating PDF:', error);
      throw new Error(`Failed to generate PDF: ${error.message}`);
    } finally {
      if (browser) {
        await browser.close();
      }
    }
  }

  /**
   * Display-only grouping for DOs created from a standalone delivery — the
   * SERVER-SIDE MIRROR of CleanDocumentPreview.groupDeliveryLines (keep the two
   * in sync). The backend keeps ONE config line PER UNIT (per-unit DocumentItems
   * are load-bearing for stock deduction), so N units of the same asset arrive
   * as N consecutive lines carrying a `deliveryGroup` (= assetId) marker, a
   * `skuKey` (model), a `year`, a `deploymentType`, and their own
   * `serialNumbers`. Here we collapse each consecutive same-`deliveryGroup` run
   * into ONE display row:
   *
   *   Rental|Sale of N units of {name}
   *   Model: {skuKey}
   *   Year: {year}      (only when every unit in the group agrees; else omitted)
   *   S/No.: {serial}   (one per unit that has a serial)
   *
   * TIGHTLY SCOPED: only lines with a truthy `deliveryGroup` are touched — every
   * other document (and every hand-made DO) passes through byte-identical.
   * Merged qty/amount are summed so totals are preserved.
   */
  private groupDeliveryLines(raw: any[]): any[] {
    if (!Array.isArray(raw) || raw.length === 0) return raw;
    const out: any[] = [];
    let i = 0;
    while (i < raw.length) {
      const line = raw[i];
      const key = line?.deliveryGroup;
      if (!key) {
        out.push(line);
        i++;
        continue;
      }
      const run = [line];
      let j = i + 1;
      while (j < raw.length && raw[j]?.deliveryGroup === key) {
        run.push(raw[j]);
        j++;
      }
      const serials = run
        .flatMap((r) => (Array.isArray(r.serialNumbers) ? r.serialNumbers : []))
        .filter(Boolean);
      const qty = run.reduce((s, r) => s + (Number(r.quantity) || 0), 0);
      const amount = run.reduce((s, r) => s + (Number(r.amount) || 0), 0);
      const name = run[0].description || '';
      const model = run[0].skuKey || '';
      const verb = run.some((r) => r.deploymentType === 'SALE') ? 'Sale' : 'Rental';
      const years = run.map((r) => r.year).filter((y) => y != null);
      const year = years.length === run.length && new Set(years).size === 1 ? years[0] : null;
      const lines = [`${verb} of ${qty} unit${qty === 1 ? '' : 's'} of ${name}`];
      if (model) lines.push(`Model: ${model}`);
      if (year != null) lines.push(`Year: ${year}`);
      for (const s of serials) lines.push(`S/No.: ${s}`);
      out.push({ ...run[0], quantity: qty, amount, serialNumbers: serials, description: lines.join('\n') });
      i = j;
    }
    return out;
  }

  generateInvoiceHtml(data: any): string {
    // Format date helper
    const formatDate = (date: any) => {
      if (!date) return '';
      const d = new Date(date);
      return d.toLocaleDateString('en-GB', {
        day: 'numeric',
        month: 'short',
        year: 'numeric',
      });
    };

    // Calculate totals. Group delivery-created DO lines into the office's
    // "Rental/Sale of N units / Model / Year / S/No." block (server mirror of
    // the preview) so the PDF/print matches the on-screen preview. Non-delivery
    // docs pass through unchanged.
    const items = this.groupDeliveryLines(data.items || []);
    const subtotal = items.reduce((acc: number, item: any) => acc + (item.amount || 0), 0);
    const totalTax = items.reduce(
      (acc: number, item: any) => acc + (item.amount || 0) * ((item.tax || 9) / 100),
      0
    );
    const total = subtotal + totalTax;

    return `
<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <style>
    * {
      margin: 0;
      padding: 0;
      box-sizing: border-box;
    }

    body {
      font-family: Arial, sans-serif;
      font-size: 12px;
      line-height: 1.6;
      color: #000;
      background: white;
    }

    .page {
      width: 210mm;
      min-height: 297mm;
      padding: 20mm;
      background: white;
    }

    .header {
      display: flex;
      justify-content: space-between;
      margin-bottom: 30px;
    }

    .company-logo {
      max-width: 150px;
      height: 60px;
      margin-bottom: 15px;
    }

    .company-logo img {
      max-width: 100%;
      max-height: 100%;
    }

    .title {
      font-size: 24px;
      font-weight: 500;
      margin: 20px 0 20px 0;
    }

    .customer-info {
      margin-bottom: 15px;
    }

    .customer-name {
      font-size: 13px;
      font-weight: 600;
      margin-bottom: 5px;
    }

    .customer-address {
      font-size: 12px;
      margin-bottom: 3px;
    }

    .invoice-details {
      text-align: left;
      min-width: 280px;
    }

    .detail-row {
      margin-bottom: 5px;
    }

    .detail-label {
      font-size: 11px;
      color: #666;
      margin-bottom: 2px;
    }

    .detail-value {
      font-size: 12px;
      font-weight: 500;
    }

    .company-details {
      margin-top: 15px;
      padding-top: 15px;
      border-top: 1px solid #eee;
    }

    .company-name {
      font-size: 13px;
      font-weight: 600;
      margin-bottom: 5px;
    }

    .company-detail {
      font-size: 11px;
      margin-bottom: 2px;
    }

    table {
      width: 100%;
      margin: 40px 0 30px 0;
      border-collapse: collapse;
    }

    th {
      border-top: 1px solid #000;
      border-bottom: 2px solid #000;
      padding: 10px 8px;
      font-size: 11px;
      font-weight: 600;
      text-align: left;
    }

    td {
      border-bottom: 1px solid #ddd;
      padding: 10px 8px;
      font-size: 11px;
    }

    .text-center {
      text-align: center;
    }

    .text-right {
      text-align: right;
    }

    .item-description {
      font-size: 11px;
      font-weight: 500;
      margin-bottom: 5px;
    }

    .item-details {
      font-size: 10px;
      color: #666;
      line-height: 1.4;
      padding-left: 10px;
    }

    .totals-section {
      display: flex;
      justify-content: flex-end;
      margin-top: 30px;
    }

    .totals-box {
      width: 350px;
    }

    .total-row {
      display: flex;
      justify-content: space-between;
      padding: 10px 0;
      border-top: 1px solid #000;
    }

    .total-row.subtotal {
      border-top: 1px solid #000;
    }

    .total-row.tax {
      border-bottom: 1px solid #000;
    }

    .total-row.final {
      border-bottom: 2px solid #000;
      font-weight: 600;
    }

    .total-label {
      font-size: 12px;
      text-align: right;
      width: 60%;
    }

    .total-value {
      font-size: 12px;
      text-align: right;
      width: 40%;
    }

    .payment-section {
      margin-top: 50px;
      font-size: 11px;
      line-height: 1.8;
    }

    .payment-title {
      font-weight: 600;
      margin-bottom: 10px;
    }

    .payment-detail {
      margin-bottom: 3px;
    }

    .footer {
      margin-top: 40px;
      text-align: center;
      font-size: 10px;
      font-style: italic;
      color: #666;
    }

    .additional-info {
      margin-bottom: 20px;
      font-size: 11px;
      line-height: 1.8;
    }

    .additional-info p {
      margin-bottom: 5px;
    }
  </style>
</head>
<body>
  <div class="page">
    <div class="header">
      <div>
        ${data.logo ? `<div class="company-logo"><img src="${data.logo}" alt="Logo"></div>` : ''}
        <div class="title">${data.isQuotation ? 'Quotation' : 'Tax Invoice'}</div>
        <div class="customer-info">
          <div class="customer-name">${data.customer?.name || ''}</div>
          <div class="customer-address">
            ${data.customer?.address ? data.customer.address.split('\n').join('<br>') : ''}
          </div>
          ${data.customer?.attention ? `<div class="customer-address">Attn: ${data.customer.attention}</div>` : ''}
        </div>
      </div>

      <div class="invoice-details">
        <div class="detail-row">
          <div class="detail-label">${data.isQuotation ? 'Date' : 'Invoice Date'}</div>
          <div class="detail-value">${formatDate(data.documentInfo?.date)}</div>
        </div>
        <div class="detail-row">
          <div class="detail-label">${data.isQuotation ? 'Quotation Number' : 'Invoice Number'}</div>
          <div class="detail-value">${data.documentInfo?.documentNumber || ''}</div>
        </div>
        ${data.documentInfo?.referenceNo ? `
        <div class="detail-row">
          <div class="detail-label">Reference</div>
          <div class="detail-value">${data.documentInfo.referenceNo}</div>
        </div>
        ` : ''}

        <div class="company-details">
          <div class="company-name">${data.company?.name || ''}</div>
          <div class="company-detail">${data.company?.address || ''}</div>
          <div class="company-detail">Tel: ${data.company?.phoneNumber || ''}</div>
          <div class="company-detail">Company & GST Reg No:</div>
          <div class="company-detail">${data.company?.gstRegNo || ''}</div>
        </div>
      </div>
    </div>

    <table>
      <thead>
        <tr>
          <th style="width: 50%">Description</th>
          <th style="width: 12%" class="text-center">Quantity</th>
          <th style="width: 15%" class="text-right">Unit Price</th>
          <th style="width: 8%" class="text-center">Tax</th>
          <th style="width: 15%" class="text-right">Amount SGD</th>
        </tr>
      </thead>
      <tbody>
        ${items.map((item: any) => `
          <tr>
            <td>
              <div class="item-description">${(item.description || '').split('\n').join('<br>')}</div>
              ${item.details ? `
                <div class="item-details">
                  ${typeof item.details === 'string' ? item.details.split('\n').join('<br>') : item.details}
                </div>
              ` : ''}
            </td>
            <td class="text-center">${(item.quantity || 0).toFixed(2)}</td>
            <td class="text-right">${(item.unitPrice || 0).toFixed(2)}</td>
            <td class="text-center">${item.tax || 9}%</td>
            <td class="text-right">${(item.amount || 0).toFixed(2)}</td>
          </tr>
        `).join('')}
        ${items.length < 5 ? Array(5 - items.length).fill('').map(() => `
          <tr style="height: 40px">
            <td>&nbsp;</td>
            <td>&nbsp;</td>
            <td>&nbsp;</td>
            <td>&nbsp;</td>
            <td>&nbsp;</td>
          </tr>
        `).join('') : ''}
      </tbody>
    </table>

    ${(data.documentInfo?.doNo || data.documentInfo?.qinRef || data.documentInfo?.woNo ||
       data.documentInfo?.location || data.documentInfo?.projectDept) ? `
      <div class="additional-info">
        ${data.documentInfo?.doNo ? `<p>Our DO No. ${data.documentInfo.doNo} dated ${formatDate(data.documentInfo.doDate)}</p>` : ''}
        ${data.documentInfo?.qinRef ? `<p>Our Qtn Ref. ${data.documentInfo.qinRef} dated ${formatDate(data.documentInfo.qinDate)}</p>` : ''}
        ${data.documentInfo?.woNo ? `<p>Your WO No. ${data.documentInfo.woNo} dated ${formatDate(data.documentInfo.woDate)}</p>` : ''}
        ${data.documentInfo?.location ? `<p>Location: ${data.documentInfo.location}</p>` : ''}
        ${data.documentInfo?.projectDept ? `<p>Project/Dept : ${data.documentInfo.projectDept}</p>` : ''}
      </div>
    ` : ''}

    <div class="totals-section">
      <div class="totals-box">
        <div class="total-row subtotal">
          <div class="total-label">Subtotal</div>
          <div class="total-value">${subtotal.toFixed(2)}</div>
        </div>
        <div class="total-row tax">
          <div class="total-label">TOTAL LOCAL SUPPLY OF GOODS<br>AND SERVICES 9%</div>
          <div class="total-value">${totalTax.toFixed(2)}</div>
        </div>
        <div class="total-row final">
          <div class="total-label">TOTAL SGD</div>
          <div class="total-value">${total.toFixed(2)}</div>
        </div>
      </div>
    </div>

    <div class="payment-section">
      ${data.isQuotation ? '' : `<div class="payment-title">Due Date: ${formatDate(data.dueDate)}</div>`}
      <div class="payment-detail">All Cheque should be crossed and made payable to: ${data.company?.name || ''}</div>
      <div class="payment-detail">By Bank Transfer: ${data.bankDetails?.bankName || 'Standard Chartered Bank'}</div>
      <div class="payment-detail">Branch: ${data.bankDetails?.branch || '12 Marina Boulevard, Marina Bay Financial Centre Tower 1'}</div>
      <div class="payment-detail">Bank Branch No.: ${data.bankDetails?.branchNo || '9496-007'} Swift Code: ${data.bankDetails?.swiftCode || 'SCBLSG22'}</div>
      <div class="payment-detail">Bank Account No.: ${data.bankDetails?.accountNo || '07-1-005302-9'}</div>
      <div class="payment-detail">PayNow to UEN: ${data.company?.gstRegNo || '200303416N'}</div>
    </div>

    <div class="footer">
      This is a computer-generated document, no signature is required
    </div>
  </div>
</body>
</html>
    `;
  }
}