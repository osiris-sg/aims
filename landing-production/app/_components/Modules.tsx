"use client";

import { useState } from "react";
import Link from "next/link";
import { BADGE_LABEL, MODULES, MODULE_LINKS, type ModuleKey } from "../_content/site";
import { ArrowIcon, ArrowLeftIcon } from "./Icons";
import { LogoMark } from "./Logo";
import { MODULE_ICONS } from "./ModuleIcons";

const NAME = Object.fromEntries(MODULES.map((m) => [m.key, m.name])) as Record<ModuleKey, string>;

/** The five modules under one agent. Pick a module to see what it does, what
 *  you can ask the agent, and which other modules it feeds or is fed by. */
export function Modules() {
  const [active, setActive] = useState<ModuleKey>("crm");
  const m = MODULES.find((x) => x.key === active)!;
  const links = MODULE_LINKS.filter((l) => l.from === active || l.to === active);

  return (
    <section id="modules" className="section-grey">
      <div className="wrap section">
        <div className="section-head" data-reveal>
          <span className="eyebrow">Five modules · one agent</span>
          <h2 className="h2">Every part of the business, reachable from the same conversation.</h2>
          <p className="lede">Turn modules on per company. Pick one below to see what it does and how it connects to the rest.</p>
        </div>

        <div className="mx" data-reveal>
          <div className="hub">
            <LogoMark size={32} onDark />
            <div>
              <p className="hub-title">AIMS agent</p>
              <p className="hub-sub">One agent. Every module. One set of records.</p>
            </div>
          </div>

          <div className="mod-tabs" role="tablist" aria-label="Modules">
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
                <span className="mod-tab-top">
                  <span className="tile">{MODULE_ICONS[x.key]}</span>
                  {x.badge ? <span className={`badge badge-${x.badge}`}>{BADGE_LABEL[x.badge]}</span> : null}
                </span>
                <strong>{x.name}</strong>
                <span className="mod-tab-short">{x.short}</span>
              </button>
            ))}
          </div>

          <div className="mod-panel" id="mod-panel" role="tabpanel" aria-labelledby={`mod-tab-${active}`}>
            <div className="mod-col">
              <p className="mod-col-label">What it does</p>
              <h3 className="mod-hero">{m.hero}</h3>
              <p className="mod-body">{m.body}</p>
              <Link className="module-link" href={`/modules/${m.key}`}>Explore {m.name} <ArrowIcon size={14} /></Link>
            </div>

            <div className="mod-col">
              <p className="mod-col-label">Ask the agent</p>
              <div className="mod-prompts">
                {m.prompts.map((p) => <span key={p} className="prompt-bubble">{p}</span>)}
              </div>
            </div>

            <div className="mod-col">
              <p className="mod-col-label">How it is linked</p>
              <ul className="links">
                {links.map((l) => {
                  const out = l.from === active;
                  const other = out ? l.to : l.from;
                  return (
                    <li key={`${l.from}-${l.to}`} className="link-row">
                      <button
                        type="button"
                        className="mod-chip"
                        onClick={() => setActive(other)}
                        aria-label={`${out ? "Sends to" : "Gets from"} ${NAME[other]}. Show ${NAME[other]}.`}
                      >
                        {out ? <ArrowIcon size={13} /> : <ArrowLeftIcon size={13} />}
                        {NAME[other]}
                      </button>
                      <span className="link-text">
                        {l.text}
                        {l.badge ? <span className={`badge badge-${l.badge}`}>{BADGE_LABEL[l.badge]}</span> : null}
                      </span>
                    </li>
                  );
                })}
              </ul>
              <p className="links-legend"><ArrowIcon size={12} /> sends to <ArrowLeftIcon size={12} /> gets from</p>
            </div>
          </div>

          <p className="note">
            <strong>One set of records.</strong> Customers, stock, documents and the ledger are shared by every module, so nothing is typed twice.
          </p>
        </div>
      </div>
    </section>
  );
}
