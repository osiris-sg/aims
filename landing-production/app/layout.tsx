import type { Metadata } from "next";
import { GeistSans } from "geist/font/sans";
import { GeistMono } from "geist/font/mono";
import "./globals.css";

const SITE_URL = "https://ai-ms.io";

export const metadata: Metadata = {
  metadataBase: new URL(SITE_URL),
  title: "AIMS — Run your whole business from one chat",
  description:
    "Inventory, HR, CRM, accounting and claims in one system, with an agent on WhatsApp or Telegram that does the work when you ask. Built for Singapore SMEs.",
  openGraph: {
    title: "AIMS — Run your whole business from one chat",
    description:
      "Inventory, HR, CRM, accounting and claims in one system, with a WhatsApp/Telegram agent that does the work when you ask.",
    url: SITE_URL,
    siteName: "AIMS",
    type: "website",
  },
  twitter: { card: "summary_large_image" },
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={`${GeistSans.variable} ${GeistMono.variable}`}>
      <body>{children}</body>
    </html>
  );
}
