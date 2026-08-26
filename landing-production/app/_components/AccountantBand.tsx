import { ACCOUNTANT_BAND } from "../_content/site";
import { Screenshot } from "./Screenshot";

export function AccountantBand() {
  const b = ACCOUNTANT_BAND;
  return (
    <section id="accountant" className="wrap section acct-stack">
      <div className="section-head">
        <span className="eyebrow">{b.eyebrow}</span>
        <h2 className="h2">{b.title}</h2>
        <p className="lede">{b.body}</p>
      </div>
      <div className="acct-grid">
        {b.tiles.map((t) => (
          <article key={t.title} className="card acct-tile">
            <Screenshot id={t.screen} />
            <div className="acct-tile-copy">
              <h3 className="module-name">{t.title}</h3>
              <p className="module-body">{t.body}</p>
            </div>
          </article>
        ))}
      </div>
      <div className="card parity">
        <div className="parity-copy">
          <h3 className="module-name">{b.parity.title}</h3>
          <p className="module-body">{b.parity.body}</p>
        </div>
        <pre className="parity-term mono" aria-label="Sample reconciler output">{b.parity.sample.join("\n")}</pre>
      </div>
    </section>
  );
}
