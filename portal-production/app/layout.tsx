// "use client";
import type { Metadata } from "next";
import { Inter, Manrope, Carlito } from "next/font/google";
import "./globals.css";
import { AppRouterCacheProvider } from "@mui/material-nextjs/v15-appRouter";
import { ThemeModeProvider } from "@/contexts/ThemeModeContext";
import { ClerkProvider } from "@clerk/nextjs";
import Portal from "@/containers/portal";
import Providers from "./providers";

const inter = Inter({
  weight: ["300", "400", "500", "600", "700"],
  subsets: ["latin"],
  display: "swap",
  variable: "--font-inter",
});

const manrope = Manrope({
  weight: ["400", "500", "600", "700", "800"],
  subsets: ["latin"],
  display: "swap",
  variable: "--font-manrope",
});

// Carlito is used for document templates (Calibri-compatible print output)
const carlito = Carlito({
  weight: ["400", "700"],
  subsets: ["latin"],
  display: "swap",
  variable: "--font-carlito",
});

export const metadata: Metadata = {
  title: "AIMS",
  description: "AIMS provides a semaless flow for inventory managment",
  // `apple` must be set explicitly: an explicit `icons` object suppresses the
  // app/apple-icon.png file convention, so without this no apple-touch-icon
  // link is emitted and iOS falls back to a page screenshot.
  icons: { icon: "/favicon.png", apple: "/apple-icon.png" },
  manifest: "/manifest.json",
  // iOS "Add to Home Screen": launch full-screen (no Safari chrome), label the
  // home-screen icon "AIMS Field", and keep the default status-bar style. The
  // apple-touch-icon itself is served from app/apple-icon.png by convention.
  appleWebApp: {
    capable: true,
    title: "AIMS Field",
    statusBarStyle: "default",
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <ClerkProvider>
      <html lang="en">
        <body className={`${inter.variable} ${manrope.variable} ${carlito.variable} ROOT_LAYOUT`}>
          <AppRouterCacheProvider>
            <ThemeModeProvider>
              <Providers>
                <Portal>{children}</Portal>
              </Providers>
            </ThemeModeProvider>
          </AppRouterCacheProvider>
        </body>
      </html>
    </ClerkProvider>
  );
}
