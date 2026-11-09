import Link from "next/link";
import { DEMO_URL, MODULES, BADGE_LABEL } from "../_content/site";
import { CheckIcon } from "./Icons";
import { Screenshot, hasScreen } from "./Screenshot";
import type { Feature } from "../_content/modules";

export function PageHero({ eyebrow, title, lede, screen, badge, children }: { eyebrow: string; title: string; lede: string; screen?: string; badge?: string; children?: React.ReactNode }) {
  return (
    <section className="wrap page-hero">
      <div className="page-hero-copy">
        <span className="eyebrow">{eyebrow}{badge ? <span className={`badge badge-${badge}`} style={{ marginLeft: 10 }}>{BADGE_LABEL[badge as keyof typeof BADGE_LABEL]}</span> : null}</span>
        <h1 className="h1 h1-page">{title}</h1>
        <p className="hero-body">{lede}</p>
        <div className="hero-cta">
          <a className="btn btn-primary" href={DEMO_URL}>Book a demo</a>
          {children}
        </div>
      </div>
      {hasScreen(screen) ? <div className="page-hero-shot"><Screenshot id={screen!} /></div> : null}
    </section>
  );
}

export function StatsStrip({ stats }: { stats: { value: string; label: string }[] }) {
  return (
    <section className="stats">
      <div className="wrap stats-inner">
        {stats.map((s) => (
          <div key={s.label} className="stat">
            <span className="stat-value">{s.value}</span>
            <span className="stat-label">{s.label}</span>
          </div>
        ))}
      </div>
    </section>
  );
}

export function FeatureRows({ features }: { features: Feature[] }) {
  return (
    <section className="wrap section feature-rows">
      {features.map((f, i) => { const shot = hasScreen(f.screen); return (
        <div key={f.title} className={`feature-row${i % 2 ? " feature-row-flip" : ""}${shot ? "" : " feature-row-text"}`}>
          <div className="feature-copy">
            <h2 className="feature-title">{f.title}</h2>
            <p className="feature-body">{f.body}</p>
            {f.bullets ? (
              <ul className="feature-bullets">
                {f.bullets.map((b) => <li key={b}><CheckIcon size={16} className="tick" strokeWidth={2.2} />{b}</li>)}
              </ul>
            ) : null}
          </div>
          {shot ? <div className="feature-shot"><Screenshot id={f.screen!} /></div> : null}
        </div>
      ); })}
    </section>
  );
}

export function PromptStrip({ prompts, title = "Ask the agent" }: { prompts: string[]; title?: string }) {
  return (
    <section className="section-grey">
      <div className="wrap section prompt-strip">
        <div className="section-head">
          <span className="eyebrow">{title}</span>
          <h2 className="h2">The same module, from WhatsApp or Telegram.</h2>
          <p className="lede">Everything above is one message away. Look-ups answer at once. Anything that commits waits for your Confirm.</p>
        </div>
        <div className="prompt-bubbles">
          {prompts.map((p) => <span key={p} className="prompt-bubble">{p}</span>)}
        </div>
        <Link className="btn btn-ghost" href="/agent">How the agent works</Link>
      </div>
    </section>
  );
}

export function MoreModules({ current }: { current?: string }) {
  const others = MODULES.filter((m) => m.key !== current);
  return (
    <section className="wrap section more-modules">
      <div className="section-head">
        <span className="eyebrow">{current ? "Other modules" : "Modules"}</span>
        <h2 className="h2">One system underneath, one agent in front.</h2>
      </div>
      <div className="more-grid">
        {others.map((m) => (
          <Link key={m.key} href={`/modules/${m.key}`} className="card card-hover more-card">
            <div className="module-top">
              <strong className="module-name">{m.name}</strong>
              {m.badge ? <span className={`badge badge-${m.badge}`}>{BADGE_LABEL[m.badge]}</span> : null}
            </div>
            <span className="module-body">{m.hero}</span>
            <span className="mono" style={{ fontSize: 11.5, color: "var(--faint)" }}>{m.papers}</span>
            <span className="module-link">Read about {m.name}</span>
          </Link>
        ))}
      </div>
    </section>
  );
}
