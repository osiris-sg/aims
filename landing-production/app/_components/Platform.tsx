import { PLATFORM } from "../_content/site";
import { Screenshot } from "./Screenshot";

/** What sits behind the paper: a two-column list and one still of the portal. */
export function Platform() {
  return (
    <section id="platform" className="section-plain section-rule">
      <div className="wrap section platform-stack">
        <div className="section-head" data-reveal>
          <p className="eyebrow">{PLATFORM.eyebrow}</p>
          <h2 className="h2">{PLATFORM.title}</h2>
        </div>
        <ul className="platform-list" data-reveal>
          {PLATFORM.items.map((it) => (
            <li key={it.title}>
              <strong>{it.title}</strong>
              <p>{it.body}</p>
            </li>
          ))}
        </ul>
        <div className="platform-shot" data-reveal>
          <Screenshot id="dashboard" />
        </div>
      </div>
    </section>
  );
}
