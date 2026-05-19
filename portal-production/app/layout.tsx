// "use client";
import type { Metadata } from "next";
import { Inter, Manrope, Carlito } from "next/font/google";
import "./globals.css";
import { AppRouterCacheProvider } from "@mui/material-nextjs/v15-appRouter";
import { ThemeModeProvider } from "@/contexts/ThemeModeContext";
import Head from "next/head";
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
  icons: { icon: "/favicon.png" },
  manifest: "/manifest.json",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <ClerkProvider>
      <html lang="en">
        <Head>
          <link rel="icon" href="/favicon.png" type="image/png" />
        </Head>
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
