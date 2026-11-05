import Image from "next/image";
import heroPhoto from "../_assets/hero.jpg";
import { DEMO_URL, HERO, HERO_CARD } from "../_content/site";
import { ArrowIcon, CheckCircleIcon, CheckIcon, PlayIcon } from "./Icons";
import { LogoMark } from "./Logo";

const delay = (s: number) => ({ "--d": `${s}s` }) as React.CSSProperties;

/** Split hero: the brand line on the left, a monochrome portrait on the right
 *  with one agent exchange floating over it, so the use case is visible at a glance. */
export function Hero() {
  return (
    <section id="top" className="hero-x">
      <div className="wrap hero-x-grid">
        <div className="hero-x-copy">
          <span className="pill hero-fade" style={delay(0.1)}>
            <LogoMark size={14} />
            {HERO.eyebrow}
          </span>
          <h1 className="h1 hero-x-title">
            <span className="line"><span style={delay(0.25)}>{HERO.title}</span></span>
            <span className="line"><span style={delay(0.4)}>{HERO.titleLead} <em>{HERO.titleAccent}</em></span></span>
          </h1>
          <p className="hero-body hero-fade" style={delay(0.65)}>{HERO.body}</p>
          <div className="hero-cta hero-fade" style={delay(0.8)}>
            <a className="btn btn-primary btn-lg" href={DEMO_URL}>Book a demo <ArrowIcon /></a>
            <a className="btn btn-ghost btn-lg btn-play" href="#in-action">
              <span className="play-dot"><PlayIcon /></span>
              See AIMS in action
            </a>
          </div>
          <div className="hero-proofs hero-fade" style={delay(0.95)}>
            {HERO.proofs.map((p) => (
              <span key={p}><CheckIcon className="tick" strokeWidth={2.2} />{p}</span>
            ))}
          </div>
        </div>

        <div className="hero-x-visual hero-rise" style={delay(0.35)}>
          <div className="photo-frame">
            <Image className="photo" src={heroPhoto} alt="A business owner at work while AIMS handles the admin" priority unoptimized />
          </div>
          <div className="float-card" role="img" aria-label={`Sample: you ask "${HERO_CARD.ask}". AIMS replies: ${HERO_CARD.reply}`}>
            <div className="float-card-head">
              <LogoMark size={16} />
              <span>{HERO_CARD.channel}</span>
            </div>
            <p className="float-ask">{HERO_CARD.ask}</p>
            <p className="float-reply">{HERO_CARD.reply}</p>
            <ul className="float-checks">
              {HERO_CARD.checks.map((c) => (
                <li key={c.module}>
                  <CheckCircleIcon size={14} className="tick" />
                  <span>{c.text}</span>
                  <em>{c.module}</em>
                </li>
              ))}
            </ul>
            <div className="float-status">
              <span><span className="pulse-dot" />{HERO_CARD.status}</span>
              <ArrowIcon size={14} />
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}
