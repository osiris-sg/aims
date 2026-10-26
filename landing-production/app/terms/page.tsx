import type { Metadata } from "next";
import { Nav } from "../_components/Nav";
import { Footer } from "../_components/Footer";
import { LEGAL } from "../_content/legal";

export const metadata: Metadata = {
  title: "Terms of service | AIMS",
  description: "The terms for using AIMS, the SiteJobs field app and the AIMS assistant, provided by Osiris Technology.",
  alternates: { canonical: "/terms" },
  robots: { index: true, follow: true },
};

const MAIL = `mailto:${LEGAL.contactEmail}`;

export default function TermsPage() {
  return (
    <>
      <Nav />
      <main>
        <section className="wrap page-hero">
          <div className="page-hero-copy">
            <span className="eyebrow">Terms of service</span>
            <h1 className="h1 h1-page">Terms for using AIMS</h1>
            <p className="hero-body">
              These terms apply to the AIMS portal at app.ai-ms.io, the SiteJobs field app and the AIMS assistant on
              WhatsApp and Telegram (together, &quot;AIMS&quot;), provided by {LEGAL.company}, {LEGAL.country} (&quot;we&quot;).
            </p>
            <p className="hero-body">Last updated: {LEGAL.lastUpdated}</p>
          </div>
        </section>

        <section className="wrap legal">
          <h2>1. Who these terms are for</h2>
          <p>
            AIMS is a business service. These terms are between us and the organisation that subscribes to AIMS (the
            &quot;Customer&quot;). People who use AIMS on the Customer&apos;s behalf, such as staff, riders and technicians,
            must follow these terms too. If a separate signed agreement or order form exists with the Customer, it takes
            priority over these terms where they differ.
          </p>

          <h2>2. Accounts</h2>
          <ul>
            <li>The Customer decides who gets an account and what each user can do.</li>
            <li>Each account is for one person. Keep your sign-in details private and tell your administrator if you think your account has been misused.</li>
            <li>The Customer is responsible for what happens under its users&apos; accounts and for removing access when someone leaves.</li>
          </ul>

          <h2>3. Acceptable use</h2>
          <p>You must not:</p>
          <ul>
            <li>use AIMS for anything unlawful, fraudulent or harmful, or to send spam;</li>
            <li>upload content you have no right to use, or that contains malware;</li>
            <li>try to access another organisation&apos;s data, or test, probe or overload AIMS without our written permission;</li>
            <li>copy, resell or reverse engineer AIMS, or use it to build a competing product;</li>
            <li>use the WhatsApp or Telegram assistant in breach of those platforms&apos; own rules.</li>
          </ul>
          <p>We may suspend access that breaks these rules or puts AIMS or other customers at risk. Where we can, we will tell the Customer first.</p>

          <h2>4. Customer data</h2>
          <ul>
            <li>The Customer owns the data it and its users put into AIMS (&quot;Customer Data&quot;).</li>
            <li>We use Customer Data only to provide, secure and support AIMS for the Customer, and as described in our <a href="/privacy-policy">privacy policy</a>.</li>
            <li>The Customer is responsible for having the right to collect the personal data it puts into AIMS, including the consents and notices the PDPA requires.</li>
            <li>The Customer can ask us for an export of its data while its account is active. After the account ends, we delete Customer Data on request, except where the law requires us to keep it.</li>
          </ul>

          <h2>5. AI features</h2>
          <p>
            AIMS uses AI to read documents, draft replies and carry out requests. AI output can be wrong. Users should check
            important results, such as amounts, accounting entries and messages to customers, before relying on them.
          </p>

          <h2>6. Availability and changes</h2>
          <p>
            We work to keep AIMS available and secure, but we do not promise that it will be uninterrupted or error free.
            We may carry out maintenance, and we may improve or change features. If we remove a feature the Customer
            relies on, we will give reasonable notice. Services run by third parties, such as WhatsApp, Telegram or Xero,
            are outside our control.
          </p>

          <h2>7. Fees</h2>
          <p>
            Fees, billing periods and payment terms are set out in the Customer&apos;s quotation or order form. If fees are
            unpaid after notice, we may suspend access until they are paid.
          </p>

          <h2>8. Liability</h2>
          <ul>
            <li>AIMS is provided &quot;as is&quot;, to the extent the law allows.</li>
            <li>We are not liable for indirect or consequential loss, or for loss of profits, revenue or data, except where caused by our gross negligence or wilful misconduct.</li>
            <li>Our total liability for all claims in any 12 months is limited to the fees the Customer paid us for AIMS in those 12 months.</li>
            <li>Nothing in these terms limits liability that cannot be limited by law.</li>
          </ul>

          <h2>9. Ending the service</h2>
          <p>
            The Customer may stop using AIMS at any time, subject to its order form. We may end the service for a serious
            breach of these terms that is not fixed within 30 days of notice.
          </p>

          <h2>10. Changes to these terms</h2>
          <p>
            We may update these terms. The new version is published at this address with a new date, and material changes
            are announced in the app. Continuing to use AIMS after that means the Customer accepts the update.
          </p>

          <h2>11. Governing law</h2>
          <p>These terms are governed by the laws of Singapore, and the courts of Singapore have exclusive jurisdiction.</p>

          <h2>12. Contact</h2>
          <p>
            {LEGAL.company}, {LEGAL.country}.
            <br />
            Email: <a href={MAIL}>{LEGAL.contactEmail}</a>
          </p>
        </section>
      </main>
      <Footer />
    </>
  );
}
