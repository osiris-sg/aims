import type { Metadata } from "next";
import { Nav } from "../_components/Nav";
import { Footer } from "../_components/Footer";
import { Cta } from "../_components/Cta";
import { Agent } from "../_components/Agent";
import { ChatMock } from "../_components/ChatMock";
import { MoreModules, StatsStrip } from "../_components/PageBlocks";
import { DEMO_URL } from "../_content/site";
import { ArrowIcon, CheckIcon } from "../_components/Icons";

export const metadata: Metadata = {
  title: "The AIMS agent on WhatsApp and Telegram",
  description: "A staff-facing agent that executes real actions in AIMS, quotations, invoices, stock checks, payments, reports, with confirm-before-commit and your permissions.",
};

const GROUPS = [
  { title: "Look up", items: ["Find a customer, supplier or item", "Check stock by location", "Open invoices and bills", "Recent documents, any document as PDF"] },
  { title: "Draft", items: ["Quotation, invoice, delivery order, credit note", "Invoice from a quotation", "Supplier bill", "New or updated customer"] },
  { title: "Commit, after Confirm", items: ["Confirm a quotation or invoice", "Post a bill to the ledger", "Record a payment against invoices", "Email a document to the customer"] },
  { title: "Report", items: ["Aged receivables and payables", "Sales by customer", "GST report for a period", "Projects and what's on them"] },
];

export default function AgentPage() {
  return (
    <>
      <Nav />
      <main>
        <section className="wrap hero">
          <div className="hero-grid">
            <div className="hero-copy">
              <span className="eyebrow">The agent</span>
              <h1 className="h1">Text your business. It does the work.</h1>
              <p className="hero-body">An agent for your staff on WhatsApp and Telegram. It looks things up, drafts documents and only commits after you tap Confirm. With your permissions, under your name.</p>
              <div className="hero-cta">
                <a className="btn btn-primary" href={DEMO_URL}>Book a demo <ArrowIcon /></a>
                <a className="btn btn-ghost" href="#how">How it works</a>
              </div>
              <div className="hero-proofs">
                {["27 actions today, growing", "Telegram and WhatsApp", "Confirm before anything commits"].map((p) => (
                  <span key={p}><CheckIcon stroke="#00a572" strokeWidth={2.2} />{p}</span>
                ))}
              </div>
            </div>
            <ChatMock />
          </div>
        </section>
        <StatsStrip stats={[{ value: "27", label: "actions the agent can take" }, { value: "4", label: "of them need a tapped Confirm" }, { value: "30 min", label: "before an unconfirmed action expires" }]} />
        <Agent />
        <section className="wrap section tools-section">
          <div className="section-head">
            <span className="eyebrow">What it can do</span>
            <h2 className="h2">Every tool is a real AIMS action, limited to what you are allowed to do.</h2>
            <p className="lede">The agent only sees the tools your role allows. It checks again on every call.</p>
          </div>
          <div className="tools-grid">
            {GROUPS.map((g) => (
              <div key={g.title} className="card tools-card">
                <strong className="module-name">{g.title}</strong>
                <ul className="feature-bullets">
                  {g.items.map((i) => <li key={i}><CheckIcon size={16} stroke="#00a572" strokeWidth={2.2} />{i}</li>)}
                </ul>
              </div>
            ))}
          </div>
        </section>
        <MoreModules />
        <Cta />
      </main>
      <Footer />
    </>
  );
}
