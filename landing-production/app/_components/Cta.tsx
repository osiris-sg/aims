import Image from "next/image";
import ctaPhoto from "../_assets/cta.jpg";
import { CTA, DEMO_URL, TAGLINE, WHATSAPP_URL } from "../_content/site";
import { ArrowIcon, ChatIcon } from "./Icons";
import { LogoMark } from "./Logo";

/** Dark closing band, shared by every page. */
export function Cta() {
  return (
    <section id="pricing" className="cta-x">
      <div className="cta-photo-wrap" aria-hidden="true">
        <Image className="cta-photo" src={ctaPhoto} alt="" fill sizes="(max-width: 860px) 100vw, 60vw" unoptimized />
      </div>
      <div className="cta-shade" aria-hidden="true" />
      <div id="book-a-demo" className="wrap cta-x-inner">
        <span className="eyebrow eyebrow-dark" data-reveal>{CTA.eyebrow}</span>
        <h2 className="cta-title" data-reveal style={{ "--d": "0.08s" } as React.CSSProperties}>{CTA.title}</h2>
        <p className="cta-body" data-reveal style={{ "--d": "0.16s" } as React.CSSProperties}>{CTA.body}</p>
        <p className="cta-tagline" data-reveal style={{ "--d": "0.24s" } as React.CSSProperties}>
          <LogoMark size={16} onDark />
          {TAGLINE}
        </p>
        <div className="cta-actions" data-reveal style={{ "--d": "0.32s" } as React.CSSProperties}>
          <a className="btn btn-accent btn-lg" href={DEMO_URL}>Book a demo <ArrowIcon /></a>
          {WHATSAPP_URL ? (
            <a className="btn btn-outline-dark btn-lg" href={WHATSAPP_URL} target="_blank" rel="noopener noreferrer">
              <ChatIcon />
              Message the agent on WhatsApp
            </a>
          ) : null}
        </div>
      </div>
    </section>
  );
}
