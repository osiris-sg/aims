import { renderDocumentHtml } from '../src/common/services/document-html';
import * as fs from 'fs';
const data = {
  documentType: 'TI2',
  name: 'TI2202608-003',
  company: { name: 'Osiris Technology Pte. Ltd.', gstRegNo: '202410096C', address: '71 Ayer Rajah Crescent, #04-01, Singapore 139951', phoneNumber: '91151041' },
  customer: { name: 'Asiadealhub Pte. Ltd.', address: '12 Marina Boulevard, #17-01, Tower 3, Marina\nBay Financial Centre, Singapore 018982' },
  documentInfo: { documentNumber: 'TI2202608-003', date: '2026-08-18', paymentTerms: '0 DAYS', currency: 'SGD', taxApplicable: 'N', gstPercent: 9, rate: 1 },
  items: [{ description: 'Monthly Retainer Fee for July 2026', quantity: 1, unitPrice: 8000, amount: 8000 }],
};
const org = { name: 'Osiris Technology Pte. Ltd.', registrationNumber: '200303416N', bankDetails: { accountName: 'Osiris Technology Pte. Ltd.', bankName: 'Standard Chartered Bank', branchCode: '12 Marina Boulevard, Marina Bay Financial Centre Tower 1', bankCode: '9496-007', swiftCode: 'SCBLSG22', accountNumber: '07-1-005302-9' } };
const html = renderDocumentHtml('TI2', data, org);
fs.writeFileSync('/private/tmp/claude-501/-Users-guru-Documents-GitHub-aims/5598b2c4-1b91-4bd8-a47f-65aad38eaa73/scratchpad/invoice-test.html', html || 'NULL');
console.log('written, length', html?.length);
