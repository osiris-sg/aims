import Image from "next/image";
import { CHAT, QUOTE_FILE, QUOTE_LINES, QUOTE_TOTAL } from "../_content/site";
import { FileIcon, SendIcon } from "./Icons";

/** Static rendering of a sample operator conversation — the hero's product shot. */
export function ChatMock() {
  return (
    <div className="phone-wrap">
      <div className="phone" role="img" aria-label="Sample conversation with the AIMS agent on WhatsApp">
        <div className="phone-screen">
          <div className="chat-head">
            <Image src="/aims-logo.png" alt="" width={32} height={32} />
            <div>
              <div className="chat-head-name">AIMS Operator</div>
              <div className="chat-head-status">online · Osiris Technology</div>
            </div>
          </div>
          <div className="chat-body">
            {CHAT.map((t, i) =>
              t.from === "you" ? (
                <div key={i} className="bubble bubble-out">
                  {t.text}
                  <div className="stamp">{t.time}</div>
                </div>
              ) : t.quote ? (
                <div key={i} className="bubble bubble-in bubble-card">
                  <span dangerouslySetInnerHTML={{ __html: t.html }} />
                  <div className="quote-lines mono">
                    {QUOTE_LINES.map((l) => (
                      <div key={l.label}><span>{l.label}</span><span>{l.amount}</span></div>
                    ))}
                    <div className="total"><span>{QUOTE_TOTAL.label}</span><span>{QUOTE_TOTAL.amount}</span></div>
                  </div>
                  <div className="quote-file"><FileIcon />{QUOTE_FILE}</div>
                  <div className="quote-actions">
                    <span className="primary">Confirm &amp; send</span>
                    <span className="secondary">Edit</span>
                  </div>
                </div>
              ) : (
                <div key={i} className="bubble bubble-in">
                  <span dangerouslySetInnerHTML={{ __html: t.html }} />
                  <div className="stamp">{t.time}</div>
                </div>
              ),
            )}
          </div>
          <div className="chat-input">
            <div className="chat-input-field">Message</div>
            <div className="chat-send"><SendIcon size={16} stroke="#ffffff" strokeWidth={2.2} /></div>
          </div>
        </div>
      </div>
    </div>
  );
}
