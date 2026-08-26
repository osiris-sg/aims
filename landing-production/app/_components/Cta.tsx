import { CTA, DEMO_URL, WHATSAPP_URL } from "../_content/site";
import { ArrowIcon } from "./Icons";

export function Cta() {
  return (
    <section id="pricing" className="cta">
      <div id="book-a-demo" className="wrap section cta-inner">
        <span className="eyebrow">{CTA.eyebrow}</span>
        <h2 className="cta-title">{CTA.title}</h2>
        <p className="cta-body">{CTA.body}</p>
        <div className="cta-actions">
          <a className="btn btn-light" href={DEMO_URL}>Book a demo <ArrowIcon /></a>
          {WHATSAPP_URL ? (
            <a className="btn btn-outline-dark" href={WHATSAPP_URL} target="_blank" rel="noopener noreferrer">
              Message the agent on WhatsApp
            </a>
          ) : null}
        </div>
      </div>
    </section>
  );
}
