import { DEMO_URL, HERO } from "../_content/site";
import { ArrowIcon, ChatIcon, CheckIcon } from "./Icons";
import { ChatMock } from "./ChatMock";

export function Hero() {
  return (
    <section id="top" className="wrap hero">
      <div className="hero-grid">
        <div className="hero-copy">
          <span className="eyebrow"><ChatIcon size={14} stroke="#00a572" />{HERO.eyebrow}</span>
          <h1 className="h1">{HERO.title}</h1>
          <p className="hero-body">{HERO.body}</p>
          <div className="hero-cta">
            <a className="btn btn-primary" href={DEMO_URL}>Book a demo <ArrowIcon /></a>
            <a className="btn btn-ghost" href="#agent">See the agent in action</a>
          </div>
          <div className="hero-proofs">
            {HERO.proofs.map((p) => (
              <span key={p}><CheckIcon stroke="#00a572" strokeWidth={2.2} />{p}</span>
            ))}
          </div>
        </div>
        <ChatMock />
      </div>
    </section>
  );
}
