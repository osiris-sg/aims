"use client";

import { useEffect, useRef } from "react";
import { CHAT } from "../_content/site";
import { SendIcon } from "./Icons";
import { LogoMark } from "./Logo";

/** The sample conversation in a phone. With `shown`, only the first `shown`
 *  turns are rendered and the thread scrolls to keep the newest in view; the
 *  Confirm button on the draft card reads as pressed once the "sent" turn is
 *  in. Without `shown`, the whole thread is shown at once. */
export function ChatMock({ shown, fixed = false }: { shown?: number; fixed?: boolean } = {}) {
  const body = useRef<HTMLDivElement>(null);
  const count = shown ?? CHAT.length;
  const sentIn = CHAT.findIndex((t) => t.from === "aims" && t.sent) < count;

  useEffect(() => {
    const el = body.current;
    if (!el) return;
    el.scrollTo({ top: el.scrollHeight, behavior: "smooth" });
  }, [count]);

  return (
    <div className="phone-wrap">
      <div className={`phone${fixed ? " phone-fixed" : ""}`} role="img" aria-label="Sample conversation with the AIMS agent on WhatsApp">
        <div className="phone-screen">
          <div className="chat-head">
            <span className="chat-avatar"><LogoMark size={16} onDark /></span>
            <div>
              <div className="chat-head-name">AIMS Operator</div>
              <div className="chat-head-status">online · Osiris Technology</div>
            </div>
          </div>
          <div className="chat-body" ref={body}>
            {CHAT.slice(0, count).map((t, i) =>
              t.from === "you" ? (
                <div key={i} className="bubble bubble-out">
                  {t.text}
                  <div className="stamp">{t.time}</div>
                </div>
              ) : t.card ? (
                <div key={i} className="bubble bubble-in bubble-card">
                  <span dangerouslySetInnerHTML={{ __html: t.html }} />
                  <div className="quote-lines mono">
                    {t.card.lines.map(([l, amt, meta]) => (
                      <div key={l} className="line3"><span>{l}</span><em>{meta}</em><span>{amt}</span></div>
                    ))}
                    <div className="total"><span>{t.card.total[0]}</span><span>{t.card.total[1]}</span></div>
                  </div>
                  <div className={`quote-actions${sentIn ? " is-done" : ""}`}>
                    <span className="primary">{sentIn ? t.card.done : t.card.action}</span>
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
