import * as XLSX from 'xlsx';
import { saveAs } from 'file-saver';

// Map document types to their template structures
const TEMPLATE_STRUCTURES: { [key: string]: any } = {
  TI: {
    headers: [
      // Three column header layout matching CleanDocumentPreview
      ['TAX INVOICE', '', '', '', '{{company_name}}'],
      ['', '', '', '', '{{company_address}}'],
      ['BILL TO:', '', 'INVOICE DETAILS:', '', 'Tel: {{company_phone}}'],
      ['{{customer_name}}', '', 'Invoice Date:', '{{invoice_date}}', 'Company & GST Reg No:'],
      ['{{customer_address}}', '', 'Invoice Number:', '{{invoice_number}}', '{{company_gst}}'],
      ['Attn: {{attention_to}}', '', 'Reference:', '{{reference_no}}', ''],
      ['', '', 'DO No:', '{{do_no}}', ''],
      [],
    ],
    items: [
      ['Description', 'Quantity', 'Unit Price', 'Tax %', 'Amount SGD'],
      ['{{description_1}}', '{{quantity_1}}', '{{unit_price_1}}', '{{tax_1}}', '{{amount_1}}'],
      ['{{description_2}}', '{{quantity_2}}', '{{unit_price_2}}', '{{tax_2}}', '{{amount_2}}'],
      ['{{description_3}}', '{{quantity_3}}', '{{unit_price_3}}', '{{tax_3}}', '{{amount_3}}'],
      ['{{description_4}}', '{{quantity_4}}', '{{unit_price_4}}', '{{tax_4}}', '{{amount_4}}'],
      ['{{description_5}}', '{{quantity_5}}', '{{unit_price_5}}', '{{tax_5}}', '{{amount_5}}'],
    ],
    footer: [
      [],
      ['', '', '', 'Subtotal:', '{{subtotal}}'],
      ['', '', '', 'TOTAL LOCAL SUPPLY OF GOODS AND SERVICES 9%:', '{{tax_total}}'],
      ['', '', '', 'TOTAL SGD:', '{{total}}'],
      [],
      ['Due Date: {{due_date}}'],
      ['All Cheque should be crossed and made payable to: {{company_name}}'],
      ['By Bank Transfer: {{bank_name}}'],
      ['Branch: {{bank_branch}}'],
      ['Bank Branch No.: {{branch_no}} Swift Code: {{swift_code}}'],
      ['Bank Account No.: {{account_no}}'],
      ['PayNow to UEN: {{company_gst}}'],
      [],
      ['This is a computer-generated document, no signature is required'],
    ],
  },
  DO: {
    headers: [
      // Three column header layout
      ['DELIVERY ORDER', '', '', '', '{{company_name}}'],
      ['', '', '', '', '{{company_address}}'],
      ['DELIVER TO:', '', 'DELIVERY DETAILS:', '', 'Tel: {{company_phone}}'],
      ['{{customer_name}}', '', 'DO Date:', '{{do_date}}', ''],
      ['{{customer_address}}', '', 'DO Number:', '{{do_number}}', ''],
      ['', '', 'PO Number:', '{{po_no}}', ''],
      ['', '', 'Reference:', '{{reference_no}}', ''],
      [],
      ['DELIVERY ADDRESS:'],
      ['{{delivery_address}}'],
      ['Attention: {{attention_to}}'],
      ['Contact: {{contact_phone}}'],
      [],
    ],
    items: [
      ['No.', 'Description', 'Quantity', 'Unit Price', 'Amount'],
      ['1', '{{description_1}}', '{{quantity_1}}', '{{unit_price_1}}', '{{amount_1}}'],
      ['2', '{{description_2}}', '{{quantity_2}}', '{{unit_price_2}}', '{{amount_2}}'],
      ['3', '{{description_3}}', '{{quantity_3}}', '{{unit_price_3}}', '{{amount_3}}'],
      ['4', '{{description_4}}', '{{quantity_4}}', '{{unit_price_4}}', '{{amount_4}}'],
      ['5', '{{description_5}}', '{{quantity_5}}', '{{unit_price_5}}', '{{amount_5}}'],
    ],
    footer: [
      [],
      ['', '', '', 'Subtotal:', '{{subtotal}}'],
      ['', '', '', 'TOTAL SGD:', '{{subtotal}}'],
      [],
      ['Delivery Instructions: {{delivery_instructions}}'],
      [],
      ['Notes: {{notes}}'],
      [],
      ['Received in good condition:'],
      [],
      ['_________________________', '', '', '_________________________'],
      ['Delivery Personnel', '', '', 'Receiver Name & Signature'],
      ['Date: _______________', '', '', 'Date: _______________'],
    ],
  },
  QO1: {
    headers: [
      // Three column header layout
      ['QUOTATION', '', '', '', '{{company_name}}'],
      ['', '', '', '', '{{company_address}}'],
      ['TO:', '', 'QUOTATION DETAILS:', '', 'Tel: {{company_phone}}'],
      ['{{customer_name}}', '', 'Quotation Date:', '{{quotation_date}}', ''],
      ['{{customer_address}}', '', 'Quotation Number:', '{{quotation_number}}', ''],
      ['', '', 'Reference:', '{{reference_no}}', ''],
      ['', '', 'Valid Until:', '{{validity_date}}', ''],
      ['', '', 'Currency:', '{{currency}}', ''],
      [],
    ],
    items: [
      ['No.', 'Description', 'Quantity', 'Unit Price', 'Amount'],
      ['1', '{{description_1}}', '{{quantity_1}}', '{{unit_price_1}}', '{{amount_1}}'],
      ['2', '{{description_2}}', '{{quantity_2}}', '{{unit_price_2}}', '{{amount_2}}'],
      ['3', '{{description_3}}', '{{quantity_3}}', '{{unit_price_3}}', '{{amount_3}}'],
      ['4', '{{description_4}}', '{{quantity_4}}', '{{unit_price_4}}', '{{amount_4}}'],
      ['5', '{{description_5}}', '{{quantity_5}}', '{{unit_price_5}}', '{{amount_5}}'],
    ],
    footer: [
      [],
      ['', '', '', 'Subtotal:', '{{subtotal}}'],
      ['', '', '', 'Tax:', '{{tax_total}}'],
      ['', '', '', 'Total {{currency}}:', '{{total}}'],
      [],
      ['Notes: {{notes}}'],
      [],
      ['Terms & Conditions: {{terms_conditions}}'],
      [],
      ['Remarks: {{remarks}}'],
      [],
      ['{{agreement_text}}'],
      [],
      ['We look forward to your favorable response.'],
      [],
      ['_________________________'],
      ['Authorized Signature'],
    ],
  },
  MSR: {
    headers: [
      // Three column header layout
      ['MAINTENANCE SERVICE REPORT', '', '', '', '{{company_name}}'],
      ['', '', '', '', '{{company_address}}'],
      ['CUSTOMER:', '', 'SERVICE DETAILS:', '', 'Tel: {{company_phone}}'],
      ['{{customer_name}}', '', 'Report Date:', '{{report_date}}', ''],
      ['{{customer_address}}', '', 'Report Number:', '{{report_number}}', ''],
      ['', '', 'Service Date:', '{{service_date}}', ''],
      ['', '', 'Equipment ID:', '{{equipment_id}}', ''],
      ['', '', 'Location:', '{{location}}', ''],
      ['', '', 'Report Type:', '{{report_type}}', ''],
      [],
      ['Description:'],
      ['{{description}}'],
      [],
    ],
    items: [
      ['No.', 'Service/Part Description', 'Quantity', 'Unit Price', 'Amount'],
      ['1', '{{description_1}}', '{{quantity_1}}', '{{unit_price_1}}', '{{amount_1}}'],
      ['2', '{{description_2}}', '{{quantity_2}}', '{{unit_price_2}}', '{{amount_2}}'],
      ['3', '{{description_3}}', '{{quantity_3}}', '{{unit_price_3}}', '{{amount_3}}'],
      ['4', '{{description_4}}', '{{quantity_4}}', '{{unit_price_4}}', '{{amount_4}}'],
      ['5', '{{description_5}}', '{{quantity_5}}', '{{unit_price_5}}', '{{amount_5}}'],
    ],
    footer: [
      [],
      ['', '', '', 'Subtotal:', '{{subtotal}}'],
      ['', '', '', 'Tax:', '{{tax_total}}'],
      ['', '', '', 'Total:', '{{total}}'],
      [],
      ['Service Notes: {{notes}}'],
      [],
      ['Next Scheduled Maintenance: {{next_maintenance}}'],
      [],
      ['_________________________', '', '', '_________________________'],
      ['Service Technician', '', '', 'Customer Representative'],
      ['Date: _______________', '', '', 'Date: _______________'],
    ],
  },
  RDO: {
    headers: [
      // Three column header layout
      ['RETURN DELIVERY ORDER', '', '', '', '{{company_name}}'],
      ['', '', '', '', '{{company_address}}'],
      ['RETURN FROM:', '', 'RETURN DETAILS:', '', 'Tel: {{company_phone}}'],
      ['{{customer_name}}', '', 'RDO Date:', '{{rdo_date}}', ''],
      ['{{customer_address}}', '', 'RDO Number:', '{{rdo_number}}', ''],
      ['', '', 'PO Number:', '{{po_no}}', ''],
      ['', '', 'Original DO No:', '{{original_do_no}}', ''],
      [],
      ['Collection Location:'],
      ['{{collect_from}}'],
      ['Return Address:'],
      ['{{return_address}}'],
      [],
    ],
    items: [
      ['No.', 'Description', 'Quantity', 'Unit Price', 'Amount'],
      ['1', '{{description_1}}', '{{quantity_1}}', '{{unit_price_1}}', '{{amount_1}}'],
      ['2', '{{description_2}}', '{{quantity_2}}', '{{unit_price_2}}', '{{amount_2}}'],
      ['3', '{{description_3}}', '{{quantity_3}}', '{{unit_price_3}}', '{{amount_3}}'],
      ['4', '{{description_4}}', '{{quantity_4}}', '{{unit_price_4}}', '{{amount_4}}'],
      ['5', '{{description_5}}', '{{quantity_5}}', '{{unit_price_5}}', '{{amount_5}}'],
    ],
    footer: [
      [],
      ['', '', '', 'Subtotal:', '{{subtotal}}'],
      ['', '', '', 'Total:', '{{subtotal}}'],
      [],
      ['Return Reason: {{return_reason}}'],
      [],
      ['Return Instructions: {{return_instructions}}'],
      [],
      ['Notes: {{notes}}'],
      [],
      ['_________________________', '', '', '_________________________'],
      ['Collection Personnel', '', '', 'Authorized By'],
      ['Date: _______________', '', '', 'Date: _______________'],
    ],
  },
};

export const exportTemplateToExcel = (documentType: string, templateData?: any) => {
  // Create a new workbook
  const wb = XLSX.utils.book_new();

  // Create worksheet data
  let wsData: any[][] = [];

  // Check if template has layoutConfig with Excel layout
  if (templateData?.layoutConfig?.excelLayout) {
    // Use the actual Excel layout from the template
    wsData = templateData.layoutConfig.excelLayout;
  } else {
    // Fall back to default structure if no layout config
    const structure = TEMPLATE_STRUCTURES[documentType] || TEMPLATE_STRUCTURES.TI;

    // Add headers
    structure.headers.forEach((row: any[]) => {
      wsData.push(row);
    });

    // Add items section
    structure.items.forEach((row: any[]) => {
      wsData.push(row);
    });

    // Add footer
    structure.footer.forEach((row: any[]) => {
      wsData.push(row);
    });
  }

  // Create worksheet
  const ws = XLSX.utils.aoa_to_sheet(wsData);

  // Set column widths
  const colWidths = [
    { wch: 15 }, // Item column
    { wch: 40 }, // Description column
    { wch: 12 }, // Quantity column
    { wch: 12 }, // Unit Price column
    { wch: 10 }, // Tax column
    { wch: 15 }, // Amount column
  ];
  ws['!cols'] = colWidths;

  // Apply some basic styling (merge cells for headers)
  ws['!merges'] = [
    { s: { r: 0, c: 0 }, e: { r: 0, c: 5 } }, // Company name
    { s: { r: 1, c: 0 }, e: { r: 1, c: 5 } }, // Company address
    { s: { r: 2, c: 0 }, e: { r: 2, c: 5 } }, // Phone
    { s: { r: 5, c: 0 }, e: { r: 5, c: 5 } }, // Document title
  ];

  // Add worksheet to workbook
  XLSX.utils.book_append_sheet(wb, ws, 'Template');

  // Add a second sheet with field mappings
  const fieldMappings = [
    ['Field Placeholder', 'Description', 'Example Value'],
    ['=== COMPANY INFORMATION ===', '', ''],
    ['{{company_name}}', 'Your company name', 'ABC Corporation Ltd.'],
    ['{{company_address}}', 'Company address', '123 Business Street, Singapore'],
    ['{{company_phone}}', 'Company phone number', '+65 6123 4567'],
    ['{{company_gst}}', 'GST/UEN registration number', 'M2-1234567-8'],
    ['', '', ''],
    ['=== CUSTOMER INFORMATION ===', '', ''],
    ['{{customer_name}}', 'Customer/client name', 'XYZ Industries'],
    ['{{customer_address}}', 'Customer address', '456 Client Road, Singapore'],
    ['{{attention_to}}', 'Attention person', 'Mr. John Doe'],
    ['', '', ''],
    ['=== DOCUMENT DETAILS ===', '', ''],
    ['{{invoice_number}}', 'Invoice number', 'INV-2024-001'],
    ['{{invoice_date}}', 'Invoice date', '2024-01-15'],
    ['{{do_number}}', 'Delivery order number', 'DO-2024-001'],
    ['{{do_date}}', 'Delivery order date', '2024-01-15'],
    ['{{quotation_number}}', 'Quotation number', 'QO-2024-001'],
    ['{{quotation_date}}', 'Quotation date', '2024-01-15'],
    ['{{reference_no}}', 'Reference number', 'REF-2024-001'],
    ['{{po_no}}', 'Purchase order number', 'PO-2024-123'],
    ['{{due_date}}', 'Payment due date', '2024-02-15'],
    ['{{payment_terms}}', 'Payment terms', '30 days'],
    ['', '', ''],
    ['=== LINE ITEMS (n = 1-5) ===', '', ''],
    ['{{description_n}}', 'Description for line item n', 'Product or service description'],
    ['{{quantity_n}}', 'Quantity for item n', '10'],
    ['{{unit_price_n}}', 'Unit price for item n', '100.00'],
    ['{{tax_n}}', 'Tax percentage for item n', '9'],
    ['{{amount_n}}', 'Total amount for item n', '1000.00'],
    ['', '', ''],
    ['=== TOTALS ===', '', ''],
    ['{{subtotal}}', 'Subtotal before tax', '1000.00'],
    ['{{tax_total}}', 'Total tax amount', '90.00'],
    ['{{total}}', 'Grand total', '1090.00'],
    ['', '', ''],
    ['=== DELIVERY INFORMATION ===', '', ''],
    ['{{delivery_address}}', 'Delivery address', '789 Warehouse St, Singapore'],
    ['{{contact_phone}}', 'Contact phone', '+65 9123 4567'],
    ['{{delivery_instructions}}', 'Delivery instructions', 'Call upon arrival'],
    ['', '', ''],
    ['=== PAYMENT INFORMATION ===', '', ''],
    ['{{bank_name}}', 'Bank name', 'Standard Chartered Bank'],
    ['{{bank_branch}}', 'Bank branch address', '12 Marina Boulevard'],
    ['{{branch_no}}', 'Branch number', '9496-007'],
    ['{{swift_code}}', 'SWIFT code', 'SCBLSG22'],
    ['{{account_no}}', 'Account number', '07-1-005302-9'],
    ['', '', ''],
    ['=== OTHER FIELDS ===', '', ''],
    ['{{notes}}', 'Additional notes', 'Thank you for your business'],
    ['{{terms_conditions}}', 'Terms and conditions', 'Payment due within 30 days'],
    ['{{currency}}', 'Currency code', 'SGD'],
    ['{{validity_date}}', 'Valid until date', '2024-02-15'],
    ['{{remarks}}', 'Additional remarks', 'Prices subject to change'],
    ['{{agreement_text}}', 'Agreement text', 'By accepting this quotation...'],
  ];

  const ws2 = XLSX.utils.aoa_to_sheet(fieldMappings);
  ws2['!cols'] = [{ wch: 25 }, { wch: 40 }, { wch: 30 }];
  XLSX.utils.book_append_sheet(wb, ws2, 'Field Mappings');

  // Generate and save the Excel file
  const wbout = XLSX.write(wb, { bookType: 'xlsx', type: 'array' });
  const blob = new Blob([wbout], { type: 'application/octet-stream' });
  saveAs(blob, `${documentType}_template.xlsx`);
};

export const parseExcelTemplate = async (file: File): Promise<any> => {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();

    reader.onload = (e) => {
      try {
        const data = e.target?.result;
        const workbook = XLSX.read(data, { type: 'binary' });

        // Get the first worksheet
        const sheetName = workbook.SheetNames[0];
        const worksheet = workbook.Sheets[sheetName];

        // Convert to JSON
        const jsonData = XLSX.utils.sheet_to_json(worksheet, {
          header: 1,
          defval: '',
          blankrows: true,
        });

        // Parse the template structure
        const templateStructure = {
          headers: [],
          items: [],
          footer: [],
          layout: jsonData,
        };

        // Extract placeholder variables
        const variables = new Set<string>();
        const variablePattern = /\{\{([^}]+)\}\}/g;

        jsonData.forEach((row: any) => {
          if (Array.isArray(row)) {
            row.forEach((cell: any) => {
              if (typeof cell === 'string') {
                let match;
                while ((match = variablePattern.exec(cell)) !== null) {
                  variables.add(match[1].trim());
                }
              }
            });
          }
        });

        resolve({
          layout: jsonData,
          variables: Array.from(variables),
          rawData: worksheet,
        });
      } catch (error) {
        reject(error);
      }
    };

    reader.onerror = (error) => reject(error);
    reader.readAsBinaryString(file);
  });
};

export const convertExcelToHtmlTemplate = (excelData: any[][]): string => {
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
};