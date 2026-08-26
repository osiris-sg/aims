import type { ReactNode } from "react";
import { BADGE_LABEL, MODULES, type ModuleKey } from "../_content/site";
import { BoxIcon, ChartIcon, ChatIcon, PeopleIcon, ReceiptIcon } from "./Icons";
import { Screenshot } from "./Screenshot";

const ICONS: Record<ModuleKey, ReactNode> = {
  inventory: <BoxIcon />,
  hr: <PeopleIcon />,
  crm: <ChatIcon size={20} strokeWidth={1.8} />,
  accounting: <ChartIcon stroke="#a8c5f4" />,
  claims: <ReceiptIcon />,
};

export function Modules() {
  return (
    <section id="modules" className="wrap section">
      <div className="section-head" style={{ marginBottom: 44 }}>
        <span className="eyebrow">Five modules · one agent</span>
        <h2 className="h2">Every part of the business, reachable from the same conversation.</h2>
        <p className="lede">Turn modules on per company. Whatever is on, the agent can read it, draft in it, and — once you confirm — act in it.</p>
      </div>
      <div className="grid6">
        {MODULES.map((m) => (
          <article key={m.key} className={`card module span${m.span}${m.dark ? " module-dark" : ""}`}>
            <div className="module-top">
              <div className="module-icon">{ICONS[m.key]}</div>
              {m.badge ? <span className={`badge badge-${m.badge}`}>{BADGE_LABEL[m.badge]}</span> : null}
            </div>
            <div>
              <h3 className="module-name">{m.name}</h3>
              <p className="module-hero">{m.hero}</p>
              <p className="module-body">{m.body}</p>
            </div>
            <div className="prompts">
              {m.prompts.map((p) => <span key={p} className="prompt">{p}</span>)}
            </div>
            {m.screen ? <Screenshot id={m.screen} className="module-shot" /> : null}
          </article>
        ))}
      </div>
    </section>
  );
}
