import * as dotenv from 'dotenv';
import * as path from 'path';
dotenv.config({ path: path.resolve(__dirname, '..', '.env'), override: true });
console.log('RESEND_API_KEY set:', !!process.env.RESEND_API_KEY);
console.log('RESEND_FROM_EMAIL:', process.env.RESEND_FROM_EMAIL || '(default invoices@aspireapp.com)');
console.log('PORTAL_BASE_URL:', process.env.PORTAL_BASE_URL || '(default www.ai-ms.io)');
