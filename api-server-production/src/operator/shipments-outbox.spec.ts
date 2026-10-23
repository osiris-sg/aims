/**
 * The notification queue + outbox worker: opt-in per user, dedupe, quiet hours at queue time, one
 * message per user when draining, the digest as a template, the line to send from.
 */
import { ShipmentsNotifyService } from '../shipments/shipments-notify.service';
import { ShipmentsOutboxService } from './shipments-outbox.service';

const jst = (iso: string) => new Date(`${iso}+09:00`);
/** Round AD: the outbox asks the short-link service for the Dashboard link. */
const links: any = { url: jest.fn(async (org: string, path: string) => `https://app.ai-ms.io/go/t-${org}${path === '/portal' ? '' : '-emails'}`) };
/** Round AD: the template names come from what Meta approved (TemplateStatusService) — none here unless a test says so. */
const noTemplates: any = { shipmentsTemplate: jest.fn(async () => '') };
const approvedTemplates: any = { shipmentsTemplate: jest.fn(async (kind: string) => (kind === 'digest' ? 'aims_digest' : kind === 'needs_check' ? 'aims_needs_check' : '')) };

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
      // Round AE: the outbox skips an answer push whose email was answered elsewhere — open by default here.
      emailIngestLog: { findFirst: jest.fn(async ({ where }: any) => ({ id: where.id })) },
    } as any,
  };
}

describe('ShipmentsNotifyService.queue', () => {
  const sayaka = { userId: 'u-sayaka', whatsappNumber: '81 90 0000 0001', whatsappPrefs: null };
  const toshiro = { userId: 'u-toshiro', whatsappNumber: '819000000002', whatsappPrefs: { needsMe: false, events: true, quietFrom: '22:00', quietTo: '07:00' } };

  it('round AE (owner): only NEEDS_ME is queued — digest / events / filed return 0 rows (code kept, gate off)', async () => {
    const { prisma, rows } = prismaMock([sayaka, { ...toshiro, whatsappPrefs: { needsMe: true, events: true, digest: true, filed: true } }]);
    const svc = new ShipmentsNotifyService(prisma);
    expect(await svc.queue('org-adh', 'EVENT', 'ETA moved')).toBe(0);
    expect(await svc.queue('org-adh', 'DIGEST', 'Good morning', { dedupeKey: 'digest:2026-10-22' })).toBe(0);
    expect(await svc.queue('org-adh', 'FILED', '#19-1 1 file filed')).toBe(0);
    expect(rows).toHaveLength(0);
  });

  it('writes one row per opted-in linked user, 10 minutes out, digits-only number', async () => {
    const { prisma, rows } = prismaMock([sayaka, toshiro]);
    const n = await new ShipmentsNotifyService(prisma).queue('org-adh', 'NEEDS_ME', 'Pick the record', { at: jst('2026-10-22T10:00:00') });
    expect(n).toBe(1); // Toshiro has needsMe off
    expect(rows[0]).toMatchObject({ userId: 'u-sayaka', to: '819000000001', kind: 'NEEDS_ME' });
    expect(rows[0].dueAt.toISOString()).toBe(jst('2026-10-22T10:10:00').toISOString());
  });

  it('a push at 23:00 JST waits for the user’s own quiet hours to end; the same dedupe key queues once', async () => {
    const { prisma, rows } = prismaMock([sayaka, { ...toshiro, whatsappPrefs: { needsMe: true, quietFrom: '22:00', quietTo: '07:00' } }]);
    const svc = new ShipmentsNotifyService(prisma);
    await svc.queue('org-adh', 'NEEDS_ME', 'Needs you', { dedupeKey: 'needs:e1', at: jst('2026-10-22T23:00:00') });
    await svc.queue('org-adh', 'NEEDS_ME', 'Needs you', { dedupeKey: 'needs:e1', at: jst('2026-10-22T23:00:00') });
    expect(rows).toHaveLength(2);
    expect(rows.find((r) => r.userId === 'u-sayaka').dueAt.toISOString()).toBe(jst('2026-10-23T08:00:00').toISOString());
    expect(rows.find((r) => r.userId === 'u-toshiro').dueAt.toISOString()).toBe(jst('2026-10-23T07:00:00').toISOString());
  });

  it('writes nothing when the org flag is off, and never throws', async () => {
    const { prisma, rows } = prismaMock([sayaka], { enableWhatsAppAgent: false });
    expect(await new ShipmentsNotifyService(prisma).queue('org-adh', 'NEEDS_ME', 'x')).toBe(0);
    expect(rows).toHaveLength(0);
    const broken: any = { organizationUIConfig: { findUnique: jest.fn(async () => { throw new Error('db down'); }) } };
    expect(await new ShipmentsNotifyService(broken).queue('org-adh', 'NEEDS_ME', 'x')).toBe(0);
  });

  it('the per-user text (language) is used', async () => {
    const { prisma, rows } = prismaMock([{ ...sayaka, whatsappPrefs: { lang: 'ja' } }, { ...toshiro, whatsappPrefs: { needsMe: true } }]);
    await new ShipmentsNotifyService(prisma).queue('org-adh', 'NEEDS_ME', 'EN push', { dedupeKey: 'needs:e2', textFor: (p) => (p.lang === 'ja' ? 'JP push' : 'EN push'), at: jst('2026-10-22T10:00:00') });
    expect(rows.map((r) => r.text).sort()).toEqual(['EN push', 'JP push']);
  });
});

describe('ShipmentsOutboxService.drain', () => {
  const URL = 'https://app.ai-ms.io/go/k7m2xq4p';
  const push = `New email needs your answer\nFrom SUS · 23 Oct 06:53\nSubject: Re: 書類送付: 6005C材220MT 2026年11月納入分\nSummary: SUS revised the November delivery schedule and asks ADH to confirm.\nReply with the shipment number, or open AIMS: ${URL} to answer.`;
  const whatsappMock = (textResult = { ok: true, code: null as number | null, message: null as string | null }) => ({ sendText: jest.fn(async () => undefined), sendTextResult: jest.fn(async () => textResult), sendTemplate: jest.fn(), sendTemplateLines: jest.fn(async () => true), rememberContext: jest.fn() }) as any;
  const svcOf = (prisma: any, whatsapp: any, templates: any) => new ShipmentsOutboxService(prisma, new ShipmentsNotifyService(prisma), { myTasks: jest.fn(async () => []) } as any, whatsapp, { dashboard: jest.fn(async () => ({ toConfirm: { emails: 0, total: 0 } })) } as any, links, templates);

  it('no approved template yet: the push goes as the identical plain text inside the window; events and a digest go as text; the line the user last wrote to', async () => {
    const { prisma, rows } = prismaMock([]);
    const now = jst('2026-10-22T10:20:00');
    rows.push(
      { id: 'r1', organizationId: 'org-adh', userId: 'u1', to: '819000000001', kind: 'NEEDS_ME', text: push, dedupeKey: 'needs:11111111-1111-1111-1111-111111111111:u1', dueAt: jst('2026-10-22T10:10:00'), status: 'QUEUED', createdAt: new Date(1) },
      { id: 'r2', organizationId: 'org-adh', userId: 'u1', to: '819000000001', kind: 'EVENT', text: 'B', dueAt: jst('2026-10-22T10:15:00'), status: 'QUEUED', createdAt: new Date(2) },
      { id: 'r3', organizationId: 'org-adh', userId: 'u1', to: '819000000001', kind: 'DIGEST', text: 'Good morning', dueAt: jst('2026-10-22T08:30:00'), status: 'QUEUED', createdAt: new Date(3) },
      { id: 'r4', organizationId: 'org-adh', userId: 'u2', to: '819000000002', kind: 'EVENT', text: 'later', dueAt: jst('2026-10-22T10:25:00'), status: 'QUEUED', createdAt: new Date(4) },
    );
    const whatsapp = whatsappMock();
    const templates: any = { answerTemplate: jest.fn(async () => ''), shipmentsTemplate: jest.fn(async () => '') };
    expect(await svcOf(prisma, whatsapp, templates).drain(now)).toEqual({ sent: 3, failed: 0 });
    expect(whatsapp.rememberContext).toHaveBeenCalledWith('819000000001', 'line-osiris');
    expect(templates.answerTemplate).toHaveBeenCalledWith('answer', 'en', 'line-osiris');
    expect(whatsapp.sendTemplateLines).not.toHaveBeenCalled();
    expect(whatsapp.sendTextResult).toHaveBeenCalledWith('819000000001', push);
    expect(whatsapp.sendText.mock.calls.map((c: any[]) => c[1])).toEqual(['Good morning', 'B']);
    expect(rows.filter((x) => x.status === 'SENT').map((x) => x.id).sort()).toEqual(['r1', 'r2', 'r3']);
    expect(rows.find((x) => x.id === 'r4').status).toBe('QUEUED'); // not due yet
  });

  it('with the approved aims_answer template on the line: the SAME values go as the template (inside or outside the window)', async () => {
    const { prisma, rows } = prismaMock([]);
    rows.push({ id: 'r1', organizationId: 'org-adh', userId: 'u1', to: '819000000001', kind: 'NEEDS_ME', text: push, dedupeKey: 'needs:11111111-1111-1111-1111-111111111111:u1', dueAt: new Date(0), status: 'QUEUED', createdAt: new Date(1) });
    const whatsapp = whatsappMock();
    const templates: any = { answerTemplate: jest.fn(async (kind: string) => (kind === 'answer' ? 'aims_answer' : '')), shipmentsTemplate: jest.fn(async () => '') };
    expect(await svcOf(prisma, whatsapp, templates).drain(new Date())).toEqual({ sent: 1, failed: 0 });
    expect(whatsapp.sendTemplateLines).toHaveBeenCalledWith('819000000001', 'aims_answer', ['SUS', '23 Oct 06:53', 'Re: 書類送付: 6005C材220MT 2026年11月納入分', 'SUS revised the November delivery schedule and asks ADH to confirm.', URL], 'en');
    expect(whatsapp.sendTextResult).not.toHaveBeenCalled();
    expect(rows[0].status).toBe('SENT');
  });

  it('several due together → the batch template (count, latest, link) or its identical text', async () => {
    const { prisma, rows } = prismaMock([]);
    const second = push.replace('From SUS · 23 Oct 06:53', 'From Vedanta · 23 Oct 07:10').replace('Subject: Re: 書類送付: 6005C材220MT 2026年11月納入分', 'Subject: TELEX MSG');
    rows.push(
      { id: 'r1', organizationId: 'org-adh', userId: 'u1', to: '819000000001', kind: 'NEEDS_ME', text: push, dedupeKey: 'needs:11111111-1111-1111-1111-111111111111:u1', dueAt: new Date(0), status: 'QUEUED', createdAt: new Date(1) },
      { id: 'r2', organizationId: 'org-adh', userId: 'u1', to: '819000000001', kind: 'NEEDS_ME', text: second, dedupeKey: 'needs:22222222-2222-2222-2222-222222222222:u1', dueAt: new Date(0), status: 'QUEUED', createdAt: new Date(2) },
    );
    const whatsapp = whatsappMock();
    const templates: any = { answerTemplate: jest.fn(async (kind: string) => (kind === 'answer_batch' ? 'aims_answer_batch' : '')), shipmentsTemplate: jest.fn(async () => '') };
    expect(await svcOf(prisma, whatsapp, templates).drain(new Date())).toEqual({ sent: 2, failed: 0 });
    expect(whatsapp.sendTemplateLines).toHaveBeenCalledWith('819000000001', 'aims_answer_batch', ['2', 'Vedanta · 23 Oct 07:10', 'TELEX MSG', URL], 'en');
  });

  it('no template yet AND the 24h window is closed (131047): the push is HELD — kept QUEUED, retried in 30 minutes, never dropped', async () => {
    const { prisma, rows } = prismaMock([]);
    const now = jst('2026-10-22T10:20:00');
    rows.push({ id: 'r1', organizationId: 'org-adh', userId: 'u1', to: '819000000001', kind: 'NEEDS_ME', text: push, dedupeKey: 'needs:11111111-1111-1111-1111-111111111111:u1', dueAt: new Date(0), status: 'QUEUED', createdAt: new Date(1) });
    const whatsapp = whatsappMock({ ok: false, code: 131047, message: 'Re-engagement message' });
    const templates: any = { answerTemplate: jest.fn(async () => ''), shipmentsTemplate: jest.fn(async () => '') };
    expect(await svcOf(prisma, whatsapp, templates).drain(now)).toEqual({ sent: 0, failed: 0 });
    expect(rows[0].status).toBe('QUEUED');
    expect(rows[0].dueAt.toISOString()).toBe(jst('2026-10-22T10:50:00').toISOString());
    expect(rows[0].error).toMatch(/held: 24h window closed/);
    // Another failure is a real failure.
    const { prisma: p2, rows: r2 } = prismaMock([]);
    r2.push({ id: 'r1', organizationId: 'org-adh', userId: 'u1', to: '819000000001', kind: 'NEEDS_ME', text: push, dedupeKey: 'needs:11111111-1111-1111-1111-111111111111:u1', dueAt: new Date(0), status: 'QUEUED', createdAt: new Date(1) });
    expect(await svcOf(p2, whatsappMock({ ok: false, code: 100, message: 'bad' }), templates).drain(now)).toEqual({ sent: 0, failed: 1 });
    expect(r2[0].status).toBe('FAILED');
  });

  it('an answer push whose email was answered meanwhile is SKIPPED, not sent', async () => {
    const { prisma, rows } = prismaMock([]);
    prisma.emailIngestLog.findFirst = jest.fn(async () => null);
    rows.push({ id: 'r1', organizationId: 'org-adh', userId: 'u1', to: '819000000001', kind: 'NEEDS_ME', text: push, dedupeKey: 'needs:11111111-1111-1111-1111-111111111111:u1', dueAt: new Date(0), status: 'QUEUED', createdAt: new Date(1) });
    const whatsapp = whatsappMock();
    expect(await svcOf(prisma, whatsapp, { answerTemplate: jest.fn(async () => 'aims_answer'), shipmentsTemplate: jest.fn(async () => '') }).drain(new Date())).toEqual({ sent: 0, failed: 0 });
    expect(rows[0].status).toBe('SKIPPED');
    expect(whatsapp.sendTemplateLines).not.toHaveBeenCalled();
  });

  it('marks rows FAILED when there is no line to send from', async () => {
    const { prisma, rows } = prismaMock([]);
    prisma.whatsAppMessage.findFirst = jest.fn(async () => null);
    prisma.whatsAppConnection.findFirst = jest.fn(async () => null);
    rows.push({ id: 'r1', organizationId: 'org-adh', userId: 'u1', to: '819000000001', kind: 'EVENT', text: 'A', dueAt: new Date(0), status: 'QUEUED', createdAt: new Date(1) });
    const whatsapp = whatsappMock();
    expect(await svcOf(prisma, whatsapp, noTemplates).drain(new Date())).toEqual({ sent: 0, failed: 1 });
    expect(rows[0]).toMatchObject({ status: 'FAILED', error: 'no WhatsApp line to send from' });
    expect(whatsapp.sendText).not.toHaveBeenCalled();
  });
});
