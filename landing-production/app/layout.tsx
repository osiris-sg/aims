import type { Metadata } from "next";
import { DM_Sans, IBM_Plex_Mono } from "next/font/google";
import { RevealObserver } from "./_components/RevealObserver";
import "./globals.css";

const SITE_URL = "https://ai-ms.io";

/* DM Sans is the brand typeface (Brand Kit R01). IBM Plex Mono only inside the
   sample documents, where it depicts printed references and amounts. */
const dmSans = DM_Sans({ subsets: ["latin"], weight: ["400", "500", "600", "700"], variable: "--font-dm-sans", display: "swap" });
const plexMono = IBM_Plex_Mono({ subsets: ["latin"], weight: ["400", "500", "600"], variable: "--font-plex-mono", display: "swap" });

export const metadata: Metadata = {
  metadataBase: new URL(SITE_URL),
  title: "AIMS: One WhatsApp message. All the paperwork.",
  description:
    "Quotation, delivery order, tax invoice, journal, GST. AIMS fills them in from a WhatsApp message or a photo. Your people confirm, your accountant posts. Built for Singapore SMEs.",
  openGraph: {
    title: "AIMS: One WhatsApp message. All the paperwork.",
    description:
      "Quotation, delivery order, tax invoice, journal, GST, filled in from a WhatsApp message or a photo. Your people confirm, your accountant posts.",
    url: SITE_URL,
    siteName: "AIMS",
    type: "website",
  },
  twitter: { card: "summary_large_image" },
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={`${dmSans.variable} ${plexMono.variable}`} suppressHydrationWarning>
      <body>
        {/* Marks the document so scroll-reveal can hide elements until they come into view. */}
        <script dangerouslySetInnerHTML={{ __html: `document.documentElement.dataset.js="1";` }} />
        {children}
        <RevealObserver />
      </body>
    </html>
  );
}
