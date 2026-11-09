"use client";

import { useState } from "react";
import Link from "next/link";
import { MODULES, MODULE_LINKS, type ModuleKey } from "../_content/site";

/** The modules as a list on the left and one entry on the right: what it does,
 *  what you would type, and which other modules it works with (as sentences,
 *  grouped by module, so the links read like prose). */
export function Modules() {
  const [active, setActive] = useState<ModuleKey>("crm");
  const m = MODULES.find((x) => x.key === active)!;

  // Group the links by the other module, in MODULES order.
  const related = MODULES.filter((x) => x.key !== active)
    .map((x) => ({
      key: x.key,
      name: x.name,
      texts: MODULE_LINKS.filter((l) => (l.from === active && l.to === x.key) || (l.to === active && l.from === x.key)).map((l) => l.text),
    }))
    .filter((r) => r.texts.length > 0);

  return (
    <section id="modules" className="section-plain section-rule">
      <div className="wrap section">
        <div className="section-head" data-reveal>
          <p className="eyebrow">{MODULES.length === 4 ? "Four" : MODULES.length} modules, one set of records</p>
          <h2 className="h2">Turn on the parts you need. They already know about each other.</h2>
          <p className="lede">A delivery order deducts stock, drafts the invoice and prepares the journal. Nothing is typed twice.</p>
        </div>

        <div className="mx" data-reveal>
          <div>
            <p className="mod-col-label" style={{ marginBottom: 10 }}>Pick a module</p>
            <div className="mod-index" role="tablist" aria-label="Modules">
              {MODULES.map((x) => (
                <button
                  key={x.key}
                  type="button"
                  role="tab"
                  id={`mod-tab-${x.key}`}
                  aria-selected={x.key === active}
                  aria-controls="mod-panel"
                  className={`mod-tab${x.key === active ? " is-on" : ""}`}
                  onClick={() => setActive(x.key)}
                >
                  <strong>{x.name}</strong>
                  <span className="mod-tab-short">{x.short}</span>
                  <span className="mod-tab-papers">{x.papers}</span>
                </button>
              ))}
            </div>
          </div>

          <div className="mod-panel sheet" id="mod-panel" role="tabpanel" aria-labelledby={`mod-tab-${active}`} key={active}>
            <div className="mod-col">
              <h3 className="mod-title">{m.name}</h3>
              <p className="mod-hero">{m.hero}</p>
              <p className="mod-body">{m.body}</p>
              <Link className="module-link" href={`/modules/${m.key}`}>Read about {m.name}</Link>
            </div>

            <div className="mod-two">
              <div className="mod-col">
                <p className="mod-col-label">Say it on WhatsApp</p>
                <div className="mod-prompts">
                  {m.prompts.map((p) => <span key={p} className="prompt-bubble">{p}</span>)}
                </div>
              </div>

              <div className="mod-col">
                <p className="mod-col-label">Works with</p>
                <ul className="links">
                  {related.map((r) => (
                    <li key={r.key} className="link-row">
                      <button type="button" className="mod-chip" onClick={() => setActive(r.key)}>{r.name}</button>
                      <span className="link-text">{r.texts.join(" ")}</span>
                    </li>
                  ))}
                </ul>
              </div>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}
