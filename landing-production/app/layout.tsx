import type { Metadata } from "next";
import { DM_Sans, Manrope } from "next/font/google";
import { GeistMono } from "geist/font/mono";
import { RevealObserver } from "./_components/RevealObserver";
import "./globals.css";

const SITE_URL = "https://ai-ms.io";

/* Manrope for headings, nav and buttons; DM Sans for body copy. */
const manrope = Manrope({ subsets: ["latin"], weight: ["500", "600", "700"], variable: "--font-manrope", display: "swap" });
const dmSans = DM_Sans({ subsets: ["latin"], weight: ["400", "500", "600"], variable: "--font-dm-sans", display: "swap" });

export const metadata: Metadata = {
  metadataBase: new URL(SITE_URL),
  title: "AIMS: One Intelligent System. More Human Potential.",
  description:
    "Inventory, HR, CRM, accounting and claims in one system, with an agent on WhatsApp or Telegram that does the work when you ask. Built for Singapore SMEs.",
  openGraph: {
    title: "AIMS: One Intelligent System. More Human Potential.",
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
    <html lang="en" className={`${manrope.variable} ${dmSans.variable} ${GeistMono.variable}`} suppressHydrationWarning>
      <body>
        {/* Apply the saved theme before first paint (no flash). System preference wins when nothing is saved. */}
        <script
          dangerouslySetInnerHTML={{
            __html: `try{var t=localStorage.getItem("aims-theme");if(t==="dark"||t==="light")document.documentElement.dataset.theme=t;}catch(e){}document.documentElement.dataset.js="1";`,
          }}
        />
        {children}
        <RevealObserver />
      </body>
    </html>
  );
}
