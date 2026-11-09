"use client";

import { useEffect, useState } from "react";
import { AGENT, CHAT } from "../_content/site";
import { ChatMock } from "./ChatMock";

const FIRST_MS = 1200;
const TURN_MS = 2200;
const HOLD_MS = 4000;

/** How the agent works: three rows beside the conversation. The thread plays
 *  on a loop and each row lights when its turn lands. Clicking a row jumps the
 *  thread there. On the agent page (no phone) the rows stand alone. */
export function Agent({ phone = true }: { phone?: boolean } = {}) {
  const [shown, setShown] = useState(1);
  const [still, setStill] = useState(false);
  const total = CHAT.length;

  useEffect(() => {
    setStill(window.matchMedia("(prefers-reduced-motion: reduce)").matches);
  }, []);

  useEffect(() => {
    if (!phone || still) return;
    const wait = shown === 1 ? FIRST_MS : shown >= total ? HOLD_MS : TURN_MS;
    const t = window.setTimeout(() => setShown((n) => (n >= total ? 1 : n + 1)), wait);
    return () => window.clearTimeout(t);
  }, [shown, total, phone, still]);

  const visible = !phone || still ? total : shown;
  const lastTurn = visible - 1;
  // The active row is the last step whose turn has landed.
  const active = AGENT.steps.reduce((acc, s, i) => (s.at <= lastTurn ? i : acc), -1);

  return (
    <section id="agent" className="section-grey section-rule">
      <div className={`wrap section confirm-grid${phone ? "" : " confirm-solo"}`}>
        <div className="confirm-copy" data-reveal>
          <p className="eyebrow">{AGENT.eyebrow}</p>
          <h2 id="how" className="h2">{AGENT.title}</h2>
          <div className="confirm-steps">
            {AGENT.steps.map((s, i) => {
              const inner = (
                <>
                  <span className="stage-when">{s.when}</span>
                  <span className="stage-copy">
                    <strong>{s.title}</strong>
                    <span>{s.body}</span>
                  </span>
                </>
              );
              const cls = `stage${i === active ? " is-on" : i < active ? " is-done" : ""}`;
              return phone ? (
                <button key={s.title} type="button" className={cls} onClick={() => setShown(s.at + 1)} aria-pressed={i === active}>{inner}</button>
              ) : (
                <div key={s.title} className="stage stage-static">{inner}</div>
              );
            })}
          </div>
        </div>

        {phone ? (
          <div className="confirm-phone" data-reveal style={{ "--d": "0.1s" } as React.CSSProperties}>
            <ChatMock shown={visible} fixed />
          </div>
        ) : null}
      </div>
    </section>
  );
}
