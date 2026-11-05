"use client";

import { useState, type ReactNode } from "react";
import { BADGE_LABEL, MODULES, USE_CASES, type UseCaseIcon } from "../_content/site";
import {
  ArrowIcon, ArrowLeftIcon, BanknoteIcon, BoxIcon, CameraIcon, ChatIcon, CheckCircleIcon, CheckIcon,
  FileTextIcon, InboxIcon, ReceiptIcon, RestartIcon, SearchIcon, TruckIcon, UserCheckIcon, ZapIcon,
} from "./Icons";
import { MODULE_ICONS } from "./ModuleIcons";

const STEP_ICONS: Record<UseCaseIcon, ReactNode> = {
  chat: <ChatIcon size={18} strokeWidth={1.8} />,
  file: <FileTextIcon size={18} />,
  truck: <TruckIcon size={18} />,
  receipt: <ReceiptIcon size={18} />,
  check: <CheckCircleIcon size={18} strokeWidth={1.8} />,
  box: <BoxIcon size={18} />,
  inbox: <InboxIcon size={18} />,
  review: <UserCheckIcon size={18} />,
  bank: <BanknoteIcon size={18} />,
  camera: <CameraIcon size={18} />,
  search: <SearchIcon size={18} />,
  approve: <UserCheckIcon size={18} />,
  post: <ZapIcon size={18} />,
};
const TAB_ICONS = {
  chat: <ChatIcon size={16} />,
  box: <BoxIcon size={16} />,
  receipt: <ReceiptIcon size={16} />,
};

/** "AIMS in action": pick a job, step through it, and watch which modules it
 *  touches. The rail on the right is the point: one job, several modules. */
export function UseCases() {
  const [tab, setTab] = useState(0);
  const [step, setStep] = useState(0);
  const uc = USE_CASES[tab];
  const last = uc.steps.length - 1;
  const current = uc.steps[step];
  const now = new Set(current.modules);
  const before = new Set(uc.steps.slice(0, step).flatMap((s) => s.modules));

  const pick = (i: number) => { setTab(i); setStep(0); };

  return (
    <section id="in-action" className="section-plain">
      <div className="wrap section">
        <div className="section-head" data-reveal>
          <span className="eyebrow">AIMS in action</span>
          <h2 className="h2">From chasing information to getting things done.</h2>
          <p className="lede">Pick a job and step through it. Watch which modules it touches on the way.</p>
        </div>

        <div className="uc" data-reveal>
          <div className="uc-tabs" role="tablist" aria-label="Example jobs">
            {USE_CASES.map((u, i) => (
              <button
                key={u.key}
                type="button"
                role="tab"
                id={`uc-tab-${u.key}`}
                aria-selected={i === tab}
                aria-controls="uc-panel"
                className={`uc-tab${i === tab ? " is-on" : ""}`}
                onClick={() => pick(i)}
              >
                {TAB_ICONS[u.icon]}
                {u.label}
                {u.badge ? <span className="uc-tab-badge">{BADGE_LABEL[u.badge]}</span> : null}
              </button>
            ))}
          </div>

          <div className="uc-card" id="uc-panel" role="tabpanel" aria-labelledby={`uc-tab-${uc.key}`}>
            <div className="uc-top">
              <p className="eyebrow">{uc.summary} · sample data</p>
              <button type="button" className="chip-btn" onClick={() => setStep(0)} disabled={step === 0}>
                <RestartIcon />
                Restart
              </button>
            </div>

            <div className="uc-rail">
              <div className="uc-rail-track"><div className="uc-rail-fill" style={{ width: `${(step / last) * 100}%` }} /></div>
              <div className="uc-rail-steps">
                {uc.steps.map((s, i) => {
                  const state = i < step ? "done" : i === step ? "active" : "todo";
                  return (
                    <button
                      key={s.label}
                      type="button"
                      className={`uc-step is-${state}`}
                      onClick={() => setStep(i)}
                      aria-label={`Step ${i + 1} of ${uc.steps.length}: ${s.label}`}
                      aria-current={i === step ? "step" : undefined}
                    >
                      <span className="uc-step-dot">{STEP_ICONS[s.icon]}</span>
                      <span className="uc-step-label">{s.label}</span>
                    </button>
                  );
                })}
              </div>
            </div>

            <div className="uc-body">
              <div className="uc-panel" key={`${uc.key}-${step}`} aria-live="polite">
                <span className="uc-panel-icon">{STEP_ICONS[current.icon]}</span>
                <div>
                  <p className="uc-panel-title">{current.title}</p>
                  <p className="uc-panel-body">{current.body}</p>
                  <p className="meta-chip">{current.meta}</p>
                </div>
              </div>

              <aside className="uc-mods" aria-label="Modules this job touches">
                <p className="uc-mods-title">Modules touched</p>
                <ul>
                  {MODULES.map((m) => {
                    const state = now.has(m.key) ? "now" : before.has(m.key) ? "done" : "idle";
                    return (
                      <li key={m.key} className={`uc-mod is-${state}`}>
                        <span className="uc-mod-icon">{MODULE_ICONS[m.key]}</span>
                        <span className="uc-mod-name">{m.name}</span>
                        <span className="uc-mod-state">
                          {state === "now" ? (<><span className="pulse-dot" />Working</>) : state === "done" ? (<><CheckIcon size={12} strokeWidth={2.6} />Updated</>) : null}
                        </span>
                      </li>
                    );
                  })}
                </ul>
              </aside>
            </div>

            <div className="uc-foot">
              <button type="button" className="btn btn-ghost btn-sm" onClick={() => setStep((s) => Math.max(0, s - 1))} disabled={step === 0}>
                <ArrowLeftIcon size={14} />
                Back
              </button>
              <span className="uc-count">{step + 1} of {uc.steps.length}</span>
              <button type="button" className="btn btn-primary btn-sm" onClick={() => setStep((s) => Math.min(last, s + 1))} disabled={step === last}>
                Next step
                <ArrowIcon size={14} />
              </button>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}
