import type { Metadata } from "next";
import { Nav } from "../_components/Nav";
import { Footer } from "../_components/Footer";

export const metadata: Metadata = {
  title: "Privacy policy | AIMS",
  description: "How Osiris Technology collects, uses and protects data in AIMS and the SiteJobs field app.",
};

/** Replace before launch: the address that receives privacy and deletion requests. */
const CONTACT_EMAIL = "{CONTACT_EMAIL}";
const EFFECTIVE_DATE = "22 October 2026";

const COLLECTED: { what: string; detail: string; why: string }[] = [
  {
    what: "Account details",
    detail: "Your name and email address, and a phone number if your organisation signs you in by SMS.",
    why: "To sign you in, show who did what, and let your organisation manage access.",
  },
  {
    what: "Precise location, including in the background",
    detail:
      "While a delivery run is active in SiteJobs, the app records your GPS position at intervals, even when the app is closed or the screen is off. Recording starts when you start a delivery and stops when the delivery is acknowledged or the run ends. The app asks for your permission first and shows a persistent notification while it is recording.",
    why: "To record the route of the delivery as proof of delivery for your organisation and its customer.",
  },
  {
    what: "Photos",
    detail: "Condition and installation photos you take in the app during a delivery, return or service report, and nameplate photos used to read equipment details.",
    why: "Proof of the condition of the goods and of the work done.",
  },
  {
    what: "Signatures and signer names",
    detail: "A signature drawn on screen and the name the signer types, captured when a delivery, return or service report is signed off.",
    why: "To complete the Delivery Order or service report.",
  },
  {
    what: "Customer contact details",
    detail: "Names, phone numbers, email addresses and site addresses that your organisation enters for its customers and projects. SiteJobs shows them to riders and technicians.",
    why: "So the person doing the delivery or service knows where to go and who to contact.",
  },
  {
    what: "Push notification token",
    detail: "A device token issued by Firebase Cloud Messaging, stored while you are signed in on that device and deleted when you sign out.",
    why: "To send notifications such as new scheduled deliveries.",
  },
  {
    what: "Technical records",
    detail: "App and server logs (request time, IP address, app version, errors) and an activity log of actions taken in the system.",
    why: "To keep the service secure and reliable and to give your organisation an audit trail.",
  },
];

const PERMISSIONS: { name: string; use: string }[] = [
  { name: "Location (precise, and \"Allow all the time\")", use: "Delivery route recording during an active run, described above." },
  { name: "Camera", use: "Taking proof photos and reading equipment nameplates. Photos are only taken when you tap the camera." },
  { name: "Notifications", use: "The tracking notification during a delivery, and delivery alerts." },
  { name: "Bluetooth", use: "Connecting to a paired receipt printer to print a Delivery Order." },
  { name: "NFC", use: "Reading the asset tag on equipment. Tag data is only read when you hold the phone to a tag." },
];

export default function PrivacyPage() {
  return (
    <>
      <Nav />
      <main>
        <section className="wrap page-hero">
          <div className="page-hero-copy">
            <span className="eyebrow">Privacy policy</span>
            <h1 className="h1 h1-page">How AIMS and SiteJobs handle your data</h1>
            <p className="hero-body">
              This policy covers the AIMS platform at app.ai-ms.io and the SiteJobs field app for Android, both operated by
              Osiris Technology Pte. Ltd., Singapore. Effective {EFFECTIVE_DATE}.
            </p>
          </div>
        </section>

        <section className="wrap legal">
          <h2>Who we are</h2>
          <p>
            AIMS is an operations platform used by businesses to manage inventory, deliveries, documents and accounting.
            SiteJobs is the companion Android app that riders and technicians use for deliveries, scans and service reports.
            Your organisation is the customer of AIMS and decides what data goes into the system. Osiris Technology operates
            the service on its behalf.
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

          <h2>Android permissions used by SiteJobs</h2>
          <ul>
            {PERMISSIONS.map((p) => (
              <li key={p.name}>
                <strong>{p.name}.</strong> {p.use}
              </li>
            ))}
          </ul>
          <p>
            Background location is only used while a delivery run that you started is active. You can decline it; the
            delivery can still be completed without a recorded route. You can turn any permission off at any time in your
            phone&apos;s settings.
          </p>

          <h2>Where it is stored and how it is protected</h2>
          <p>
            Data is stored with our cloud providers: the database on Neon (PostgreSQL), files such as photos and signed
            documents on Amazon S3, the application servers on Render and Vercel, sign-in on Clerk, and push notifications
            through Firebase Cloud Messaging. All data is encrypted in transit (TLS) and at rest by these providers. Access
            inside AIMS is limited to the users your organisation has added, according to the roles it has given them.
          </p>

          <h2>No selling, no advertising</h2>
          <p>
            We do not sell personal data and we do not share it with advertisers. Data is shared only with the service
            providers named above, who process it for us, with your organisation and the customers it chooses to send
            documents to (for example a signed Delivery Order), and where the law requires it.
          </p>

          <h2>How long we keep it</h2>
          <p>
            Delivery routes, photos, signatures and documents are business records of your organisation and are kept for as
            long as its AIMS account is active, and afterwards for as long as the law requires accounting and delivery
            records to be retained. Push notification tokens are deleted when you sign out or when the device stops
            responding. Server logs are kept for up to 90 days.
          </p>

          <h2>Your choices and deletion</h2>
          <p>
            To see, correct or delete data about you, ask your organisation&apos;s AIMS administrator, who can edit or remove
            your account and records in the admin panel. You can also email us at{" "}
            <a href={`mailto:${CONTACT_EMAIL}`}>{CONTACT_EMAIL}</a>. We answer within 30 days. We will delete the data unless
            it has to be kept as a business record, in which case we will tell you why and for how long.
          </p>

          <h2>Children</h2>
          <p>AIMS and SiteJobs are business tools for adults at work. They are not directed at children under 18.</p>

          <h2>Changes</h2>
          <p>
            If this policy changes, the new version is published at this address with a new effective date. Material
            changes are also announced inside the app.
          </p>

          <h2>Contact</h2>
          <p>
            Osiris Technology Pte. Ltd., Singapore.
            <br />
            Email: <a href={`mailto:${CONTACT_EMAIL}`}>{CONTACT_EMAIL}</a>
          </p>
        </section>
      </main>
      <Footer />
    </>
  );
}
