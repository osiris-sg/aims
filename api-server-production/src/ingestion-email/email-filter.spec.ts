/**
 * Sender filter (round K): the keep rule, SHADOW (decide + log, keep everything) and ENFORCE (drop before
 * storage — no S3 write, a minimal log row). Dummy content — never real email text.
 */
import { addressOf, ADH_FILTER_ALLOW_DOMAINS, cleanAllowList, filterDecision, FilterInput, shipmentKeyIn } from './email-filter.rules';
import { IngestionEmailService, InboundEmailPayload } from './ingestion-email.service';

const OWN = ['asiadealhub.com'];
const CFG = { allowDomains: ADH_FILTER_ALLOW_DOMAINS, allowAddresses: ['broker@gmail.com'] };
const e = (o: Partial<FilterInput>): FilterInput => ({ from: 'x@example.com', to: [], cc: [], subject: '', attachmentNames: [], threadOrder: null, ...o });

describe('keep rule', () => {
  it('an allowed domain on from / to / cc keeps it (sub-domains too)', () => {
    expect(filterDecision(e({ from: 'Ops <ops@vedanta.co.in>' }), CFG, OWN)).toEqual({ keep: true, reason: 'allowed domain vedanta.co.in' });
    expect(filterDecision(e({ from: 'sayaka@asiadealhub.com', to: ['a@mail.mitsui-soko.co.jp'] }), CFG, OWN).keep).toBe(true);
    expect(filterDecision(e({ from: 'sayaka@asiadealhub.com', cc: [{ address: 'b@sus.co.jp' } as any] }), CFG, OWN).reason).toBe('allowed domain sus.co.jp');
  });
  it('an allowed address keeps it; the rest of its public domain does not', () => {
    expect(filterDecision(e({ from: 'broker@gmail.com' }), CFG, OWN)).toEqual({ keep: true, reason: 'allowed address gmail.com' });
    expect(filterDecision(e({ from: 'someone@gmail.com', subject: 'Re: Draft - Sales Contract' }), CFG, OWN)).toEqual({ keep: false, reason: 'not on the allow-list (gmail.com)' });
  });
  it('our own addresses alone never count — internal-only mail needs a key or a matched thread', () => {
    const internal = e({ from: 'sayaka@asiadealhub.com', to: ['boss@asiadealhub.com', `docs+org@inbound.osiris.sg`] });
    expect(filterDecision(internal, { allowDomains: ['asiadealhub.com'], allowAddresses: [] }, OWN).keep).toBe(false);
    expect(filterDecision(internal, CFG, OWN)).toEqual({ keep: false, reason: 'internal only, no shipment key or matched thread' });
    expect(filterDecision({ ...internal, subject: 'FW: 198GX06520 書類' }, CFG, OWN)).toEqual({ keep: true, reason: 'shipment key B/L 198GX06520' });
    expect(filterDecision({ ...internal, threadOrder: '#19' }, CFG, OWN)).toEqual({ keep: true, reason: 'thread matched to #19' });
  });
  it('a shipment key in the subject or an attachment name keeps mail from anyone', () => {
    expect(filterDecision(e({ from: 'n@unknown.jp', attachmentNames: ['22AA198GX04630.pdf'] }), CFG, OWN).keep).toBe(true);
    expect(filterDecision(e({ from: 'n@unknown.jp', subject: 'Re: thread' }), CFG, OWN).keep).toBe(false);
  });
  it('a matched thread keeps an unknown sender', () => {
    expect(filterDecision(e({ from: 'n@unknown.jp', subject: 'Re: 書類', threadOrder: '#22' }), CFG, OWN)).toEqual({ keep: true, reason: 'thread matched to #22' });
  });
  it('shipment keys: B/Ls, contract, PI, CI — not longer numbers', () => {
    expect(shipmentKeyIn('KMTCPUS1234567', [])).toBe('B/L (KMTC) KMTCPUS1234567');
    expect(shipmentKeyIn('MEDUAB123456 / x', [])).toMatch(/^B\/L \(MSC\)/);
    expect(shipmentKeyIn('SITGJKT0012345', [])).toMatch(/SITC/);
    expect(shipmentKeyIn('GGVC00123456', [])).toMatch(/RCL/);
    expect(shipmentKeyIn('contract 454003598', [])).toBe('contract 454003598');
    expect(shipmentKeyIn('PI 9331234567', [])).toBe('PI 9331234567');
    expect(shipmentKeyIn('XP2652101334.pdf', [])).toBe('CI XP2652101334');
    expect(shipmentKeyIn('', ['CI 9000565680.pdf'])).toBe('CI 9000565680');
    expect(shipmentKeyIn('ref 45400359812', [])).toBeNull();
    expect(shipmentKeyIn('ＸＰ２６５２１０１３３４', [])).toBe('CI XP2652101334'); // full-width
  });
  it('allow-list input is normalised and validated', () => {
    expect(cleanAllowList(' @Vedanta.co.in\nbad domain, evergreen-line.com,evergreen-line.com', 'domain')).toEqual(['vedanta.co.in', 'evergreen-line.com']);
    expect(cleanAllowList(['A@Gmail.com', 'nope'], 'address')).toEqual(['a@gmail.com']);
    expect(addressOf('"Name, X" <A@B.co>')).toBe('a@b.co');
  });
});

// ── the webhook: SHADOW keeps + flags, ENFORCE drops before storage ─────────
const ORG = '222c6494-96ae-42d0-9283-1b5eabf47b42';
const b64 = (s: string) => Buffer.from(s, 'utf8').toString('base64');
function makeService(config: Record<string, unknown>, threadPrior: { orderId: string } | null = null) {
  const logs: any[] = [];
  const uploads: string[] = [];
  const prisma: any = {
    organization: { findUnique: jest.fn(async () => ({ id: ORG, name: 'ADH', registrationNumber: null })) },
    emailIngestConfig: { findUnique: jest.fn(async () => config) },
    tradeSetting: { findUnique: jest.fn(async () => ({ docDefaults: {} })) },
    tradeOrder: { findFirst: jest.fn(async () => ({ orderNo: 22 })) },
    emailIngestLog: {
      // 1st call: the purged-email dedupe (none); later: the matched-thread lookup.
      findFirst: jest.fn(async ({ where }: any) => (where.orderId ? threadPrior : null)),
      create: jest.fn(async ({ data }: any) => {
        const row = { id: `log-${logs.length + 1}`, createdAt: new Date('2026-10-20T03:00:00Z'), ...data };
        logs.push(row);
        return row;
      }),
      update: jest.fn(async ({ where, data }: any) =>
        Object.assign(
          logs.find((l) => l.id === where.id),
          data,
        ),
      ),
      delete: jest.fn(),
    },
  };
  const s3: any = { uploadFile: jest.fn(async (key: string) => (uploads.push(key), `https://bucket/${key}`)) };
  const triage: any = { schedule: jest.fn() };
  const nope: any = {};
  const svc = new IngestionEmailService(prisma, s3, nope, nope, nope, nope, triage);
  return { svc, logs, uploads, triage };
}
const BASE = { enabled: true, routingMode: 'PARTIAL_AUTO', watchedSenders: [], rules: [], allowDomains: ADH_FILTER_ALLOW_DOMAINS, allowAddresses: [] };
const mail = (o: Partial<InboundEmailPayload> = {}): InboundEmailPayload => ({
  from: 'promo@newsletter.example.com',
  to: `docs+${ORG}@inbound.osiris.sg`,
  subject: 'Big sale this week',
  text: 'dummy',
  messageId: '<m1@example.com>',
  date: 'Mon, 20 Oct 2026 10:00:00 +0900',
  attachments: [{ contentType: 'application/pdf', contentBase64: b64('%PDF'), filename: 'flyer.pdf' }],
  ...o,
});

describe('webhook filter modes', () => {
  it('OFF: no verdict, stored as before', async () => {
    const { svc, logs, uploads } = makeService({ ...BASE, filterMode: 'OFF' });
    const r = await svc.handleInbound(mail());
    expect(r.ok).toBe(true);
    expect(logs[0].filterVerdict).toBeUndefined();
    expect(uploads.length).toBeGreaterThan(0);
  });
  it('SHADOW: a would-drop email is still stored and triaged, flagged DROP + why', async () => {
    const { svc, logs, uploads, triage } = makeService({ ...BASE, filterMode: 'SHADOW' });
    const r = await svc.handleInbound(mail());
    expect(r.ok).toBe(true);
    expect(logs[0]).toMatchObject({ filterVerdict: 'DROP', filterReason: 'not on the allow-list (newsletter.example.com)' });
    expect(uploads.length).toBeGreaterThan(0);
    expect(triage.schedule).toHaveBeenCalled();
  });
  it('SHADOW: an allowed sender is flagged KEEP', async () => {
    const { svc, logs } = makeService({ ...BASE, filterMode: 'SHADOW' });
    await svc.handleInbound(mail({ from: 'Ops <ops@vedanta.co.in>' }));
    expect(logs[0]).toMatchObject({ filterVerdict: 'KEEP', filterReason: 'allowed domain vedanta.co.in' });
  });
  it('ENFORCE: dropped before storage — no S3 write, no triage, a minimal row', async () => {
    const { svc, logs, uploads, triage } = makeService({ ...BASE, filterMode: 'ENFORCE' });
    const r = await svc.handleInbound(mail());
    expect(r).toMatchObject({ ok: false, reason: 'filtered' });
    expect(uploads).toEqual([]);
    expect(triage.schedule).not.toHaveBeenCalled();
    expect(logs[0]).toMatchObject({
      status: 'IGNORED',
      reason: 'filtered',
      inboxState: 'PURGED',
      filterVerdict: 'DROP',
      fromAddress: '@newsletter.example.com',
      subject: 'Big sale this week',
      attachmentCount: 0,
    });
    expect(logs[0].messageId).not.toBe('<m1@example.com>');
    expect(logs[0].rawMeta).toEqual({ filtered: true, date: 'Mon, 20 Oct 2026 10:00:00 +0900' });
  });
  it('ENFORCE: a reply on a thread matched to an order is kept', async () => {
    const { svc, logs, uploads } = makeService({ ...BASE, filterMode: 'ENFORCE' }, { orderId: 'o22' });
    const r = await svc.handleInbound(mail({ subject: 'Re: 書類', inReplyTo: '<prev@x>' }));
    expect(r.ok).toBe(true);
    expect(logs[0]).toMatchObject({ filterVerdict: 'KEEP', filterReason: 'thread matched to #22' });
    expect(uploads.length).toBeGreaterThan(0);
  });
});
