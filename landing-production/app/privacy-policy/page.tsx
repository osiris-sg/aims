import type { Metadata } from "next";
import { Nav } from "../_components/Nav";
import { Footer } from "../_components/Footer";
import { LEGAL } from "../_content/legal";

export const metadata: Metadata = {
  title: "Privacy policy | AIMS",
  description:
    "How Osiris Technology collects, uses and protects personal data in AIMS, the SiteJobs field app and the AIMS WhatsApp and Telegram assistant.",
  alternates: { canonical: "/privacy-policy" },
  robots: { index: true, follow: true },
};

const MAIL = `mailto:${LEGAL.contactEmail}`;

const COLLECTED: { what: string; detail: string; why: string }[] = [
  {
    what: "Account details",
    detail:
      "Your name, email address and, if your organisation uses it, a phone number for sign-in by SMS code. If you choose \"Continue with Google\", we receive your name, email address and profile picture from Google. Passwords are handled by our sign-in provider, Clerk, and are never visible to us.",
    why: "To sign you in, show who did what, and let your organisation manage access.",
  },
  {
    what: "Business records",
    detail:
      "Everything your organisation enters or uploads: customers and their contacts, projects, inventory, quotations, invoices, delivery orders, service reports, accounting entries and attached files.",
    why: "To provide the service your organisation subscribes to.",
  },
  {
    what: "Photos and files",
    detail:
      "Photos taken with the camera or picked from the gallery in SiteJobs (condition, installation, service and nameplate photos), and documents uploaded in the portal or emailed to your organisation's document inbox.",
    why: "Proof of the condition of goods and of work done, and to create documents from the files.",
  },
  {
    what: "Signatures",
    detail:
      "A signature drawn on screen and the name the signer types, when a delivery, return or service report is signed, or a quotation is accepted. When a customer signs through a link we send them, we also record the time, IP address and browser type of the signing.",
    why: "To complete and evidence the delivery order, report or agreement.",
  },
  {
    what: "Location (SiteJobs only)",
    detail:
      "During a delivery run that a rider starts, SiteJobs records GPS positions, including in the background, until the delivery is acknowledged or the run ends, and shows a notification while it records. When a delivery, installation or return is signed off, the app also records one position. Location is not collected at any other time.",
    why: "To record the delivery route and the place of hand-over as proof of delivery.",
  },
  {
    what: "WhatsApp and Telegram messages",
    detail:
      "If your organisation connects the AIMS assistant, messages sent to or from its WhatsApp number or Telegram bot are stored with the sender's phone number or account name. In WhatsApp groups where an organisation has added the assistant, it reads the group's messages to decide whether to reply and to note appointments mentioned there. Voice notes are converted to text.",
    why: "To answer questions, carry out requests, send appointment reminders and keep the conversation history in the CRM.",
  },
  {
    what: "Push notification token",
    detail: "A device token from Firebase Cloud Messaging, kept while you are signed in on that device.",
    why: "To send notifications such as new scheduled deliveries.",
  },
  {
    what: "Activity and technical records",
    detail:
      "An activity log of actions taken in AIMS (who, what, when, and the IP address and browser of the request), and server logs kept by our hosting providers.",
    why: "Security, troubleshooting, and an audit trail for your organisation.",
  },
];

const PROCESSORS: { name: string; role: string }[] = [
  { name: "Neon", role: "PostgreSQL database, hosted in Singapore." },
  { name: "Amazon Web Services (S3)", role: "Storage of photos, signatures and documents, in Singapore." },
  { name: "Render", role: "Application servers for the AIMS backend." },
  { name: "Vercel", role: "Hosting of the AIMS web portal and this website." },
  { name: "Clerk", role: "Sign-in and account security, including Google sign-in." },
  { name: "Google Firebase", role: "Push notifications to the SiteJobs app." },
  { name: "Meta (WhatsApp Business Platform) and Telegram", role: "Delivery of assistant messages, when your organisation connects them." },
  { name: "Anthropic and OpenAI", role: "AI processing: the assistant's replies, reading uploaded documents, transcribing voice notes and search. Data sent to them is used to provide AIMS and not to train their models." },
  { name: "Resend", role: "Sending emails, such as reports and documents to your customers." },
  { name: "Cloudflare", role: "Receiving emails sent to your organisation's document inbox." },
  { name: "Xero", role: "Accounting sync, only if your organisation connects its Xero account." },
];

const PERMISSIONS: { name: string; use: string }[] = [
  { name: "Location, including \"Allow all the time\"", use: "Delivery route recording during an active run, and the hand-over position, as described above. The app explains this and asks before it starts." },
  { name: "Camera", use: "Taking proof photos and reading equipment nameplates, only when you tap the camera." },
  { name: "Notifications", use: "The tracking notification during a delivery, and delivery alerts." },
  { name: "Bluetooth", use: "Connecting to a paired receipt printer to print a delivery order." },
  { name: "NFC", use: "Reading the asset tag on equipment, only when you hold the phone to a tag." },
];

export default function PrivacyPolicyPage() {
  return (
    <>
      <Nav />
      <main>
        <section className="wrap page-hero">
          <div className="page-hero-copy">
            <span className="eyebrow">Privacy policy</span>
            <h1 className="h1 h1-page">How AIMS handles personal data</h1>
            <p className="hero-body">
              This policy covers the AIMS portal at app.ai-ms.io, the SiteJobs field app for Android, and the AIMS
              assistant on WhatsApp and Telegram. All are operated by {LEGAL.company}, {LEGAL.country}.
            </p>
            <p className="hero-body">Last updated: {LEGAL.lastUpdated}</p>
          </div>
        </section>

        <section className="wrap legal">
          <h2>Who we are and our role</h2>
          <p>
            AIMS is an operations platform that businesses use to manage inventory, deliveries, service work, documents,
            customers and accounting. The business that subscribes to AIMS (your organisation) decides what data goes into
            it and why. For that data, {LEGAL.company} processes personal data on your organisation&apos;s behalf, as a
            data intermediary under Singapore&apos;s Personal Data Protection Act 2012 (PDPA). For our own records about
            our customers, such as account and billing contacts, we are responsible under the PDPA directly.
          </p>

          <h2>What we collect and why</h2>
          <div className="legal-table" role="table">
            <div className="legal-row legal-head" role="row">
              <span role="columnheader">Data</span>
              <span role="columnheader">What exactly</span>
              <span role="columnheader">Why</span>
            </div>
            {COLLECTED.map((r) => (
              <div className="legal-row" role="row" key={r.what}>
                <strong role="cell">{r.what}</strong>
                <span role="cell">{r.detail}</span>
                <span role="cell">{r.why}</span>
              </div>
            ))}
          </div>
          <p>
            We do not use advertising or analytics trackers in AIMS or on this website. The portal uses cookies only to
            keep you signed in. This website stores your light or dark theme choice in your browser, and nothing else.
          </p>

          <h2>SiteJobs app permissions</h2>
          <ul>
            {PERMISSIONS.map((p) => (
              <li key={p.name}>
                <strong>{p.name}.</strong> {p.use}
              </li>
            ))}
          </ul>
          <p>
            You can decline background location. The delivery can still be completed, but without a recorded route. You
            can turn any permission off at any time in your phone&apos;s settings.
          </p>

          <h2>Who processes data for us</h2>
          <p>We use these service providers to run AIMS. They process data only on our instructions.</p>
          <ul>
            {PROCESSORS.map((p) => (
              <li key={p.name}>
                <strong>{p.name}.</strong> {p.role}
              </li>
            ))}
          </ul>
          <p>
            Our database and file storage are in Singapore. Some providers, such as Clerk, Vercel and the AI providers,
            may process data in other countries, including the United States. Where data leaves Singapore, we rely on the
            provider&apos;s contractual commitments to protect it to a standard comparable to the PDPA.
          </p>

          <h2>How we protect it</h2>
          <p>
            Data is encrypted in transit (TLS) and encrypted at rest by our storage providers. Each organisation&apos;s
            data is kept separate, and inside AIMS a user can only see what their organisation&apos;s roles allow. Links
            we send to customers to view or sign a document use long random tokens and only open that document.
          </p>

          <h2>No selling, no advertising</h2>
          <p>
            We do not sell personal data and do not share it with advertisers. We share it only with the providers listed
            above, with your organisation, with the people your organisation chooses to send documents or links to, and
            where the law requires it.
          </p>

          <h2>How long we keep it</h2>
          <p>
            Business records, including delivery routes, photos, signatures, messages and documents, are kept for as long
            as your organisation&apos;s AIMS account is active, or until your organisation deletes them. When an
            organisation leaves AIMS, we delete its data on request, except where the law requires records to be kept
            longer, for example accounting records. Push notification tokens are deleted when you sign out or when the
            device stops responding. The activity log is kept for as long as the account is active, as an audit trail.
          </p>

          <h2>Access, correction and deletion</h2>
          <p>
            To see, correct or delete data about you, ask your organisation&apos;s AIMS administrator, who can edit or
            remove your account and records. You can also email us at <a href={MAIL}>{LEGAL.contactEmail}</a>. We reply
            within 30 days. Where the data belongs to your organisation, we will pass your request to it. We delete data
            unless it must be kept as a business or legal record, and if so we will tell you why.
          </p>

          <h2>Children</h2>
          <p>AIMS and SiteJobs are business tools for adults at work. They are not directed at children.</p>

          <h2>Changes</h2>
          <p>
            If this policy changes, we publish the new version at this address with a new date. We announce material
            changes in the app.
          </p>

          <h2>Contact and Data Protection Officer</h2>
          <p>
            {LEGAL.company}, {LEGAL.country}.
            <br />
            Data Protection Officer: <a href={MAIL}>{LEGAL.contactEmail}</a>
          </p>
        </section>
      </main>
      <Footer />
    </>
  );
}
