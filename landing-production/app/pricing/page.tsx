import type { Metadata } from "next";
import { Nav } from "../_components/Nav";
import { Footer } from "../_components/Footer";
import { Cta } from "../_components/Cta";
import { DEMO_URL, MODULES, BADGE_LABEL } from "../_content/site";
import { CheckIcon } from "../_components/Icons";

export const metadata: Metadata = {
  title: "Pricing | AIMS",
  description: "Priced per company, per module. Setup and Xero migration handled by our team.",
};

const PLANS = [
  {
    name: "Starter",
    tagline: "One company, the modules you need.",
    price: "Per module, per month",
    features: ["Any of the four modules", "The WhatsApp / Telegram agent", "Unlimited documents and users", "Branded templates and your numbering", "Email support"],
    cta: "Book a demo",
  },
  {
    name: "Business",
    tagline: "Everything on, plus your accountant.",
    price: "All modules, per month",
    featured: true,
    features: ["All four modules", "Accountant seat with the posting queue", "Migration from Xero, QuickBooks, Odoo and more", "Field app for your technicians", "Priority support on WhatsApp"],
    cta: "Book a demo",
  },
  {
    name: "Group",
    tagline: "Several companies, one login, one bot.",
    price: "Talk to us",
    features: ["Multiple companies under one account", "One agent across all of them", "Custom document types and workflows", "API access and integrations", "Dedicated onboarding"],
    cta: "Talk to us",
  },
];

export default function PricingPage() {
  return (
    <>
      <Nav />
      <main>
        <section className="wrap page-hero page-hero-center">
          <div className="page-hero-copy" style={{ alignItems: "center", textAlign: "center" }}>
            <span className="eyebrow">Pricing</span>
            <h1 className="h1 h1-page">Pick the modules you need. Pay for those.</h1>
            <p className="hero-body">Priced per company, per module. Our team handles setup and migration.</p>
          </div>
        </section>
        <section className="wrap plans">
          {PLANS.map((p) => (
            <div key={p.name} className={`card plan${p.featured ? " plan-featured" : ""}`}>
              <div className="plan-head">
                <strong className="plan-name">{p.name}</strong>
                <span className="plan-tagline">{p.tagline}</span>
              </div>
              <div className="plan-price">{p.price}</div>
              <ul className="feature-bullets">
                {p.features.map((f) => <li key={f}><CheckIcon size={16} className="tick" strokeWidth={2.2} />{f}</li>)}
              </ul>
              <a className={`btn ${p.featured ? "btn-primary" : "btn-ghost"}`} href={DEMO_URL}>{p.cta}</a>
            </div>
          ))}
        </section>
        <section className="wrap section">
          <div className="section-head" style={{ marginBottom: 32 }}>
            <span className="eyebrow">Modules</span>
            <h2 className="h2">Turn any of these on, per company.</h2>
          </div>
          <div className="more-grid more-grid-5">
            {MODULES.map((m) => (
              <a key={m.key} href={`/modules/${m.key}`} className="card card-hover more-card">
                <div className="module-top">
                  <strong className="module-name">{m.name}</strong>
                  {m.badge ? <span className={`badge badge-${m.badge}`}>{BADGE_LABEL[m.badge]}</span> : null}
                </div>
                <span className="module-body">{m.hero}</span>
                <span className="mono" style={{ fontSize: 11.5, color: "var(--faint)" }}>{m.papers}</span>
              </a>
            ))}
          </div>
        </section>
        <Cta />
      </main>
      <Footer />
    </>
  );
}
