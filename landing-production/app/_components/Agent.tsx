import { AGENT } from "../_content/site";
import { CheckIcon, ClockIcon, LayersIcon, LockIcon } from "./Icons";

const G_ICONS = {
  lock: <LockIcon />,
  check: <CheckIcon size={16} />,
  clock: <ClockIcon />,
  layers: <LayersIcon />,
};

export function Agent() {
  return (
    <section id="agent" className="section-grey">
      <div className="wrap section agent-stack">
        <div className="section-head">
          <span className="eyebrow">{AGENT.eyebrow}</span>
          <h2 id="how" className="h2">{AGENT.title}</h2>
          <p className="lede">{AGENT.body}</p>
        </div>
        <div className="steps">
          {AGENT.steps.map((s) => (
            <article key={s.n} className="card step">
              <span className="step-n mono">{s.n}</span>
              <h3 className="step-title">{s.title}</h3>
              <p className="step-body">{s.body}</p>
            </article>
          ))}
        </div>
        <div className="guarantees">
          {AGENT.guarantees.map((g) => (
            <span key={g.text}>{G_ICONS[g.icon]}{g.text}</span>
          ))}
        </div>
      </div>
    </section>
  );
}
