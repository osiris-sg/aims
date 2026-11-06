/**
 * Round BM — AIMEE refused for orgs without enableAimsChat (platform admins pass), token usage counted per org / user /
 * day in the DB and shown to platform admins only, the walkthrough tool for every AIMEE org, and the shipments
 * "answer first, suggest the action" rule.
 */
import { ForbiddenException } from '@nestjs/common';
import { OperatorWebController } from './operator-web.controller';
import { AiUsageService, usageIncrement, usageSummary } from './ai-usage.service';
import { AiUsageController } from './ai-usage.controller';
import { OperatorToolsService } from './operator-tools.service';
import { OperatorContext } from './operator.types';
import { shipmentsSystemPrompt } from './shipments-agent.rules';
import { shipmentsWebPrompt } from './shipments-web';

function controller(flag: boolean | undefined) {
  const operator: any = {
    patchThreadMeta: jest.fn(async () => undefined),
    handleInbound: jest.fn(async () => undefined),
    readThread: jest.fn(async () => ({ state: { pendingActions: [], transcript: [] } })),
    suggestTitle: jest.fn(async () => 't'),
  };
  const auth: any = {
    contextForWeb: jest.fn(async () => ({ organizationId: 'org', organizationName: 'Org', clerkUserId: 'u1', actor: { id: 'u1' }, roles: [], isOsirisAdmin: false, channel: 'web', channelUserId: 'u1' })),
    whatsappChatIdsForUser: jest.fn(async () => []),
  };
  const prisma: any = {
    organizationUIConfig: { findUnique: jest.fn(async () => (flag === undefined ? null : { features: { enableAimsChat: flag } })) },
    operatorSession: { findUnique: jest.fn(async () => ({ state: { title: 'x' } })), findMany: jest.fn(async () => []), delete: jest.fn(async () => ({})) },
    organizationMemberProfile: { findFirst: jest.fn(async () => null) },
    document: { findFirst: jest.fn(async () => null) },
  };
  const c = new OperatorWebController(operator, auth, { open: jest.fn(), close: jest.fn() } as any, prisma, {} as any);
  const res: any = { setHeader: jest.fn(), flushHeaders: jest.fn(), write: jest.fn(), end: jest.fn() };
  const req = (admin = false): any => ({ user: { id: 'u1', firstName: 'A' }, userOrganization: { id: 'org', name: 'Org' }, isOsirisAdmin: admin, on: jest.fn() });
  return { c, res, req, operator, prisma };
}

describe('AIMEE API — only for orgs with enableAimsChat', () => {
  it.each([false, undefined])('flag %p: every /operator/web endpoint answers 403 and nothing runs', async (flag) => {
    const { c, res, req, operator, prisma } = controller(flag);
    await expect(c.message(req(), { text: 'hi' }, res)).rejects.toBeInstanceOf(ForbiddenException);
    expect(res.setHeader).not.toHaveBeenCalled();
    expect(operator.handleInbound).not.toHaveBeenCalled();
    await expect(c.threads(req())).rejects.toBeInstanceOf(ForbiddenException);
    await expect(c.thread(req(), 'w:abc')).rejects.toBeInstanceOf(ForbiddenException);
    await expect(c.rename(req(), 'w:abc', { title: 'x' })).rejects.toBeInstanceOf(ForbiddenException);
    await expect(c.remove(req(), 'w:abc')).rejects.toBeInstanceOf(ForbiddenException);
    await expect(c.preview(req(), 'd1')).rejects.toBeInstanceOf(ForbiddenException);
    expect(prisma.operatorSession.delete).not.toHaveBeenCalled();
  });

  it('flag on: works as before (the message runs, threads list)', async () => {
    const { c, res, req, operator } = controller(true);
    await c.message(req(), { text: 'hi' }, res);
    expect(operator.handleInbound).toHaveBeenCalled();
    await expect(c.threads(req())).resolves.toEqual({ threads: [] });
  });

  it('platform admins pass whatever the flag (as today)', async () => {
    const { c, res, req, operator } = controller(false);
    await c.message(req(true), { text: 'hi' }, res);
    expect(operator.handleInbound).toHaveBeenCalled();
  });
});

describe('AIMEE token usage', () => {
  it('counts one call: missing numbers are 0', () => {
    expect(usageIncrement({ input_tokens: 1200, output_tokens: 300, cache_read_input_tokens: 9000 })).toEqual({ requests: 1, inputTokens: 1200, outputTokens: 300, cacheWriteTokens: 0, cacheReadTokens: 9000 });
    expect(usageIncrement(null)).toEqual({ requests: 1, inputTokens: 0, outputTokens: 0, cacheWriteTokens: 0, cacheReadTokens: 0 });
  });

  it('record upserts one row per org / user / UTC day / channel / model and increments; a DB error never throws', async () => {
    const upsert = jest.fn(async () => ({}));
    const svc = new AiUsageService({ aiUsageDaily: { upsert } } as any);
    await svc.record({ organizationId: 'org', userId: 'u1', userName: 'Sayaka', channel: 'web', model: 'claude-opus-4-8', usage: { input_tokens: 10, output_tokens: 5 } });
    const arg: any = (upsert.mock.calls[0] as any)[0];
    expect(arg.where.organizationId_userId_day_channel_model).toEqual({ organizationId: 'org', userId: 'u1', day: new Date().toISOString().slice(0, 10), channel: 'web', model: 'claude-opus-4-8' });
    expect(arg.update.inputTokens).toEqual({ increment: 10 });
    expect(arg.create).toEqual(expect.objectContaining({ userName: 'Sayaka', requests: 1, outputTokens: 5 }));
    const broken = new AiUsageService({ aiUsageDaily: { upsert: jest.fn(async () => Promise.reject(new Error('down'))) } } as any);
    await expect(broken.record({ organizationId: 'org', channel: 'web', model: 'm', usage: {} })).resolves.toBeUndefined();
  });

  it('the summary adds up per org and user, largest org first', () => {
    const row = (o: string, u: string, n: number, ch = 'web') => ({ organizationId: o, userId: u, userName: u.toUpperCase(), channel: ch, model: 'm', requests: 1, inputTokens: n, outputTokens: 1, cacheWriteTokens: 0, cacheReadTokens: 0 });
    const s = usageSummary([row('adh', 's', 10), row('adh', 's', 5, 'whatsapp'), row('adh', 't', 1), row('wct', 'x', 100)], new Map([['adh', 'ADH'], ['wct', 'WCT']]));
    expect(s.orgs.map((o) => [o.name, o.totalTokens])).toEqual([['WCT', 101], ['ADH', 19]]);
    expect(s.orgs[1].users[0]).toEqual(expect.objectContaining({ name: 'S', requests: 2, inputTokens: 15, channels: ['web', 'whatsapp'] }));
    expect(s.total.totalTokens).toBe(120);
  });

  it('the Admin usage endpoint is for platform admins only', async () => {
    const usage: any = { summary: jest.fn(async (d: number) => ({ days: d })) };
    const c = new AiUsageController(usage);
    await expect(c.summary({ isOsirisAdmin: false }, '7')).rejects.toBeInstanceOf(ForbiddenException);
    await expect(c.summary({ isOsirisAdmin: true }, '500')).resolves.toEqual({ days: 90 });
  });
});

describe('Walkthroughs for every AIMEE org', () => {
  const ctx = (guides: Array<{ id: string; title: string }>, channel: 'web' | 'whatsapp' = 'web'): OperatorContext => ({
    organizationId: 'wct',
    organizationName: 'WCT',
    clerkUserId: 'u1',
    actor: { id: 'u1' },
    roles: [],
    isOsirisAdmin: false,
    channel,
    channelUserId: 'u1',
    web: { screens: [], aimee: { page: null, scope: null, guides } },
  });
  const svc = () => {
    const s = Object.create(OperatorToolsService.prototype) as OperatorToolsService;
    (s as any).auth = { hasPermission: () => true };
    (s as any).logger = { error() {}, warn() {}, log() {} };
    return s;
  };

  it('start_walkthrough starts only a walkthrough the portal listed, as a guide event; web only', async () => {
    const g = [{ id: 'create-delivery-order', title: 'Create a delivery order' }];
    const ok = await svc().execute(ctx(g), 'start_walkthrough', { guideId: 'create-delivery-order' });
    expect(ok.ui).toEqual({ type: 'guide', guideId: 'create-delivery-order', title: 'Create a delivery order' });
    const bad = await svc().execute(ctx(g), 'start_walkthrough', { guideId: 'trade-email-inbox' });
    expect(bad.ui).toBeUndefined();
    expect(svc().definitions(ctx(g)).some((t) => t.name === 'start_walkthrough')).toBe(true);
    expect(svc().definitions(ctx(g, 'whatsapp')).some((t) => t.name === 'start_walkthrough')).toBe(false);
  });
});

describe('Shipments profile: answer first, the action as a suggestion', () => {
  it('both channels carry rule 3b; the web drafts rule points to it', () => {
    const p = shipmentsSystemPrompt({ actorName: 'S', orgName: 'ADH', now: new Date('2026-11-07T00:00:00Z'), lang: 'en', perms: 'shipments:read' });
    expect(p).toMatch(/3b\. QUESTIONS GET ANSWERS, NOT CARDS/);
    expect(p).toMatch(/Want me to link it to #25-1\?/);
    expect(shipmentsWebPrompt('en')).toMatch(/A question is answered first \(rule 3b\)/);
  });
});
