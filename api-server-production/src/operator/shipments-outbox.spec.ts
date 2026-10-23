/**
 * The notification queue + outbox worker: opt-in per user, dedupe, quiet hours at queue time, one
 * message per user when draining, the digest as a template, the line to send from.
 */
import { ShipmentsNotifyService } from '../shipments/shipments-notify.service';
import { ShipmentsOutboxService } from './shipments-outbox.service';

const jst = (iso: string) => new Date(`${iso}+09:00`);
/** Round AD: the outbox asks the short-link service for the Dashboard link. */
const links: any = { url: jest.fn(async (org: string, path: string) => `https://app.ai-ms.io/go/t-${org}${path === '/portal' ? '' : '-emails'}`) };

function prismaMock(profiles: any[], features: Record<string, boolean> = { enableWhatsAppAgent: true }) {
  const rows: any[] = [];
  return {
    rows,
    prisma: {
      organizationUIConfig: { findUnique: jest.fn(async () => ({ features })) },
      organizationMemberProfile: { findMany: jest.fn(async () => profiles) },
      whatsAppOutbox: {
        create: jest.fn(async ({ data }: any) => {
          if (data.dedupeKey && rows.some((r) => r.organizationId === data.organizationId && r.dedupeKey === data.dedupeKey)) throw Object.assign(new Error('dup'), { code: 'P2002' });
          const row = { id: `r${rows.length + 1}`, status: 'QUEUED', ...data };
          rows.push(row);
          return row;
        }),
        findMany: jest.fn(async ({ where }: any) => rows.filter((r) => r.status === where.status && r.dueAt <= where.dueAt.lte)),
        updateMany: jest.fn(async ({ where, data }: any) => {
          for (const r of rows) if (where.id.in.includes(r.id)) Object.assign(r, data);
        }),
      },
      whatsAppMessage: { findFirst: jest.fn(async () => ({ phoneNumberId: 'line-osiris' })) },
      whatsAppConnection: { findFirst: jest.fn(async ({ where }: any) => (where.phoneNumberId === 'line-osiris' || where.organizationId ? { phoneNumberId: where.phoneNumberId ?? 'line-own' } : null)) },
      organizationModule: { findMany: jest.fn(async () => [{ organizationId: 'org-adh' }]) },
    } as any,
  };
}

describe('ShipmentsNotifyService.queue', () => {
  const sayaka = { userId: 'u-sayaka', whatsappNumber: '81 90 0000 0001', whatsappPrefs: null };
  const toshiro = { userId: 'u-toshiro', whatsappNumber: '819000000002', whatsappPrefs: { needsMe: false, events: true, quietFrom: '22:00', quietTo: '07:00' } };

  it('writes one row per opted-in linked user, 10 minutes out, digits-only number', async () => {
    const { prisma, rows } = prismaMock([sayaka, toshiro]);
    const n = await new ShipmentsNotifyService(prisma).queue('org-adh', 'NEEDS_ME', 'Pick the record', { at: jst('2026-10-22T10:00:00') });
    expect(n).toBe(1); // Toshiro has needsMe off
    expect(rows[0]).toMatchObject({ userId: 'u-sayaka', to: '819000000001', kind: 'NEEDS_ME' });
    expect(rows[0].dueAt.toISOString()).toBe(jst('2026-10-22T10:10:00').toISOString());
  });

  it('an event at 23:00 JST waits for the user’s own quiet hours to end; the same dedupe key queues once', async () => {
    const { prisma, rows } = prismaMock([sayaka, toshiro]);
    const svc = new ShipmentsNotifyService(prisma);
    await svc.queue('org-adh', 'EVENT', 'ETA moved', { dedupeKey: 'eta:s1:2026-10-30', at: jst('2026-10-22T23:00:00') });
    await svc.queue('org-adh', 'EVENT', 'ETA moved', { dedupeKey: 'eta:s1:2026-10-30', at: jst('2026-10-22T23:00:00') });
    expect(rows).toHaveLength(2);
    expect(rows.find((r) => r.userId === 'u-sayaka').dueAt.toISOString()).toBe(jst('2026-10-23T08:00:00').toISOString());
    expect(rows.find((r) => r.userId === 'u-toshiro').dueAt.toISOString()).toBe(jst('2026-10-23T07:00:00').toISOString());
  });

  it('writes nothing when the org flag is off, and never throws', async () => {
    const { prisma, rows } = prismaMock([sayaka], { enableWhatsAppAgent: false });
    expect(await new ShipmentsNotifyService(prisma).queue('org-adh', 'EVENT', 'x')).toBe(0);
    expect(rows).toHaveLength(0);
    const broken: any = { organizationUIConfig: { findUnique: jest.fn(async () => { throw new Error('db down'); }) } };
    expect(await new ShipmentsNotifyService(broken).queue('org-adh', 'EVENT', 'x')).toBe(0);
  });

  it('the digest uses the per-user text (language) and is due immediately', async () => {
    const { prisma, rows } = prismaMock([{ ...sayaka, whatsappPrefs: { lang: 'ja' } }, toshiro]);
    await new ShipmentsNotifyService(prisma).queue('org-adh', 'DIGEST', 'EN digest', { dedupeKey: 'digest:2026-10-22', textFor: (p) => (p.lang === 'ja' ? 'JP digest' : 'EN digest'), at: jst('2026-10-22T08:30:00') });
    expect(rows.map((r) => r.text).sort()).toEqual(['EN digest', 'JP digest']);
    expect(rows[0].dueAt.toISOString()).toBe(jst('2026-10-22T08:30:00').toISOString());
  });
});

describe('ShipmentsOutboxService.drain', () => {
  it('sends one batched text per user, the digest as plain text (lines kept; the closed-window recovery falls back), on the line the user last wrote to', async () => {
    const { prisma, rows } = prismaMock([]);
    const now = jst('2026-10-22T10:20:00');
    rows.push(
      { id: 'r1', organizationId: 'org-adh', userId: 'u1', to: '819000000001', kind: 'NEEDS_ME', text: 'A', dueAt: jst('2026-10-22T10:10:00'), status: 'QUEUED', createdAt: new Date(1) },
      { id: 'r2', organizationId: 'org-adh', userId: 'u1', to: '819000000001', kind: 'EVENT', text: 'B', dueAt: jst('2026-10-22T10:15:00'), status: 'QUEUED', createdAt: new Date(2) },
      { id: 'r3', organizationId: 'org-adh', userId: 'u1', to: '819000000001', kind: 'DIGEST', text: 'Good morning', dueAt: jst('2026-10-22T08:30:00'), status: 'QUEUED', createdAt: new Date(3) },
      { id: 'r4', organizationId: 'org-adh', userId: 'u2', to: '819000000002', kind: 'EVENT', text: 'later', dueAt: jst('2026-10-22T10:25:00'), status: 'QUEUED', createdAt: new Date(4) },
    );
    const whatsapp: any = { sendText: jest.fn(async () => undefined), sendTemplate: jest.fn(async () => true), rememberContext: jest.fn() };
    const svc = new ShipmentsOutboxService(prisma, new ShipmentsNotifyService(prisma), { myTasks: jest.fn(async () => []) } as any, whatsapp, { dashboard: jest.fn(async () => ({ toConfirm: { emails: 0, total: 0 } })) } as any, links);
    const r = await svc.drain(now);
    expect(r).toEqual({ sent: 3, failed: 0 });
    expect(whatsapp.rememberContext).toHaveBeenCalledWith('819000000001', 'line-osiris');
    expect(whatsapp.sendTemplate).not.toHaveBeenCalled();
    expect(whatsapp.sendText).toHaveBeenCalledTimes(2);
    expect(whatsapp.sendText.mock.calls[0][1]).toBe('Good morning');
    // Two event lines due together: the lines, a blank line, the SHORT Dashboard link once — no bullets, no emojis.
    expect(whatsapp.sendText.mock.calls[1][1]).toBe('A\nB\n\nhttps://app.ai-ms.io/go/t-org-adh');
    expect(rows.filter((x) => x.status === 'SENT').map((x) => x.id).sort()).toEqual(['r1', 'r2', 'r3']);
    expect(rows.find((x) => x.id === 'r4').status).toBe('QUEUED'); // not due yet
  });

  it('with the approved templates configured, the digest and a single needs-check push go as templates (one parameter per line); a batch stays text', async () => {
    process.env.WHATSAPP_DIGEST_TEMPLATE = 'aims_digest';
    process.env.WHATSAPP_NEEDS_TEMPLATE = 'aims_needs_check';
    try {
      const { prisma, rows } = prismaMock([]);
      const url = 'https://app.ai-ms.io/go/abc123';
      const digest = `Good morning. Thu 22 Oct\n\n18 emails filed automatically\n4 need your check\n\n${url}`;
      const needs = `New email needs a shipment\nAsia Deal Hub · 22 Oct 11:50\nRe: DET\n\nADH asks about DET costs.\n\nReply with the shipment number (e.g. 18-1), or open AIMS:\n${url}`;
      rows.push(
        { id: 'r1', organizationId: 'org-adh', userId: 'u1', to: '819000000001', kind: 'DIGEST', text: digest, dueAt: new Date(0), status: 'QUEUED', createdAt: new Date(1) },
        { id: 'r2', organizationId: 'org-adh', userId: 'u1', to: '819000000001', kind: 'NEEDS_ME', text: needs, dueAt: new Date(0), status: 'QUEUED', createdAt: new Date(2) },
        { id: 'r3', organizationId: 'org-adh', userId: 'u1', to: '819000000001', kind: 'EVENT', text: '#19-1 arrival notice filed', dueAt: new Date(0), status: 'QUEUED', createdAt: new Date(3) },
      );
      const whatsapp: any = { sendText: jest.fn(async () => undefined), sendTemplate: jest.fn(), sendTemplateLines: jest.fn(async () => true), rememberContext: jest.fn() };
      const svc = new ShipmentsOutboxService(prisma, new ShipmentsNotifyService(prisma), { myTasks: jest.fn() } as any, whatsapp, { dashboard: jest.fn() } as any, links);
      expect(await svc.drain(new Date())).toEqual({ sent: 3, failed: 0 });
      expect(whatsapp.sendTemplateLines).toHaveBeenCalledWith('819000000001', 'aims_digest', ['Thu 22 Oct', '18 emails', '4 questions', 'none', 'none', url], 'en');
      expect(whatsapp.sendTemplateLines).toHaveBeenCalledWith('819000000001', 'aims_needs_check', ['Asia Deal Hub · 22 Oct 11:50', 'Re: DET', 'It needs a shipment. ADH asks about DET costs.', `Reply with the shipment number (e.g. 18-1), or open AIMS: ${url}`], 'en');
      expect(whatsapp.sendText).toHaveBeenCalledTimes(1);
      expect(whatsapp.sendText.mock.calls[0][1]).toBe('#19-1 arrival notice filed');
    } finally {
      delete process.env.WHATSAPP_DIGEST_TEMPLATE;
      delete process.env.WHATSAPP_NEEDS_TEMPLATE;
    }
  });

  it('marks rows FAILED when there is no line to send from', async () => {
    const { prisma, rows } = prismaMock([]);
    prisma.whatsAppMessage.findFirst = jest.fn(async () => null);
    prisma.whatsAppConnection.findFirst = jest.fn(async () => null);
    rows.push({ id: 'r1', organizationId: 'org-adh', userId: 'u1', to: '819000000001', kind: 'EVENT', text: 'A', dueAt: new Date(0), status: 'QUEUED', createdAt: new Date(1) });
    const whatsapp: any = { sendText: jest.fn(), sendTemplate: jest.fn(), rememberContext: jest.fn() };
    const svc = new ShipmentsOutboxService(prisma, new ShipmentsNotifyService(prisma), { myTasks: jest.fn() } as any, whatsapp, { dashboard: jest.fn() } as any, links);
    expect(await svc.drain(new Date())).toEqual({ sent: 0, failed: 1 });
    expect(rows[0]).toMatchObject({ status: 'FAILED', error: 'no WhatsApp line to send from' });
    expect(whatsapp.sendText).not.toHaveBeenCalled();
  });
});
