"use client";

import { useState, type ReactNode } from "react";
import { AGENT, MODULES } from "../_content/site";
import {
  ArrowDownIcon, ChatIcon, CheckIcon, ClockIcon, FileTextIcon, InboxIcon, LayersIcon, LockIcon,
  MailIcon, MonitorIcon, PhoneIcon, SendIcon, SparklesIcon, UserCheckIcon, ZapIcon,
} from "./Icons";
import { LogoMark } from "./Logo";
import { MODULE_ICONS } from "./ModuleIcons";

const G_ICONS = {
  lock: <LockIcon />,
  check: <CheckIcon size={16} />,
  clock: <ClockIcon />,
  layers: <LayersIcon />,
};
const STEP_ICONS: ReactNode[] = [<ChatIcon key="a" size={18} strokeWidth={1.8} />, <FileTextIcon key="b" size={18} />, <UserCheckIcon key="c" size={18} />];
const CHANNEL_ICONS = {
  whatsapp: <ChatIcon size={20} strokeWidth={1.8} />,
  telegram: <SendIcon size={20} strokeWidth={1.8} />,
  email: <MailIcon />,
  portal: <MonitorIcon />,
  field: <PhoneIcon />,
};
const ACTION_ICONS: ReactNode[] = [<FileTextIcon key="a" size={16} />, <UserCheckIcon key="b" size={16} />, <ZapIcon key="c" size={16} />];

const Connector = () => <div className="connector" aria-hidden="true"><ArrowDownIcon /></div>;

/** How the agent works: three steps on the left, the route a request takes on
 *  the right. Picking a step lights the matching part of the diagram. */
export function Agent() {
  const [active, setActive] = useState(0);
  const on = (cond: boolean) => (cond ? " is-on" : "");

  return (
    <section id="agent" className="section-plain">
      <div className="wrap section">
        <div className="section-head" data-reveal>
          <span className="eyebrow">{AGENT.eyebrow}</span>
          <h2 id="how" className="h2">{AGENT.title}</h2>
          <p className="lede">{AGENT.body}</p>
        </div>

        <div className="how-grid">
          <div className="how-left" data-reveal>
            <div className="stages">
              {AGENT.steps.map((s, i) => (
                <button key={s.n} type="button" className={`stage${on(active === i)}`} onClick={() => setActive(i)} aria-pressed={active === i}>
                  <span className="stage-n">{s.n}</span>
                  <span className="tile">{STEP_ICONS[i]}</span>
                  <span className="stage-copy">
                    <strong>{s.title}</strong>
                    <span>{s.body}</span>
                  </span>
                </button>
              ))}
            </div>
            <div className="ways">
              <p className="mod-col-label">{AGENT.waysTitle}</p>
              <div className="ways-grid">
                {AGENT.ways.map((w) => (
                  <div key={w.title} className="way">
                    <SparklesIcon size={16} className="tick" />
                    <div>
                      <strong>{w.title}</strong>
                      <span>{w.body}</span>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </div>

          <div className="how-right" data-reveal style={{ "--d": "0.12s" } as React.CSSProperties}>
            <div className="diagram" role="img" aria-label="Requests come in from WhatsApp, Telegram, email, the portal and the field app. The AIMS agent drafts, waits for your confirmation, then executes across every module.">
              <p className="diagram-label">Where work comes in</p>
              <div className="nodes nodes-5">
                {AGENT.channels.map((c) => (
                  <div key={c.key} className={`node${on(active === 0)}`}>
                    {CHANNEL_ICONS[c.key]}
                    <span>{c.label}</span>
                  </div>
                ))}
              </div>
              <Connector />
              <div className={`core${on(active === 1)}`}>
                <LogoMark size={26} onDark />
                <div>
                  <p className="core-title">{AGENT.core.title}</p>
                  <p className="core-body">{AGENT.core.body}</p>
                </div>
              </div>
              <Connector />
              <div className="nodes nodes-3">
                {AGENT.actions.map((a, i) => (
                  <div key={a} className={`node node-action${on((active === 1 && i === 0) || (active === 2 && i > 0))}`}>
                    {ACTION_ICONS[i]}
                    <span>{a}</span>
                  </div>
                ))}
              </div>
              <Connector />
              <p className="diagram-label">Where it lands</p>
              <div className="nodes nodes-5">
                {MODULES.map((m) => (
                  <div key={m.key} className={`node${on(active === 2)}`}>
                    {MODULE_ICONS[m.key]}
                    <span>{m.name}</span>
                  </div>
                ))}
              </div>
              <p className="diagram-foot"><InboxIcon size={14} className="tick" />{AGENT.foot}</p>
            </div>
          </div>
        </div>

        <div className="guarantees" data-reveal>
          {AGENT.guarantees.map((g) => (
            <span key={g.text}>{G_ICONS[g.icon]}{g.text}</span>
          ))}
        </div>
      </div>
    </section>
  );
}
