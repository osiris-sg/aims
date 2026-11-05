import fs from "fs";
import path from "path";
import { PLATFORM } from "../_content/site";
import { BuildingIcon, FileTextIcon, InboxIcon, LayersIcon, PhoneIcon, SwapIcon } from "./Icons";

const ICONS = {
  file: <FileTextIcon />,
  phone: <PhoneIcon />,
  inbox: <InboxIcon />,
  layers: <LayersIcon size={20} strokeWidth={1.8} />,
  building: <BuildingIcon />,
  swap: <SwapIcon />,
};

/** What sits behind the chat. Plays the portal recording at
 *  public/media/hero-demo.mp4 when the file is there. */
export function Platform() {
  const video = fs.existsSync(path.join(process.cwd(), "public", "media", "hero-demo.mp4"));
  return (
    <section id="platform" className="section-grey">
      <div className="wrap section platform-stack">
        <div className="section-head" data-reveal>
          <span className="eyebrow">{PLATFORM.eyebrow}</span>
          <h2 className="h2">{PLATFORM.title}</h2>
        </div>
        {video ? (
          <figure className="shot shot-desktop platform-video" data-reveal>
            <div className="shot-chrome" aria-hidden="true"><span /><span /><span /></div>
            <div className="shot-body">
              <video autoPlay muted loop playsInline preload="metadata" src="/media/hero-demo.mp4" aria-label="Screen recording of the AIMS portal" />
            </div>
          </figure>
        ) : null}
        <div className="platform-grid">
          {PLATFORM.items.map((it, i) => (
            <div key={it.title} data-reveal style={{ "--d": `${(i % 3) * 0.08}s` } as React.CSSProperties}>
              <article className="card card-hover platform-card">
                <span className="tile">{ICONS[it.icon]}</span>
                <h3>{it.title}</h3>
                <p>{it.body}</p>
              </article>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}
