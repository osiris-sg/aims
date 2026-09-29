// Channel-agnostic contracts for the AIMS Operator. The agent core only ever
// speaks these types — every Telegram/WhatsApp specific lives in an adapter, so
// adding a channel is a new adapter, not a change to the brain.

// 'wa-web' = the whatsapp-web.js linked-device bridge (San): groups and DMs
// the Cloud API cannot reach. Replies travel back in the HTTP response.
export type OperatorChannel = 'telegram' | 'whatsapp' | 'wa-web';

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
  /** True when `text` came from transcribing a voice note — the operator echoes
   *  what it heard so the user can catch a mis-transcription. */
  fromVoice?: boolean;
  /** wa-web only: the org the bridge's token is bound to. The sender must be a
   *  member of it; the Operator never works in any other org on this channel. */
  boundOrgId?: string;
  /** wa-web only: a group chat (unlinked senders stay silent there). */
  isGroup?: boolean;
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
  sendDocument(chatId: string, url: string, filename: string, caption?: string): Promise<void>;
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
  channel: OperatorChannel;
  channelUserId: string;
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
    };
    /** Raw line items + tax, for creating the linked Bill (AP) draft. */
    lines?: Array<{ description?: string; quantity?: number; unitPrice?: number; amount?: number }> | null;
    taxAmount?: number | null;
  };
}

/** An action held awaiting the user's explicit confirmation. */
export interface PendingAction {
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
    // Any other writing tool: the call itself is held and only runs on Confirm.
    | 'tool_call'
    // A customer PO read from an upload → a SALES_ORDER, then linked to the
    // held delivery card or to a draft run.
    | 'create_sales_order'
    // An existing sales order → a draft run, which then becomes scheduled.
    | 'link_sales_order';
  documentId?: string;
  documentType?: string;
  summary: string;
  args?: Record<string, any>;
  createdAt: string;
  /** wa-web only: the 4-digit code the card ends with ("Reply confirm 4821"),
   *  and the chat it was shown in. Only the requester, only in that chat. */
  code?: string;
  chatId?: string;
}

export interface SessionState {
  history: Array<{ role: 'user' | 'assistant'; content: any }>;
  pendingAction?: PendingAction | null;
  /** Recent held actions, newest last. Several cards can be on screen at once
   *  (the model can hold two in one turn), and a single slot meant the second
   *  silently replaced the first — so Cancel on the FIRST card killed the
   *  SECOND, and the first's Confirm then reported "expired". Bounded. */
  pendingActions?: PendingAction[];
  /** An uploaded invoice awaiting a project pick (tapped from buttons). */
  pendingUpload?: OperatorContext['upload'] | null;
  /** Ids of cards already executed, newest last. A replayed "ok" or a second
   *  tap on the same card is refused against this list. Bounded. */
  doneIds?: string[];
  /** The last card that ran, so a bare second "ok" is answered, not re-read.
   *  Cleared as soon as the model takes another turn. */
  lastResult?: { id: string; at: number; message: string } | null;
  /** Draft runs this sender confirmed without a sales order, newest last: a PO
   *  or SO number that follows is linked to them. Bounded. */
  draftRuns?: Array<{ deliveryId: string; number: number | null; chatId: string; customerId: string | null; at: number }>;
}
