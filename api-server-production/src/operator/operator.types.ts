// Channel-agnostic contracts for the AIMS Operator. The agent core only ever
// speaks these types — every Telegram/WhatsApp specific lives in an adapter, so
// adding a channel is a new adapter, not a change to the brain.

export type OperatorChannel = 'telegram' | 'whatsapp' | 'web';

/** One rendered line of a conversation, kept for display (the model's
 *  `history` is trimmed and full of tool blocks, so it cannot be shown). The
 *  web chat reads this to show a thread, including the user's WhatsApp one. */
export interface TranscriptItem {
  id: string;
  at: string;
  role: 'user' | 'assistant';
  kind: 'text' | 'document' | 'buttons' | 'list';
  text?: string;
  url?: string;
  filename?: string;
  documentId?: string;
  buttons?: ChannelButton[];
  /** Which channel produced it: a WhatsApp thread continued on the web mixes both. */
  via: OperatorChannel;
}

/** Web-only presentation events (the chat home's side panel and navigation). */
export type WebUiEvent =
  | { type: 'document'; documentId: string; fresh?: boolean }
  | { type: 'screen'; path: string; title?: string }
  | {
      type: 'view';
      title: string;
      stats?: Array<{ label: string; value: string }>;
      columns?: string[];
      rows?: Array<Array<string | number | null>>;
      note?: string;
    };

export interface InboundMessage {
  channel: OperatorChannel;
  channelUserId: string; // Telegram numeric id (as string) | WhatsApp phone digits
  chatId: string; // where replies go
  text: string;
  displayName?: string;
  /** Payload from a tapped button, e.g. 'confirm:<documentId>'. */
  callbackData?: string;
  /** Provider id used to acknowledge a button tap (Telegram callback_query.id). */
  callbackId?: string;
  /** WhatsApp only: the business phoneNumberId that received this message —
   *  replies route back out through it. */
  businessPhoneNumberId?: string;
  /** Provider id of THIS inbound message (WhatsApp wamid) — used to flash a
   *  typing indicator against it. */
  providerMessageId?: string;
  /** An uploaded file (photo/PDF) the user sent, already downloaded by the
   *  channel. dataUri is `data:<mime>;base64,<...>`. */
  attachment?: { dataUri: string; mimetype: string; filename?: string };
  /** Several files in one message (web composer). The first one is also
   *  mirrored into `attachment` so single-file readers keep working. */
  attachments?: Array<{ dataUri: string; mimetype: string; filename?: string }>;
  /** Round X: set once the org's profile is known to be shipments — every outbound text / button label is sent without emojis. */
  plain?: boolean;
  /** True when `text` came from transcribing a voice note — the operator echoes
   *  what it heard so the user can catch a mis-transcription. */
  fromVoice?: boolean;
  /** Which stored conversation this message belongs to, when it is not the
   *  sender's own channel thread: the web chat continuing a WhatsApp thread
   *  replies on the web but reads and writes the WhatsApp session. */
  session?: { channel: OperatorChannel; channelUserId: string };
  /** Web only: identity already resolved from the Clerk session + active org,
   *  so the channel-identity lookup is skipped. */
  presetCtx?: OperatorContext;
}

export interface ChannelButton {
  label: string;
  data: string;
}

export interface ChannelAdapter {
  readonly channel: OperatorChannel;
  /** Normalise a provider webhook body; null = nothing actionable. */
  parse(body: any): InboundMessage | null;
  sendText(chatId: string, text: string): Promise<void>;
  /** `documentId` is the AIMS document the file renders (when it is one), so
   *  the web transcript can open it in the side panel later. */
  sendDocument(chatId: string, url: string, filename: string, caption?: string, documentId?: string): Promise<void>;
  sendButtons(chatId: string, text: string, buttons: ChannelButton[]): Promise<void>;
  /** A tappable list (up to 10 rows) — for choices too many for buttons. Each
   *  row's `id` behaves exactly like a button's `data` when tapped. */
  sendList?(
    chatId: string,
    text: string,
    buttonLabel: string,
    rows: Array<{ id: string; title: string; description?: string }>,
  ): Promise<void>;
  /** Stop the client-side spinner on a tapped button (no-op where unsupported). */
  answerCallback?(callbackId: string, text?: string): Promise<void>;
  /** Live-progress affordances. Optional so a channel can omit them. */
  sendTyping?(chatId: string): Promise<void>;
  sendStatus?(chatId: string, text: string): Promise<string | null>;
  editStatus?(chatId: string, messageId: string, text: string): Promise<void>;
  deleteMessage?(chatId: string, messageId: string): Promise<void>;
  /** Web only: side-panel and navigation events. Chat apps have no equivalent. */
  sendUi?(chatId: string, event: WebUiEvent): Promise<void>;
}

/** Resolved identity + permissions for one inbound message. Threaded into every
 *  tool call — this is the security boundary. */
export interface OperatorContext {
  organizationId: string;
  organizationName: string;
  clerkUserId: string;
  actor: { id: string; name?: string; email?: string };
  /** Roles the user holds IN organizationId (already filtered). */
  roles: Array<{ name: string; permissions: Array<{ resource: string; action: string }> }>;
  isOsirisAdmin: boolean;
  /** Set while an admin is acting AS another user for troubleshooting. The
   *  context is that user's — their roles, their permissions, their blind
   *  spots — so a bug only they can see is reproducible. Kept alongside so
   *  every reply and every audit row can say who is really driving. */
  impersonating?: { byUserId: string; label: string } | null;
  channel: OperatorChannel;
  channelUserId: string;
  /** Round S (2026-10-21): a shipments org (SHIPMENTS module on) talks to the shipments tool set only. */
  profile?: 'shipments' | null;
  /** Web chat only: the dashboard screens this user's org + role can open,
   *  sent by the portal (the same filtered list its navigation shows). */
  web?: {
    screens: Array<{ label: string; path: string }>;
    /** What the side panel shows right now, so the model never assumes. */
    panel?: { type: 'document'; documentId: string } | { type: 'screen'; path: string } | { type: 'view'; title: string } | null;
  };
  /** Set for the turn in which the user uploaded a file: the extracted data and
   *  the stored original, so a tool called this turn can build a project cost. */
  upload?: {
    attachmentUrl: string | null;
    attachmentKey: string | null;
    filename?: string;
    extracted: {
      supplierName?: string | null;
      invoiceNo?: string | null;
      date?: string | null;
      amount?: number | null;
      description?: string | null;
      currency?: string | null;
      siteAddress?: string | null;
      /** The party the document is addressed to ("Bill To"). On a sales
       *  invoice the user forwards, this is the customer. */
      billTo?: string | null;
    };
    /** Raw line items + tax, for creating the linked Bill (AP) draft. */
    lines?: Array<{ description?: string; quantity?: number; unitPrice?: number; amount?: number }> | null;
    taxAmount?: number | null;
    /** What the file shows, in words (any image or PDF, not only invoices). */
    reading?: string | null;
  };
}

/** An action held awaiting the user's explicit confirmation. */
export interface PendingAction {
  /** The uploaded invoice this card is about — re-sent with the Confirm
   *  buttons so the user sees WHAT they are confirming (guru 2026-10-02). */
  attachment?: { url: string; filename: string } | null;
  /** Unique per card. The Confirm/Cancel buttons carry it, so a tap acts on the
   *  card it was shown under — not on whatever happens to be pending now. */
  id?: string;
  kind:
    | 'confirm_quotation'
    | 'confirm_invoice'
    | 'record_payment'
    | 'post_bill'
    | 'email_document'
    | 'add_project_cost'
    | 'edit_schedule'
    | 'import_price_list'
    | 'schedule_delivery'
    | 'api_write'
    | 'request_advance'
    | 'shipments';
  documentId?: string;
  documentType?: string;
  summary: string;
  args?: Record<string, any>;
  createdAt: string;
}

export interface SessionState {
  history: Array<{ role: 'user' | 'assistant'; content: any }>;
  pendingAction?: PendingAction | null;
  /** Recent held actions, newest last. Several cards can be on screen at once
   *  (the model can hold two in one turn), and a single slot meant the second
   *  silently replaced the first — so Cancel on the FIRST card killed the
   *  SECOND, and the first's Confirm then reported "expired". Bounded. */
  pendingActions?: PendingAction[];
  /** Acting as another user (osirisadmin only). Survives between messages so
   *  a whole troubleshooting session runs in their shoes. */
  actingAs?: { userId: string; label: string } | null;
  /** An uploaded invoice awaiting a project pick (tapped from buttons). */
  pendingUpload?: OperatorContext['upload'] | null;
  /** Round AF: the step of the WhatsApp answer flow for the last "needs your answer" push (shipments orgs). */
  answerFlow?: { logId: string; kind: string; step: 'what' | 'which'; at: string } | null;
  /** Bulk invoice mode (guru 2026-10-11): uploads queue straight to the portal
   *  mass-intake, no per-invoice confirm. Toggled by the bulk_invoice_mode tool. */
  bulkInvoiceMode?: boolean;
  pendingUploadAt?: string | null;
  /** Finished cards (confirmed/cancelled) — a re-tap on an old button answers
   *  honestly instead of "expired" or silently redoing the action. */
  doneActions?: Array<{ id: string; summary: string; result: 'confirmed' | 'cancelled' | 'failed'; at: string }>;
  /** Display copy of the conversation (bounded). Written only through
   *  OperatorService.appendTranscript, never by a whole-session save. */
  transcript?: TranscriptItem[];
  /** Web threads: the name shown in the chat list. */
  title?: string;
  /** Web threads: the org the thread was started in. */
  organizationId?: string;
  /** Web: the last side-panel event, restored when the chat is reopened. */
  lastPanel?: WebUiEvent | null;
}
