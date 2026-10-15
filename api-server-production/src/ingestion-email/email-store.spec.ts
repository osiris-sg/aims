import { emailFolder, parseMailDate, reconstructEml, safeKeyName } from './email-store';
import { IngestionEmailService, InboundEmailPayload } from './ingestion-email.service';

const ORG = '222c6494-96ae-42d0-9283-1b5eabf47b42';
const b64 = (s: string) => Buffer.from(s, 'utf8').toString('base64');

function makeService(config: Record<string, unknown> | null, opts: { failS3?: boolean } = {}) {
  const logs: any[] = [];
  const uploads: Array<{ key: string; body: Buffer; type: string }> = [];
  const prisma: any = {
    organization: { findUnique: jest.fn(async () => ({ id: ORG, name: 'Asia Deal Hub Japan LLC', registrationNumber: null })) },
    emailIngestConfig: { findUnique: jest.fn(async () => config) },
    emailIngestLog: {
      create: jest.fn(async ({ data }) => {
        if (logs.some((l) => l.organizationId === data.organizationId && l.messageId === data.messageId)) throw Object.assign(new Error('dup'), { code: 'P2002' });
        const row = { id: `log-${logs.length + 1}`, createdAt: new Date('2026-10-15T03:00:00Z'), ...data };
        logs.push(row);
        return row;
      }),
      update: jest.fn(async ({ where, data }) =>
        Object.assign(
          logs.find((l) => l.id === where.id),
          data,
        ),
      ),
      delete: jest.fn(async ({ where }) =>
        logs.splice(
          logs.findIndex((l) => l.id === where.id),
          1,
        ),
      ),
    },
  };
  const s3: any = {
    uploadFile: jest.fn(async (key: string, body: Buffer, type: string) => {
      if (opts.failS3) throw new Error('S3 down');
      uploads.push({ key, body, type });
      return `https://bucket/${key}`;
    }),
  };
  const nope: any = new Proxy(
    {},
    {
      get: () => () => {
        throw new Error('must not be called in STORE mode');
      },
    },
  );
  const svc = new IngestionEmailService(prisma, s3, nope, nope, nope, nope);
  return { svc, logs, uploads, prisma };
}

const STORE = { enabled: true, routingMode: 'STORE', watchedSenders: [], rules: [], defaultDocType: null, aiGuidance: null };
const mail = (over: Partial<InboundEmailPayload> = {}): InboundEmailPayload => ({
  from: 'ops@vedanta.co.in',
  envelopeFrom: 'bounce+srs=x@asiadealhub.com',
  to: `docs+${ORG}@inbound.osiris.sg`,
  subject: 'FW: Shipping docs 198GX04630',
  text: 'Please find attached.',
  messageId: '<abc123@mail.vedanta.co.in>',
  date: 'Wed, 15 Oct 2026 10:12:00 +0900',
  attachments: [
    { contentType: 'application/pdf', contentBase64: b64('%PDF-1.4 bl'), filename: '198GX04630 SCAN.pdf' },
    { contentType: 'application/vnd.ms-excel', contentBase64: b64('Cast No\tFE\tSI'), filename: 'COA.XLS' },
  ],
  ...over,
});

describe('email-store helpers', () => {
  it('safeKeyName keeps Japanese, strips path and control characters', () => {
    expect(safeKeyName('輸入許可書.pdf', 'x')).toBe('輸入許可書.pdf');
    expect(safeKeyName('../a/b\\c?.pdf', 'x')).toBe('.._a_b_c_.pdf');
    expect(safeKeyName('', 'attachment-1')).toBe('attachment-1');
    expect(safeKeyName('..', 'attachment-1')).toBe('attachment-1');
  });

  it('emailFolder is per org / month / log row', () => {
    expect(emailFolder(ORG, 'L1', new Date('2026-10-15T03:00:00Z'))).toBe(`email-intake/${ORG}/2026/10/L1/`);
  });

  it('parseMailDate reads RFC 2822 dates, else null', () => {
    expect(parseMailDate('Wed, 15 Oct 2026 10:12:00 +0900')).toBe('2026-10-15T01:12:00.000Z');
    expect(parseMailDate('nonsense')).toBeNull();
    expect(parseMailDate(undefined)).toBeNull();
  });

  it('reconstructEml builds a multipart message with every attachment and encoded non-ASCII headers', () => {
    const eml = reconstructEml({ ...mail({ subject: '船積書類' }), date: '2026-10-15T01:12:00.000Z', messageId: '<abc@x>', attachments: mail().attachments! }).toString('utf8');
    expect(eml).toMatch(/^From: ops@vedanta\.co\.in\r\n/);
    expect(eml).toContain(`Subject: =?UTF-8?B?${b64('船積書類')}?=`);
    expect(eml).toContain('Message-ID: <abc@x>');
    expect(eml).toContain('X-AIMS-Reconstructed: true');
    expect(eml).toContain('filename="198GX04630 SCAN.pdf"');
    expect(eml).toContain(b64('%PDF-1.4 bl'));
    expect(eml.trimEnd().endsWith('--')).toBe(true);
  });
});

describe('IngestionEmailService — routingMode STORE', () => {
  it('stores the raw .eml + attachments and records from/to/subject/date/Message-ID/names', async () => {
    const { svc, logs, uploads } = makeService(STORE);
    const raw = 'From: ops@vedanta.co.in\r\nSubject: x\r\n\r\nbody';
    const r = await svc.handleInbound(mail({ rawBase64: b64(raw) }));
    expect(r).toMatchObject({ ok: true, created: [] });
    expect(uploads.map((u) => u.key)).toEqual([
      `email-intake/${ORG}/2026/10/log-1/attachments/198GX04630 SCAN.pdf`,
      `email-intake/${ORG}/2026/10/log-1/attachments/COA.XLS`,
      `email-intake/${ORG}/2026/10/log-1/message.eml`,
    ]);
    expect(uploads[2].body.toString('utf8')).toBe(raw);
    expect(uploads[2].type).toBe('message/rfc822');
    const log = logs[0];
    expect(log).toMatchObject({ status: 'STORED', fromAddress: 'ops@vedanta.co.in', subject: 'FW: Shipping docs 198GX04630', messageId: '<abc123@mail.vedanta.co.in>', attachmentCount: 2 });
    expect(log.rawMeta).toMatchObject({
      mode: 'STORE',
      to: `docs+${ORG}@inbound.osiris.sg`,
      envelopeFrom: 'bounce+srs=x@asiadealhub.com',
      date: '2026-10-15T01:12:00.000Z',
      emlSource: 'raw',
      attachmentNames: ['198GX04630 SCAN.pdf', 'COA.XLS'],
    });
  });

  it('rebuilds the .eml when the worker sent no raw MIME', async () => {
    const { svc, logs, uploads } = makeService(STORE);
    await svc.handleInbound(mail());
    expect(logs[0].rawMeta.emlSource).toBe('reconstructed');
    expect(uploads.find((u) => u.key.endsWith('message.eml'))!.body.toString()).toContain('X-AIMS-Reconstructed: true');
  });

  it('dedupes on Message-ID: the second delivery stores nothing', async () => {
    const { svc, logs, uploads } = makeService(STORE);
    await svc.handleInbound(mail());
    const n = uploads.length;
    expect(await svc.handleInbound(mail())).toEqual({ ok: false, reason: 'duplicate' });
    expect(uploads.length).toBe(n);
    expect(logs).toHaveLength(1);
  });

  it('accepts any sender (forwards keep the original From) and never runs the AI / lead paths', async () => {
    const { svc } = makeService(STORE);
    // A lead-looking sender would normally go to LeadsService (a Proxy that throws here).
    expect(await svc.handleInbound(mail({ from: 'noreply@ezid.sg', subject: 'New lead', messageId: '<l@x>' }))).toMatchObject({ ok: true });
  });

  it('an S3 failure removes the log row and throws (→ 500, the worker retries)', async () => {
    const { svc, logs } = makeService(STORE, { failS3: true });
    await expect(svc.handleInbound(mail())).rejects.toThrow('S3 down');
    expect(logs).toHaveLength(0);
  });

  it('intake off → nothing stored', async () => {
    const { svc, uploads } = makeService({ ...STORE, enabled: false });
    expect(await svc.handleInbound(mail())).toEqual({ ok: false, reason: 'ingestion-disabled' });
    expect(uploads).toHaveLength(0);
  });

  it('two attachments with the same name both kept', async () => {
    const { svc, uploads } = makeService(STORE);
    const a = { contentType: 'application/pdf', contentBase64: b64('x'), filename: 'scan.pdf' };
    await svc.handleInbound(mail({ attachments: [a, a] }));
    expect(uploads.filter((u) => u.key.includes('/attachments/')).map((u) => u.key.split('/').pop())).toEqual(['scan.pdf', '2-scan.pdf']);
  });
});
