import { Catch, ExceptionFilter, ArgumentsHost, HttpException, HttpStatus } from '@nestjs/common';

/**
 * The one place a server error becomes words a user reads.
 *
 * This filter used to send `exception.message` verbatim, so Prisma's internals
 * went straight to the screen — an accountant saving an invoice saw
 *   "Invalid `prisma.document.update()` invocation: Unique constraint failed
 *    on the fields: (`name`,`organizationId`,`documentTemplateId`)"
 * which says nothing about what to change (guru 2026-10-19: "isit possible to
 * just give better error message overall for everything not just that").
 *
 * Deliberate choices:
 *  - A thrown HttpException is the app speaking on purpose — its message and
 *    status pass through untouched.
 *  - A known Prisma error is translated using its own metadata, so the message
 *    names the field that actually clashed.
 *  - Anything else is logged in full server-side and returns a generic line:
 *    a stack trace or a connection string is not for the browser.
 */

// Field + model names as the office would say them.
const FIELD_LABELS: Record<string, string> = {
  name: 'number',
  customerCode: 'customer code',
  supplierCode: 'supplier code',
  skuKey: 'SKU',
  sku: 'SKU',
  email: 'email address',
  journalNumber: 'journal number',
  code: 'code',
  deliveryNumber: 'delivery number',
  orderNumber: 'order number',
  nfcTagUid: 'NFC tag',
  xeroId: 'Xero link',
};
// Scoping columns — present in nearly every composite key, never the thing the
// user typed, so naming them in the message only confuses.
const SCOPE_FIELDS = new Set(['organizationId', 'documentTemplateId', 'projectId', 'id']);

const MODEL_LABELS: Record<string, string> = {
  Document: 'document',
  Customer: 'customer',
  Supplier: 'supplier',
  Asset: 'product',
  Inventory: 'stock unit',
  JournalEntry: 'journal entry',
  ChartOfAccount: 'account',
  Delivery: 'delivery',
  Order: 'order',
  Project: 'project',
  Payment: 'payment',
  Role: 'role',
  Organization: 'organisation',
};

const label = (model?: string) => MODEL_LABELS[model || ''] || (model ? model.replace(/([a-z])([A-Z])/g, '$1 $2').toLowerCase() : 'record');

function fieldsFrom(meta: any): string[] {
  const t = meta?.target;
  const raw: string[] = Array.isArray(t) ? t : typeof t === 'string' ? t.split(/[_,]/) : [];
  return raw.filter((f) => f && !SCOPE_FIELDS.has(f)).map((f) => FIELD_LABELS[f] || f);
}

/** Known Prisma codes → a sentence and a status. Returns null if unrecognised. */
function translatePrisma(e: any): { message: string; status: number } | null {
  const code = e?.code;
  if (typeof code !== 'string' || !code.startsWith('P')) return null;
  const meta = e?.meta || {};
  const what = label(meta.modelName);

  switch (code) {
    case 'P2002': {
      const fields = fieldsFrom(meta);
      const which = fields.length ? fields.join(' and ') : 'value';
      return {
        message: `That ${which} is already used by another ${what}. Pick a different one.`,
        status: HttpStatus.CONFLICT,
      };
    }
    case 'P2025':
      return { message: `That ${what} no longer exists — it may have been deleted or renamed.`, status: HttpStatus.NOT_FOUND };
    case 'P2003':
      return {
        message: `This ${what} is still linked to other records, so it cannot be changed or removed yet.`,
        status: HttpStatus.CONFLICT,
      };
    case 'P2014':
      return { message: `This change would break a link between records, so it was not saved.`, status: HttpStatus.CONFLICT };
    case 'P2000':
      return { message: `A value is too long for the ${String(meta.column_name || 'field')} field.`, status: HttpStatus.BAD_REQUEST };
    case 'P2011':
      return { message: `A required field was left empty.`, status: HttpStatus.BAD_REQUEST };
    case 'P2024':
      return { message: `The database is busy. Please try again in a moment.`, status: HttpStatus.SERVICE_UNAVAILABLE };
    case 'P1001':
    case 'P1002':
      return { message: `Cannot reach the database right now. Please try again shortly.`, status: HttpStatus.SERVICE_UNAVAILABLE };
    case 'P2021':
    case 'P2022':
      // A schema mismatch is an operator problem, not something a user can act on.
      return { message: `The server is misconfigured for this request. The team has been notified.`, status: HttpStatus.INTERNAL_SERVER_ERROR };
    default:
      return null;
  }
}

@Catch()
export class CustomExceptionFilter implements ExceptionFilter {
  catch(exception: any, host: ArgumentsHost) {
    const ctx = host.switchToHttp();
    const response = ctx.getResponse();
    const request = ctx.getRequest();

    let status: number;
    let message: string;
    let data: any = {};

    if (exception instanceof HttpException) {
      // The app threw this on purpose — say exactly what it said.
      status = exception.getStatus();
      const body: any = exception.getResponse();
      message = typeof body === 'string' ? body : body?.message || exception.message;
      if (Array.isArray(message)) message = message.join('; '); // class-validator
      if (typeof body === 'object' && body?.data) data = body.data;
    } else {
      const translated = translatePrisma(exception);
      if (translated) {
        status = translated.status;
        message = translated.message;
      } else if (exception?.name === 'PrismaClientValidationError') {
        message = 'Some of the information sent was missing or in the wrong format.';
        status = HttpStatus.BAD_REQUEST;
      } else {
        // Never hand an internal message to the browser: it can carry table
        // names, queries and connection details.
        message = 'Something went wrong on our side. Please try again.';
        status = exception?.status || HttpStatus.INTERNAL_SERVER_ERROR;
      }
    }

    // The full error always goes to the server log, whatever the user sees.
    const where = `${request?.method || ''} ${request?.originalUrl || request?.url || ''}`.trim();
    if (status >= 500) console.error(`[error] ${where} →`, exception);
    else console.warn(`[error] ${where} → ${status} ${message}`, exception?.code ? `(${exception.code})` : '');

    response.status(status);
    response.setHeader('Content-Type', 'application/json');
    response.send({ success: false, message, data });
  }
}
