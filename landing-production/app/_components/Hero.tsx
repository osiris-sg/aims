import fs from "fs";
import path from "path";
import { DEMO_URL, HERO } from "../_content/site";
import { ArrowIcon, ChatIcon } from "./Icons";
import { ChatMock } from "./ChatMock";
import { Screenshot } from "./Screenshot";
import { LogoStrip } from "./LogoStrip";

/** 1Password-style hero: dark band, centered headline, big rounded demo stage.
 *  Drop a screen recording at public/media/hero-demo.mp4 and it plays there;
 *  until then the stage runs the animated chat next to a live portal shot. */
export function Hero() {
  const video = fs.existsSync(path.join(process.cwd(), "public", "media", "hero-demo.mp4"));
  return (
    <section id="top" className="hero-dark">
      <div className="wrap hero-center">
        <span className="hero-pill"><ChatIcon size={14} stroke="#6ffbbe" />{HERO.eyebrow}</span>
        <h1 className="h1 hero-title">{HERO.title}</h1>
        <p className="hero-sub">{HERO.body}</p>
        <div className="hero-cta hero-cta-center">
          <a className="btn btn-light" href={DEMO_URL}>Book a demo <ArrowIcon /></a>
          <a className="btn btn-outline-dark" href="#agent">See the agent in action</a>
        </div>
      </div>
      <div className="wrap">
        <div className="hero-stage">
          {video ? (
            <video className="hero-video" autoPlay muted loop playsInline preload="metadata" src="/media/hero-demo.mp4" />
          ) : (
            <div className="hero-stage-inner">
              <div className="hero-stage-phone"><ChatMock animate /></div>
              <div className="hero-stage-shot"><Screenshot id="finance-hub" /></div>
            </div>
          )}
        </div>
      </div>
      <LogoStrip variant="dark" label="Move your books from" />
    </section>
  );
}
