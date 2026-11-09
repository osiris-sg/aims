import { DEMO_URL, HERO } from "../_content/site";
import { Desk } from "./Desk";

const delay = (s: number) => ({ "--d": `${s}s` }) as React.CSSProperties;

/** The hero: a short claim on the left, the flow on the right. The flow is
 *  the explanation; the copy only names it. */
export function Hero() {
  return (
    <section id="top" className="desk-hero">
      <div className="wrap desk-grid">
        <div className="desk-copy">
          <p className="eyebrow hero-fade" style={delay(0.05)}>{HERO.eyebrow}</p>
          <h1 className="h1 h1-hero hero-fade" style={delay(0.15)}>
            {HERO.title[0]}<br />{HERO.title[1]}
          </h1>
          <p className="hero-body hero-fade" style={delay(0.3)}>{HERO.body}</p>
          <div className="hero-cta hero-fade" style={delay(0.45)}>
            <a className="btn btn-primary" href={DEMO_URL}>Book a demo</a>
            <a className="btn btn-ghost" href="#agent">How the agent works</a>
          </div>
        </div>
        <div className="hero-fade" style={delay(0.35)}>
          <Desk />
        </div>
      </div>
    </section>
  );
}
