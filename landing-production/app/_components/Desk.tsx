"use client";

import { useEffect, useState, type ReactNode } from "react";
import { DESK_STEPS } from "../_content/site";
import { DeliveryPaper, InvoicePaper, JournalPaper, MessagePaper, QuotationPaper } from "./Papers";

const DOCS: Record<string, ReactNode> = {
  quotation: <QuotationPaper />,
  delivery: <DeliveryPaper />,
  invoice: <InvoicePaper />,
  journal: <JournalPaper />,
};

const FIRST_MS = 1400;
const STEP_MS = 2600;
const HOLD_MS = 3600;

/** The hero flow, on a loop. The message that started it stays at the top;
 *  each paper it produced lands underneath, on top of the one before. The
 *  rail jumps to a step; the loop carries on from there. */
export function Desk() {
  const [step, setStep] = useState(0);
  const [still, setStill] = useState(false);
  const last = DESK_STEPS.length - 1;

  useEffect(() => {
    setStill(window.matchMedia("(prefers-reduced-motion: reduce)").matches);
  }, []);

  useEffect(() => {
    if (still) return;
    const wait = step === 0 ? FIRST_MS : step === last ? HOLD_MS : STEP_MS;
    const t = window.setTimeout(() => setStep((s) => (s >= last ? 0 : s + 1)), wait);
    return () => window.clearTimeout(t);
  }, [step, last, still]);

  const shown = still ? last : step;

  return (
    <div className="flow">
      <ol className="flow-rail" aria-label="How one message becomes the paperwork">
        {DESK_STEPS.map((s, i) => {
          const state = i < shown ? "done" : i === shown ? "on" : "todo";
          return (
            <li key={s.key} className={`flow-step is-${state}`}>
              <button type="button" onClick={() => setStep(i)} aria-current={i === shown ? "step" : undefined}>
                <span className="flow-dot" aria-hidden="true" />
                <span className="flow-label">{s.label}</span>
                <span className="flow-who">{s.who}</span>
              </button>
            </li>
          );
        })}
      </ol>

      <div className={`flow-stage${shown === 0 ? " is-start" : ""}`} role="img" aria-label="One WhatsApp message becomes a quotation, a delivery order, a tax invoice and a journal.">
        <div className="flow-msg"><MessagePaper /></div>
        <div className="flow-docs">
          {DESK_STEPS.slice(1).map((s, i) => {
            const n = i + 1;
            const age = shown - n;
            const cls = age === 0 ? "is-on" : age > 0 ? "is-past" : "is-todo";
            return (
              <div key={s.key} className={`flow-card ${cls}`} style={{ "--k": Math.max(0, age), zIndex: 10 - Math.max(0, age) } as React.CSSProperties} aria-hidden={age !== 0}>
                {DOCS[s.key]}
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
