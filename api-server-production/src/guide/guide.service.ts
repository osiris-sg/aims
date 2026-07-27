import { Injectable, Logger } from '@nestjs/common';
import Anthropic from '@anthropic-ai/sdk';
import { APP_KNOWLEDGE } from './app-knowledge';

// ---------------------------------------------------------------------------
// In-app guide assistant ("AIMS Guide"). Powers the floating bottom-right chat
// widget: the user asks "how do I create a delivery order?" and the assistant
// answers briefly AND emits UI actions the portal executes — navigate to a
// screen and/or start a step-by-step guided tour (spotlight popups).
//
// The frontend owns the tour definitions (selectors are a UI concern); each
// request carries the catalog of available guides + the org's enabled modules
// so the model only ever references things that actually exist for that org.
// ---------------------------------------------------------------------------

export type GuideAction =
  | { type: 'navigate'; path: string; label?: string }
  | { type: 'start_guide'; guideId: string }
  // A walkthrough the model composed itself (for questions with no prebuilt
  // guide). The frontend plays it through the same TourOverlay engine.
  | {
      type: 'custom_guide';
      guide: {
        title: string;
        steps: Array<{ route?: string; anchor?: string; title: string; body: string; advanceOnClick?: boolean }>;
      };
    };

export interface GuideChatContext {
  currentPath?: string;
  modules?: Array<{
    code: string;
    label: string;
    route: string;
    // path is the real navigation target (some submenus have href overrides
    // that differ from route/key — e.g. Accounting → Setup).
    subMenus?: Array<{ key: string; label: string; path?: string }>;
  }>;
  guides?: Array<{ id: string; title: string; description: string; route: string }>;
}

const MODEL = 'claude-opus-5';
const MAX_ITERATIONS = 3; // answer + at most a couple of action rounds

// Modules guru marked as legacy (2026-07-27). Filtered out of the context
// server-side as well (defense in depth vs the frontend filter) so the
// assistant can never guide users into retired screens. Keep in sync with
// LEGACY_MODULES in portal GuideAssistant/guides.ts.
const LEGACY_MODULES = new Set<string>([
  'DOCUMENTS',
  'INVOICES',
  'PAYMENTS',
  'ASSETS',
  'USER_MANAGEMENT',
  'AUDIT',
  'ANALYTICS',
  'INTEGRATIONS',
]);

// Anchor vocabulary + access rules appended after the full APP_KNOWLEDGE
// (imported from ./app-knowledge — the compiled codebase survey).
const KNOWLEDGE_FOOTER = `
Spotlight anchors you may use in walkthrough steps (anchor field):
- "nav-<MODULECODE>" — a sidebar module item (e.g. nav-SALES, nav-ACCOUNTING)
- "nav-<MODULECODE>-<submenuKey>" — a sidebar submenu item (e.g. nav-SALES-delivery-orders, nav-ACCOUNTING-reports) — submenu keys are in the screen list
- "page-create-button" — the Create/New button on any list page
- "page-filter-button" — the Filter button on any list page (opens the filter drawer: status, dates, customer…)
- "page-search" — the search box on any list page
- "document-row-view" — the eye (view/open) icon on a document list row
- "bills-upload" — the bulk "Upload Bills" button on the Bills page (/portal/accounting/bills)
- "document-upload" — the "Upload <type>" button on any Sales document list page (upload existing PDFs/images/ZIP for AI extraction)
- On the Finance Hub (/portal/accounting): "finance-ask-ai" (Ask AI button), "new-journal-entry", "close-period"
- "bankrec-upload" — the "Upload PDF statement" button on Bank Reconciliation
- Inside the document editor only: "editor-customer" (customer field), "editor-add-item" (Add Item button), "editor-confirm" (Confirm button), "editor-send-email" (Send Email button — invoices/quotations), "editor-save" (Save button), "editor-preview" (Preview/Edit toggle), "editor-more-menu" (the ⋮ more-actions menu — Print/PDF, Duplicate, Create Revision, History & notes live in it), "editor-ask-ai" (Ask AI button)
Steps whose anchor can't be found on screen show as a centered explanation card, so a step with no anchor is fine — use anchor-less steps for anything without a listed anchor.

Access control: the screen list in each request is already filtered to what THIS user and organization can access. If something (even something described above) is not in the screen list, do not navigate there or build steps for it — tell the user it isn't available to them and, if relevant, that an administrator's help is needed.`;

@Injectable()
export class GuideService {
  private readonly logger = new Logger(GuideService.name);

  // Streams SSE-style events to the widget:
  //   { type: 'text', delta }       — answer text chunk
  //   { type: 'action', action }    — navigate / start_guide for the UI to run
  //   { type: 'error', message } / { type: 'done' }
  async chatStream(
    question: string,
    history: Array<{ role: 'user' | 'assistant'; content: string }> | undefined,
    context: GuideChatContext | undefined,
    emit: (e: any) => void,
  ): Promise<void> {
    const apiKey = process.env.ANTHROPIC_API_KEY;
    if (!apiKey) {
      emit({ type: 'error', message: 'Guide assistant is not configured (missing ANTHROPIC_API_KEY)' });
      return;
    }
    const client = new Anthropic({ apiKey });
    const tools = this.buildTools();
    const system = this.buildSystemPrompt(context);
    const messages: Anthropic.MessageParam[] = [
      ...(history || []).slice(-12).map((m) => ({ role: m.role, content: m.content })),
      { role: 'user' as const, content: question },
    ];

    try {
      for (let iteration = 0; iteration < MAX_ITERATIONS; iteration++) {
        const stream = client.messages.stream({
          model: MODEL,
          max_tokens: 1024,
          // Navigation answers should be snappy — low effort keeps latency down.
          output_config: { effort: 'low' },
          system,
          tools,
          messages,
        } as any);
        stream.on('text', (delta) => emit({ type: 'text', delta }));
        const response = await stream.finalMessage();

        if (response.stop_reason === 'refusal') {
          emit({ type: 'error', message: 'The assistant declined to answer that. Try rephrasing your question.' });
          return;
        }

        const toolUseBlocks = response.content.filter((b) => b.type === 'tool_use');
        if (response.stop_reason !== 'tool_use' || toolUseBlocks.length === 0) break;

        messages.push({ role: 'assistant', content: response.content });
        const toolResults: Anthropic.ToolResultBlockParam[] = [];
        for (const block of toolUseBlocks) {
          const tu = block as Anthropic.ToolUseBlock;
          const action = this.toAction(tu.name, tu.input as any, context);
          if (action) {
            emit({ type: 'action', action });
            toolResults.push({ type: 'tool_result', tool_use_id: tu.id, content: 'ok — the UI is doing this now' });
          } else {
            toolResults.push({
              type: 'tool_result',
              tool_use_id: tu.id,
              content: 'Error: unknown route or guide id — only use paths/ids from the lists you were given',
              is_error: true,
            });
          }
        }
        messages.push({ role: 'user', content: toolResults });
      }
    } catch (e: any) {
      this.logger.error(`guide chatStream failed: ${e?.message || e}`);
      emit({ type: 'error', message: e?.message || 'Guide assistant failed' });
    } finally {
      emit({ type: 'done' });
    }
  }

  // System prompt is split into two blocks for prompt caching: the big static
  // part (persona + compiled app knowledge + rules) carries a cache_control
  // breakpoint, and the small per-request part (current page, this user's
  // screens and guides) comes after it so it never invalidates the cache.
  private buildSystemPrompt(context: GuideChatContext | undefined): Array<Record<string, any>> {
    const modules = (context?.modules || []).filter((m) => !LEGACY_MODULES.has(m.code));
    const guides = context?.guides || [];

    const moduleLines = modules
      .map((m) => {
        const subs = (m.subMenus || [])
          .map((s) => `    - ${s.label}: ${s.path || `${m.route}/${s.key}`} (anchor nav-${m.code}-${s.key})`)
          .join('\n');
        return `- ${m.label} (${m.code}): ${m.route}${subs ? `\n${subs}` : ''}`;
      })
      .join('\n');

    const guideLines = guides
      .map((g) => `- id: ${g.id} — "${g.title}" (lands on ${g.route}): ${g.description}`)
      .join('\n');

    const staticPart = `You are the AIMS Guide — an in-app assistant living in the bottom-right corner of the AIMS portal (Asset & Inventory Management System). You help users find their way around and learn how to do things, by TAKING THEM THERE, not just describing it.

${APP_KNOWLEDGE}
${KNOWLEDGE_FOOTER}

Rules:
- BE CONTEXT-AWARE: the user's current page is given below. If they are ALREADY on the relevant screen, do NOT navigate and do NOT make a "go to / open the page" step — start the walkthrough directly on the control (e.g. already on the invoice list and asking about filtering → step 1 anchors page-filter-button, not "open Invoices"). Only navigate when the answer lives on a DIFFERENT screen.
- "How do I …?" questions that match a prebuilt walkthrough → call start_guide with that guide's id, and reply with ONE short sentence like "Taking you there — just follow the highlighted steps."
- "How do I …?" questions with NO matching prebuilt walkthrough → compose one yourself with show_steps (2-6 steps) using the app knowledge above: navigate to the right screen on the first step, use the documented anchors where available, and put instructions the UI can't point at into anchor-less steps. Reply with one short sentence.
- "Where is …?" / "Show me …" questions → call navigate with the matching route, plus a one-sentence answer.
- Pure informational questions about AIMS ("can I…?", "what does X do?") → answer in 1-3 short sentences from the app knowledge; navigate too if a screen is clearly relevant.
- Accounting DATA questions (who owes me, P&L numbers, balances) → point the user to the Finance Hub's own Ask AI assistant and navigate to /portal/accounting.
- NEVER invent routes, guide ids, or anchors. Only use paths from the user's screen list / knowledge above, ids from the walkthrough list, and the documented anchors. If a feature isn't available for this organization or user, say so.
- Don't start a guide the user didn't ask about, and don't call the same tool twice in one turn.
- Keep every reply short and friendly. No markdown headers or long lists.
- If the question is unrelated to using AIMS (general chit-chat, maths, world facts), politely say you can only help with using AIMS.`;

    const dynamicPart = `The user is CURRENTLY ON: ${context?.currentPath || '(unknown page)'} — they are already looking at this page, so never tell them to open it or add a step that navigates to it.

Screens available to THIS user in THIS organization (module: route):
${moduleLines || '(none provided — answer from general AIMS knowledge, do not navigate)'}

Prebuilt walkthroughs available to this user (start_guide ids):
${guideLines || '(none available)'}`;

    return [
      { type: 'text', text: staticPart, cache_control: { type: 'ephemeral' } },
      { type: 'text', text: dynamicPart },
    ];
  }

  private buildTools(): Anthropic.Tool[] {
    return [
      {
        name: 'navigate',
        description:
          'Navigate the user to a screen in the portal. Use ONLY paths from the screen list in your instructions.',
        input_schema: {
          type: 'object',
          properties: {
            path: { type: 'string', description: 'Route path, e.g. /portal/sales/delivery-orders' },
            label: { type: 'string', description: 'Human name of the screen, e.g. "Delivery Orders"' },
          },
          required: ['path'],
        },
      },
      {
        name: 'start_guide',
        description:
          'Start a prebuilt guided walkthrough. It navigates the user to the right screen and shows popup explanations. Use ONLY ids from the walkthrough list.',
        input_schema: {
          type: 'object',
          properties: {
            guideId: { type: 'string', description: 'Guide id from the walkthrough list' },
          },
          required: ['guideId'],
        },
      },
      {
        name: 'show_steps',
        description:
          'Compose and run a custom step-by-step walkthrough when no prebuilt guide matches. Each step can navigate to a route and spotlight one of the documented anchors; steps without an anchor show as a centered explanation card. Use 2-6 steps.',
        input_schema: {
          type: 'object',
          properties: {
            title: { type: 'string', description: 'Short walkthrough title, e.g. "Invite a user"' },
            steps: {
              type: 'array',
              items: {
                type: 'object',
                properties: {
                  route: { type: 'string', description: 'Optional /portal… route to navigate to for this step' },
                  anchor: {
                    type: 'string',
                    description:
                      'Optional anchor token from the documented list, e.g. nav-CUSTOMERS, nav-SALES-invoices, page-create-button, editor-confirm',
                  },
                  title: { type: 'string' },
                  body: { type: 'string', description: '1-3 sentences telling the user what to do here' },
                  advanceOnClick: {
                    type: 'boolean',
                    description: 'true when the user should CLICK the highlighted element to continue (e.g. a create button)',
                  },
                },
                required: ['title', 'body'],
              },
            },
          },
          required: ['title', 'steps'],
        },
      },
    ];
  }

  // Validate tool inputs against the request context so the model can't send
  // the UI somewhere that doesn't exist.
  private toAction(name: string, input: any, context: GuideChatContext | undefined): GuideAction | null {
    if (name === 'navigate') {
      const path = String(input?.path || '');
      if (!path.startsWith('/portal')) return null;
      return { type: 'navigate', path, label: input?.label };
    }
    if (name === 'start_guide') {
      const guideId = String(input?.guideId || '');
      const known = (context?.guides || []).some((g) => g.id === guideId);
      if (!known) return null;
      return { type: 'start_guide', guideId };
    }
    if (name === 'show_steps') {
      const title = String(input?.title || '').slice(0, 80);
      const rawSteps = Array.isArray(input?.steps) ? input.steps.slice(0, 8) : [];
      const steps = rawSteps
        .map((s: any) => {
          const route = typeof s?.route === 'string' && s.route.startsWith('/portal') ? s.route : undefined;
          const anchor =
            typeof s?.anchor === 'string' && /^[A-Za-z0-9_-]{1,64}$/.test(s.anchor) ? s.anchor : undefined;
          const stepTitle = String(s?.title || '').slice(0, 120);
          const body = String(s?.body || '').slice(0, 600);
          if (!stepTitle || !body) return null;
          return { route, anchor, title: stepTitle, body, advanceOnClick: s?.advanceOnClick === true };
        })
        .filter(Boolean) as Array<{ route?: string; anchor?: string; title: string; body: string; advanceOnClick?: boolean }>;
      if (!title || steps.length === 0) return null;
      return { type: 'custom_guide', guide: { title, steps } };
    }
    return null;
  }
}
