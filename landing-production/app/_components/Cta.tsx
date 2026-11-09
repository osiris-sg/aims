import { CTA, DEMO_URL, TAGLINE, WHATSAPP_URL } from "../_content/site";
import { LogoMark } from "./Logo";

/** Closing band, shared by every page. Flat ink, no picture. */
export function Cta() {
  return (
    <section id="pricing" className="cta-x">
      <div id="book-a-demo" className="wrap cta-x-inner">
        <div className="cta-copy">
          <p className="eyebrow eyebrow-dark" data-reveal>{CTA.eyebrow}</p>
          <h2 className="cta-title" data-reveal style={{ "--d": "0.06s" } as React.CSSProperties}>{CTA.title}</h2>
          <p className="cta-body" data-reveal style={{ "--d": "0.12s" } as React.CSSProperties}>{CTA.body}</p>
          <div className="cta-actions" data-reveal style={{ "--d": "0.18s" } as React.CSSProperties}>
            <a className="btn btn-accent btn-lg" href={DEMO_URL}>Book a demo</a>
            {WHATSAPP_URL ? (
              <a className="btn btn-outline-dark btn-lg" href={WHATSAPP_URL} target="_blank" rel="noopener noreferrer">Message the agent on WhatsApp</a>
            ) : null}
          </div>
        </div>
        <div className="cta-aside" data-reveal style={{ "--d": "0.2s" } as React.CSSProperties}>
          <b>Osiris Technology Pte. Ltd.</b><br />
          Singapore<br />
          <a href="mailto:admin@osiris.sg" style={{ color: "inherit" }}>admin@osiris.sg</a><br />
          <span className="cta-tagline" style={{ marginTop: 14 }}><LogoMark size={14} onDark />{TAGLINE}</span>
        </div>
      </div>
    </section>
  );
}
