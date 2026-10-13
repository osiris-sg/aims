import { Body, Controller, Delete, Get, Logger, Param, Patch, Post, Query, Req, Res } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import type { Response } from 'express';
import { PrismaService } from '../common/prisma.service';
import { DocumentsService } from '../documents/documents.service';
import { OperatorService } from './operator.service';
import { OperatorAuthService } from './operator-auth.service';
import { WebAdapter } from './adapters/web.adapter';
import { InboundMessage, OperatorChannel, TranscriptItem } from './operator.types';

interface WebRequest extends Request {
  user?: { id: string; firstName?: string | null; lastName?: string | null; emailAddresses?: Array<{ emailAddress: string }>; email?: string };
  userOrganization?: { id: string; name: string } | null;
  isOsirisAdmin?: boolean;
}

interface WebMessageBody {
  threadId?: string;
  text?: string;
  callbackData?: string;
  attachment?: { dataUri: string; mimetype: string; filename?: string };
  /** The dashboard screens this user can open (filtered by the portal). */
  screens?: Array<{ label: string; path: string }>;
  /** What the side panel shows at send time (null = closed). */
  panel?: { type: 'document'; documentId: string } | { type: 'screen'; path: string } | { type: 'view'; title: string } | null;
}

/** Thread ids as the portal sees them: `w:<short>` (a web chat) or `wa:<digits>`
 *  (the user's WhatsApp conversation, continued here). */
const WEB_PREFIX = 'w:';
const WA_PREFIX = 'wa:';

/**
 * The AIMS dashboard chat ("chat home"). Same brain as the WhatsApp operator,
 * identity from the Clerk session, replies streamed as Server-Sent Events.
 * Clerk-guarded by the global guard; no @Permissions, every role may chat
 * (what they can DO is decided per tool from their role).
 */
@ApiTags('operator')
@ApiBearerAuth()
@Controller('operator/web')
export class OperatorWebController {
  private readonly logger = new Logger(OperatorWebController.name);

  constructor(
    private readonly operator: OperatorService,
    private readonly auth: OperatorAuthService,
    private readonly web: WebAdapter,
    private readonly prisma: PrismaService,
    private readonly documents: DocumentsService,
  ) {}

  private actorOf(req: WebRequest) {
    const u = req.user!;
    const name = [u.firstName, u.lastName].filter(Boolean).join(' ') || undefined;
    const email = u.email || u.emailAddresses?.[0]?.emailAddress;
    return { name, email };
  }

  /** Map a portal thread id to the stored session, checking it is the caller's. */
  private async sessionFor(req: WebRequest, threadId: string): Promise<{ channel: OperatorChannel; channelUserId: string } | null> {
    const userId = req.user!.id;
    if (threadId.startsWith(WEB_PREFIX)) {
      return { channel: 'web', channelUserId: `${userId}:${threadId.slice(WEB_PREFIX.length)}` };
    }
    if (threadId.startsWith(WA_PREFIX)) {
      const digits = threadId.slice(WA_PREFIX.length);
      const mine = await this.auth.whatsappChatIdsForUser(userId, req.userOrganization?.id || '');
      if (!mine.includes(digits)) return null;
      return { channel: 'whatsapp', channelUserId: digits };
    }
    return null;
  }

  private newThreadId(): string {
    return `${WEB_PREFIX}${Date.now().toString(36)}${Math.random().toString(36).slice(2, 7)}`;
  }

  @Post('message')
  @ApiOperation({ summary: 'Dashboard chat: send a message, stream the reply (SSE)' })
  async message(@Req() req: WebRequest, @Body() body: WebMessageBody, @Res() res: Response): Promise<void> {
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache, no-transform');
    res.setHeader('Connection', 'keep-alive');
    res.setHeader('X-Accel-Buffering', 'no');
    res.flushHeaders?.();

    let closed = false;
    (req as any).on?.('close', () => {
      closed = true;
    });
    const emit = (e: any) => {
      if (closed) return;
      try {
        res.write(`data: ${JSON.stringify(e)}\n\n`);
      } catch {
        closed = true;
      }
    };

    const org = req.userOrganization;
    if (!org) {
      emit({ type: 'error', message: 'Your account is not assigned to an organization.' });
      res.end();
      return;
    }

    let threadId = (body.threadId || '').trim();
    let session = threadId ? await this.sessionFor(req, threadId) : null;
    if (threadId && !session) {
      emit({ type: 'error', message: 'That conversation is not yours or no longer exists.' });
      res.end();
      return;
    }
    if (!session) {
      threadId = this.newThreadId();
      session = { channel: 'web', channelUserId: `${req.user!.id}:${threadId.slice(WEB_PREFIX.length)}` };
      await this.operator.patchThreadMeta(session.channel, session.channelUserId, { organizationId: org.id });
    }
    emit({ type: 'thread', id: threadId });

    const ctx = await this.auth.contextForWeb(req.user!.id, org, this.actorOf(req), !!req.isOsirisAdmin);
    ctx.web = {
      screens: (body.screens || []).filter((s) => s && typeof s.path === 'string' && s.path.startsWith('/portal')).slice(0, 400),
      panel: body.panel && typeof body.panel === 'object' && typeof (body.panel as any).type === 'string' ? body.panel : null,
    };

    const chatId = `${session.channel}:${session.channelUserId}:${Date.now().toString(36)}`;
    this.web.open(chatId, emit);
    const text = (body.text || '').trim();
    const msg: InboundMessage = {
      channel: 'web',
      channelUserId: req.user!.id,
      chatId,
      text,
      displayName: ctx.actor.name,
      callbackData: body.callbackData || undefined,
      attachment: body.attachment?.dataUri ? body.attachment : undefined,
      session,
      presetCtx: ctx,
    };
    try {
      // The first line of a new chat names it, like every chat app.
      if (session.channel === 'web' && text && !body.callbackData) {
        const row = await this.prisma.operatorSession.findUnique({
          where: { channel_channelUserId: { channel: 'web', channelUserId: session.channelUserId } },
          select: { state: true },
        });
        if (!(row?.state as any)?.title) {
          await this.operator.patchThreadMeta('web', session.channelUserId, { title: text.replace(/\s+/g, ' ').slice(0, 60) });
        }
      }
      await this.operator.handleInbound(msg);
      // Anything held for confirmation after this turn, so the page can show it.
      const thread = await this.operator.readThread(session.channel, session.channelUserId);
      emit({ type: 'pending', actions: thread?.state.pendingActions || [] });
    } catch (e: any) {
      this.logger.error(`web chat failed: ${e?.message}`);
      emit({ type: 'error', message: 'Something went wrong on my side. Please send that again.' });
    } finally {
      this.web.close(chatId);
      emit({ type: 'done' });
      res.end();
    }
  }

  @Get('documents/:id/preview')
  @ApiOperation({ summary: 'Dashboard chat: side-panel preview of a document (PDF url + editor path)' })
  async preview(@Req() req: WebRequest, @Param('id') id: string, @Query('fresh') fresh?: string) {
    const org = req.userOrganization;
    if (!org) return { error: 'No organization' };
    const ctx = await this.auth.contextForWeb(req.user!.id, org, this.actorOf(req), !!req.isOsirisAdmin);
    if (!this.auth.hasPermission(ctx, ['documents:read'])) return { error: 'No permission to view documents' };
    const doc = await this.prisma.document.findFirst({
      where: { id, organizationId: org.id },
      select: { id: true, name: true, type: true, status: true, documentTemplateId: true, config: true, updatedAt: true },
    });
    if (!doc) return { error: 'Document not found' };
    const cfg: any = doc.config || {};
    let url: string | null = null;
    try {
      // The S3 copy is never invalidated on edit, so a document the chat just
      // changed is re-rendered (fresh=1); a plain view reuses the cached PDF.
      url = (await this.documents.getOrGeneratePdfUrl(doc.id, org.id, undefined, fresh === '1')) || null;
    } catch (e: any) {
      this.logger.warn(`preview pdf failed for ${doc.id}: ${e?.message}`);
    }
    return {
      id: doc.id,
      number: doc.name,
      type: doc.type,
      status: doc.status,
      customer: cfg.customerName || cfg.customer?.name || cfg.documentInfo?.customerName || null,
      total: cfg.nettTotal ?? cfg.documentInfo?.nettTotal ?? null,
      currency: cfg.currency || cfg.documentInfo?.currency || null,
      editorPath: `/portal/documents/${doc.type}/${doc.documentTemplateId}/${doc.id}`,
      pdfUrl: url,
      updatedAt: doc.updatedAt,
    };
  }

  @Get('threads')
  @ApiOperation({ summary: 'Dashboard chat: list my conversations (web + my WhatsApp thread)' })
  async threads(@Req() req: WebRequest) {
    const userId = req.user!.id;
    const orgId = req.userOrganization?.id || '';
    const [rows, waIds] = await Promise.all([
      this.prisma.operatorSession.findMany({
        where: { channel: 'web', channelUserId: { startsWith: `${userId}:` } },
        orderBy: { updatedAt: 'desc' },
        take: 100,
        select: { channelUserId: true, state: true, updatedAt: true, createdAt: true },
      }),
      this.auth.whatsappChatIdsForUser(userId, orgId),
    ]);
    const preview = (state: any): string => {
      const t: TranscriptItem[] = Array.isArray(state?.transcript) ? state.transcript : [];
      const last = [...t].reverse().find((i) => i.text);
      return (last?.text || '').replace(/\s+/g, ' ').slice(0, 90);
    };
    const web = rows
      // Only this org's chats: the admin org switcher must not mix orgs.
      .filter((r) => !(r.state as any)?.organizationId || (r.state as any).organizationId === orgId)
      .map((r) => ({
        id: `${WEB_PREFIX}${r.channelUserId.slice(userId.length + 1)}`,
        channel: 'web',
        title: (r.state as any)?.title || 'New chat',
        preview: preview(r.state),
        updatedAt: r.updatedAt,
        createdAt: r.createdAt,
      }));
    let whatsapp: any[] = [];
    if (waIds.length) {
      const wa = await this.prisma.operatorSession.findMany({
        where: { channel: 'whatsapp', channelUserId: { in: waIds } },
        select: { channelUserId: true, state: true, updatedAt: true, createdAt: true },
      });
      whatsapp = wa.map((r) => ({
        id: `${WA_PREFIX}${r.channelUserId}`,
        channel: 'whatsapp',
        title: 'WhatsApp',
        number: r.channelUserId,
        preview: preview(r.state),
        updatedAt: r.updatedAt,
        createdAt: r.createdAt,
      }));
    }
    return { threads: [...whatsapp, ...web] };
  }

  @Get('threads/:id')
  @ApiOperation({ summary: 'Dashboard chat: one conversation (display transcript + held confirmations)' })
  async thread(@Req() req: WebRequest, @Param('id') id: string) {
    const session = await this.sessionFor(req, id);
    if (!session) return { error: 'Not found' };
    const t = await this.operator.readThread(session.channel, session.channelUserId);
    if (!t) return { id, channel: session.channel, title: null, transcript: [], pendingActions: [], updatedAt: null };
    return {
      id,
      channel: session.channel,
      title: t.state.title || null,
      transcript: t.state.transcript || [],
      pendingActions: t.state.pendingActions || [],
      bulkInvoiceMode: !!t.state.bulkInvoiceMode,
      lastPanel: t.state.lastPanel || null,
      updatedAt: t.updatedAt,
    };
  }

  @Patch('threads/:id')
  @ApiOperation({ summary: 'Dashboard chat: rename a conversation' })
  async rename(@Req() req: WebRequest, @Param('id') id: string, @Body() body: { title?: string }) {
    const session = await this.sessionFor(req, id);
    if (!session || session.channel !== 'web') return { error: 'Not found' };
    const title = String(body?.title || '').trim().slice(0, 60);
    if (!title) return { error: 'Title required' };
    await this.operator.patchThreadMeta(session.channel, session.channelUserId, { title });
    return { ok: true, title };
  }

  @Delete('threads/:id')
  @ApiOperation({ summary: 'Dashboard chat: delete a web conversation' })
  async remove(@Req() req: WebRequest, @Param('id') id: string) {
    const session = await this.sessionFor(req, id);
    // The WhatsApp thread belongs to the phone; it cannot be deleted from here.
    if (!session || session.channel !== 'web') return { error: 'Not found' };
    await this.prisma.operatorSession
      .delete({ where: { channel_channelUserId: { channel: 'web', channelUserId: session.channelUserId } } })
      .catch(() => null);
    return { ok: true };
  }
}
