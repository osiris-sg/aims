// Channel-agnostic contracts for the AIMS Operator. The agent core only ever
// speaks these types — every Telegram/WhatsApp specific lives in an adapter, so
// adding a channel is a new adapter, not a change to the brain.

export type OperatorChannel = 'telegram' | 'whatsapp';

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
  kind:
    | 'confirm_quotation'
    | 'confirm_invoice'
    | 'record_payment'
    | 'post_bill'
    | 'email_document'
    | 'add_project_cost';
  documentId?: string;
  documentType?: string;
  summary: string;
  args?: Record<string, any>;
  createdAt: string;
}

export interface SessionState {
  history: Array<{ role: 'user' | 'assistant'; content: any }>;
  pendingAction?: PendingAction | null;
  /** An uploaded invoice awaiting a project pick (tapped from buttons). */
  pendingUpload?: OperatorContext['upload'] | null;
}
